import { db, loadLabel, now, UpstreamError } from './server';
import { CHECK_LEASE_MS, UpdateConflict, type UpdateRun } from './updates';

type Cycle = { cycle: string; owner: string; started: string };
async function progress(cycle: string) {
  const counts = await db().prepare(`SELECT COUNT(*) AS total,COALESCE(SUM(state='done'),0) AS completed,
    COALESCE(SUM(changed),0) AS changed,COALESCE(SUM(state<>'done' AND attempts>=3),0) AS exhausted
    FROM label_refresh WHERE cycle=?`).bind(cycle).first<{total:number;completed:number;changed:number;exhausted:number}>();
  const next = await db().prepare("SELECT nextAttempt FROM label_refresh WHERE cycle=? AND state<>'done' AND (attempts<3 OR state='working') ORDER BY nextAttempt,setId LIMIT 1")
    .bind(cycle).first<{nextAttempt:number}>();
  const remaining = counts!.total - counts!.completed;
  return { ...counts!, remaining, complete: remaining === 0, blocked: remaining > 0 && !next,
    retryAfter: next ? Math.max(1, Math.ceil((next.nextAttempt - Date.now()) / 1000)) : 0 };
}

export async function refreshAction(b: Record<string, unknown>): Promise<Response | null> {
  if (!['refresh-start', 'refresh'].includes(String(b.action))) return null;
  if (b.source !== 'dailymed' || !/^[a-f0-9]{32}$/.test(String(b.runId))) throw new Error('Start a DailyMed source check before refreshing.');
  const run = await db().prepare("SELECT * FROM update_runs WHERE source='dailymed' AND runId=? AND outcome='running' AND heartbeat>?")
    .bind(b.runId, new Date(Date.now() - CHECK_LEASE_MS).toISOString()).first<UpdateRun>();
  if (!run) throw new UpdateConflict('The label refresh no longer owns its source check.');
  let cycle: Cycle = JSON.parse(run.details);
  if (b.action === 'refresh-start') {
    if (cycle.owner === b.runId) return Response.json({ ...cycle, ...await progress(cycle.cycle), resumed: true });
    const pending = cycle.cycle && await db().prepare("SELECT 1 FROM label_refresh WHERE cycle=? AND state<>'done' LIMIT 1").bind(cycle.cycle).first();
    cycle = { cycle: pending ? cycle.cycle : String(b.runId), owner: String(b.runId), started: pending ? cycle.started : now() };
    // One row per SPL, even when a document lists many NDCs or strengths. Seeding stays in SQLite.
    await db().batch([
      db().prepare(`INSERT INTO label_refresh(setId,cycle,state)
        SELECT DISTINCT substr(id,4,36),?,'pending' FROM products WHERE id GLOB 'US:*'
        ON CONFLICT(setId) DO UPDATE SET cycle=excluded.cycle,state='pending',attempts=0,nextAttempt=0,changed=0,error=NULL
        WHERE label_refresh.cycle<>excluded.cycle`).bind(cycle.cycle),
      db().prepare("UPDATE label_refresh SET state='pending',attempts=0,nextAttempt=0 WHERE cycle=? AND state<>'done'").bind(cycle.cycle),
      db().prepare("UPDATE update_runs SET details=?,cursor='' WHERE source='dailymed' AND runId=? AND outcome='running'").bind(JSON.stringify(cycle), b.runId),
    ]);
    return Response.json({ ...cycle, ...await progress(cycle.cycle), resumed: Boolean(pending) });
  }
  if (!cycle.cycle || cycle.owner !== b.runId) throw new Error('Initialize the label refresh cycle first.');
  await db().prepare("UPDATE label_refresh SET state='pending' WHERE cycle=? AND state='working' AND nextAttempt<=?").bind(cycle.cycle, Date.now()).run();
  // One source document per request bounds runtime and makes ambiguous network retries resumable.
  const item = await db().prepare(`UPDATE label_refresh SET state='working',nextAttempt=?,attempts=attempts+1
    WHERE setId=(SELECT setId FROM label_refresh WHERE cycle=? AND state='pending' AND attempts<3 AND nextAttempt<=? ORDER BY nextAttempt,setId LIMIT 1)
    AND cycle=? AND state='pending' AND nextAttempt<=? RETURNING setId,attempts`)
    .bind(Date.now() + 120_000, cycle.cycle, Date.now(), cycle.cycle, Date.now()).first<{setId:string;attempts:number}>();
  if (!item) return Response.json(await progress(cycle.cycle));
  try {
    const previous = await db().prepare('SELECT value FROM cache WHERE key=?').bind(`spl:${item.setId}:current`).first<{value:string}>();
    const oldHash = JSON.parse(previous?.value || '{}').versions?.[0]?.contentHash;
    const label = await loadLabel(item.setId, undefined, true);
    const changed = oldHash !== label.value.versions[0]?.contentHash ? 1 : 0;
    await db().prepare("UPDATE label_refresh SET state='done',changed=?,error=NULL,nextAttempt=0 WHERE setId=? AND cycle=? AND state='working'").bind(changed, item.setId, cycle.cycle).run();
  } catch (error) {
    const throttled = error instanceof UpstreamError && error.status === 429;
    const permanent = error instanceof UpstreamError && [400,404,410].includes(error.status);
    const delay = error instanceof UpstreamError && error.retryAfter ? error.retryAfter : Math.min(300, 30 * 2 ** (item.attempts - 1));
    await db().prepare("UPDATE label_refresh SET state='pending',attempts=?,nextAttempt=?,error='Source refresh failed; previous label retained.' WHERE setId=? AND cycle=? AND state='working'")
      .bind(permanent ? 3 : throttled ? item.attempts - 1 : item.attempts, Date.now() + delay * 1000, item.setId, cycle.cycle).run();
  }
  return Response.json(await progress(cycle.cycle));
}
