const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');

process.env.MAGNET_ARCHIVE = path.join(os.tmpdir(), `magnet-archive-${process.pid}`);

const { append, loadRequest, hydrate, newRequestId } = require('./action-log');

test('action log stores blobs by hash and replay hydrates', () => {
  const requestId = newRequestId();
  append({
    request_id: requestId,
    kind: 'cascade.select',
    summary: 'card_a',
    blobs: { index: [{ id: 'card_a', tags: ['react'] }], selected_ids: ['card_a'] },
    extra: { selected: ['card_a'] },
  });
  const rows = loadRequest(requestId).map(hydrate);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'cascade.select');
  assert.equal(rows[0].blobs.index[0].id, 'card_a');
  assert.deepEqual(rows[0].blobs.selected_ids, ['card_a']);
});
