# JobMagnet

Electron apply browser. Package `jobmagnet`. IPC `magnet:*`. Control API `127.0.0.1:3871`.

No product names from the previous rack. Overlays in the ATS webview pin to the field.

## Run

`cd projects/jobmagnet && npm install && npm run build:ui && npm start`

`CURSOR_API_KEY` in `.env` for essays, voice compact, and ingest parse. LLM calls go through `lib/agent-host.js`. Restart after host changes.

Essay log: sidebar document button, or `node daily-apply.js essays --q "…" --company "…" --limit 20`. That list is user drafts (`essay_commits`) — priors and voice learn from applicant / rewrite / edit only. Magnet running: `node agent-ctl.js essay-log`. Shipped form answers go to `answer_commits` with the listing URL; harvest with `node agent-ctl.js harvest <tabId>` or `record`. Do not write harvest into the draft store.

Pre-launch: `PRE-LAUNCH.md`.

## Daily apply

Procedure: `DAILY-APPLY.md`. The count is whatever the request says. Record each confirmed submit with `node daily-apply.js record`. When `MAGNET_STORE=supabase`, that write goes to Supabase over HTTP (`SUPABASE_URL` + service role, not Postgres) and the batch does not commit a ledger file. Otherwise it still updates `knowledge/jobs.yaml`; commit and push that file on `main` when the batch completes.

Something only the account owner can fix: ping them and stop. Something in this repo: fix it, and name the pattern in the debrief.
