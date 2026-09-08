import { sqliteTable, text, integer, index, primaryKey } from 'drizzle-orm/sqlite-core';
export const cache = sqliteTable('cache', { key: text().primaryKey(), value: text().notNull(), fetched: integer().notNull(), source: text().notNull(), asOf: text() });
export const products = sqliteTable('products', { id: text().primaryKey(), data: text().notNull(), observed: text().notNull() });
export const versions = sqliteTable('versions', { id: text().primaryKey(), productId: text().notNull(), version: text().notNull(), data: text().notNull(), hash: text(), observed: text().notNull() }, t=>[index('version_product').on(t.productId,t.observed)]);
export const imports = sqliteTable('imports', { id: text().primaryKey(), source: text().notNull(), state: text().notNull(), cutoff: text().notNull(), hash: text().notNull(), manifest: text().notNull(), created: text().notNull(), completed: text(), error: text() });
export const importBatches = sqliteTable('import_batches', { importId: text().notNull(), tableName: text().notNull(), batchId: integer().notNull(), rows: integer().notNull(), hash: text().notNull() },t=>[primaryKey({columns:[t.importId,t.tableName,t.batchId]})]);
export const sourceState = sqliteTable('source_state', { id: text().primaryKey(), generation: text(), lastSuccess: text(), lastChecked: text(), error: text(), coverage: text() });
export const cvProducts = sqliteTable('cv_products', { gen: text().notNull(), id: integer().notNull(), name: text().notNull(), ingredients: text().notNull() },t=>[primaryKey({columns:[t.gen,t.id]}),index('cv_product_name').on(t.gen,t.name)]);
export const cvReports = sqliteTable('cv_reports', { gen: text().notNull(), id: integer().notNull(), reportNo: text().notNull(), version: integer().notNull(), received: text(), updated: text(), serious: integer(), outcomes: text().notNull() },t=>[primaryKey({columns:[t.gen,t.id]}),index('cv_report_receipt').on(t.gen,t.received)]);
export const cvDrugs = sqliteTable('cv_report_drugs', { gen: text().notNull(), id: integer().notNull(), reportId: integer().notNull(), drugId: integer(), name: text().notNull(), role: text().notNull() },t=>[primaryKey({columns:[t.gen,t.id]}),index('cv_drug_report').on(t.gen,t.drugId,t.reportId),index('cv_report_drug').on(t.gen,t.reportId)]);
export const cvReactions = sqliteTable('cv_reactions', { gen: text().notNull(), id: integer().notNull(), reportId: integer().notNull(), term: text().notNull() },t=>[primaryKey({columns:[t.gen,t.id]}),index('cv_reaction_report').on(t.gen,t.reportId)]);
export const cvLinks = sqliteTable('cv_links', { gen: text().notNull(), id: integer().notNull(), reportId: integer().notNull(), target: text().notNull(), kind: text().notNull() },t=>[primaryKey({columns:[t.gen,t.id]}),index('cv_link_report').on(t.gen,t.reportId)]);

export const dpdStaging = sqliteTable('dpd_staging', { gen: text().notNull(), id: text().notNull(), data: text().notNull(), hash: text().notNull(), versionData: text().notNull() },t=>[primaryKey({columns:[t.gen,t.id]})]);

export const sourceBudget = sqliteTable('source_budget', { key: text().primaryKey(), window: integer().notNull(), count: integer().notNull() });

// One bounded check record per source; dataset publication dates remain in source_state.
export const updateRuns = sqliteTable('update_runs', {
  source: text().primaryKey(), runId: text().notNull(), started: text().notNull(), heartbeat: text().notNull(),
  finished: text(), lastSuccess: text(), outcome: text().notNull(), phase: text().notNull(),
  error: text(), cursor: text().notNull().default(''), details: text().notNull().default('{}'),
});
export const labelRefresh = sqliteTable('label_refresh', {
  setId: text().primaryKey(), cycle: text().notNull(), state: text().notNull(), attempts: integer().notNull().default(0),
  nextAttempt: integer().notNull().default(0), changed: integer().notNull().default(0), error: text(),
}, t=>[index('label_refresh_pending').on(t.cycle,t.state,t.nextAttempt)]);
