const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isEligibleRole, isEligibleLocation, acceptJobs } = require('./daily-criteria');

test('frontend and full stack pass, backend does not', () => {
  assert.equal(isEligibleRole('Senior Frontend Engineer', ''), true);
  assert.equal(isEligibleRole('Front-End Developer', ''), true);
  assert.equal(isEligibleRole('UI Engineer', ''), true);
  assert.equal(isEligibleRole('Full Stack Engineer', 'APIs and React'), true);
  assert.equal(isEligibleRole('Backend Engineer', 'React is used by the frontend team'), false);
  assert.equal(isEligibleRole('Staff Software Engineer, Backend', ''), false);
  assert.equal(isEligibleRole('Software Engineer', 'Build React interfaces and design systems'), true);
  assert.equal(isEligibleRole('Software Engineer', 'Own the Java services and Postgres schema'), false);
  assert.equal(isEligibleRole('Software Engineer', ''), false);
});

test('remote is open and in-person is contiguous US only', () => {
  assert.equal(isEligibleLocation('Remote'), true);
  assert.equal(isEligibleLocation('Remote - Canada'), true);
  assert.equal(isEligibleLocation('Hybrid - Austin, TX'), true);
  assert.equal(isEligibleLocation('Seattle, WA'), true);
  assert.equal(isEligibleLocation('New York, NY'), true);
  assert.equal(isEligibleLocation('Washington, DC'), true);
  assert.equal(isEligibleLocation('United States'), true);
  assert.equal(isEligibleLocation('Anchorage, AK'), false);
  assert.equal(isEligibleLocation('Honolulu, Hawaii'), false);
  assert.equal(isEligibleLocation('London, United Kingdom'), false);
  assert.equal(isEligibleLocation('Hybrid - Berlin'), false);
  assert.equal(isEligibleLocation('Bangalore, India'), false);
  assert.equal(isEligibleLocation(''), false);
});

test('accept keeps a fresh frontend batch and explains skips', () => {
  const { accepted, rejected } = acceptJobs([
    { company: 'A', title: 'Frontend Engineer', url: 'https://a.example/1', location: 'Remote' },
    { company: 'B', title: 'Backend Engineer', url: 'https://b.example/1', location: 'Remote' },
    { company: 'C', title: 'Full Stack Engineer', url: 'https://c.example/1', location: 'Onsite London' },
    { company: 'D', title: 'React Engineer', url: 'https://d.example/1', location: 'Chicago, IL' },
  ]);
  assert.deepEqual(
    accepted.map((job) => job.company),
    ['A', 'D']
  );
  assert.equal(rejected.length, 2);
});
