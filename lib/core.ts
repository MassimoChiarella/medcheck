import { XMLParser } from 'fast-xml-parser';
import { unzipSync, strFromU8 } from 'fflate';
import type { Change, Ingredient, Product, ProductVersion, ReportSummary } from './types';

type Node = { tag: string; attrs: Record<string,string>; children: Node[]; text?: string };
const arr = <T>(v:T|T[]|undefined):T[]=>v===undefined?[]:Array.isArray(v)?v:[v];
export const normalize = (s:string)=>s.normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleUpperCase('en-US');
export function sourceDate(s?:string):string|undefined {
  if(!s)return undefined;
  if(/^\d{8}$/.test(s))return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
  const d=new Date(s);return Number.isNaN(d.getTime())?undefined:d.toISOString().slice(0,10);
}
export function unzipLabel(bytes:Uint8Array):string {
  let size=0;
  const files=unzipSync(bytes,{filter:file=>{
    if(!/\.xml$/i.test(file.name))return false;
    size+=file.originalSize;if(size>8*1024*1024)throw new Error('Archived XML exceeds the safe processing limit.');return true;
  }});
  const xml=Object.values(files);if(xml.length!==1)throw new Error('Archive does not contain one identifiable SPL XML document.');return strFromU8(xml[0]);
}
function tree(raw:Record<string,unknown>[]):Node[]{
  return raw.flatMap(entry=>Object.entries(entry).filter(([k])=>k!==':@').map(([tag,value])=>({tag,attrs:entry[':@'] as Record<string,string>||{},children:Array.isArray(value)?tree(value as Record<string,unknown>[]):[],...(tag==='#text'?{text:String(value)}:{})})));
}
function descendants(n:Node,tag:string):Node[]{return [...(n.tag===tag?[n]:[]),...n.children.flatMap(c=>descendants(c,tag))];}
function child(n:Node|undefined,tag:string):Node|undefined{return n?.children.find(c=>c.tag===tag);}
function text(n:Node|undefined):string {if(!n)return '';if(n.tag==='#text')return n.text||'';return n.children.map(c=>text(c)).join(['paragraph','item','tr','td','th','title','section','br'].includes(n.tag)?'\n':' ').replace(/[ \t]+/g,' ').replace(/\n\s*\n/g,'\n').trim();}
function quantity(n:Node|undefined):string|undefined{if(!n)return undefined;const a=child(n,'numerator')?.attrs,b=child(n,'denominator')?.attrs;if(!a?.value)return undefined;const numerator=[a.value,a.unit==='1'?'':a.unit].filter(Boolean).join(' ');const denominator=b?.value&&!(b.value==='1'&&(!b.unit||b.unit==='1'))?[b.value,b.unit].filter(v=>v&&v!=='1').join(' '):'';return denominator?`${numerator} / ${denominator}`:numerator;}
export type ParsedSPL = { products:Product[]; versions:ProductVersion[]; version:string; effectiveAt?:string; sections:Record<string,string> };
export function parseSPL(xml:string, expectedSetid?:string):ParsedSPL {
  if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw new Error('Unsupported XML entity declaration.');
  const parser=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'',removeNSPrefix:true,preserveOrder:true,parseTagValue:false,trimValues:false,processEntities:true});
  const root=tree(parser.parse(xml)).find(n=>n.tag==='document');if(!root)throw new Error('Not a structured product label.');
  const setid=child(root,'setId')?.attrs.root||'';if(expectedSetid&&normalize(expectedSetid)!==normalize(setid))throw new Error('Label identity did not match the requested product.');
  const version=child(root,'versionNumber')?.attrs.value||'';
  const effectiveAt=sourceDate(child(root,'effectiveTime')?.attrs.value);
  const author=child(root,'author');const manufacturer=author?text(descendants(author,'representedOrganization').map(n=>child(n,'name')).find(Boolean)):'Unknown labeler';
  const sectionCodes:Record<string,string>={'34073-7':'Drug interactions','34070-3':'Contraindications','43685-7':'Warnings and precautions','34071-1':'Warnings','34072-9':'Precautions','34066-1':'Boxed warning','34067-9':'Indications and usage','34084-4':'Adverse reactions','34069-5':'How supplied','34089-3':'Description'};
  const sections:Record<string,string>={};
  for(const s of descendants(root,'section')){const name=sectionCodes[child(s,'code')?.attrs.code||''];if(name){const narrative=(n:Node):string=>[text(child(n,'title')),text(child(n,'text')),...n.children.filter(c=>c.tag==='component').flatMap(c=>c.children.filter(k=>k.tag==='section').map(narrative))].filter(Boolean).join('\n\n');const value=narrative(s);if(value)sections[name]=value;}}
  const products:Product[]=[],versions:ProductVersion[]=[];const seen=new Set<string>();
  if(!normalize(child(root,'code')?.attrs.displayName||'').startsWith('HUMAN'))return {products,versions,version,effectiveAt,sections};
  for(const outer of descendants(root,'manufacturedProduct')){
    const p=child(outer,'manufacturedProduct');if(!p)continue;
    const ndc=child(p,'code')?.attrs.code;if(!ndc||seen.has(ndc))continue;seen.add(ndc);
    const ingredients=p.children.filter(c=>c.tag==='ingredient');
    const convert=(i:Node):Ingredient=>{const s=child(i,'ingredientSubstance');const moiety=child(child(s,'activeMoiety'),'activeMoiety');return {name:text(child(s,'name')),code:child(s,'code')?.attrs.code,strength:quantity(child(i,'quantity')),basis:i.attrs.classCode==='ACTIM'?text(child(moiety,'name'))||undefined:undefined,basisCode:i.attrs.classCode==='ACTIM'?child(moiety,'code')?.attrs.code:undefined};};
    const active=ingredients.filter(i=>(i.attrs.classCode||'').startsWith('ACTI')).map(convert);
    const inactive=ingredients.filter(i=>i.attrs.classCode==='IACT').map(convert);
    const route=descendants(outer,'routeCode').map(n=>n.attrs.displayName).filter(Boolean).join(', ');
    const form=child(p,'formCode')?.attrs.displayName||'';
    const id=`US:${setid}:${ndc}`;const sourceUrl=`https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${setid}`;
    const genericName=text(child(child(p,'asEntityWithGeneric'),'genericMedicine'))||active.map(i=>i.name).join(' / ');
    const prod:Product={id,name:text(child(p,'name'))||genericName,genericName,market:'US',manufacturer,strength:active.map(i=>i.strength||'Not listed').join(' / '),form,route,identifiers:{ndc,setid},ingredients:active,sourceUrl};products.push(prod);
    versions.push({id:`${id}@${version}`,productId:id,version,effectiveAt,sourceUrl:`https://dailymed.nlm.nih.gov/dailymed/getFile.cfm?type=zip&setid=${setid}&version=${version}`,active:active.length?active:undefined,inactive:inactive.length?inactive:undefined,form,route,sections,completeness:active.length?'complete':'partial',notes:inactive.length?[]:['Inactive ingredients were not available in a structured section.']});
  }
  return {products,versions,version,effectiveAt,sections};
}
const ingredientText=(v:Ingredient[])=>[...v].sort((a,b)=>normalize(a.name).localeCompare(normalize(b.name))).map(i=>`${i.name}${i.code?' [UNII '+i.code+']':''}${i.basisCode?' [basis UNII '+i.basisCode+']':''}${i.strength?' · '+i.strength+(i.basis?' (as '+i.basis+')':''):''}`).join('\n');
export function compareVersions(before:ProductVersion,after:ProductVersion):{changes:Change[];notes:string[]}{
  if(before.productId!==after.productId)throw new Error('Version comparisons require the same exact product.');
  const changes:Change[]=[],notes:string[]=[];
  if(before.completeness==='unavailable'||after.completeness==='unavailable')return {changes,notes:['One selected product archive is unavailable; differences cannot be established.']};
  for(const [key,category]of[['active','active ingredients'],['inactive','inactive ingredients']] as const){
    const a=before[key],b=after[key];if(!a||!b){notes.push(`${category[0].toUpperCase()+category.slice(1)} cannot be compared because one version lacks structured information.`);continue;}
    if(normalize(ingredientText(a))!==normalize(ingredientText(b)))changes.push({category,field:'Listed '+category,before:ingredientText(a),after:ingredientText(b),explanation:'The published listing changed. This alone does not confirm a manufacturing or formulation change.'});
  }
  for(const key of ['form','route'] as const)if(before[key]&&after[key]&&normalize(before[key]!)!==normalize(after[key]!))changes.push({category:'form / route',field:key,before:before[key]!,after:after[key]!,explanation:'A change in the published product description.'});
  const names=new Set([...Object.keys(before.sections||{}),...Object.keys(after.sections||{})]);
  for(const field of names){const a=before.sections?.[field],b=after.sections?.[field];if(!a||!b){notes.push(`${field}: one version has no readable section; omission is not treated as removal.`);continue;}if(normalize(a)!==normalize(b))changes.push({category:['Description','How supplied','Indications and usage'].includes(field)?'packaging / administrative':'safety wording',field,before:a,after:b,explanation:'Label text changed; review the source wording and dates.'});}
  if(before.version!==after.version)changes.push({category:'packaging / administrative',field:'Label version metadata',before:'Version '+before.version+' · Effective '+(before.effectiveAt||'not stated'),after:'Version '+after.version+' · Effective '+(after.effectiveAt||'not stated'),explanation:'Source version metadata changed. This does not establish a formulation change.'});
  if(!changes.length&&!notes.length)notes.push('No differences were found in the structured ingredients and extracted sections. Other document content may have changed.');
  return {changes,notes};
}
// A single component must not stand in for a fixed-combination product.
export function reportAliases(product:Product,terms:string[]):string[]{
  return [...new Set((product.ingredients.length>1?[product.name,product.genericName]:terms).map(normalize).filter(Boolean))];
}

export function distinctPairMatches(drugs:{ingredients?:string[];name:string}[],left:string[],right:string[]):boolean{
  const l=new Set(left.map(normalize)),r=new Set(right.map(normalize));if([...l].some(x=>r.has(x)))return false;
  const matches=(d:typeof drugs[number],terms:Set<string>)=>[...(d.ingredients||[]),d.name].some(x=>terms.has(normalize(x)));
  return drugs.some((a,i)=>matches(a,l)&&drugs.some((b,j)=>i!==j&&matches(b,r)));
}
export function latestCases(reports:ReportSummary[]):ReportSummary[]{const map=new Map<string,ReportSummary>();for(const r of reports){const key=`${r.authority}:${r.id}`,old=map.get(key);if(!old||Number(r.version)>Number(old.version))map.set(key,r);}return [...map.values()];}
export { arr };
