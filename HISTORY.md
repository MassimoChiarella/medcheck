# Development history

This public history reorganizes the original implementation into focused commits for review. It is a retrospective grouping of work completed during the initial build, not a reconstruction of the exact editing timestamps. The original three deployment commits remain retained locally; the private Site publication is unchanged.

The first eleven commits introduce the application in dependency order. The following five preserve the source-refresh, import-resume, recall-link, dictionary-coverage, and full-deployment validation improvements. The seventeenth commit prepares the public repository and gates scheduled work until launch. Preparatory commits are review units; the completed application is validated at the branch tip.

| Step | Commit | Review focus |
| --- | --- | --- |
| 01 | chore: establish the React and Sites runtime | Runtime, dependencies, secret exclusions, and Sites bindings. |
| 02 | chore(ui): add accessible interface primitives | Generated accessible UI components, isolated from domain work. |
| 03 | feat(data): define medication evidence and persistence models | Shared evidence types, source registry, database schema, and migrations. |
| 04 | feat(labels): parse product-specific SPL records and compare versions | Selected-product SPL parsing, version comparisons, and real-fixture tests. |
| 05 | feat(sources): connect DailyMed RxNorm and Canadian products | DailyMed and RxNorm access, Canadian identities, caches, and archives. |
| 06 | feat(evidence): expose label passages and national report searches | Research routes, label passages, national reports, pairs, and recalls. |
| 07 | feat(imports): stage and promote complete Canadian datasets | Complete Canadian import staging, validation, promotion, and recovery. |
| 08 | feat(app): build the medication research interface | Search, history, comparisons, reports, bookmarks, sources, and printing. |
| 09 | test(imports): cover source parsing and import recovery | Source parser regressions and isolated import lifecycle integration tests. |
| 10 | ci: prepare daily source imports and indexed history refresh | Daily/manual source-refresh job and required configuration. |
| 11 | docs: explain evidence rules sources and release checks | Evidence rules, source attribution, setup, and release validation. |
| 12 | fix(sources): preserve valid snapshots during refresh failures | Last-good source recovery and chronological catalogue promotion. |
| 13 | fix(imports): resume bounded transfers across independent tables | Byte-bounded parallel transfers and acknowledged-prefix resume. |
| 14 | fix(evidence): link recalls to their exact source records | Precise source links for historical recalls. |
| 15 | fix(reports): make Canadian dictionary matches fully reachable | Complete dictionary pagination and explicit bounded selections. |
| 16 | docs: record complete deployed Canadian coverage | Full production import counts and measured storage capacity. |
| 17 | chore: prepare the public repository for review | History guide, ownership instructions, and an explicit launch gate for scheduled imports. |

Subsequent commits record new work in chronological order:

| Step | Commit | Review focus |
| --- | --- | --- |
| 18 | fix(imports): validate independent destinations and report refresh failures | Explicit installation origins, protection against authenticated redirects, and incomplete refresh results. |
| 19 | ci: verify manual imports before enabling scheduled updates | Manual verification with the cron gate still off; independent source attempts and accurate workflow failures. |
| 20 | feat(setup): bootstrap independent local data and optional daily updates | First-run choices, local migrations and secrets, full imports, persisted preferences, process cleanup and exclusive update locks. |
| 21 | docs: explain independent setup and record complete clone validation | Setup instructions, storage and scheduling limits, and a full government-data import into an isolated installation. |

## What is included

The repository contains application code, import tooling, migrations, and tests. Government source data is retrieved through the documented APIs/importers; full archives and database indexes are not distributed through Git. The source SPL test fixture is an actual public label document used for parser regressions.

## Validation

The application was built and checked with TypeScript, lint, parser/matching tests, isolated import integration checks, and real deployed US/Canadian queries. [VALIDATION.md](VALIDATION.md) records the coverage and capacity evidence. History reorganization does not change application behavior. The public-repository preparation adds an opt-in workflow gate and updates documentation.
