import { AsyncLocalStorage } from 'node:async_hooks';
import { env } from 'cloudflare:workers';

export const IMPORT_PROTOCOL = 2;
export const LEASE_MS = 600_000;
export type Fence = { source: string; runId: string; leaseEpoch: number; generation?: string; minimumCoverage?: string };
export class LeaseConflict extends Error { status = 409; }
const context = new AsyncLocalStorage<Fence>();
const statements = new WeakMap<D1PreparedStatement, { statement: D1PreparedStatement; mutation: boolean }>();
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
async function batch<T>(items: D1PreparedStatement[]): Promise<D1Result<T>[]> {
  const fence = context.getStore(), entries = items.map(item => statements.get(item) ?? { statement: item, mutation: true });
  if (!fence || !entries.some(e => e.mutation)) return env.DB.batch<T>(entries.map(e => e.statement));
  const id = crypto.randomUUID();
  try {
    const result = await env.DB.batch<T>([guard(fence, id), ...entries.map(e => e.statement), env.DB.prepare('DELETE FROM mutation_guards WHERE id=?').bind(id)]);
    return result.slice(1, -1);
  } catch (error) {
    if (/mutation_guards|CHECK constraint failed.*valid/.test(String(error))) throw new LeaseConflict('The update lease expired, changed owner, or would regress source coverage.');
    throw error;
  }
}
function prepare(sql: string, bound?: D1PreparedStatement): D1PreparedStatement {
  const statement = bound ?? env.DB.prepare(sql), mutation = !/^\s*(SELECT|EXPLAIN)\b/i.test(sql);
  const wrapper = {
    bind: (...args: unknown[]) => prepare(sql, statement.bind(...args)),
    all: <T>() => mutation && context.getStore() ? batch<T>([wrapper]).then(rows => rows[0]) : statement.all<T>(),
    run: <T>() => mutation && context.getStore() ? batch<T>([wrapper]).then(rows => rows[0]) : statement.run<T>(),
    first: async <T>(column?: string): Promise<T | null> => {
      if (!mutation || !context.getStore()) return column ? statement.first<T>(column) : statement.first<T>();
      const row = (await batch<Record<string, unknown>>([wrapper]))[0].results[0];
      return row ? (column ? row[column] : row) as T : null;
    },
    raw: (...args: unknown[]) => {
      if (mutation && context.getStore()) throw new LeaseConflict('Use a fenced batch for mutating statements.');
      // oxlint-disable-next-line typescript/unbound-method -- Reflect supplies the native statement receiver.
      return Reflect.apply(statement.raw, statement, args);
    },
  } as D1PreparedStatement;
  statements.set(wrapper, { statement, mutation });
  return wrapper;
}
export const database = () => ({ prepare, batch }) as Pick<D1Database, 'prepare' | 'batch'>;

export async function assertLease(fence = currentFence()) {
  if (!fence) return;
  await withFence(fence, () => batch([env.DB.prepare('SELECT 1')]));
}
