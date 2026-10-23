-- JobMagnet store. Service role / postgres user only.
-- Deviations from the first plan, matching the app as it runs now:
--   application status includes interviewing and offer
--   timeline.current is integer because graph writes 0/1; column end_date is rewritten from `end`
--   graph writes INSERT INTO events; the driver rewrites that to graph_events
--   voice_versions.source_final_ids is text (graph stores a JSON string)
--   application contact ids are text (the app uses c-<timestamp>, not uuids)
--   essays.field_id keeps the page field id; essay_commits is the append-only log
--   field_recipes.extra holds keys such as selector that are not their own columns

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'application_status') then
    create type application_status as enum (
      'open', 'submitted', 'passed', 'rejected', 'withdrawn', 'interviewing', 'offer'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'application_source') then
    create type application_source as enum ('manual', 'agent', 'import');
  end if;
  if not exists (select 1 from pg_type where typname = 'incident_kind') then
    create type incident_kind as enum ('bug', 'blocker');
  end if;
end $$;

create table if not exists jobs (
  id text primary key,
  url text not null,
  canonical_url text not null,
  company text not null default '',
  title text not null default '',
  linkedin text not null default '',
  posting text not null default '',
  logo text not null default '',
  hostname text not null default '',
  salary text not null default '',
  yoe text not null default '',
  level text not null default '',
  location text not null default '',
  industries text[] not null default '{}',
  skills text[] not null default '{}',
  notes text not null default '',
  sort_index integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists jobs_canonical_url_uidx on jobs (canonical_url);
create index if not exists jobs_linkedin_idx on jobs (linkedin) where linkedin <> '';
create index if not exists jobs_posting_idx on jobs (posting) where posting <> '';
create index if not exists jobs_company_idx on jobs (lower(company));

create table if not exists applications (
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
  jd jsonb,
  posting jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (canonical_url)
);

create index if not exists applications_status_idx on applications (status);
create index if not exists applications_job_id_idx on applications (job_id);

create table if not exists application_events (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications (id) on delete cascade,
  at timestamptz not null default now(),
  type text not null,
  title text not null default '',
  body text not null default '',
  contact_id text,
  deleted boolean not null default false
);

create index if not exists application_events_app_idx on application_events (application_id, at);

create table if not exists application_contacts (
  id text primary key,
  application_id uuid not null references applications (id) on delete cascade,
  name text not null default '',
  email text not null default '',
  role text not null default '',
  extra jsonb not null default '{}'
);

create table if not exists essays (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications (id) on delete cascade,
  field_id text not null default '',
  label text not null default '',
  normalized_key text not null default '',
  llm_draft text not null default '',
  final text not null default '',
  source_card_ids text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists essays_app_idx on essays (application_id);

create or replace view application_totals as
select
  count(*) filter (where status = 'submitted') as submitted,
  count(*) filter (where status = 'passed') as passed,
  count(*) filter (where status = 'rejected') as rejected
from applications;

create table if not exists incidents (
  id text primary key,
  kind incident_kind not null,
  format text not null,
  area text not null default '',
  host text not null default '',
  company text not null default '',
  url text not null default '',
  what text not null,
  where_text text not null default '',
  evidence text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists incidents_kind_idx on incidents (kind);
create index if not exists incidents_host_idx on incidents (host) where host <> '';

create table if not exists applicant (
  id boolean primary key default true check (id),
  identity jsonb not null default '{}',
  eeo jsonb not null default '{}',
  work jsonb not null default '{}',
  policy jsonb not null default '{}',
  skills_as_of date,
  updated_at timestamptz not null default now()
);

insert into applicant (id) values (true) on conflict (id) do nothing;

create table if not exists applicant_education (
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

create table if not exists applicant_employment (
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

create table if not exists applicant_skills (
  slug text primary key,
  years integer not null default 0,
  since integer,
  aliases text[] not null default '{}'
);

create table if not exists applicant_answers (
  class text primary key,
  slug text not null,
  value text not null,
  confidence text not null default 'confirmed',
  source text not null default '',
  label text not null default '',
  confirmed_at timestamptz,
  extra jsonb not null default '{}'
);

create table if not exists boards (
  id uuid primary key default gen_random_uuid(),
  company text not null,
  ats text not null,
  slug text not null,
  source_url text not null default '',
  unique (ats, slug)
);

create table if not exists tag_rules (
  kind text not null check (kind in ('industry', 'skill', 'exclude')),
  slug text not null,
  keywords text[] not null default '{}',
  primary key (kind, slug)
);

create table if not exists field_recipes (
  id text primary key,
  host_includes text[] not null default '{}',
  label_includes text[] not null default '{}',
  label_key text not null default '',
  profile_key text not null default '',
  value text,
  shape jsonb,
  steps jsonb not null default '[]',
  option_hash text not null default '',
  learned_at timestamptz,
  extra jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists field_recipes_host_idx on field_recipes using gin (host_includes);
create index if not exists field_recipes_label_key_idx on field_recipes (label_key) where label_key <> '';

create table if not exists strategy_fingerprints (
  fingerprint text primary key,
  last_success text,
  human_flags text[] not null default '{}',
  updated_at timestamptz not null default now()
);

create table if not exists strategy_scores (
  fingerprint text not null references strategy_fingerprints (fingerprint) on delete cascade,
  strategy text not null,
  wins integer not null default 0,
  losses integer not null default 0,
  last_verified_at timestamptz,
  primary key (fingerprint, strategy)
);

create table if not exists question_aliases (
  class text not null,
  phrase text not null,
  primary key (class, phrase)
);

create table if not exists experience_notes (
  id uuid primary key default gen_random_uuid(),
  employer text not null,
  at timestamptz not null default now(),
  text text not null
);

create index if not exists experience_notes_employer_idx on experience_notes (lower(employer));

create table if not exists footprints (
  id text primary key,
  prompt text not null,
  options_key text not null default '',
  kind text not null default '',
  extra jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

create table if not exists board_probes (
  url text primary key,
  last_status text,
  last_error text,
  probed_at timestamptz not null default now()
);

create table if not exists resumes (
  id text primary key,
  label text not null,
  filename text not null,
  mime text not null default 'application/pdf',
  match_patterns text[] not null default '{}',
  is_default boolean not null default false,
  storage_path text,
  imported_at timestamptz not null default now()
);

create table if not exists settings (
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

insert into settings (id) values (true) on conflict (id) do nothing;

create table if not exists documents (
  kind text primary key,
  body text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists hunt_sessions (
  id boolean primary key default true check (id),
  payload jsonb,
  updated_at timestamptz not null default now()
);

insert into hunt_sessions (id, payload) values (true, null) on conflict (id) do nothing;

create table if not exists chat_ui (
  id boolean primary key default true check (id),
  payload jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

insert into chat_ui (id) values (true) on conflict (id) do nothing;

create table if not exists chats (
  key text primary key,
  company text not null default '',
  title text not null default '',
  page_subtab text not null default 'chat',
  agent_id text not null default '',
  snapshot_key text not null default '',
  messages jsonb not null default '[]',
  folded jsonb not null default '[]',
  updated_at timestamptz not null default now()
);

create table if not exists mail_sync (
  id boolean primary key default true check (id),
  history_id text,
  scanned_at timestamptz,
  connected boolean not null default false,
  email text not null default '',
  indexed integer not null default 0,
  pending integer not null default 0
);

insert into mail_sync (id) values (true) on conflict (id) do nothing;

create table if not exists mail_messages (
  id text primary key,
  hash text not null unique,
  thread_id text,
  from_addr text,
  subject text,
  date timestamptz,
  verdict text,
  matched_url text,
  keep_body boolean not null default false,
  storage_path text,
  created_at timestamptz not null default now()
);

create table if not exists mail_queue (
  id text primary key,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists timeline (
  id text primary key,
  employer text not null,
  title text,
  start text,
  end_date text,
  location text,
  current integer not null default 0
);

create table if not exists stubs (
  id text primary key,
  timeline_id text references timeline (id) on delete set null,
  text text not null,
  confidence text not null default 'unverified',
  source text,
  created_at timestamptz
);

create table if not exists moments (
  id text primary key,
  text text not null,
  tags text,
  source text,
  confidence text,
  created_at timestamptz
);

create table if not exists cards (
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

create table if not exists card_tags (
  card_id text not null references cards (id) on delete cascade,
  tag text not null,
  primary key (card_id, tag)
);

create table if not exists card_links (
  from_id text not null,
  to_id text not null,
  kind text not null,
  primary key (from_id, to_id, kind)
);

create table if not exists card_people (
  card_id text not null references cards (id) on delete cascade,
  name text not null,
  relation text not null default '',
  primary key (card_id, name, relation)
);

create table if not exists card_shapes (
  card_id text not null references cards (id) on delete cascade,
  shape text not null,
  primary key (card_id, shape)
);

create table if not exists positions (
  id text primary key,
  text text not null,
  source text,
  created_at timestamptz
);

create table if not exists bindings (
  id text primary key,
  question_shape text not null,
  card_id text references cards (id) on delete set null,
  tag text,
  source text,
  created_at timestamptz
);

create table if not exists voice_versions (
  id bigint generated always as identity primary key,
  kind text not null,
  text text not null,
  parent_id bigint references voice_versions (id),
  created_at timestamptz not null default now(),
  source_final_ids text
);

create table if not exists voice_pending_rules (
  id text primary key,
  rule_id text not null unique,
  text text not null,
  count integer not null default 1,
  created_at timestamptz
);

create table if not exists graph_events (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  kind text not null,
  payload jsonb,
  request_id text
);

create index if not exists cards_confidence_idx on cards (confidence);
create index if not exists bindings_shape_idx on bindings (question_shape);
create index if not exists graph_events_request_idx on graph_events (request_id);

create table if not exists action_log (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  request_id text,
  kind text not null,
  summary text not null default '',
  extra jsonb not null default '{}'
);

create index if not exists action_log_request_idx on action_log (request_id);
create index if not exists action_log_ts_idx on action_log (ts desc);

create table if not exists action_blobs (
  sha text primary key,
  key text not null,
  action_id bigint references action_log (id) on delete set null,
  storage_path text not null,
  created_at timestamptz not null default now()
);

create table if not exists llm_log (
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

create index if not exists llm_log_ts_idx on llm_log (ts desc);

create table if not exists timing_events (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  kind text not null,
  tab_id text,
  url text,
  company text,
  title text,
  payload jsonb not null default '{}'
);

create index if not exists timing_events_tab_idx on timing_events (tab_id, ts);

create table if not exists autofill_attempts (
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

create index if not exists autofill_attempts_url_idx on autofill_attempts (url);

create table if not exists essay_commits (
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

create index if not exists essay_commits_url_idx on essay_commits (url);

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema public from anon';
    execute 'revoke all on all sequences in schema public from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on all tables in schema public from authenticated';
    execute 'revoke all on all sequences in schema public from authenticated';
  end if;
end $$;
