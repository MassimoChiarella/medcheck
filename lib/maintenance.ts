import { env } from 'cloudflare:workers';
import { db, now } from './server';
import { CHECK_LEASE_MS, UpdateConflict, type UpdateRun } from './updates';
import { archiveLimit, capacity } from './storage';
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
  if (!['maintenance-plan','maintenance-clean','maintenance-scan'].includes(String(b.action))) return null;
  const run = await owned(b), protectedIds = await protectedImports();
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
    return Response.json({ candidates,hasMore:result.results.length>100,cursor:candidates.at(-1)?.id,protectedIds,graceDays:7,capacity:await capacity(),archiveLimitBytes:archiveLimit() });
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
  type Scan = {owner:string;dryRun:boolean;cursor:string;bytes:number;objects:number;removedBytes:number;removed:number;lastCursor?:string;lastPage?:unknown;complete:boolean};
  let scan: Scan = JSON.parse(run.details);
  const requested=typeof b.cursor==='string'&&b.cursor.length<=4096?b.cursor:'';
  const dryRun=b.dryRun!==false;
  if (scan.owner!==b.runId) scan={owner:String(b.runId),dryRun,cursor:'',bytes:0,objects:0,removedBytes:0,removed:0,complete:false};
  if (scan.dryRun!==dryRun) throw new Error('Restart maintenance to change dry-run mode.');
  if (scan.lastCursor===requested && scan.lastPage) return Response.json(scan.lastPage);
  if (scan.complete || requested!==scan.cursor) throw new Error('Storage scan pages must follow the returned cursor.');
  const page=await env.FILES.list({limit:20,...(requested?{cursor:requested}:{})});
  const candidates: {key:string;bytes:number}[]=[];
  for (const object of page.objects) {
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
  if (!dryRun && candidates.length) { await owned(b);await env.FILES.delete(candidates.map(c=>c.key)); }
  scan.bytes+=page.objects.reduce((sum,o)=>sum+o.size,0)-(dryRun?0:candidates.reduce((sum,o)=>sum+o.bytes,0));
  scan.objects+=page.objects.length;scan.removed+=dryRun?0:candidates.length;scan.removedBytes+=dryRun?0:candidates.reduce((sum,o)=>sum+o.bytes,0);
  scan.complete=!page.truncated;scan.lastCursor=requested;scan.cursor=page.truncated?page.cursor:'';
  const result={complete:scan.complete,cursor:scan.cursor,scannedObjects:scan.objects,archiveBytes:scan.bytes,deletedObjects:scan.removed,deletedBytes:scan.removedBytes,candidates,dryRun,archiveLimitBytes:archiveLimit()};
  scan.lastPage=result;
  await owned(b);
  const statements=[db().prepare("UPDATE update_runs SET details=? WHERE source='maintenance' AND runId=? AND outcome='running'").bind(JSON.stringify(scan),b.runId)];
  if(scan.complete)statements.push(db().prepare("INSERT INTO cache(key,value,fetched,source) VALUES('storage:r2',?,?,'maintenance') ON CONFLICT(key) DO UPDATE SET value=json_set(excluded.value,'$.bytes',MAX(json_extract(excluded.value,'$.bytes'),json_extract(cache.value,'$.bytes')-?)),fetched=excluded.fetched").bind(JSON.stringify({bytes:scan.bytes}),Date.now(),scan.removedBytes));
  await db().batch(statements);
  return Response.json(result);
}
