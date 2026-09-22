import { validateResearch, InputError } from '@/lib/research-input';
import { CapacityError } from '@/lib/database';
import { UpstreamError } from '@/lib/server';
import { compareVersions } from '@/lib/core';
import { aliases, refreshProduct, getProduct, getVersion, history, result, searchCA, searchUS, sourceStatuses, suggestMedication } from '@/lib/server';
import { caReports, evidence, fdaLabel, recalls, usReports, type ReportFilters } from '@/lib/evidence';
export async function GET(request:Request){
  try{
    const q=new URL(request.url).searchParams,{action,page,cvIds}=validateResearch(q);
    let value:unknown;
    if(action==='sources')value=result(await sourceStatuses());
    else if(action==='search'||action==='suggestions'){
      const query=(q.get('q')||'').trim();
      value=action==='suggestions'?await suggestMedication(query,q.get('market')==='CA'?'CA':'US'):q.get('market')==='CA'?await searchCA(query,page):await searchUS(query,page);
    }else{
      const id=q.get('id')||'';const p=await getProduct(id);
      if(action==='product'){const updated=await refreshProduct(p);value={...result(updated,updated.currentPresence==='absent'?['This product is absent from the latest label. Its saved identity and historical documents remain available.']:[],updated.dataStatus),fetchedAt:updated.observedAt||''};}
      else if(action==='history')value=await history(p);
      else if(action==='version'){const v=await getVersion(p,q.get('version')||'');value=result(v,v.notes,v.completeness);}
      else if(action==='diff'){const [before,after]=await Promise.all([getVersion(p,q.get('before')||''),getVersion(p,q.get('after')||'')]);value=result({before,after,...compareVersions(before,after)},[],[before,after].some(v=>v.completeness==='unavailable')?'unavailable':[before,after].some(v=>v.completeness==='stale')?'stale':'partial');}
      else if(action==='evidence')value=await evidence(q.get('other')?[p,await getProduct(q.get('other')!)]:[p]);
      else if(action==='fda-label')value=await fdaLabel(p);
      else if(action==='recalls')value=await recalls(p);
      else if(action==='terminology')value=result(await aliases(p));
      else if(action==='reports'){
        const products=q.get('other')?[p,await getProduct(q.get('other')!)]:[p];
        const filters:ReportFilters={source:q.get('source')==='CA'?'CA':'US',from:q.get('from')||undefined,to:q.get('to')||undefined,reaction:q.get('reaction')||undefined,serious:q.get('serious')||undefined,page};
        if(cvIds)filters.cvIds=cvIds;
        value=filters.source==='CA'?await caReports(products,filters):await usReports(products,filters);
      }else throw new Error('Unknown research action.');
    }
    return Response.json(value,{headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  }catch(error){
    const invalid=error instanceof InputError,capacity=error instanceof CapacityError;
    const status=invalid?400:capacity?507:503,code=invalid?'INVALID_INPUT':capacity?'CAPACITY_LIMIT':'SOURCE_UNAVAILABLE';
    const message=invalid||capacity?error.message:error instanceof UpstreamError?error.message:'The research source could not complete this request. Please try again shortly.';
    return Response.json({error:message,code,completeness:'unavailable',notes:['Unavailable data is not evidence of safety or an absence of reports.']},{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(error instanceof UpstreamError&&error.retryAfter?{'Retry-After':String(error.retryAfter)}:{})}});
  }
}
