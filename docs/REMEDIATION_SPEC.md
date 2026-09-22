# MedCheck remediation technical specification

Status: **specified, not implemented**. Date: 2026-09-22. Baseline: audit commit `1042011`, application baseline `0816387`.

This specification implements the findings in the [platform audit](../audit/2026-09-22/README.md). The companion [development plan](REMEDIATION_PLAN.md) defines ordering, commit boundaries, acceptance gates and complete finding traceability. Historical audit evidence remains unchanged. Neither this document nor its publication claims that a defect is fixed or authorizes a paid upgrade or a public launch.

## 1. Scope and constraints

Retain the existing React/TypeScript application, server-side research routes, Sites Worker, D1, R2, streaming Python importers and GitHub Actions workflow. Reuse existing components, source adapters, test infrastructure and dependencies. Do not introduce an AI dependency, accounts, a new backend service, patient notifications, additional data markets or a clinical interaction scoring system.

The following are non-negotiable acceptance invariants:

1. Resolve exact products by market, source identifiers, manufacturer, strength, form and route. Preserve identifiers as strings, including leading zeros. A shared name is not evidence of interchangeability.
2. Distinguish listed changes from explicitly confirmed formulation changes. Do not assign reports to a formulation using receipt dates.
3. Preserve effective, publication, observation, retrieval, source-coverage and case-receipt dates separately. Missing dates/geography remain unknown.
4. Missing, partial, stale and unavailable evidence never means no risk, no interactions or no reports. Label passages and adverse-event observations remain separate.
5. Count source cases at their latest supplied version; preserve known reference links without inventing cross-database incident identities. Never sum sources into worldwide unique incidents.
6. Preserve complete Canadian coverage, last-good generations and referenced historical evidence. Capacity failure is explicit; it cannot silently cause truncation, samples, deleted history or a paid upgrade.
7. Each installation uses its own credentials, storage and source pulls. Research/bookmarks stay device-local except for the source queries necessary to retrieve evidence. No original-owner service becomes a required dependency.
8. A successful source retrieval and a successful local persistence operation are separate facts. Do not claim archival reproducibility before source bytes have been verified.

## 2. Shared contracts and compatibility

### 2.1 Product identity and present availability — A02, A03, A06

Extend `Product` additively with current-label availability metadata:

```ts
type CurrentAvailability = 'present' | 'absent-from-current-label' | 'unknown';
type AvailabilityObservation = {
  state: CurrentAvailability;
  checkedAt?: string;
  sourceUrl?: string;
  note?: string;
};
```

Do not overwrite Health Canada's existing marketing `status` with this field. Absence from an SPL does not prove regulatory discontinuation. Older stored products lacking the field mean `unknown` until verified.

`getProduct` resolves durable identity first. A saved identity remains usable after its refresh interval even if a current SPL omits that NDC or the source is unavailable. Return its original observation date and the current verification outcome. Never replace it with a neighboring strength or another manufacturer's product. A valid but entirely unknown identity remains unavailable.

History/version/diff routes use durable identity. When upstream history metadata fails, return known stored versions with explicit partial coverage. A successfully fetched current document that omits the product must not supply that product's old composition under a current heading. Reintroduction updates availability without changing the durable ID or erasing intervening history.

### 2.2 Source observations and aggregate state — A06, A07, A10

Keep `Result.completeness` for compatibility and add an optional array of source observations. Backfill observations at adapter boundaries, not through guessed dates in view components.

```ts
type SourceObservation = {
  source: string;
  part: 'product' | 'history' | 'archive' | 'label' | 'reports' | 'counts' | 'recalls' | 'terminology';
  productId?: string;
  sourceUrl?: string;
  identifiers?: Record<string, string>;
  availability: 'available' | 'unavailable';
  freshness: 'fresh' | 'stale' | 'unknown';
  coverage: 'complete-for-query' | 'partial' | 'unknown';
  retrievedAt?: string;
  verifiedAt?: string;
  sourceAsOf?: string;
  notes: string[];
};
```

The exact field names may follow existing conventions, but these distinctions and their tests are required. `retrievedAt` belongs to the actual retrieved bytes; `verifiedAt` may advance after a successful conditional verification. Neither substitutes for source coverage or a label's effective date. `fetchedAt` remains a compatibility field derived from represented source retrievals, never silently reset to response-construction time for stale content. Add `generatedAt` if a response-generation time is needed.

Aggregation rules:

| Condition | Compatibility completeness | Required presentation |
| --- | --- | --- |
| No usable requested evidence because sources failed | `unavailable` | Failure/coverage explanation; no synthetic zero |
| Any returned required content is stale | `stale` | Original date plus per-part gaps, including partial coverage |
| Usable content, but a required part is absent or coverage is limited | `partial` | Identify missing products, sections or populations |
| All required parts retrieved and complete within the explicitly bounded query | `complete` | Scope remains visible; not a claim of global medical completeness |
| Successful source query returns zero matching records | State based on that source's coverage | Explicit no-match message and safety caveat |

Report rows and chart counts carry separate observations. Fresh rows cannot make stale counts look fresh, and failed counts cannot discard valid rows. All search, history/diff, evidence, FDA-label, recall and report views consume the same small status/date presentation helper.

### 2.3 Input and error contracts — A05 and supporting hardening

Retain existing endpoint actions and payload shapes where possible. Add typed error codes instead of classifying errors through regex matching arbitrary exception messages.

- Omitted market/report source may retain the documented US default; explicitly supplied unknown values return HTTP 400. Validate `action`, `market`, `source`, `serious`, page bounds, dates, version identifiers and dictionary-array shape before upstream work.
- Parse invalid `cvIds` as a clear validation error, not raw JSON-parser wording. Retain existing query bounds without treating long valid Unicode medication names as invalid merely to accommodate database LIKE limits.
- Use stable codes such as `INVALID_INPUT`, `PRODUCT_UNAVAILABLE`, `SOURCE_UNAVAILABLE`, `LEASE_CONFLICT`, `CLIENT_PROTOCOL_UNSUPPORTED` and `CAPACITY_LIMIT`. Research unavailability remains visibly distinct from a successful empty result.
- Preserve meaningful upstream retry timing. Retain redaction, `no-store`, controlled source URLs and bounded downloads; never expose SQL, credentials or raw internal exceptions.
- Additive research fields must work with existing stored JSON. New import mutation requirements are intentionally fail-closed and require the coordinated protocol rollout below.

## 3. Import ownership and publication — A01

Affected code: `lib/updates.ts`, `app/api/import/route.ts`, `lib/refresh.ts`, `lib/maintenance.ts`, `scripts/update_run.py`, `scripts/import_canada.py`, `scripts/import_products.py`, importer upload helpers and integration fixtures.

### 3.1 Ownership protocol

Introduce server-owned, monotonically increasing `leaseEpoch` on `update_runs`. A new accepted lease increments it; same-attempt retries return the same active epoch. An expired run ID cannot resurrect its old authority. Clients begin a new attempt with a new run ID.

The authenticated bootstrap `check-begin` supplies `{protocolVersion, source, runId}` and obtains its epoch from the server. Every subsequent mutation, heartbeat and finish supplies `{protocolVersion, source, runId, leaseEpoch}` in the authenticated body or bounded upload headers. This tuple is **not a replacement credential**. Store owner run/epoch on staging imports. A capability/status response exposes the required protocol version so outdated clients receive an actionable upgrade error before downloading large releases.

Fence every mutation: staging begin/adoption, batch writes, raw-source chunks/manifests, DPD application/completion, CV promotion, failure/checkpoint writes, refresh checkpoints, cleanup, retirement and explicit rollback. Read-only status remains compatible. Server-internal interactive archival writes use the archive write protocol in section 5 rather than pretending to own an importer lease.

### 3.2 Atomicity requirements

An initial ownership SELECT followed by an unguarded mutation is insufficient. Revalidate at the actual D1 write/publication boundary and after upstream/R2 awaits. State changes and ownership validation must occur in the same guarded transaction/batch; loss of ownership must leave **zero partial publication changes**. In particular, do not retire the active generation before discovering that the new owner guard failed.

Use D1's supported batch transaction mechanism, not assumed interactive `BEGIN`/`COMMIT` support across requests. Validate the chosen guarded-SQL implementation against the real Worker binding before enabling it. A zero-row guard must abort/neutralize the whole mutation, not merely one statement. [D1 batch documentation](https://developers.cloudflare.com/d1/worker-api/d1-database/).

Never hold a database transaction across a network or R2 operation. Immutable staged artifacts can survive an aborted owner; only a current owner may publish them after verification.

### 3.3 Resumption, chronology and rollback

- A new lease may explicitly adopt an incomplete generation whose dataset hash, transformation version, manifest and acknowledged batches match. Adoption transfers ownership atomically; the old owner receives 409 thereafter.
- Idempotent retries with the same owner and payload do not duplicate rows or source objects. Mismatched retry payloads fail.
- Normal CV promotion rejects coverage older than the currently active generation. Equal coverage dates can be legitimate corrected releases: allow distinct verified content under current ownership and record the correction. Do not order release freshness lexically by content hash.
- Explicit rollback requires authenticated current ownership, verified retained completeness and a recorded operator action. Scheduled code cannot call rollback to bypass promotion rules.
- Heartbeat failure stops the Python producer before starting another batch, chunk or retry; cancel queued work. In-flight requests remain governed by the server fence. A stale failure callback cannot overwrite a newer run's success.

### 3.4 Rollout

Deploy additive schema, upgrade bundled clients, then enforce the new mutation protocol while scheduled execution stays disabled. Existing complete generations remain readable. Legacy staging work is adopted only through explicit verified resumption. Never reopen unguarded writes for compatibility. Code rollback after enforcement must use a known fenced release, not the original vulnerable server.

## 4. Durable product history — A02, A18

Keep the existing `products`/`versions` records and stable IDs. Historical availability cannot depend on an unexpired current-label cache. Read known archives by version/reference even when current source verification fails. If a required historic document has not been archived and upstream is unavailable, label that version unavailable rather than borrow content from another version.

Validate comparison identity and ordering in the shared comparison service as well as controls:

- US: use validated SPL version sequence for ordering within the same set/product; display publication and effective dates separately. A later version may have an earlier effective date, which is not a reason to reverse version order.
- Canada: order distinct observation occurrences by their validated observation sequence/time. Preserve A→B→A as three occurrences. Reject equal/reversed selections with an actionable message.
- When an ordering field is unknown or inconsistent, disable directional “added/removed” conclusions until order is established; keep each source document readable.
- Zero records, one record, unavailable history and two comparable records have different copy and controls.

Do this before pruning parsed label caches: a cache must never be the only remaining access path to published history.

## 5. Archive consistency and capacity — A11–A14

Affected code: `lib/server.ts`, `lib/storage.ts`, `lib/maintenance.ts`, schema/migrations, import/refresh handlers and maintenance scripts.

### 5.1 Recoverable archival publication

For new Canadian observations, verify the exact source payload archive before declaring the version durably archived. Preserve separate hashes for normalized product identity/change detection and exact archived bytes. A normalized-content hash is not proof of a raw-byte archive.

Use a small durable archive-write record keyed by immutable object key, with expected hash/bytes, owner/write ID, state (`pending`, `verified`, `failed` or `uncertain`), timestamps and reference metadata. New Canadian object keys incorporate the exact payload-byte hash, not merely the normalized product hash; differing raw payloads with the same parsed composition cannot overwrite each other. Preserve existing keys as legacy references. Pending/uncertain bytes remain reserved. Existing hash equality must not skip verification of a missing archive.

Commit product/version occurrence and its verified archive reference coherently after upload verification. If R2 succeeds and D1 fails, the same immutable object is reused on retry. If source retrieval succeeds but storage fails, the current read may still be shown with a persistence limitation; do not claim its bytes/history have been archived.

Repair existing gaps with a bounded, resumable reconciliation task. Re-fetching changed source content cannot recreate missing historical bytes: mark those historical archives unavailable, and create a new observation where appropriate. Preserve A→B→A and avoid duplicate occurrences from concurrent identical refreshes.

### 5.2 Reservation accounting and reconciliation

Replace the anonymous cumulative R2 counter with measured committed bytes plus identifiable pending reservations in dedicated operational storage. Retrying the same immutable key charges growth once. Verify hash and byte length before settling an uncertain write; never blindly release a reservation merely because the caller timed out.

Maintenance establishes a write-admission barrier, accounts for/drains registered in-flight writes and fences completion to the current maintenance owner. A preliminary `noMaintenance()` check is not a barrier for a write already awaiting R2. A complete scan can lower the meter only after this exclusion condition is proven; an interrupted scan never publishes a partial total.

An uncertain write must be reconciled through confirmed object state or an idempotent retry of the same immutable bytes. An object confirmed present is counted once; a demonstrably failed completed write can release its reservation. A lease timeout alone is not proof that a remote write cannot finish late. If uncertainty remains, expose unresolved reservations and keep accounting conservative instead of declaring an exact total.

Backfill the new meter using a fenced full scan before enabling new accounting. Preserve referenced objects, current/previous generations and completed raw-source manifests. Separate reclaimable staging artifacts from historical evidence.

### 5.3 Database growth and cache policy

All product/version/cache growth paths use one capacity policy that includes active import reservations and bounded concurrent interactive reservations. A check-then-write calculation alone cannot promise a race-free application ceiling. Reserve anticipated growth atomically, enforce bounded serialized sizes, reconcile reservations after success/failure and validate the policy under concurrent near-limit tests. The provider's actual physical limit remains the final ceiling.

Cache policy is namespace-aware:

- Ordinary upstream/search and report count caches: retain bounded fresh/stale entries with explicit expiry and maximum byte/entry budgets; sweep oldest expired entries in bounded batches. Select final budget values from phase-0 measurements and store/document them per installation.
- Parsed archived labels: evict only when the durable source reference and a tested rehydration path remain available. Never delete the sole stored history to make a cache target pass.
- Operational state: migrate meters/reservations out of general response cache; never evict leases, source budgets or control records as ordinary cache entries.
- Successful upstream responses survive best-effort cache-write failure. Record a persistence warning only where it changes reproducibility/history, not as a misleading source failure.
- At capacity, keep previous complete datasets and readable evidence. Expose the storage blocker to operators; no automated upgrade or coverage reduction.

### 5.4 Capacity qualification

The application's existing 8 GB ceilings are policy ceilings, **not proof of free provider entitlement**. Reconfirm the actual Sites allocation and each independent install's limits. Ordinary D1 Free has a documented 500 MB per-database limit, which does not fit the previously measured complete Canadian index. Do not assume a fork can host that index on ordinary D1 Free. [D1 limits](https://developers.cloudflare.com/d1/platform/limits/).

Before relaxing admission estimates, measure at least three complete generation cycles in an isolated qualification deployment with the same relevant bindings/allowances. Use complete real releases; repeated identical releases require an explicit qualification mechanism and must not weaken normal production idempotency. If only one release is available, replay it only in isolation with documented qualification generation identities. Never fake newer source coverage.

Record physical bytes, reusable pages where verifiable, staged/reserved bytes, current and rollback generations, R2 committed/pending bytes, import time, query/CPU costs and cleanup duration. Include interrupted staging, unchanged checks, rollback retention and archival repair. Do not subtract SQLite free pages from provider-billed physical size or assume hosted `VACUUM` support.

If the full required workload cannot fit free provisioned allowances, keep the last good data, record the exact capacity blocker and leave launch gated. No sample replacement, table omission or automatic paid plan change is an acceptable completion path.

## 6. Product search and evidence extraction — A03–A07

### 6.1 Identifiers and long names

Add structured product-to-package NDC relationships during SPL parsing; currently only product NDC is retained. Exact product or package identifier queries filter parsed products using these relationships. Do not infer arbitrary package suffixes, coerce codes to numbers or claim an ambiguous unhyphenated code resolves uniquely. Return explicit choices for genuinely ambiguous identifiers. Human-product filtering also applies to spelling-candidate verification.

Replace unbounded wildcard-pattern construction in Canadian fallback and dictionary matching. Start with normalized exact/prefix candidates and literal substring matching (`instr` on the consistently normalized representation) where needed; then measure on the complete catalogue/dictionary. Preserve literal `%`/`_` handling and Unicode normalization. Add an index only when the query plan/measurement justifies it; a table scan is not automatically acceptable solely because it avoids an error. If bounded candidate retrieval is used, post-filter and paginate without silently dropping legitimate matches.

Apply the same normalization and bounds to direct search, spelling verification, dictionary matching and importer-populated fields. Persist any new normalized columns via resumable backfill or generation transformation, incrementing `TRANSFORM_VERSION` when imported semantics change.

### 6.2 Partial label evidence

Resolve each product label independently. Return successful passages even when the other side fails; each requested product has an explicit coverage observation. Terminology failure may disable supplementary aliases/highlighting but must not hide a readable label. Raw label passages remain available when class references cannot be resolved.

Treat combined “Warnings and precautions” and separate “Warnings”/“Precautions” as alternative documented structures. Do not show redundant missing-section alerts when a recognized combined section is present. Truly unavailable material remains explicit. Highlighting continues to identify textual matches, not adjudicated interactions.

Search pages containing only filtered non-human documents must not suggest that no further human matches exist when more source pages remain. Explain the filtered-page scope and retain usable pagination; avoid unbounded scanning across all source pages.

## 7. Report matching, references and query cost — A08–A10, A24

### 7.1 References and distinct medicines

Map source duplicate/reference pairs into normalized, source-labeled reference entries. Keep the existing `duplicateLinks` display-compatible field during migration if a structured representation is added. Deduplicate identical references; do not turn a reference or FDA's top-level duplicate flag into an automatic incident merge.

Canonicalize reported medicine identity before testing pair membership. Duplicate normalized medicine rows do not become two medicines merely because their array indexes differ. Records matching both selected disjoint sides are ambiguous and cannot independently satisfy both. Preserve valid two-drug records and distinguish ambiguous candidate totals from validated page summaries. Never deduplicate distinct source case IDs solely because medicine text matches.

### 7.2 FDA search coverage decision

In harmonized-only mode, explicitly disclose that queries can omit native-name-only reports. If a validated native-name union is introduced, replace that disclosure with the actual expanded matching scope and remaining limits; never keep a now-false exclusion statement. Retain full-product/generic-name rules for fixed combinations and the ambiguity guard for overlapping selections.

Run a bounded contract/precision investigation of exact native `medicinalproduct` matching using official field semantics and known real examples. If a native-name path can be validated, query the union consistently for rows and aggregates, deduplicate by source case ID/latest supplied version, and label the broader match scope. Do not add separately queried totals or imply manufacturer/formulation precision from a reported name.

If upstream query semantics or precision cannot support that path, retain harmonized-only results with explicit UI/API scope and document the evidence-based no-go decision. A10 cannot close with an unexplained deferral. This specification does not promise complete pharmacovigilance coverage. [openFDA harmonization](https://open.fda.gov/apis/openfda-fields/).

### 7.3 Canadian query batching and consistent generations

Pin one CV generation for the complete request. Fetch one report page, then its drugs, reactions and linked references in **three queries over those page IDs**, grouping results in memory. Twenty-five IDs plus a generation parameter fit within D1's documented 100 bound-parameter limit. Preserve deterministic order and single-case counting. Do not issue one query triplet per report. [D1 limits](https://developers.cloudflare.com/d1/platform/limits/).

Target at most 12 D1 statements inside the selected-dictionary `caReports` path for one/two medicines and at most 20 for the full warm research request, excluding measured cold upstream persistence. These are implementation acceptance budgets, not existing measurements. Count all statements, including those inside batches. No query may approach the invocation allowance by design.

Reuse exact totals and reaction aggregates across pages with a bounded cache key containing generation, normalized selected dictionary IDs, source, receipt dates, seriousness, reaction and matching algorithm version. Page is excluded. Changed generation/matching semantics cannot reuse old counts. Preserve separate counts freshness metadata.

Retention/cleanup must keep a generation alive for the maximum bounded in-flight research window, or use a small read lease if that cannot be guaranteed. If generation consistency is lost, retry the entire request against one generation; never combine old rows with new counts. Cache policy from section 5 applies.

Measure query plans and deep pagination on the complete dataset. Only introduce keyset pagination if OFFSET cost is material; keep API/URL compatibility and document the decision. Do not add indexes without counting their import/write/storage cost.

## 8. Research state and bookmarks — A15, A19, A20, A22

### 8.1 Navigable research state

Define a validated versioned `ResearchState`: workspace view, market, submitted query, selected product ID, ordered comparison IDs, active panel, history versions, applied report source/filters/dictionary IDs and page. Draft form values are separate and never become the applied population until submission. State is keyed by product/pair so switching tabs retains the correct research context.

Use native browser history with a versioned URL **fragment** for navigable research state. It avoids putting that context in the ordinary document request/referrer, but it is still visible in browser history and copied links and is not confidential storage. Do not include credentials, bookmark collections or draft keystrokes. Network research requests still carry the necessary query to this installation/source services.

Use `pushState` for intentional navigation/submissions and `replaceState` for canonicalization/defaults; handle browser back/forward without a reload loop. Validate URL state as untrusted input and fetch identities by ID. Reload restores the selected research context while explaining unavailable products or outdated dictionary selections. Retain request cancellation/out-of-order protections.

Lift panel state/results into the selected research session or use installed tab retention where sufficient; do not keep every historical panel/query mounted forever. Returning to a tab reuses its bounded result until freshness policy requires refresh. Changing a product/pair resets incompatible filters/IDs deliberately and visibly.

### 8.2 Bookmark storage

Use a small native IndexedDB store keyed by product ID, with transactional per-record save/remove and a metadata record for schema migration. No new dependency or cloud sync. A bookmark contains durable identity and validated minimal display metadata; any cached composition is explicitly dated and revalidated on opening, not treated as current indefinitely.

Migrate the existing `medcheck-saved` array once in a transaction with the migration marker. Validate every record, skip/quarantine invalid entries with a recoverable message and preserve a local legacy backup until commit succeeds. Once the marker is committed, never re-import the retained legacy array. Concurrent first-run migrations cannot recreate an entry deleted after migration. Keep the existing 100-bookmark cap, enforced transactionally. Handle blocked database upgrades with a recoverable message and close old connections on `versionchange`; never instruct users to delete all research to unblock an upgrade.

Synchronize open views through feature-detected BroadcastChannel invalidation plus refresh on focus/visibility as a fallback. The database, not a stale in-memory list, is authoritative. Writes affect one product; unrelated simultaneous saves survive. For the same product, the last committed transaction determines save/remove state. Storage denial/quota/corruption must leave the rest of research usable and must not report a failed save as successful.

## 9. Interaction, accessibility and printing — A16–A18, A21–A23

### 9.1 Navigation and presentation

Close the mobile drawer after destination selection and transfer focus to the destination heading once the dialog is closed. Escape closes the drawer and restores the trigger. Avoid racing modal focus restoration. Use one `main` landmark, a visible-on-focus skip link, logical heading order and predictable focus when opening/backing out of a product. Compose existing primitives; no replacement navigation framework.

Update semantic text tokens so normal-size text meets 4.5:1 contrast in actual backgrounds/states. Verify focus indicators and disabled/status differentiation. Do not communicate seriousness, freshness or change direction with color alone. Retain mobile scrolling for wide tab strips with a visible affordance, keyboard access and focus scrolling. [WCAG contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).

Distinguish zero/one/unavailable history copy. Add a small valid favicon using the existing visual identity and verify the metadata/request path; no unrelated redesign.

### 9.2 Explicit printable evidence

Replace implicit whole-screen printing with a dedicated printable view/preview and explicit scope. Default to the active research view, selected exact product(s), current applied filters and the current loaded report page or selected version pair. Offer other sections only when the user explicitly selects them; fetch bounded missing content before enabling print.

The printable model includes product identity/market/strength/manufacturer, versions and distinct dates, source observations/limitations, filter scope, source case IDs/version/reference links, source URLs and generation/render time. All selected disclosures print their content regardless of on-screen open/closed state. Do not silently include all report pages or all historic documents.

If a section fails or is still loading, show that limitation in preview and let the user retry or explicitly print an incomplete summary. Count labels clearly distinguish a source total from the page included in the printout. Render letter and A4 multi-page PDFs and inspect text wrapping, page breaks, repeated table headers and visible source links. No silent blank pages or omitted evidence.

## 10. Performance and dependency maintenance — A24, A25

Batch Canadian hydration and bound caches before infrastructure changes. Retained research sessions should eliminate unnecessary tab-switch fetches without masking stale evidence. Measure fixed queries on the same selected products, dataset, environment and cache state; the audit's two US timings used different products and are not a controlled cache benchmark.

Use a fixed benchmark manifest recording D1 statement counts, rows read/written, query time, end-to-end latency, payload size, cache state, sample count and browser bundle/network measurements. Start with ten warm repetitions per representative route plus explicitly isolated cold scenarios; report median/max for small samples rather than an unsupported p95. Use a capped, pre-budgeted concurrency test in isolation, not a live traffic flood.

Proposed release targets: no regression over the controlled baseline; warm selected-dictionary report p95 ≤3 s and warm search p95 ≤3 s **only when a sufficient repeated sample is collected on the qualification host**; otherwise record the achieved distribution and resolve the target before release. Cold upstream-dependent requests must show prompt loading/cancel/retry behavior and remain bounded by source budgets. These are targets, not guarantees about external services.

Inspect production bundle/assets with the existing build tools. Remove measured duplicate/unneeded loaded code or lazy-load expensive noninitial views if material; do not prune the entire starter or add caching services without evidence. Record a no-change decision if no meaningful improvement is found.

Resolve the two audited development-tool advisory chains through compatible locked dependency upgrades. Recheck current advisories at implementation time; do not assume the audited version list is still current, apply `npm audit fix --force`, or claim an exploit without a reachable path. Preserve any unresolved advisory as a documented release decision with reachability evidence. Rebuild and run setup/Worker integration on supported runtime versions after upgrades.

## 11. Operations, validation and release

### 11.1 Setup and independent deployments

Recognize and migrate the existing local database through the normal launcher without deleting it. Test clean setup, known legacy schema and incompatible/partial schema separately. Raw `dev:worker`/built Worker startup must report missing required migrations clearly rather than look like a generic source outage. Do not silently adopt an unknown schema.

Test a fresh clone with unrelated deployment/cloud variables in the parent environment: loopback setup uses only that installation's generated credentials and local data, never the original author's target. Optional hosted installs configure their own Site ID, secret, database and bucket. No original private data or credentials belong in repository fixtures or CI artifacts.

### 11.2 Scheduler health and activation

Keep scheduled writes disabled throughout remediation and private review. Revalidate GitHub authentication at execution time; the older 403 configuration/dispatch limitation is recorded evidence, not proof of current access. If still blocked, identify the exact missing permission and stop only dependent setup.

The operator status must distinguish schedule configured/enabled/unknown, workflow skipped/failed/completed, last actual attempt, last successful check, last successful import and source coverage. The web UI cannot infer GitHub health from an old import date. Persist only authenticated bounded scheduler/check observations; never embed GitHub management credentials in the browser. If schedule configuration cannot be verified by the app, display unknown and point owners to the documented Actions check.

Before activation: pass a complete hosted manual update, verified unchanged cycle and failure/retry recovery. At the authorized public launch, enable the repository gate and observe an actual scheduled success. Before that run occurs, status remains “enabled, verification pending”; do not claim future execution succeeded. GitHub schedules may be delayed and are not exact-time SLAs. [GitHub scheduled workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

### 11.3 Release evidence

Every finding has an acceptance check in the development plan. Keep real source fixtures separate from synthetic failure data. Synthetic writes, clock/lease manipulation and capacity stress belong only in disposable environments.

Required suites: parser/matching unit tests; adapter/API contract tests with stale/missing responses; real Worker import/storage race integration; local setup tests; browser workflows; cross-engine/device/accessibility/print checks; complete-data performance/capacity qualification; source-link and credential/privacy review.

No finite test set certifies all possible medications or a clinical conclusion. The release record must identify versions/commits tested, exact environment, source generation/hashes, results, artifacts, remaining external blockers and rollback target. A skipped test is not a pass. Preserve the original audit and create a new remediation validation record.
