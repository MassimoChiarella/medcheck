# Remediation execution record

Implementation baseline: `8cb6b7e`. Audit: `1042011`. Branch: `codex/audit-remediation`.

This ledger distinguishes implemented fixes from verified release checks. The development plan and original audit remain the traceability baseline. No public visibility or paid allowance change is part of implementation.

| Milestone | Findings | State | Evidence |
| --- | --- | --- | --- |
| Import ownership and transactional fencing | A01 | Implemented; local regression verified | Protocol v2, epoch ownership, guarded D1 batches, immutable R2 writes, manifest-checked adoption; isolated Worker takeover, source isolation, stale publication and rollback checks pass |
| Durable identity and history | A02/A18 | Implemented; local regression verified | Durable identity, saved-version/history fallback, numeric SPL chronology and API reversal rejection |
| Archive publication and reservations | A11/A12 | Implemented; local regression verified | Immutable bytes, operation-owned acknowledgements, atomic scan checkpoints, bounded legacy-reference repair |
| Database growth and cache policy | A13 | Implemented; local regression verified | Atomic capacity reservations include concurrent interactive/import writes; bounded cache retention protects history |
| Full capacity qualification | A14 | Pending external qualification | Actual free Sites allocation and an isolated full-data target are not established; no limit was relaxed |
| Search and evidence correctness | A03–A10 | Not started | — |
| Query batching and bounded reuse | A24 | Not started | — |
| Research state and bookmarks | A15/A19/A20/A22 | Not started | — |
| Navigation, accessibility and printing | A16/A17/A21/A23 | Not started | — |
| Tooling, setup and supporting observations | A25/X02–X06 | Not started | — |
| Complete-data, cross-browser and release qualification | X01/X07/X08 | Not started | — |

Hosted qualification and physical-device tests must be recorded as pending if their resources are unavailable; local work continues. Scheduled activation remains gated by the plan's launch requirements.

## Milestone 1 — Import ownership

The server now requires protocol 2 and a source/run/epoch tuple on every mutating import request, including raw archive uploads. Transactional CHECK guards abort an entire D1 batch after lease expiry or takeover. Staging adoption requires the same transform, index hash, row manifest and coverage. Automatic publication cannot regress the coverage date; explicit rollback remains available. Immutable archive writes may leave an unreferenced object after takeover but cannot overwrite or publish newer evidence.

Clients cancel new work and retry loops after heartbeat loss. Terminal failure reporting still attempts the guarded completion, allowing a valid owner to release its lease after a validation failure. Public status stores bounded failure descriptions.

Validation: typecheck, lint, 21 Node tests, 17 Python tests, and the disposable Worker integration suite. Added real SQLite/HTTP checks for protocol rejection, active begin replay, expired bootstrap rejection, epoch takeover, staging adoption, foreign-source IDs, atomic promotion rollback, and unchanged guard-table state. No hosted data was mutated. Older import clients must update together with the server.

## Milestone 2 — Durable identity and chronology

Stored identity now resolves independently of the current label cache. Refresh explicitly reports present, absent or unknown current-label presence; a missing current product cannot block its history. Published history failures expose the bounded set of previously inspected versions as partial coverage. Stored versions remain directly readable. US versions sort numerically within their SPL; Canadian snapshots sort by observation time. Reversed comparisons are rejected, equal API selections require a different version, and unknown order cannot produce directional conclusions.

Validation: typecheck/lint and adapter/unit checks for expired identity, removal from the latest SPL, source outage, retained versions, numeric version 2/8/10 ordering and reversed comparisons. Physical UI verification remains in the release gate.

## Milestone 3 — Recoverable archive publication

Each immutable object has a durable expected hash/byte reservation and each remote operation has a random attempt ID. A completed operation may acknowledge only its own key, registry identity, hash and byte count, independently of an expired source-publication lease. This narrow terminal path cannot modify products, versions, imports or source freshness. It is needed because storage may complete after a lease expires. Ambiguous operations keep their reservation and prevent deletion; a successful retry does not pretend to resolve an earlier uncertain attempt. Confirmed nondispatch settles its marker and a bounded scan can reclaim an absent object. Delete tombstones prevent key reuse until the actual delete completes.

R2 scans checkpoint page markers and byte totals atomically. A second bounded registry pass accounts for objects created after the listing passed their key, and retains unresolved bytes. Completed scans replace the legacy anonymous meter; interrupted scans cannot publish a partial total. Normal maintenance may conservatively overcount a deletion completed after its page was read; the next complete scan reconciles it.

Canadian live observations archive exact payload bytes before coherently publishing product/version data. Product-change and payload hashes are separate. Storage failures return readable current source data with an explicit persistence limitation and are retried; they do not publish a completed history occurrence. DPD batch versions also carry exact archive references. Archived SPLs can rehydrate parsed labels without upstream access; R2 outages can fall through to a healthy upstream.

`python3 scripts/maintain_storage.py --repair-archives` adds bounded legacy catalogue and version-reference reconciliation. It verifies source/product hashes and does not substitute newly downloaded bytes for missing historical evidence. Unresolved legacy references remain explicitly unverified.

Validation: typecheck/lint; adapter tests with SQLite transaction and R2 fault fixtures; normal unit suite; isolated Worker integration. Scenarios include expired-owner late PUT/DELETE completion, duplicate acknowledgements, uncertain-plus-successful retry, nondispatch, interrupted scan checkpoint, legacy bulk-reference backfill, R2 failure/upstream recovery, archive rehydration, Canadian retry-before-publication, concurrent identical chunks, conservative uncertain reservations and lowering the old inflated meter. Full hosted size/CPU qualification remains pending.

## Milestone 4 — Database growth and cache retention

Growing writes now reserve conservative headroom in the same D1 transaction as their data. Admission combines the monotonic physical-size baseline, active import reservations and outstanding interactive reservations. Settlement consumes an import reservation only by that transaction's observed physical growth, advances the baseline, and releases the write reservation atomically. Cleanup does not subtract free pages from billed physical size. Lost settlement acknowledgements remain safe; maintenance only clears reservations included in its own size sample. Label-refresh queue seeding supplies a count-based bulk estimate. Unknown CV manifest fields are rejected.

Caches default to 64,000,000 serialized bytes and 2,000 entries. Per-installation settings can lower these budgets. Retention is bounded to 7–90 days, distinct from source freshness; expired entries are swept in pages of 100. Parsed SPL entries are protected until all referenced inspected versions have verified durable source references. Cache persistence failure cannot turn a successful upstream response into source unavailability.

Validation: typecheck/lint, normal unit/adapter tests, and disposable Worker integration. Added overlapping near-limit writes, observed versus forecast reservation consumption, concurrent maintenance sampling, entry-cap enforcement, existing-key replacement, and sole-copy historical-cache retention tests.

A14 remains a release gate: local SQLite/Worker checks do not establish hosted free entitlement or full-generation peak size. D1 documents `size_after` per query, but the deployed provider must be checked for useful per-statement values in a batch before relying on measured reservation consumption for capacity forecasts. If it reports a common final size, growth credit remains zero and admission stays conservative. The three complete hosted generation cycles, actual allocation, query/CPU budgets, and interrupted-cycle/rollback measurements are still required. Ordinary Cloudflare Free's documented per-database allowance is not sufficient for the previously measured complete Canadian index. No paid upgrade, dataset truncation, or relaxed admission estimate was used.

References checked during implementation: [D1 result metadata](https://developers.cloudflare.com/d1/worker-api/return-object/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/).
