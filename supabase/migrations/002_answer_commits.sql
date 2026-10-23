-- Every filled application field, including short profile answers.
-- essay_commits stays the long-form essay log; this table is the full Q&A trail.

create table if not exists answer_commits (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  company text,
  url text,
  label text,
  value text,
  field_id text,
  kind text not null default 'static',
  origin text,
  route text,
  normalized_key text
);

create index if not exists answer_commits_url_idx on answer_commits (url);
create index if not exists answer_commits_ts_idx on answer_commits (ts desc);
