import { AsyncLocalStorage } from 'node:async_hooks';
import { env } from 'cloudflare:workers';

export const IMPORT_PROTOCOL = 2;
export const LEASE_MS = 600_000;
export type Fence = { source: string; runId: string; leaseEpoch: number; generation?: string; minimumCoverage?: string; growthBytes?: number };
export class LeaseConflict extends Error { status = 409; }
export class CapacityError extends Error { status = 507; }
export function databaseLimit(){const limit=Number(env.IMPORT_DATABASE_LIMIT_BYTES||'8000000000');if(!Number.isSafeInteger(limit)||limit<50_000_000||limit>8_000_000_000)throw new CapacityError('Invalid database capacity configuration.');return limit;}
const context = new AsyncLocalStorage<Fence>();
const statements = new WeakMap<D1PreparedStatement, { statement: D1PreparedStatement; mutation: boolean; growth: number }>();
export const currentFence = () => context.getStore();

export function parseFence(value: Record<string, unknown>, source: string): Fence {
  if (value.protocolVersion !== IMPORT_PROTOCOL) throw new LeaseConflict('Import client protocol unsupported. Update this installation before retrying.');
  if (value.source !== source || !/^[a-f0-9]{32}$/.test(String(value.runId)) || !Number.isSafeInteger(value.leaseEpoch) || Number(value.leaseEpoch) < 1) throw new LeaseConflict('A current source lease and epoch are required.');
  return { source, runId: String(value.runId), leaseEpoch: Number(value.leaseEpoch) };
}
export function withFence<T>(fence: Fence, action: () => Promise<T>): Promise<T> { return context.run(fence, action); }

function guard(fence: Fence, id: string) {
  // CHECK failure aborts the whole D1 batch, including publication, not merely one UPDATE.
  return env.DB.prepare(`INSERT INTO mutation_guards(id,valid) SELECT ?,CASE WHEN EXISTS(
    SELECT 1 FROM update_runs WHERE source=? AND runId=? AND leaseEpoch=? AND outcome='running'
    AND julianday(heartbeat)>julianday('now')-?/86400000.0)
    AND NOT EXISTS(SELECT 1 FROM update_runs WHERE source='maintenance' AND source<>? AND outcome='running'
      AND julianday(heartbeat)>julianday('now')-?/86400000.0)
    AND (? IS NULL OR EXISTS(SELECT 1 FROM imports WHERE source=? AND id=? AND ownerRunId=? AND ownerEpoch=?))
    AND (? IS NULL OR NOT EXISTS(SELECT 1 FROM source_state WHERE id='cv' AND coverage>?))
    THEN 1 ELSE 0 END`).bind(id, fence.source, fence.runId, fence.leaseEpoch, LEASE_MS, fence.source, LEASE_MS,
      fence.generation ?? null, fence.source, fence.generation ?? null, fence.runId, fence.leaseEpoch,
      fence.minimumCoverage ?? null, fence.minimumCoverage ?? null);
}
async function rawFenced<T>(items:D1PreparedStatement[],fence=context.getStore()):Promise<D1Result<T>[]> {
  if(!fence)return env.DB.batch<T>(items);
  const id=crypto.randomUUID();
  try{return (await env.DB.batch<T>([guard(fence,id),...items,env.DB.prepare('DELETE FROM mutation_guards WHERE id=?').bind(id)])).slice(1,-1);}
  catch(error){if(/mutation_guards|CHECK constraint failed.*mutation_guard_valid/.test(String(error)))throw new LeaseConflict('The update lease expired, changed owner, or would regress source coverage.');throw error;}
}
async function batch<T>(items:D1PreparedStatement[]):Promise<D1Result<T>[]> {
  const fence=context.getStore(),entries=items.map(item=>statements.get(item)??{statement:item,mutation:true,growth:0});
  if(!entries.some(e=>e.mutation))return env.DB.batch<T>(entries.map(e=>e.statement));
  const estimate=entries.reduce((sum,e)=>sum+e.growth,0);
  if(!estimate)return rawFenced<T>(entries.map(e=>e.statement));
  const bytes=Math.max(131072+estimate*4,fence?.growthBytes||0),id=crypto.randomUUID(),stamp=new Date().toISOString();
  const measurement=await env.DB.prepare('SELECT 1').all(),measured=measurement.meta.size_after;
  if(!Number.isSafeInteger(measured))throw new CapacityError('Database size is unavailable; persistence was paused.');
  const prefix=[
    env.DB.prepare("INSERT INTO storage_usage(id,bytes,initialized,updated) VALUES('d1',?,1,?) ON CONFLICT(id) DO UPDATE SET bytes=MAX(bytes,excluded.bytes),updated=excluded.updated").bind(measured,stamp),
    env.DB.prepare(`INSERT INTO database_reservations(id,bytes,generation,created) SELECT ?,?,?,? WHERE
      (SELECT bytes FROM storage_usage WHERE id='d1')+(SELECT COALESCE(SUM(bytes),0) FROM database_reservations)
      +(SELECT COALESCE(SUM(reservedBytes),0) FROM imports WHERE state='staging')+?
      -MIN(?,COALESCE((SELECT reservedBytes FROM imports WHERE id=? AND state='staging'),0))<=?
      AND NOT EXISTS(SELECT 1 FROM update_runs WHERE source='maintenance' AND source<>? AND outcome='running' AND julianday(heartbeat)>julianday('now')-10.0/1440)`)
      .bind(id,bytes,fence?.generation??null,stamp,bytes,bytes,fence?.generation??null,databaseLimit(),fence?.source||''),
    env.DB.prepare('INSERT INTO capacity_guards(id,valid) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM database_reservations WHERE id=?) THEN 1 ELSE 0 END').bind(id,id),
    env.DB.prepare('SELECT 1'),
  ];
  let result:D1Result<T>[];
  try{result=await rawFenced<T>([...prefix,...entries.map(e=>e.statement),env.DB.prepare('SELECT 1'),env.DB.prepare('DELETE FROM capacity_guards WHERE id=?').bind(id)]);}
  catch(error){if(/capacity_guard_valid/.test(String(error)))throw new CapacityError('Database capacity or maintenance limit reached. Previous complete data remains available.');throw error;}
  const before=result[prefix.length-1].meta.size_after,after=result[prefix.length+entries.length].meta.size_after;
  // Only this transaction's observed physical growth consumes its import reservation.
  // Never subtract reusable/free pages from the physical meter.
  const growth=Number.isSafeInteger(before)&&Number.isSafeInteger(after)?Math.max(0,after-before):0;
  const finalSize=Math.max(...result.map(r=>r.meta.size_after).filter(Number.isSafeInteger));
  try{await rawFenced([
    env.DB.prepare('UPDATE imports SET reservedBytes=MAX(0,reservedBytes-?) WHERE id=? AND state=\'staging\' AND EXISTS(SELECT 1 FROM database_reservations WHERE id=?)').bind(growth,fence?.generation??null,id),
    env.DB.prepare("UPDATE storage_usage SET bytes=MAX(bytes,?),updated=? WHERE id='d1'").bind(finalSize,stamp),
    env.DB.prepare('DELETE FROM database_reservations WHERE id=?').bind(id),
  ]);}catch(error){if(error instanceof LeaseConflict)throw error;/* Committed writes stay reserved until maintenance verifies physical size. */}
  return result.slice(prefix.length,prefix.length+entries.length);
}

function prepare(sql: string, bound?: D1PreparedStatement, args:unknown[]=[]): D1PreparedStatement {
  const statement = bound ?? env.DB.prepare(sql), mutation = !/^\s*(SELECT|EXPLAIN)\b/i.test(sql);
  const wrapper = {
    bind: (...args: unknown[]) => prepare(sql, statement.bind(...args),args),
    all: <T>() => mutation ? batch<T>([wrapper]).then(rows => rows[0]) : statement.all<T>(),
    run: <T>() => mutation ? batch<T>([wrapper]).then(rows => rows[0]) : statement.run<T>(),
    first: async <T>(column?: string): Promise<T | null> => {
      if (!mutation) return column ? statement.first<T>(column) : statement.first<T>();
      const row = (await batch<Record<string, unknown>>([wrapper]))[0].results[0];
      return row ? (column ? row[column] : row) as T : null;
    },
    raw: (...args: unknown[]) => {
      if (mutation) throw new LeaseConflict('Use a fenced batch for mutating statements.');
      // oxlint-disable-next-line typescript/unbound-method -- Reflect supplies the native statement receiver.
      return Reflect.apply(statement.raw, statement, args);
    },
  } as D1PreparedStatement;
  const grows=/^\s*(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|UPDATE)\s+["`]?((?:products|versions|cache|label_refresh|dpd_staging|cv_\w+|import_batches|archive_writes|archive_attempts))\b/i.test(sql);
  const growth=grows?args.reduce<number>((sum,value)=>sum+(typeof value==='string'?new TextEncoder().encode(value).byteLength:16),sql.length):0;
  statements.set(wrapper, { statement, mutation,growth });
  return wrapper;
}
export const database = () => ({ prepare, batch }) as Pick<D1Database, 'prepare' | 'batch'>;

export async function assertLease(fence = currentFence()) {
  if (!fence) return;
  await withFence(fence, () => batch([env.DB.prepare('SELECT 1')]));
}

export async function reconcileDatabaseReservations(){
  if(currentFence()?.source!=='maintenance')throw new LeaseConflict('Maintenance ownership is required.');
  const measured=await env.DB.prepare('SELECT id FROM database_reservations ORDER BY id LIMIT 200').all<{id:string}>();
  if(!Number.isSafeInteger(measured.meta.size_after))throw new CapacityError('Database size is unavailable.');
  // A reservation and its data commit in one D1 batch. Under the maintenance
  // admission barrier, leftover records describe completed writes, not late remote work.
  await rawFenced([
    env.DB.prepare("INSERT INTO storage_usage(id,bytes,initialized,updated) VALUES('d1',?,1,?) ON CONFLICT(id) DO UPDATE SET bytes=MAX(bytes,excluded.bytes),updated=excluded.updated").bind(measured.meta.size_after,new Date().toISOString()),
    env.DB.prepare('DELETE FROM database_reservations WHERE id IN(SELECT value FROM json_each(?))').bind(JSON.stringify(measured.results.map(row=>row.id))),
  ]);
}
