const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const facts = require('./profile-facts');
const {
  resolveValue,
  hydrateSelectOptions,
  collapseChoiceResiduals,
  persistFieldFact,
  seedResidualReview,
  rememberAnswer,
  applyMirrorSave,
  leftoversForChat,
  chatDigest,
  reviewDigest,
  chatFromAutofill,
  harvestForEssayTurn,
  reviewEssayDetail,
  LEFTOVER_REVIEW_DETAIL,
  REVIEW_AND_ESSAYS_DETAIL,
  MATCHING_DETAIL,
  isAgeRangeField,
  parseAgeFromText,
  isPaceTextField,
  wantsPaceType,
  cancelFill,
  attachFillAbort,
  isFillCancelled,
  pickEssayTargets,
  scrubCardIds,
  fillStepsFor,
  fillChain,
  leftoverClosedChoice,
  stampInferredFills,
  persistReviewRecipes,
  applyReviewLearning,
  openApplySurface,
  retryField,
  openFlagReview,
  essayAutofillStatus,
  GREENHOUSE_UPLOADER_SCRIPT,
  GREENHOUSE_RESUME_CHANGE_SCRIPT,
} = require('./autofill');

const profile = {
  work: {
    legally_authorized_to_work_us: true,
    requires_sponsorship_now_or_future: false,
    willing_to_relocate: true,
  },
};

test('Ashby require-authorization is sponsorship No, not work-auth Yes', () => {
  const field = {
    label: 'Will you now or in the future require authorization to work in the United States?',
    type: 'checkbox',
  };
  assert.equal(resolveValue(field, { profile }), 'No');
});

test('work authorization status is US Citizen', () => {
  const field = {
    label: 'What is your current work authorization status?',
    type: 'select',
  };
  assert.equal(
    resolveValue(field, {
      profile: {
        work: {
          us_citizen: true,
          legally_authorized_to_work_us: true,
          requires_sponsorship_now_or_future: false,
        },
      },
    }),
    'US Citizen'
  );
});

test('legally authorized stays Yes', () => {
  const field = {
    label: 'Are you legally authorized to work in the United States?',
    type: 'checkbox',
  };
  assert.equal(resolveValue(field, { profile }), 'Yes');
});

test('need an employer to sponsor is No', () => {
  const field = {
    label: 'Will you now or in the future need an employer to sponsor a work visa?',
    type: 'checkbox',
  };
  assert.equal(resolveValue(field, { profile }), 'No');
});

test('Ashby recording consent picks the agree option', () => {
  const field = {
    label: 'Candidate Consent Acknowledgment',
    type: 'radio',
    options: [
      'I agree and consent to the recording and AI summarization of my interview.',
      'I would like to opt out and request a manual, unrecorded interview.',
    ],
  };
  assert.equal(
    resolveValue(field, { profile }),
    'I agree and consent to the recording and AI summarization of my interview.'
  );
});

test('consent acknowledgment without options still has a value', () => {
  const field = { label: 'Candidate Consent Acknowledgment', type: 'radio' };
  assert.equal(resolveValue(field, { profile }), 'I agree');
});

test('autofill chat payload is essays, not leftover review', () => {
  const chat = chatFromAutofill({
    reply: 'Drafted 2 fields.',
    drafts: [{ id: 'cover', text: 'I built ops platforms.' }],
    asks: [],
    sent: { prompt: 'essay' },
    received: { drafts: [{ id: 'cover' }] },
  });
  assert.equal(chat.reply, 'Drafted 2 fields.');
  assert.equal(chat.drafts.length, 1);
  assert.equal(chat.received.fills, undefined);
  assert.deepEqual(chatFromAutofill(null), {
    reply: '',
    drafts: [],
    asks: [],
    tools: [],
    sent: null,
    received: null,
  });
});

test('chat leftovers send inventory and review extras when review is back', () => {
  const tab = {
    debugFields: [
      { id: 'age1', label: 'What is your age range?', route: 'static', magnetState: 'red', options: [] },
      { id: 'cover', label: 'Cover letter', route: 'needs_llm' },
    ],
    review: {
      fills: [{ id: 'tw', label: 'Twitter', value: 'https://x.com/x', accepted: false }],
      asks: [{ id: 'gh', question: 'GitHub URL?', answered: false }],
    },
  };
  const withReview = leftoversForChat(tab, [{ id: 'cover' }], "I'm 30");
  assert.equal(withReview.leftovers.some((row) => row.id === 'age1'), true);
  assert.equal(withReview.leftovers.some((row) => row.id === 'cover'), false);
  assert.equal(withReview.review_fills.length, 1);
  assert.equal(withReview.review_asks.length, 1);
  const inventoryOnly = leftoversForChat(
    { debugFields: tab.debugFields },
    [{ id: 'cover' }],
    "I'm 30"
  );
  assert.equal(inventoryOnly.leftovers.length, 1);
  assert.equal(inventoryOnly.review_fills.length, 0);
  assert.equal(inventoryOnly.review_asks.length, 0);
  const emptyAutofill = leftoversForChat(tab, [{ id: 'cover' }], '');
  assert.deepEqual(emptyAutofill, { leftovers: [], review_fills: [], review_asks: [] });
});

test('review and chat digests share leftover cards without a second agent', () => {
  const tab = {
    chat: [{ role: 'you', text: 'Keep the cover short.' }],
    review: {
      fills: [{ id: 'tw', label: 'Twitter', value: '', accepted: false }],
      asks: [{ id: 's', question: 'School', reason: 'unlabeled', why: '', answered: false }],
    },
  };
  const digest = reviewDigest(tab);
  assert.equal(digest.asks[0].id, 's');
  assert.equal(digest.asks[0].reason, 'unlabeled');
  assert.equal(chatDigest(tab)[0].text, 'Keep the cover short.');
  const pack = leftoversForChat(tab, [], 'fix school');
  assert.equal(pack.review_asks[0].id, 's');
});

test('chat essay turns skip age harvest before the model', () => {
  assert.deepEqual(harvestForEssayTurn("I'm 30, store and fill it"), []);
  assert.deepEqual(harvestForEssayTurn(''), []);
});

test('Canada work auth is No, not US Yes', () => {
  const field = {
    label: 'Are you legally authorized to work in Canada?',
    type: 'checkbox',
    options: ['Yes', 'No'],
  };
  assert.equal(resolveValue(field, { profile }), 'No');
});

test('APAC timezone warning is No, not Seattle', () => {
  const field = {
    label:
      'If you live in the Asian-Pacific region, we will reject your application even if you believe you can work in these timezones.',
    type: 'checkbox',
    options: ['Yes', 'No'],
  };
  assert.equal(resolveValue(field, { profile }), 'No');
});

test('notice period is not current employer', () => {
  const field = {
    label: 'Please specify your required notice period with your current employer',
    type: 'radio',
    options: ['Immediate', '2 weeks', '1 month'],
  };
  const got = resolveValue(field, { profile });
  assert.notEqual(got, 'Freelance');
  assert.ok(!/tash|freelance/i.test(String(got || '')));
});

test('select-all-that-apply is not suite/unit address', () => {
  const field = {
    label: 'Which of the following communities do you belong to? Please select all that apply.',
    type: 'checkbox',
    options: ['Veteran', 'LGBTQIA+'],
  };
  assert.notEqual(resolveValue(field, { profile }), 'Suite 106 #499');
  assert.notEqual(resolveValue(field, { profile }), 'Suite 106');
  assert.notEqual(resolveValue(field, { profile }), 'LinkedIn');
});

test('instruction leftover collapses into the preceding hear-about question', () => {
  const kept = collapseChoiceResiduals([
    {
      id: 'm1',
      label: 'How did you hear about Hive?',
      heading: 'How did you hear about Hive?',
      type: 'checkbox',
      options: ['Friend', 'LinkedIn'],
    },
    {
      id: 'm2',
      label: 'Select one of the following',
      heading: 'How did you hear about Hive?',
      type: 'checkbox',
      options: ['Friend', 'LinkedIn'],
    },
  ]);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].id, 'm1');
});

test('hear-about checkboxes pick LinkedIn', () => {
  const hive = {
    label: 'How did you hear about Hive?',
    type: 'checkbox',
    options: ['Friend', 'Recruiter/current employee', 'LinkedIn', 'Other'],
  };
  const apply = {
    label: 'Please check all that apply:',
    type: 'checkbox',
    options: ['Friend', 'Recruiter/current employee', 'LinkedIn', 'AngelList', 'Other'],
  };
  assert.equal(resolveValue(hive, { profile }), 'LinkedIn');
  assert.equal(resolveValue(apply, { profile }), 'LinkedIn');
});

test('Palo Alto office days is No when not relocating', () => {
  const field = {
    label:
      'This role requires in-office collaboration Monday through Wednesday from 9:30 am to 5:30 pm at our Palo Alto office. Are you able to commit to this schedule?',
    type: 'checkbox',
    options: ['Yes', 'No'],
  };
  assert.equal(resolveValue(field, { profile: { ...profile, work: { ...profile.work, willing_to_relocate: false } } }), 'No');
});

test('office days and relocate are Yes when willing_to_relocate is true', () => {
  const office = {
    label:
      'This role requires in-office collaboration Monday through Wednesday from 9:30 am to 5:30 pm at our Palo Alto office. Are you able to commit to this schedule?',
    type: 'checkbox',
    options: ['Yes', 'No'],
  };
  const relocate = {
    label: 'Are you willing to relocate?',
    type: 'checkbox',
    options: ['Yes', 'No'],
  };
  assert.equal(resolveValue(office, { profile }), 'Yes');
  assert.equal(resolveValue(relocate, { profile }), 'Yes');
});

test('Bay Area located is No', () => {
  const field = {
    label: 'Are you currently located in the Bay Area, California?',
    type: 'checkbox',
    options: ['Yes', 'No'],
  };
  assert.equal(resolveValue(field, { profile }), 'No');
});

const SKILL_PROFILE = `skills:
  javascript:
    years: 8
    aliases: [js]
  react:
    years: 8
    aliases: [react.js, reactjs]
  svelte:
    years: 0
  sveltekit:
    years: 0
    aliases: [svelte kit]
  vue:
    years: 0
    aliases: [vuejs, vue.js, vue js]
  angular:
    years: 1
    aliases: [angularjs, angular.js, angular js]
  production:
    years: 8
    aliases: [production code, writing production, software engineering]
  coding:
    years: 12
    aliases: [coding, programming]
  nextjs:
    years: 2
    aliases: [next.js, next js]
`;

test('React years text question is Yes', () => {
  const field = {
    label: 'Do you have at least 3 years of React experience?',
    type: 'text',
    tag: 'input',
  };
  withTempKnowledge(SKILL_PROFILE, () => {
    assert.equal(resolveValue(field, { profile }), 'Yes');
  });
});

test('years-of-experience fields use the skill table', () => {
  withTempKnowledge(SKILL_PROFILE, () => {
  assert.equal(
    resolveValue(
      { label: 'How many years of experience do you have with JavaScript?', type: 'textarea', tag: 'textarea' },
      { profile }
    ),
    '8'
  );
  assert.equal(
    resolveValue(
      { label: 'How many years of SvelteKit experience do you have?', type: 'text', tag: 'input' },
      { profile }
    ),
    '0'
  );
  assert.equal(
    resolveValue(
      { label: 'How many years writing production code do you have?', type: 'text', tag: 'input' },
      { profile }
    ),
    '8'
  );
  assert.equal(
    resolveValue(
      { label: 'How many years of experience do you have with Next.js?', type: 'text', tag: 'input' },
      { profile }
    ),
    '2'
  );
  assert.equal(
    resolveValue(
      { label: 'How many years of hand-on experience do you have in coding?', type: 'text', tag: 'input' },
      { profile }
    ),
    '12'
  );
  });
});

test('location select uses country when that is the option list', () => {
  const field = {
    label: 'What is your location?',
    type: 'select',
    select: true,
    options: ['Select...', 'United States', 'Canada', 'United Kingdom', 'Germany'],
  };
  assert.equal(resolveValue(field, { profile }), 'United States');
});

test('Workday country and city use mailing facts', () => {
  const full = {
    ...profile,
    identity: {
      country: 'United States',
      city: 'Mesa',
      state: 'Florida',
      zip: '78701',
      mailing_address: { city: 'Mesa', state: 'Florida', zip: '78701', country: 'United States' },
    },
  };
  assert.equal(
    resolveValue(
      {
        label: 'Country',
        type: 'select',
        select: true,
        options: ['Afghanistan', 'American Samoa', 'Canada', 'United States of America'],
      },
      { profile: full }
    ),
    'United States of America'
  );
  assert.equal(
    resolveValue({ label: 'City', type: 'text', autocomplete: 'address-level2', domId: 'cntryFields.city' }, { profile: full }),
    'Mesa'
  );
});

test('current location stays empty until a based city is on file', () => {
  assert.equal(resolveValue({ label: 'Current location', type: 'text' }, { profile }), null);
  assert.equal(
    resolveValue({ label: 'Current location', type: 'text' }, { profile: { identity: { based_city: 'Austin' } } }),
    'Austin'
  );
});

test('Svelte threshold and LOIS yes/no stay honest zeros', () => {
  assert.equal(
    resolveValue(
      { label: 'Do you have at least 3 years of Svelte experience?', type: 'text', tag: 'input' },
      { profile }
    ),
    'No'
  );
  assert.equal(
    resolveValue({ label: "Have you used Filevine's LOIS?", type: 'checkbox', options: ['Yes', 'No'] }, { profile }),
    'No'
  );
});

test('Applicant consent yes/no is Yes', () => {
  const field = {
    label: 'Applicant Consent & Acknowledgment : By submitting your application, you acknowledge that you have reviewed the notice.',
    type: 'checkbox',
    options: ['Yes', 'No'],
  };
  assert.equal(resolveValue(field, { profile }), 'Yes');
});

test('Reddit demographic consent checkbox is Yes', () => {
  assert.equal(
    resolveValue(
      {
        label:
          'By checking this box, I consent to Reddit collecting, storing, and processing my responses to the demographic data surveys above.',
        type: 'checkbox',
      },
      { profile }
    ),
    'Yes'
  );
});

test('if you consent select Affirmative', () => {
  assert.equal(
    resolveValue(
      {
        label: 'If you consent to the processing of your personal data, select Affirmative.',
        type: 'select',
        options: ['Affirmative', 'Decline'],
      },
      { profile }
    ),
    'Affirmative'
  );
});

test('SMS consent stays No', () => {
  assert.equal(
    resolveValue({ label: 'Do you consent to receive SMS updates?', type: 'checkbox', options: ['Yes', 'No'] }, { profile }),
    'No'
  );
});

test('ethnicities plural uses the profile ethnicity', () => {
  const p = { ...profile, eeo: { ethnicity: 'hispanic_latino', race: ['two_or_more', 'white'] } };
  assert.equal(
    resolveValue(
      { label: 'Please select up to 2 ethnicities that you most closely identify with?', type: 'select' },
      { profile: p }
    ),
    'Hispanic or Latino'
  );
});

test('phone country is United States, not a dial digit', () => {
  assert.equal(
    resolveValue({ label: 'Phone country', type: 'combobox', phoneCountry: true, reactSelect: true }, { profile }),
    'United States'
  );
});

test('chat can target a static textarea as an essay', () => {
  const found = {
    essayFields: [{ id: 'cover', label: 'Cover letter', route: 'needs_llm' }],
    debugFields: [
      { id: 'wx', label: 'Work experience', route: 'static', tag: 'textarea', type: 'textarea' },
      { id: 'cover', label: 'Cover letter', route: 'needs_llm' },
    ],
  };
  const hit = pickEssayTargets(found, ['wx']);
  assert.equal(hit.length, 1);
  assert.equal(hit[0].id, 'wx');
});

test('chat reply strips internal card ids', () => {
  const out = scrubCardIds('Used card_peloton_page and card_airbnb_host.');
  assert.doesNotMatch(out, /card_/);
  assert.match(out, /Used/);
  assert.match(out, /and/);
  const headed = scrubCardIds('### card_keep Peloton\ninternal_id: card_keep (do not write this id)');
  assert.doesNotMatch(headed, /card_/);
  assert.doesNotMatch(headed, /internal_id/i);
});

test('stored age maps onto Filevine range bubbles', () => {
  const field = {
    label: 'What is your age range?',
    type: 'radio',
    options: ['17 or younger', '18-20', '21-29', '30-39', '40-49', 'Prefer not to answer'],
  };
  assert.equal(isAgeRangeField(field), true);
  assert.equal(resolveValue(field, { profile: { identity: { age: 30 } } }), '30-39');
  assert.equal(parseAgeFromText("I'm 30, store and fill it"), 30);
});

test('cancelFill aborts the run and leftover review', () => {
  const tab = {};
  attachFillAbort(tab);
  tab.reviewAbort = new AbortController();
  assert.equal(tab.fillAbort.signal.aborted, false);
  assert.equal(cancelFill(tab).ok, true);
  assert.equal(tab.fillCancelRequested, true);
  assert.equal(tab.skipDraftCommit, true);
  assert.equal(tab.fillAbort.signal.aborted, true);
  assert.equal(tab.reviewAbort.signal.aborted, true);
  assert.equal(isFillCancelled({ cancelled: true }), true);
  assert.equal(isFillCancelled(null), false);
  assert.equal(cancelFill(null).ok, false);
});

test('cancelFill before attach still aborts the next controller', () => {
  const tab = {};
  assert.equal(cancelFill(tab).ok, true);
  assert.equal(tab.fillCancelRequested, true);
  attachFillAbort(tab);
  assert.equal(tab.fillAbort.signal.aborted, true);
});

test('attachFillAbort reuses a live controller', () => {
  const tab = {};
  const first = attachFillAbort(tab);
  const second = attachFillAbort(tab);
  assert.equal(first, second);
  assert.equal(first.signal.aborted, false);
});

test('year counts resolve from the skill table, not a coding fallback', () => {
  withTempKnowledge(SKILL_PROFILE, () => {
    assert.equal(
      resolveValue({ label: 'How many years of hand-on experience do you have with VueJs?' }, { profile }),
      '0'
    );
    assert.equal(
      resolveValue({ label: 'How many years of hand-on experience do you have with AngularJs?' }, { profile }),
      '1'
    );
    assert.equal(resolveValue({ label: 'How many years of Solid experience do you have?' }, { profile }), null);
  });
});

test('accepting an unknown stack writes skills.<id>.years', () => {
  const prev = process.env.MAGNET_PROFILE;
  const file = path.join(os.tmpdir(), `magnet-profile-af-${process.pid}.yaml`);
  fs.writeFileSync(file, 'identity:\n  first_name: Alex\n');
  process.env.MAGNET_PROFILE = file;
  facts.invalidate();
  try {
    const applied = persistFieldFact(
      { label: 'How many years of experience do you have with Solid?' },
      '2'
    );
    assert.equal(applied.some((row) => row.path === 'skills.solid.years' && row.value === 2), true);
    assert.equal(facts.load().skills.solid.years, 2);
  } finally {
    if (prev == null) delete process.env.MAGNET_PROFILE;
    else process.env.MAGNET_PROFILE = prev;
    facts.invalidate();
    try {
      fs.unlinkSync(file);
    } catch (_) {}
  }
});

test('mirror save upserts final on the session without a prior field', () => {
  const tab = { essaySession: { fields: [] } };
  const out = applyMirrorSave(tab, { id: 'm1', value: 'hello', label: 'Why us' });
  assert.equal(out.ok, true);
  assert.equal(tab.essaySession.fields[0].final, 'hello');
  assert.equal(tab.essaySession.fields[0].origin, 'applicant');
});

test('leftover review copy is not matching unless essays are drafting', () => {
  assert.equal(reviewEssayDetail({ reviewAbort: {}, essayBusy: false }), LEFTOVER_REVIEW_DETAIL);
  assert.equal(reviewEssayDetail({ reviewAbort: {}, essayBusy: true }), REVIEW_AND_ESSAYS_DETAIL);
  assert.equal(reviewEssayDetail({ reviewAbort: null, essayBusy: true }), MATCHING_DETAIL);
  assert.equal(reviewEssayDetail({ reviewAbort: null, essayBusy: true }, 'Revising…'), 'Revising…');
  assert.equal(reviewEssayDetail({ reviewAbort: null, essayBusy: false }, 'Thinking…'), 'Thinking…');
  assert.equal(reviewEssayDetail({ reviewAbort: {}, essayBusy: false }, MATCHING_DETAIL), LEFTOVER_REVIEW_DETAIL);
  assert.doesNotMatch(reviewEssayDetail({ reviewAbort: {}, essayBusy: false }), /matching experience/i);
});

test('react-select leftovers propose click / type / clickOption steps', () => {
  const steps = fillStepsFor({
    label: 'How did you hear about us?',
    reactSelect: true,
    shape: { family: 'react_select' },
  });
  assert.deepEqual(
    steps.map((s) => s.op),
    ['click', 'type', 'clickOption']
  );
  assert.equal(steps[0].selector, '.select__control');
});

test('click-only react-select recipes still replay typeahead', () => {
  const steps = fillStepsFor({
    label: 'Gender',
    reactSelect: true,
    shape: {
      family: 'react_select',
      open: 'click-typeahead',
      bits: ['listbox-on-open', 'typeahead', 'clickOption'],
      path: 'div.select__control.remix-css-13cymwt-control>div.select__value-container>input[role=combobox]',
    },
  });
  assert.ok(steps.some((s) => s.op === 'type'));
  assert.ok(steps.some((s) => s.op === 'clickOption'));
});

test('a notice poke is part of the replay recipe', () => {
  const steps = fillStepsFor({
    label: 'Start date',
    type: 'text',
    shape: { family: 'text' },
    fill: { strategy: 'date_mask' },
  });
  assert.deepEqual(steps, [{ op: 'poke', strategy: 'date_mask' }]);
});

test('first name does not share date_mask with start date', () => {
  const nameChain = fillChain({ label: 'First name', type: 'text', shape: { family: 'text' } }, 'nope');
  assert.notEqual(nameChain[0], 'date_mask');
  assert.equal(nameChain.includes('date_mask'), false);
  assert.equal(fillChain({ label: 'Email', type: 'email', shape: { family: 'text' } }, 'nope').includes('date_mask'), false);
  assert.equal(fillChain({ label: 'Start date', type: 'text', shape: { family: 'text' } }, 'nope')[0], 'date_mask');
  assert.equal(
    fillChain({ label: 'City', type: 'text', shape: { family: 'text' } }, 'nope', { value: '2021-06' })[0],
    'date_mask'
  );
});

test('same question text collapses even when one copy is not a choice', () => {
  const label =
    'By checking this box, I consent to Reddit collecting, storing, and processing my responses to the demographic data surveys above.';
  const rows = collapseChoiceResiduals([
    { id: 'a', type: 'checkbox', clusterId: 'check:lab:1', label, residual: 'red' },
    { id: 'b', type: 'text', clusterId: 'id:m2', label, residual: 'red' },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'a');
});

test('choice leftovers collapse to one card per cluster', () => {
  const rows = collapseChoiceResiduals([
    { id: 'a', type: 'radio', clusterId: 'n:hear', heading: 'How did you hear about Hive?', label: 'LinkedIn', residual: 'red' },
    { id: 'b', type: 'radio', clusterId: 'n:hear', heading: 'How did you hear about Hive?', label: 'Friend', residual: 'red' },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'a');
});

test('unclustered radio siblings collapse on the shared heading', () => {
  const rows = collapseChoiceResiduals(
    [
      {
        id: 'a',
        type: 'radio',
        clusterId: 'id:m1',
        heading: 'How did you hear about Hive?',
        label: 'LinkedIn',
        residual: 'red',
        current: '',
      },
      {
        id: 'b',
        type: 'radio',
        clusterId: 'id:m2',
        heading: 'How did you hear about Hive?',
        label: 'Friend',
        residual: 'red',
        current: '',
      },
    ]
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'a');
});

test('unchecked EEO consent stays a leftover next to a filled gender field', () => {
  const consent = {
    id: 'c',
    type: 'checkbox',
    heading: 'Reddit U.S. Equal Employment Information',
    label:
      'By checking this box, I consent to Reddit collecting, storing, and processing my responses to the demographic data surveys above.',
    intended: 'Yes',
    current:
      'By checking this box, I consent to Reddit collecting, storing, and processing my responses to the demographic data surveys above.',
    magnetState: 'green',
    checked: false,
    residual: 'intended_neq_current',
    route: 'static',
  };
  const gender = {
    id: 'g',
    type: 'combobox',
    heading: 'Reddit U.S. Equal Employment Information',
    label: 'What gender identity do you most closely identify with?',
    intended: 'Non-binary',
    current: 'Non-binary',
    magnetState: 'green',
    route: 'static',
  };
  const rows = collapseChoiceResiduals([consent], [consent, gender]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'c');
});

test('known-not-empty sibling drops the rest of the radio cluster', () => {
  const rows = collapseChoiceResiduals(
    [
      {
        id: 'a',
        type: 'radio',
        clusterId: 'n:hear',
        heading: 'How did you hear about Hive?',
        label: 'LinkedIn',
        residual: 'red',
        current: '',
      },
    ],
    [
      {
        id: 'a',
        type: 'radio',
        clusterId: 'n:hear',
        heading: 'How did you hear about Hive?',
        label: 'LinkedIn',
        residual: 'red',
        current: '',
      },
      {
        id: 'b',
        type: 'radio',
        clusterId: 'n:hear',
        heading: 'How did you hear about Hive?',
        label: 'Friend',
        intended: 'LinkedIn',
        current: 'LinkedIn',
        magnetState: 'green',
        checked: true,
      },
    ]
  );
  assert.equal(rows.length, 0);
});

function withTempKnowledge(profileBody, fn) {
  const prevProfile = process.env.MAGNET_PROFILE;
  const prevAlias = process.env.MAGNET_ALIASES;
  const prevRecipes = process.env.MAGNET_RECIPES;
  const profileFile = path.join(os.tmpdir(), `magnet-profile-${process.pid}-${Date.now()}.yaml`);
  const aliasFile = path.join(os.tmpdir(), `magnet-aliases-${process.pid}-${Date.now()}.yaml`);
  const recipeFile = path.join(os.tmpdir(), `magnet-recipes-${process.pid}-${Date.now()}.yaml`);
  fs.writeFileSync(profileFile, profileBody);
  fs.writeFileSync(aliasFile, 'version: 1\naliases: []\n');
  fs.writeFileSync(recipeFile, 'version: 2\nrecipes: []\n');
  process.env.MAGNET_PROFILE = profileFile;
  process.env.MAGNET_ALIASES = aliasFile;
  process.env.MAGNET_RECIPES = recipeFile;
  facts.invalidate();
  require('./confirmations').invalidate();
  require('./question-catalog').invalidate();
  const restore = () => {
    if (prevProfile == null) delete process.env.MAGNET_PROFILE;
    else process.env.MAGNET_PROFILE = prevProfile;
    if (prevAlias == null) delete process.env.MAGNET_ALIASES;
    else process.env.MAGNET_ALIASES = prevAlias;
    if (prevRecipes == null) delete process.env.MAGNET_RECIPES;
    else process.env.MAGNET_RECIPES = prevRecipes;
    facts.invalidate();
    require('./confirmations').invalidate();
    require('./question-catalog').invalidate();
    try {
      fs.unlinkSync(profileFile);
    } catch (_) {}
    try {
      fs.unlinkSync(aliasFile);
    } catch (_) {}
    try {
      fs.unlinkSync(recipeFile);
    } catch (_) {}
  };
  try {
    const out = fn({ profileFile, aliasFile, recipeFile });
    if (out && typeof out.then === 'function') return Promise.resolve(out).finally(restore);
    restore();
    return out;
  } catch (err) {
    restore();
    throw err;
  }
}

test('saved orientation fills the other wording on the next resolve', () => {
  withTempKnowledge('identity:\n  first_name: Alex\n', () => {
    const a = { label: 'What sexual orientation do you most closely identify with?', options: ['Straight', 'Gay', 'Queer'] };
    const b = { label: 'How would you describe your sexual orientation?', options: ['Straight', 'Gay', 'Queer'] };
    rememberAnswer(a, 'queer', { source: 'accept' });
    assert.equal(resolveValue(b, { profile: facts.load() }), 'Queer');
  });
});

test('other confirmation is used on first-pass Autofill', () => {
  withTempKnowledge('identity:\n  first_name: Alex\n', () => {
    const field = { label: 'What is your favorite Pokemon?', type: 'text' };
    require('./confirmations').confirmClass('other:what is your favorite pokemon', 'Bulbasaur', { source: 'harvest' });
    assert.equal(resolveValue(field, { profile: facts.load() }), 'Bulbasaur');
  });
});

test('Apply? follows the stored cue and never asks hasVisibleApplyFields', async () => {
  const calls = [];
  const evalFn = async (script) => {
    const s = String(script);
    calls.push(s);
    if (s.includes('magnetInventory') || s.includes('data-magnet-field') || /fields/.test(s) && s.includes('querySelectorAll')) {
      return { fields: [{ label: 'Search jobs', type: 'search' }, { label: 'Email', type: 'email' }], href: 'https://jobs.example.com/1' };
    }
    if (s.includes('Apply now')) return { ok: true, text: 'Apply now' };
    if (s.includes('pickJdApply')) return { ok: true, text: 'Apply' };
    return { ok: false };
  };
  const form = await openApplySurface(
    { getURL: () => 'https://jobs.example.com/1' },
    { jd: { apply_surface: 'form' } },
    { evalFn, skipEmptyWait: true }
  );
  assert.equal((form.fields || []).length, 2);
  assert.equal(calls.some((s) => s.includes('pickJdApply') || s.includes('Apply now')), false);

  calls.length = 0;
  const clicked = await openApplySurface(
    { getURL: () => 'https://jobs.example.com/1' },
    { jd: { apply_surface: 'needs_click', apply_cta: { text: 'Apply now', href: '/apply' } } },
    { evalFn, skipEmptyWait: true, waitAfterApply: async () => ({ fields: [{ label: 'First name' }], href: 'https://jobs.example.com/1/apply' }) }
  );
  assert.equal(clicked.href, 'https://jobs.example.com/1/apply');
  assert.equal(calls.some((s) => s.includes('Apply now')), true);
  assert.equal(calls.some((s) => s.includes('hasVisibleApplyFields')), false);

  calls.length = 0;
  await openApplySurface({ getURL: () => 'https://jobs.example.com/1' }, { jd: {} }, { evalFn, skipEmptyWait: true });
  assert.equal(calls.some((s) => s.includes('pickJdApply')), true);
});

test('unlabeled leftover Save remaps to eeo:orientation and writes an alias', () => {
  withTempKnowledge('identity:\n  first_name: Alex\n', ({ aliasFile }) => {
    rememberAnswer({ label: 'SOGI' }, 'queer', { source: 'accept', classId: 'eeo:orientation' });
    assert.equal(facts.load().eeo.orientation, 'queer');
    const raw = fs.readFileSync(aliasFile, 'utf8');
    assert.match(raw, /SOGI/);
    assert.equal(require('./question-catalog').classify({ label: 'SOGI question' }).class, 'eeo:orientation');
  });
});

test('autofill does not re-arm page auto-scroll', () => {
  const src = fs.readFileSync(path.join(__dirname, 'autofill.js'), 'utf8');
  assert.match(src, /autoScrollArmScript\(false\)/);
  assert.doesNotMatch(src, /autoScrollArmScript\(true\)/);
});

test('US or Canada yes-no is Yes, not Suite 106', () => {
  withTempKnowledge('identity:\n  city: Mesa\n  based_city: Seattle\n', () => {
    const p = {
      identity: {
        city: 'Mesa',
        based_city: 'Seattle',
        mailing_address: { line2: 'Suite 106', country: 'United States', state: 'Florida' },
      },
    };
    assert.equal(
      resolveValue(
        {
          label: 'Are you based in the United States or Canada?',
          type: 'checkbox',
          options: ['true', 'false'],
        },
        { profile: p }
      ),
      'Yes'
    );
    assert.equal(
      resolveValue(
        {
          label: 'Where are you based relative to our hubs?',
          type: 'checkbox',
          options: ['true', 'false'],
        },
        { profile: p }
      ),
      null
    );
  });
});

test('closed hub checkboxes stay leftovers, not optional-empty skips', () => {
  withTempKnowledge('identity:\n  based_city: Seattle\n', () => {
    const hubs = {
      label: 'Where are you based relative to our hubs?',
      type: 'checkbox',
      options: ['Atlanta, GA', 'Boston, MA', 'London, UK'],
    };
    const p = { identity: { based_city: 'Seattle' } };
    assert.equal(resolveValue(hubs, { profile: p }), null);
    assert.equal(leftoverClosedChoice(hubs, '', null), true);
    assert.equal(leftoverClosedChoice({ label: 'Twitter', type: 'text' }, '', null), false);
    const seattleHubs = { ...hubs, options: ['Seattle, WA', 'Atlanta, GA', 'Boston, MA'] };
    assert.match(String(resolveValue(seattleHubs, { profile: p })), /Seattle/i);
  });
});

test('confirmed hubs fill Autofill without leftover review', () => {
  withTempKnowledge('identity:\n  based_city: Seattle\n', () => {
    const { confirmClass } = require('./confirmations');
    confirmClass('location:hubs', 'Atlanta, GA', {
      source: 'review',
      label: 'Where are you based relative to our hubs?',
    });
    assert.equal(
      resolveValue(
        {
          label: 'Where are you based relative to our hubs?',
          type: 'checkbox',
          options: ['Atlanta, GA', 'Boston, MA', 'London, UK'],
        },
        { profile: facts.load() }
      ),
      'Atlanta, GA'
    );
  });
});

test('inferred leftover recipes persist immediately', () => {
  withTempKnowledge('identity:\n  based_city: Seattle\n', ({ recipeFile }) => {
    const field = {
      id: 'hubs',
      label: 'Where are you based relative to our hubs?',
      type: 'checkbox',
      options: ['Atlanta, GA', 'Boston, MA'],
      residual: 'needs-infer',
      reason: 'needs-infer',
    };
    applyReviewLearning(
      {
        fills: [{ id: 'hubs', value: 'Atlanta, GA', class_id: 'location:hubs' }],
      },
      [field]
    );
    persistReviewRecipes(
      {
        fills: [{ id: 'hubs', value: 'Atlanta, GA' }],
        recipes: [
          {
            field_id: 'hubs',
            label: field.label,
            value: 'Atlanta, GA',
            steps: [{ op: 'clickOption' }],
          },
        ],
      },
      [field]
    );
    const { getConfirmation } = require('./confirmations');
    assert.equal(getConfirmation('location:hubs').value, 'Atlanta, GA');
    const raw = fs.readFileSync(recipeFile, 'utf8');
    assert.match(raw, /where are you based relative to our hubs/);
    const stamped = stampInferredFills([{ id: 'hubs', value: 'Atlanta, GA' }], [field]);
    assert.equal(stamped[0].gate, 'inferred');
  });
});

test('Phone field is the number, not United States', () => {
  const p = { identity: { phone: '5550100199', country: 'United States' } };
  const tel = resolveValue({ label: 'Phone', type: 'tel' }, { profile: p });
  assert.match(String(tel), /555/);
  assert.doesNotMatch(String(tel), /united states/i);
  const labeled = resolveValue({ label: 'Phone', type: 'text', phoneCountry: true }, { profile: p });
  assert.match(String(labeled), /555/);
  assert.doesNotMatch(String(labeled), /united states/i);
});

test('refer you is No and the name follow-up is N/A', () => {
  assert.equal(
    resolveValue({ label: 'Did an employee refer you to apply? *', type: 'select', options: ['Yes', 'No'] }, { profile }),
    'No'
  );
  assert.equal(
    resolveValue({ label: 'If yes, referrer name', type: 'text' }, { profile }),
    'N/A'
  );
  assert.equal(
    resolveValue(
      {
        label:
          'If you were referred by a Phantom employee, please provide their name and your relationship to them.',
        type: 'text',
      },
      { profile }
    ),
    'N/A'
  );
});

test('Hispanic is not applied to a not-Hispanic race widget', () => {
  const p = { eeo: { ethnicity: 'hispanic_latino', race: ['two_or_more', 'white'] } };
  assert.notEqual(
    resolveValue(
      { label: 'Two or more races (Not Hispanic or Latino)', type: 'checkbox' },
      { profile: p }
    ),
    'Hispanic or Latino'
  );
  assert.match(
    String(
      resolveValue(
        { label: 'Race (Not Hispanic or Latino)', type: 'select', options: ['White (not Hispanic or Latino)', 'Two or more races (Not Hispanic or Latino)'] },
        { profile: p }
      ) || ''
    ),
    /two or more|white/i
  );
});

test('permanent residency uses mailing state', () => {
  const p = { identity: { state: 'Florida', mailing_address: { state: 'Florida' } } };
  assert.equal(
    resolveValue({ label: 'In which state do you hold permanent residency?*', type: 'text' }, { profile: p }),
    'Florida'
  );
});

test('covenants and brand partners default to No', () => {
  withTempKnowledge('identity:\n  first_name: Alex\n', () => {
    assert.equal(resolveValue({ label: 'Restrictive covenants? *', type: 'select', options: ['Yes', 'No'] }, { profile }), 'No');
    assert.equal(
      resolveValue({ label: 'Employed by brand partners? *', type: 'select', options: ['Yes', 'No'] }, { profile }),
      'No'
    );
    const family = resolveValue(
      {
        label: 'Family / SO employed by Flock?',
        type: 'select',
        options: ['No relationship to current employees', 'Immediate family member'],
      },
      { profile }
    );
    assert.match(String(family), /no/i);
    assert.doesNotMatch(String(family), /immediate/i);
  });
});

test('Harvest of a different phone or salary does not overwrite the profile', () => {
  withTempKnowledge(
    'identity:\n  phone: "+1 555-010-0199"\n  phone_national: "5550100199"\nwork:\n  compensation:\n    target_usd: 150000\n    history_usd: 140000\n',
    () => {
      persistFieldFact({ label: 'Phone' }, '1-206-605-4884');
      persistFieldFact({ label: 'Base salary' }, '185000');
      const doc = facts.load();
      assert.equal(doc.identity.phone, '+1 555-010-0199');
      assert.equal(doc.work.compensation.target_usd, 150000);
      assert.equal(doc.work.compensation.history_usd, 140000);
    }
  );
});

test('Accept remaps Phone onto identity:phone and does not alias country', () => {
  withTempKnowledge('identity:\n  first_name: Alex\n  country: United States\n', ({ aliasFile }) => {
    rememberAnswer({ label: 'Phone' }, '5550100199', { source: 'accept', classId: 'identity:phone' });
    assert.equal(facts.load().identity.phone, '5550100199');
    const raw = fs.readFileSync(aliasFile, 'utf8');
    assert.match(raw, /Phone/);
    assert.doesNotMatch(raw, /identity:country/);
    rememberAnswer({ label: 'Phone country guess' }, '5550100199', { source: 'accept' });
    const later = fs.readFileSync(aliasFile, 'utf8');
    assert.doesNotMatch(later, /Phone country guess/);
  });
});

test('Leave blank persists a skip recipe', () => {
  withTempKnowledge('identity:\n  first_name: Alex\n', ({ recipeFile }) => {
    rememberAnswer({ label: 'Twitter' }, '', { source: 'accept', skip: true });
    const raw = fs.readFileSync(recipeFile, 'utf8');
    assert.match(raw, /twitter/i);
    assert.match(raw, /skip/);
    const { findRecipe } = require('./field-recipes');
    const hit = findRecipe({ label: 'Twitter' });
    assert.equal(hit && hit.route, 'skip');
  });
});

test('hydrateSelectOptions writes page options onto an empty react-select leftover', async () => {
  const field = {
    id: 'm-orient',
    label: 'What sexual orientation do you most closely identify with? *',
    type: 'combobox',
    reactSelect: true,
    options: [],
  };
  const page = ['Heterosexual or Straight', 'Gay or Lesbian', 'Bisexual', 'Queer', 'I do not wish to answer'];
  const wc = {
    executeJavaScript: async (script) => {
      assert.match(script, /m-orient/);
      assert.match(script, /pairedNativeSelect/);
      assert.match(script, /visibleMenuOptions/);
      assert.match(script, /aria-expanded/);
      return { ok: true, optionsById: { 'm-orient': page } };
    },
    mainFrame: { frames: [] },
  };
  await hydrateSelectOptions(wc, [field]);
  assert.deepEqual(field.options, page);
});

test('hydrateSelectOptions does not reopen a filled react-select', async () => {
  const field = {
    id: 'm-gender',
    label: 'What gender identity do you most closely identify with?',
    type: 'combobox',
    reactSelect: true,
    options: [],
    value: 'Non-binary',
  };
  const wc = {
    executeJavaScript: async () => {
      throw new Error('should not harvest a committed select');
    },
    mainFrame: { frames: [] },
  };
  await hydrateSelectOptions(wc, [field]);
  assert.deepEqual(field.options, []);
});

test('hydrateSelectOptions drops a leaked phone-country list on a leftover', async () => {
  const field = {
    id: 'm-gender',
    label: 'What gender identity do you most closely identify with?',
    type: 'combobox',
    reactSelect: true,
    options: [],
  };
  const wc = {
    executeJavaScript: async () => ({
      ok: true,
      optionsById: {
        'm-gender': [
          'Afghanistan+93',
          'Ascension Island+247',
          'Canada+1',
          'Cayman Islands+1',
          'United Kingdom+44',
          'United States+1',
        ],
      },
    }),
    mainFrame: { frames: [] },
  };
  await hydrateSelectOptions(wc, [field]);
  assert.deepEqual(field.options, []);
});

test('seedResidualReview turns Fill leftovers into review cards', () => {
  const tab = {
    debugFields: [
      {
        id: 'title',
        label: 'Job Title*',
        route: 'static',
        intended: 'Software Engineer',
        current: 'I currently work here',
        residual: 'intended_neq_current',
        magnetState: 'green',
      },
    ],
    review: { kind: 'review', fills: [], asks: [], runs: [], recipes: [], reply: '' },
  };
  const n = seedResidualReview(tab, [
    {
      id: 'title',
      label: 'Job Title*',
      route: 'static',
      intended: 'Software Engineer',
      current: 'I currently work here',
      residual: 'red',
    },
    {
      id: 'co',
      label: 'Company*',
      route: 'static',
      intended: '',
      current: '',
      residual: 'red',
    },
    {
      id: 'role',
      label: 'Role Description',
      route: 'static',
      intended: '',
      current: '',
      residual: 'red',
    },
  ]);
  assert.ok(n >= 2);
  assert.equal((tab.review.fills || []).some((f) => f.id === 'title' && f.value === 'Software Engineer'), true);
  assert.equal(
    (tab.review.asks || []).some((a) => a.id === 'co' || a.id === 'role') ||
      (tab.review.fills || []).some((f) => f.id === 'co' || f.id === 'role'),
    true
  );
});

test('radio leftovers replay clickOption, not labeled-radio-0', () => {
  withTempKnowledge('identity:\n  first_name: Alex\n', () => {
    const steps = fillStepsFor({
      id: 'fam',
      label: 'Family / SO employed by Flock?',
      type: 'radio',
      options: ['Immediate family member', 'No relationship to current employees', 'Spouse / partner'],
      shape: { family: 'choice_group' },
    });
    assert.deepEqual(steps, [{ op: 'clickOption' }]);
  });
});

test('Wrong value on a missed family option stays a review card and keeps No', async () => {
  const stratFile = path.join(__dirname, '..', 'knowledge', 'strategy-cache.yaml');
  const prevStrat = fs.existsSync(stratFile) ? fs.readFileSync(stratFile) : null;
  try {
    await withTempKnowledge('identity:\n  first_name: Alex\n', async () => {
      const { getConfirmation } = require('./confirmations');
      const field = {
        id: 'fam',
        label: 'Family / SO employed by Flock?',
        type: 'radio',
        options: ['Immediate family member', 'No relationship to current employees', 'Spouse / partner'],
        intended: 'No',
        current: 'Immediate family member',
        shape: { family: 'choice_group' },
      };
      const tab = { debugFields: [field], review: { kind: 'review', fills: [], asks: [], runs: [], recipes: [] } };
      const out = await retryField({ executeJavaScript: async () => ({ ok: true }) }, tab, 'fam', 'wrong_value');
      assert.equal(out.open_review, true);
      assert.notEqual(getConfirmation('conflict:employer') && getConfirmation('conflict:employer').confidence, 'contradicted');
      openFlagReview(tab, out);
      const row = (tab.review.fills || []).find((f) => f.id === 'fam');
      assert.equal(row.gate, 'wrong-intended');
      assert.equal(row.value, 'No');
      assert.equal(row.previous, 'Immediate family member');
      assert.ok((row.options || []).some((o) => /no relationship/i.test(String((o && (o.text || o.label || o)) || o))));
    });
  } finally {
    if (prevStrat == null) {
      try {
        fs.unlinkSync(stratFile);
      } catch (_) {}
    } else {
      fs.writeFileSync(stratFile, prevStrat);
    }
  }
});

test('preferred first name stays Alex when first name is blank', () => {
  assert.equal(
    resolveValue(
      { label: 'Preferred First Name', type: 'text', domId: 'preferred_name' },
      { profile: { identity: { preferred_name: 'Alex', first_name: '' } } }
    ),
    'Alex'
  );
});

test('7+ software engineering years follows employment, not the calendar span', () => {
  assert.equal(
    resolveValue(
      {
        label: 'Do you have 7+ years of software engineering experience?',
        type: 'select',
        options: ['Yes', 'No'],
      },
      { profile }
    ),
    'No'
  );
});

test('React Native production experience is not the React skill', () => {
  assert.equal(
    resolveValue(
      {
        label: 'Do you have production experience with React Native?',
        type: 'radio',
        options: ['Yes', 'No'],
      },
      { profile }
    ),
    'No'
  );
});

test('anticipated work location is Seattle, not the mailing city', () => {
  assert.equal(
    resolveValue(
      {
        label: 'Anticipated work location',
        type: 'text',
        autocomplete: 'address-level2',
        placeholder: 'Start typing...',
      },
      {
        profile: {
          identity: {
            city: 'Mesa',
            based_city: 'Seattle',
            based_state_code: 'WA',
            mailing_address: { city: 'Mesa', state: 'Florida' },
          },
        },
      }
    ),
    'Seattle, WA'
  );
});

test('an open apply form is not toggled shut', async () => {
  const calls = [];
  const evalFn = async (script) => {
    calls.push(String(script));
    return { fields: [{ label: 'First name', type: 'text' }], href: 'https://jobs.workable.com/x' };
  };
  const inv = await openApplySurface(
    { getURL: () => 'https://jobs.workable.com/x' },
    { jd: { apply_surface: 'needs_click', apply_cta: { text: 'Apply now', href: '/apply' } } },
    { evalFn, skipEmptyWait: true }
  );
  assert.equal(inv.fields[0].label, 'First name');
  assert.equal(calls.some((s) => s.includes('Apply now') || s.includes('pickJdApply')), false);
});

test('autofill reports a required essay that was not drafted', () => {
  const prev = process.env.CURSOR_API_KEY;
  delete process.env.CURSOR_API_KEY;
  try {
    const missing = essayAutofillStatus({
      essayFields: [{ label: 'Why us? *', required: true }],
      drafted: { ok: true, essays: 0, reply: '' },
    });
    assert.equal(missing.ok, false);
    assert.equal(missing.error, 'missing CURSOR_API_KEY');
    assert.match(missing.reply, /CURSOR_API_KEY/);
    const letter = essayAutofillStatus({
      essayFields: [{ label: 'Cover letter *', tag: 'textarea', required: true }],
      drafted: { ok: true, essays: 1, reply: 'Typed the cover letter.' },
    });
    assert.equal(letter.ok, true);
    assert.equal(letter.error, '');
    process.env.CURSOR_API_KEY = 'present';
    const empty = essayAutofillStatus({
      essayFields: [{ label: 'Why us? *', required: true }],
      drafted: { ok: true, essays: 0, reply: '' },
    });
    assert.equal(empty.ok, false);
    assert.equal(empty.error, 'required essay still empty');
    const wrote = essayAutofillStatus({
      essayFields: [{ label: 'Why us? *', required: true }],
      drafted: { ok: true, essays: 1, reply: 'Drafted 1 field.' },
    });
    assert.equal(wrote.ok, true);
    assert.equal(wrote.essays, 1);
  } finally {
    if (prev == null) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = prev;
  }
});

test('deterministic text boxes use paced typing', () => {
  const wc = { sendInputEvent() {} };
  assert.equal(isPaceTextField({ tag: 'input', type: 'email', label: 'Email' }), true);
  assert.equal(isPaceTextField({ tag: 'textarea', type: 'textarea', label: 'Cover letter' }), true);
  assert.equal(isPaceTextField({ tag: 'input', type: 'tel', label: 'Phone' }), true);
  assert.equal(isPaceTextField({ tag: 'select', type: 'select-one', label: 'Country' }), false);
  assert.equal(isPaceTextField({ tag: 'input', type: 'radio', label: 'Yes' }), false);
  assert.equal(isPaceTextField({ tag: 'input', type: 'checkbox', label: 'Agree' }), false);
  assert.equal(isPaceTextField({ tag: 'input', type: 'text', label: 'City', shape: { family: 'combobox' } }), false);
  assert.equal(wantsPaceType({ tag: 'input', type: 'text', label: 'Start date' }, '03/2019', wc, {}), false);
  assert.equal(wantsPaceType({ tag: 'input', type: 'email', label: 'Email' }, 'a@b.co', wc, {}), true);
  assert.equal(
    wantsPaceType({ tag: 'textarea', type: 'textarea', label: 'Why us' }, 'hello', wc, { instant: true }),
    false
  );
  assert.equal(wantsPaceType({ tag: 'input', type: 'text', label: 'City' }, 'Seattle', {}, {}), false);
});

test('greenhouse resume waits for uploadFile', () => {
  assert.match(GREENHOUSE_UPLOADER_SCRIPT, /uploaders\.resume/);
  assert.match(GREENHOUSE_UPLOADER_SCRIPT, /uploadFile/);
  assert.match(GREENHOUSE_RESUME_CHANGE_SCRIPT, /uploadFile/);
  assert.match(GREENHOUSE_RESUME_CHANGE_SCRIPT, /ok: false/);
});
