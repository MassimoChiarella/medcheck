import { env } from 'cloudflare:workers';
import { db } from './server';

export function cacheLimits(){
  const bytes=Number(env.CACHE_LIMIT_BYTES||64_000_000),entries=Number(env.CACHE_LIMIT_ENTRIES||2000);
  if(!Number.isSafeInteger(bytes)||bytes<1_500_000||bytes>128_000_000||!Number.isSafeInteger(entries)||entries<10||entries>5000)throw new Error('Invalid cache retention configuration.');
  return {bytes,entries};
}
export async function storeCache(key:string,value:string,fetched:number,source:string,ttl:number){
  const size=new TextEncoder().encode(value).byteLength,limits=cacheLimits();
  if(size>1_500_000)return;
  // A parsed SPL is evictable only after every inspected product version has a
  // durable source reference. Ordinary search/count responses retain a bounded stale window.
  await db().prepare(`DELETE FROM cache WHERE key IN(SELECT key FROM cache c WHERE key NOT GLOB 'storage:*' AND expires<?
    AND (key NOT GLOB 'spl:*' OR NOT EXISTS(SELECT 1 FROM json_each(c.value,'$.versions') v
      WHERE NOT EXISTS(SELECT 1 FROM versions WHERE id=json_extract(v.value,'$.id') AND json_extract(data,'$.archiveStatus')='verified')))
    ORDER BY expires,fetched,key LIMIT 100)`).bind(fetched).run();
  await db().prepare(`INSERT INTO cache(key,value,fetched,source,bytes,expires) SELECT ?,?,?,?,?,? WHERE
    (SELECT COALESCE(SUM(CASE WHEN bytes>0 THEN bytes ELSE length(CAST(value AS BLOB)) END),0) FROM cache WHERE key<>? AND key NOT GLOB 'storage:*')+?<=?
    AND (SELECT COUNT(*) FROM cache WHERE key<>? AND key NOT GLOB 'storage:*')<?
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,fetched=excluded.fetched,source=excluded.source,bytes=excluded.bytes,expires=excluded.expires`)
    .bind(key,value,fetched,source,size,fetched+Math.min(90*86400000,Math.max(7*86400000,ttl*3)),key,size,limits.bytes,key,limits.entries).run();
}
