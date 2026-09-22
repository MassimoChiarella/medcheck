import type { Result } from './types';

const normalizeName = (name: string) => name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

export function isMedicationNameQuery(query: string): boolean {
  const name = normalizeName(query);
  return name.length >= 3 && name.length <= 100 && /^[a-z][a-z\s/'()+-]*$/.test(name);
}

export function shouldOfferSpelling(query: string, result: Result<unknown[]>): boolean {
  return isMedicationNameQuery(query) && result.completeness === 'complete'
    && !result.hasMore && (result.page ?? 1) === 1 && result.data.length === 0;
}

// Adjacent swapped letters count as one typo, alongside insertions/deletions/substitutions.
function spellingDistance(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  rows[0] = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + Number(a[i - 1] !== b[j - 1]));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
      }
    }
  }
  return rows[a.length][b.length];
}

export function spellingCandidates(query: string, candidates: unknown): string[] {
  if (!isMedicationNameQuery(query) || !Array.isArray(candidates)) return [];
  const name = normalizeName(query);
  const names = [...new Set(candidates.filter((value): value is string => typeof value === 'string').map(normalizeName))];
  // A recognized spelling without matching products should not become a different medication.
  if (names.includes(name)) return [];
  const limit = Math.min(2, Math.max(1, Math.floor(name.length / 4)));
  return names.filter(candidate => isMedicationNameQuery(candidate) && Math.abs(candidate.length - name.length) <= limit)
    .map(candidate => ({ name: candidate, distance: spellingDistance(name, candidate) }))
    .filter(candidate => candidate.distance <= limit)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 3).map(candidate => candidate.name);
}
