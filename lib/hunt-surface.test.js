const { test } = require('node:test');
const assert = require('node:assert/strict');
const { HUNT_TAB_ID, isHuntTab, huntShowsApply } = require('./hunt-surface');

test('hunt tab is a reserved id, not a job', () => {
  assert.equal(HUNT_TAB_ID, '__hunt__');
  assert.equal(isHuntTab(HUNT_TAB_ID), true);
  assert.equal(isHuntTab('job-1'), false);
});

test('ingest hunt is hidden except when a sign-in is required', () => {
  assert.equal(huntShowsApply('open'), false);
  assert.equal(huntShowsApply('begin'), false);
  assert.equal(huntShowsApply('click'), false);
  assert.equal(huntShowsApply('login'), true);
});
