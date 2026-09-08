# Reliable source updates

Execution order follows the dependencies below. Each completed phase is committed and pushed independently; acceptance evidence is recorded here and in `VALIDATION.md`. Daily hosted execution remains gated until public launch. All installations retain their own credentials and data.

## 0. Baseline and delivery plan
- [x] Trace the existing importer, source status, archive and scheduler paths.
- [x] Define the phases, safeguards and verification criteria.
- [x] Preserve existing checks and validate each incremental change before pushing it.

## 1. Reliable source check status
- [x] 1.1 Add bounded, durable source check records with attempt, heartbeat, success, outcome and phase.
- [x] 1.2 Start checks before downloads; record failure at every stage and recognize interrupted checks.
- [x] 1.3 Expose successful unchanged checks separately from dataset coverage and publication dates.
- [x] 1.4 Test authentication, overlapping/stale attempts, failures, unchanged results and last-good data.

Acceptance: an operator can distinguish never checked, running, unchanged, updated, failed and interrupted. Failure messages do not expose credentials or replace usable evidence.

## 2. Release checks and reusable downloads
- [x] 2.1 Reuse conditional requests and verified local source manifests, with a bounded periodic full recheck.
- [x] 2.2 Compare an already installed CV generation before rebuilding the normalized index.
- [x] 2.3 Cache only public source files between Actions runs, separate from credentials and installation state.
- [x] 2.4 Test unchanged/changed sources, missing/corrupt cache, validator changes and interrupted downloads.

Acceptance: an unchanged validated release needs no index rebuild or republishing; missing or questionable cache never becomes a false unchanged result.

## 3. Paced, resumable label refreshes
- [x] 3.1 Refresh unique SPL set IDs once per cycle with a durable checkpoint.
- [x] 3.2 Pace source requests, honor retry delays and retry failed items without starving later labels.
- [x] 3.3 Resume interrupted cycles and bound work per request and per scheduled run.
- [x] 3.4 Test shared labels, throttling, transient/persistent failures, process interruption and independent source outcomes.

Acceptance: successful work survives retries, failed labels remain pending, and an incomplete cycle cannot be reported as a successful complete refresh.

## 4. Storage admission and conservative cleanup
- [x] 4.1 Measure D1 capacity and reserve replacement headroom before admitting an import.
- [x] 4.2 Define a grace period and bounded cleanup for abandoned staging records and orphaned raw upload chunks.
- [x] 4.3 Protect active work, current and previous complete CV generations, published product history and completed source archives.
- [x] 4.4 Add a dry run and test cleanup/recovery races, partial cleanup, rollback protection and low capacity.

Acceptance: cleanup cannot delete published evidence or active work. Referenced archives remain retained; if that retained history fills storage, updates stop explicitly rather than erase history or upgrade hosting.

## 5. Unattended workflow and release verification
- [x] 5.1 Produce a redacted, source-specific Actions summary and preserve failed-step outcomes.
- [x] 5.2 Document owner failure notifications, recovery commands, cache behavior, retention and capacity limits.
- [x] 5.3 Run parser, scheduler, API integration and failure-injection checks plus the production build.
- [x] 5.4 Deploy privately and verify real source checks, unchanged updates and complete existing coverage.
- [ ] 5.5 Run the hosted workflow manually with this installation's credentials; record any access blocker precisely.
- [x] 5.6 Keep the daily launch gate off until public launch; verify the enable/disable procedure.

Acceptance: failures are visible and recoverable, real source checks pass, the prior complete Canadian coverage remains available, and no paid upgrade or public launch occurs as a side effect.

## Delivery record

- Baseline: `3e592d5`; complete local/private Canadian import already validated before this work.
- Planned push boundaries: plan; source-status contract; importer lifecycle; release/cache optimization; resumable refresh; storage safeguards; unattended workflow; release evidence. Boundaries may be combined only when needed to keep a commit coherent.

- Phase 1: durable check lifecycle, source-directory status and isolated HTTP regressions passed. Existing import transaction tests also passed; interrupted checks retain previous data and success timestamps.

- Phase 2: conditional downloads, seven-day full byte rechecks, active-release checkpoints and a public-files-only Actions cache passed unit and HTTP integration checks. Canada Vigilance supplies Last-Modified; DPD currently supplies no validators and still needs bounded file downloads to confirm changes.

- Phase 3: unique SPL refresh cycles, per-document checkpoints, request pacing, Retry-After handling and bounded retries passed parser/client and isolated HTTP checks. Throttled records remain pending without consuming failure attempts; a new check resumes unfinished cycles.

- Phase 4: measured admission/reservations, seven-day staging retention, bounded maintenance and archive ceilings passed 18 Node tests, 14 Python tests and the isolated Worker integration suite. Competing reservations, stale leases, dry runs, interrupted cleanup, restaging, retained history and rollback protection were verified.

- Phase 5 private verification: owner-only deployment succeeded. Real DPD and CV checks were unchanged; all seven unique US labels refreshed, followed by a successful repeated CV check. Both storage audit modes retained all 223 archive objects (440,656,614 bytes). Full CV table counts still matched the manifest; D1 measured 2,195,230,720 bytes.
- Phase 5.5 external blocker: GitHub permits source pushes and code-check runs, but its current token returns HTTP 403 for Actions Secrets, Variables and workflow dispatch. The browser is signed out. Hosted update execution cannot be claimed as verified until the owner reconnects with the required repository permissions. The same import commands passed against the private installation from this machine. No schedule-enabling action or paid upgrade was performed.

- Linux release checks: [Actions run 34184300982](https://github.com/MassimoChiarella/medcheck/actions/runs/34184300982) passed lint, types, Node/Python tests, full disposable Worker integration and the production build after the hostname correction.
