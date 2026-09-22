import { reconcileDatabaseReservations } from './database';
import { env } from 'cloudflare:workers';
import { db, now, hash } from './server';
import { CHECK_LEASE_MS, UpdateConflict, type UpdateRun } from './updates';
import { archiveLimit, capacity, archiveAccounting, deleteArchives } from './storage';
import { artifactCandidate, RETENTION_GRACE_MS } from './storage-policy';

const cvTables = ['cv_products','cv_reports','cv_report_drugs','cv_reactions','cv_links'];
export async function protectedImports() {
  const result = await db().prepare(`SELECT id FROM imports WHERE state IN ('active','restoring')
    OR id IN (SELECT generation FROM source_state WHERE generation IS NOT NULL)
    OR id=(SELECT id FROM imports WHERE source='cv' AND state='retired' ORDER BY completed DESC,id DESC LIMIT 1)`).all<{id:string}>();
  return result.results.map(r=>r.id);
}
async function owned(b: Record<string,unknown>) {
  if (b.source !== 'maintenance' || !/^[a-f0-9]{32}$/.test(String(b.runId))) throw new Error('Start an authenticated maintenance check.');
  const run = await db().prepare("UPDATE update_runs SET heartbeat=? WHERE source='maintenance' AND runId=? AND outcome='running' AND heartbeat>? RETURNING *")
    .bind(now(),b.runId,new Date(Date.now()-CHECK_LEASE_MS).toISOString()).first<UpdateRun>();
  if (!run) throw new UpdateConflict('The maintenance lease expired or changed; restart maintenance.');
  return run;
}
export async function maintenanceAction(b: Record<string,unknown>): Promise<Response|null> {
  if (!['maintenance-plan','maintenance-clean','maintenance-scan','maintenance-reconcile-archives','maintenance-catalogue-archives'].includes(String(b.action))) return null;
  const run = await owned(b);
  await reconcileDatabaseReservations();
  const protectedIds = await protectedImports();
  if(b.action==='maintenance-catalogue-archives'){
    const cursor=typeof b.cursor==='string'&&b.cursor.length<=4096?b.cursor:'';
    const page=await env.FILES.list({prefix:'canada/catalogue/',limit:2,...(cursor?{cursor}:{})});
    const writes=[];
    for(const item of page.objects){
      const match=item.key.match(/^canada\/catalogue\/([a-f0-9]{16})\/([a-f0-9]{64})\.json$/);if(!match||item.size>1_800_000)continue;
      const run=await db().prepare("SELECT created FROM imports WHERE source='dpd' AND id=?").bind(match[1]).first<{created:string}>();if(!run)continue;
      const object=await env.FILES.get(item.key);if(!object)continue;const raw=new Uint8Array(await object.arrayBuffer()),digest=await hash(raw);if(digest!==match[2])continue;
      const entries=JSON.parse(new TextDecoder().decode(raw));if(!Array.isArray(entries)||entries.length>400)continue;
      const identities=await Promise.all(entries.filter(x=>x?.product?.id).map(async x=>[x.product.id,await hash(JSON.stringify(x.product))]));
      writes.push(db().prepare(`UPDATE versions SET data=json_set(data,'$.archiveKey',?,'$.archiveHash',?,'$.archiveStatus','verified')
        WHERE version=? AND EXISTS(SELECT 1 FROM json_each(?) WHERE json_extract(value,'$[0]')=versions.productId AND json_extract(value,'$[1]')=versions.hash)`)
        .bind(item.key,digest,run.created,JSON.stringify(identities)));
    }
    if(writes.length)await db().batch(writes);
    return Response.json({complete:!page.truncated,cursor:page.truncated?page.cursor:'',objects:page.objects.length});
  }
  if(b.action==='maintenance-reconcile-archives'){
    const after=typeof b.after==='string'&&b.after.length<=200?b.after:'';
    const rows=await db().prepare('SELECT id,data FROM versions WHERE id>? ORDER BY id LIMIT 21').bind(after).all<{id:string;data:string}>();
    const page=rows.results.slice(0,20),writes=[];let verified=0,unavailable=0;
    for(const row of page){
      const v=JSON.parse(row.data),setid=String(v.productId).split(':')[1];
      const keys=v.archiveKey?[v.archiveKey]:String(v.productId).startsWith('CA:')?[`canada/products/${setid}/${v.contentHash}.json`]:[`labels/${setid}/${v.version}/${v.contentHash}.xml`,`labels/${setid}/${v.version}/${v.contentHash}.zip`];
      let found=false;
      for(const key of keys){const object=await env.FILES.get(key);if(!object)continue;if(object.size>12*1024*1024){await object.body.cancel();continue;}const digest=await hash(new Uint8Array(await object.arrayBuffer()));if(v.archiveHash&&v.archiveHash!==digest)continue;if(String(v.productId).startsWith('US:')&&v.contentHash!==digest)continue;v.archiveKey=key;v.archiveHash=digest;v.archiveStatus='verified';found=true;break;}
      if(found)verified++;else{const known=!!v.archiveKey;v.archiveStatus=known?'unavailable':'legacy';v.notes=[...new Set([...v.notes||[],known?'Historical source bytes are unavailable in this installation; a new retrieval cannot recreate them.':'This legacy observation has no verified archive reference. Its original bytes have not been established.'])];unavailable++;}
      writes.push(db().prepare('UPDATE versions SET data=? WHERE id=?').bind(JSON.stringify(v),row.id));
    }
    if(writes.length)await db().batch(writes);
    return Response.json({complete:rows.results.length<=20,cursor:page.at(-1)?.id||after,verified,unavailable});
  }
  const cutoff = new Date(Date.now()-RETENTION_GRACE_MS).toISOString();
  if (b.action === 'maintenance-plan') {
    const after = typeof b.after === 'string' && b.after.length <= 16 ? b.after : '';
    const result = await db().prepare(`SELECT id,source,state,COALESCE(touched,created) AS lastActivity FROM imports
      WHERE id>? AND id NOT IN (SELECT value FROM json_each(?)) AND (
        (state='staging' AND completed IS NULL AND julianday(COALESCE(touched,created))<julianday(?))
        OR state IN ('abandoning','cleaning') OR (state='retired' AND source='cv')
        OR (state='retired' AND source='dpd' AND EXISTS(SELECT 1 FROM dpd_staging WHERE gen=imports.id)))
      ORDER BY id LIMIT 101`).bind(after,JSON.stringify(protectedIds),cutoff).all<{id:string}>();
    const candidates=result.results.slice(0,100);
    return Response.json({ candidates,hasMore:result.results.length>100,cursor:candidates.at(-1)?.id,protectedIds,graceDays:7,capacity:await capacity(),archiveLimitBytes:archiveLimit(),archiveAccounting:await archiveAccounting() });
  }
  if (b.action === 'maintenance-clean') {
    if (!/^[a-f0-9]{16}$/.test(String(b.id)) || protectedIds.includes(String(b.id))) throw new Error('Active, restoring and rollback datasets are protected.');
    let item = await db().prepare('SELECT * FROM imports WHERE id=?').bind(b.id).first<{id:string;source:string;state:string;completed:string|null}>();
    if (!item) throw new Error('Unknown cleanup generation.');
    if (['abandoned','cleaned'].includes(item.state)) return Response.json({done:true,deleted:0});
    if (item.state==='staging') {
      const claimed = await db().prepare("UPDATE imports SET state='abandoning',reservedBytes=0 WHERE id=? AND state='staging' AND completed IS NULL AND julianday(COALESCE(touched,created))<julianday(?) RETURNING source,state,completed,id").bind(b.id,cutoff).first<typeof item>();
      if (!claimed) throw new Error('Recent or published imports cannot be abandoned.');
      item=claimed;
    }
    if (item.source==='cv' && item.state==='retired') {
      await db().prepare("UPDATE imports SET state='cleaning',reservedBytes=0 WHERE id=? AND state='retired'").bind(b.id).run();item.state='cleaning';
    }
    if (!['abandoning','cleaning'].includes(item.state) && !(item.source==='dpd' && item.state==='retired')) throw new Error('Generation is not eligible for cleanup.');
    const tables = item.source==='cv' ? cvTables : item.source==='dpd' ? ['dpd_staging'] : [];
    if (!tables.length) throw new Error('Unknown cleanup source.');
    for (const table of tables) {
      const result = await db().prepare(`DELETE FROM ${table} WHERE rowid IN(SELECT rowid FROM ${table} WHERE gen=? LIMIT 5000)`).bind(b.id).run();
      if (result.meta.changes) return Response.json({done:false,table,deleted:result.meta.changes});
    }
    const batches=await db().prepare('DELETE FROM import_batches WHERE rowid IN(SELECT rowid FROM import_batches WHERE importId=? LIMIT 5000)').bind(b.id).run();
    if (batches.meta.changes) return Response.json({done:false,deleted:batches.meta.changes});
    const state=item.state==='abandoning'?'abandoned':item.source==='cv'?'cleaned':'retired';
    await db().prepare('UPDATE imports SET state=?,reservedBytes=0 WHERE id=?').bind(state,b.id).run();
    return Response.json({done:true,deleted:0,state});
  }

  // Scan every object in small pages. Only old, unreferenced partial uploads can be deleted.
  type Scan = {owner:string;dryRun:boolean;cursor:string;bytes:number;objects:number;removedBytes:number;removed:number;lastCursor?:string;lastPage?:unknown;complete:boolean;listComplete?:boolean};
  let scan: Scan = JSON.parse(run.details);
  const requested=typeof b.cursor==='string'&&b.cursor.length<=4096?b.cursor:'';
  const dryRun=b.dryRun!==false;
  if (scan.owner!==b.runId) scan={owner:String(b.runId),dryRun,cursor:'',bytes:0,objects:0,removedBytes:0,removed:0,complete:false};
  if (scan.dryRun!==dryRun) throw new Error('Restart maintenance to change dry-run mode.');
  if (scan.lastCursor===requested && scan.lastPage) return Response.json(scan.lastPage);
  if (scan.complete || requested!==scan.cursor) throw new Error('Storage scan pages must follow the returned cursor.');
  const reconciling=!!scan.listComplete;
  let page:{objects:R2Object[];truncated:boolean;cursor?:string};
  if(reconciling){
    const records=await db().prepare('SELECT key,state,inFlight FROM archive_writes WHERE key>? AND seenScan IS NOT ? ORDER BY key LIMIT 21').bind(requested.slice('registry:'.length),b.runId).all<{key:string;state:string;inFlight:number}>();
    const slice=records.results.slice(0,20),objects:R2Object[]=[];
    for(const item of slice){const object=await env.FILES.head(item.key);if(object)objects.push(object);else if(item.inFlight===0&&['verified','failed'].includes(item.state))await db().prepare("DELETE FROM archive_writes WHERE key=? AND inFlight=0 AND state IN ('verified','failed')").bind(item.key).run();}
    page={objects,truncated:records.results.length>20,cursor:'registry:'+(slice.at(-1)?.key||'')};
  }else page=await env.FILES.list({limit:20,include:['customMetadata'],...(requested?{cursor:requested}:{})});
  const candidates: {key:string;bytes:number}[]=[];
  for (const object of page.objects) {
    if(reconciling)continue;
    const registered=await db().prepare('SELECT state,inFlight FROM archive_writes WHERE key=?').bind(object.key).first<{state:string;inFlight:number}>();
    if(registered&&(registered.inFlight>0||registered.state!=='verified'))continue;
    const candidate=artifactCandidate(object.key,object.uploaded);if(!candidate)continue;
    if (candidate.kind==='raw') {
      if (await env.FILES.head(`raw-sources/${candidate.id}/manifest.json`)) continue;
      if (await db().prepare("SELECT 1 FROM imports WHERE hash=? AND state NOT IN ('abandoned','cleaned') LIMIT 1").bind(candidate.id).first()) continue;
    } else {
      if (!await db().prepare("SELECT 1 FROM imports WHERE id=? AND source='dpd' AND state='abandoned' AND completed IS NULL").bind(candidate.id).first()) continue;
    }
    const current=await env.FILES.head(object.key);
    if (!current || current.etag!==object.etag || current.uploaded.getTime()!==object.uploaded.getTime()) continue;
    candidates.push({key:object.key,bytes:object.size});
  }
  if (!dryRun && candidates.length) {
    await owned(b);
    await deleteArchives(candidates);
    await owned(b);
  }
  const pageWrites:D1PreparedStatement[]=[];
  const seenKeys:string[]=[];
  for(const object of page.objects){
    if(!dryRun&&candidates.some(c=>c.key===object.key))continue;
    seenKeys.push(object.key);
    pageWrites.push(db().prepare(`INSERT INTO archive_writes(key,hash,bytes,state,writeId,inFlight,created,updated,seenScan)
      VALUES(?,?,?,'verified',?,0,?,?,?) ON CONFLICT(key) DO UPDATE SET seenScan=excluded.seenScan,updated=excluded.updated`)
      .bind(object.key,object.customMetadata?.sha256||'',object.size,b.runId,object.uploaded.toISOString(),now(),b.runId));
  }
  scan.bytes+=page.objects.reduce((sum,o)=>sum+o.size,0)-(dryRun?0:candidates.reduce((sum,o)=>sum+o.bytes,0));
  scan.objects+=page.objects.length;scan.removed+=dryRun?0:candidates.length;scan.removedBytes+=dryRun?0:candidates.reduce((sum,o)=>sum+o.bytes,0);
  scan.complete=reconciling&&!page.truncated;scan.lastCursor=requested;
  if(!reconciling&&!page.truncated){scan.listComplete=true;scan.cursor='registry:';}else scan.cursor=page.truncated?page.cursor||'':'';
  const unresolved=await db().prepare("SELECT COALESCE(SUM(inFlight>0 OR state IN ('pending','uncertain','deleting','failed')),0) n,COALESCE(SUM(CASE WHEN seenScan IS NOT ? AND key NOT IN(SELECT value FROM json_each(?)) THEN bytes ELSE 0 END),0) unseen,COALESCE(SUM(seenScan IS NOT ? AND key NOT IN(SELECT value FROM json_each(?))),0) missing FROM archive_writes").bind(b.runId,JSON.stringify(seenKeys),b.runId,JSON.stringify(seenKeys)).first<{n:number;unseen:number;missing:number}>();
  const accountedBytes=scan.bytes+(unresolved?.unseen||0);
  const result={complete:scan.complete,cursor:scan.cursor,scannedObjects:scan.objects,archiveBytes:scan.bytes,accountedBytes,unresolvedWrites:unresolved?.n||0,exact:scan.complete&&!unresolved?.n&&!unresolved?.missing,deletedObjects:scan.removed,deletedBytes:scan.removedBytes,candidates,dryRun,archiveLimitBytes:archiveLimit()};
  scan.lastPage=result;
  await owned(b);
  const statements=[...pageWrites,db().prepare("UPDATE update_runs SET details=? WHERE source='maintenance' AND runId=? AND outcome='running'").bind(JSON.stringify(scan),b.runId)];
  if(scan.complete){
    statements.push(db().prepare("INSERT INTO storage_usage(id,bytes,initialized,updated) VALUES('r2',?,1,?) ON CONFLICT(id) DO UPDATE SET bytes=excluded.bytes,initialized=1,updated=excluded.updated").bind(accountedBytes,now()));
    statements.push(db().prepare("DELETE FROM cache WHERE key='storage:r2'"));
  }
  await db().batch(statements);
  return Response.json(result);
}
