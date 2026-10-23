const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildReviewPrompt } = require('./review-prompt');

test('review sees form outline, not only leftovers', () => {
  const { prompt, payload } = buildReviewPrompt({
    residuals: [
      {
        id: 'm2',
        label: 'Select one of the following',
        heading: 'How did you hear about Hive?',
        type: 'checkbox',
        options: ['Friend', 'LinkedIn'],
        residual: 'red',
      },
    ],
    fields: [
      { id: 'm1', label: 'How did you hear about Hive?', heading: 'How did you hear about Hive?', type: 'checkbox', options: ['Friend', 'LinkedIn'] },
      { id: 'm2', label: 'Select one of the following', heading: 'How did you hear about Hive?', type: 'checkbox', options: ['Friend', 'LinkedIn'] },
    ],
  });
  assert.equal(payload.form_outline.length, 2);
  assert.equal(payload.residuals[0].heading, 'How did you hear about Hive?');
  assert.equal(payload.host, undefined);
  assert.ok((payload.recipes || []).every((r) => r.host_includes == null));
  assert.equal(payload.profile_yaml != null, true);
  assert.ok(Array.isArray(payload.cluster_html));
  assert.match(prompt, /cluster_html/);
  assert.match(prompt, /page_html/);
  assert.match(prompt, /profile_yaml/);
  assert.match(prompt, /Instruction-only labels/);
  assert.doesNotMatch(prompt, /You do not receive page HTML/);
  assert.match(prompt, /Never say "unlabeled"/);
  assert.ok((payload.catalog_classes || []).includes('eeo:orientation'));
  assert.match(prompt, /class_id/);
  assert.match(prompt, /Closed leftover/);
  assert.match(prompt, /location:hubs/);
});

test('field chat carries outline, digest, and focus id', () => {
  const { prompt, payload } = buildReviewPrompt({
    residuals: [{ id: 'school', label: 'School', residual: 'red', hostHtml: '<div class="field">School</div>', clusterHtml: '<form><div class="field">School</div></form>' }],
    fields: [{ id: 'school', label: 'School', type: 'text' }],
    instruction: 'UW, leave cookies blank',
    focus_id: 'school',
    pageHtml: '<html><body><form>School</form></body></html>',
    chat_digest: [{ role: 'you', text: 'Keep the cover short.' }],
    prior: { fills: [{ id: 'tw', label: 'Twitter', value: '' }], asks: [], reply: '' },
  });
  assert.equal(payload.focus_id, 'school');
  assert.equal(payload.form_outline.length, 1);
  assert.equal(payload.cluster_html[0].id, 'school');
  assert.match(payload.page_html, /<form>/);
  assert.equal(payload.chat_digest[0].text, 'Keep the cover short.');
  assert.equal(payload.prior.fills[0].id, 'tw');
  assert.match(prompt, /focus_id/);
  assert.match(prompt, /chat_digest/);
});