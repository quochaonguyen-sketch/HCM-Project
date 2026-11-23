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

The local Lost report uses synthetic orders by default. To preview live Supabase data for Compensated & Lost locally, place a Supabase publishable key in `local/supabase.private.json` as `{"publishableKey":"sb_publishable_..."}` and refresh the page. The file is ignored by Git and follows `HCM_LOCAL_DATA_DIR` when set. This uses the existing project, report date filters and Supabase read permissions. The local badge marks when a publishable key is configured.

The production Apps Script project reads `lost_orders` with `SUPABASE_LOST_SECRET_KEY` in Script Properties. Set it to a modern `sb_secret_` key from the existing Lost Supabase project. Apps Script checks workspace access and HUB scope before fetching. Order-level data requires Compensated access and a detail-eligible role. Roles with aggregate access see standard reason labels and a single “Lý do khác” group for other labels. The Dashboard continues to use its existing Lost snapshot aggregates and checks the latest Supabase date separately. The browser benchmark is available only in the local publishable-key preview for detail-eligible roles.

Lost requests apply the date bounds upstream and map HUBs to unique directory aliases in Apps Script. The tracked sources do not define a canonical upstream HUB key. An exact text filter can miss aliases whose case or whitespace differs. A scan that reaches the 100-page or 35-second budget reports a retryable source error. A narrow HUB scope can still hit this budget when the upstream date range contains many other HUBs.

### At-Risk summary

`supabase/migrations/20261119000000_at_risk_daily_summary.sql` defines the pre-computed `public.at_risk_daily_summary` materialized view and automated statement triggers for PostgreSQL 15+. It reads `alert_orders.date` and `urgent_orders.deadline` as ISO text with the same supported offsets as the detail reader. Date-only and offset-free times are treated as Vietnam local time. Explicit offsets are converted to UTC+07. Invalid dates are counted separately and excluded from dated totals. Blank or unmapped stations cannot be attributed to a HUB. Order totals count source rows. The detail reader expects one unique `id` per source row.

The materialized view uses existing source columns, provides B-tree indexes on `(source, station, risk_day)` and `(risk_day)`, and grants SELECT to `service_role`. Statement-level triggers on `alert_orders` and `urgent_orders` automatically refresh the summary whenever underlying data is inserted, updated, deleted, or truncated. An explicit RPC `refresh_at_risk_daily_summary()` is also available for cron jobs or pipeline hooks. The summary returns counts and sums by source, date and normalized station. It computes HV per row at COGS ≥ 1,000,000 VND, accepts finite decimal COGS and reports missing values. Aging uses numeric day buckets. Operational legs (FM, LM, RT, EHA) are omitted from At-Risk summarization. The detail source does not supply confirmed feedback, so the summary records missing feedback and leaves pending unknown.

Apps Script uses the existing `SUPABASE_LOST_SECRET_KEY` after checking workspace, page and HUB access. It reads only the new view with exact HUB alias filters and rechecks the results against the selected directory. Each alias batch is budgeted for three initial requests and shares a 100-request paging allowance. Each read is capped at 100 pages and all reads share a 35-second deadline. The latest Alert day is selected across the authorized selection. Prelost includes today onward. Zone, HUB and aggregate CSV use the same result and show confirmed metrics with coverage where fields are missing. The combined total counts source records, so the same shipment can be counted in both feeds. At-Risk detail uses the server's scoped, unique alias map when available and shows unknown Prelost feedback on the Supabase summary. If the key or view is unavailable, Apps Script uses the existing Sheet pivots. A successful empty read establishes that there are no matching rows in the view. The source tables have no ingestion completeness signal in the verified columns.

The standalone SQL fixture `supabase/tests/at_risk_daily_summary.sql` creates mock source tables and roles. Run it only against a fresh disposable PostgreSQL database with `psql -X -f supabase/tests/at_risk_daily_summary.sql` and a connection pointing to that database. The synthetic Node.js suite tests the Apps Script and browser models without connecting to PostgreSQL or Supabase.

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

- Core Sheets: `APP_DB_SHEET_ID`, `D0_DB_SHEET_ID`. DTC, People and the optional BigQuery Attendance sheet still use the D0 workbook.
- D0 Supabase: `D0_SUPABASE_URL` is the HTTPS Supabase project origin and `D0_SUPABASE_SECRET_KEY` is its server-side secret API key. Set both in Apps Script Script Properties for the project that owns the nine D0 relations. The local emulator uses imported workbook fixtures when neither property is configured. Production reports a configuration error when either is missing. Forecast cards use the existing FC workbook lookup. Hourly attendance requires the optional BigQuery Attendance sheet, while the Supabase roster does not supply late counts.
- Optional/module-specific: `KPI_DAILY_DB_SHEET_ID`, `DTC_FC_SHEET_ID`, `DTC_FC_SHEET_NAME`, `LOST_DB_SHEET_ID`, `LOST_SOURCE_SHEET_ID`, `FLM_TEAM_ENABLED`.
- Notifications: `SEATALK_DATA_DELAY_WEBHOOK`, `SEATALK_DATA_DELAY_ENABLED`, `WEB_APP_URL`.

D0 snapshots reuse successful scoped raw relation reads (including empty reads) for up to 60 seconds, so delivery summaries and rider detail can share a read. Explicit refresh bypasses and replaces these entries; a failed refresh invalidates the old entry. Cache keys include the complete authorized HUB directory and alias ownership. Forecast caches include the date and full HUB directory. Source Health remains an explicit uncached freshness check. D0 Overview loads FM and LM first and retains all six sections, including hourly throughput, with at most two concurrent section RPCs.

For `D0_SUPABASE_UPSTREAM`, inspect the failed `getD0Snapshot` execution in Apps Script Executions and its JSON warning: `relation`, `kind`, HTTP `status`, and an allowlisted `upstreamCode` distinguish HTTP rejection, transport, invalid JSON, response shape, row schema and timestamp failures. No upstream message, body, credentials, URL or station/rider identifiers are logged. Public error codes are unchanged; 401/403 still report `D0_SUPABASE_CONFIG`. A 400 with `42703` indicates an undefined column; `42P01` or `PGRST205` can identify a missing/unavailable relation. Permanent HTTP and malformed-data failures are not retried; transport, 429 and 5xx retain the existing bounded retry policy. Requests include the projection and paging cursor in the URL-size budget to stay within [Apps Script's 2,082-character URL limit](https://developers.google.com/apps-script/reference/url-fetch/url-fetch-app). These offline checks cannot establish the root cause of a deployed failure.

Production requires Google identity, access to configured Sheets and BigQuery services/dataset permissions for applicable modules. People daily caching also requires backend write access. Supabase policies and SeaTalk configuration require separate verification; configuration values are not supplied here.

`npm run build:production` runs `check` before writing `dist/apps-script/` and `dist/source-hashes.json`, so missing local inputs also block packaging. It does not deploy.

No `appsscript.json`, `.clasp.json` or automated deployment command is present. After explicit approval and Apps Script test validation, the documented release path is to copy the bundle into the existing Apps Script project, preserve its manifest/properties/permissions and update the existing deployment to a new version. Do not run ETL, migrations, trigger installers or ingestion repair as a setup check.
