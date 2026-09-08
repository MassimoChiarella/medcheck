import { env } from 'cloudflare:workers';
import { db, hash, now } from '@/lib/server';
import { checkAction, UpdateConflict } from '@/lib/updates';
import { refreshAction } from '@/lib/refresh';

// Fixed source tables only. The upload API never accepts SQL or arbitrary identifiers.
const tables:Record<string,string[]>={
  cv_products:['id','name','ingredients'],
  cv_reports:['id','reportNo','version','received','updated','serious','outcomes'],
  cv_report_drugs:['id','reportId','drugId','name','role'],
  cv_reactions:['id','reportId','term'],
  cv_links:['id','reportId','target','kind'],
};
async function authorized(request:Request){
  if(!env.IMPORT_TOKEN||env.IMPORT_TOKEN.length<32)return false;
  const token=request.headers.get('authorization')?.replace(/^Bearer /,'')||'';
  if(token.length>512)return false;
  return await hash(token)===await hash(env.IMPORT_TOKEN);
}
async function body(request:Request){
  const reader=request.body?.getReader();if(!reader)throw new Error('Missing import body.');let size=0;const chunks:Uint8Array[]=[];
  while(true){const{done,value}=await reader.read();if(done)break;size+=value.length;if(size>1_800_000){await reader.cancel();throw new Error('Import batch exceeds 1.8 MB.');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}return JSON.parse(new TextDecoder().decode(bytes));
}
export async function POST(request:Request){
  if(!await authorized(request))return Response.json({error:'Unauthorized'},{status:401});
  try{
    const params=new URL(request.url).searchParams;
    if(params.has('sourceHash')){
      const sourceHash=params.get('sourceHash')!,index=Number(params.get('chunk')),expected=request.headers.get('x-content-sha256')||'';
      if(!/^[a-f0-9]{64}$/.test(sourceHash)||!/^[a-f0-9]{64}$/.test(expected)||!Number.isInteger(index)||index<0||index>200)throw new Error('Invalid source archive chunk.');
      const reader=request.body?.getReader();if(!reader)throw new Error('Missing source bytes.');const chunks:Uint8Array[]=[];let size=0;
      while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>5*1024*1024){await reader.cancel();throw new Error('Source chunk exceeds 5 MB.');}chunks.push(value);}
      const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}if(await hash(bytes)!==expected)throw new Error('Source chunk hash mismatch.');
      await env.FILES.put(`raw-sources/${sourceHash}/${index}`,bytes,{customMetadata:{sha256:expected}});return Response.json({accepted:true,size});
    }
    const b=await body(request);const action=b.action;
    const check=await checkAction(b);if(check)return check;
    const refresh=await refreshAction(b);if(refresh)return refresh;
    if(action==='archive-status'||action==='archive-complete'){
      if(!/^[a-f0-9]{64}$/.test(b.hash))throw new Error('Invalid source hash.');const key=`raw-sources/${b.hash}/manifest.json`;
      if(action==='archive-status')return Response.json({complete:!!await env.FILES.head(key)});
      if(!Array.isArray(b.chunks)||!b.chunks.length||b.chunks.length>201||!Number.isSafeInteger(b.bytes)||b.bytes>1_000_000_000||!String(b.sourceUrl).startsWith('https://'))throw new Error('Invalid source archive manifest.');
      let size=0;for(let i=0;i<b.chunks.length;i++){const stored=await env.FILES.head(`raw-sources/${b.hash}/${i}`);if(!stored||stored.customMetadata?.sha256!==b.chunks[i].hash||stored.size!==b.chunks[i].bytes)throw new Error('Source archive is incomplete.');size+=stored.size;}
      if(size!==b.bytes)throw new Error('Source archive byte count mismatch.');await env.FILES.put(key,JSON.stringify({...b,archivedAt:now()}),{httpMetadata:{contentType:'application/json'}});return Response.json({complete:true,bytes:size});
    }
    if(action==='dpd-begin'){
      if(!/^[a-f0-9]{16}$/.test(b.id)||!/^\d{4}-\d{2}-\d{2}T/.test(b.observedAt)||!Number.isSafeInteger(b.count)||b.count<1||!/^[a-f0-9]{64}$/.test(b.hash))throw new Error('Invalid Canadian catalogue manifest.');
      const prior=await db().prepare("SELECT id,state,created,hash FROM imports WHERE source='dpd' AND hash=? AND state IN ('active','staging') ORDER BY state LIMIT 1").bind(b.hash).first<{id:string;state:string;created:string}>();
      if(prior){if(prior.state==='active')await db().prepare("UPDATE source_state SET lastChecked=? WHERE id='dpd'").bind(now()).run();return Response.json({id:prior.id,state:prior.state,observedAt:prior.created});}
      await db().prepare("INSERT INTO imports(id,source,state,cutoff,hash,manifest,created) VALUES(?,'dpd','staging',?,?,?,?)").bind(b.id,b.observedAt.slice(0,10),b.hash,JSON.stringify({count:b.count}),b.observedAt).run();return Response.json({id:b.id,state:'staging',observedAt:b.observedAt});
    }
    if(action==='dpd'||action==='dpd-complete'){
      if(!/^[a-f0-9]{16}$/.test(b.id))throw new Error('Invalid catalogue generation.');
      const run=await db().prepare("SELECT * FROM imports WHERE id=? AND source='dpd'").bind(b.id).first<{state:string;manifest:string;created:string;cutoff:string}>();
      if(!run)throw new Error('Begin a catalogue import first.');if(run.state==='active')return Response.json({state:'active',replayed:true});if(run.state!=='staging')throw new Error('This catalogue is immutable.');
      if(action==='dpd'){
        if(!Array.isArray(b.entries)||!b.entries.length||b.entries.length>400)throw new Error('Invalid Canadian product snapshot batch.');
        const rows=[];
        for(const entry of b.entries){const p=entry.product;if(!p||!/^CA:\d+$/.test(p.id)||p.market!=='CA'||typeof p.name!=='string'||!Array.isArray(p.ingredients)||!String(p.sourceUrl).startsWith('https://health-products.canada.ca/dpd-bdpp/'))throw new Error('Invalid Canadian product record.');
          const data=JSON.stringify(p),digest=await hash(data),version=run.created;
          const v={id:`${p.id}@${version}`,productId:p.id,version,observedAt:version,sourceUpdatedAt:entry.sourceUpdatedAt,active:p.ingredients,form:p.form,route:p.route,sourceUrl:p.sourceUrl,contentHash:digest,completeness:'partial',notes:['Observed Canadian product snapshot. Source update dates are not formulation effective dates. Inactive ingredients and historical label text are unavailable from this API.']};
          rows.push([p.id,data,digest,JSON.stringify(v)]);
        }
        const raw=JSON.stringify(b.entries),digest=await hash(raw);
        await env.FILES.put(`canada/catalogue/${b.id}/${digest}.json`,raw,{httpMetadata:{contentType:'application/json'},customMetadata:{observedAt:run.created,sha256:digest}});
        await db().prepare("INSERT INTO dpd_staging(gen,id,data,hash,versionData) SELECT ?,json_extract(value,'$[0]'),json_extract(value,'$[1]'),json_extract(value,'$[2]'),json_extract(value,'$[3]') FROM json_each(?) WHERE true ON CONFLICT(gen,id) DO UPDATE SET data=excluded.data,hash=excluded.hash,versionData=excluded.versionData").bind(b.id,JSON.stringify(rows)).run();return Response.json({accepted:rows.length});
      }
      const count=await db().prepare('SELECT COUNT(*) AS n FROM dpd_staging WHERE gen=?').bind(b.id).first<{n:number}>();if(count?.n!==JSON.parse(run.manifest).count)throw new Error('Catalogue is incomplete. Previous snapshot retained.');
      await db().batch([
        db().prepare("INSERT INTO versions(id,productId,version,data,hash,observed) SELECT json_extract(s.versionData,'$.id'),s.id,?,s.versionData,s.hash,? FROM dpd_staging s WHERE s.gen=? AND s.hash IS NOT (SELECT hash FROM versions v WHERE v.productId=s.id ORDER BY observed DESC LIMIT 1) ON CONFLICT(id) DO NOTHING").bind(run.created,run.created,b.id),
        db().prepare("INSERT INTO products(id,data,observed) SELECT id,data,? FROM dpd_staging WHERE gen=? ON CONFLICT(id) DO UPDATE SET data=excluded.data,observed=excluded.observed WHERE julianday(excluded.observed)>=julianday(products.observed)").bind(run.created,b.id),
        db().prepare("UPDATE imports SET state='retired' WHERE source='dpd' AND state='active' AND julianday(created)<=julianday(?)").bind(run.created),
        db().prepare("UPDATE imports SET state=CASE WHEN EXISTS(SELECT 1 FROM imports WHERE source='dpd' AND state='active' AND julianday(created)>julianday(?)) THEN 'retired' ELSE 'active' END,completed=? WHERE id=?").bind(run.created,now(),b.id),
        db().prepare("INSERT INTO source_state(id,generation,lastSuccess,lastChecked,error,coverage) VALUES('dpd',?,?,?,NULL,?) ON CONFLICT(id) DO UPDATE SET generation=excluded.generation,lastSuccess=excluded.lastSuccess,lastChecked=excluded.lastChecked,error=NULL,coverage=excluded.coverage WHERE julianday(excluded.lastSuccess)>=julianday(source_state.lastSuccess)").bind(b.id,run.created,now(),run.cutoff),
      ]);return Response.json({state:(await db().prepare('SELECT state FROM imports WHERE id=?').bind(b.id).first<{state:string}>())?.state,count:count!.n});
    }
    if(action==='dpd-cleanup'){
      const r=await db().prepare("DELETE FROM dpd_staging WHERE rowid IN(SELECT rowid FROM dpd_staging WHERE gen IN(SELECT id FROM imports WHERE source='dpd' AND state='retired') LIMIT 5000)").run();return Response.json({deleted:r.meta.changes});
    }
    if(action==='retired'){
      // Keep the last successful generation for rollback, remove only older retired copies.
      const rows=await db().prepare("SELECT id FROM imports WHERE source='cv' AND (state='cleaning' OR (state='retired' AND id NOT IN(SELECT id FROM imports WHERE source='cv' AND state='retired' ORDER BY completed DESC LIMIT 1)))").all();return Response.json({generations:rows.results});
    }
    const id=String(b.id||'');if(!/^[a-f0-9]{16}$/.test(id))throw new Error('Invalid import generation.');
    if(action==='status'){
      const run=await db().prepare('SELECT * FROM imports WHERE id=?').bind(id).first();const batches=await db().prepare('SELECT tableName,MAX(batchId) AS lastBatch,SUM(rows) AS rows FROM import_batches WHERE importId=? GROUP BY tableName').bind(id).all();return Response.json({run,batches:batches.results,databaseBytes:batches.meta.size_after});
    }
    if(action==='begin'){
      if(!/^\d{4}-\d{2}-\d{2}$/.test(b.cutoff)||!/^[a-f0-9]{64}$/.test(b.hash))throw new Error('Invalid source manifest.');
      if(!b.manifest||Object.keys(tables).some(t=>!Number.isSafeInteger(b.manifest[t])||b.manifest[t]<=0)||!Number.isSafeInteger(b.bytes)||b.bytes>8_000_000_000)throw new Error('The complete dataset must fit within the configured 8 GB import ceiling.');
      const existing=await db().prepare('SELECT hash,state FROM imports WHERE id=?').bind(id).first<{hash:string;state:string}>();if(existing){if(existing.hash!==b.hash)throw new Error('Generation content conflict.');return Response.json({id,state:existing.state,resumed:true});}
      // Admission only accepts a validated full-source manifest; no sample mode exists.
      await db().prepare('INSERT INTO imports(id,source,state,cutoff,hash,manifest,created) VALUES(?,\'cv\',\'staging\',?,?,?,?)').bind(id,b.cutoff,b.hash,JSON.stringify(b.manifest),now()).run();
      return Response.json({id,state:'staging'});
    }
    const run=await db().prepare('SELECT * FROM imports WHERE id=?').bind(id).first<{state:string;manifest:string;cutoff:string}>();if(!run)throw new Error('Begin an import before uploading.');
    if(action==='fail'){
      const reason=String(b.error||'Scheduled import failed.').slice(0,500);await db().batch([db().prepare('UPDATE imports SET error=? WHERE id=?').bind(reason,id),db().prepare('INSERT INTO source_state(id,lastChecked,error) VALUES(\'cv\',?,?) ON CONFLICT(id) DO UPDATE SET lastChecked=excluded.lastChecked,error=excluded.error').bind(now(),reason)]);return Response.json({retainedPreviousGeneration:true});
    }
    if(action==='batch'){
      if(run.state!=='staging')throw new Error('Generation is immutable after validation.');
      const fields=tables[b.table];if(!fields||!Number.isSafeInteger(b.batch)||b.batch<0||!Array.isArray(b.rows)||!b.rows.length||b.rows.length>12000)throw new Error('Invalid bounded batch.');
      if(b.rows.some((r:unknown)=>!Array.isArray(r)||r.length!==fields.length||(r as unknown[]).some(x=>x!==null&&typeof x!=='string'&&typeof x!=='number')))throw new Error('Batch does not match the source schema.');
      if(b.rows.some((r:(string|number|null)[])=>!Number.isSafeInteger(r[0])||Number(r[0])<0||r.some(x=>typeof x==='string'&&x.length>100_000)))throw new Error('Invalid source row identifiers or field lengths.');
      const serialized=JSON.stringify(b.rows),digest=await hash(serialized);const existing=await db().prepare('SELECT hash FROM import_batches WHERE importId=? AND tableName=? AND batchId=?').bind(id,b.table,b.batch).first<{hash:string}>();if(existing){if(existing.hash!==digest)throw new Error('Batch content conflict.');return Response.json({accepted:true,replayed:true});}
      const expected=JSON.parse(run.manifest)[b.table];const count=await db().prepare('SELECT COALESCE(SUM(rows),0) AS n,COALESCE(MAX(batchId),-1) AS last FROM import_batches WHERE importId=? AND tableName=?').bind(id,b.table).first<{n:number;last:number}>();if(b.batch!==(count?.last??-1)+1||(count?.n||0)+b.rows.length>expected)throw new Error('Batches must be sequential and match the manifest.');
      await db().batch([
        db().prepare(`INSERT INTO ${b.table}(gen,${fields.map(f=>'"'+f+'"').join(',')}) SELECT ?,${fields.map((_,i)=>`json_extract(value,'$[${i}]')`).join(',')} FROM json_each(?)`).bind(id,serialized),
        db().prepare('INSERT INTO import_batches(importId,tableName,batchId,rows,hash) VALUES(?,?,?,?,?)').bind(id,b.table,b.batch,b.rows.length,digest),
      ]);
      return Response.json({accepted:true,rows:b.rows.length});
    }
    if(action==='validate'){
      if(!tables[b.table])throw new Error('Unknown import table.');const count=await db().prepare(`SELECT COUNT(*) AS n FROM ${b.table} WHERE gen=?`).bind(id).first<{n:number}>();const expected=JSON.parse(run.manifest)[b.table];if(count?.n!==expected)throw new Error(`Incomplete ${b.table}: ${count?.n||0} of ${expected} rows.`);return Response.json({table:b.table,rows:count?.n,valid:true});
    }
    if(action==='rollback'){
      if(!['retired','restoring'].includes(run.state))throw new Error('Rollback requires a complete retained generation that is not being cleaned.');
      const claimed=await db().prepare("UPDATE imports SET state='restoring' WHERE id=? AND state IN ('retired','restoring') RETURNING id").bind(id).first();if(!claimed)throw new Error('Generation is no longer available for restoration.');
      for(const table of Object.keys(tables)){const count=await db().prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE gen=?`).bind(id).first<{n:number}>();if(count?.n!==JSON.parse(run.manifest)[table])throw new Error('The retained generation is incomplete and cannot be restored.');}
      await db().batch([db().prepare("UPDATE imports SET state='retired' WHERE source='cv' AND state='active'"),db().prepare("UPDATE imports SET state='active',completed=? WHERE id=?").bind(now(),id),db().prepare("UPDATE source_state SET generation=?,coverage=?,lastChecked=?,error='An operator restored the previous complete dataset.' WHERE id='cv'").bind(id,run.cutoff,now())]);return Response.json({state:'active',id,rolledBack:true});
    }
    if(action==='promote'){
      if(run.state==='active')return Response.json({id,state:'active',replayed:true});
      if(run.state!=='staging')throw new Error('A retired or restored generation cannot be automatically promoted. Use explicit operator rollback or await a newer source release.');
      const expected=JSON.parse(run.manifest);const totals=await db().prepare('SELECT tableName,SUM(rows) AS n FROM import_batches WHERE importId=? GROUP BY tableName').bind(id).all<{tableName:string;n:number}>();if(Object.keys(tables).some(t=>totals.results.find(x=>x.tableName===t)?.n!==expected[t]))throw new Error('Import is incomplete. Previous dataset retained.');
      for(const table of Object.keys(tables)){const count=await db().prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE gen=?`).bind(id).first<{n:number}>();if(count?.n!==expected[table])throw new Error('Stored row count does not match the validated manifest.');}
      await db().batch([
        db().prepare('UPDATE imports SET state=\'retired\' WHERE source=\'cv\' AND state=\'active\''),
        db().prepare('UPDATE imports SET state=\'active\',completed=?,error=NULL WHERE id=?').bind(now(),id),
        db().prepare('INSERT INTO source_state(id,generation,lastSuccess,lastChecked,error,coverage) VALUES(\'cv\',?,?,?,NULL,?) ON CONFLICT(id) DO UPDATE SET generation=excluded.generation,lastSuccess=excluded.lastSuccess,lastChecked=excluded.lastChecked,error=NULL,coverage=excluded.coverage').bind(id,now(),now(),run.cutoff),
      ]);return Response.json({id,state:'active',coverage:run.cutoff});
    }
    if(action==='cleanup'){
      if(run.state==='cleaned')return Response.json({deleted:0});
      if(!tables[b.table])throw new Error('Unknown table.');
      // Atomic state claims serialize restoration and cleanup across requests.
      const claimed=await db().prepare("UPDATE imports SET state='cleaning' WHERE id=? AND state IN ('retired','cleaning') RETURNING id").bind(id).first();if(!claimed)throw new Error('Only a retired generation that is not being restored can be cleaned.');
      const r=await db().prepare(`DELETE FROM ${b.table} WHERE gen=? AND id IN(SELECT id FROM ${b.table} WHERE gen=? LIMIT 5000) AND EXISTS(SELECT 1 FROM imports WHERE id=? AND state='cleaning')`).bind(id,id,id).run();
      if(!r.meta.changes){let remaining=false;for(const table of Object.keys(tables)){if(await db().prepare(`SELECT 1 FROM ${table} WHERE gen=? LIMIT 1`).bind(id).first()){remaining=true;break;}}if(!remaining)await db().prepare("UPDATE imports SET state='cleaned' WHERE id=? AND state='cleaning'").bind(id).run();}
      return Response.json({deleted:r.meta.changes});
    }
    throw new Error('Unknown import action.');
  }catch(e){const message=e instanceof Error?e.message:'Import failed. Previous generation retained.';return Response.json({error:message},{status:e instanceof UpdateConflict?409:/D1_ERROR|R2_ERROR|internal error/i.test(message)?503:400});}
}
