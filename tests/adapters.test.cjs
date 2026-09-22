/* oxlint-disable typescript/no-require-imports, typescript/no-implied-eval -- Source adapters run in an isolated VM with deterministic network and storage fixtures. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto'),ts=require('typescript');
function harness(handler=()=>null,fetcher=async()=>new Response('{}'),overrides={}){
  const modules={},calls=[];
  const database={};
  database.prepare=sql=>{const make=(args=[])=>{const invoke=kind=>{calls.push({sql,args,kind});const value=handler(sql,args,kind);return value??(kind==='all'?{results:[],meta:{size_after:1000}}:kind==='run'?{meta:{size_after:1000,changes:1}}:null);};return {bind:(...next)=>make(next),first:async()=>invoke('first'),all:async()=>invoke('all'),run:async()=>invoke('run')};};return make();};
  database.batch=async items=>Promise.all(items.map(x=>x.run()));
  function load(file){file=file.replace(/\.ts$/,'');if(modules[file])return modules[file];const exports={};modules[file]=exports;
    const code=ts.transpileModule(fs.readFileSync(`lib/${file}.ts`,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    const req=id=>id==='./database'&&!overrides.realStorage?{database:()=>database,LeaseConflict:class extends Error{}}:id==='cloudflare:workers'?{env:{...overrides.environment,DB:overrides.database||database,FILES:overrides.files}}:id==='./storage'&&!overrides.realStorage?{putArchive:overrides.putArchive||(async()=>{}),writeCapacity:async()=>{},reserveDatabase:async()=>()=>{},cacheWrite:async()=>{}}:id==='./updates'&&!overrides.realStorage?{checkStatus:()=>({})}:id.startsWith('./')?load(id.slice(2)):require(id);
    vm.runInNewContext(code,{exports,require:req,crypto:crypto.webcrypto,fetch:fetcher,Date,URL,TextEncoder,TextDecoder,Response,AbortSignal,Uint8Array,Buffer,setTimeout:f=>setTimeout(f,0)},{filename:file+'.ts'});return exports;
  }
  return {load,calls};
}
const fixture=fs.readFileSync('tests/fixtures/sertraline-v8.xml','utf8');
test('historical identity survives TTL and current-label removal',async()=>{
  const h=harness(sql=>sql.startsWith('SELECT data,observed FROM products')?{data:JSON.stringify(product),observed:'2000-01-01T00:00:00Z'}:sql.startsWith('INSERT INTO source_budget')?{count:1}:null,async()=>new Response(fixture.replaceAll(product.identifiers.ndc,'99999-9999')));
  const product=h.load('core').parseSPL(fixture).products[0];const server=h.load('server');
  const saved=await server.getProduct(product.id);assert.equal(saved.id,product.id);assert.equal(saved.currentPresence,'unknown');assert.equal(h.calls.length,1);
  const refreshed=await server.refreshProduct(saved);assert.equal(refreshed.id,product.id);assert.equal(refreshed.currentPresence,'absent');assert.equal(refreshed.dataStatus,'partial');
});
module.exports={harness,fixture};

test('history and saved versions remain readable during source outage',async()=>{
  const h=harness(sql=>sql.startsWith('SELECT data FROM versions WHERE productId=? AND version=?')?{data:JSON.stringify(versions[0])}:sql.startsWith('SELECT data FROM versions')?{results:versions.map(v=>({data:JSON.stringify(v)}))}:sql.startsWith('INSERT INTO source_budget')?{count:1}:null,async()=>new Response('offline',{status:503}));
  const parsed=h.load('core').parseSPL(fixture),p=parsed.products[0],versions=[parsed.versions[0]];
  const saved=await h.load('server').getVersion(p,'8');assert.equal(saved.productId,p.id);
  const history=await h.load('server').history(p);assert.equal(history.data.length,1);assert.equal(history.completeness,'partial');assert.match(history.notes[0],/Only versions previously inspected/);
});

test('fresh retrieval survives cache persistence failure',async()=>{
  const h=harness(sql=>{if(sql.startsWith('INSERT INTO cache'))throw new Error('capacity');return null;});
  const value=await h.load('server').cached('key',1000,'dpd',async()=>({ok:true}));
  assert.equal(value.value.ok,true);assert.equal(value.stale,false);
});
test('failed Canadian archive is retried before history publication',async()=>{
  let fail=true;const keys=[];
  const h=harness(sql=>sql.startsWith('INSERT INTO source_budget')?{count:1}:null,async url=>new Response(JSON.stringify(url.pathname.includes('/drugproduct/')?[{brand_name:'TEST',class_name:'Human',company_name:'Maker',drug_identification_number:'00000123'}]:url.pathname.includes('/activeingredient/')?[{ingredient_name:'A',strength:'1',strength_unit:'mg'}]:[])),{putArchive:async(key)=>{keys.push(key);if(fail)throw new Error('R2 outage');}});
  const first=await h.load('server').caProduct(123);assert.equal(first.persistence,'unavailable');assert.equal(first.name,'TEST');
  assert.equal(h.calls.filter(c=>/^INSERT INTO (versions|products)/.test(c.sql)).length,0);
  fail=false;const second=await h.load('server').caProduct(123);assert.equal(second.persistence,'archived');assert.equal(keys.length,2);assert.equal(keys[0],keys[1]);
  assert.ok(h.calls.some(c=>c.sql.startsWith('INSERT INTO versions')));
});
test('stored exact archive rehydrates a label without upstream or parsed cache',async()=>{
  const digest=crypto.createHash('sha256').update(fixture).digest('hex'),key=`labels/fixture/8/${digest}.xml`;
  const h=harness(sql=>sql.includes('productId GLOB')?{data:JSON.stringify({archiveKey:key,archiveHash:digest,observedAt:'2026-01-01T00:00:00Z'})}:null,async()=>{throw new Error('Unexpected upstream request');},{files:{get:async()=>({size:Buffer.byteLength(fixture),arrayBuffer:async()=>new TextEncoder().encode(fixture).buffer})}});
  const parsed=h.load('core').parseSPL(fixture),value=await h.load('server').loadLabel(parsed.products[0].identifiers.setid,'8');
  assert.equal(value.value.version,'8');assert.equal(value.value.versions[0].archiveStatus,'verified');assert.equal(value.value.versions[0].observedAt,'2026-01-01T00:00:00Z');
});

function storageFixture(hooks={}){
  const {DatabaseSync}=require('node:sqlite'),sqlite=new DatabaseSync(':memory:');
  for(const file of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sqlite.exec(fs.readFileSync('drizzle/'+file,'utf8'));
  const execute=(sql,args)=>{const results=sqlite.prepare(sql).all(...args);return {results,meta:{changes:sqlite.prepare('SELECT changes() n').get().n,size_after:sqlite.prepare('PRAGMA page_count').get().page_count*4096}};};
  const db={prepare(sql){const make=(args=[])=>({sql,args,bind:(...values)=>make(values),all:async()=>{const result=execute(sql,args);if(hooks.all)await hooks.all(sql,args,result);return result;},run:async()=>execute(sql,args),first:async()=>{if(hooks.first)hooks.first(sql,args);return execute(sql,args).results[0]||null;}});return make();},async batch(items){sqlite.exec('BEGIN');let result;try{result=items.map(x=>execute(x.sql,x.args));sqlite.exec('COMMIT');}catch(error){sqlite.exec('ROLLBACK');throw error;}if(hooks.batch)await hooks.batch(items);return result;}};
  const objects=new Map();let puts=0;
  const files={async head(key){return objects.get(key)||null;},async get(key){const item=objects.get(key);return item?{...item,arrayBuffer:async()=>item.body.buffer}:null;},async list(){return {objects:[...objects.values()],truncated:false};},async put(key,value,options){puts++;if(hooks.put)await hooks.put(key);if(!objects.has(key)){const body=typeof value==='string'?new TextEncoder().encode(value):value;objects.set(key,{key,body,size:body.length,etag:key,uploaded:new Date(),customMetadata:options.customMetadata});}return objects.get(key);},async delete(key){if(hooks.delete)await hooks.delete(key);objects.delete(key);}};
  const h=harness(()=>null,async()=>new Response('{}'),{database:db,files,realStorage:true,environment:hooks.environment});
  return {sqlite,db,files,objects,load:h.load,puts:()=>puts};
}
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
function lease(f,source='cv',epoch=1){const runId=String(epoch).repeat(32),stamp=new Date().toISOString();f.sqlite.prepare("INSERT INTO update_runs(source,runId,leaseEpoch,started,heartbeat,outcome,phase) VALUES(?,?,?,?,?,'running','archiving') ON CONFLICT(source) DO UPDATE SET runId=excluded.runId,leaseEpoch=excluded.leaseEpoch,heartbeat=excluded.heartbeat,outcome='running'").run(source,runId,epoch,stamp,stamp);return {source,runId,leaseEpoch:epoch};}
test('late PUT settles only its operation after source takeover; publication stays fenced',async()=>{
  const started=deferred(),release=deferred(),f=storageFixture({put:async()=>{started.resolve();await release.promise;}}),owner=lease(f),storage=f.load('storage'),fence=f.load('database');
  const writing=fence.withFence(owner,()=>storage.putArchive('late','bytes'));await started.promise;lease(f,'cv',2);release.resolve();await assert.rejects(writing,/lease expired/);
  assert.equal(f.sqlite.prepare('SELECT inFlight FROM archive_writes').get().inFlight,0);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM archive_attempts').get().n,0);assert.equal((await storage.archiveAccounting()).bytes,5);
  f.sqlite.close();
});
test('uncertain attempt survives a successful immutable retry without a second charge',async()=>{
  let fail=true;const f=storageFixture({put:async()=>{if(fail)throw new Error('ambiguous transport');}}),storage=f.load('storage');
  await assert.rejects(storage.putArchive('uncertain','bytes'));fail=false;await storage.putArchive('uncertain','bytes');await storage.putArchive('uncertain','bytes');
  const status=await storage.archiveAccounting();assert.equal(status.bytes,5);assert.equal(status.unresolvedWrites,1);assert.equal(status.exact,false);assert.equal(f.sqlite.prepare('SELECT inFlight FROM archive_writes').get().inFlight,1);f.sqlite.close();
});
test('known failure before PUT dispatch settles its marker without pretending remote uncertainty',async()=>{
  let fail=true;const f=storageFixture({first:sql=>{if(fail&&sql==='SELECT id FROM archive_attempts WHERE id=?'){fail=false;throw new Error('read interrupted');}}}),storage=f.load('storage');
  await assert.rejects(storage.putArchive('nondispatch','bytes'));assert.equal(f.puts(),0);assert.equal(f.sqlite.prepare('SELECT inFlight FROM archive_writes').get().inFlight,0);assert.equal(f.sqlite.prepare('SELECT state FROM archive_writes').get().state,'failed');f.sqlite.close();
});
test('lost settlement acknowledgement and immutable retries never decrement twice',async()=>{
  let fail=true;const f=storageFixture({batch:items=>{if(fail&&items.some(x=>x.sql==='DELETE FROM archive_attempts WHERE id=? AND key=? AND kind=?')){fail=false;throw new Error('lost response');}}}),storage=f.load('storage');
  await assert.rejects(storage.putArchive('ack','bytes'));await storage.putArchive('ack','bytes');assert.equal((await storage.archiveAccounting()).bytes,5);assert.equal(f.sqlite.prepare('SELECT inFlight FROM archive_writes').get().inFlight,0);f.sqlite.close();
});
test('late completed DELETE keeps its key unavailable until its operation settles',async()=>{
  const started=deferred(),release=deferred(),f=storageFixture({delete:async()=>{started.resolve();await release.promise;}}),storage=f.load('storage'),fence=f.load('database');
  await storage.putArchive('delete','bytes');const owner=lease(f,'maintenance');
  const deleting=fence.withFence(owner,()=>storage.deleteArchives([{key:'delete',bytes:5}]));await started.promise;f.sqlite.exec("UPDATE update_runs SET heartbeat='2000-01-01' WHERE source='maintenance'");
  await assert.rejects(storage.putArchive('delete','bytes'),/cleanup is unresolved/);release.resolve();await assert.rejects(deleting,/lease expired/);
  assert.equal((await storage.archiveAccounting()).bytes,0);await storage.putArchive('delete','bytes');assert.equal((await storage.archiveAccounting()).bytes,5);f.sqlite.close();
});
test('archive scan rolls back page markers with a failed checkpoint',async()=>{
  const f=storageFixture(),owner=lease(f,'maintenance'),maintenance=f.load('maintenance'),fence=f.load('database');
  const invoke=cursor=>fence.withFence(owner,()=>maintenance.maintenanceAction({action:'maintenance-scan',...owner,cursor})).then(r=>r.json());
  assert.equal((await invoke('')).cursor,'registry:');
  f.objects.set('late-scan',{key:'late-scan',size:5,uploaded:new Date(),etag:'late-scan',body:new TextEncoder().encode('bytes'),customMetadata:{}});
  f.sqlite.exec("INSERT INTO archive_writes(key,hash,bytes,state,writeId,inFlight,created,updated) VALUES('late-scan','',5,'verified','write',0,'2026-01-01','2026-01-01')");
  f.sqlite.exec(`CREATE TRIGGER fail_checkpoint BEFORE UPDATE OF details ON update_runs WHEN NEW.details LIKE '%lastCursor":"registry:%' BEGIN SELECT RAISE(ABORT,'checkpoint outage'); END`);
  await assert.rejects(invoke('registry:'),/checkpoint outage/);assert.equal(f.sqlite.prepare("SELECT seenScan FROM archive_writes WHERE key='late-scan'").get().seenScan,null);
  f.sqlite.exec('DROP TRIGGER fail_checkpoint');const page=await invoke('registry:');assert.equal(page.accountedBytes,5);assert.equal(page.complete,true);assert.equal(f.sqlite.prepare("SELECT bytes FROM storage_usage WHERE id='r2'").get().bytes,5);f.sqlite.close();
});
test('legacy bulk catalogue references are recovered by generation and exact product hash',async()=>{
  const f=storageFixture(),storage=f.load('storage'),stamp='2026-09-08T00:00:00Z',product={id:'CA:123',name:'TEST'},data=JSON.stringify(product),digest=crypto.createHash('sha256').update(data).digest('hex'),raw=JSON.stringify([{product}]),archiveHash=crypto.createHash('sha256').update(raw).digest('hex'),key=`canada/catalogue/aaaaaaaaaaaaaaaa/${archiveHash}.json`;
  await storage.putArchive(key,raw);f.sqlite.prepare("INSERT INTO imports(id,source,state,cutoff,hash,manifest,created) VALUES('aaaaaaaaaaaaaaaa','dpd','active','2026-09-08',?,'{}',?)").run(digest,stamp);
  f.sqlite.prepare('INSERT INTO versions(id,productId,version,data,hash,observed) VALUES(?,?,?,?,?,?)').run('CA:123@'+stamp,'CA:123',stamp,JSON.stringify({productId:'CA:123',version:stamp,contentHash:digest}),digest,stamp);
  const owner=lease(f,'maintenance');await f.load('database').withFence(owner,()=>f.load('maintenance').maintenanceAction({action:'maintenance-catalogue-archives',...owner}));
  const version=JSON.parse(f.sqlite.prepare('SELECT data FROM versions').get().data);assert.equal(version.archiveKey,key);assert.equal(version.archiveHash,archiveHash);assert.equal(version.archiveStatus,'verified');f.sqlite.close();
});
test('unavailable R2 rehydration falls through to healthy upstream archive',async()=>{
  let requested=0;const bytes=require('fflate').zipSync({'label.xml':new TextEncoder().encode(fixture)});
  const h=harness(sql=>sql.includes('productId GLOB')?{data:JSON.stringify({archiveKey:'stored',archiveHash:'missing'})}:sql.startsWith('INSERT INTO source_budget')?{count:1}:null,async()=>{requested++;return new Response(bytes);},{files:{get:async()=>{throw new Error('R2 outage');}}});
  const parsed=h.load('core').parseSPL(fixture),value=await h.load('server').loadLabel(parsed.products[0].identifiers.setid,'8');assert.equal(value.value.version,'8');assert.equal(requested,1);
});
test('concurrent near-limit database writers cannot spend the same headroom',async()=>{
  const started=deferred(),release=deferred();let pause=true;
  const f=storageFixture({environment:{IMPORT_DATABASE_LIMIT_BYTES:'50000000'},batch:async items=>{if(pause&&items.some(x=>x.sql.startsWith('INSERT INTO products'))){pause=false;started.resolve();await release.promise;}}}),db=f.load('database').database();
  f.sqlite.exec("INSERT INTO storage_usage(id,bytes,initialized,updated) VALUES('d1',49800000,1,'2026-01-01')");
  const first=db.prepare('INSERT INTO products(id,data,observed) VALUES(?,?,?)').bind('CA:1','{}','2026-01-01').run();await started.promise;
  await assert.rejects(db.prepare('INSERT INTO products(id,data,observed) VALUES(?,?,?)').bind('CA:2','{}','2026-01-01').run(),/capacity/);
  release.resolve();await first;assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM products').get().n,1);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM database_reservations').get().n,0);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM capacity_guards').get().n,0);f.sqlite.close();
});
test('import reservations shrink only by observed transaction growth',async()=>{
  const f=storageFixture(),owner={...lease(f),generation:'a'.repeat(16)},fencing=f.load('database');
  f.sqlite.prepare("INSERT INTO imports(id,source,state,cutoff,hash,manifest,created,reservedBytes,ownerRunId,ownerEpoch) VALUES(?,'cv','staging','2026-01-01',?,'{}','2026-01-01',20000000,?,1)").run(owner.generation,'a'.repeat(64),owner.runId);
  const before=f.sqlite.prepare('PRAGMA page_count').get().page_count*4096;
  await fencing.withFence(owner,()=>fencing.database().prepare('INSERT INTO cv_products(gen,id,name,ingredients) VALUES(?,?,?,?)').bind(owner.generation,1,'A'.repeat(50000),'[]').run());
  const after=f.sqlite.prepare('PRAGMA page_count').get().page_count*4096,reserved=f.sqlite.prepare('SELECT reservedBytes FROM imports').get().reservedBytes;
  assert.ok(20000000-reserved<=after-before);assert.ok(reserved>19000000);f.sqlite.close();
});
test('cache bounds reject growth and protect the sole parsed historical copy',async()=>{
  const f=storageFixture({environment:{CACHE_LIMIT_ENTRIES:'10',CACHE_LIMIT_BYTES:'1500000'}}),cache=f.load('cache-policy'),stamp=Date.now();
  for(let i=0;i<11;i++)await cache.storeCache('ordinary:'+i,'{}',stamp,'rxnorm',1000);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM cache').get().n,10);
  await cache.storeCache('ordinary:0','{"new":true}',stamp,'rxnorm',1000);assert.equal(f.sqlite.prepare("SELECT value FROM cache WHERE key='ordinary:0'").get().value,'{"new":true}');
  f.sqlite.exec('DELETE FROM cache');f.sqlite.prepare('INSERT INTO cache(key,value,fetched,source,bytes,expires) VALUES(?,?,0,?,100,0)').run('spl:legacy:8',JSON.stringify({versions:[{id:'historic'}]}),'dailymed');
  await cache.storeCache('new','{}',stamp,'rxnorm',1000);assert.ok(f.sqlite.prepare("SELECT key FROM cache WHERE key='spl:legacy:8'").get());
  f.sqlite.prepare('INSERT INTO versions(id,productId,version,data,observed) VALUES(?,?,?,?,?)').run('historic','US:test:1','8',JSON.stringify({archiveStatus:'verified',archiveKey:'verified.xml'}),'2026-01-01');
  await cache.storeCache('new2','{}',stamp,'rxnorm',1000);assert.equal(f.sqlite.prepare("SELECT key FROM cache WHERE key='spl:legacy:8'").get(),undefined);assert.ok(f.sqlite.prepare("SELECT id FROM versions WHERE id='historic'").get());f.sqlite.close();
});

test('maintenance reconciliation cannot remove reservations committed after its size sample',async()=>{
  const started=deferred(),release=deferred();let pause=true;
  const f=storageFixture({all:async sql=>{if(pause&&sql.startsWith('SELECT id FROM database_reservations')){pause=false;started.resolve();await release.promise;}}}),owner=lease(f,'maintenance'),fencing=f.load('database');
  f.sqlite.exec("INSERT INTO database_reservations(id,bytes,created) VALUES('sampled',10000,'2026-01-01')");
  const scan=fencing.withFence(owner,()=>fencing.reconcileDatabaseReservations());await started.promise;
  f.sqlite.exec("INSERT INTO database_reservations(id,bytes,created) VALUES('newer',20000,'2026-01-01')");release.resolve();await scan;
  assert.deepEqual(f.sqlite.prepare('SELECT id FROM database_reservations ORDER BY id').all().map(x=>x.id),['newer']);f.sqlite.close();
});
