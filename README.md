# MedCheck

Browse the [development history](HISTORY.md) for the feature-by-feature commit map. Publishing this repository does not make the review deployment public.

Medication history and evidence research for patients and caregivers. English, human prescription and OTC products, US and Canadian markets. No accounts, AI service, personal health histories, or patient notifications. Bookmarks are stored in the browser only.

## Run locally

Requires Node 22.13+ and Python 3.9+. Install with `npm ci`; run `npm run dev`. The app uses React/TypeScript, Vinext, Cloudflare D1 and R2 through Sites. Generate a random 32+ character `IMPORT_TOKEN` in an ignored `.dev.vars` for local imports. Runtime production secrets belong in Sites settings, never hosting.json or Git.

Generate schema changes with `npm run db:generate`. Apply the files in `drizzle/` to the local D1 binding before using the API. Sites applies packaged migrations at deployment. `npm run typecheck`, `npm test`, `npm run lint`, and `npm run build` verify the application. `tests/integration.py` exercises an isolated local Worker, including staged imports and rollback; never run its synthetic dataset tests against the review or live deployment.

## Research model

- Search resolves exact products: market, labeler/manufacturer, NDC or DIN, strength, form and route. DIN and NDC remain strings, including leading zeros.
- DailyMed SPL set/version identifies the source document; product NDC identifies the selected product within it. Structured ingredient comparisons isolate that product. Narrative sections can cover several strengths; the app discloses that scope.
- Differences describe labels and listed ingredients. There is no automatic inference of a confirmed formulation change, causation, interchangeability, or safety.
- Publication, effective, source update, observation, first receipt and latest receipt dates remain separate. Receipt dates never assign reports to a formulation.
- Label passages and suspected-event reports appear separately. Exact name highlighting is not interaction adjudication. Class references remain readable. Current openFDA labels are separately cross-referenced by SPL set and product NDC.
- Report authority, product market, event country and reporter country are distinct. FDA missing event geography stays unknown. Canada Vigilance's published extract covers Canadian events. No worldwide incident total is calculated.
- Each source case ID appears once at its latest supplied version. Duplicate and linked IDs are preserved as references; different IDs may still describe the same incident. Reaction bars count reports containing terms, not risk.
- Fixed-combination FDA searches use full product/generic names, excluding individual-component aliases; alternate reporting names can be missed. Shared-ingredient comparisons are blocked as ambiguous. No-match, partial, stale and unavailable outcomes remain explicit.

## Sources and access

| Source | Integration and limits |
| --- | --- |
| [DailyMed](https://dailymed.nlm.nih.gov/dailymed/app-support-web-services.cfm) | Complete published version metadata, then archived SPL on inspection. R2 preserves exact XML/ZIP bytes and SHA-256. 12 MB download / 8 MB extracted XML ceiling; larger archives are explicitly unavailable. |
| [RxNorm](https://lhncbc.nlm.nih.gov/RxNav/APIs/RxNormAPIs.html) | Supplementary normalized names, ingredient terms and identifier history. No retired interaction API. |
| [openFDA](https://open.fda.gov/apis/drug/event/) | Current label cross-references, adverse-event queries, historical enforcement records. US pair totals are source-matched candidates; page summaries require distinct medication records. Harmonized names are incomplete. Paging limits require narrower date filters. |
| [Health Canada DPD](https://health-products.canada.ca/api/documentation/dpd-documentation-en.html?wbdisable=true) | Complete human-product catalogue, live identities and prospective observations. No complete historical formulation archive or interaction text. Monographs linked through official product pages. |
| [Canada Vigilance](https://health-products.canada.ca/api/documentation/cvp-documentation-en.html?wbdisable=true) | Full published extract, indexed locally and promoted to D1. Explicit CV dictionary selection; CV identifiers are separate from DPD. |
| [WHO VigiAccess](https://www.vigiaccess.org/) | External reference. API access requires a separate arrangement. |
| [EudraVigilance](https://www.adrreports.eu/en/access_policy.html) | External reporting portal; no public ingestion in this release. |

Contains information licensed under the [Open Government Licence – Canada](https://open.canada.ca/en/open-government-licence-canada). Health Canada has not endorsed this application. Read the [Canada Vigilance interpretation and privacy caveats](https://www.canada.ca/en/health-canada/services/drugs-health-products/medeffect-canada/adverse-reaction-database/medeffect-canada-caveat-privacy-statement-interpretation-data-extract-vigilance-adverse-reaction-online-database.html): reports are suspected associations, may be incomplete/duplicated, and cannot establish causation, incidence or comparative safety. Reporting populations, terminology and market formulations differ. Source figures cannot be summed into unique global incidents.

## Imports and updates

Set `MEDCHECK_URL` and `MEDCHECK_IMPORT_TOKEN` in the importer environment. Private review can additionally use an existing owner-authorized `SITES_AUTHORIZATION` token. Tokens must not be committed. Upstream API requests occur server-side; optional `OPENFDA_API_KEY` stays in Sites. Request budgets are shared across Worker instances; responses are bounded, cached and retried. Upstream failures can return the last successful snapshot, clearly marked.

```
python3 scripts/import_products.py --upload
python3 scripts/import_canada.py --upload --refresh
```

The Python importer streams the official ZIP, handles its actual quoted-dollar and multiline record format, validates required schema/counts/relations/dates and builds a complete SQLite index. It checks release metadata before downloading. Generation identity includes archive SHA-256 and transformation version; increment `TRANSFORM_VERSION` whenever normalization semantics change. Authenticated batches are bounded and idempotent; rerunning resumes from acknowledged batches. Promote validates all expected table counts and atomically switches the active generation. Failure retains the previous complete dataset and exposes an error. Older retired CV generations are cleaned in bounded chunks; the immediately previous success is retained for operator rollback. The authenticated `rollback` action requires its complete retained generation. Atomic cleaning/restoring state claims prevent cleanup from deleting a restored generation; scheduled jobs cannot automatically reactivate retired data after rollback. Product catalogues stage separately and commit product records, change occurrences and freshness together. A→B→A is three history events.

The daily GitHub Actions workflow runs at 07:17 UTC and is also manually dispatchable. **Updates are disabled by default. After configuring the repository secrets, set the repository variable `MEDCHECK_UPDATES_ENABLED=true` when the public app launches.** Enable the verified schedule with public launch; private review alone does not authorize a public launch. `MEDCHECK_URL`, `MEDCHECK_IMPORT_TOKEN`, and (only for private review) `SITES_AUTHORIZATION` are repository secrets. No provider plan changes or paid upgrades are automated.

Capacity is a release gate, not a sampling switch. The May 31, 2026 complete CV release contains 1,266,430 reports, 64,375 dictionary products, 5,744,475 report-drug rows, 4,948,993 reactions and 1,572,365 linked-record rows; 405,281 ingredient records are incorporated into the dictionary. The normalized SQLite index is 919,687,168 bytes before generation keys. Admission reserves up to six times that size within an 8 GB application ceiling for indexes, retained and staged copies. This ceiling is not a claim about a provider entitlement: a full successful deployment import and measured D1 usage are required to demonstrate the provisioned Site can hold it. If a provisioned storage/execution allowance prevents full import, report the capacity blocker and retain unavailable/previous data. Never truncate coverage or substitute examples.

## API and storage

`GET /api/research?action=search|product|history|version|diff|evidence|reports|recalls|fda-label|terminology|sources` provides bounded/paginated results with notes, dates and completeness. `POST /api/import` is restricted to a server-side secret and fixed import actions/table schemas; clients cannot send SQL. D1 holds product snapshots, metadata, request cache, request budgets and CV indexes. R2 holds retrieved source label bytes, observed catalogue records and exact Canadian source bytes. Large source files are preserved as ordered 5 MB chunks with SHA-256 hashes and a validated reconstruction manifest. The app does not use an LLM to generate medical conclusions.

All source fixtures are real public source documents; synthetic records exist only in isolated import tests. The app is an evidence research tool, not a clinical interaction database or treatment recommendation service.

## Deployment ownership

`.openai/hosting.json` contains the original project identifier and logical storage bindings; it contains no credentials. Forks should replace the original project identifier with their own registered Sites project before deployment. Keep import tokens, source archives, indexed databases, and generated build output out of Git.
