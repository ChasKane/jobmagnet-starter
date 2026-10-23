const { test } = require('node:test');
const assert = require('node:assert/strict');
const { boardFromUrl } = require('./src/boards');
const {
  companySlug,
  holdKeys,
  isHeld,
  heldSet,
  pickOnePerCompany,
  boardsToFetch,
  formatCompanyHeld,
  listingAlreadyHeld,
  textHasCompany,
} = require('./src/company-hold');

test('company slug drops legal suffixes and punctuation', () => {
  assert.equal(companySlug('Stripe, Inc.'), 'stripe');
  assert.equal(companySlug('Stripe'), 'stripe');
  assert.equal(companySlug('AT&T'), 'atandt');
  assert.equal(companySlug(''), '');
});

test('greenhouse slug and display name share a hold key', () => {
  const existing = heldSet(
    [{ company: 'Stripe, Inc.', url: 'https://www.linkedin.com/jobs/view/1' }],
    boardFromUrl
  );
  const row = {
    company: 'stripe',
    url: 'https://boards.greenhouse.io/stripe/jobs/9',
    posting: 'https://boards.greenhouse.io/stripe/jobs/9',
  };
  assert.equal(isHeld(row, existing, boardFromUrl), true);
  assert.ok(holdKeys(row, boardFromUrl).includes('board:greenhouse/stripe'));
});

test('a posting with no company and no board is not held', () => {
  const existing = heldSet([{ company: 'Stripe', url: 'https://www.linkedin.com/jobs/view/1' }], boardFromUrl);
  assert.equal(
    isHeld({ company: 'LinkedIn', url: 'https://www.linkedin.com/jobs/view/99' }, existing, boardFromUrl),
    false
  );
});

test('pickOnePerCompany keeps the first listing from each employer', () => {
  const jobs = [
    { company: 'Beta', url: 'https://boards.greenhouse.io/beta/jobs/1', title: 'A' },
    { company: 'Beta', url: 'https://boards.greenhouse.io/beta/jobs/2', title: 'B' },
    { company: 'Acme', url: 'https://boards.greenhouse.io/acme/jobs/3', title: 'C' },
  ];
  const picked = pickOnePerCompany(jobs, [{ company: 'Acme', url: 'https://boards.greenhouse.io/acme/jobs/0' }], boardFromUrl);
  assert.deepEqual(
    picked.map((j) => j.url),
    ['https://boards.greenhouse.io/beta/jobs/1']
  );
});

test('boards already listed are not fetched again', () => {
  const next = boardsToFetch(
    [
      { company: 'Acme', ats: 'greenhouse', slug: 'acme' },
      { company: 'Beta', ats: 'lever', slug: 'beta' },
    ],
    [{ company: 'Acme', url: 'https://boards.greenhouse.io/acme/jobs/1' }],
    boardFromUrl
  );
  assert.deepEqual(
    next.map((b) => b.slug),
    ['beta']
  );
});

test('formatCompanyHeld is empty at zero', () => {
  assert.equal(formatCompanyHeld(0), '');
  assert.match(formatCompanyHeld(2), /Skipped 2/);
});

test('a stored company is already held on a card, and a substring is not', () => {
  const jobs = [{ company: 'Acme', url: 'https://www.linkedin.com/jobs/view/1', title: 'Old' }];
  assert.equal(textHasCompany('Frontend Engineer Acme', 'Acme'), true);
  assert.equal(textHasCompany('Metadata engineer', 'Meta'), false);
  assert.equal(
    listingAlreadyHeld({ href: 'https://www.linkedin.com/jobs/view/1', name: 'Old role' }, jobs, boardFromUrl),
    true
  );
  assert.equal(listingAlreadyHeld({ name: 'Frontend Engineer Acme' }, jobs, boardFromUrl), true);
  assert.equal(
    listingAlreadyHeld(
      { url: 'https://www.linkedin.com/jobs/view/99', title: 'Frontend Engineer | Beta | LinkedIn' },
      jobs,
      boardFromUrl
    ),
    false
  );
});
