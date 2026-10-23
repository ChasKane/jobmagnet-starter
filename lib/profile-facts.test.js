const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const facts = require('./profile-facts');

function withTempProfile(body, fn) {
  const prev = process.env.MAGNET_PROFILE;
  const file = path.join(os.tmpdir(), `magnet-profile-${process.pid}-${Date.now()}.yaml`);
  fs.writeFileSync(file, body);
  process.env.MAGNET_PROFILE = file;
  facts.invalidate();
  try {
    return fn(file);
  } finally {
    if (prev == null) delete process.env.MAGNET_PROFILE;
    else process.env.MAGNET_PROFILE = prev;
    facts.invalidate();
    try {
      fs.unlinkSync(file);
    } catch (_) {}
  }
}

test('allowlist writes age and skill years, rejects cards and email', () => {
  withTempProfile('identity:\n  age: 29\n', () => {
    const applied = facts.applyUpdates([
      { path: 'identity.age', value: 30 },
      { path: 'skills.vue', value: 0 },
      { employer: 'Peloton', text: 'Owned Page Builder.' },
      { path: 'identity.email', value: 'nope@example.com' },
    ]);
    assert.deepEqual(
      applied.map((row) => ({ path: row.path, value: row.value })),
      [
        { path: 'identity.age', value: 30 },
        { path: 'skills.vue.years', value: 0 },
      ]
    );
    const doc = facts.load();
    assert.equal(doc.identity.age, 30);
    assert.equal(doc.skills.vue.years, 0);
    assert.equal(doc.identity.email, undefined);
  });
});

test('surgical write keeps comments', () => {
  withTempProfile('# keep this\nidentity:\n  age: 29\n  first_name: Alex\n', (file) => {
    facts.applyUpdates([{ path: 'identity.age', value: 30 }]);
    const raw = fs.readFileSync(file, 'utf8');
    assert.match(raw, /# keep this/);
    assert.match(raw, /age: 30/);
    assert.match(raw, /first_name: Alex/);
  });
});

test('harvest chat age and vue zero, not angular invention', () => {
  assert.deepEqual(facts.inferFromText("I'm 30, store and fill it"), [{ path: 'identity.age', value: 30 }]);
  assert.deepEqual(facts.inferFromText('vue is 0'), [{ path: 'skills.vue', value: 0 }]);
  assert.deepEqual(facts.inferFromText('i have no exp w vuejs'), [{ path: 'skills.vue', value: 0 }]);
  assert.deepEqual(facts.inferFromText('age is 30'), [{ path: 'identity.age', value: 30 }]);
});

test('experience_updates that are closed facts do not become cards', () => {
  const split = facts.splitExperienceUpdates([
    { employer: '', text: "I'm 30" },
    { employer: 'Peloton', text: 'Owned Page Builder conversion.' },
    { path: 'skills.vue', value: 0 },
  ]);
  assert.deepEqual(split.profile, [
    { path: 'identity.age', value: 30 },
    { path: 'skills.vue', value: 0 },
  ]);
  assert.equal(split.cards.length, 1);
  assert.match(split.cards[0].text, /Page Builder/);
});

test('profileFacts expose age and skill years', () => {
  const factsOut = facts.profileFacts({
    identity: { age: 30, first_name: 'Alex' },
    skills: { javascript: { years: 8 }, as_of: '2026-09' },
  });
  assert.equal(factsOut.age, 30);
  assert.equal(factsOut.skills.javascript, 8);
  assert.equal(factsOut.skills.as_of, undefined);
});

test('answers overlay does not wipe identity or skills', () => {
  withTempProfile(
    '# keep this\nidentity:\n  first_name: Alex\nskills:\n  javascript:\n    years: 8\n',
    (file) => {
      facts.setTopLevel('answers', {
        other_phone: { class: 'other:phone', value: '5550100199', confidence: 'confirmed' },
      });
      const raw = fs.readFileSync(file, 'utf8');
      assert.match(raw, /# keep this/);
      assert.match(raw, /first_name: Alex/);
      assert.match(raw, /javascript:/);
      assert.match(raw, /answers:/);
      const doc = facts.load();
      assert.equal(doc.identity.first_name, 'Alex');
      assert.equal(doc.skills.javascript.years, 8);
      assert.equal(doc.answers.other_phone.value, '5550100199');
    }
  );
});

test('LLM profile_updates win over regex on the same path', () => {
  const merged = facts.mergeUpdates(
    [{ path: 'identity.age', value: 31 }],
    [{ path: 'identity.age', value: 30 }, { path: 'skills.javascript.years', value: 8 }]
  );
  assert.equal(merged.find((r) => r.path === 'identity.age').value, 31);
  assert.equal(merged.find((r) => r.path === 'skills.javascript.years').value, 8);
});
