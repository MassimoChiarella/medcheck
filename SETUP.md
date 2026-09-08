# Run your own MedCheck

A clone downloads from the original government services and builds its own indexes. It does not connect to the original author's app, computer, database, or import credentials. Local operation needs no GitHub, Cloudflare, or Sites account.

The repository contains the indexing code, not the author's downloaded database. The initial Canadian import therefore takes time. A new installation gets the currently published releases, which can differ from the release originally validated here. Canadian product observation history starts with your installation's first observation; historical observations made by another installation are not recreated. US label archives remain available from DailyMed when the source provides them.

## First run

Install Node 22.13+ and Python 3.9+, then run these commands in the repository folder:

```sh
npm ci
npm run dev
```

On the first interactive run, the launcher offers:

1. **Live searches:** US labels/reports and Canadian product searches load from their APIs as needed. Canadian live searches can be unavailable when Health Canada's service cannot be reached; full Canadian mode provides a local catalogue fallback. The complete Canadian report dataset is not downloaded yet, and its report counts remain explicitly unavailable.
2. **Complete Canadian data:** also retrieve the full DPD catalogue and Canada Vigilance release, archive the source files, validate them, and build the local index. US records continue to load on demand.

It then offers **manual updates** or **daily checks while this local app is running**. You can use the app while the initial import runs; Canadian reports appear only after the complete index passes validation. Progress and source coverage dates appear in the terminal, with availability also shown in the app's source directory.

The launcher initializes the database, generates a random installation-specific import key in ignored `.dev.vars`, and stores local data under `.wrangler/state` and `work/`. It binds to `127.0.0.1:3000`. Use `--port=3001` if another app is using that port. It always uses local emulated D1/R2 storage; the original Site ID is not a remote data connection.

Allow **at least 10 GB free disk space**, plus space for dependencies and future archived releases. The validated Canadian index occupied about 2.04 GiB; the source ZIP and temporary normalized index require additional space. Prefer at least 2 GB available RAM. Actual download size, storage use and runtime depend on the current release and your computer; the initial import can take tens of minutes. Insufficient capacity stops the import instead of truncating coverage.

A non-interactive first run defaults to live searches and manual updates unless explicit flags select otherwise. For unattended complete setup:

```sh
npm run setup -- --yes --data=full --updates=daily --port=3000
npm run dev
```

`setup` completes the selected initial import and exits; it starts a temporary local server when necessary. Daily checks begin when you subsequently run `dev`. The launcher reuses an already-running server only if it accepts this installation's import key. It will not upload into an unrelated service occupying the same port.

## Change choices or update now

```sh
npm run setup
npm run data:update
npm run data:status
```

Scheduling and data preferences apply to the running launcher within a minute; an update already in progress finishes. Restart `npm run dev` after changing the port. `data:update` runs once using the saved data mode, starting a temporary local server if needed. In live-search mode it refreshes previously indexed US labels; Canadian live product records refresh when queried. In full mode it also checks and imports the complete Canadian releases. Completed archives/indexes and acknowledged upload batches are reused where possible; interrupted source downloads restart.

Explicit alternatives:

```sh
npm run setup -- --yes --data=full --updates=manual
npm run setup -- --yes --updates=daily
npm run setup -- --yes --updates=manual
```

Switching to live-search mode does not delete previously imported data. Stopping an import retains the last successful dataset; rerun `npm run data:update` to resume interrupted work. A failed source update is reported as incomplete while other independent sources are still attempted. Automatic failures wait until the next daily attempt; a manual update can retry sooner.

The default and all local setup flags target this checkout's loopback server. Inherited `MEDCHECK_URL`, `MEDCHECK_IMPORT_TOKEN`, cloud account credentials and `SITES_AUTHORIZATION` are not used as the local upload destination or credentials. Never copy another installation's secrets into your clone.

## How the local schedule works

Daily checks run approximately every 24 hours while the `npm run dev` launcher is open and the computer is awake. An overdue check runs after restart. Closing the launcher stops its schedule; it does not install a system service, wake a sleeping computer, or schedule work on the author's infrastructure. A local lock prevents overlapping import runs.

The existing `npm run dev:worker` command starts the raw development server for advanced use; it does not run first-run setup or the local schedule. `npm start` likewise starts the built Worker without the setup supervisor.

## Optional schedule for your own hosted installation

For updates even when your laptop is closed, deploy your own copy to infrastructure with enough storage and use the workflow included in **your** GitHub repository. A GitHub-hosted runner cannot reach a laptop's `localhost`.

1. Provision your own deployment, database and archive storage. For Sites, register your own project and replace the original project ID in `.openai/hosting.json`. Do not attempt to deploy to the original author's project.
2. Configure your deployment's `IMPORT_TOKEN` with a new random value of at least 32 characters.
3. Add GitHub repository secrets `MEDCHECK_URL` (your HTTPS origin) and `MEDCHECK_IMPORT_TOKEN` (the same new key). A private Sites deployment may additionally need its own owner-authorized `SITES_AUTHORIZATION`; do not reuse the original app's token.
4. In Actions, enable workflows for your fork if required. Manually run **Refresh medication sources** to validate a complete import on your infrastructure. Manual dispatch is allowed while the daily schedule is off.
5. After a successful run, create the repository variable `MEDCHECK_UPDATES_ENABLED` with value `true` to enable daily runs at 07:17 UTC. Set it to `false` to stop scheduled imports.

The setup does not create cloud accounts, change hosting plans, configure repository secrets, or activate your hosted schedule. The full Canadian index exceeds standard Cloudflare Free's 500 MB per-database limit; evaluate your own provisioned allowance before choosing hosted storage. Local emulation does not need a Cloudflare subscription. [Cloudflare D1 limits](https://developers.cloudflare.com/d1/platform/limits/)

GitHub scheduled runs use the default branch, can be delayed, and public-repository schedules may be disabled after inactivity. They are not an exact-time guarantee. [GitHub schedule behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)

## Coverage and reproducibility

DailyMed, RxNorm, openFDA and Health Canada remain the upstream authorities. WHO/VigiAccess and EMA are external research links, not downloadable mirrors supplied by this repository. Read the source directory and [README](README.md) for coverage, attribution and Canadian interpretation caveats.

The importers preserve source bytes and hashes and validate complete expected record counts before publishing a dataset within your installation. They do not promise to reproduce the author's exact historical DPD observations. US information is an on-demand cache, not a complete offline mirror of every US medication and report.

## Storage maintenance

`npm run data:maintenance` audits your local database and archive bucket without deleting data. `npm run data:maintenance -- --apply` reclaims eligible staging work. Each normal update runs this bounded maintenance first. Advanced hosted owners can run `python scripts/maintain_storage.py --apply` with their own destination and import credentials.

An abandoned, unpublished import must be inactive for seven days before cleanup. Cleanup retains the active and previous complete report generations, published product history, all label archives, and completed raw source archives. It only removes older unused report indexes, retired catalogue staging rows, and old unreferenced partial uploads. Interrupted cleanup resumes on the next run. Source checks and maintenance exclude each other.

D1 admission measures physical database size and reserves replacement headroom before accepting a complete dataset. `IMPORT_DATABASE_LIMIT_BYTES` and `IMPORT_ARCHIVE_LIMIT_BYTES` default to 8,000,000,000 bytes each; lower these ceilings to your installation's actual provisioned allowances. These are application ceilings, not a promise of free capacity on other hosts. Ordinary Cloudflare Free D1 does not fit the complete Canadian index. No automatic paid upgrade occurs.

Existing installations need one successful archive audit before adding new source files. Archive growth is reserved before writing. Failed writes can conservatively overcount capacity; audits preserve these reservations rather than risk overlooking an in-flight write. D1 physical size can also include reusable pages after deletion. A capacity stop retains the last complete dataset and requires owner review; the app never deletes published history or silently truncates coverage to make room.
