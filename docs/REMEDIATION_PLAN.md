# MedCheck audit remediation development plan

Status: **ready for implementation; implementation has not started**. Date: 2026-09-22.

Authority: [technical specification](REMEDIATION_SPEC.md), [completed audit](../audit/2026-09-22/README.md), audit commit `1042011`. This plan supersedes earlier roadmap ordering for audit remediation; [UPDATE_PLAN.md](../UPDATE_PLAN.md) remains the historical record of previously delivered update work. Its checked boxes do not close the new audit findings.

## 1. Delivery approach

Deliver eight phases, with 28 bounded subphases. Commit and push each coherent, validated implementation slice; do not wait for all fixes to land in one commit. The recommended sequence protects data first, then repairs evidence semantics, research continuity and presentation, and finally qualifies the complete release.

The task that creates this plan changes documentation only. Every implementation subphase below starts **not started**. A later executor records its commit, test evidence, remaining blockers and actual status here or in a linked remediation validation ledger. Do not check off an item solely because code exists or an audit reproduction stopped printing an error.

Roles describe responsibilities, not assumed staffing: **backend/data**, **frontend**, and **release/QA**. One developer can fulfill all roles. Parallelism is useful only where ownership of shared files/contracts is clear.

| Phase | Purpose | Primary responsibility | Entry dependency | Exit gate |
| --- | --- | --- | --- | --- |
| 0 | Lock contracts, baseline and disposable test environments | Backend/data + release/QA | Existing audit | G0: reproducible baseline and feasible transaction/storage design |
| 1 | Stop stale publication and preserve historical identity | Backend/data | G0 | G1: P1 regressions fixed in real Worker integration |
| 2 | Make archive recovery and storage bounds reliable | Backend/data | G1; identity before eviction | G2: recoverable archives and bounded persistence |
| 3 | Correct search, evidence and report execution | Backend/data + frontend integration | Shared contracts; G2 for new cache/index growth | G3: semantic/API regressions and query budgets pass |
| 4 | Preserve research and saved work | Frontend | G1 identity + G3 contracts | G4: state and concurrent bookmark workflows pass |
| 5 | Complete navigation, accessibility and print behavior | Frontend + release/QA | G4; evidence metadata ready | G5: accessible workflows and rendered summaries pass |
| 6 | Qualify efficiency, dependencies, capacity and installation | Release/QA + backend/data | Functional fixes stable | G6: complete-data, clean-install and dependency evidence |
| 7 | Verify release, recovery and scheduled operation | Release/QA | G1–G6 | G7: verified private candidate; authorized launch and observed scheduled success |

G7 has two distinct milestones: private release verification can finish before public launch; launch/scheduler verification remains pending until launch is authorized and a real scheduled run completes.

## 2. Phase 0 — Baseline and implementation contracts

### 0.1 Freeze evidence and define shared interfaces

- Preserve the audit directory as historical evidence; create a new remediation validation ledger with baseline commit and source-generation identifiers.
- Inventory source/status/history callers; agree the availability, source-observation, typed-error, import-fence, archive-reference and research-state contracts in the technical specification.
- Record exact existing storage/byte limits and measurement provenance. Separate application limits from provider entitlement.
- Convert audit reproductions into named expected-behavior regression cases within the normal test structure as their fixes are developed. Never add failing assertions to the default branch without the corresponding fix.

**Acceptance:** each A01–A25 has an owner area, test ID and destination subphase; no unknown field meaning or false claim of completed remediation. **Commit:** `docs(remediation): lock contracts and acceptance baseline`.

### 0.2 Establish safe test environments and feasibility probes

- Use disposable local Worker D1/R2 for synthetic concurrency/fault tests, preserving the existing user database/server.
- Prove atomic guarded D1 publication, ownership loss during an R2 await, and archive write-admission/reconciliation semantics before building on them.
- Define an isolated complete-data qualification target with measured free allowances and a bounded storage/request/runtime budget. Do not provision paid resources as a workaround.
- Define the repeatable browser protocol and fixtures. Use available browser automation for targeted workflows; add a maintained browser-test dependency only if the existing tooling cannot make the tests repeatable, and record that decision.

**Acceptance:** failed/stale guards leave no partial publication, uncertain remote writes remain accounted for, and the test destination cannot be mistaken for production. An unavailable hosted qualification target/allowance is recorded as a G6/launch blocker; it does not prevent G0 or independently testable local fixes. **Commit:** `test(remediation): establish isolated fault and browser acceptance harnesses`. **Gate G0.**

## 3. Phase 1 — Critical integrity and historical access

### 1.1 Add ownership schema and fail-closed import protocol

- Add lease epoch, staging owner fields and protocol capability/version response through additive migrations.
- Preserve completed generations and read-only older clients; require ownership/protocol fields for mutations after enforcement.
- Test active retry, expired-run resurrection, old-client errors, source mismatch and staged-generation adoption.

**Acceptance:** mutations cannot opt out of fencing; migration preserves existing complete data. **Commit:** `feat(import): version ownership protocol and staging leases`. Covers **A01**, tests **T01/T26**.

### 1.2 Fence all mutation paths and stop stale producers

- Guard CV/DPD batches, publication, raw archives, checkpoint/failure writes, label refresh and maintenance at the actual mutation boundary.
- Add producer cancellation on lease failure and idempotent acknowledged-batch resumption.
- Require non-regressing normal promotion, permit verified same-cutoff corrections, preserve explicit authenticated rollback.
- Update manual/local/Actions callers together; keep scheduled execution disabled.

**Acceptance:** A-expired/B-published/A-resumed cannot regress data; takeover during upload cannot publish; stale error reporting cannot replace a newer success; accepted-but-lost response retries count once. **Commit:** `fix(import): fence publication and cancel expired producers`. Covers **A01**, tests **T01**.

### 1.3 Restore durable historical access and comparison direction

- Resolve stored product identity independently of current listing availability, retaining observation metadata and exact NDC identity.
- Enable stored version/history access when current label verification fails or removes the product; disclose incomplete local history.
- Validate US version sequence and Canadian observation order in API and controls; separate zero/one/unavailable states at the data boundary.

**Acceptance:** archived removed products remain researchable, old composition is not labeled current, reintroduction preserves history, and reversed comparisons cannot mislabel additions/removals. **Commit:** `fix(history): preserve removed products and validate version order`. Covers **A02/A18**, tests **T02/T18**. **Gate G1.**

Phase 1.3 can proceed in parallel with 1.1–1.2 after shared contracts settle; coordinate edits in `lib/server.ts` and research routes.

## 4. Phase 2 — Archives, reservations and bounded persistence

### 2.1 Publish verified archives and reconcile existing gaps

- Add durable immutable archive reference/write metadata and distinguish raw hashes from normalized product hashes.
- Verify archive presence on unchanged retries; publish product/version references coherently after verification.
- Provide bounded reconciliation for existing gaps, marking unrecoverable historical bytes honestly instead of substituting new bytes.

**Acceptance:** failed upload, lost response, failed DB commit, repeated retry and concurrent same-content refresh preserve one correct occurrence/reference; A→B→A remains three events. **Commit:** `fix(archive): recover missing product source documents`. Covers **A11**, tests **T11**.

### 2.2 Reconcile archive reservations under a proven barrier

- Separate committed usage from per-object pending/uncertain reservations; migrate the anonymous meter out of ordinary cache eviction.
- Block new write admission, account for in-flight writes, resume scans and fence the final accounting update.
- Resolve confirmed failures without retaining phantom bytes; preserve unresolved remote-write uncertainty until reconciled.

**Acceptance:** the two-failed-writes/empty-bucket reproduction reaches zero once failure is proven; uncertain success counts once; maintenance takeover/interruption cannot undercount or remove referenced evidence. **Commit:** `fix(storage): reconcile archive reservations safely`. Covers **A12**, tests **T12**.

### 2.3 Bound interactive growth and retain successful research responses

- Apply shared capacity admission to interactive product/version/cache writes, including concurrent import reservations.
- Add bounded namespace-aware cache retention and stale fallback; protect durable source/history references and operational state.
- Separate upstream success from cache-write success and expose relevant persistence limitations.

**Acceptance:** at capacity, successful source reads still return; history and previous complete datasets remain usable; simultaneous writes respect policy; eviction cannot remove the sole historical access path. **Commit:** `fix(cache): enforce storage budgets without losing source responses`. Covers **A13**, tests **T13**.

### 2.4 Instrument capacity and establish conservative admission

- Record measured physical, reserved, reusable and archive bytes plus import/cleanup work.
- Test bounded replacement/staging recovery locally and establish hosted qualification measurements without assuming free-page credit.
- Set documented cache budgets from the measured installation budget, leaving explicit import/rollback headroom.

**Acceptance:** no guessed free allowance, silent truncation or unmeasured admission relaxation; qualification blockers are recorded for phase 6.3. **Commit:** `feat(storage): expose capacity qualification measurements`. Covers **A14**, tests **T14**. **Gate G2.**

## 5. Phase 3 — Search, evidence and reports

### 3.1 Validate API inputs and exact product/package identifiers

- Add strict enum/error contracts including malformed dictionary selections.
- Parse product/package NDC relationships and apply identifier filtering after SPL discovery; preserve leading zeros and explicit ambiguity.
- Require human-product verification for suggestions and explain filtered source pages with further pagination.

**Acceptance:** exact NDC returns the correct strength; supported package forms resolve through evidence; unsupported markets never default silently; invalid API values have clear HTTP 400 errors. **Commit:** `fix(search): enforce exact identities and request validation`. Covers **A03/A05/X04/X05**, tests **T03/T05/T28**.

### 3.2 Support long Canadian names without truncated matching

- Replace unbounded LIKE patterns consistently across catalogue fallback, dictionary matching and suggestions.
- Backfill normalized terms safely where needed, preserve exact and partial-name coverage, and profile on the complete index.
- Account for schema/index growth and update transformation version if imported semantics change.

**Acceptance:** CA:942 and boundary/Unicode cases work; wildcard characters are literal; pagination does not silently omit matches; backfill is resumable. **Commit:** `fix(search): support long Canadian medication names`. Covers **A04**, tests **T04/T14**.

### 3.3 Propagate source status and keep partial pair evidence

- Add per-source observations through adapters, cache fallbacks, result aggregation and all affected UI panels.
- Resolve pair labels/terminology independently; retain available passages and disclose the unavailable side.
- Remove redundant missing-warning messages for known combined section layouts.

**Acceptance:** mixed freshness and coverage are visible; original dates survive; current labels are not falsely claimed; failure on either side never discards the other readable label. **Commit:** `fix(evidence): preserve provenance and partial label coverage`. Covers **A06/A07/X06**, tests **T06/T07/T29**.

### 3.4 Preserve duplicate references and distinct medicine identity

- Map source reference metadata without merging unrelated case counts.
- Canonicalize duplicated combination/alias rows conservatively; retain valid separate medicine pairs.
- Keep upstream candidate counts distinct from locally verified page records.

**Acceptance:** duplicate COMBO rows cannot satisfy A/B; genuine A+B and AB+C cases still work; linked reference identifiers survive mapping. **Commit:** `fix(reports): retain references and reject ambiguous pairs`. Covers **A08/A09**, tests **T08/T09**.

### 3.5 Batch Canadian report hydration and reuse bounded aggregates

- Replace 75 per-report hydration queries with three page-wide queries and deterministic grouping.
- Pin one generation; prevent cleanup from removing data still needed by a bounded request.
- Cache exact totals/charts by generation and canonical applied filters under phase-2 retention rules.

**Acceptance:** constant query budget and identical expected case/reaction/link output; empty pages skip hydration; promotion/cleanup and aggregate cache invalidation never mix generations. **Commit:** `perf(reports): batch Canadian pages and generation-scoped counts`. Covers **A24**, tests **T24**.

### 3.6 Resolve FDA native-name coverage deliberately

- Ship explicit harmonization/alias scope in API, UI and print metadata.
- Validate native exact-name field/query semantics with bounded representative cases, including combinations and both-source matches.
- Implement a consistent union query only if precision and aggregate semantics pass; otherwise record the validated limitation and no-go rationale.

**Acceptance:** no hidden exclusion, duplicated counts, fuzzy-name safety implication or unexplained expansion; T10 records either validated implementation or explicit supported-scope closure. **Commit:** `fix(reports): make FDA matching coverage explicit` (separate optional validated native-query implementation commit). Covers **A10**, tests **T10**. **Gate G3.**

## 6. Phase 4 — Research continuity and bookmarks

### 4.1 Preserve applied/draft state and navigable research context

- Introduce validated bounded research state keyed by exact product/pair and reporting source.
- Add versioned URL-fragment navigation, back/forward restoration and reload rehydration.
- Retain drafts, applied filters, dictionary selections, versions and pages across tabs; retain/cancel requests by exact applied key.

**Acceptance:** the user returns to the same research population; unrelated products cannot inherit incompatible selections; direct links and invalid URL state recover safely; no draft/secret/bookmark list enters navigable URLs. **Commit:** `fix(research): preserve filters and navigable context`. Covers **A15/A22**, tests **T15/T22**.

### 4.2 Migrate validated bookmarks with concurrent per-record writes

- Implement a small native IndexedDB store and transactional once-only legacy migration; no library or service.
- Use per-product writes with an enforced cap, visible persistence errors and cross-tab invalidation/focus refresh.
- Re-resolve durable product IDs when opened and display saved metadata's date/availability honestly.

**Acceptance:** malformed legacy records cannot crash or erase valid research; two-tab add/remove scenarios preserve unrelated entries; failed migration preserves its backup; removed products open through the phase-1 path. **Commit:** `fix(bookmarks): validate and synchronize device-local saves`. Covers **A19/A20**, tests **T19/T20**. **Gate G4.**

## 7. Phase 5 — Accessible interaction and printable evidence

### 5.1 Repair navigation, focus, contrast and mobile tab affordances

- Close mobile navigation after selection, manage focus intentionally, provide one main landmark and a skip link.
- Update low-contrast semantic text colors and verify non-color indicators, keyboard focus, forced colors and reduced motion.
- Make horizontally scrollable tabs discoverable/reachable without changing the information architecture.

**Acceptance:** no lingering modal/focus trap; keyboard destination/return works; required contrast verified against rendered backgrounds; 200% text enlargement remains usable. **Commit:** `fix(a11y): improve navigation focus and readable contrast`. Covers **A16/A21/A22**, tests **T16/T21/T22**.

### 5.2 Add an explicitly scoped printable summary

- Build the print model from applied state and source observations, with bounded section/page selection and preview.
- Include selected collapsed evidence, source identifiers/URLs, dates, limitations and count-versus-page scope.
- Verify real A4/Letter PDFs with long labels and multiple reports; correct layout/omission defects.

**Acceptance:** every selected section appears regardless of normal UI collapse/mount state; incomplete loading is explicit; no hidden claim that the full report database is included. **Commit:** `fix(print): render complete evidence for the selected scope`. Covers **A17**, tests **T17**.

### 5.3 Finish empty-state and metadata polish

- Finish distinct zero/one/unavailable history presentation and disabled comparison controls.
- Verify the filtered non-human search-page copy, combined-warning copy and friendly API error states already introduced.
- Add/repair the existing-brand favicon and its metadata path.

**Acceptance:** no zero-record screen says one record; source failures remain distinguishable from no matches; favicon request resolves. **Commit:** `fix(ui): clarify empty states and site metadata`. Covers **A23/X03–X06**, tests **T23/T27–T29**. **Gate G5.**

## 8. Phase 6 — Production qualification

### 6.1 Upgrade affected tooling without unsafe forced changes

- Recheck the two audited advisory chains, select compatible versions and update the lockfile.
- Verify Node/Python supported versions, setup, dev Worker, integration and production build.
- Record any remaining advisory, reachable usage and decision; do not report eight independent CVEs from eight dependency nodes.

**Acceptance:** affected reachable paths are resolved; any retained advisory has reviewed evidence and explicit disposition. **Commit:** `chore(deps): resolve audited tooling advisories`. Covers **A25**, tests **T25**. This isolated slice may move earlier after G0 when it does not disrupt integrity work.

### 6.2 Measure latency, query plans, bundles and bounded concurrency

- Run identical-request cold/warm measurements, query-budget assertions and capped isolated concurrency.
- Profile long-name matching, count aggregates and deep report pagination; optimize only measured bottlenecks without losing coverage.
- Inspect shipped assets/bundle and avoid redundant tab fetches; document useful optimizations or supported no-change decisions.

**Acceptance:** controlled results satisfy the agreed performance targets/budgets or identify a remaining release blocker; no production traffic stress or unsupported p95 claims. **Commit:** `perf(research): address measured remaining bottlenecks` plus validation evidence. Covers **A04/A13/A15/A24/X08**, tests **T24/T30**.

### 6.3 Demonstrate complete multi-generation capacity and recovery

- Execute the three complete real-data qualification cycles specified in the technical specification within a prechecked free allowance.
- Include previous-generation retention, staging interruption/resume, rollback, unchanged checks, cleanup, archive uncertainty and new search indexes/caches.
- Adjust admission only if actual hosted measurements establish a safe calculation; otherwise keep conservative limits and report the blocker.

**Acceptance:** full required index and history protection fit the provisioned execution/storage budget; all manifest counts and source hashes reconcile; no sample replacement. **Commit:** `docs(validation): record full dataset capacity and recovery evidence` and a separate admission-fix commit only if supported. Covers **A14**, tests **T14**.

### 6.4 Verify migration/setup isolation and security controls

- Test clean clone, known legacy local database, interrupted migration and unknown schema; improve missing-migration diagnostics where necessary.
- Confirm each installation generates/uses its own keys and cannot inherit the original owner's upload destination through environment variables.
- Review authentication, SQL/URL boundaries, credential redaction, git-history secret patterns, dependencies and test artifact contents. Broaden beyond the audit's working-tree-only pattern scan without claiming penetration-test certification.

**Acceptance:** old user data is preserved, new clones work independently, no untrusted migration adoption or secret-bearing artifacts; tests cannot accidentally target the review/live site. **Commit:** `fix(setup): preserve legacy data and diagnose schema readiness` plus security validation record. Covers **X02/X08**, tests **T26/T31**. **Gate G6.**

## 9. Phase 7 — Release checks, rehearsal and activation

### 7.1 Complete browser/device/accessibility/source validation

- Repeat the 11-view × 21-width matrix and representative screenshots with all repaired workflows, long names, large fonts and expanded evidence.
- Exercise current Chromium, Firefox and Safari/WebKit; use at least one physical iOS and Android device for touch, viewport, keyboard and storage behavior. Record versions/devices actually tested.
- Run VoiceOver and NVDA representative workflows, 200% zoom/text enlargement, forced colors, reduced motion, offline/throttled requests and interrupted navigation.
- Repeat source links using GET/render follow-up when HEAD fails; inspect print artifacts, source caveats, actual real-data counts and stale/unavailable UI.

**Acceptance:** no unresolved functional/accessibility regression in required workflows. Unavailable devices/tools are explicit outstanding checks, not passes. **Commit:** `docs(validation): record cross-browser and accessibility acceptance`. Covers **X07/X08**, tests **T17/T21/T22/T32**.

### 7.2 Build and privately deploy the complete release candidate

- Run lint, types, Node/Python tests, disposable Worker integration and production build on the final candidate commit.
- Package additive migrations and publish through Sites to the private review target; verify migrated existing data and real source requests.
- Re-run the bounded 38-scenario audit matrix, repaired edge cases, direct research links, bookmarks, comparisons and printing against the candidate.
- Record release identity, hashes, migration state, rollback target and the complete closure ledger.

**Acceptance:** all implementation findings are closed with evidence or explicitly blocked; no known P1/P2 defect ships silently. **Commit:** `docs(release): record private candidate verification`. No public visibility change occurs here.

### 7.3 Rehearse hosted updates and distinguish scheduler health

- Verify current GitHub access and installation-specific secrets/configuration without exposing values. If the historical authentication blocker remains, report the precise missing capability.
- Run a successful full/manual hosted update, unchanged cycle and safe recovery exercise; preserve last-good data.
- Verify source attempt/check/import/coverage dates and operator schedule status, including unknown/skipped states.

**Acceptance:** authenticated automated execution works on this installation; failures are visible; free allowances remain sufficient; no schedule is enabled yet. **Commit:** `fix(ops): expose update readiness and verify hosted execution`. Covers **X01**, tests **T33**.

### 7.4 Activate only with authorized public launch and verify a scheduled run

- Confirm all release gates, rollback instructions and public-launch authorization are satisfied.
- Enable the existing repository schedule gate with launch; use the existing workflow, not a separate automation service.
- Observe a real scheduled run, verify source-specific outcomes and unchanged/updated results, then record its URL/time. A delayed/disabled/failed run remains unresolved and triggers diagnosis.
- Confirm the documented disable/recovery procedure and owner-only failure visibility. Do not add patient-facing alerts.

**Acceptance:** public release and scheduled success are independently evidenced. If launch has not been authorized, stop at a verified private candidate and leave this subphase pending. **Commit:** `docs(release): record launch and verified scheduled updates`. Covers **X01**, tests **T33**. **Gate G7.**

## 10. Finding-to-work traceability

All listed phases reference requirements in [REMEDIATION_SPEC.md](REMEDIATION_SPEC.md). Conditional findings may close through documented measurement or a validated limited-scope decision where explicitly allowed; they cannot disappear from the ledger.

| Audit ID | Finding | Specification section | Primary subphase(s) | Acceptance ID |
| --- | --- | --- | --- | --- |
| A01 | Expired importer regresses active data | 3 | 1.1–1.2 | T01 |
| A02 | Removed product blocks stored history | 2.1, 4 | 1.3 | T02 |
| A03 | Exact NDC includes sibling strengths | 6.1 | 3.1 | T03 |
| A04 | Long Canadian names exceed matching limits | 6.1 | 3.2, 6.2 | T04 |
| A05 | Unknown market silently becomes US | 2.3 | 3.1 | T05 |
| A06 | Freshness/coverage metadata is lost | 2.2 | 3.3 | T06 |
| A07 | One failed label hides other evidence | 6.2 | 3.3 | T07 |
| A08 | FDA duplicate references discarded | 7.1 | 3.4 | T08 |
| A09 | Duplicate combination rows satisfy pair | 7.1 | 3.4 | T09 |
| A10 | Harmonized-only FDA coverage hidden | 7.2 | 3.6 | T10 |
| A11 | Canadian snapshots remain unarchived after failure | 5.1 | 2.1 | T11 |
| A12 | Failed archive reservations never reconciled | 5.2 | 2.2 | T12 |
| A13 | Interactive capacity bypass and unbounded cache | 5.3 | 2.3 | T13 |
| A14 | Replacement capacity forecast/qualification | 5.4 | 2.4, 6.3 | T14 |
| A15 | Tabs discard research state | 8.1 | 4.1 | T15 |
| A16 | Mobile drawer stays open | 9.1 | 5.1 | T16 |
| A17 | Print omits selected evidence | 9.2 | 5.2 | T17 |
| A18 | Reversed chronology accepted | 4 | 1.3 | T18 |
| A19 | Malformed bookmarks crash rendering | 8.2 | 4.2 | T19 |
| A20 | Cross-tab bookmarks overwrite unrelated saves | 8.2 | 4.2 | T20 |
| A21 | Text contrast below target | 9.1 | 5.1 | T21 |
| A22 | Landmarks, navigation recovery, tab discoverability | 8.1, 9.1 | 4.1, 5.1 | T22 |
| A23 | Zero history says one record | 4, 9.1 | 5.3 | T23 |
| A24 | Canadian query amplification and latency | 7.3, 10 | 3.5, 6.2 | T24 |
| A25 | Vulnerable tooling dependency chains | 10 | 6.1 | T25 |

Supporting observations and audit coverage gaps are also retained:

| ID | Observation/action | Subphase(s) | Acceptance |
| --- | --- | --- | --- |
| X01 | Skipped schedule, historical GitHub permission blocker, manual/recovery/scheduled verification | 7.3–7.4 | T33 |
| X02 | Existing local preview lacked newer migrations; preserve and migrate safely | 6.4 | T26 |
| X03 | Favicon 404 | 5.3 | T27 |
| X04 | Malformed dictionary JSON exposes parser wording | 3.1, 5.3 | T28 |
| X05 | Non-human filtered page can be empty with more pages; suggestions need human-product validation | 3.1, 5.3 | T03/T28 |
| X06 | Combined warning sections generate redundant extraction notices | 3.3, 5.3 | T29 |
| X07 | HEAD false positives/timeouts in official-link checks | 7.1 | GET/render follow-up, no link replacement without confirmation |
| X08 | Cross-engine/device/assistive tech/print/offline/load/bundle/security-history and full-capacity gaps | 5.2, 6.2–6.4, 7.1 | T14/T17/T30–T32 |

Five canceled Worker requests in the audit were **not confirmed crashes**; no speculative crash fix is assigned. Missing Canadian retrospective formulation history, WHO/EMA external-only access, source reporting limitations and upstream coverage dates remain documented product constraints, not promises to ingest unavailable data. Existing correct behaviors in the audit are regression invariants, not extra feature requests.

## 11. Acceptance catalogue

Tests should assert required behavior of public/shared boundaries, not mirror implementation details. Extend the existing Node/Python suites and disposable Worker integration before adding infrastructure. Browser cases need recorded steps/automation and resulting state, not only screenshots.

| Test | Required scenarios and pass condition | Level |
| --- | --- | --- |
| T01 | Expired A/new B/resumed A; takeover during R2; stale fail/checkpoint; concurrent promotion; lost acknowledgement; missing/wrong epoch; same-cutoff correction; explicit rollback; DPD A→B→A | Worker + Python |
| T02 | Old identity + removed NDC/whole-label 404/outage; seeded stored versions and real fixture archive; bookmark reopen; reintroduction; no local history; no sibling substitution | Adapter + Worker + UI |
| T03 | Product/package NDC, leading zeros, two strengths, ambiguous undelimited codes, multiple legitimate SPLs, human filtering and suggestion verification | Parser + API |
| T04 | 49/50/>50 UTF-8-byte names, 100-character allowed query, Unicode, literal wildcards, combinations, CA:942, full paging/backfill consistency | API + complete-data |
| T05 | Explicit US/CA valid; documented omitted default; unknown/empty unsupported enums, source and seriousness rejected before upstream work | API |
| T06 | Fresh/stale/missing parts; stale archive verification; fresh rows/stale counts; FDA label/recall stale; unknown dates; preservation of effective/coverage/observation dates | Adapter + UI |
| T07 | Left/right/both failures, supplementary terminology failure, Canadian monograph limitation; available passages retained and failed sides named | Adapter + UI |
| T08 | Missing/repeated/multiple/malformed references and source-label differences; no count merging; latest case version retained | Mapping |
| T09 | Duplicate COMBO and alias/ingredient-order/role variants rejected; genuine A+B and selected AB+C retained; candidate/page scopes explicit | Matching + API |
| T10 | Native-only/harmonized-only/both; combinations/aliases; case deduplication; aggregate/query consistency; bounded evidence for go/no-go | Source contract + API |
| T11 | Upload fail/lost response/DB fail; unchanged repair; same normalized/different raw bytes; concurrent refresh; unrecoverable historical bytes flagged | Worker + R2 faults |
| T12 | Confirmed failed writes reconcile zero; uncertain success counted once; same-key race; in-flight upload at scan start; stale maintenance; interrupted scan; protected evidence | Worker + R2 faults |
| T13 | Fresh fetch/cache failure; concurrent interactive/import growth; bounded eviction; stale fallback; protected control/history; read-only capacity behavior | Worker |
| T14 | Three complete isolated generation cycles; counts/hashes; peak physical/reserved bytes; interruptions, retention/rollback, unchanged checks; actual free allowance | Hosted qualification |
| T15 | Draft/applied filters, source, dictionary IDs, page and versions survive tabs; product/pair changes reset only incompatible context; aborted responses cannot overwrite newer results | Browser |
| T16 | Mobile pointer/Enter navigation, same destination, Escape, trigger/destination focus, breakpoint changes, no lingering modal | Browser |
| T17 | Selected collapsed sections, inactive chosen sections, 25-report page scope, missing sections, long passages/URLs, A4/Letter rendered PDFs | Browser + artifact inspection |
| T18 | Reversed/same US versions, Canadian occurrences, equal or conflicting dates, unknown order, other product identity; consistent UI/API rejection | Core + API + UI |
| T19 | Invalid JSON/shape/ID/schema, duplicate legacy IDs, partial valid list, denied/quota storage, migration interruption/rollback, blocked upgrade/versionchange, removed product | Storage + browser |
| T20 | Same-origin two-tab unrelated add/add and add/remove, same-ID save/remove, concurrent migration/no legacy re-import, cap race, event/focus/visibility refresh, failed write not shown saved; separate-profile isolation | Two tabs in one browser context/profile; separate profile for isolation |
| T21 | Rendered normal-text contrast, required focus/non-text states, non-color meaning, 200% zoom/text, forced-colors and reduced motion | Computed + visual/accessibility |
| T22 | One main + skip link; open/back destination focus; fragment validation/length; reload/back/forward/page restoration; last mobile tab reachable | Browser + assistive tech |
| T23 | Zero, one, unavailable, partial and comparable histories; correct copy and disabled controls | UI |
| T24 | Three hydration statements; constant total budget; row associations, empty page, duplicates/links; generation promotion/cleanup; count cache invalidation | Instrumented Worker |
| T25 | Current dependency audit, vulnerable-path reachability, compatible lockfile, supported runtime setup/build/Worker checks | Tooling + CI |
| T26 | Clean/legacy/partial/unknown schemas, migration interruption, protocol version mismatch and new/old client read compatibility | Local + Worker |
| T27 | Favicon/metadata URLs return valid assets without runtime errors | HTTP + browser |
| T28 | Friendly malformed dictionary input; non-human empty page with more results; close-spelling/nonsense/numeric/source-failure suggestion behavior | API + UI |
| T29 | Combined versus separate warnings; true extraction gaps stay visible; class references remain readable | Fixture + UI |
| T30 | Fixed identical cold/warm requests, query plans, bounded concurrency, network/bundle profile, offline/slow/error/cancel UX, measured budget | Isolated performance + browser |
| T31 | Unrelated inherited secrets/destination, own-install keys, unauthorized mutations, source allowlist/redirects, secret redaction/history scan, private artifacts absent from Git | Setup + security review |
| T32 | Eleven views × 21 widths; representative Chromium/Firefox/Safari, physical mobile, VoiceOver/NVDA, layout and keyboard regression matrix | Release QA |
| T33 | Actual GitHub access; manual success, unchanged and failed/recovered run; distinct status dates; unknown/skipped schedule; actual scheduled success; disable/recovery procedure | Hosted operations |

Retain baseline regressions for ingredient additions/reordering/missing quantities, unavailable archives, administrative edits, other-strength changes, latest cases, duplicates, overlapping aliases, geography, source outages, import retries/atomic promotion and rollback. The new suite adds to those guarantees rather than replacing them.

## 12. Git, migration and rollout policy

- Use `codex/` branches for implementation work; keep each change reviewable and independently validated. Push incremental commits after their relevant checks pass. Use PRs when that is the chosen review flow and attach them to the task. Do not force-push shared history.
- Suggested commit boundaries above are logical slices, not a requirement to make a migration-only commit deployable. Pair schema and consuming code where separating them would create a broken intermediate state; use additive fields so older reads still work.
- Each commit/PR records problem → resulting behavior, finding/test IDs, validation, migration/backfill requirements and rollback implications. Avoid unrelated refactors and generated dataset/build artifacts.
- Before private deployment, take and verify a supported backup/export/recovery point within the actual allowance. Preserve source archives and the retained complete generation; record restore procedure and test it in isolation.
- Apply additive migrations before enforcement/backfill. Backfills are resumable, bounded and observably complete. Do not run an unbounded migration over millions of rows in a request.
- Disable update execution before operational migrations/rehearsal. During deployment, preserve read availability where possible and expose maintenance limitations explicitly.
- Roll back application behavior to a known compatible **fenced** version; use forward corrective migrations rather than dropping history/schema in production. Roll back dataset pointers only through the authenticated verified mechanism.
- After each phase, update a ledger row with status (`not started`, `in progress`, `implemented`, `verified`, `blocked`), commit/PR, test artifact and blocker. Only `verified` closes a finding.

## 13. Decisions and external blockers

| Decision or dependency | Required resolution | What continues while unresolved |
| --- | --- | --- |
| Actual free Sites/fork capacity | Measure before full qualification; if insufficient, record exact blocker without sampling or paid upgrade | Code, local tests and private read workflows |
| Guarded D1 mutation and R2 barrier technique | Prove G0 integration; no assumed cross-store transaction | Identity, API contracts and bounded frontend work |
| FDA native-name precision | Bounded investigation + documented implementation or supported-scope limitation | Harmonized coverage disclosure and other fixes |
| Bookmark storage choice | Native IndexedDB chosen for atomic cap/migration/per-ID writes; retain no-dependency implementation | Other frontend work |
| GitHub secret/variable/dispatch permissions | Recheck; reconnect with required access only if still blocked | All local/code/private validation not requiring dispatch |
| Device/assistive-technology availability | Obtain test access or report that named gate pending | All reproducible automated checks |
| Public launch timing | Requires launch authorization; this planning request does not itself change visibility | Verified private release and manual update rehearsal |

The completion package is the repaired code, updated independent-install documentation, finding closure ledger, regression/QA/performance/capacity evidence, private release record and—when authorized and observed—public launch/scheduler record. No finding, optimization investigation or remaining audit check may be silently omitted.
