export const normalize = (s:string)=>s.normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleUpperCase('en-US');
export const searchText=(parts:string[])=>parts.map(normalize).filter(Boolean).join('\n')||'\n';
export const productSearchText=(p:{name:string;genericName?:string})=>searchText([p.name,p.genericName||'']);
export const dictionarySearchText=(name:string,ingredients:string)=>searchText([name,...JSON.parse(ingredients) as string[]]);
export const searchBackfillNote='Name normalization is being upgraded. Some Unicode matches may be unavailable until maintenance completes; an empty result does not establish complete coverage.';
