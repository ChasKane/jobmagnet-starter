const { test } = require('node:test');
const assert = require('node:assert/strict');
const { planSql, makeDriver, whereQuery } = require('./sql-rest');

function callsRest() {
  const calls = [];
  const rest = {
    select(table, query) {
      calls.push(['select', table, query]);
      if (table === 'jobs' && /sort_index/.test(String(query))) return [{ sort_index: 3 }];
      if (table === 'card_tags') return [{ card_id: 'c1', tag: 'react' }];
      if (table === 'cards') return [{ id: 'c1', employer: 'Lupe', claim: 'shipped', confidence: 'corroborated' }];
      if (table === 'applications') return [{ status: 'submitted' }, { status: 'rejected' }];
      if (table === 'voice_pending_rules') return [{ rule_id: 'r1', count: 2, text: 'old' }];
      return [{ id: 'x', text: 'hello world '.repeat(20) }];
    },
    insert(table, row, opts) {
      calls.push(['insert', table, row, opts]);
      return [];
    },
    patch(table, query, body) {
      calls.push(['patch', table, query, body]);
      return [];
    },
    del(table, query) {
      calls.push(['del', table, query]);
      return [];
    },
  };
  return { rest, calls, driver: makeDriver(rest) };
}

test('planSql maps graph sqlite onto PostgREST tables', () => {
  const insert = planSql('INSERT OR IGNORE INTO card_tags (card_id, tag) VALUES (?, ?)', ['c1', 'react']);
  assert.equal(insert.table, 'card_tags');
  assert.equal(insert.ignore, true);
  assert.deepEqual(insert.row, { card_id: 'c1', tag: 'react' });

  const events = planSql('INSERT INTO events (ts, kind, payload, request_id) VALUES (?, ?, ?, ?)', [
    '2026-10-15T00:00:00.000Z',
    'compile',
    '{"ok":true}',
    null,
  ]);
  assert.equal(events.table, 'graph_events');
  assert.deepEqual(events.row.payload, { ok: true });

  const timeline = planSql('UPDATE timeline SET title = ?, end = ?, location = ?, current = ? WHERE id = ?', [
    'Eng',
    '2024',
    'SF',
    1,
    'tl_1',
  ]);
  assert.equal(timeline.body.end_date, '2024');
  assert.equal(timeline.body.title, 'Eng');
  assert.equal(timeline.where.preds[0].value, 'tl_1');
});

test('whereQuery encodes OR, ANY, and case-insensitive employer', () => {
  const or = planSql('SELECT * FROM applications WHERE canonical_url = ? OR url = ?', ['https://a', 'https://b']);
  assert.equal(
    whereQuery(or.where),
    'or=(canonical_url.eq.https%3A%2F%2Fa,url.eq.https%3A%2F%2Fb)'
  );

  const any = planSql('SELECT application_id FROM application_events WHERE application_id = ANY(?::uuid[])', [
    ['u1', 'u2'],
  ]);
  assert.equal(whereQuery(any.where), 'application_id=in.(u1,u2)');

  const lower = planSql('SELECT id FROM timeline WHERE lower(employer) = lower(?)', ['Lupe']);
  assert.equal(whereQuery(lower.where), 'employer=ilike.Lupe');
});

test('oversized ANY filters are split under 4500 characters', () => {
  const { driver, calls } = callsRest();
  const ids = Array.from({ length: 400 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
  driver.query('SELECT application_id, at, type FROM application_events WHERE application_id = ANY(?::uuid[])', [ids]);
  const selects = calls.filter((row) => row[0] === 'select' && row[1] === 'application_events');
  assert.ok(selects.length > 1);
  for (const row of selects) {
    const q = String(row[2]);
    const inn = q.match(/application_id=in\.\([^)]*\)/);
    assert.ok(inn, q.slice(0, 120));
    assert.ok(inn[0].length <= 4500, inn[0].length);
    assert.ok(q.length < 6000, q.length);
  }
  const seen = selects.join('\n');
  assert.match(seen, /00000000-0000-4000-8000-000000000000/);
  assert.match(seen, /00000000-0000-4000-8000-000000000399/);
});

test('interview events filter by type instead of application id', () => {
  const plan = planSql(
    `SELECT application_id, at, type, deleted FROM application_events
     WHERE type IN ('recruiter_screen', 'hiring_manager', 'panel', 'onsite') AND deleted = false
     ORDER BY at`
  );
  assert.equal(whereQuery(plan.where), 'type=in.(recruiter_screen,hiring_manager,panel,onsite)&deleted=eq.false');
});

test('a long ANY filter is split so the request stays under the header limit', () => {
  const { driver, calls } = callsRest();
  const ids = Array.from({ length: 200 }, (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`);
  driver.query(
    'SELECT application_id, at, type, deleted FROM application_events WHERE application_id = ANY(?::uuid[]) ORDER BY at',
    [ids]
  );
  assert.ok(calls.length >= 2);
  const got = [];
  for (const call of calls) {
    assert.equal(call[0], 'select');
    assert.equal(call[1], 'application_events');
    assert.ok(Buffer.byteLength(call[2]) < 8000);
    const match = String(call[2]).match(/in\.\(([^)]*)\)/);
    assert.ok(match);
    got.push(...match[1].split(','));
  }
  assert.deepEqual(got, ids);
});

test('driver select/insert/update/delete hit REST only', () => {
  const { driver, calls } = callsRest();
  const rows = driver.query('SELECT * FROM jobs WHERE id = ?', ['job-1']);
  assert.equal(rows[0].id, 'x');
  assert.equal(calls[0][0], 'select');
  assert.equal(calls[0][1], 'jobs');
  assert.match(calls[0][2], /id=eq.job-1/);

  driver.exec('INSERT INTO documents (kind, body, updated_at) VALUES (?,?,?) ON CONFLICT (kind) DO UPDATE SET body = excluded.body', [
    'voice',
    'Be specific.',
    '2026-10-15T00:00:00.000Z',
  ]);
  assert.equal(calls.at(-1)[0], 'insert');
  assert.equal(calls.at(-1)[3].merge, true);
  assert.deepEqual(calls.at(-1)[3].onConflict, ['kind']);

  const board = planSql(
    'INSERT INTO boards (company, ats, slug, source_url) VALUES (?,?,?,?) ON CONFLICT (ats, slug) DO UPDATE SET company = excluded.company',
    ['Vercel', 'greenhouse', 'vercel', 'https://job-boards.greenhouse.io/vercel']
  );
  assert.equal(board.merge, true);
  assert.deepEqual(board.onConflict, ['ats', 'slug']);
  assert.equal(board.row.slug, 'vercel');

  driver.exec('DELETE FROM card_tags WHERE card_id = ?', ['c1']);
  assert.deepEqual(calls.at(-1).slice(0, 3), ['del', 'card_tags', 'card_id=eq.c1']);

  driver.exec('UPDATE cards SET confidence = ? WHERE id = ?', ['confirmed', 'c1']);
  assert.equal(calls.at(-1)[0], 'patch');
  assert.equal(calls.at(-1)[3].confidence, 'confirmed');
});

test('special selects: max sort, totals fallback, join tags, preview, increment', () => {
  const { driver, calls } = callsRest();
  assert.equal(driver.queryOne('SELECT COALESCE(MAX(sort_index), -1) AS n FROM jobs').n, 3);

  const totals = driver.queryOne('SELECT submitted, passed, rejected FROM application_totals');
  assert.equal(totals.submitted, 1);
  assert.equal(totals.rejected, 1);

  const index = driver.query(
    `SELECT c.id, c.employer, c.claim, c.honesty_bound, c.confidence,
            GROUP_CONCAT(t.tag, ',') AS tags
     FROM cards c LEFT JOIN card_tags t ON t.card_id = c.id
     WHERE c.confidence = ? OR ? = 'any'
     GROUP BY c.id
     ORDER BY c.employer, c.claim`,
    ['corroborated', 'corroborated']
  );
  assert.equal(index[0].tags, 'react');

  const preview = driver.query(
    'SELECT id, kind, parent_id, created_at, substr(text,1,160) AS preview FROM voice_versions ORDER BY id DESC LIMIT ?',
    [40]
  );
  assert.ok(preview[0].preview.length <= 160);

  driver.exec('UPDATE voice_pending_rules SET count = count + 1, text = ? WHERE rule_id = ?', ['new', 'r1']);
  const patch = calls.find((row) => row[0] === 'patch' && row[1] === 'voice_pending_rules');
  assert.equal(patch[3].count, 3);
  assert.equal(patch[3].text, 'new');
});

test('node tests stay on sqlite even when MAGNET_STORE=supabase', () => {
  const { storeMode } = require('./mode');
  assert.equal(storeMode(), 'sqlite');
});

test('jobs.posting stays a text url while application posting stays json', () => {
  const job = planSql('INSERT INTO jobs (id, url, canonical_url, posting, linkedin) VALUES (?,?,?,?,?)', [
    'tab-1',
    'https://x',
    'gh:1',
    '',
    '',
  ]);
  assert.equal(job.row.posting, '');
  assert.equal(job.row.linkedin, '');

  const cleared = planSql('UPDATE jobs SET posting = ? WHERE id = ?', ['', 'tab-1']);
  assert.equal(cleared.body.posting, '');

  const app = planSql('UPDATE applications SET posting = ? WHERE id = ?', ['', 'u1']);
  assert.equal(app.body.posting, null);

  const parsed = planSql('UPDATE applications SET posting = ? WHERE id = ?', ['{"company":"Acme"}', 'u1']);
  assert.deepEqual(parsed.body.posting, { company: 'Acme' });
});

test('open does not read a Postgres URL', () => {
  const prev = process.env.SUPABASE_DB_URL;
  process.env.SUPABASE_DB_URL = 'postgresql://should-not-be-used';
  const { planSql: plan } = require('./sql-rest');
  const insert = plan('INSERT INTO jobs (id, url, canonical_url) VALUES (?,?,?)', ['a', 'https://x', 'https://x']);
  assert.equal(insert.table, 'jobs');
  if (prev == null) delete process.env.SUPABASE_DB_URL;
  else process.env.SUPABASE_DB_URL = prev;
});
