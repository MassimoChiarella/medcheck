# MedCheck platform audit — September 22, 2026

**Assessment: the main research workflows work, but the platform is not ready for an unqualified production sign-off.** Two high-priority defects affect dataset integrity and historical access. Further findings concern product matching, incomplete evidence, storage recovery, research-state preservation, accessibility, and query cost. Scheduled updates are currently skipped.

This audit made **no application fixes, deployment changes, scheduled-job changes, or synthetic production imports**. Live research requests may populate the application's normal caches and archives. One temporary browser bookmark was created, verified and removed. Import failures, races and storage limits were reproduced against isolated data. Findings below distinguish live observations, isolated reproductions, inspection, and forecasts.

## Scope and evidence

- Source baseline: [`08163870fa7123c5f5a889b2d31fb1b4cbc15c71`](https://github.com/MassimoChiarella/medcheck/commit/08163870fa7123c5f5a889b2d31fb1b4cbc15c71).
- Deployed target: [MedCheck research](https://medcheck-research.massimochiarella.chatgpt.site/), Sites version 7 at audit time.
- Reviewed React UI, research API, SPL parsing/diffs, source adapters, report matching, caching, SQLite/D1 schema, R2 archiving, Python importers, maintenance, local setup, update workflow, dependencies and operational status.
- Ran 38 bounded real research-API scenarios, isolated fault/race reproductions, and real browser workflows. No destructive live testing or traffic flood.
- Browser matrix: 11 views × 21 widths = **231 DOM geometry checks**, from 320 to 1920px, including boundaries around the application's responsive rules. Representative screenshots and accessibility trees supplemented the measurements. These are not 231 full visual tests.

| Validation | Result |
| --- | --- |
| Lint | Passed |
| TypeScript | Passed |
| Existing unit suites | 21 Node + 15 Python tests passed |
| Existing Worker integration suite | Passed |
| Production build through Sites helper | Passed |
| Research API scenarios | 29 HTTP 200, 8 expected validation HTTP 400, 1 unexpected HTTP 503 |
| Responsive matrix | No page-wide horizontal overflow observed |
| Captured live browser console | No warning/error entries returned |
| Official directory links | Six HEAD 200; three needed follow-up, all rendered/read successfully through browser/web retrieval |

Passing baseline tests does not invalidate the defects below: most were outside the existing regression coverage. The integration suite covered authentication, input bounds, idempotency, interrupted imports, promotion/rollback, snapshots, leases/checkpoints, source budgets, maintenance exclusion and storage ceilings. It did not fence a stale importer from all mutation endpoints.

Evidence files:

- [API scenarios](api-results.json), [additional edge scenarios](api-edge-results.json), [browser matrix and workflow observations](ui-audit.json).
- [Evidence reproductions](evidence-reproductions.cjs), [observed output](evidence-results.txt), [detailed evidence review](evidence-review.md).
- [Operations reproductions](operations-reproductions.mjs), [observed output](operations-results.txt).
- [Unit-test output](unit-tests.txt), [dependency audit](dependencies.json), [scheduled runs](update-workflow-runs.json), [link checks](source-links.json).

## Priority definitions

**P1:** repair before public launch; breaks a core integrity/history promise. **P2:** important correctness, resilience, accessibility or performance issue. **P3:** lower-impact usability/polish issue. A forecast or conditional finding is explicitly marked and is not claimed as a production incident.

## Data integrity and research correctness

### A01 — P1: An expired Canada Vigilance importer can replace a newer generation

**Evidence: isolated actual-handler reproduction.** Importer A staged May data, lost its source-check lease, and importer B published June data. A then successfully promoted its older generation. The active coverage regressed from June 30 to May 31.

The check lease does not fence `begin`, `batch` and `promote` mutations to the owning run. See [import route](../../app/api/import/route.ts#L104), [update client](../../scripts/update_run.py#L32), and [CV importer](../../scripts/import_canada.py#L192). A workflow mutex alone does not protect against another local/manual uploader or an old process resuming. The demonstrated regression is CV-specific; DPD completion has additional date guards, although ownership should be enforced consistently.

**Repair/acceptance:** carry the run ID and a fencing token through every mutation, reject expired ownership, abort uploads after heartbeat failure, and reject older normal promotions. Keep explicit rollback separate. Add the A-expired/B-promoted/A-resumed scenario to Worker integration tests.

### A02 — P1: Removal from a current US label blocks access to the stored product's history

**Evidence: isolated real-function reproduction plus route inspection.** A saved identity older than 24 hours must be found again in the current SPL. Replacing its NDC in the current document makes `getProduct` throw `This product is absent from the current label.` Every history/version/diff request passes through that gate. Stored historical information cannot be reached through those routes.

See [identity resolution](../../lib/server.ts#L123) and [route gate](../../app/api/research/route.ts#L14). The reproduction seeded the old product identity, not a complete historical database; the blocked-history conclusion follows directly from the shared route gate. This is particularly important for discontinued and reformulated products.

**Repair/acceptance:** separate durable identity from current market availability. Allow stored historical identity to resolve with an explicit removed/unavailable-current status, without presenting old composition as current. Test stored history and bookmarks after removal, unavailable current labels, and reintroduction.

### A03 — P2: Exact NDC search expands to other strengths

**Evidence: live API and fixture reproduction.** Searching `55154-4687` returns that 50 mg product plus `55154-4692`, a 100 mg product in the same SPL. Cards show the distinct strength/NDC, so this is visible over-inclusion, not an invisible substitution. The [search expansion](../../lib/server.ts#L68) loses the identifier filter after finding matching documents.

**Repair/acceptance:** filter the parsed products by the requested structured product/package NDC relationship. Cover leading zeros, normalized forms, package NDCs and multi-strength SPLs.

### A04 — P2: Long valid Canadian names can fail dictionary/search queries

**Evidence: live HTTP 503 for `reports&id=CA:942&source=CA`, supported by a provider-limit reproduction.** Its generic name, `EPINEPHRINE RACEMIC (RACEMIC EPINEPHRINE HYDROCHLORIDE)`, exceeds the available LIKE-pattern bound. [Dictionary matching](../../lib/evidence.ts#L58) and [fallback search](../../lib/server.ts#L163) wrap complete names in wildcards, while the API accepts up to 100 characters. D1 documents a 50-byte LIKE/GLOB pattern limit. [Cloudflare limits](https://developers.cloudflare.com/d1/platform/limits/).

The live error was sanitized; the precise database cause is inferred from code and the isolated limit reproduction, not a captured production stack trace.

**Repair/acceptance:** use an indexed normalized matching strategy that accommodates long and Unicode names; do not silently truncate coverage. Test long combinations and selected products whose generated dictionary terms exceed the byte limit.

### A05 — P2: Unsupported market parameters silently select US data

**Evidence: live API.** `market=GB` returned seven US products with a complete result. The [route](../../app/api/research/route.ts#L12) treats anything other than `CA` as `US`. The normal UI only offers US/CA, so this is an API-contract defect.

**Repair/acceptance:** explicitly validate the market enumeration; reject unsupported values instead of changing geographic scope.

### A06 — P2: Freshness/completeness information is lost at several boundaries

**Evidence: real-function reproductions and UI inspection.**

| Boundary | Failure |
| --- | --- |
| Canadian search | A stale saved product fulfills `caProduct`; search returns `complete`, empty notes and a new response time. Cards omit the product's stale flag. |
| Archived version | `getVersion` discards the archive loader's stale flag and retrieval time, so a failed revalidation appears complete. Immutable source bytes may still be correct; the lost information is failed verification. |
| FDA label and recall panels | API completeness can be stale, but panels use only notes/data. The heading still says “Current FDA label cross-reference” without displaying the failed refresh. |

Locations: [Canadian search](../../lib/server.ts#L117), [version loader](../../lib/server.ts#L135), [FDA adapters](../../lib/evidence.ts#L81), [panels](../../components/research-views.tsx#L47).

**Repair/acceptance:** propagate each source's original observation/retrieval time and completeness through aggregate results and UI. Keep effective/publication dates separate. Test mixed fresh/stale products, stale counts, failed archive revalidation and cached FDA results.

### A07 — P2: A failed label hides the other product's available pair evidence

**Evidence: isolated real-function reproduction.** The first label was available; the second returned 503; the whole evidence request rejected. [Evidence loading](../../lib/evidence.ts#L10) does not isolate failures per product.

**Repair/acceptance:** settle each product independently, retain readable passages, and mark the failed side and overall partial coverage explicitly. Test failures on either side and both sides. Never treat a failed side as having no warnings.

### A08 — P2: FDA duplicate-reference identifiers are discarded

**Evidence: isolated mapping reproduction.** A source `reportduplicate` reference was mapped to `duplicateLinks: []` by [fdaReport](../../lib/evidence.ts#L27). This loses useful provenance. It is separate from latest-version handling, which FDA provides upstream; the top-level `duplicate` flag must not be treated as a cross-case identity. [FDA field reference](https://open.fda.gov/fields/drugevent_reference.pdf).

**Repair/acceptance:** preserve duplicate-source/reference pairs without automatically merging incident counts. Test missing, multiple, repeated and ambiguous references.

### A09 — P2, conditional: Duplicate combination rows can satisfy both sides of a pair

**Evidence: function-level counterexample.** Two identical `COMBO` rows with ingredients `[A,B]` pass `distinctPairMatches` for selections A and B because only array position distinguishes records. See [matching logic](../../lib/core.ts#L79). The prevalence of this exact upstream shape was not measured; this is not a claim that the displayed live pair count is wrong.

**Repair/acceptance:** canonicalize duplicate medication identities and treat ambiguous combination records conservatively. Add duplicate-combination, overlapping-ingredient and brand/generic-alias tests while preserving legitimate two-medication records.

### A10 — P2 coverage gap: FDA search excludes reports lacking harmonized drug names

**Evidence: captured actual query and source documentation.** [Report queries](../../lib/evidence.ts#L33) search only `patient.drug.openfda.generic_name.exact` and `brand_name.exact`, not native `medicinalproduct` names. FDA states harmonization is incomplete, so these searches cover a subset. [openFDA harmonization](https://open.fda.gov/apis/openfda-fields/).

**Repair/acceptance:** disclose this specific limitation. Evaluate conservative exact native-name matching with separate scope notes and pair validation. Do not broaden names into claims of exact formulation exposure. Existing generic “partial” notes do not explain this exclusion.

## Archiving, storage and operation

### A11 — P2: An R2 outage can leave a Canadian snapshot permanently unarchived

**Evidence: isolated failure/retry reproduction.** [Snapshot persistence](../../lib/server.ts#L107) commits the product/version before the archive. An R2 failure leaves one committed version; retrying unchanged content performs zero archive writes because the hash already matches.

**Repair/acceptance:** archive before marking a version complete, or persist retryable archive state independently of content change. Recovery must verify source bytes exist and retry missing archives even when the product hash is unchanged.

### A12 — P2: Failed archive reservations survive a complete storage audit

**Evidence: isolated actual-code reproduction.** Two failed 4 MB writes left the R2 meter at 8 MB with no objects. Exclusive maintenance measured zero bytes but retained the 8 MB value through `MAX`. See [reservation](../../lib/storage.ts#L40) and [reconciliation](../../lib/maintenance.ts#L94).

**Repair/acceptance:** distinguish pending reservations from measured usage; safely reconcile under exclusive maintenance. Test failure before upload, ambiguous success, retries and interrupted audits. Otherwise outages can eventually block archiving despite available space.

### A13 — P2: Interactive writes bypass D1 capacity checks; cache retention is unbounded

**Evidence: isolated actual-code reproduction and inspection.** With the capacity guard rejecting growth, `cached` and `saveProduct` still inserted records. See [cache writes](../../lib/server.ts#L13), [product/version writes](../../lib/server.ts#L51), [guard](../../lib/storage.ts#L18). Cache TTL governs freshness, not deletion, so distinct searches/filters create indefinitely retained entries. A failed cache insert can also discard a successfully fetched upstream response.

**Repair/acceptance:** separate best-effort cache persistence from successful response delivery, impose cache retention/bounds, and consistently enforce growth policy for interactive writes. Preserve referenced historical records. Verify near-capacity behavior without enabling paid upgrades.

### A14 — P2 capacity forecast: Generation admission may overestimate growth after cleanup

**Evidence: SQLite experiment and sizing analysis, not a hosted failure.** Deleting old generations leaves reusable database pages. Admission adds the full new-generation estimate to physical database size without accounting for reusable space. In an isolated example a 6.21 MB file retained about 2.06 MB of free pages, which a replacement reused. Current snapshot size and generation estimates suggest repeated refreshes could be refused conservatively even after retention cleanup.

See [capacity calculation](../../lib/storage.ts#L13), [admission](../../app/api/import/route.ts#L110), [cleanup](../../lib/maintenance.ts#L53). Conversely, physical storage still matters to provider billing/limits; free pages must not be subtracted casually without confirming D1 behavior.

**Repair/acceptance:** measure at least three complete generation cycles on the actual hosting allowance, including interrupted staging and rollback retention. Establish peak physical size, reusable space, import duration and cleanup cost. No new full hosted import was performed in this audit.

### Operational release gate: Daily update jobs are skipped

**Evidence: six most recent scheduled GitHub runs, September 16–21, all skipped.** [Latest inspected run](https://github.com/MassimoChiarella/medcheck/actions/runs/35610157636). The [workflow condition](../../.github/workflows/update-data.yml#L12) requires `MEDCHECK_UPDATES_ENABLED=true` for scheduled execution. This is an activation/readiness gap, not necessarily an unintended code defect.

Live source cards reported Canadian imports on September 8. Canada Vigilance coverage was May 31, matching the [official source's currently advertised coverage](https://www.canada.ca/en/health-canada/services/drugs-health-products/medeffect-canada/adverse-reaction-database.html); skipped jobs alone do not prove newer Canadian data was missed.

**Release acceptance:** after A01 and storage recovery repairs, verify independent deployment credentials, execute one successful hosted update, verify unchanged-release and failure recovery, then enable the scheduled job and observe a successful scheduled run. Show scheduler health independently of dataset coverage. No scheduler setting was changed during this audit.

## UI, accessibility and research continuity

### A15 — P2: Research tabs discard filters and selections

**Evidence: live browser reproduction.** Apply a reaction and seriousness filter, switch to Label evidence, then return to Reported reactions: filter values reset. Canadian source/dictionary selection is also lost. Tabs unmount the stateful panel. See [product tabs](../../components/research-views.tsx#L43), [report state](../../components/research-views.tsx#L67), [comparison tabs](../../components/research-views.tsx#L74).

**Repair/acceptance:** retain research state per selected product/pair, preferably with URL-addressable filters. Switching tabs must not silently alter the population being studied; tests should cover applied versus draft filters and pagination.

### A16 — P2: Mobile navigation remains open over the selected destination

**Evidence: live browser at 390px.** Choose Sources from the mobile drawer: the main heading changes but the dialog remains open and focus stays inside it until Escape. [Navigation handler](../../components/medcheck.tsx#L30) sets the view without closing `openMobile`.

**Repair/acceptance:** close on successful navigation and move focus appropriately. Verify mouse/touch-equivalent activation, keyboard Enter and Escape at mobile/tablet boundaries.

### A17 — P2: Printed summaries omit collapsed evidence and inactive tabs

**Evidence: code and live DOM, not a rendered PDF.** [Print CSS](../../app/globals.css#L136) hides every closed `details`. Report cards default closed, most label sections are collapsed, and inactive tabs are unmounted. After opening one of 25 reports, 24 would be excluded by that rule. “Print summary” does not explain this scope.

**Repair/acceptance:** define an explicit printable evidence selection with product identity, filters, scope, dates, source identifiers and caveats. Expand/render the chosen evidence for print and verify multi-page PDFs at common paper sizes. Do not imply the print contains all source records.

### A18 — P2: Reversed chronological comparisons are accepted

**Evidence: live selections plus diff-logic inspection.** The UI permits version 9 (September 2026 publication) as “Earlier record” and version 8 (November 2025) as “Later record.” Neither the API nor [history controls](../../components/research-views.tsx#L54) validate direction. Added/removed labels then describe a backward comparison.

**Repair/acceptance:** enforce chronological order or explicitly label a reverse comparison. Cover effective versus publication dates, Canadian observation times and equal/unknown dates.

### A19 — P2: Malformed saved data can crash research rendering

**Evidence: static admission/render reproduction; no user storage was corrupted.** The [bookmark loader](../../components/medcheck.tsx#L19) accepts `{id:"CA:123",name:"Medication",ingredients:[]}`. Rendering dereferences missing `identifiers` in [ProductCard](../../components/research-views.tsx#L29).

**Repair/acceptance:** version and validate the saved shape, or save durable IDs plus minimal validated display metadata. Skip/quarantine invalid entries with a recoverable message. Test old schemas, missing fields, invalid JSON and storage denial.

### A20 — P2: Multiple tabs can overwrite each other's bookmarks

**Evidence: state-flow inspection.** Each tab loads once and writes its entire in-memory list. Starting with A in both tabs, saving B in one and C in another leaves A+C; B is lost. There is no storage-event synchronization. [Persistence](../../components/medcheck.tsx#L19).

**Repair/acceptance:** reconcile changes across tabs and define conflict behavior for save/remove. Add a two-tab regression test rather than relying only on single-tab reload persistence.

### A21 — P2: Several normal-text colors fall below contrast requirements

**Evidence: stylesheet color calculation.** Examples from [global styles](../../app/globals.css#L135):

| Text/background | Approximate contrast |
| --- | --- |
| Muted `#758693` / white | 3.76:1 |
| Muted `#758693` / workspace | 3.50:1 |
| Manufacturer `#80909d` / white | 3.28:1 |
| Report metadata `#8196a2` / white | 3.08:1 |
| Subtitle `#667a89` / workspace | 4.15:1 |

These are normal-size metadata/body text, for which WCAG AA requires 4.5:1. [W3C contrast criterion](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).

**Repair/acceptance:** darken semantic text tokens, verify actual rendered states/backgrounds and focus indicators, and test high-contrast modes. The rest of the interface was not certified WCAG-conformant by this audit.

### A22 — P3: Navigation semantics and recovery need improvement

**Evidence: live DOM and code.** There are two nested `main` landmarks ([SidebarInset](../../components/ui/sidebar.tsx#L305) and [workspace](../../components/medcheck.tsx#L33)), no skip link, and destination changes do not reliably move focus. Product/search/comparison state is not represented in URLs; refresh loses that research context and remounted search results reset pagination. Small-screen tabs scroll correctly, but the partly hidden final tab lacks a strong discoverability cue.

**Repair/acceptance:** one main landmark, a skip link, predictable focus placement, URL-backed navigable research state, and visible scroll affordance. Verify browser back/forward and keyboard focus after opening/closing a product, then complete screen-reader testing.

### A23 — P3: Empty history uses singular-record copy

**Evidence: inspection.** [History empty state](../../components/research-views.tsx#L54) uses `versions.length < 2`, so zero records displays “One record is available.” Separate zero, one, unavailable and comparison-ready states.

## Performance and dependency maintenance

### A24 — P2: A 25-report Canadian page issues 81 database statements

**Evidence: instrumented actual-function reproduction.** Seventy-five statements hydrate drugs, reactions and links individually for 25 reports; each report waits before the next starts. See [hydration loop](../../lib/evidence.ts#L76). The route's product lookup adds further work. The real page succeeded in 4.437 seconds; this audit did not observe a live query-limit error.

**Optimization:** fetch the three related tables once each for all page IDs and group in memory; reuse the count/chart result across pages for the same generation/filters. This removes 25 serial query waves. D1 currently documents 50 queries per Free invocation, so validate the actual Sites entitlement/enforcement as well as latency. [D1 limits](https://developers.cloudflare.com/d1/platform/limits/).

Measured API samples, including network and existing cache state:

| Request | Observed time |
| --- | --- |
| Initial inspected US report request | 13.394 s |
| Later US sertraline report request, different selected product | 2.144 s |
| Selected Canadian dictionary report page | 4.437 s |
| Canadian filter with no matched reports | 5.098 s |

These are single observations, not p50/p95 benchmarks or controlled cold-cache measurements. Further useful work: cache generation-scoped counts, profile dictionary scans and deep OFFSET pagination, bound cache growth (A13), and share retained client results across tabs (A15). Measure before changing dependencies or adding infrastructure. No sustained load test or complete bundle/Lighthouse audit was performed.

### A25 — P2 maintenance: Two vulnerable development-tool dependency chains

`npm audit` reported eight affected dependency nodes (four high, four moderate), representing **two advisory chains**, not eight independent vulnerabilities:

- `sharp`/libheif AVIF parsing through Miniflare/Wrangler tooling: [GHSA-rgj7-g3m4-5g8c](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c).
- Nested esbuild development-server behavior through Drizzle tooling: [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99).

No image-upload/sharp production path or use of the vulnerable esbuild serve API was found in the reviewed application. This audit did not demonstrate production exploitation. Upgrade compatible tooling, rebuild and rerun checks; do not apply a blind force-fix/downgrade.

## Security, evidence safeguards and checks that passed

- Import endpoints require authentication. Existing integration checks passed for unauthorized requests, bounded payloads, idempotent batches and explicit staging/promotion behavior.
- Upstream URLs use an allowlist, HTTPS, manual redirect handling, bounded reads, timeouts and request budgets. Credential-bearing redirects are not followed automatically.
- Reviewed SQL paths use bound values and controlled table names. There was no demonstrated SQL injection in the tested malformed identifier scenario.
- A pattern scan of 141 tracked files found no high-confidence GitHub/OpenAI/AWS credentials or private-key blocks; local secret files were not tracked. This was not a complete history scan, penetration test, or proof of absence of secrets.
- Live invalid IDs, out-of-range pages, too-short/too-long queries, impossible dates and reversed report date ranges were rejected. The long Canadian-name failure was returned as unavailable, not zero reports.
- The spelling feature returned a plausible correction for `sertaline`, none for nonsense, and no correction of a numeric DIN. US/Canadian search and a leading-zero DIN resolved real data. A combination-drug search returned distinct products.
- FDA/Canadian reports retained source identifiers and interpretation caveats. Event and reporter countries were distinct; missing event geography remained unknown. Canadian geography is supported by the source's published scope. [Health Canada overview](https://www.canada.ca/en/health-canada/services/drugs-health-products/medeffect-canada/adverse-reaction-database/overview.html).
- No inspected flow produced safety rankings, “safe together” assertions, global combined incident totals, or report-to-formulation attribution based only on receipt dates.
- Same-ingredient pair comparison returned an explicit ambiguity limitation. Canadian report-dictionary selection was required rather than treating DPD and CV identifiers as interchangeable.
- Actual US paired labels loaded with source links and named-term highlights, followed by separately labeled candidate reports. Charts expose textual terms and counts as well as bars.
- Archive fixture checks cover reordered ingredients, missing quantities/sections and another strength in the same SPL. A live administrative-only label update was not called a confirmed formulation change.
- Seven source cards identify WHO/EMA as external references and preserve Canadian attribution. A HEAD 404 from WHO was a false positive: its actual VigiAccess page rendered successfully. Both timed-out Canadian HEAD links were readable through follow-up web retrieval.

## Environment observations and limits

The pre-existing local preview at port 3001 had a roughly 2.19 GB database with older migrations: it lacked `update_runs`, causing its source-status route to return 503. The live source directory worked. This was treated as a local setup/state issue, not evidence of a deployed outage. The local database was read without mutation; the pre-existing server was left running.

Read-only Worker logs for the inspected seven-day window contained five canceled requests and two invocations serving a favicon 404. Canceled requests were not classified as application crashes. Raw logs and private headers were not saved. A favicon is minor polish, not a research failure.

Not completed: Safari/Firefox and physical devices; a full VoiceOver/NVDA run; zoom/forced-colors/reduced-motion certification; rendered PDF review; offline/throttled-network browser testing; concurrency/load benchmarks; exhaustive medication/locale/source-shape coverage; full historical clinical validation; a new complete hosted CV import or multi-generation capacity demonstration. Simulated failures and existing integration tests cover many of these failure classes, but do not replace those release checks. No finite audit can establish that every possible scenario is bug-free.

## Recommended repair and release order

1. **Integrity:** fence imports (A01), retain historical identity access (A02), recover missing archives (A11), reconcile reservations and enforce storage policy (A12–A14).
2. **Evidence correctness:** exact identifiers and market validation (A03–A05), freshness propagation and partial pair results (A06–A07), duplicate references/pair ambiguity/coverage (A08–A10), chronological comparisons (A18).
3. **User continuity and accessibility:** filters, drawer, printable scope, bookmark validation/synchronization, contrast and navigation (A15–A23).
4. **Efficiency and maintenance:** batch Canadian queries (A24), profile remaining slow queries, upgrade tooling (A25), rerun unit/integration/build checks and add regressions for every repaired defect.
5. **Release validation:** cross-engine/device and assistive-technology checks, real print review, measured repeated full imports within provisioned free allowances, verified hosted update recovery, then activate and observe scheduled updates.

Keep these as separate reviewable changes. Do not combine the audit evidence commit with unrelated app fixes, dataset replacement or a deployment.

## Reproducing the isolated findings

From the repository root after installing the locked dependencies, with Node supporting `node:sqlite` (tested here on Node 26.2):

```sh
node audit/2026-09-22/evidence-reproductions.cjs
node audit/2026-09-22/operations-reproductions.mjs
```

The scripts log observed behavior of the audited code; they are diagnostic reproductions, not new passing regression assertions. They do not require deployment credentials. After fixes, replace/augment them with assertions of the desired behavior in the regular test suite.

The optional API probe reads connection JSON from stdin and never stores the authorization token. It makes bounded research requests only, which can populate normal application caches. Use your own deployment/access credentials; never commit or place them in shell history. Saved API artifacts contain compact public-source metadata, not full patient report bodies.
