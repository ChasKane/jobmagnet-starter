#!/usr/bin/env node
const { loadRequest, hydrate } = require('./action-log');

const requestId = process.argv[2];
if (!requestId) {
  process.stderr.write('usage: node lib/action-replay.js <request_id>\n');
  process.exit(1);
}

const rows = loadRequest(requestId).map(hydrate);
if (!rows.length) {
  process.stderr.write(`no actions for ${requestId}\n`);
  process.exit(2);
}

for (const row of rows) {
  process.stdout.write(`\n== ${row.ts} ${row.kind} ==\n${row.summary || ''}\n`);
  const b = row.blobs || {};
  if (b.index) process.stdout.write(`index: ${JSON.stringify(b.index, null, 2)}\n`);
  if (b.selected_ids) process.stdout.write(`selected: ${JSON.stringify(b.selected_ids)}\n`);
  if (b.bindings) process.stdout.write(`bindings: ${JSON.stringify(b.bindings)}\n`);
  if (b.strategy) process.stdout.write(`strategy:\n${b.strategy}\n`);
  if (b.bodies) process.stdout.write(`bodies: ${JSON.stringify(b.bodies, null, 2)}\n`);
  if (b.voice_version_id) process.stdout.write(`voice_version_id: ${b.voice_version_id}\n`);
  if (b.critique) process.stdout.write(`critique:\n${typeof b.critique === 'string' ? b.critique : JSON.stringify(b.critique, null, 2)}\n`);
  if (b.patch) process.stdout.write(`patch: ${JSON.stringify(b.patch, null, 2)}\n`);
}
