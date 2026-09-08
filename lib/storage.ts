import { env } from 'cloudflare:workers';
import { db } from './server';
import { CHECK_LEASE_MS, noMaintenance } from './updates';

export function estimatedImportBytes(source: 'cv' | 'dpd', bytes: number) {
  if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > 8_000_000_000) throw new Error('Invalid import size estimate.');
  // Conservative headroom for generation keys, indexes and duplicated product/version JSON.
  return Math.max(20_000_000, Math.ceil(bytes * (source === 'cv' ? 3 : 4)));
}
export async function capacity() {
  const limitBytes = Number(env.IMPORT_DATABASE_LIMIT_BYTES || '8000000000');
  if (!Number.isSafeInteger(limitBytes) || limitBytes < 50_000_000 || limitBytes > 8_000_000_000) throw new Error('IMPORT_DATABASE_LIMIT_BYTES must be between 50000000 and 8000000000.');
  const result = await db().prepare("SELECT COALESCE(SUM(reservedBytes),0) AS reserved FROM imports WHERE state='staging'").all<{reserved:number}>();
  const databaseBytes = result.meta.size_after, reservedBytes = result.results[0].reserved;
  if (!Number.isSafeInteger(databaseBytes)) throw new Error('Database size could not be measured; import admission is unavailable.');
  return { databaseBytes, reservedBytes, limitBytes, availableBytes: Math.max(0, limitBytes - databaseBytes - reservedBytes) };
}
export async function writeCapacity(growthBytes = 12_000_000) {
  const value = await capacity();
  if (value.databaseBytes + growthBytes > value.limitBytes) throw new Error('Database capacity limit reached. Previous complete data remains available; no storage upgrade was made.');
  return value;
}

export function archiveLimit() {
  const value = Number(env.IMPORT_ARCHIVE_LIMIT_BYTES || '8000000000');
  if (!Number.isSafeInteger(value) || value < 10_000_000 || value > 8_000_000_000) throw new Error('IMPORT_ARCHIVE_LIMIT_BYTES must be between 10000000 and 8000000000.');
  return value;
}
export async function putArchive(key: string, value: string | Uint8Array, options?: R2PutOptions) {
  await noMaintenance();
  const old = await env.FILES.head(key), size = typeof value === 'string' ? new TextEncoder().encode(value).byteLength : value.byteLength;
  const growth = Math.max(0, size - (old?.size || 0));
  if (growth) {
    const meter = await db().prepare("SELECT key FROM cache WHERE key='storage:r2'").first();
    if (!meter) {
      const existing = await env.FILES.list({ limit: 1 });
      if (existing.objects.length) throw new Error('Run storage maintenance to measure existing archives before adding new source files.');
      await db().prepare("INSERT OR IGNORE INTO cache(key,value,fetched,source) VALUES('storage:r2','{\"bytes\":0}',?,'maintenance')").bind(Date.now()).run();
    }
    // Reserve before writing; ambiguous retries can over-count until the next audit, never under-count.
    const reserved = await db().prepare("UPDATE cache SET value=json_set(value,'$.bytes',json_extract(value,'$.bytes')+?) WHERE key='storage:r2' AND json_extract(value,'$.bytes')+?<=? AND NOT EXISTS(SELECT 1 FROM update_runs WHERE source='maintenance' AND outcome='running' AND heartbeat>?) RETURNING key")
      .bind(growth, growth, archiveLimit(),new Date(Date.now()-CHECK_LEASE_MS).toISOString()).first();
    if (!reserved) throw new Error('Archive storage ceiling reached. Referenced source documents were retained; no storage upgrade was made.');
  }
  return env.FILES.put(key, value, options);
}
