# JobMagnet → Supabase

Live I/O uses Supabase HTTP (`SUPABASE_URL` + service role / PostgREST). Nothing in the app opens a Postgres socket or `SUPABASE_DB_URL`.

Move every YAML-backed store and every log off the filesystem into one Supabase project. The schema follows how each structure is used, not how the files happen to be shaped today.

This is the plan. Do not start the migration from this document until the account owner has a Supabase project and the secrets listed in [Owner setup](#owner-setup).

## Why

JobMagnet already has two persistence layers, and they disagree.

- **SQLite** (`knowledge/magnet.sqlite`, gitignored) is the live store while Electron runs. Schema: `lib/store/schema.js`. Facade: `packages/persist`.
- **YAML / JSONL** is what daily apply, git sync, and most learn-caches still read and write. `daily-apply.js record|bug|blocker` never opens SQLite. Several YAML fields never made it into the jobs table (`agent`, `submitted_at`, `location`, plus the root `bugs` / `blockers` lists).
- On quit, Electron dumps SQLite back to `jobs.yaml` + `process.yaml` + `archive/chats.json`. That export drops agent flags unless it can find them in the previous YAML.

The result: the committed job ledger, the local process file, the sqlite file, and the counters in `application-state.yaml` can all tell a different story. Supabase is the one store Electron, `daily-apply.js`, ingest, and a future mobile client all write.

## Goals

1. One source of truth for listings, applications, profile, learn-caches, mail, voice/graph, and logs.
2. Tables match intended use: columns you filter or join on, JSONB only when the value is always loaded as a blob.
3. Daily apply records into the same store as the app. Stop committing `knowledge/jobs.yaml` as the ledger.
4. Append-only logs become queryable rows, not rotated jsonl files.
5. Keep the `packages/persist` `nodeStore()` API so Electron IPC, `packages/core` sql-store, and CLI share one backend.
6. Stay single-user and simple. No multi-tenant `user_id` on every row.

## Non-goals

- Sharing one Supabase project with Lupe or the portfolio site. JobMagnet holds EEO, legal name, address, and resume bytes.
- Putting Gmail OAuth tokens in the database. Tokens stay in the local keychain / `knowledge/mail/oauth.json`.
- Rewriting the ATS webview, dashboard UI, or ingest chat.
- Making the renderer talk to Supabase. Only the Electron main process and Node CLI get the service role.
- Keeping YAML as a write path after cutover. Optional read-only export can stay for a while.

## Design rules

1. **One row = one thing you list, update, or query on its own.** A job, an application, a bug, a recipe, a confirmation, a log line.
2. **Columns for filter / join / sort / count.** JSONB for a unit blob (parsed JD, recipe steps, chat messages, identity block).
3. **Do not lift `lib/store/schema.js` as-is.** It already lost YAML fields and stuffed process events, essays, recipes, and mail into text payloads.
4. **Do not keep a generic `kv` dump** for profile, settings, boards, totals, or voice. Singletons that are real documents get their own one-row tables.
5. **Status lives on `applications`, not on `jobs`.** `jobs.agent` + `jobs.submitted_at` was a YAML workaround so CLI could mark a submit without opening process state. After cutover, `daily-apply.js record` writes an application row with `source = 'agent'`.
6. **Counters are a view**, not a file you bump. `application-state.yaml` totals drift from actual rows.
7. **Logs never update.** Insert only. Large payloads go to Storage, content-addressed, same as `archive/blobs/<sha256>`.
8. **Keep existing string ids** (`tab-12`, `agent-<sha1>`, `default` resume). New rows may use `gen_random_uuid()`. Do not introduce a parallel UUID map.

## Current map

| Store | Path | Intended use | Today | Supabase |
| --- | --- | --- | --- | --- |
| Job ledger | `knowledge/jobs.yaml` | Sidebar list, ingest, duplicate check, daily-apply record | YAML + incomplete `jobs` table | `jobs` |
| Bugs / blockers | `jobs.yaml` root lists | Debrief when a submit fails | YAML only | `incidents` |
| Process | `knowledge/process.yaml` | Per-URL status, timeline, JD, essays | YAML snapshot + `process_records` blob | `applications` + child tables |
| Totals | `knowledge/application-state.yaml` | Dashboard counts | Mutable YAML + `kv.totals` | `application_totals` view |
| Profile | `knowledge/applicant-profile.yaml` | Autofill source of truth | YAML + `kv.profile` | `applicant` + children |
| Confirmations | profile `answers` | Question class → trusted value | Nested map + `confirmation_items` | `applicant_answers` |
| Boards | `knowledge/boards.yaml` | Learned ATS slugs for ingest | YAML + `kv.boards` | `boards` |
| Tag rules | `knowledge/tag-rules.yaml` | JD industry/skill keywords | YAML read-only | `tag_rules` |
| Field recipes | `knowledge/field-recipes.yaml` | Host + label → fill steps | YAML **and** `recipe_items` payload | `field_recipes` |
| Strategy cache | `knowledge/strategy-cache.yaml` | Widget fingerprint → win/loss | YAML only | `strategy_fingerprints` |
| Question aliases | `knowledge/question-aliases.yaml` | Phrase → confirmation class | YAML only | `question_aliases` |
| Experience notes | `knowledge/experience-notes.yaml` | Employer notes for essays | YAML only | `experience_notes` |
| Resumes | `knowledge/resumes.yaml` + PDFs | Pick a PDF by title | YAML + `resumes` + vault dir | `resumes` + Storage |
| Settings | `knowledge/settings.yaml` | UI / model prefs | Gitignored YAML + `kv.settings` | `settings` (1 row) |
| Footprints | `knowledge/footprints.yaml` | Question+options hash cache | Gitignored YAML | `footprints` |
| Board probes | `knowledge/board-probes.yaml` | Ingest probe misses | Local YAML | `board_probes` |
| Mail index/sync/queue | `knowledge/mail/*.yaml` | Dedupe, cursor, work queue | YAML; queue also `mail_items` | `mail_messages`, `mail_sync`, `mail_queue` |
| Chats | `archive/chats.json` | Per-URL Magnet chat | JSON + `chats` | `chats` |
| Voice playbook | `knowledge/richboi.md` | Essay voice | Markdown + `kv.voice` + `voice_versions` | `documents` + existing version table |
| System / review prompts | `system-prompt.md`, `review-prompt.md` | LLM prompts | Markdown + `kv.systemPrompt` | `documents` |
| Hunt session | (kv only) | In-progress hunt | `kv.huntSession` | `hunt_sessions` |
| Action log | `archive/actions/YYYY-MM-DD.jsonl` | Request-scoped audit | JSONL + blob files | `action_log` + Storage |
| Graph events | SQLite `events` | Card/voice audit | SQL | `graph_events` |
| LLM log | `archive/llm.jsonl` | Prompt/response meta | JSONL | `llm_log` |
| Timing | `archive/timing.jsonl` | Dwell / focus / outcome | JSONL | `timing_events` |
| Autofill attempts | `archive/attempts.jsonl` | Per-run fill audit | JSONL | `autofill_attempts` |
| Voice commits | `archive/answers.jsonl` | Draft vs final essays | JSONL | `essay_commits` |
| Essay sessions | `archive/essay-session-<tab>.json` | In-flight draft | Ephemeral JSON | stay local (or `essay_sessions`) |
| Career graph | SQLite cards / timeline / … | Essay evidence | Already SQL | port tables, Postgres types |
| Playbook | `knowledge/playbook.yaml` | unused (0 bytes) | — | skip |
| `voice.md` | human archive | not loaded | leave as git prose | optional import into `voice_versions` |
| Mail OAuth | `knowledge/mail/oauth.json` | Gmail tokens | gitignored file | **not in Supabase** |
| Export YAML | `knowledge/export/*.yaml` | debug dump | derived | optional `persist.exportLiveYaml` |

Join keys today:

```
jobs.url  ──1:1──►  process.by_url[url]  ──►  chats.key
jobs.linkedin|posting  ──►  duplicate detection
applicant_answers.class  ──►  question_aliases.class  ──►  autofill
field_recipes.host + label  ──►  strategy_fingerprints.fingerprint
applications.status  ──►  sidebar bucket (open / submitted / passed / rejected)
```

`lib/process-store.statusOf` still treats an `open` process as `submitted` when `jobs.yaml` has `agent: true`. After cutover that merge rule goes away.

---

## Schema

Postgres in the `public` schema. Enable `pgcrypto` for `gen_random_uuid()`.

JSONB when the app always loads the value as one object. Child tables when the app appends, lists, or deletes items on their own.

### Jobs (listing ledger)

Intended use: ingest adds rows; sidebar lists them; `accept` / `hasJobUrl` dedupes by apply URL, LinkedIn URL, and posting URL; daily apply may insert a row that ingest never saw.

```sql
create table jobs (
  id text primary key,                  -- tab-N | agent-<sha1> | uuid
  url text not null,                    -- apply URL (join key)
  canonical_url text not null,          -- lib/job-identity.canonicalUrl
  company text not null default '',
  title text not null default '',
  linkedin text not null default '',
  posting text not null default '',
  logo text not null default '',
  hostname text not null default '',
  salary text not null default '',
  yoe text not null default '',
  level text not null default '',
  location text not null default '',    -- YAML-only today
  industries text[] not null default '{}',
  skills text[] not null default '{}',
  notes text not null default '',
  sort_index integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index jobs_canonical_url_uidx on jobs (canonical_url);
create index jobs_linkedin_idx on jobs (linkedin) where linkedin <> '';
create index jobs_posting_idx on jobs (posting) where posting <> '';
create index jobs_company_idx on jobs (lower(company));
```

`jobs.yaml` `meta` is stale (`count: 90` vs 522 jobs). Do not store it. Ingest criteria belong on `hunt_sessions`.

### Applications (process)

Intended use: one pipeline record per apply URL. Status drives the sidebar. Submit / pass / reject set timestamps. JD and posting HTML are loaded as a blob for essays. Events, contacts, and essays are appended and sometimes soft-deleted.

```sql
create type application_status as enum (
  'open', 'submitted', 'passed', 'rejected', 'withdrawn'
);
create type application_source as enum ('manual', 'agent', 'import');

create table applications (
  id uuid primary key default gen_random_uuid(),
  job_id text references jobs (id) on delete set null,
  url text not null,
  canonical_url text not null,
  status application_status not null default 'open',
  source application_source not null default 'manual',
  submitted_at timestamptz,
  rejected_at timestamptz,
  passed_at timestamptz,
  prep_notes text not null default '',
  jd jsonb,                 -- parsed JD, always read as a unit
  posting jsonb,            -- posting snapshot, same
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (canonical_url)
);

create index applications_status_idx on applications (status);
create index applications_job_id_idx on applications (job_id);

create table application_events (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications (id) on delete cascade,
  at timestamptz not null default now(),
  type text not null,                   -- submitted | note | …
  title text not null default '',
  body text not null default '',
  contact_id uuid,
  deleted boolean not null default false
);

create index application_events_app_idx
  on application_events (application_id, at);

create table application_contacts (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications (id) on delete cascade,
  name text not null default '',
  email text not null default '',
  role text not null default '',
  extra jsonb not null default '{}'
);

create table essays (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications (id) on delete cascade,
  label text not null default '',
  normalized_key text not null default '',
  llm_draft text not null default '',
  final text not null default '',
  source_card_ids text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index essays_app_idx on essays (application_id);
```

`packages/persist.writeProcess` keeps the same object shape by assembling these rows. Callers (`process-store`, magnet-app) do not change.

`daily-apply.js record` becomes: upsert `jobs`, upsert `applications` with `status = 'submitted'`, `source = 'agent'`, `submitted_at = now()`, append one `application_events` row of type `submitted`.

Totals:

```sql
create view application_totals as
select
  count(*) filter (where status = 'submitted') as submitted,
  count(*) filter (where status = 'passed') as passed,
  count(*) filter (where status = 'rejected') as rejected
from applications;
```

On migrate, compare this view to `{ submitted: 51, passed: 11, rejected: 2 }`. If they disagree, trust application rows and drop the file counters. `bump` / `unbump` become status updates, not incrementing a singleton.

### Incidents (bugs and blockers)

Intended use: daily-apply debrief. Not jobs. Looked up by `id` or `host`. Shape from `appendAgentNote` / `jobs.yaml` root lists.

```sql
create type incident_kind as enum ('bug', 'blocker');

create table incidents (
  id text primary key,                  -- preferred-name-filled-no
  kind incident_kind not null,
  format text not null,                 -- JM-BUG | SITE-BLOCK
  area text not null default '',
  host text not null default '',
  company text not null default '',
  url text not null default '',
  what text not null,
  where_text text not null default '',  -- YAML key is `where`
  evidence text not null default '',
  created_at timestamptz not null default now()
);

create index incidents_kind_idx on incidents (kind);
create index incidents_host_idx on incidents (host) where host <> '';
```

### Applicant profile

Intended use: autofill and confirmations. Identity / EEO / work / policy are loaded as one document (`profile-facts.load`, `valueFromProfile`). Education, employment, skills, and answers grow as lists and are looked up by slug or class.

```sql
create table applicant (
  id boolean primary key default true check (id),
  identity jsonb not null default '{}', -- name, email, phones, mailing_address
  eeo jsonb not null default '{}',      -- gender, race, veteran, disability, …
  work jsonb not null default '{}',     -- auth, geo, compensation
  policy jsonb not null default '{}',   -- oddball / compensation / skills / work_auth / address_geo
  skills_as_of date,
  updated_at timestamptz not null default now()
);

insert into applicant (id) values (true);

create table applicant_education (
  id uuid primary key default gen_random_uuid(),
  sort_index integer not null default 0,
  school text not null,
  degree text not null default '',
  start text,
  end_date text,
  current boolean not null default false,
  gpa numeric,
  gpa_scale numeric,
  honors boolean not null default false
);

create table applicant_employment (
  id uuid primary key default gen_random_uuid(),
  sort_index integer not null default 0,
  employer text not null,
  title text not null default '',
  start text,
  end_date text,
  current boolean not null default false,
  location text not null default '',
  bullets text not null default ''
);

create table applicant_skills (
  slug text primary key,                -- javascript, react, vue
  years integer not null default 0,
  since integer,
  aliases text[] not null default '{}'
);

create table applicant_answers (
  class text primary key,               -- consent:recording, years:unknown
  slug text not null,                   -- other_work_experience
  value text not null,
  confidence text not null default 'confirmed', -- confirmed | contradicted | …
  source text not null default '',
  label text not null default '',
  confirmed_at timestamptz,
  extra jsonb not null default '{}'
);
```

`packages/persist.getProfile` / `setProfile` still return the YAML document shape so `confirmations.js` and autofill keep working. Persist assembles/disassembles the child tables.

EEO stays in the same private project. No public grants. See [Access](#access).

### Learnable apply caches

Each of these is a growing list or a lookup. None of them belong in `kv`.

```sql
create table boards (
  id uuid primary key default gen_random_uuid(),
  company text not null,
  ats text not null,                    -- ashby | greenhouse | lever | …
  slug text not null,
  source_url text not null default '',
  unique (ats, slug)
);

create table tag_rules (
  kind text not null check (kind in ('industry', 'skill', 'exclude')),
  slug text not null,
  keywords text[] not null default '{}',
  primary key (kind, slug)
);

create table field_recipes (
  id text primary key,
  host_includes text[] not null default '{}',
  label_includes text[] not null default '{}',
  label_key text not null default '',
  profile_key text not null default '',
  value text,
  shape jsonb,
  steps jsonb not null default '[]',    -- click / type / clickOption — loaded as a unit
  option_hash text not null default '',
  learned_at timestamptz,
  created_at timestamptz not null default now()
);

create index field_recipes_host_idx on field_recipes using gin (host_includes);
create index field_recipes_label_key_idx on field_recipes (label_key) where label_key <> '';

create table strategy_fingerprints (
  fingerprint text primary key,         -- host|kind|label|shape
  last_success text,
  human_flags text[] not null default '{}',
  updated_at timestamptz not null default now()
);

create table strategy_scores (
  fingerprint text not null references strategy_fingerprints (fingerprint) on delete cascade,
  strategy text not null,               -- native_value | react_select | …
  wins integer not null default 0,
  losses integer not null default 0,
  last_verified_at timestamptz,
  primary key (fingerprint, strategy)
);

create table question_aliases (
  class text not null,
  phrase text not null,
  primary key (class, phrase)
);

create table experience_notes (
  id uuid primary key default gen_random_uuid(),
  employer text not null,
  at timestamptz not null default now(),
  text text not null
);

create index experience_notes_employer_idx on experience_notes (lower(employer));

create table footprints (
  id text primary key,                  -- sha1[:16] of prompt+options
  prompt text not null,
  options_key text not null default '',
  kind text not null default '',
  extra jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

create table board_probes (
  url text primary key,
  last_status text,
  last_error text,
  probed_at timestamptz not null default now()
);
```

`lib/field-recipes.js` and `persist.saveRecipe` become one write path. Today they can diverge.

`lib/strategy.js` loads the whole cache into memory. Persist can still do that (`select *` ~255 fingerprints). Win/loss updates one `strategy_scores` row instead of rewriting a 60 KB file.

### Resumes

Intended use: pick a PDF by title/level regex, attach bytes to the ATS.

```sql
create table resumes (
  id text primary key,                  -- default | frontend | fullstack | product
  label text not null,
  filename text not null,
  mime text not null default 'application/pdf',
  match_patterns text[] not null default '{}',
  is_default boolean not null default false,
  storage_path text,                    -- resumes/<id>.pdf
  imported_at timestamptz not null default now()
);
```

Bytes live in Storage bucket `resumes`, not in a `bytes` text column. `persist.pickResume` stays the same.

### Settings, prompts, hunt, chat UI

Singletons. One row each, not a key/value junk drawer.

```sql
create table settings (
  id boolean primary key default true check (id),
  chat_sound boolean not null default true,
  context_ctrl_tab boolean not null default false,
  autofill_queue_n integer not null default 0,
  handedness text not null default 'right',
  ui_language text not null default 'en',
  model_id text not null default '',
  model_params jsonb not null default '{}',
  custom_models jsonb not null default '[]',
  sidebar_width integer,
  drawer_width integer,
  sidebar_filters jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

insert into settings (id) values (true);

create table documents (
  kind text primary key,                -- voice | system_prompt | review_prompt
  body text not null default '',
  updated_at timestamptz not null default now()
);

create table hunt_sessions (
  id boolean primary key default true check (id),
  payload jsonb,                        -- null = no session
  updated_at timestamptz not null default now()
);

insert into hunt_sessions (id, payload) values (true, null);

create table chat_ui (
  id boolean primary key default true check (id),
  payload jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

insert into chat_ui (id) values (true);
```

`documents.kind = 'voice'` is `richboi.md`. `voice_versions` (below) stays the history. `lib/essay-prompt.js` reads/writes `documents` instead of the markdown file.

### Chats

Intended use: load/save the whole thread for one apply URL. Messages are not queried individually.

```sql
create table chats (
  key text primary key,                 -- apply URL
  company text not null default '',
  title text not null default '',
  page_subtab text not null default 'chat',
  agent_id text not null default '',
  snapshot_key text not null default '',
  messages jsonb not null default '[]',
  folded jsonb not null default '[]',
  updated_at timestamptz not null default now()
);
```

### Mail

Intended use: Gmail scan dedupes by hash, stores a history cursor, queues work, and keeps a few bodies for interview track.

```sql
create table mail_sync (
  id boolean primary key default true check (id),
  history_id text,
  scanned_at timestamptz,
  connected boolean not null default false,
  email text not null default '',
  indexed integer not null default 0,
  pending integer not null default 0
);

insert into mail_sync (id) values (true);

create table mail_messages (
  id text primary key,
  hash text not null unique,
  thread_id text,
  from_addr text,
  subject text,
  date timestamptz,
  verdict text,
  matched_url text,
  keep_body boolean not null default false,
  storage_path text,                    -- mail-kept/<id>.json when keep_body
  created_at timestamptz not null default now()
);

create table mail_queue (
  id text primary key,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
```

`lib/mail/cache.js` writes these tables. Kept JSON moves to bucket `mail-kept`. OAuth file stays local.

### Career graph (essay evidence)

Already relational in SQLite. Port with Postgres types. This is the evidence Magnet cites in essays (`cards`, bindings, timeline). Keep the same ids so `source_card_ids` on essay commits still resolve.

```sql
create table timeline (
  id text primary key,
  employer text not null,
  title text,
  start text,
  end_date text,
  location text,
  current boolean not null default false
);

create table stubs (
  id text primary key,
  timeline_id text references timeline (id) on delete set null,
  text text not null,
  confidence text not null default 'unverified',
  source text,
  created_at timestamptz
);

create table moments (
  id text primary key,
  text text not null,
  tags text[],
  source text,
  confidence text,
  created_at timestamptz
);

create table cards (
  id text primary key,
  employer_id text,
  employer text,
  claim text not null,
  claim_shape text not null,
  proof text,
  honesty_bound text,
  confidence text not null default 'corroborated',
  source text,
  final_id text,
  created_at timestamptz,
  unique (employer_id, claim_shape)
);

create table card_tags (
  card_id text not null references cards (id) on delete cascade,
  tag text not null,
  primary key (card_id, tag)
);

create table card_links (
  from_id text not null,
  to_id text not null,
  kind text not null,
  primary key (from_id, to_id, kind)
);

create table card_people (
  card_id text not null references cards (id) on delete cascade,
  name text not null,
  relation text not null default '',
  primary key (card_id, name, relation)
);

create table card_shapes (
  card_id text not null references cards (id) on delete cascade,
  shape text not null,
  primary key (card_id, shape)
);

create table positions (
  id text primary key,
  text text not null,
  source text,
  created_at timestamptz
);

create table bindings (
  id text primary key,
  question_shape text not null,
  card_id text references cards (id) on delete set null,
  tag text,
  source text,
  created_at timestamptz
);

create table voice_versions (
  id bigint generated always as identity primary key,
  kind text not null,
  text text not null,
  parent_id bigint references voice_versions (id),
  created_at timestamptz not null default now(),
  source_final_ids text[]
);

create table voice_pending_rules (
  id text primary key,
  rule_id text not null unique,
  text text not null,
  count integer not null default 1,
  created_at timestamptz
);

create table graph_events (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  kind text not null,
  payload jsonb,
  request_id text
);

create index cards_confidence_idx on cards (confidence);
create index bindings_shape_idx on bindings (question_shape);
create index graph_events_request_idx on graph_events (request_id);
```

`lib/graph.js` keeps talking SQL through `lib/store/api.js`. The new driver is Postgres, not a rewrite to supabase-js.

### Logs

Five writers, five tables. Do not merge them. They have different columns and different readers.

```sql
create table action_log (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  request_id uuid,
  kind text not null,
  summary text not null default '',
  extra jsonb not null default '{}'
);

create index action_log_request_idx on action_log (request_id);
create index action_log_ts_idx on action_log (ts desc);

create table action_blobs (
  sha text primary key,                 -- sha256 hex
  key text not null,                    -- name inside the action
  action_id bigint references action_log (id) on delete set null,
  storage_path text not null,           -- action-blobs/<sha>
  created_at timestamptz not null default now()
);

create table llm_log (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  caller text,
  model text,
  model_params jsonb,
  request_id text,
  input text,
  output jsonb,
  error text,
  duration_ms integer
);

create index llm_log_ts_idx on llm_log (ts desc);

create table timing_events (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  kind text not null,                   -- session_start | activate | focus | outcome | …
  tab_id text,
  url text,
  company text,
  title text,
  payload jsonb not null default '{}'
);

create index timing_events_tab_idx on timing_events (tab_id, ts);

create table autofill_attempts (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  url text,
  company text,
  field_count integer,
  essays integer,
  static_ok integer,
  static_total integer,
  proposed integer,
  accepted integer,
  harvested integer,
  save_without_verify boolean,
  essays_only boolean,
  field_id text,
  label text,
  fields jsonb,
  extra jsonb not null default '{}'
);

create index autofill_attempts_url_idx on autofill_attempts (url);

create table essay_commits (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  company text,
  url text,
  label text,
  normalized_key text,
  llm_draft text,
  final text,
  unchanged boolean,
  origin text,
  overlap numeric,
  score numeric,
  source_card_ids text[] not null default '{}'
);

create index essay_commits_url_idx on essay_commits (url);
```

`lib/action-log.js` `loadRequest(requestId)` becomes `select * from action_log where request_id = $1`. Rotate/gzip goes away; keep a 14-day delete policy on `action_log` if the volume warrants it, or keep forever — these rows are small once blobs are in Storage.

`archive/essay-session-<tabId>.json` is a scratch pad for an open tab. Leave it local. If a crash-recovery row is useful later, add `essay_sessions (tab_id pk, payload jsonb)`.

---

## Storage

Private buckets. Service role only.

| Bucket | Path | Source |
| --- | --- | --- |
| `resumes` | `<id>.pdf` | `knowledge/resumes/*.pdf` and portfolio PDFs listed in `resumes.yaml` |
| `action-blobs` | `<sha256>` | `knowledge/archive/blobs/*` |
| `mail-kept` | `<message-id>.json` | `knowledge/mail/kept/*.json` |

Do not store resume bytes in Postgres. The current `resumes.bytes` column was a bundle hack.

---

## Access

Single operator. Simplest setup that is not an open database:

- One Supabase project, region close to the daily-apply VM.
- **No anon grants.** Revoke `public` from `anon`.
- Electron main and `daily-apply.js` use the **service role** from `.env` (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`). Never send that key to a preload or the ATS webview.
- Optional later: one Auth user for a hosted dashboard; then add RLS `auth.uid() = '<owner-uuid>'`. Not required for the first cutover.
- Renderer keeps talking IPC (`magnet:*`). Persist stays in the main process.

Env (local + VM, gitignored):

```
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_DB_URL=          # postgres:// for the store driver (graph SQL)
```

`CURSOR_API_KEY` and Gmail client secrets stay as they are.

---

## Client architecture

```
daily-apply.js ─┐
agent-ctl.js   ─┤
main.js        ─┼─► packages/persist.nodeStore() ─► lib/store/api.js
packages/core  ─┘              │
                               ├─ lib/store/pg.js      (Postgres via SUPABASE_DB_URL)
                               └─ lib/store/index.js   (SQLite, fallback / tests)

lib/action-log.js  ─► action_log + Storage
lib/timing.js      ─► timing_events
lib/cursor-agent.js─► llm_log
lib/autofill.js    ─► autofill_attempts
lib/voice-commit.js─► essay_commits
lib/mail/cache.js  ─► mail_*
lib/profile-facts  ─► persist.getProfile / setProfile   (no YAML write)
lib/ai-submissions ─► persist.upsertJob + applications  (no jobs.yaml edit)
```

Two drivers, one API:

1. **`lib/store/pg.js`** implements `query` / `queryOne` / `exec` / `transaction` against `SUPABASE_DB_URL`. Graph SQL in `lib/graph.js` keeps working. Parameter style: translate `?` to `$1` or use a tagged helper. This is cheaper than rewriting graph to supabase-js.
2. **`packages/persist`** uses the store driver for jobs / applications / profile / recipes, same as now. High-level inserts (logs, Storage uploads) may use `@supabase/supabase-js` with the service role.

Do not add a third path that writes YAML “just in case.” Dual-write only during the migrate window, and only from persist.

SQLite stays for `node --test` via the memory / file driver. Tests should not need a live project.

`packages/core/src/sql-store.js` (mobile / RN) keeps the same method names. When mobile is real, point it at supabase-js. Out of scope for the first cutover.

---

## What each YAML module becomes

| Module | After cutover |
| --- | --- |
| `lib/jobs-file.js` | Read-only helper for migrate. Runtime list comes from persist. |
| `lib/ai-submissions.js` | `recordSubmission` / `appendAgentNote` / `importAgentRows` call persist. Drop text-preserving YAML edits. Drop `ai-submissions` git branch sync once the DB is the ledger. |
| `lib/application-state.js` | Read `application_totals`. `bump(kind)` updates application status. |
| `lib/process-store.js` | Persist only. Delete YAML cache / `saveProcess`. |
| `lib/profile-facts.js` | Persist. Keep dotted-path helpers; they write through `setProfile`. |
| `lib/confirmations.js` | Unchanged. Persist stores the assembled profile. |
| `lib/discover.js` | `upsertJob` / `upsertBoard` only. No `appendListedJobs` YAML mirror. |
| `lib/field-recipes.js` | Persist `field_recipes`. |
| `lib/strategy.js` | Persist fingerprints + scores. |
| `lib/question-catalog.js` | Persist aliases. |
| `lib/employment.js` | Persist `experience_notes`. |
| `lib/resume-pick.js` | Persist + Storage download to a temp file for the ATS attach. |
| `lib/settings.js` | Persist `settings` row. |
| `lib/footprint.js` | Persist `footprints`. |
| `lib/essay-prompt.js` | Persist `documents`. |
| `lib/mail/cache.js` | Persist mail tables. |
| `packages/persist.exportLiveYaml` | Optional debug dump. Remove from `before-quit`. |
| `packages/persist.migrateFromYaml` | One-shot importer, then delete. |

---

## Migration

One Node script: `node scripts/migrate-to-supabase.js`. Idempotent upserts. Run from a machine that has the current `knowledge/` tree and, if present, `magnet.sqlite`.

Order:

1. Apply `supabase/migrations/001_init.sql` (this schema).
2. Open SQLite if it exists; it wins for process, chats, graph, recipes, mail queue.
3. Import YAML / markdown / jsonl. Skip a row when the destination already has that primary key, unless the flag `--force` is set.

| Source | Destination | Notes |
| --- | --- | --- |
| `jobs.yaml` jobs | `jobs` | Compute `canonical_url`. Keep `id`. Copy `location`. Do **not** copy `agent` / `submitted_at` onto `jobs`. |
| `jobs.yaml` jobs with `agent` or `submitted_at` | `applications` | `source = 'agent'`, `status = 'submitted'` if still `open` in process. |
| `jobs.yaml` bugs / blockers | `incidents` | |
| `process.yaml` + SQLite `process_records` | `applications` + events / contacts / essays | SQLite wins on conflict. Split arrays into child rows. |
| `application-state.yaml` | compare to view, then drop | |
| `applicant-profile.yaml` | `applicant` + education / employment / skills / answers | |
| `boards.yaml` + `kv.boards` | `boards` | |
| `tag-rules.yaml` | `tag_rules` | |
| `field-recipes.yaml` + `recipe_items` | `field_recipes` | Prefer the row with `steps` / `learned_at`. |
| `strategy-cache.yaml` | `strategy_fingerprints` + `strategy_scores` | |
| `question-aliases.yaml` | `question_aliases` | |
| `experience-notes.yaml` | `experience_notes` | |
| `resumes.yaml` + PDFs | `resumes` + Storage | Resolve relative paths through the portfolio tree. |
| `settings.yaml` / `kv.settings` | `settings` | |
| `richboi.md`, prompts | `documents` | |
| `archive/chats.json` + `chats` | `chats` + `chat_ui` | |
| mail yaml | `mail_*` | |
| SQLite graph tables | graph tables | 1:1 |
| `archive/actions/*.jsonl` + blobs | `action_log` + Storage | |
| `archive/llm.jsonl` | `llm_log` | |
| `archive/timing.jsonl` | `timing_events` | |
| `archive/attempts.jsonl` | `autofill_attempts` | |
| `archive/answers.jsonl` | `essay_commits` | |

Verify before flipping the runtime flag:

```
jobs count == yaml jobs
applications with status submitted >= yaml agent jobs
incidents == bugs + blockers
applicant_answers == profile.answers
field_recipes == recipes with ids
action_log count == jsonl lines (approx; skip corrupt lines)
resume objects exist in Storage and download
```

Print a diff of URLs in YAML but not in `jobs`, and agent jobs whose application is still `open`.

---

## Cutover

Do this as a sequence of small PRs against JobMagnet, not one rewrite.

### 1. Schema and empty driver

Add `supabase/migrations/001_init.sql`, `lib/store/pg.js`, `@supabase/supabase-js` + `postgres` (or `pg`). Gate with `MAGNET_STORE=sqlite|supabase` (default sqlite). Tests stay on sqlite.

### 2. Persist parity

Implement the full `nodeStore()` on Postgres. Keep YAML export. Add persist tests that run against a local Supabase if `SUPABASE_DB_URL` is set, otherwise skip.

### 3. Import

Land `scripts/migrate-to-supabase.js`. Owner runs it once against the live project. Commit the script, not the data.

### 4. Point writers at persist

In this order, each with a test:

1. `daily-apply.js` record / bug / blocker
2. `lib/process-store.js`
3. `lib/profile-facts.js` + confirmations
4. `lib/discover.js` job/board upsert
5. recipes, strategy, aliases, experience notes, settings, footprints
6. mail cache
7. resume vault → Storage
8. documents (voice / prompts)
9. the five log modules

After (1), daily apply can stop committing `jobs.yaml`. Update `DAILY-APPLY.md` and `AGENTS.md` in that same change: record goes to Supabase; the batch commit is no longer the ledger.

### 5. Stop YAML writes

Remove `exportLiveYaml` from `before-quit`. Remove `appendListedJobs`, surgical profile YAML edits, and `ai-submissions` branch sync. Leave `migrateFromYaml` until the next successful import on a clean project.

### 6. Delete YAML as runtime input

`jobs.yaml` / `process.yaml` / profile / caches become optional fixtures for tests and samples (`samples/contoso.html` jobs can stay as seed SQL or a tiny fixture YAML the test driver loads). Strip PII from anything that remains in git if the profile file is deleted.

### 7. SQLite sunset

When `MAGNET_STORE=supabase` is the only path used in the VM and on the Mac app, delete the sqlite driver from production startup. Keep it for unit tests.

---

## Daily apply after cutover

`DAILY-APPLY.md` step 4 today: `node daily-apply.js record …` then commit `knowledge/jobs.yaml` on `main`.

After step 4 of the cutover:

```
node daily-apply.js record --company … --title … --url … --location …
```

writes `jobs` + `applications` and prints the row. No git commit of a ledger file. Bugs and blockers insert `incidents`.

`daily-apply.js accept` reads persist `hasJobUrl` / `listJobs` instead of `loadJobsDoc`.

Ingest still must not apply the filter; `accept` still does.

If Supabase is unreachable, stop and ping the owner. Do not fall back to YAML. A silent YAML fallback recreates the split brain this plan removes.

---

## Files that stay on disk

| Path | Why |
| --- | --- |
| `samples/*.html` | Local ATS fixtures |
| `knowledge/system-prompt.md` etc. | Optional checkout copies; runtime is `documents` |
| `knowledge/voice.md` | Human prose, not loaded |
| `knowledge/mail/oauth.json` | Tokens |
| `archive/essay-session-*.json` | Tab scratch |
| `.env` | Keys |
| `magnet.sqlite` | Tests / rollback until sunset |

---

## Risks

| Risk | Mitigation |
| --- | --- |
| CLI and Electron write at once (today they race on `jobs.yaml`) | Postgres transactions + unique `canonical_url`. Last write wins on notes; status transitions should be monotonic (`open → submitted → passed\|rejected`). |
| Service role in a VM | VM `.env` only. Rotate if the VM image is shared. |
| Profile PII in git history | Deleting the YAML later does not erase history. Leave that as an owner decision (BFG / ignore). The live copy moves to Supabase. |
| SQLite graph SQL uses `?` and `INTEGER` bools | pg driver adapts placeholders; schema uses `boolean`. Graph helpers that pass `0/1` still work if columns are boolean. |
| Huge `process.yaml` essays | Child `essays` rows. Do not put the whole process record in one JSONB. |
| `exportLiveYaml` dropping `agent` flags | Goes away; status is on `applications`. |
| Mobile sql-store lagging | Same `nodeStore` names; wire later. Electron + CLI is the cutover. |
| Local offline apply | Not supported after sunset. If needed, sqlite replica + sync is a later project. |

---

## Owner setup

Something only the account owner can do. Ping and stop if these are missing when implementation starts:

1. Create a Supabase project (separate from Lupe).
2. Put `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_DB_URL` in `projects/jobmagnet/.env` (and the daily-apply VM).
3. Confirm resume PDFs at the paths in `knowledge/resumes.yaml` are readable on the machine that will run the importer.

---

## Implementation checklist

- [ ] `supabase/migrations/001_init.sql` with the tables in this document
- [ ] Storage buckets `resumes`, `action-blobs`, `mail-kept`
- [ ] Revoke anon; service role only
- [ ] `lib/store/pg.js` + `MAGNET_STORE`
- [ ] Persist methods on Postgres, sqlite tests still green
- [ ] `scripts/migrate-to-supabase.js` + printed verification counts
- [ ] `daily-apply.js` + `DAILY-APPLY.md` + `AGENTS.md` use persist
- [ ] Process, profile, discover, caches, mail, resumes, documents
- [ ] Five log writers
- [ ] Remove YAML write paths and quit-time export
- [ ] Delete runtime YAML reads; keep test fixtures
- [ ] Sunset sqlite in production startup

Each box is one shippable change. Do not batch them into a single PR.
