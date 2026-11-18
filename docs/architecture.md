# Architecture

Verified from repository source on 2026-11-17. This describes code paths, not the configuration or behavior of a live deployment.

## Entry points and runtime

- Production: `doGet()` in [Code.gs](../Code.gs) renders the `Index` Apps Script template. [index.html](../index.html) includes Styles, Theme, PeopleModule, FMBacklogLive, FMBacklogUI and Javascript.
- Frontend: [Javascript.html](../Javascript.html) manages state, DOM rendering and RPC calls; [Styles.html](../Styles.html) contains shared CSS. Search symbols before reading these large files.
- Local: [local/server.cjs](../local/server.cjs) serves shared templates on loopback. [local/bridge.js](../local/bridge.js) adapts `google.script.run` to `/api/rpc`.
- [local/apps-script-runtime.cjs](../local/apps-script-runtime.cjs) runs shared `.gs` code in a Node VM with simulated Google services and a fake local admin. Google authentication is not validated locally.

## Module map

- Core, permissions, KPI, forecast, targets and materialized facts: [Code.gs](../Code.gs), [DailyKPIDirect.gs](../DailyKPIDirect.gs), [RuntimeFastCache.gs](../RuntimeFastCache.gs).
- Shared web APIs and D0: [WorkspaceApi.gs](../WorkspaceApi.gs), [D0Data.gs](../D0Data.gs).
- Volume, claims and lost adapters: [FLMModule.gs](../FLMModule.gs), [LostCompensatedBackend.gs](../LostCompensatedBackend.gs).
- FM pending pickup: [FMBacklogApi.gs](../FMBacklogApi.gs), [FMBacklogLive.html](../FMBacklogLive.html), [FMBacklogUI.html](../FMBacklogUI.html).
- Rider, Staff and BPO: [PeopleApi.gs](../PeopleApi.gs), [PeopleCore.gs](../PeopleCore.gs), [PeopleModule.html](../PeopleModule.html).
- HUB access requests and grants: [HubAccessApi.gs](../HubAccessApi.gs); shared authorization remains in Code.gs.
- Source health, DTC alerts, maps and notifications: [SourceHealth.gs](../SourceHealth.gs), [DTCAlerts.gs](../DTCAlerts.gs), [Hubmaps.gs](../Hubmaps.gs), [SeaTalkAlert.gs](../SeaTalkAlert.gs).
- Feedback and visit reporting: [CustormerFeedback.gs](../CustormerFeedback.gs), [WebVisits.gs](../WebVisits.gs).

## Data and authorization

Most frontend requests use `google.script.run`. Backend entry points resolve the active Google email, check page/module access and authorized HUB scope, then read Sheets, BigQuery or caches. Inspect `requireAccess_`, `assertPageAccess_` and `assertScopeAccess_` before changing related APIs. Ranks include ADMIN, SAOM, AOM, SUP and HUB, with additional custom grants.

- Sheets hold permission mappings, KPI, forecast, D0 and workforce data. People reads `riders`, `staff` and `bpo`; its daily cache can create/update the hidden `_People Resource Cache` tab.
- FM pending pickup reads the `2_Visual` and `3_Deck_HCM` summary tabs; it does not read the raw order sheet.
- FLM adapters query BigQuery. FastDataLoader can use the advanced Sheets service with a SpreadsheetApp fallback.
- Some Lost/Prelost/Alerts frontend paths fetch Supabase REST directly, use browser caches and contain sample fallbacks/fixed date filters. Do not assume these paths inherit Apps Script authorization or are disabled locally. Server policies have not been verified.
- SeaTalk notification code can send webhooks and manage triggers. Do not invoke it during read-only inspection.
- Local data combines imported workbooks with mock supplementation from `local/sample-data.cjs` and `local/mock-bigquery.cjs`; it is not production evidence.

## Packaging boundaries

[local/source.cjs](../local/source.cjs) selects root `.gs`/`.html` files. It excludes `Deoloyments.gs` (an identical copy of DailyKPIDirect.gs) and the retired `FMBacklogTracker.html` snapshot. Diverging duplicate files stop checks/builds; keep both copies synchronized when editing DailyKPIDirect.gs.

[local/export.cjs](../local/export.cjs) runs local checks, writes `dist/apps-script/`, renames `index.html` to `Index.html` and records SHA-256 hashes. It does not deploy or supply the Apps Script manifest/configuration. Local tooling, private data and `ingestion/` are outside that bundle.

`ingestion/rider-repair/` is a separate archived BigQuery repair workflow, not a dashboard setup step.
