# Reliable source updates

Execution order follows the dependencies below. Each completed phase is committed and pushed independently; acceptance evidence is recorded here and in `VALIDATION.md`. Daily hosted execution remains gated until public launch. All installations retain their own credentials and data.

## 0. Baseline and delivery plan
- [x] Trace the existing importer, source status, archive and scheduler paths.
- [x] Define the phases, safeguards and verification criteria.
- [ ] Preserve existing checks and validate each incremental change before pushing it.

## 1. Reliable source check status
- [ ] 1.1 Add bounded, durable source check records with attempt, heartbeat, success, outcome and phase.
- [ ] 1.2 Start checks before downloads; record failure at every stage and recognize interrupted checks.
- [ ] 1.3 Expose successful unchanged checks separately from dataset coverage and publication dates.
- [ ] 1.4 Test authentication, overlapping/stale attempts, failures, unchanged results and last-good data.

Acceptance: an operator can distinguish never checked, running, unchanged, updated, failed and interrupted. Failure messages do not expose credentials or replace usable evidence.

## 2. Release checks and reusable downloads
- [ ] 2.1 Reuse conditional requests and verified local source manifests, with a bounded periodic full recheck.
- [ ] 2.2 Compare an already installed CV generation before rebuilding the normalized index.
- [ ] 2.3 Cache only public source files between Actions runs, separate from credentials and installation state.
- [ ] 2.4 Test unchanged/changed sources, missing/corrupt cache, validator changes and interrupted downloads.

Acceptance: an unchanged validated release needs no index rebuild or republishing; missing or questionable cache never becomes a false unchanged result.

## 3. Paced, resumable label refreshes
- [ ] 3.1 Refresh unique SPL set IDs once per cycle with a durable checkpoint.
- [ ] 3.2 Pace source requests, honor retry delays and retry failed items without starving later labels.
- [ ] 3.3 Resume interrupted cycles and bound work per request and per scheduled run.
- [ ] 3.4 Test shared labels, throttling, transient/persistent failures, process interruption and independent source outcomes.

Acceptance: successful work survives retries, failed labels remain pending, and a incomplete cycle cannot be reported as a successful complete refresh.

## 4. Storage admission and conservative cleanup
- [ ] 4.1 Measure D1 capacity and reserve replacement headroom before admitting an import.
- [ ] 4.2 Define a grace period and bounded cleanup for abandoned staging records and orphaned raw upload chunks.
- [ ] 4.3 Protect active work, current and previous complete CV generations, published product history and completed source archives.
- [ ] 4.4 Add a dry run and test cleanup/recovery races, partial cleanup, rollback protection and low capacity.

Acceptance: cleanup cannot delete published evidence or active work. Referenced archives remain retained; if that retained history fills storage, updates stop explicitly rather than erase history or upgrade hosting.

## 5. Unattended workflow and release verification
- [ ] 5.1 Produce a redacted, source-specific Actions summary and preserve failed-step outcomes.
- [ ] 5.2 Document owner failure notifications, recovery commands, cache behavior, retention and capacity limits.
- [ ] 5.3 Run parser, scheduler, API integration and failure-injection checks plus the production build.
- [ ] 5.4 Deploy privately and verify real source checks, unchanged updates and complete existing coverage.
- [ ] 5.5 Run the hosted workflow manually with this installation's credentials; record any access blocker precisely.
- [ ] 5.6 Keep the daily launch gate off until public launch; verify the enable/disable procedure.

Acceptance: failures are visible and recoverable, real source checks pass, the prior complete Canadian coverage remains available, and no paid upgrade or public launch occurs as a side effect.

## Delivery record

- Baseline: `3e592d5`; complete local/private Canadian import already validated before this work.
- Planned push boundaries: plan; source-status contract; importer lifecycle; release/cache optimization; resumable refresh; storage safeguards; unattended workflow; release evidence. Boundaries may be combined only when needed to keep a commit coherent.
