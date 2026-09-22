/* oxlint-disable typescript/no-implied-eval -- Isolated audit harness evaluates transpiled repository handlers with an in-memory database and mocked R2. */
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
const root=process.cwd();
const ts=createRequire(root+'/package.json')('typescript');
function moduleFunctions(file,deps,names) {
  let source=readFileSync(`${root}/${file}`,'utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
  source=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  return new Function(...Object.keys(deps),source+`\nreturn {${names.join(',')}};`)(...Object.values(deps));
}
const sqlite=new DatabaseSync(':memory:');
for(const name of ['0000_illegal_goliath','0001_milky_wither','0002_sticky_mysterio','0003_warm_whiplash','0004_sweet_madame_hydra','0005_graceful_scarecrow']) sqlite.exec(readFileSync(`${root}/drizzle/${name}.sql`,'utf8'));
let physicalBytes=100_000;
const DB={prepare(sql){let values=[]; return {bind(...args){values=args;return this;},async first(){return sqlite.prepare(sql).get(...values)||null;},async all(){return {results:sqlite.prepare(sql).all(...values),meta:{size_after:physicalBytes}};},async run(){const r=sqlite.prepare(sql).run(...values);return {meta:{changes:Number(r.changes),size_after:physicalBytes}};}};}, async batch(statements){sqlite.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
const env={DB,IMPORT_TOKEN:'x'.repeat(32),IMPORT_DATABASE_LIMIT_BYTES:'8000000000'};
const db=()=>DB,now=()=>new Date().toISOString(),hash=async x=>createHash('sha256').update(x).digest('hex');
const updates=moduleFunctions('lib/updates.ts',{db,now},['checkAction','noMaintenance','UpdateConflict','CHECK_LEASE_MS']);
const storage=moduleFunctions('lib/storage.ts',{db,env,...updates},['capacity','estimatedImportBytes','writeCapacity','putArchive']);
const {POST}=moduleFunctions('app/api/import/route.ts',{db,env,now,hash,...updates,...storage,maintenanceAction:async()=>null,refreshAction:async()=>null,protectedImports:async()=>[]},['POST']);
async function send(b){const r=await POST(new Request('http://isolated/api/import',{method:'POST',headers:{Authorization:`Bearer ${env.IMPORT_TOKEN}`},body:JSON.stringify(b)}));const data=await r.json();if(r.status!==200)throw new Error(JSON.stringify(data));return data;}
const rows={cv_products:[[1,'A','["A"]']],cv_reports:[[1,'CASE',1,'2026-01-01','2026-01-01',1,'[]']],cv_report_drugs:[[1,1,1,'A','Suspect']],cv_reactions:[[1,1,'Reaction']],cv_links:[[1,1,'CASE2','Linked']]};
async function stage(id,cutoff){await send({action:'begin',id,cutoff,hash:id.repeat(4),bytes:1000,manifest:Object.fromEntries(Object.keys(rows).map(t=>[t,1]))});for(const [table,data]of Object.entries(rows))await send({action:'batch',id,table,batch:0,rows:data});}
const runA='a'.repeat(32),runB='b'.repeat(32),genA='1'.repeat(16),genB='2'.repeat(16);
await send({action:'check-begin',source:'cv',runId:runA});
await stage(genA,'2026-05-31');
sqlite.exec("UPDATE update_runs SET heartbeat='2000-01-01T00:00:00Z' WHERE source='cv'");
await send({action:'check-begin',source:'cv',runId:runB});
await stage(genB,'2026-06-30');
await send({action:'promote',id:genB,source:'cv',runId:runB});
console.log('new owner published',sqlite.prepare("SELECT generation,coverage FROM source_state WHERE id='cv'").get());
await send({action:'promote',id:genA,source:'cv',runId:runA});
console.log('expired old owner then published',sqlite.prepare("SELECT generation,coverage FROM source_state WHERE id='cv'").get());
// Demonstrate unchanged read cache can still write while explicit capacity guard refuses growth.
const server=moduleFunctions('lib/server.ts',{env,putArchive:storage.putArchive,sources:[],arr:()=>[],normalize:()=>'',parseSPL:()=>{},sourceDate:()=>{},unzipLabel:()=>{},checkStatus:()=>{},isMedicationNameQuery:()=>false,spellingCandidates:()=>[]},['cached','saveProduct']);
env.IMPORT_DATABASE_LIMIT_BYTES='50000000';physicalBytes=50_000_000;
try {await storage.writeCapacity();console.log('UNEXPECTED capacity admitted');}catch(e){console.log('capacity guard',e.message);}
await server.cached('audit-at-capacity',1000,'audit',async()=>({data:'fresh value'}));
console.log('cache write still accepted',Boolean(sqlite.prepare("SELECT 1 FROM cache WHERE key='audit-at-capacity'").get()));
await server.saveProduct({id:'CA:1',name:'Audit product'});
console.log('product write still accepted',Boolean(sqlite.prepare("SELECT 1 FROM products WHERE id='CA:1'").get()));
const failingArchiveServer=moduleFunctions('lib/server.ts',{env,putArchive:async()=>{throw new Error('Simulated R2 failure');},sources:[],arr:x=>Array.isArray(x)?x:x?[x]:[],normalize:x=>x,parseSPL:()=>{},sourceDate:x=>x,unzipLabel:()=>{},checkStatus:()=>{},isMedicationNameQuery:()=>false,spellingCandidates:()=>[]},['caProduct']);
const priorFetch=globalThis.fetch;
globalThis.fetch=async(url)=>{
 const name=new URL(url).pathname.split('/')[3];
 const fixtures={drugproduct:[{drug_code:987,brand_name:'AUDIT',class_name:'Human',company_name:'Manufacturer',drug_identification_number:'00000987',last_update_date:'2026-09-01'}],activeingredient:[{ingredient_name:'A',strength:'1',strength_unit:'mg'}],form:[{pharmaceutical_form_name:'Tablet'}],route:[{route_of_administration_name:'Oral'}],status:[{status:'Marketed'}]};
 return Response.json(fixtures[name]);
};
try {
 const product=await failingArchiveServer.caProduct(987);
 console.log('R2 outage returned product status',product.dataStatus);
 console.log('unarchived Canadian version committed',sqlite.prepare("SELECT COUNT(*) AS n FROM versions WHERE productId='CA:987'").get().n);
} finally {globalThis.fetch=priorFetch;}
let recoveredWrites=0;
const recoveredArchiveServer=moduleFunctions('lib/server.ts',{env,putArchive:async()=>{recoveredWrites++;},sources:[],arr:x=>Array.isArray(x)?x:x?[x]:[],normalize:x=>x,parseSPL:()=>{},sourceDate:x=>x,unzipLabel:()=>{},checkStatus:()=>{},isMedicationNameQuery:()=>false,spellingCandidates:()=>[]},['caProduct']);
await recoveredArchiveServer.caProduct(987); // five source responses remain in the ordinary cache
console.log('archive retries after R2 recovery',recoveredWrites);
// Reservations from failed R2 puts never reconcile downward, even during an exclusive full audit.
env.IMPORT_ARCHIVE_LIMIT_BYTES='10000000';
env.FILES={head:async()=>null,list:async()=>({objects:[],truncated:false}),put:async()=>{throw new Error('Simulated R2 write failure');}};
for(let i=0;i<2;i++){try{await storage.putArchive(`failed-${i}`,new Uint8Array(4_000_000));}catch{}}
console.log('archive meter after failed writes',JSON.parse(sqlite.prepare("SELECT value FROM cache WHERE key='storage:r2'").get().value).bytes);
await send({action:'check-finish',source:'cv',runId:runB,outcome:'failed'});
const maintenance=moduleFunctions('lib/maintenance.ts',{env,db,now,...updates,archiveLimit:()=>10_000_000,capacity:storage.capacity,artifactCandidate:()=>null,RETENTION_GRACE_MS:7*86400000},['maintenanceAction']);
const maintenanceId='c'.repeat(32);
await send({action:'check-begin',source:'maintenance',runId:maintenanceId});
const scan=await maintenance.maintenanceAction({action:'maintenance-scan',source:'maintenance',runId:maintenanceId,dryRun:false});
console.log('exclusive scan actual archive bytes',(await scan.json()).archiveBytes);
console.log('archive meter after exclusive full audit',JSON.parse(sqlite.prepare("SELECT value FROM cache WHERE key='storage:r2'").get().value).bytes);
