/* oxlint-disable typescript/no-require-imports, typescript/no-implied-eval -- Source adapters run in an isolated VM with deterministic network and storage fixtures. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto'),ts=require('typescript');
function harness(handler=()=>null,fetcher=async()=>new Response('{}')){
  const modules={},calls=[];
  const database={};
  database.prepare=sql=>{const make=(args=[])=>{const invoke=kind=>{calls.push({sql,args,kind});const value=handler(sql,args,kind);return value??(kind==='all'?{results:[],meta:{size_after:1000}}:kind==='run'?{meta:{size_after:1000,changes:1}}:null);};return {bind:(...next)=>make(next),first:async()=>invoke('first'),all:async()=>invoke('all'),run:async()=>invoke('run')};};return make();};
  database.batch=async items=>Promise.all(items.map(x=>x.run()));
  function load(file){file=file.replace(/\.ts$/,'');if(modules[file])return modules[file];const exports={};modules[file]=exports;
    const code=ts.transpileModule(fs.readFileSync(`lib/${file}.ts`,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    const req=id=>id==='cloudflare:workers'?{env:{DB:database}}:id==='./storage'?{putArchive:async()=>{},writeCapacity:async()=>{},reserveDatabase:async()=>()=>{},cacheWrite:async()=>{}}:id==='./updates'?{checkStatus:()=>({})}:id.startsWith('./')?load(id.slice(2)):require(id);
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
