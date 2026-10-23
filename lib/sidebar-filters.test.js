const { test } = require('node:test');
const assert = require('node:assert/strict');
const filters = require('./sidebar-filters');

test('normalize defaults to open jobs sorted by most recent update', () => {
  assert.deepEqual(filters.normalize({}), filters.DEFAULTS);
  assert.equal(filters.normalize({ sort: 'nope' }).sort, 'updated');
  assert.equal(filters.normalize({ status: 'passed', sort: 'salary', q: 'cedar' }).status, 'passed');
});

test('updated sort puts pass and complete ahead of older jobs', () => {
  const rows = [
    { id: 'old', company: 'Acme', updatedAt: '2026-01-01T00:00:00.000Z' },
    { id: 'passed', company: 'Beta', events: [{ at: '2026-09-18T12:00:00.000Z', type: 'passed' }] },
    { id: 'done', company: 'Cedar', updated_at: '2026-09-18T18:00:00.000Z' },
  ];
  assert.deepEqual(
    filters.apply(rows, { status: 'all', sort: 'updated' }).map((j) => j.id),
    ['done', 'passed', 'old']
  );
});

test('pass/complete timestamps count even when only the process record changed', () => {
  const job = { id: 'job-1', company: 'Acme', updatedAt: '2026-01-01T00:00:00.000Z' };
  const rec = { updated_at: '2026-09-18T20:00:00.000Z', events: [{ at: '2026-09-18T20:00:00.000Z', type: 'passed' }] };
  assert.equal(filters.updatedAt(job, rec), '2026-09-18T20:00:00.000Z');
  assert.ok(filters.lastUpdatedMs(job, rec) > filters.lastUpdatedMs(job, {}));
});

test('attribute sorts use the obvious rank', () => {
  const rows = [
    { id: 'a', company: 'Zed', title: 'Frontend', salary: '$120k', yoe: '3-5', level: 'mid', sortIndex: 0 },
    { id: 'b', company: 'Acme', title: 'Staff Engineer', salary: '$200K/yr', yoe: '8+', level: 'staff', sortIndex: 1 },
    { id: 'c', company: 'Midco', title: 'Backend', salary: 'guess ≥$100k', yoe: '0-2', level: 'junior', sortIndex: 2 },
  ];
  assert.deepEqual(
    filters.apply(rows, { status: 'all', sort: 'company' }).map((j) => j.id),
    ['b', 'c', 'a']
  );
  assert.deepEqual(
    filters.apply(rows, { status: 'all', sort: 'salary' }).map((j) => j.id),
    ['b', 'a', 'c']
  );
  assert.deepEqual(
    filters.apply(rows, { status: 'all', sort: 'yoe' }).map((j) => j.id),
    ['b', 'a', 'c']
  );
  assert.deepEqual(
    filters.apply(rows, { status: 'all', sort: 'level' }).map((j) => j.id),
    ['b', 'a', 'c']
  );
  assert.deepEqual(
    filters.apply(rows, { status: 'all', sort: 'added' }).map((j) => j.id),
    ['a', 'b', 'c']
  );
});

test('status and search filters still apply before sort', () => {
  const rows = [
    { id: 'a', company: 'Cedar', bucket: 'open', updatedAt: '2026-09-18T10:00:00.000Z' },
    { id: 'b', company: 'Cedar', bucket: 'passed', updatedAt: '2026-09-18T20:00:00.000Z' },
    { id: 'c', company: 'Acme', bucket: 'open', updatedAt: '2026-09-18T22:00:00.000Z' },
  ];
  assert.deepEqual(
    filters.apply(rows, { status: 'open', q: 'cedar', sort: 'updated' }).map((j) => j.id),
    ['a']
  );
});
