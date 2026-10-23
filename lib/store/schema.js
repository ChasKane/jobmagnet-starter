/** Same SQL as schema.sql — string form so Metro / Expo can load it. */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS timeline (
  id TEXT PRIMARY KEY,
  employer TEXT NOT NULL,
  title TEXT,
  start TEXT,
  end TEXT,
  location TEXT,
  current INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS stubs (
  id TEXT PRIMARY KEY,
  timeline_id TEXT REFERENCES timeline(id),
  text TEXT NOT NULL,
  confidence TEXT DEFAULT 'unverified',
  source TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS moments (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  tags TEXT,
  source TEXT,
  confidence TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY,
  employer_id TEXT,
  employer TEXT,
  claim TEXT NOT NULL,
  claim_shape TEXT NOT NULL,
  proof TEXT,
  honesty_bound TEXT,
  confidence TEXT DEFAULT 'corroborated',
  source TEXT,
  final_id TEXT,
  created_at TEXT,
  UNIQUE (employer_id, claim_shape)
);

CREATE TABLE IF NOT EXISTS card_tags (
  card_id TEXT NOT NULL,
  tag TEXT NOT NULL,
  PRIMARY KEY (card_id, tag)
);

CREATE TABLE IF NOT EXISTS card_links (
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  PRIMARY KEY (from_id, to_id, kind)
);

CREATE TABLE IF NOT EXISTS card_people (
  card_id TEXT NOT NULL,
  name TEXT NOT NULL,
  relation TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (card_id, name, relation)
);

CREATE TABLE IF NOT EXISTS card_shapes (
  card_id TEXT NOT NULL,
  shape TEXT NOT NULL,
  PRIMARY KEY (card_id, shape)
);

CREATE TABLE IF NOT EXISTS positions (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  source TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS bindings (
  id TEXT PRIMARY KEY,
  question_shape TEXT NOT NULL,
  card_id TEXT,
  tag TEXT,
  source TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS voice_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  parent_id INTEGER,
  created_at TEXT,
  source_final_ids TEXT
);

CREATE TABLE IF NOT EXISTS voice_pending_rules (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL UNIQUE,
  text TEXT NOT NULL,
  count INTEGER DEFAULT 1,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT,
  request_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_cards_confidence ON cards(confidence);
CREATE INDEX IF NOT EXISTS idx_bindings_shape ON bindings(question_shape);
CREATE INDEX IF NOT EXISTS idx_events_request ON events(request_id);

CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  company TEXT,
  title TEXT,
  linkedin TEXT,
  posting TEXT,
  logo TEXT,
  hostname TEXT,
  salary TEXT,
  yoe TEXT,
  level TEXT,
  industries TEXT,
  skills TEXT,
  notes TEXT,
  sort_index INTEGER DEFAULT 0,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_jobs_url ON jobs(url);
CREATE INDEX IF NOT EXISTS idx_jobs_linkedin ON jobs(linkedin);
CREATE INDEX IF NOT EXISTS idx_jobs_posting ON jobs(posting);

CREATE TABLE IF NOT EXISTS process_records (
  url TEXT PRIMARY KEY,
  status TEXT,
  submitted_at TEXT,
  rejected_at TEXT,
  contacts TEXT,
  events TEXT,
  prep_notes TEXT,
  jd TEXT,
  posting TEXT,
  essays TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS resumes (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime TEXT,
  match_patterns TEXT,
  is_default INTEGER DEFAULT 0,
  rel_path TEXT,
  imported_at TEXT,
  bytes TEXT
);

CREATE TABLE IF NOT EXISTS chats (
  key TEXT PRIMARY KEY,
  messages TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS confirmation_items (
  class TEXT PRIMARY KEY,
  payload TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recipe_items (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mail_items (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  created_at TEXT
);
`;

const MIGRATE = [
  'ALTER TABLE resumes ADD COLUMN bytes TEXT',
];

module.exports = { SCHEMA, MIGRATE };
