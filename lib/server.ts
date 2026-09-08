/* oxlint-disable typescript/no-explicit-any -- Official sources have heterogeneous records; mappings explicitly normalize the fields used. */
import { env } from 'cloudflare:workers';
import { arr, normalize, parseSPL, sourceDate, unzipLabel } from './core';
import type { Product, ProductVersion, Result, SourceStatus } from './types';
import { sources } from './sources';
import { checkStatus, type UpdateRun } from './updates';

export const db=()=>env.DB;
export const now=()=>new Date().toISOString();
export async function hash(value:string|Uint8Array){const bytes=typeof value==='string'?new TextEncoder().encode(value):value;return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as BufferSource))].map(b=>b.toString(16).padStart(2,'0')).join('');}
export async function cached<T>(key:string,ttl:number,source:string,load:()=>Promise<T>):Promise<{value:T;fetched:string;stale:boolean}>{
  const existing=await db().prepare('SELECT value,fetched FROM cache WHERE key=?').bind(key).first<{value:string;fetched:number}>();
  if(existing&&Date.now()-existing.fetched<ttl)return {value:JSON.parse(existing.value),fetched:new Date(existing.fetched).toISOString(),stale:false};
  try{const value=await load(),serialized=JSON.stringify(value),stamp=Date.now();if(serialized.length<1_500_000)await db().prepare('INSERT INTO cache(key,value,fetched,source) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,fetched=excluded.fetched').bind(key,serialized,stamp,source).run();return{value,fetched:new Date(stamp).toISOString(),stale:false};}
  catch(error){if(existing)return{value:JSON.parse(existing.value),fetched:new Date(existing.fetched).toISOString(),stale:true};throw error;}
}
const allowed=new Set(['dailymed.nlm.nih.gov','rxnav.nlm.nih.gov','api.fda.gov','health-products.canada.ca']);
async function claimBudget(host:string){
  // Shared counters bound source requests across Worker instances, including retries.
  const limits=host==='api.fda.gov'?[[60000,30],[86400000,env.OPENFDA_API_KEY?5000:900]]:[[60000,120]];
  for(const [period,limit]of limits){const window=Math.floor(Date.now()/period);const row=await db().prepare('INSERT INTO source_budget(key,window,count) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET window=excluded.window,count=CASE WHEN source_budget.window=excluded.window THEN source_budget.count+1 ELSE 1 END WHERE source_budget.window<>excluded.window OR source_budget.count<? RETURNING count').bind(host+':'+period,window,limit).first();if(!row)throw new UpstreamError('This source request budget is reached. Try again after the current time window.',429);}
}
export async function fetchBytes(url:URL,limit=12*1024*1024):Promise<Uint8Array>{
  if(url.protocol!=='https:'||!allowed.has(url.hostname))throw new Error('Unsupported source.');
  if(url.hostname==='api.fda.gov'&&env.OPENFDA_API_KEY)url.searchParams.set('api_key',env.OPENFDA_API_KEY);
  for(let attempt=0;attempt<3;attempt++){
    await claimBudget(url.hostname);
    const response=await fetch(url,{headers:{Accept:'application/json,application/xml,application/zip'},signal:AbortSignal.timeout(25000),redirect:'manual'});
    if((response.status===429||response.status>=500)&&attempt<2){await response.body?.cancel();await new Promise(r=>setTimeout(r,Math.min(4000,1000*(attempt+1))));continue;}
    if(!response.ok){await response.body?.cancel();throw new UpstreamError(response.status===404?'No matching records were returned by this source.':`Source temporarily unavailable (HTTP ${response.status}).`,response.status);}
    if(Number(response.headers.get('content-length')||0)>limit){await response.body?.cancel();throw new Error('This source response is too large. Narrow your search.');}
    const reader=response.body?.getReader();if(!reader)throw new Error('The source returned an empty response.');
    const chunks:Uint8Array[]=[];let size=0;
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw new Error('This source response is too large. Narrow your search.');}chunks.push(value);}
    const result=new Uint8Array(size);let pos=0;for(const chunk of chunks){result.set(chunk,pos);pos+=chunk.length;}return result;
  }throw new Error('The source is temporarily unavailable.');
}
export class UpstreamError extends Error{constructor(message:string,public status:number){super(message);}}
// External JSON has heterogeneous source-owned fields; validate at each mapping boundary.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function jsonSource(source:string,base:string,params:Record<string,string|number>={},ttl=86400000):Promise<{value:any;fetched:string;stale:boolean}>{
  const url=new URL(base);for(const[k,v]of Object.entries(params))url.searchParams.set(k,String(v));const key=await hash(url.toString());
  return cached(key,ttl,source,async()=>JSON.parse(new TextDecoder().decode(await fetchBytes(url))));
}
export function result<T>(data:T,notes:string[]=[],complete:Result<T>['completeness']='complete'):Result<T>{return {data,notes,completeness:complete,fetchedAt:now()};}
export const labelLink=(id:string)=>`https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${id}`;
export async function saveProduct(p:Product){await db().prepare('INSERT INTO products(id,data,observed) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,observed=excluded.observed').bind(p.id,JSON.stringify(p),now()).run();}
export async function saveVersion(v:ProductVersion){await db().prepare('INSERT INTO versions(id,productId,version,data,hash,observed) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,hash=excluded.hash').bind(v.id,v.productId,v.version,JSON.stringify(v),v.contentHash||null,v.observedAt||now()).run();}
export async function loadLabel(setid:string,version?:string,force=false){
  if(!/^[a-f0-9-]{36}$/i.test(setid)||version&&!/^\d{1,9}$/.test(version))throw new Error('Invalid label identifier.');
  const key=`spl:${setid}:${version||'current'}`;
  return cached(key,force?0:version?365*86400000:86400000,'dailymed',async()=>{
    const url=version?new URL(`https://dailymed.nlm.nih.gov/dailymed/getFile.cfm?type=zip&setid=${setid}&version=${version}`):new URL(`https://dailymed.nlm.nih.gov/dailymed/services/v2/spls/${setid}.xml`);
    const bytes=await fetchBytes(url);const xml=version?unzipLabel(bytes):new TextDecoder().decode(bytes);const parsed=parseSPL(xml,setid);const contentHash=await hash(bytes);
    if(version&&parsed.version!==version)throw new Error('The archive version did not match the request.');
    await env.FILES.put(`labels/${setid}/${parsed.version}/${contentHash}.${version?'zip':'xml'}`,bytes,{httpMetadata:{contentType:version?'application/zip':'application/xml'},customMetadata:{source:url.toString(),fetchedAt:now(),sha256:contentHash}});
    for(const v of parsed.versions){v.contentHash=contentHash;v.observedAt=now();await saveVersion(v);}
    if(!version)for(const p of parsed.products)await saveProduct(p);
    return parsed;
  });
}
export async function searchUS(query:string,page:number):Promise<Result<Product[]>>{
  const params:Record<string,string|number>={pagesize:6,page};
  if(/^[\d-]{8,14}$/.test(query))params.ndc=query;else params.drug_name=query;
  const listing=await jsonSource('dailymed','https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.json',params);
  const entries=arr<Record<string,string>>(listing.value.data);const output:Product[]=[];const notes:string[]=[];
  // ponytail: three concurrent labels per batch; avoid a separate job queue for interactive lookup.
  for(let i=0;i<entries.length;i+=3){const settled=await Promise.allSettled(entries.slice(i,i+3).map(e=>loadLabel(e.setid)));settled.forEach((r,j)=>{if(r.status==='fulfilled'){for(const p of r.value.value.products)output.push(p);if(r.value.stale)notes.push('A saved label is shown because the latest source request failed.');}else notes.push(`One matching label could not be loaded: ${entries[i+j].title||'label'}.`);});}
  if(listing.stale)notes.push('Search results are from a previous successful source request.');
  return {...result(output,notes,notes.length?'partial':'complete'),fetchedAt:listing.fetched,page,hasMore:Number(listing.value.metadata?.total_pages)>page};
}
async function caEndpoint(name:string,params:Record<string,string|number>){return jsonSource('dpd',`https://health-products.canada.ca/api/drug/${name}/`,{...params,lang:'en',type:'json'});}
async function liveCaProduct(code:number):Promise<Product>{
  const [raw,active,form,route,status]=await Promise.all([caEndpoint('drugproduct',{id:code}),caEndpoint('activeingredient',{id:code}),caEndpoint('form',{id:code}),caEndpoint('route',{id:code}),caEndpoint('status',{id:code})]);
  if([raw,active,form,route,status].some(s=>s.stale))throw new Error('One or more Canadian product sections could not be refreshed.');
  const p=arr<any>(raw.value)[0];if(!p||p.class_name!=='Human')throw new Error('A matching human medication was not available.');
  const ingredients=arr<any>(active.value).map(a=>({name:String(a.ingredient_name||''),strength:[a.strength,a.strength_unit].filter(Boolean).join(' ')+(a.dosage_value&&a.dosage_unit?' / '+a.dosage_value+' '+a.dosage_unit:'')}));
  const product:Product={id:`CA:${code}`,name:p.brand_name,genericName:ingredients.map(i=>i.name).join(' / '),market:'CA',manufacturer:p.company_name||'Unknown',strength:ingredients.map(i=>i.strength).join(' / '),form:arr<any>(form.value).map(x=>x.pharmaceutical_form_name||x.dosage_form_name).filter(Boolean).join(', '),route:arr<any>(route.value).map(x=>x.route_of_administration_name).filter(Boolean).join(', '),identifiers:{drugCode:code,din:String(p.drug_identification_number)},ingredients,sourceUrl:`https://health-products.canada.ca/dpd-bdpp/info?lang=eng&code=${code}`,status:arr<any>(status.value).map(x=>x.status).filter(Boolean).join(', ')};
  await saveProduct(product);const contentHash=await hash(JSON.stringify(product));
  const previous=await db().prepare('SELECT hash FROM versions WHERE productId=? ORDER BY observed DESC LIMIT 1').bind(product.id).first<{hash:string}>();
  if(previous?.hash!==contentHash){const stamp=now();const v:ProductVersion={id:`${product.id}@${stamp}`,productId:product.id,version:stamp,observedAt:stamp,sourceUpdatedAt:sourceDate(p.last_update_date),active:ingredients,form:product.form,route:product.route,sourceUrl:product.sourceUrl,contentHash,completeness:'partial',notes:['Observed product snapshot. Source update dates are not formulation effective dates. Historical inactive ingredients and label sections are unavailable from this API.']};await saveVersion(v);await env.FILES.put(`canada/products/${code}/${contentHash}.json`,JSON.stringify({product,raw:raw.value,active:active.value,form:form.value,route:route.value,status:status.value}),{httpMetadata:{contentType:'application/json'},customMetadata:{fetchedAt:stamp}});}
  return product;
}
async function liveSearchCA(query:string,page:number):Promise<Result<Product[]>>{
  const notes:string[]=[];let items:any[]=[];
  const byName=await caEndpoint('drugproduct',/^\d{8}$/.test(query)?{din:query}:{brandname:query});items=arr<any>(byName.value).filter(p=>!String(p.class_name).match(/Veterinary|Disinfectant/i));
  if(!items.length&&!/^\d{8}$/.test(query)){const active=await caEndpoint('activeingredient',{ingredientname:query});const ids=[...new Set(arr<any>(active.value).map(x=>Number(x.drug_code)))];items=ids.map(drug_code=>({drug_code}));}
  const total=items.length;const slice=items.slice((page-1)*8,page*8);const data:Product[]=[];
  for(let i=0;i<slice.length;i+=2){const settled=await Promise.allSettled(slice.slice(i,i+2).map(x=>caProduct(Number(x.drug_code))));for(const s of settled){if(s.status==='fulfilled')data.push(s.value);else notes.push('One matching Canadian product could not be loaded.');}}
  if(byName.stale)notes.push('Showing the last successful Canadian source response.');
  return {...result(data,notes,notes.length?'partial':'complete'),page,hasMore:page*8<total};
}
export async function getProduct(id:string):Promise<Product>{
  if(!/^(CA:\d{1,10}|US:[a-f0-9-]{36}:[\d-]{4,16})$/i.test(id))throw new Error('Select a valid medication product.');
  const saved=await db().prepare('SELECT data,observed FROM products WHERE id=?').bind(id).first<{data:string;observed:string}>();if(saved&&Date.now()-Date.parse(saved.observed)<86400000)return {...JSON.parse(saved.data),observedAt:saved.observed};
  if(id.startsWith('CA:'))return caProduct(Number(id.split(':')[1]));
  const label=await loadLabel(id.split(':')[1]);const p=label.value.products.find(p=>p.id===id);if(!p)throw new Error('This product is absent from the current label.');return {...p,dataStatus:label.stale?'stale':'complete',observedAt:label.fetched};
}
export async function history(p:Product):Promise<Result<ProductVersion[]>>{
  if(p.market==='CA'){const rows=await db().prepare('SELECT data FROM versions WHERE productId=? ORDER BY observed DESC').bind(p.id).all<{data:string}>();return result(rows.results.map(r=>JSON.parse(r.data)),['Canadian history starts at the first observed snapshot. It is not a complete historical formulation archive.'],'partial');}
  const all:ProductVersion[]=[];let page=1,last=1,stamp=now();let stale=false;
  do{const r=await jsonSource('dailymed',`https://dailymed.nlm.nih.gov/dailymed/services/v2/spls/${p.identifiers.setid}/history.json`,{page,pagesize:100});stamp=r.fetched;stale||=r.stale;last=Number(r.value.metadata?.total_pages||1);for(const v of arr<any>(r.value.data?.history))all.push({id:`${p.id}@${v.spl_version}`,productId:p.id,version:String(v.spl_version),publishedAt:sourceDate(v.published_date),sourceUrl:`https://dailymed.nlm.nih.gov/dailymed/getFile.cfm?type=zip&setid=${p.identifiers.setid}&version=${v.spl_version}`,completeness:'partial'});page++;if(page>100)throw new Error('Label history exceeds the supported paging limit; consult the source archive.');}while(page<=last);
  return {...result(all,stale?['Showing cached history. The source could not be refreshed.']:[],stale?'stale':'complete'),fetchedAt:stamp,total:all.length};
}
export async function getVersion(p:Product,version:string):Promise<ProductVersion>{
  if(p.market==='CA'){const r=await db().prepare('SELECT data FROM versions WHERE productId=? AND version=?').bind(p.id,version).first<{data:string}>();if(!r)throw new Error('Snapshot unavailable.');return JSON.parse(r.data);}
  const parsed=await loadLabel(p.identifiers.setid!,version);const v=parsed.value.versions.find(v=>v.productId===p.id);if(!v)return{id:`${p.id}@${version}`,productId:p.id,version,sourceUrl:labelLink(p.identifiers.setid!),completeness:'unavailable',notes:['The selected product is absent from this archived version.']};return v;
}
export async function currentVersion(p:Product){if(p.market==='CA'){await caProduct(p.identifiers.drugCode!);const h=await history(p);return h.data[0];}const label=await loadLabel(p.identifiers.setid!);const v=label.value.versions.find(v=>v.productId===p.id);return v?{...v,observedAt:label.fetched,completeness:label.stale?'stale' as const:v.completeness}:undefined;}
export async function sourceStatuses():Promise<SourceStatus[]>{
  const state=await db().prepare('SELECT * FROM source_state').all<{id:string;generation:string;lastSuccess:string;coverage:string;error:string}>();
  const retrievals=await db().prepare('SELECT source,MAX(fetched) AS fetched FROM cache GROUP BY source').all<{source:string;fetched:number}>();
  const checks=await db().prepare('SELECT * FROM update_runs').all<UpdateRun>();
  return sources.map(s=>{
    const retrieved=retrievals.results.find(r=>r.source===s.id), current=state.results.find(r=>r.id===s.id), check=checks.results.find(r=>r.source===s.id);
    let item:SourceStatus={...s};
    if(retrieved)item.lastSuccessAt=new Date(retrieved.fetched).toISOString();
    if(current)item={...item,status:current.generation?'Imported dataset available':s.status,lastSuccessAt:current.lastSuccess||undefined,coverageThrough:current.coverage||undefined,lastError:current.error||undefined};
    else if(s.id==='cv')item.status='Dataset not imported yet';
    if(check)item={...item,...checkStatus(check)};
    return item;
  });
}
export async function aliases(p:Product):Promise<{terms:string[];rxcui?:string;history?:unknown}>{
  const terms=[p.name,p.genericName,...p.ingredients.flatMap(i=>[i.name,i.basis||''])].map(normalize).filter(Boolean);
  try{const r=await jsonSource('rxnorm','https://rxnav.nlm.nih.gov/REST/rxcui.json',{name:p.genericName||p.name,search:2});const ids=arr<string>(r.value.idGroup?.rxnormId);if(ids.length===1){const related=await jsonSource('rxnorm',`https://rxnav.nlm.nih.gov/REST/rxcui/${ids[0]}/related.json`,{tty:'IN PIN'});for(const g of arr<any>(related.value.relatedGroup?.conceptGroup))for(const x of arr<any>(g.conceptProperties))if(x.name)terms.push(normalize(x.name));const past=await jsonSource('rxnorm',`https://rxnav.nlm.nih.gov/REST/rxcui/${ids[0]}/historystatus.json`);return{terms:[...new Set(terms)],rxcui:ids[0],history:past.value.rxcuiStatusHistory};}}catch{/* Terminology is supplementary: product source remains authoritative. */}
  return {terms:[...new Set(terms)]};
}

export async function caProduct(code:number):Promise<Product>{
  try{return await liveCaProduct(code);}catch(error){const row=await db().prepare('SELECT data FROM products WHERE id=?').bind(`CA:${code}`).first<{data:string}>();if(row)return {...JSON.parse(row.data),dataStatus:'stale'};throw error;}
}
export async function searchCA(query:string,page:number):Promise<Result<Product[]>>{
  try{return await liveSearchCA(query,page);}catch(error){
    const needle='%'+query.replace(/[%_]/g,'')+'%';
    const sql="FROM products WHERE id LIKE 'CA:%' AND (json_extract(data,'$.name') LIKE ? OR json_extract(data,'$.genericName') LIKE ? OR json_extract(data,'$.identifiers.din')=?)";
    const count=await db().prepare('SELECT COUNT(*) AS n '+sql).bind(needle,needle,query).first<{n:number}>();
    const state=await db().prepare("SELECT lastSuccess,coverage FROM source_state WHERE id='dpd'").first<{lastSuccess:string;coverage:string}>();
    if(!state?.lastSuccess)throw error;
    const rows=await db().prepare('SELECT data '+sql+` ORDER BY json_extract(data,'$.name'),id LIMIT 8 OFFSET ?`).bind(needle,needle,query,(page-1)*8).all<{data:string}>();
    return {...result(rows.results.map(r=>JSON.parse(r.data)),['The live Canadian service could not be reached. Showing the last successfully imported product snapshot.'],'stale'),fetchedAt:state.lastSuccess,sourceAsOf:state.coverage,total:count?.n||0,page,hasMore:page*8<(count?.n||0)};
  }
}
