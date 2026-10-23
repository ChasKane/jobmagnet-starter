const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  compileSearchSchema,
  looksLikeSearch,
  looksLikeApprove,
  normalizeSchema,
  schemaReady,
  toDiscoverCriteria,
  planLines,
  MAX_N,
} = require('./src/search-schema');

test('a search without a count leaves n empty', () => {
  const schema = compileSearchSchema('find remote frontend 140k');
  assert.equal(schema.n, null);
  assert.equal(schema.remote, true);
  assert.equal(schema.salaryMin, 140000);
  assert.ok(schema.titleIncludes.includes('frontend'));
  assert.ok(schema.sites.includes('linkedin'));
  assert.equal(schemaReady(schema), false);
  const ready = compileSearchSchema('find 12 remote frontend 140k');
  assert.equal(ready.n, 12);
  assert.equal(schemaReady(ready), true);
  assert.equal(compileSearchSchema('find 500 frontend roles').n, MAX_N);
});

test('linkedin-only when they name the board', () => {
  const schema = compileSearchSchema('find linkedin frontend');
  assert.deepEqual(schema.sites, ['linkedin']);
});

test('find N sets the count', () => {
  assert.equal(compileSearchSchema('find 12 staff roles').n, 12);
});

test('looksLikeSearch vs paste URLs', () => {
  assert.equal(looksLikeSearch('find remote FE'), true);
  assert.equal(looksLikeSearch('https://boards.greenhouse.io/acme/jobs/1'), false);
  assert.equal(looksLikeApprove('approve'), true);
  assert.equal(looksLikeApprove('Go. Execute that plan.'), true);
  assert.equal(looksLikeApprove('Go. Same plan. Add more until the new listings reach 30.'), true);
  assert.equal(looksLikeApprove('execute the plan'), true);
  assert.equal(looksLikeApprove('Plan 12 frontend roles'), false);
});

test('naming a company is only a company filter', () => {
  const named = compileSearchSchema('find frontend at Stripe');
  assert.equal(named.company, 'Stripe');
  assert.equal(Object.hasOwn(named, 'onePerCompany'), false);
  const again = compileSearchSchema('another opening at Stripe');
  assert.equal(again.company, 'Stripe');
  assert.equal(Object.hasOwn(again, 'onePerCompany'), false);
  assert.equal(planLines(named).some((row) => row.label === 'Per company'), false);
});

test('toDiscoverCriteria uses snake_case for board search', () => {
  const c = toDiscoverCriteria(normalizeSchema({ n: 8, salaryMin: 120000, remote: true, titleIncludes: ['react'] }));
  assert.equal(c.salary_min, 120000);
  assert.deepEqual(c.title_includes, ['react']);
});
