const { test } = require('node:test');
const assert = require('node:assert/strict');
const { adaptSql } = require('./sql-adapt');

test('adaptSql numbers placeholders and rewrites sqlite graph syntax', () => {
  const sql = adaptSql(
    "INSERT OR IGNORE INTO card_tags (card_id, tag) VALUES (?, ?) "
  );
  assert.match(sql, /INSERT INTO card_tags/);
  assert.match(sql, /\$1/);
  assert.match(sql, /\$2/);
  assert.match(sql, /ON CONFLICT DO NOTHING/);
  assert.equal(adaptSql('INSERT INTO events (kind) VALUES (?)'), 'INSERT INTO graph_events (kind) VALUES ($1)');
  assert.equal(
    adaptSql('UPDATE timeline SET title = ?, end = ? WHERE id = ?'),
    'UPDATE timeline SET title = $1, end_date = $2 WHERE id = $3'
  );
  assert.equal(
    adaptSql("SELECT GROUP_CONCAT(t.tag, ',') AS tags FROM cards c WHERE c.confidence = ?"),
    "SELECT string_agg(t.tag::text, ',') AS tags FROM cards c WHERE c.confidence = $1"
  );
});

test('adaptSql leaves question marks inside strings', () => {
  assert.equal(adaptSql("SELECT '?' AS q, ? AS n"), "SELECT '?' AS q, $1 AS n");
});
