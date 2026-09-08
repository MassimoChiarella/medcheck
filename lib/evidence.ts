/* oxlint-disable typescript/no-explicit-any -- Official sources have heterogeneous records; mappings explicitly normalize the fields used. */
import type { EvidenceItem, Product, ReportResult, ReportSummary } from './types';
import { arr, distinctPairMatches, latestCases, normalize, reportAliases, sourceDate } from './core';
import { aliases, currentVersion, db, jsonSource, now, result, UpstreamError } from './server';
import { reportCaveat, canadaCaveat } from './sources';

export async function evidence(products:Product[]){
  const data:EvidenceItem[]=[];const notes:string[]=[];const terms=await Promise.all(products.map(aliases));
  for(let i=0;i<products.length;i++){
    const p=products[i];const version=await currentVersion(p);
    if(p.market==='CA'){notes.push(`${p.name}: Canadian product monographs are linked from the official product page. The product API does not supply interaction text; US labeling is not substituted for Canadian labeling.`);continue;}
    for(const title of ['Boxed warning','Drug interactions','Contraindications','Warnings and precautions','Warnings','Precautions','Adverse reactions']){
      const passage=version?.sections?.[title];if(!passage){notes.push(`${p.name}: ${title.toLowerCase()} could not be extracted.`);continue;}
      const other=products.length===2?terms[1-i].terms:[];const matched=other.filter(term=>term.length>2&&new RegExp(`(^|[^A-Z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}([^A-Z0-9]|$)`,'i').test(passage));
      data.push({id:`${p.id}:${title}`,source:'DailyMed',title,text:passage,sourceUrl:version!.sourceUrl,productId:p.id,version:version!.version,effectiveAt:version!.effectiveAt,observedAt:version!.observedAt||now(),market:'US',authority:'US labeling',completeness:version!.completeness==='stale'?'stale':'partial',matchedTerms:matched});
    }
  }
  notes.push('Label sections can cover several strengths or products within the same SPL document. Read the surrounding wording to establish which product a warning concerns.');
  notes.push('Highlighted names are text matches, not a clinical interaction assessment. Class-level references may not name a selected medication. No match does not mean safe together.');
  const stale=data.some(d=>d.completeness==='stale');if(stale)notes.push('A previous label snapshot is shown because the latest source request failed.');return {...result(data,notes,stale?'stale':'partial'),fetchedAt:data.map(d=>d.observedAt).sort()[0]||now(),terminology:terms};
}
function quote(s:string){return '"'+s.replace(/["\\]/g,' ').trim()+'"';}
export type ReportFilters={source:'US'|'CA';from?:string;to?:string;reaction?:string;serious?:string;page:number;cvIds?:string[][]};
function iso(s?:string){if(!s)return undefined;if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||Number.isNaN(Date.parse(s))||new Date(s).toISOString().slice(0,10)!==s)throw new Error('Use a valid calendar date.');return s.replaceAll('-','');}
const outcomeNames:Record<string,string>={'1':'Recovered','2':'Recovering','3':'Not recovered','4':'Recovered with sequelae','5':'Fatal outcome reported','6':'Unknown outcome'};
function fdaReport(r:any):ReportSummary{
  return{id:String(r.safetyreportid),version:String(r.safetyreportversion||'1'),authority:'FDA',eventCountry:r.occurcountry||undefined,reporterCountry:r.primarysource?.reportercountry||undefined,receivedAt:sourceDate(r.receivedate),updatedAt:sourceDate(r.receiptdate),serious:r.serious==='1'?true:r.serious==='2'?false:null,drugs:arr<any>(r.patient?.drug).map(d=>({name:String(d.medicinalproduct||d.openfda?.brand_name?.[0]||'Unspecified medicine'),role:({'1':'Suspect','2':'Concomitant','3':'Interacting'} as Record<string,string>)[d.drugcharacterization]||'Not stated',ingredients:arr<string>(d.openfda?.generic_name)})),reactions:[...new Set(arr<any>(r.patient?.reaction).map(x=>String(x.reactionmeddrapt||'Unspecified')))],outcomes:[...new Set(arr<any>(r.patient?.reaction).map(x=>outcomeNames[x.reactionoutcome]).filter(Boolean))],duplicateLinks:[],sourceUrl:'https://api.fda.gov/drug/event.json?search=safetyreportid:'+quote(String(r.safetyreportid))};
}
export async function usReports(products:Product[],filters:ReportFilters):Promise<ReportResult>{
  const terms=await Promise.all(products.map(aliases));
  if(terms.length===2&&terms[0].terms.some(t=>terms[1].terms.includes(t)))return{...result<ReportSummary[]>([],['These selections share a name or active ingredient. Co-report comparison would be ambiguous; compare their product descriptions and labels instead.'],'unavailable'),counts:[],countLabel:'Comparison unavailable'};
  for(let i=0;i<products.length;i++)terms[i].terms=reportAliases(products[i],terms[i].terms);
  const queries=terms.map(t=>'('+t.terms.slice(0,12).flatMap(n=>[`patient.drug.openfda.generic_name.exact:${quote(n)}`,`patient.drug.openfda.brand_name.exact:${quote(n)}`]).join(' OR ')+')');
  const from=iso(filters.from),to=iso(filters.to);if(from||to)queries.push(`receivedate:[${from||'19000101'} TO ${to||'29991231'}]`);
  if(filters.reaction)queries.push(`patient.reaction.reactionmeddrapt.exact:${quote(filters.reaction)}`);
  if(filters.serious==='yes')queries.push('serious:1');if(filters.serious==='no')queries.push('serious:2');
  const search=queries.join(' AND '),skip=(filters.page-1)*25;
  if(skip>25000)throw new Error('The source paging limit was reached. Narrow the date range.');
  try{
    const r=await jsonSource('openfda','https://api.fda.gov/drug/event.json',{search,limit:25,skip,sort:'receivedate:desc'});
    let data=latestCases(arr<any>(r.value.results).map(fdaReport));const notes=[reportCaveat,'Counts refer to source-matched reports, not verified exposures to the selected product or formulation. Reporter country does not establish the market of the medication.'];
    if(products.some(p=>p.ingredients.length>1))notes.push('Combination products use the full reported product name or combined generic name. Reports naming only one component are excluded; alternate names may be missed.');
    if(products.length===2){const valid=data.filter(d=>distinctPairMatches(d.drugs,terms[0].terms,terms[1].terms));if(valid.length!==data.length)notes.push('Some source matches could not be verified as two distinct medication records and are omitted from this page. Source totals and charts include candidate matches.');data=valid;}
    let counts:{term:string;count:number}[]=[];
    try{const c=await jsonSource('openfda','https://api.fda.gov/drug/event.json',{search,count:'patient.reaction.reactionmeddrapt.exact',limit:8});counts=arr<any>(c.value.results).map(x=>({term:String(x.term),count:Number(x.count)}));}catch{notes.push('Reaction totals are temporarily unavailable.');}
    if(r.stale)notes.push('Cached results are shown because the source could not be refreshed.');
    return {...result(data,notes,r.stale?'stale':'partial'),total:Number(r.value.meta?.results?.total)||0,page:filters.page,hasMore:skip+25<Number(r.value.meta?.results?.total),sourceAsOf:r.value.meta?.last_updated,fetchedAt:r.fetched,counts,countLabel:products.length===2?'Source-matched candidate reports':'Source-matched reports'};
  }catch(e){if(e instanceof UpstreamError&&e.status===404)return{...result<ReportSummary[]>([],[reportCaveat,'No reports matched this search. This does not establish safety or complete coverage.'],'partial'),total:0,page:filters.page,hasMore:false,counts:[],countLabel:'Source-matched reports'};throw e;}
}
export async function caReports(products:Product[],filters:ReportFilters):Promise<ReportResult>{
  const state=await db().prepare('SELECT generation,coverage,lastSuccess,error FROM source_state WHERE id=\'cv\'').first<{generation:string;coverage:string;lastSuccess:string;error:string}>();
  if(!state?.generation)return{...result<ReportSummary[]>([],['The Canada Vigilance dataset has not been imported. Canadian report counts are unavailable, not zero. Use the official source while the import is pending.',canadaCaveat],'unavailable'),counts:[],countLabel:'Canadian dataset unavailable'};
  const gen=state.generation;const candidates:NonNullable<ReportResult['candidates']>=[];const selected:string[][]=[];
  for(let side=0;side<products.length;side++){
    const p=products[side];const chosen=filters.cvIds?.[side]||[];
    if(chosen.length){if(chosen.length>10||chosen.some(x=>!/^\d{1,10}$/.test(x)))throw new Error('Choose up to ten valid Canadian report-dictionary entries.');const check=await db().prepare(`SELECT id FROM cv_products WHERE gen=? AND id IN (${chosen.map(()=>'?').join(',')})`).bind(gen,...chosen.map(Number)).all();if(check.results.length!==chosen.length)throw new Error('A selected report-dictionary entry is no longer available.');selected.push(chosen);continue;}
    const names=[p.name,p.genericName,...p.ingredients.map(i=>i.name)].map(normalize).filter(Boolean);
    const rows=await db().prepare(`SELECT id,name,ingredients FROM cv_products WHERE gen=? AND (${names.slice(0,6).map(()=>'name LIKE ?').join(' OR ')}) ORDER BY name LIMIT 31`).bind(gen,...names.slice(0,6).map(n=>'%'+n.replace(/[%_]/g,'')+'%')).all<{id:number;name:string;ingredients:string}>();
    for(const r of rows.results.slice(0,30))candidates.push({side,id:String(r.id),name:r.name,ingredients:JSON.parse(r.ingredients)});
    selected.push([]);
  }
  if(selected.some(s=>!s.length))return {...result<ReportSummary[]>([],['Select the corresponding entries in the Canada Vigilance drug dictionary. A report-dictionary name does not establish an exact DPD product, manufacturer, or formulation match.',canadaCaveat],'partial'),counts:[],countLabel:'Choose report dictionary matches',candidates,selectedCvIds:selected,sourceAsOf:state.coverage};
  if(selected.length===2&&selected[0].some(x=>selected[1].includes(x)))throw new Error('The same report-dictionary entry cannot satisfy both medications.');
  const ingredientRows=await db().prepare(`SELECT id,ingredients FROM cv_products WHERE gen=? AND id IN (${selected.flat().map(()=>'?').join(',')})`).bind(gen,...selected.flat().map(Number)).all<{id:number;ingredients:string}>();
  if(selected.length===2){const groups=selected.map(ids=>new Set(ingredientRows.results.filter(r=>ids.includes(String(r.id))).flatMap(r=>JSON.parse(r.ingredients) as string[]).map(normalize)));if([...groups[0]].some(i=>groups[1].has(i)))throw new Error('These report-dictionary selections share an ingredient; co-report comparison is ambiguous.');}
  const values:(string|number)[]=[gen];const where=['r.gen=?'];
  for(const ids of selected){where.push(`r.id IN(SELECT d.reportId FROM cv_report_drugs d WHERE d.gen=? AND d.drugId IN (${ids.map(()=>'?').join(',')}) AND d.role IN ('Suspect','Concomitant','Interacting'))`);values.push(gen,...ids.map(Number));}
  if(filters.from){iso(filters.from);where.push('r.received>=?');values.push(filters.from);}if(filters.to){iso(filters.to);where.push('r.received<=?');values.push(filters.to);}
  if(filters.serious==='yes')where.push('r.serious=1');if(filters.serious==='no')where.push('r.serious=0');
  if(filters.reaction){where.push('EXISTS(SELECT 1 FROM cv_reactions x WHERE x.gen=r.gen AND x.reportId=r.id AND x.term=?)');values.push(filters.reaction);}
  const condition=where.join(' AND ');
  const total=await db().prepare(`SELECT COUNT(*) AS n FROM cv_reports r WHERE ${condition}`).bind(...values).first<{n:number}>();
  const rows=await db().prepare(`SELECT r.* FROM cv_reports r WHERE ${condition} ORDER BY r.received DESC,r.id DESC LIMIT 25 OFFSET ?`).bind(...values,(filters.page-1)*25).all<any>();
  const data:ReportSummary[]=[];
  for(const r of rows.results){const [drugs,reactions,links]=await Promise.all([db().prepare('SELECT name,role FROM cv_report_drugs WHERE gen=? AND reportId=?').bind(gen,r.id).all<{name:string;role:string}>(),db().prepare('SELECT DISTINCT term FROM cv_reactions WHERE gen=? AND reportId=?').bind(gen,r.id).all<{term:string}>(),db().prepare('SELECT target,kind FROM cv_links WHERE gen=? AND reportId=?').bind(gen,r.id).all<{target:string;kind:string}>()]);data.push({id:String(r.id),version:String(r.version),authority:'Health Canada',eventCountry:'Canada',receivedAt:r.received||undefined,updatedAt:r.updated||undefined,serious:r.serious===null?null:!!r.serious,drugs:drugs.results,reactions:reactions.results.map(x=>x.term),outcomes:JSON.parse(r.outcomes),duplicateLinks:links.results.map(l=>`${l.kind}: ${l.target}`),sourceUrl:`https://cvp-pcv.hc-sc.gc.ca/arq-rei/report-rapport?lang=eng&id=${r.id}`});}
  const counts=await db().prepare(`SELECT x.term,COUNT(DISTINCT r.id) AS count FROM cv_reports r JOIN cv_reactions x ON x.gen=r.gen AND x.reportId=r.id WHERE ${condition} GROUP BY x.term ORDER BY count DESC LIMIT 8`).bind(...values).all<{term:string;count:number}>();
  return {...result(data,[...(state.error?['A later import failed. The previous complete dataset remains available.']:[]),canadaCaveat,'Counts include only Suspect, Concomitant, or Interacting medication roles. Known duplicate/linked case references are preserved; distinct report IDs may still describe one incident.'],'partial'),sourceAsOf:state.coverage,fetchedAt:state.lastSuccess,total:total?.n||0,page:filters.page,hasMore:filters.page*25<(total?.n||0),counts:counts.results,countLabel:'Matching Canadian reports',selectedCvIds:selected};
}
export async function recalls(p:Product){
  try{const terms=[p.name,p.genericName].filter(Boolean).map(s=>`product_description:${quote(s)}`).join(' OR ');const r=await jsonSource('openfda','https://api.fda.gov/drug/enforcement.json',{search:'('+terms+')',limit:10,sort:'report_date:desc'});return {...result(arr<any>(r.value.results).map(x=>({id:x.recall_number,date:sourceDate(x.report_date),description:x.product_description,reason:x.reason_for_recall,firm:x.recalling_firm,classification:x.classification,sourceUrl:'https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts'})),['Historical US recall search results are name matches. Check the manufacturer, product, and lot. These records do not establish current recall status or a Canadian recall.'],'partial'),sourceAsOf:r.value.meta?.last_updated,fetchedAt:r.fetched,completeness:r.stale?'stale' as const:'partial' as const};}catch(e){if(e instanceof UpstreamError&&e.status===404)return result([],['No historical US recall records matched this name search.'],'partial');throw e;}
}

export async function fdaLabel(p:Product){
  if(p.market!=='US')return result([],['The selected product is Canadian. US labeling is not substituted.'],'unavailable');
  const search=`openfda.spl_set_id:${quote(p.identifiers.setid!)} AND openfda.product_ndc:${quote(p.identifiers.ndc!)}`;
  try{const r=await jsonSource('openfda','https://api.fda.gov/drug/label.json',{search,limit:5});return {...result(arr<any>(r.value.results).map(x=>({id:String(x.id),effectiveAt:sourceDate(x.effective_time),manufacturer:arr<string>(x.openfda?.manufacturer_name).join(', '),sourceUrl:'https://api.fda.gov/drug/label.json?'+new URLSearchParams({search,limit:'5'}).toString()})),['Current FDA label cross-reference matched by SPL set and product NDC. Source update schedules differ; archived comparisons use DailyMed.'],'partial'),sourceAsOf:r.value.meta?.last_updated,fetchedAt:r.fetched,completeness:r.stale?'stale' as const:'partial' as const};}
  catch(e){if(e instanceof UpstreamError&&e.status===404)return result([],['No current openFDA label cross-reference matched both this SPL set and product NDC.'],'partial');throw e;}
}
