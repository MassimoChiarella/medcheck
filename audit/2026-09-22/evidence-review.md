# MedCheck evidence/search audit — 2026-09-22

Read-only audit of the checked-out implementation. No application files, deployed resources, or production data were changed. Reproductions transpile the actual TypeScript functions in memory, use the checked-in real Sertraline SPL, and supply bounded synthetic upstream/DB responses. Runnable evidence: `audit/2026-09-22/evidence-reproductions.cjs` (`node audit/2026-09-22/evidence-reproductions.cjs` from the repository root after installing project dependencies). Captured output: `audit/2026-09-22/evidence-results.txt`. These establish logic defects, not the prevalence of each upstream condition in production.

## Prioritized findings

### E1 — P1: A removed US product loses access to its already indexed history

- Location: `lib/server.ts:123`–125; entry gate `app/api/research/route.ts:14`.
- Every history, version, diff, report, and evidence action first calls getProduct. Saved identity is usable for only 24 hours, after which the product must still be present in the current SPL. If a label removes an NDC, getProduct throws even though products and versions retain the historical identity/data.
- Reproduction: persist the fixture product `US:7e5e76cf-2fda-4f9d-bcbf-f77b1f188ee6:55154-4687` with a two-day-old observed time; refresh a valid SPL in which that NDC is replaced. getProduct throws `This product is absent from the current label.` The history function is never reached.
- Impact: the exact products most relevant to historical-change/discontinuation research become inaccessible, including bookmarks.
- Correction: resolve durable product identity independently of latest availability; return the saved identity with an explicit removed/currently-unavailable status, while letting version/history queries proceed. Do not present historical composition as current.

### E2 — P2: Exact NDC searches return unrelated strengths from the same SPL

- Location: `lib/server.ts:68`–72.
- The listing query filters by NDC, but the response expands every product in every matched SPL without filtering to the identifier.
- Reproduction with the real fixture: search `55154-4687` returns both `55154-4687` (50 mg) and `55154-4692` (100 mg), completeness `complete`.
- Impact: an identifier intended to select a precise product presents additional strengths as matches. Each card identifies its NDC, so this is not an invisible substitution, but it undermines the exact-identity search contract.
- Correction: retain the exact matched product; resolve package NDCs to their product NDC using explicit structured packaging relationships, preserving leading zeros. Test product and package identifiers separately.

### E3 — P2: Stale Canadian search products are reported as a fresh complete result

- Locations: `lib/server.ts:117`–119 and 158–159.
- caProduct catches live failures and resolves a saved product with dataStatus `stale`. liveSearchCA treats all fulfilled promises as successful and creates a fresh `complete` result with no notes.
- Reproduction: fresh brand listing + failing detail endpoints + saved product yields `{completeness:'complete',notes:[],data[0].dataStatus:'stale',fetchedAt:<now>}`.
- Impact: users cannot distinguish a fresh search listing from stale composition/manufacturer details. The search cards do not display dataStatus.
- Correction: aggregate per-product completeness and original observation times, and explain which fields could not refresh. Also apply consistently to stale US label/listing results (currently reported only as partial with notes).

### E4 — P2: Cached archived versions lose stale status

- Location: `lib/server.ts:135`.
- loadLabel returns `{value,stale,fetched}`, but getVersion returns the nested ProductVersion unchanged. The diff route checks before/after completeness, which never receives the stale flag.
- Reproduction: expire an archived cache entry (400 days), make the source fail, getVersion returns completeness `complete`, notes `[]`.
- Impact: version comparisons do not disclose that source verification failed. This does not itself make immutable historical content wrong, but violates the explicit provenance/completeness contract.
- Correction: propagate cached observation time, stale status and a refresh note; preserve both publication/effective dates and retrieval dates.

### E5 — P2: One failed label prevents all readable pair evidence from being shown

- Location: `lib/evidence.ts:10`.
- currentVersion is awaited inside the loop with no per-product error handling. If either source fails, the whole request throws and previously collected readable sections are discarded.
- Reproduction: first product's label available in cache; second label returns 503. evidence([first,second]) rejects `Source temporarily unavailable (HTTP 503).`
- Impact: users cannot read the available half of a comparison and receive no precise per-product coverage report.
- Correction: settle labels independently, return readable sections plus product-specific unavailable notes, overall partial/stale/unavailable according to actual coverage. Keep failed side explicit, never imply no warnings.

### E6 — P2: FDA duplicate/reference links are discarded

- Location: `lib/evidence.ts:27`.
- fdaReport unconditionally assigns duplicateLinks `[]` rather than mapping reportduplicate records.
- Reproduction: a valid-shaped source report containing `reportduplicate:[{duplicatesource:'Regulator',duplicatenumb:'OTHER-123'}]` becomes a ReportSummary with no duplicate links.
- Impact: provenance that helps researchers spot linked submissions is lost, despite the original plan requiring known duplicate links to be preserved. This is separate from latest-version handling; FDA already returns the latest version.
- Correction: retain source duplicate reference identifiers and source labels without assuming they prove two safetyreportid values are the same incident.
- Official field reference: https://open.fda.gov/fields/drugevent_reference.pdf . Note that the top-level `duplicate` flag means earlier versions were submitted, and must not itself be treated as a cross-case duplicate link.

### E7 — P2: Long valid Canadian queries exceed D1's LIKE-pattern limit

- Locations: `app/api/research/route.ts:11`; `lib/server.ts:163`–167; `lib/evidence.ts:58`.
- Search accepts 100 characters; fallback name matching and CV dictionary matching wrap full names in `%...%`. D1 documents a maximum 50-byte LIKE/GLOB pattern. A 49-character ASCII name already produces 51 bytes; Unicode reaches the ceiling earlier.
- Reproduction: SQLite with SQLITE_LIMIT_LIKE_PATTERN_LENGTH=50, `SELECT 'a' LIKE '%' || <49-character name> || '%'` returns `LIKE or GLOB pattern too complex`. The deployed API also returned HTTP 503 for `action=reports&id=CA:942&source=CA`, recorded in `audit/2026-09-22/api-edge-results.json`. This product's generic name exceeds the pattern bound. The deployed error is sanitized, so attribution to the LIKE limit is an inference supported by code and the isolated provider-limit reproduction, not an observed raw production database error.
- Impact: long combination/generic names can fail with a service error exactly when live Canadian sources are unavailable; CV dictionary matching can fail even for selected valid products whose stored names are long.
- Correction: use suitable normalized search fields/full substring matching without the LIKE pattern ceiling, or bounded token candidates with exact post-filtering. Do not silently truncate query/coverage.
- Official limit: https://developers.cloudflare.com/d1/platform/limits/ .

## Performance and coverage findings

### E8 — High-impact optimization: 81 sequentially coordinated D1 queries for a 25-report Canadian page

- Location: `lib/evidence.ts:75`–77.
- Reproduction counts 81 D1 statements with an already selected single dictionary ID; 75 are the three per-report hydration queries. The outer loop waits before starting the next report. The research route's getProduct adds more work.
- Replace per-report hydration with three queries across the 25 report IDs, then group in memory. This bounds the cost and removes 25 serial network waves. It also reduces provider-limit risk: D1 docs currently list 50 queries/invocation for Free. The Workers limits page distinguishes internal-service subrequests, so verify actual hosting entitlements/enforcement rather than claiming the deployed Site has already hit this limit.
- Source: https://developers.cloudflare.com/d1/platform/limits/ .

### E9 — Coverage gap: FDA searches exclude native medicinalproduct-only reports

- Location: `lib/evidence.ts:33`.
- Captured query only includes patient.drug.openfda.generic_name.exact and brand_name.exact; never patient.drug.medicinalproduct. The mapper does use medicinalproduct after retrieval, so it can display these records but does not search them.
- FDA documents that some records never have openfda harmonization and searches against these fields cover only a subset. Current generic completeness caveats do not explain this specific exclusion.
- Recommendation: evaluate exact native reported-name matching alongside harmonized names, preserving conservative product/combination and distinct-medicine checks; at minimum explicitly state the harmonized-only coverage in result/source notes. Never infer exact formulation exposure from raw names.
- Source: https://open.fda.gov/apis/openfda-fields/ .

### E10 — Pair-validation edge case: duplicated combination rows satisfy two sides

- Location: `lib/core.ts:79`–82.
- Reproduction: distinctPairMatches([{name:'COMBO',ingredients:['A','B']},{name:'COMBO',ingredients:['A','B']}],['A'],['B']) returns true. Only array position distinguishes the records.
- Impact: if the source supplies duplicated/multi-ingredient rows in this form, one combination medicine can masquerade as two distinct selected medicines. This is a function-level counterexample; the prevalence of this exact harmonized shape was not measured in real FDA reports.
- Recommendation: treat duplicate normalized medicine identities and records matching both disjoint sides as ambiguous; add a regression case. Existing tests cover one combination record and overlapping selected aliases, but not this duplicate-row shape.

## Checked behavior / false positives ruled out

- CV `eventCountry:'Canada'` is supported by Health Canada's published Online Database scope: Canadian-marketed health products with events occurring in Canada, and the extract is its full dataset. Keep documenting this as source-scope-derived geography; do not file it as invented geography. https://www.canada.ca/en/health-canada/services/drugs-health-products/medeffect-canada/adverse-reaction-database/overview.html .
- FDA latest-version handling is supported upstream; the field reference says openFDA returns only the latest source report version. latestCases additionally deduplicates the returned page by authority + case ID.
- CV duplicate/linked report IDs are kept and counts are clearly described as reports, not worldwide unique incidents; not a demonstrated deduplication error.
- Current source code does not turn missing warnings into “safe together,” compute comparative safety rankings, or assign event reports to formulations using receipt dates. US/CA authority and market are separated.
- Historical ingredient comparisons enforce identical productId and structured product strengths; existing fixture checks cover a change to another strength, reordered inactive ingredients, missing structured sections, and active-moiety identifiers.

## Test coverage gaps

Current tests mostly cover core parser helpers and import lifecycle. There are no committed endpoint tests for stale-per-product aggregation, exact NDC result filtering, deleted-current-product historical access, per-side evidence failure, FDA duplicate-reference mapping, query count, long D1 patterns, native-name report coverage, or duplicate combination medication rows. Existing spelling tests cover distance thresholds and empty-state gating, but do not test upstream source verification or human-product filtering.
