export class InputError extends Error { readonly status=400; readonly code='INVALID_INPUT'; }
export const productIdPattern=/^(CA:\d{1,10}|US:[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}:[\d-]{4,16})$/;
const actions=new Set(['sources','search','suggestions','product','history','version','diff','evidence','fda-label','recalls','terminology','reports']);
export function validDate(value:string){return /^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;}
export function validateResearch(q:URLSearchParams){
  const action=q.get('action')||'search',page=Number(q.get('page')||1);
  if(!actions.has(action))throw new InputError('Unknown research action.');
  if(!Number.isInteger(page)||page<1||page>1001)throw new InputError('Choose a page between 1 and 1001.');
  for(const field of ['market','source'])if(q.has(field)&&!['US','CA'].includes(q.get(field)!))throw new InputError('Choose the US or Canadian market/source.');
  if(q.has('serious')&&!['all','yes','no'].includes(q.get('serious')!))throw new InputError('Choose all, serious, or non-serious reports.');
  for(const field of ['from','to'])if(q.get(field)&&!validDate(q.get(field)!))throw new InputError('Use a valid calendar date.');
  if(q.get('from')&&q.get('to')&&q.get('from')!>q.get('to')!)throw new InputError('Start date must precede end date.');
  if((q.get('reaction')?.length||0)>120)throw new InputError('Reaction term must be at most 120 characters.');
  if(['search','suggestions'].includes(action)){const query=(q.get('q')||'').trim();if(query.length<3||query.length>100)throw new InputError('Enter between 3 and 100 characters.');}
  else if(action!=='sources'){
    if(!productIdPattern.test(q.get('id')||''))throw new InputError('Select a valid medication product.');
    if(q.has('other')&&!productIdPattern.test(q.get('other')||''))throw new InputError('Select a valid second medication product.');
  }
  if(['version','diff'].includes(action)){
    for(const field of action==='version'?['version']:['before','after']){
      const v=q.get(field)||'';
      if(q.get('id')!.startsWith('US:')?!/^\d{1,9}$/.test(v):v.length>40||!/^\d{4}-\d{2}-\d{2}T/.test(v)||!Number.isFinite(Date.parse(v)))throw new InputError('Choose a valid source version.');
    }
    if(action==='diff'){
      const order=(v:string)=>q.get('id')!.startsWith('US:')?Number(v):Date.parse(v);
      if(order(q.get('before')!)>=order(q.get('after')!))throw new InputError('Choose two distinct versions in earlier-to-later order.');
    }
  }
  let cvIds:string[][]|undefined;
  if(q.has('cvIds')){
    try{
      const raw=q.get('cvIds')!;if(raw.length>1000)throw new Error();
      const parsed:unknown=JSON.parse(raw);
      if(!Array.isArray(parsed)||parsed.length>(q.has('other')?2:1)||parsed.some(side=>!Array.isArray(side)||side.length>10||side.some(id=>typeof id!=='string'||!/^\d{1,10}$/.test(id))||new Set(side.map(Number)).size!==side.length))throw new Error();
      cvIds=(parsed as string[][]).map(side=>side.map(id=>String(Number(id))));
    }catch{throw new InputError('Choose up to ten distinct Canadian report-dictionary entries per medication.');}
  }
  return {action,page,cvIds};
}
