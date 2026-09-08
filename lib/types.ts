export type Market = 'US' | 'CA';
export type Completeness = 'complete' | 'partial' | 'unavailable' | 'stale';
export type Ingredient = { name: string; code?: string; strength?: string; basis?: string; basisCode?: string };
export type Product = {
  id: string; name: string; genericName: string; market: Market;
  manufacturer: string; strength: string; form: string; route: string;
  identifiers: { ndc?: string; din?: string; setid?: string; drugCode?: number; rxcui?: string };
  ingredients: Ingredient[]; sourceUrl: string; status?: string; dataStatus?: Completeness; observedAt?: string;
};
export type ProductVersion = {
  id: string; productId: string; version: string; publishedAt?: string;
  effectiveAt?: string; sourceUpdatedAt?: string; observedAt?: string; sourceUrl: string;
  active?: Ingredient[]; inactive?: Ingredient[]; form?: string; route?: string;
  sections?: Record<string, string>; completeness: Completeness;
  contentHash?: string; notes?: string[];
};
export type Change = {
  category: 'active ingredients' | 'inactive ingredients' | 'safety wording' | 'packaging / administrative' | 'form / route';
  field: string; before: string; after: string; explanation: string;
};
export type EvidenceItem = {
  id: string; source: string; title: string; text: string; sourceUrl: string;
  productId?: string; version?: string; publishedAt?: string; effectiveAt?: string; observedAt: string;
  market?: Market; authority: string; completeness: Completeness; matchedTerms?: string[];
};
export type ReportSummary = {
  id: string; version: string; authority: string; eventCountry?: string; reporterCountry?: string;
  receivedAt?: string; updatedAt?: string; serious: boolean | null;
  drugs: { name: string; role: string; ingredients?: string[] }[];
  reactions: string[]; outcomes: string[]; duplicateLinks: string[]; sourceUrl: string;
};
export type SourceStatus = {
  id: string; name: string; region: string; description: string; url: string;
  access: 'integrated' | 'external'; status: string; coverageThrough?: string;
  lastSuccessAt?: string; lastError?: string; termsUrl?: string;
  lastAttemptAt?: string; lastCheckedAt?: string; lastCheckSuccessAt?: string;
  checkOutcome?: 'running' | 'updated' | 'unchanged' | 'failed' | 'interrupted'; checkPhase?: string; checkError?: string;
};
export type Result<T> = {
  data: T; completeness: Completeness; notes: string[]; fetchedAt: string;
  sourceAsOf?: string; total?: number; page?: number; hasMore?: boolean;
};
export type ReportResult = Result<ReportSummary[]> & {
  counts: { term: string; count: number }[]; countLabel: string;
  selectedCvIds?: string[][];
  candidates?: { side: number; id: string; name: string; ingredients: string[] }[];
};
