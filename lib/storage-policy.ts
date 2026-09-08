export const RETENTION_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
export function artifactCandidate(key: string, uploaded: Date, stamp = Date.now()) {
  if (!Number.isFinite(uploaded.getTime()) || stamp - uploaded.getTime() < RETENTION_GRACE_MS) return null;
  const raw = key.match(/^raw-sources\/([a-f0-9]{64})\/(\d{1,3})$/);
  if (raw && Number(raw[2]) <= 200) return { kind: 'raw' as const, id: raw[1] };
  const catalogue = key.match(/^canada\/catalogue\/([a-f0-9]{16})\/[a-f0-9]{64}\.json$/);
  return catalogue ? { kind: 'catalogue' as const, id: catalogue[1] } : null;
}
