import { db, now } from './server';

export const CHECK_LEASE_MS = 10 * 60 * 1000;
export type CheckOutcome = 'running' | 'updated' | 'unchanged' | 'failed' | 'interrupted';
export type UpdateRun = {
  source: string; runId: string; started: string; heartbeat: string; finished: string | null;
  lastSuccess: string | null; outcome: CheckOutcome; phase: string; error: string | null;
  cursor: string; details: string;
};
const checkSources = new Set(['cv', 'dpd', 'dailymed', 'maintenance']);
const phases = new Set(['checking', 'downloading', 'validating', 'archiving', 'importing', 'refreshing', 'cleanup', 'complete']);
export class UpdateConflict extends Error { status = 409; }
export function checkStatus(run: UpdateRun, stamp = Date.now()) {
  const interrupted = run.outcome === 'running' && stamp - Date.parse(run.heartbeat) > CHECK_LEASE_MS;
  return {
    lastAttemptAt: run.started, lastCheckedAt: run.finished || undefined,
    lastCheckSuccessAt: run.lastSuccess || undefined,
    checkOutcome: interrupted ? 'interrupted' as const : run.outcome,
    checkPhase: run.phase,
    checkError: interrupted ? 'The update stopped reporting progress. Previous successful data remains available.' : run.error || undefined,
  };
}
// The import key protects this route. Persist only bounded fields, never raw exception text.
export async function checkAction(b: Record<string, unknown>): Promise<Response | null> {
  if (b.action === 'release-state' || b.action === 'release-save') {
    if (!['cv', 'dpd'].includes(String(b.source))) throw new Error('Invalid release source.');
    const active = await db().prepare("SELECT id,hash FROM imports WHERE source=? AND state='active' ORDER BY completed DESC LIMIT 1").bind(b.source).first<{id:string;hash:string}>();
    const run = await db().prepare('SELECT * FROM update_runs WHERE source=?').bind(b.source).first<UpdateRun>();
    if (b.action === 'release-state') {
      const saved = JSON.parse(run?.details || '{}');
      return Response.json({ active, release: active && saved.generation === active.id && saved.datasetHash === active.hash ? saved : null });
    }
    if (!run || run.runId !== b.runId || run.outcome !== 'running') throw new UpdateConflict('A release checkpoint requires the current check lease.');
    if (!active || active.id !== b.generation || active.hash !== b.datasetHash) throw new Error('Only a complete active release can be checkpointed.');
    const names = b.source === 'cv' ? ['extract_extrait.zip'] : ['drugproduct.json','activeingredient.json','form.json','route.json','status.json'];
    const documents = b.documents;
    if (!documents || typeof documents !== 'object' || Array.isArray(documents) || Object.keys(documents).length !== names.length || names.some(name => !(name in documents))) throw new Error('Release source documents are incomplete.');
    for (const document of Object.values(documents)) {
      if (!document || typeof document !== 'object' || !/^[a-f0-9]{64}$/.test(document.hash) || !Number.isSafeInteger(document.bytes) || document.bytes < 1 || document.bytes > 1_000_000_000 || typeof document.verifiedAt !== 'string' || !Number.isFinite(Date.parse(document.verifiedAt))) throw new Error('Invalid release document metadata.');
      for (const key of ['etag','lastModified']) if (document[key] !== null && (typeof document[key] !== 'string' || document[key].length > 500 || /[\r\n]/.test(document[key]))) throw new Error('Invalid source validator.');
      if (Object.keys(document).some(key => !['hash','bytes','etag','lastModified','verifiedAt'].includes(key))) throw new Error('Unexpected release metadata.');
    }
    if (b.source === 'cv' && Object.values(documents)[0].hash !== active.hash) throw new Error('Source bytes do not match the active report release.');
    const details = JSON.stringify({ generation: active.id, datasetHash: active.hash, documents });
    if (details.length > 12_000) throw new Error('Release checkpoint exceeds its size limit.');
    const saved = await db().prepare("UPDATE update_runs SET details=? WHERE source=? AND runId=? AND outcome='running' RETURNING source").bind(details, b.source, b.runId).first();
    if (!saved) throw new UpdateConflict('The source check lease changed while saving its release.');
    return Response.json({ saved: true });
  }
  if (b.action === 'checks') {
    const runs = await db().prepare('SELECT * FROM update_runs ORDER BY source').all<UpdateRun>();
    return Response.json({ sources: runs.results.map(r => ({ source: r.source, ...checkStatus(r) })) });
  }
  if (!['check-begin', 'check-heartbeat', 'check-finish'].includes(String(b.action))) return null;
  if (!checkSources.has(String(b.source)) || !/^[a-f0-9]{32}$/.test(String(b.runId))) throw new Error('Invalid source check.');
  const stamp = now(), phase = b.phase === undefined ? 'checking' : b.phase;
  if (typeof phase !== 'string' || !phases.has(phase)) throw new Error('Invalid update phase.');
  if (b.action === 'check-begin') {
    const claimed = await db().prepare(`INSERT INTO update_runs(source,runId,started,heartbeat,outcome,phase)
      VALUES(?,?,?,?,'running',?) ON CONFLICT(source) DO UPDATE SET
      runId=excluded.runId,started=CASE WHEN update_runs.runId=excluded.runId THEN update_runs.started ELSE excluded.started END,
      heartbeat=excluded.heartbeat,finished=NULL,outcome='running',phase=excluded.phase,error=NULL
      WHERE update_runs.outcome<>'running' OR update_runs.heartbeat<? OR update_runs.runId=excluded.runId
      RETURNING source`).bind(b.source, b.runId, stamp, stamp, phase, new Date(Date.now() - CHECK_LEASE_MS).toISOString()).first();
    if (!claimed) throw new UpdateConflict('Another check for this source is still running.');
    return Response.json({ started: true, leaseSeconds: CHECK_LEASE_MS / 1000 });
  }
  if (b.action === 'check-heartbeat') {
    const active = await db().prepare("UPDATE update_runs SET heartbeat=?,phase=? WHERE source=? AND runId=? AND outcome='running' RETURNING source")
      .bind(stamp, phase, b.source, b.runId).first();
    if (!active) throw new UpdateConflict('This source check no longer owns the update lease.');
    return Response.json({ active: true });
  }
  if (!['updated', 'unchanged', 'failed'].includes(String(b.outcome))) throw new Error('Invalid check outcome.');
  const success = b.outcome !== 'failed';
  const reason = success ? null : `The ${phase} phase failed. Previous successful data remains available. See the owner update log.`;
  const completed = await db().prepare(`UPDATE update_runs SET heartbeat=?,finished=?,outcome=?,phase=?,error=?,
    lastSuccess=CASE WHEN ? THEN ? ELSE lastSuccess END WHERE source=? AND runId=? AND outcome='running' RETURNING source`)
    .bind(stamp, stamp, b.outcome, phase, reason, success ? 1 : 0, stamp, b.source, b.runId).first();
  if (!completed) throw new UpdateConflict('This source check no longer owns the update lease.');
  if (success) await db().prepare('UPDATE source_state SET lastChecked=?,error=NULL WHERE id=?').bind(stamp, b.source).run();
  return Response.json({ completed: true, outcome: b.outcome });
}
