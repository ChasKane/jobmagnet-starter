# Daily applications

Run this in a VM with this repo. Submit new applications through JobMagnet.

## Count

The prompt that loads this file sets the count. This file does not. Call that count `n`. If the prompt has no count, ask for it and do not plan a search.

## Filter

These lines are the default. The prompt that loads this file overrides any line it mentions. A line it does not mention stays.

- Frontend or full stack. Backend-only roles are out. A generic software-engineer title counts only when the description is frontend or full stack.
- Remote anywhere is in.
- In-person and hybrid are in only for the contiguous United States. Alaska, Hawaii, and offices outside the US are out.
- The most important filter: I want to work on editors. Spreadsheets, visual coding platforms, document editors, blueprint editors, HVAC control visualizers, form builders, website builders, video/audio/etc ~media editors, CAD software, game design UIs... anything where a person uses a UI (esp if it's AI-powered these days) to create, control, or interconnect things. Do not add a listing if it's not about work somewhere in the vacinity of this.

## Steps

1. Start JobMagnet and leave it running. `npm start` does not exit.

   ```
   cd projects/jobmagnet
   npm install
   npm run build:ui
   npm start
   ```

2. Count the queue before any search. JobMagnet has to be running.

   ```
   node agent-ctl.js tabs
   ```

   Ignore the tab whose `id` is `__hunt__`. The queue is every other tab whose `status` is `open`. If that count is `n` or more, do not start a search. Do not call ingest. Those open jobs are the listings for this run. Drop any that miss the filter. If that leaves fewer than `n`, do not search for more.

   Otherwise tell ingest the count and the filter. Do not search boards yourself while that chat is working.

   ```
   node agent-ctl.js ingest 'Plan N. FILTER. Do not add jobs yet.'
   ```

   `N` is the count from the prompt. `FILTER` is the prompt's wording for any line it overrides, and the default above for every line it leaves. Read the plan. If it matches, say go. Do not send go in the same breath as the plan.

   ```
   node agent-ctl.js ingest 'Go. Execute that plan.'
   ```

   JobMagnet adds listings. It skips one already on its list, and a second opening at a company already listed. It does not apply the filter. Drop any added listing that misses the filter in force. When the prompt left the default in place, that check is:

   ```
   node daily-apply.js accept <<'EOF'
   [{"company":"Acme","title":"Frontend Engineer","url":"https://jobs.example/1","location":"Remote","description":"..."}]
   EOF
   ```

   Use the `accepted` array. When the prompt overrode a line, judge that line yourself. `accept` only knows the default.

   If a search was started and the passing listings are fewer than `n`:

   ```
   node agent-ctl.js ingest 'Go. Same plan. Add more until the new listings reach N.'
   ```

   Stop when the passing listings reach `n`, or the boards it can reach are exhausted. Apply only to listings this run added that pass the filter.

3. `node agent-ctl.js tabs` lists the tabs for those listings. On each one, `node agent-ctl.js all <tabId>`. That is Do all: resume, fill, and essays. Finish what it left, then submit. Several tabs can be in flight. Vary the waits. Before the confirmation page, `node agent-ctl.js harvest <tabId>` so every question and answer is written to the application log (`answer_commits`) with the listing URL. Autofill, eval, and `record` also harvest. That log is not the user-draft store Magnet learns from.

   The employer page has to show the application was received. A review screen is not a submit. Answers match the profile and the resume. Do not invent employers, dates, or years.

   A verification code is part of the submit. Note the time, run `node agent-ctl.js mail-code --company "…" --since "…"`, and put only that code in the field. If the mailbox cannot produce a code, ping the account owner and stop.

   If an error blocks a submit, stop and think. When only the account owner can fix it, ping them and stop. When the fix is in this repo, fix it, finish the form, and name the pattern in the debrief. `bug` and `blocker` read one JSON object on stdin, and `id` is required.

   ```
   node daily-apply.js bug <<'EOF'
   {"id":"short-name","what":"What failed."}
   EOF
   ```

   `node daily-apply.js blocker` uses the same shape for a site that blocked a submit.

4. After each confirmed submit, `node daily-apply.js record --company … --title … --url … --location …`. That records the receipt and harvests the open tab into `answer_commits` only. User drafts stay in `essay_commits`. To print user drafts, `node daily-apply.js essays --q "…" --company "…" --limit 20`. Add `--answers` to print the application log instead.

5. Ledger. When `MAGNET_STORE=supabase` is set, `record`, `bug`, and `blocker` write Supabase over HTTP (`SUPABASE_URL` + service role). Do not open a Postgres socket. Do not commit `knowledge/jobs.yaml`. If Supabase is unreachable, stop and ping the account owner. When that flag is unset, on `main` commit `knowledge/jobs.yaml` and push it. No feature branch. No pull request. Do not commit `process.yaml`.
