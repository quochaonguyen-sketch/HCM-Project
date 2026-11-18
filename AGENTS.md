# Project guidance

## Project overview
- Purpose: HCM Ops Hub, an SPX dashboard for HUB operations, KPI, forecast, backlog and workforce.
- Stack: Google Apps Script, HTML/CSS/JavaScript; Node.js >=18 local runtime; Google Sheets, BigQuery and Supabase data sources.
- Architecture: [docs/architecture.md](docs/architecture.md).
- Local setup and limitations: [docs/local-development.md](docs/local-development.md).

## Working rules
- Read relevant instructions before editing; check git status and preserve user changes.
- Find symbols, callers and modules before reading large files, especially Code.gs, Javascript.html and Styles.html.
- Make the smallest complete change; reuse existing patterns and avoid unrelated refactors or new abstractions.
- Include affected callers, tests and fixtures; preserve validation, error handling and accessibility.
- Preserve Vietnamese text, file encoding and existing line endings.
- Do not change public interfaces or data contracts without approval.
- Edit shared root .gs/.html sources, not generated dist files. Keep DailyKPIDirect.gs and its duplicate Deoloyments.gs identical.

## Safety boundaries
- Do not read or print secrets, tokens or credential files; report only required configuration names.
- Do not modify production data.
- Ask before deploying, migrating, installing dependencies or changing authentication/authorization.
- Prefer mocks or sanitized fixtures. Local frontend code can still call Supabase; do not assume local mode is offline.
- Do not run ingestion/rider-repair scripts as part of dashboard setup.

## Verified commands
- Install: no root dependencies to install; optional tooling prerequisites are documented in local setup.
- Local run: npm run dev or ./start-local.ps1; requires imported workbook data.
- Lint/typecheck: not available. npm run check checks syntax and local initialization; it requires workbook data and can write local state/provenance.
- Tests: npm run test:local runs checks and API suites with isolated synthetic data; no workbook or install needed. See local setup for legacy data tests.
- Package: npm run build:production runs check and writes dist/; it does not deploy.

## Definition of done
- Run checks relevant to the change; add or update tests for non-trivial logic.
- Report modified files, behavior changes, exact checks run and their results.
- Clearly state what was not tested and why; missing private data is not a passing check.
- End with one or two lines stating omitted checks/work and material risks.

## Automatic agent coordination
- For project tasks, the main agent must read and follow [.cursor/rules/auto-orchestration.mdc](.cursor/rules/auto-orchestration.mdc), including when its client does not load Cursor rules automatically.
- The user authorizes automatic delegation to Orca workers under that policy. Dispatched workers must complete their assigned task without recursively delegating.

## Shared interface style
- For every UI task, read and follow [.cursor/rules/ui-consistency.mdc](.cursor/rules/ui-consistency.mdc), including when the client does not automatically load Cursor rules. Apply the same policy to delegated implementers, testers and reviewers.

## Agent names
- User alias "Anh cả" means the primary Codex coordinator in this project.
- User alias "Anh 2" means the Antigravity agent (Orca agent id: antigravity); "angravity" is the user's spelling for the same agent.
- Resolve these aliases automatically in task assignments and conversation; an alias alone does not authorize new work or extra permissions.
