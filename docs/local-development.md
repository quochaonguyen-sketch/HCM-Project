# Local development

Verified on 2026-11-17. The synthetic test suite runs without private data; interactive local development still requires imported workbooks.

## Test without private data

Run `npm run test:local` from the repository root with Node.js >=18. No dependency installation, Excel files, credentials or external services are needed.

`local/run-tests.cjs` creates synthetic inputs via `local/test-fixtures.cjs`, runs `check.cjs`, `runtime.test.cjs`, `people.test.cjs` and `hourly.test.cjs`, and returns a nonzero exit code on any failure. Each suite has a separate temporary directory and fresh state; the runner removes its temporary directory on completion. It neither reads nor overwrites `local/*.private.json`.

The local runtime uses `HCM_LOCAL_DATA_DIR` for input, state and provenance when supplied. The runner sets this variable only for its child processes; normal local development defaults to `local/`. This does not change the Apps Script production bundle.

Coverage includes template/backend syntax, local startup, KPI, D0, forecast fact reads, mock FLM queries, workforce APIs, hourly transforms and HUB/account scope checks. The legacy `hub-request.test.cjs` and `test-enhanced-hourly.cjs` still depend on their original data assumptions and are not included. Browser rendering, Supabase policies and Google service integration are not covered.

## Prerequisites and data

- Node.js >=18. The root package has no dependencies; no root install step is needed. `start-local.ps1` also searches known Codex runtime locations if Node is absent from PATH.
- Workbook import needs Python with `openpyxl`. Ask before installing tooling/dependencies.
- The importer expects `1. Database back-end.xlsx` and `2. Database front-end.xlsx` at the repository root. These files and `local/workbooks.private.json` are absent in the surveyed checkout. Obtain approved sanitized inputs; do not read private input contents during routine repository inspection.
- After inputs are approved, `python local/import-workbooks.py` produces `local/workbooks.private.json` without modifying the workbooks. It uses cached Excel values, so formulas without cached results are missing data.
- Private workbook data, local state and provenance are ignored by Git. Never force-add them or include them in reports.

## Run

From the repository root, use `npm run dev` or PowerShell `./start-local.ps1`, then open `http://127.0.0.1:3000`. Optional `PORT` changes the port.

HTML/CSS changes are read on refresh; restart after changing `.gs` or the local runtime. The runtime uses a fake ADMIN and simulated Google services. It writes provenance to `local/provenance.private.json` and persists local changes in `local/state.private.json`.

The local banner is not an isolation boundary: shared frontend code can still call Supabase. Avoid browser validation that accesses external services without authorization. Local mocks cannot verify Google identity, actual service permissions, quotas or production cache behavior.

To opt into live Supabase reads for Compensated & Lost, place a Supabase publishable key in `local/supabase.private.json` as `{"publishableKey":"sb_publishable_..."}` and refresh the page. The file is ignored by Git and follows `HCM_LOCAL_DATA_DIR` when set. This uses the existing project, report date filters and Supabase read permissions. The local badge marks when a publishable key is configured.

## Checks and tests

- `npm run check`: combines backend syntax checks, parses inline frontend scripts, checks D0 transforms and renders the local page. Page rendering needs imported workbook data and can write local provenance/state. This is not a lint or typecheck command.
- `npm run test:local`: runs the isolated synthetic suite described above. To test imported workbook values directly, use `node local/runtime.test.cjs`.
- `node local/hub-request.test.cjs`: targeted access-request tests using the local runtime.
- `node local/people.test.cjs`: workforce API tests using the local runtime and suitable source data.
- `node local/hourly.test.cjs`: hourly tests; additionally needs `local/hourly.private.json`. `python local/import-hourly.py "<approved CSV path>"` is the existing importer.
- No CI workflow, lint script or typecheck script is present in the surveyed checkout.

Standalone `npm run check` still needs local workbook inputs. It passes inside `npm run test:local`, where the runner supplies synthetic data; that result does not validate private workbooks or production services.

README mentions importers/tests absent from this checkout, including `local/import-people.py`, `local/import-fm.cjs`, `local/people-sheets.test.cjs`, `local/fm-pending.test.cjs` and `scratch/fm-ui-qa/`. Several are excluded by `.gitignore`; verify existence before using README commands. Do not invent replacements during setup.

## Optional icon tooling

The app already embeds Morphicons and does not need an icon build to run. Only when rebuilding that bundle, the separate `local/morphicons-build/package.json` and pnpm lockfile define Morphicons 2.0.0 and esbuild 0.25.12. After approved dependency installation in that directory, `node local/morphicons-build/build.mjs` rewrites the vendor block in Javascript.html; `node local/morphicons-build/test.mjs` checks the driver.

## Production configuration and release

Never retrieve or print configuration values during repository setup. Configuration names observed in source include:

- Core Sheets: `APP_DB_SHEET_ID`, `D0_DB_SHEET_ID`.
- Optional/module-specific: `KPI_DAILY_DB_SHEET_ID`, `DTC_FC_SHEET_ID`, `DTC_FC_SHEET_NAME`, `LOST_DB_SHEET_ID`, `LOST_SOURCE_SHEET_ID`, `FLM_TEAM_ENABLED`.
- Notifications: `SEATALK_DATA_DELAY_WEBHOOK`, `SEATALK_DATA_DELAY_ENABLED`, `WEB_APP_URL`.

Production requires Google identity, access to configured Sheets and BigQuery services/dataset permissions for applicable modules. People daily caching also requires backend write access. Supabase policies and SeaTalk configuration require separate verification; configuration values are not supplied here.

`npm run build:production` runs `check` before writing `dist/apps-script/` and `dist/source-hashes.json`, so missing local inputs also block packaging. It does not deploy.

No `appsscript.json`, `.clasp.json` or automated deployment command is present. After explicit approval and Apps Script test validation, the documented release path is to copy the bundle into the existing Apps Script project, preserve its manifest/properties/permissions and update the existing deployment to a new version. Do not run ETL, migrations, trigger installers or ingestion repair as a setup check.
