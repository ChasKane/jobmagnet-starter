const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { confirmClass, contradictClass, invalidate } = require('./confirmations');
const facts = require('./profile-facts');
const { reviewGate } = require('./review-gate');

function withTempProfile(body, fn) {
  const prev = process.env.MAGNET_PROFILE;
  const file = path.join(os.tmpdir(), `magnet-profile-${process.pid}-${Date.now()}.yaml`);
  fs.writeFileSync(file, body);
  process.env.MAGNET_PROFILE = file;
  facts.invalidate();
  invalidate();
  try {
    return fn(file);
  } finally {
    if (prev == null) delete process.env.MAGNET_PROFILE;
    else process.env.MAGNET_PROFILE = prev;
    facts.invalidate();
    invalidate();
    try {
      fs.unlinkSync(file);
    } catch (_) {}
  }
}

test('known year that already landed is not asked', () => {
  const field = {
    route: 'static',
    label: 'How many years of hand-on experience do you have with VueJs?',
    intended: '0',
    current: '0',
    residual: 'intended_neq_current',
  };
  const gate = reviewGate(field, { afterRetry: true });
  assert.equal(gate.ask, false);
  assert.equal(gate.reason, 'landed');
});

test('confirmed leftover retries instead of asking', () => {
  withTempProfile('skills:\n  solid:\n    years: 0\n', () => {
    confirmClass('years:solid', '0', { source: 'accept', label: 'Years of Solid' });
    const field = {
      route: 'static',
      label: 'How many years of experience do you have with Solid?',
      intended: '0',
      current: '',
      residual: 'red',
    };
    const first = reviewGate(field);
    assert.equal(first.retry, true);
    assert.equal(first.ask, false);
    assert.equal(first.value, '0');
    const after = reviewGate({ ...field, current: '' }, { afterRetry: true });
    assert.equal(after.ask, true);
    assert.equal(after.reason, 'couldnt-land');
  });
});

test('wrong intended city on a US yes-no is teachable after retry', () => {
  const field = {
    route: 'static',
    label: 'Are you based in the United States or Canada?',
    intended: 'Suite 106',
    current: 'false',
    residual: 'intended_neq_current',
    type: 'checkbox',
    options: ['true', 'false'],
  };
  const gate = reviewGate(field, { afterRetry: true });
  assert.equal(gate.ask, true);
  assert.equal(gate.reason, 'wrong-intended');
});

test('known year with a noisy Yes current is teachable after retry', () => {
  withTempProfile('skills:\n  javascript:\n    years: 8\n    aliases: [js]\n', () => {
  const field = {
    route: 'static',
    label: 'How many years of hand-on experience do you have with Javascript?',
    intended: '8',
    current: 'Yes',
    residual: 'intended_neq_current',
  };
  const gate = reviewGate(field, { afterRetry: true });
  assert.equal(gate.ask, true);
  assert.equal(gate.reason, 'wrong-intended');
  });
});

test('unknown leftover still asks', () => {
  const field = {
    route: 'static',
    label: 'What is your favorite Pokemon?',
    intended: '',
    current: '',
    residual: 'red',
  };
  assert.equal(reviewGate(field, { afterRetry: true }).ask, true);
});

test('contradicted class asks again', () => {
  withTempProfile('skills:\n  vue:\n    years: 0\n', () => {
    contradictClass('years:vue', { source: 'wrong_value' });
    const field = {
      route: 'static',
      label: 'How many years of Vue experience do you have?',
      intended: '0',
      current: '0',
    };
    assert.equal(reviewGate(field, { afterRetry: true }).reason, 'contradicted');
    assert.equal(reviewGate(field).ask, true);
  });
});

test('consent that did not land stays a leftover after retry', () => {
  const field = {
    route: 'static',
    label: 'Candidate Consent Acknowledgment',
    intended: 'I agree',
    current: '',
    residual: 'red',
  };
  const gate = reviewGate(field, { afterRetry: true });
  assert.equal(gate.ask, true);
  assert.equal(gate.reason, 'couldnt-land');
});

test('Reddit demographic consent that did not land stays a leftover', () => {
  const field = {
    route: 'static',
    label:
      'By checking this box, I consent to Reddit collecting, storing, and processing my responses to the demographic data surveys above.',
    intended: 'Yes',
    current: '',
    residual: 'red',
    type: 'checkbox',
  };
  const gate = reviewGate(field, { afterRetry: true });
  assert.equal(gate.ask, true);
  assert.equal(gate.reason, 'couldnt-land');
});

test('consent that landed is not a leftover', () => {
  const field = {
    route: 'static',
    label: 'Candidate Consent Acknowledgment',
    intended: 'I agree',
    current: 'I agree',
    residual: null,
  };
  const gate = reviewGate(field, { afterRetry: true });
  assert.equal(gate.ask, false);
  assert.equal(gate.reason, 'landed');
});

test('classified static with no fact is a leftover, not chat', () => {
  withTempProfile('identity:\n  first_name: Alex\n', () => {
    const field = {
      route: 'static',
      label: 'What is your age range?',
      options: ['18-24', '25-34'],
      intended: '',
      current: '',
    };
    const gate = reviewGate(field);
    assert.equal(gate.ask, true);
    assert.equal(gate.reason, 'no-fact');
    assert.equal(gate.class, 'age:range');
  });
});

test('unlabeled leftover is not a chat dump', () => {
  const field = {
    route: 'static',
    label: 'What is your favorite Pokemon?',
    intended: '',
    current: '',
    residual: 'red',
  };
  const gate = reviewGate(field, { afterRetry: true });
  assert.equal(gate.ask, true);
  assert.equal(gate.reason, 'unlabeled');
});

test('essay with no fact stays on the chat path', () => {
  const gate = reviewGate({
    route: 'needs_llm',
    label: 'Why do you want to work here?',
    intended: '',
    current: '',
  });
  assert.equal(gate.ask, false);
  assert.equal(gate.reason, 'route');
});

test('green field whose current matches intended is not a leftover', () => {
  const { dropLandedFills } = require('./review-gate');
  const field = {
    id: 'city',
    route: 'static',
    label: 'City',
    intended: 'Seattle',
    current: 'Seattle',
    magnetState: 'green',
    fill: { ok: true },
  };
  const gate = reviewGate(field, { afterRetry: true });
  assert.equal(gate.ask, false);
  assert.equal(gate.reason, 'landed');
  assert.deepEqual(
    dropLandedFills([{ id: 'city', value: 'Seattle' }], [field]),
    []
  );
});

test('ATS prefill matching intended is landed, not couldnt-land', () => {
  const field = {
    route: 'static',
    label: 'Are you legally authorized to work in the United States?',
    intended: 'Yes',
    current: 'Yes',
    prefill: 'Yes',
    residual: 'red',
    magnetState: 'green',
    fill: { ok: true, skipped: 'nonempty' },
  };
  const gate = reviewGate(field, { afterRetry: true });
  assert.equal(gate.ask, false);
  assert.equal(gate.reason, 'landed');
});

test('LLM fill for a green nonempty field is dropped', () => {
  const { dropLandedFills } = require('./review-gate');
  const field = {
    id: 'country',
    route: 'static',
    label: 'Country',
    intended: 'United States',
    current: 'United States',
    magnetState: 'green',
    fill: { ok: true },
  };
  assert.deepEqual(dropLandedFills([{ id: 'country', value: 'USA' }], [field]), []);
});

test('starred empty unlabeled is asked, not clean', () => {
  const field = {
    route: 'static',
    label: 'Please select up to 2 ethnicities that you most closely identify with.*',
    intended: '',
    current: '',
  };
  const gate = reviewGate(field, { afterRetry: true });
  assert.equal(gate.ask, true);
  assert.notEqual(gate.reason, 'clean');
});

test('phone number on LinkedIn is a leftover even when green', () => {
  const { dropLandedFills } = require('./review-gate');
  const field = {
    id: 'linkedin',
    route: 'static',
    label: 'LinkedIn Profile',
    type: 'url',
    intended: 'https://www.linkedin.com/in/example/',
    current: '5550100199',
    magnetState: 'green',
    fill: { ok: true, skipped: 'nonempty' },
  };
  const gate = reviewGate(field, { afterRetry: true });
  assert.equal(gate.ask, true);
  assert.equal(gate.reason, 'wrong-intended');
  assert.equal(dropLandedFills([{ id: 'linkedin', value: 'https://www.linkedin.com/in/example/' }], [field]).length, 1);
});

test('unchecked consent stays a leftover even when painted green', () => {
  const { dropLandedFills } = require('./review-gate');
  const field = {
    id: 'consent',
    route: 'static',
    label:
      'By checking this box, I consent to Reddit collecting, storing, and processing my responses to the demographic data surveys above.',
    type: 'checkbox',
    intended: 'Yes',
    current: 'No',
    checked: false,
    magnetState: 'green',
    fill: { ok: true, skipped: 'nonempty' },
  };
  const gate = reviewGate(field, { afterRetry: true });
  assert.equal(gate.ask, true);
  assert.equal(gate.reason, 'couldnt-land');
  assert.equal(dropLandedFills([{ id: 'consent', value: 'Yes' }], [field]).length, 1);
});

test('dial-code current on gender is a leftover, not landed', () => {
  const field = {
    id: 'gender',
    route: 'static',
    label: 'What gender identity do you most closely identify with?',
    type: 'combobox',
    reactSelect: true,
    intended: 'Cayman Islands+1',
    current: 'Cayman Islands+1',
    magnetState: 'green',
    fill: { ok: true },
    options: ['Cayman Islands+1', 'Ascension Island+247', 'Afghanistan+93', 'Canada+1', 'United States+1', 'United Kingdom+44'],
  };
  const gate = reviewGate(field, { afterRetry: true });
  assert.equal(gate.ask, true);
  assert.notEqual(gate.reason, 'landed');
});

test('unlabeled leftover that ATS already filled is not asked', () => {
  const field = {
    route: 'static',
    label: 'What is your favorite Pokemon?',
    intended: '',
    current: 'Pikachu',
    residual: 'red',
  };
  const gate = reviewGate(field, { afterRetry: true });
  assert.equal(gate.ask, false);
  assert.equal(gate.reason, 'landed');
});

test('closed choice with no landing option is needs-infer, not skip', () => {
  const field = {
    route: 'static',
    label: 'Where are you based relative to our hubs?',
    type: 'checkbox',
    options: ['Atlanta, GA', 'Boston, MA'],
    intended: '',
    current: '',
    residual: 'needs-infer',
    reason: 'needs-infer',
    magnetState: 'red',
  };
  const gate = reviewGate(field, { afterRetry: true });
  assert.equal(gate.ask, true);
  assert.equal(gate.reason, 'needs-infer');
  assert.notEqual(gate.reason, 'route');
});

test('dropLandedFills keeps inferred fills after a green write', () => {
  const { dropLandedFills } = require('./review-gate');
  const field = {
    id: 'hubs',
    route: 'static',
    label: 'Where are you based relative to our hubs?',
    type: 'checkbox',
    options: ['Atlanta, GA', 'Boston, MA'],
    intended: 'Atlanta, GA',
    current: 'Atlanta, GA',
    magnetState: 'green',
    fill: { ok: true },
  };
  assert.equal(
    dropLandedFills([{ id: 'hubs', value: 'Atlanta, GA', gate: 'inferred' }], [field]).length,
    1
  );
});
