/* oxlint-disable typescript/no-require-imports, typescript/no-implied-eval -- Isolated audit harness transpiles repository modules into CommonJS and evaluates them with mocked source/storage dependencies. */
const fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const root=process.cwd();
const projectRequire=require('node:module').createRequire(root+'/package.json');
const ts=projectRequire('typescript');
let db, fetchImpl;
const modules={};
function load(file){
 if(modules[file])return modules[file];
 const exports={};modules[file]=exports;
 const code=ts.transpileModule(fs.readFileSync(root+'/lib/'+file+'.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const req=(id)=>id==='cloudflare:workers'?{env:{get DB(){return db;}}}:id==='./storage'?{putArchive:async()=>{}}:id==='./updates'?{checkStatus:()=>({})}:id.startsWith('./')?load(id.slice(2)):projectRequire(id);
 vm.runInNewContext(code,{exports,require:req,crypto:crypto.webcrypto,fetch:(...x)=>fetchImpl(...x),Date,URL,TextEncoder,TextDecoder,Response,AbortSignal,Uint8Array,Buffer,setTimeout:(f)=>setTimeout(f,0)}, {filename:file+'.ts'});
 return exports;
}
const core=load('core'),server=load('server'),evidence=load('evidence');
const fixture=fs.readFileSync(root+'/tests/fixtures/sertraline-v8.xml','utf8');
const parsed=core.parseSPL(fixture),prod=parsed.products[0],setid=prod.identifiers.setid;
function database({cached={},products={},reportRows=[]}={}){
 const calls=[];
 return {calls,prepare(sql){return{first:async()=>{calls.push({sql,args:[],kind:"first"});if(sql.includes("FROM source_state"))return{generation:"generation",coverage:"2026-05-31",lastSuccess:"2026-06-01"};return null;},bind(...args){
 const invoke=(kind)=>{calls.push({sql,args,kind});
 if(sql.startsWith('SELECT value,fetched FROM cache'))return cached[args[0]]||null;
 if(sql.startsWith('SELECT data,observed FROM products'))return products[args[0]]||null;
 if(sql==='SELECT data FROM products WHERE id=?')return products[args[0]]||null;
 if(sql.startsWith('INSERT INTO source_budget'))return{count:1};
 if(sql.includes("FROM source_state WHERE id='cv'"))return{generation:'generation',coverage:'2026-05-31',lastSuccess:'2026-06-01'};
 if(sql.startsWith('SELECT id FROM cv_products'))return{results:args.slice(1).map(id=>({id}))};
 if(sql.startsWith('SELECT id,ingredients FROM cv_products'))return{results:args.slice(1).map(id=>({id,ingredients:'["SERTRALINE"]'}))};
 if(sql.startsWith('SELECT COUNT(*) AS n FROM cv_reports'))return{n:reportRows.length};
 if(sql.startsWith('SELECT r.* FROM cv_reports'))return{results:reportRows};
 if(sql.startsWith('SELECT name,role'))return{results:[{name:'SERTRALINE',role:'Suspect'}]};
 if(sql.startsWith('SELECT DISTINCT term'))return{results:[{term:'HEADACHE'}]};
 if(sql.startsWith('SELECT target,kind'))return{results:[]};
 if(sql.startsWith('SELECT x.term'))return{results:[{term:'HEADACHE',count:25}]};
 return kind==='all'?{results:[]}:null;};
 return{first:async()=>invoke('first'),all:async()=>invoke('all'),run:async()=>invoke('run')};}}}};
}
(async()=>{
 db=database();fetchImpl=async url=>new Response(JSON.stringify(url.pathname.endsWith('spls.json')?{data:[{setid,title:'SERTRALINE'}],metadata:{total_pages:1}}:{}));
 fetchImpl=async url=>url.pathname.endsWith('.xml')?new Response(fixture):new Response(JSON.stringify({data:[{setid,title:'SERTRALINE'}],metadata:{total_pages:1}}));
 const duplicates=core.distinctPairMatches([{name:'COMBO',ingredients:['A','B']},{name:'COMBO',ingredients:['A','B']}],['A'],['B']);
 console.log(JSON.stringify({test:'duplicate fixed-combination rows satisfy two-medicine pair',matched:duplicates}));
 const exact=await server.searchUS(prod.identifiers.ndc,1);
 console.log(JSON.stringify({test:'exact NDC search returns other strengths',query:prod.identifiers.ndc,products:exact.data.map(p=>({ndc:p.identifiers.ndc,strength:p.strength})),completeness:exact.completeness}));
 const savedCa={id:'CA:123',name:'SERTRALINE',genericName:'SERTRALINE',market:'CA',manufacturer:'TEST',strength:'50 mg',form:'Tablet',route:'ORAL',identifiers:{drugCode:123,din:'00000123'},ingredients:[{name:'SERTRALINE',strength:'50 mg'}],sourceUrl:'https://health-products.canada.ca/dpd-bdpp/info?lang=eng&code=123'};
 db=database({products:{'CA:123':{data:JSON.stringify(savedCa),observed:new Date(Date.now()-2*864e5).toISOString()}}});
 fetchImpl=async url=>url.searchParams.has('brandname')?new Response(JSON.stringify([{drug_code:123,class_name:'Human'}])):new Response('Unavailable',{status:503});
 const ca=await server.searchCA('SERTRALINE',1);
 console.log(JSON.stringify({test:'stale Canadian product search',completeness:ca.completeness,notes:ca.notes,productStatus:ca.data[0].dataStatus,fetchedAt:ca.fetchedAt}));
 db=database({cached:{[`spl:${setid}:8`]:{value:JSON.stringify(parsed),fetched:Date.now()-400*864e5}}});
 fetchImpl=async()=>new Response('Unavailable',{status:503});
 const version=await server.getVersion(prod,'8');
 console.log(JSON.stringify({test:'stale archive status',completeness:version.completeness,notes:version.notes}));
 db=database({products:{[prod.id]:{data:JSON.stringify(prod),observed:new Date(Date.now()-2*864e5).toISOString()}}});
 fetchImpl=async()=>new Response(fixture.replace(prod.identifiers.ndc,'99999-9999'));
 try{await server.getProduct(prod.id);console.log('Unexpected success')}catch(err){console.log(JSON.stringify({test:'historical product removed from current SPL',savedId:prod.id,error:err.message}));}
 db=database({reportRows:Array.from({length:25},(_,i)=>({id:i+1,version:1,received:'2026-01-01',updated:'2026-01-02',serious:1,outcomes:'[]'}))});
 const reports=await evidence.caReports([savedCa],{source:'CA',page:1,cvIds:[['1']]});
 console.log(JSON.stringify({test:'Canadian report page query count',rows:reports.data.length,d1Calls:db.calls.length,reportHydrationCalls:db.calls.filter(c=>/^(SELECT name,role|SELECT DISTINCT term|SELECT target,kind)/.test(c.sql)).length}));
 db=database();let eventSearch;fetchImpl=async url=>{if(url.hostname==='rxnav.nlm.nih.gov')return new Response('{}');eventSearch=url.searchParams.get('search');return new Response(JSON.stringify({results:[],meta:{results:{total:0}}}));};
 await evidence.usReports([prod],{source:'US',page:1});console.log(JSON.stringify({test:'FDA report query raw-name coverage',includesReportedMedicinalProduct:eventSearch.includes('medicinalproduct'),search:eventSearch}));
 db=database();fetchImpl=async url=>url.hostname==='rxnav.nlm.nih.gov'?new Response('{}'):new Response(JSON.stringify({results:url.searchParams.has('count')?[]:[{safetyreportid:'12345',safetyreportversion:'2',duplicate:'1',reportduplicate:[{duplicatesource:'Regulator',duplicatenumb:'OTHER-123'}],patient:{drug:[{medicinalproduct:'SERTRALINE',openfda:{generic_name:['SERTRALINE']}}]}}],meta:{results:{total:1}}}));
 const dupReport=await evidence.usReports([prod],{source:'US',page:1});console.log(JSON.stringify({test:'FDA source duplicate reference preserved',duplicateLinks:dupReport.data[0].duplicateLinks}));
 // RxNorm is supplementary; a failed label must not hide another product's readable warnings.
 const other={...prod,id:prod.id.replace(setid,'11111111-1111-1111-1111-111111111111'),identifiers:{...prod.identifiers,setid:'11111111-1111-1111-1111-111111111111'}};
 db=database({cached:{[`spl:${setid}:current`]:{value:JSON.stringify(parsed),fetched:Date.now()}}});
 fetchImpl=async url=>url.hostname==='rxnav.nlm.nih.gov'?new Response('{}'):new Response('Unavailable',{status:503});
 try{await evidence.evidence([prod,other]);console.log('Unexpected success')}catch(err){console.log(JSON.stringify({test:'pair evidence one source unavailable',firstProductAvailable:true,error:err.message}));}
})().catch(err=>{console.error(err);process.exitCode=1;});
