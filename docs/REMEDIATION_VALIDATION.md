# Remediation execution record

Implementation baseline: `8cb6b7e`. Audit: `1042011`. Branch: `codex/audit-remediation`.

This ledger distinguishes implemented fixes from verified release checks. The development plan and original audit remain the traceability baseline. No public visibility or paid allowance change is part of implementation.

| Milestone | Findings | State | Evidence |
| --- | --- | --- | --- |
| Import ownership and transactional fencing | A01 | Implemented; local regression verified | Protocol v2, epoch ownership, guarded D1 batches, immutable R2 writes, manifest-checked adoption; isolated Worker takeover, source isolation, stale publication and rollback checks pass |
| Durable identity and history | A02/A18 | Implemented; local regression verified | Durable identity, saved-version/history fallback, numeric SPL chronology and API reversal rejection |
| Archives, reservations and capacity | A11–A14 | Not started | — |
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
