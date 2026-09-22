import { env } from 'cloudflare:workers';
import { db, hash, now } from './server';
import { assertLease } from './database';
import { CHECK_LEASE_MS, noMaintenance } from './updates';

export function estimatedImportBytes(source: 'cv' | 'dpd', bytes: number) {
  if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > 8_000_000_000) throw new Error('Invalid import size estimate.');
  // Conservative headroom for generation keys, indexes and duplicated product/version JSON.
  return Math.max(20_000_000, Math.ceil(bytes * (source === 'cv' ? 3 : 4)));
}
export async function capacity() {
  const limitBytes = Number(env.IMPORT_DATABASE_LIMIT_BYTES || '8000000000');
  if (!Number.isSafeInteger(limitBytes) || limitBytes < 50_000_000 || limitBytes > 8_000_000_000) throw new Error('IMPORT_DATABASE_LIMIT_BYTES must be between 50000000 and 8000000000.');
  const result = await db().prepare("SELECT COALESCE(SUM(reservedBytes),0) AS reserved FROM imports WHERE state='staging'").all<{reserved:number}>();
  const databaseBytes = result.meta.size_after, reservedBytes = result.results[0].reserved;
  if (!Number.isSafeInteger(databaseBytes)) throw new Error('Database size could not be measured; import admission is unavailable.');
  return { databaseBytes, reservedBytes, limitBytes, availableBytes: Math.max(0, limitBytes - databaseBytes - reservedBytes) };
}
export async function writeCapacity(growthBytes = 12_000_000) {
  const value = await capacity();
  if (value.databaseBytes + growthBytes > value.limitBytes) throw new Error('Database capacity limit reached. Previous complete data remains available; no storage upgrade was made.');
  return value;
}

export function archiveLimit() {
  const value = Number(env.IMPORT_ARCHIVE_LIMIT_BYTES || '8000000000');
  if (!Number.isSafeInteger(value) || value < 10_000_000 || value > 8_000_000_000) throw new Error('IMPORT_ARCHIVE_LIMIT_BYTES must be between 10000000 and 8000000000.');
  return value;
}
type ArchiveWrite = {key:string;hash:string;bytes:number;state:string;inFlight:number;writeId:string};
export async function archiveAccounting(){
  const meter=await db().prepare("SELECT bytes,initialized,updated FROM storage_usage WHERE id='r2'").first<{bytes:number;initialized:number;updated:string}>();
  const pending=await db().prepare("SELECT COUNT(*) n,COALESCE(SUM(bytes),0) bytes FROM archive_writes WHERE state IN ('pending','uncertain','deleting','failed') OR inFlight>0").first<{n:number;bytes:number}>();
  return {bytes:meter?.bytes??null,initialized:!!meter?.initialized,measuredAt:meter?.updated,unresolvedWrites:pending?.n||0,reservedOrUncertainBytes:pending?.bytes||0,limitBytes:archiveLimit(),exact:!!meter?.initialized&&!pending?.n};
}
// A source lease owns publication; a random operation ID owns only its own terminal
// storage acknowledgement. This narrow path may settle after lease expiry, but never
// publishes evidence or releases an ambiguous remote operation's reservation.
async function settleAttempt(id:string,key:string,kind:'put'|'delete',cancelled=false){
  const match="EXISTS(SELECT 1 FROM archive_attempts a WHERE a.id=? AND a.key=archive_writes.key AND a.kind=? AND a.registryId=archive_writes.writeId AND a.hash=archive_writes.hash AND a.bytes=archive_writes.bytes)";
  await env.DB.batch([
    env.DB.prepare(`UPDATE archive_writes SET inFlight=MAX(0,inFlight-1),state=?,updated=? WHERE key=? AND ${match}`)
      .bind(cancelled?'failed':kind==='put'?'verified':'deleted',now(),key,id,kind),
    env.DB.prepare(`UPDATE storage_usage SET bytes=MAX(0,bytes-COALESCE((SELECT bytes FROM archive_writes WHERE key=? AND state='deleted' AND inFlight=0 AND ${match}),0)),updated=? WHERE id='r2'`).bind(key,id,kind,now()),
    env.DB.prepare(`DELETE FROM archive_writes WHERE key=? AND state='deleted' AND inFlight=0 AND ${match}`).bind(key,id,kind),
    env.DB.prepare('DELETE FROM archive_attempts WHERE id=? AND key=? AND kind=?').bind(id,key,kind),
  ]);
}
export async function deleteArchives(candidates:{key:string;bytes:number}[]){
  for(const item of candidates){
    const attempt=crypto.randomUUID(),stamp=now();
    await db().batch([
      db().prepare("INSERT INTO archive_writes(key,hash,bytes,state,writeId,inFlight,created,updated) VALUES(?,'',?,'deleting',?,1,?,?) ON CONFLICT(key) DO UPDATE SET state='deleting',writeId=excluded.writeId,inFlight=inFlight+1 WHERE archive_writes.inFlight=0 AND archive_writes.state='verified'").bind(item.key,item.bytes,attempt,stamp,stamp),
      db().prepare("INSERT INTO archive_attempts(id,key,kind,registryId,hash,bytes,created) SELECT ?,key,'delete',writeId,hash,bytes,? FROM archive_writes WHERE key=? AND writeId=? AND state='deleting' AND inFlight=1").bind(attempt,stamp,item.key,attempt),
    ]);
    if(!await db().prepare('SELECT id FROM archive_attempts WHERE id=?').bind(attempt).first())throw new Error('Archive cleanup is unresolved.');
    await env.FILES.delete(item.key);
    await settleAttempt(attempt,item.key,'delete');
    await assertLease();
  }
}
export async function putArchive(key: string, value: string | Uint8Array, options?: R2PutOptions) {
  await noMaintenance();await assertLease();
  const size=typeof value==='string'?new TextEncoder().encode(value).byteLength:value.byteLength,digest=await hash(value);
  if(size>12*1024*1024)throw new Error('Archive object exceeds the bounded write limit.');
  let meter=await db().prepare("SELECT initialized FROM storage_usage WHERE id='r2'").first<{initialized:number}>();
  if(!meter?.initialized){
    const existing=await env.FILES.list({limit:1});
    if(existing.objects.length)throw new Error('Run storage maintenance to initialize verified archive accounting before writing.');
    await db().prepare("INSERT OR IGNORE INTO storage_usage(id,bytes,initialized,updated) VALUES('r2',0,1,?)").bind(now()).run();
    meter={initialized:1};
  }
  const writeId=crypto.randomUUID(),stamp=now();
  // Immutable key admission and accounting share a transaction. A retry charges the key once.
  await db().batch([
    db().prepare(`INSERT INTO archive_writes(key,hash,bytes,state,writeId,created,updated)
      SELECT ?,?,?,'pending',?,?,? WHERE EXISTS(SELECT 1 FROM storage_usage WHERE id='r2' AND initialized=1 AND bytes+?<=?)
      AND NOT EXISTS(SELECT 1 FROM update_runs WHERE source='maintenance' AND outcome='running' AND heartbeat>?)
      ON CONFLICT(key) DO NOTHING`).bind(key,digest,size,writeId,stamp,stamp,size,archiveLimit(),new Date(Date.now()-CHECK_LEASE_MS).toISOString()),
    db().prepare("UPDATE storage_usage SET bytes=bytes+?,updated=? WHERE id='r2' AND EXISTS(SELECT 1 FROM archive_writes WHERE key=? AND writeId=?)").bind(size,stamp,key,writeId),
  ]);
  const record=await db().prepare('SELECT * FROM archive_writes WHERE key=?').bind(key).first<ArchiveWrite>();
  if(!record)throw new Error('Archive storage ceiling reached or maintenance blocked admission. Previous evidence was retained.');
  if(['deleting','deleted'].includes(record.state))throw new Error('Archive cleanup is unresolved; retry after maintenance.');
  if(record.bytes!==size||(record.hash&&record.hash!==digest))throw new Error('Immutable archive content conflict.');
  const old=await env.FILES.head(key);
  if(old){
    const oldDigest=old.customMetadata?.sha256||(old.size===size?await hash(new Uint8Array(await (await env.FILES.get(key))!.arrayBuffer())):'');
    if(old.size!==size||oldDigest!==digest)throw new Error('Immutable archive content conflict.');
    await db().prepare("UPDATE archive_writes SET hash=?,state='verified',updated=? WHERE key=? AND state<>'deleting'").bind(digest,now(),key).run();
    await assertLease();return old;
  }
  // This marker outlives request/lease timeouts. A missing HEAD alone cannot release it.
  const attempt=crypto.randomUUID();
  let dispatched=false;
  try{await db().batch([
    db().prepare(`INSERT INTO archive_attempts(id,key,kind,registryId,hash,bytes,created) SELECT ?,key,'put',writeId,hash,bytes,? FROM archive_writes WHERE key=? AND state NOT IN ('deleting','deleted') AND inFlight<5
      AND NOT EXISTS(SELECT 1 FROM update_runs WHERE source='maintenance' AND outcome='running' AND heartbeat>?)`)
      .bind(attempt,now(),key,new Date(Date.now()-CHECK_LEASE_MS).toISOString()),
    db().prepare("UPDATE archive_writes SET inFlight=inFlight+1,state='pending',updated=? WHERE key=? AND EXISTS(SELECT 1 FROM archive_attempts WHERE id=?)").bind(now(),key,attempt),
  ]);
  if(!await db().prepare('SELECT id FROM archive_attempts WHERE id=?').bind(attempt).first())throw new Error('Archive admission paused by maintenance or unresolved earlier writes.');
    dispatched=true;
    await env.FILES.put(key,value,{...options,customMetadata:{...options?.customMetadata,sha256:digest},onlyIf:{etagDoesNotMatch:'*'}});
    const verified=await env.FILES.head(key);
    if(!verified||verified.size!==size||verified.customMetadata?.sha256!==digest)throw new Error('Archive verification failed.');
    await settleAttempt(attempt,key,'put');
    await assertLease();return verified;
  }catch(error){
    if(!dispatched){await settleAttempt(attempt,key,'put',true);throw error;}
    // No release on ambiguous R2 failures: a remote write can complete after this request.
    try{await db().prepare("UPDATE archive_writes SET state='uncertain',updated=? WHERE key=? AND state<>'deleting'").bind(now(),key).run();}catch{/* Lost owners cannot alter the new owner's state. */}
    throw error;
  }
}
