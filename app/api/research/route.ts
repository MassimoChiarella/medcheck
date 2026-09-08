import { compareVersions } from '@/lib/core';
import { aliases, caProduct, getProduct, getVersion, history, result, searchCA, searchUS, sourceStatuses } from '@/lib/server';
import { caReports, evidence, fdaLabel, recalls, usReports, type ReportFilters } from '@/lib/evidence';
export async function GET(request:Request){
  try{
    const q=new URL(request.url).searchParams,action=q.get('action')||'search';
    const page=Number(q.get('page')||1);if(!Number.isInteger(page)||page<1||page>1001)throw new Error('Invalid page.');
    let value:unknown;
    if(action==='sources')value=result(await sourceStatuses());
    else if(action==='search'){
      const query=(q.get('q')||'').trim();if(query.length<3||query.length>100)throw new Error('Enter between 3 and 100 characters.');
      value=q.get('market')==='CA'?await searchCA(query,page):await searchUS(query,page);
    }else{
      const id=q.get('id')||'';const p=await getProduct(id);
      if(action==='product'){const updated=p.market==='CA'?await caProduct(p.identifiers.drugCode!):p;value=result(updated);}
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
        if((filters.reaction?.length||0)>120)throw new Error('Reaction term is too long.');if(filters.from&&filters.to&&filters.from>filters.to)throw new Error('Start date must precede end date.');
        const cvIds=q.get('cvIds');if(cvIds){const parsed=JSON.parse(cvIds);if(!Array.isArray(parsed)||parsed.length>2||parsed.some(s=>!Array.isArray(s)||s.some((v:unknown)=>typeof v!=='string')))throw new Error('Invalid Canadian dictionary selections.');filters.cvIds=parsed;}
        value=filters.source==='CA'?await caReports(products,filters):await usReports(products,filters);
      }else throw new Error('Unknown research action.');
    }
    return Response.json(value,{headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  }catch(error){const raw=error instanceof Error?error.message:'Research source unavailable.';const message=/internal error|D1_ERROR|R2_ERROR|SQLITE/i.test(raw)?'The data service could not complete this request. Please try again shortly.':raw;const status=/valid|Enter |Select |Choose |same |share |Unknown research|Start date|too long|ambiguous/i.test(message)?400:503;return Response.json({error:message,completeness:'unavailable',notes:['Unavailable data is not evidence of safety or an absence of reports.']},{status,headers:{'Cache-Control':'no-store'}});}
}
