const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  productFromText,
  employerFromProducts,
  stripDraftNames,
  formatCardForDraft,
} = require('./products');

test('auto-filler prose maps to JobMagnet without saying the name', () => {
  const hit = productFromText(
    "I've been building a job application form auto-filler that drafts essays from a content graph of my career stories."
  );
  assert.equal(hit.id, 'jobmagnet');
  assert.equal(employerFromProducts(hit.gloss), '');
});

test('drafts never keep the JobMagnet name', () => {
  const out = stripDraftNames("I've been building JobMagnet for my own search.");
  assert.doesNotMatch(out, /JobMagnet|Job Magnet/i);
  assert.match(out, /auto-filler|content graph/i);
});

test('card formatter hides never-name products and keeps tags', () => {
  const block = formatCardForDraft({
    id: 'card_jm',
    employer: 'Freelance',
    claim: 'I built JobMagnet, an Electron apply browser.',
    proof: 'JobMagnet autofills ATS forms.',
    honesty_bound: 'Not a client product.',
    tags: ['electron'],
  });
  assert.doesNotMatch(block, /I built JobMagnet/);
  assert.match(block, /^### Freelance/m);
  assert.doesNotMatch(block.split('\n')[0], /card_jm/);
  assert.match(block, /internal_id: card_jm/);
  assert.match(block, /Tags:.*jobmagnet/);
  assert.match(block, /Do not write these names: JobMagnet/);
  assert.match(block, /auto-filler|apply browser|content graph/i);
});
