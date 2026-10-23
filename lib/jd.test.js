const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  isJdApplyLabel,
  isJdApplyHref,
  isChromeField,
  hasVisibleApplyFields,
  pickJdApply,
  isJdBackLabel,
  pickJdBack,
  isJdOverviewLabel,
  pickJdOverview,
  looksLikeJobDescription,
  isThinJd,
  isAbbreviatedJd,
  isSummarizedJd,
  isJdExpandLabel,
  shouldReplaceJd,
  needsPageScan,
  heuristicJudge,
  parseJdJudge,
  buildJdJudgePrompt,
  ensurePostingJd,
  applyFollowPlan,
  applySurfaceOf,
  attachApplyCue,
  fillApplyCue,
  clickNamedApplyScript,
  hrefIsOtherPage,
  CLICK_APPLY_SCRIPT,
  JdHaltError,
} = require('./jd');

test('JD apply labels match common ATS CTAs', () => {
  assert.equal(isJdApplyLabel('Apply'), true);
  assert.equal(isJdApplyLabel('Apply now'), true);
  assert.equal(isJdApplyLabel('Apply now!'), true);
  assert.equal(isJdApplyLabel('Apply for this job'), true);
  assert.equal(isJdApplyLabel('Apply for this position'), true);
  assert.equal(isJdApplyLabel('Apply for Software Engineer'), true);
  assert.equal(isJdApplyLabel('Apply to Acme'), true);
  assert.equal(isJdApplyLabel('Start application'), true);
  assert.equal(isJdApplyLabel('Start your application'), true);
  assert.equal(isJdApplyLabel("I'm interested"), true);
  assert.equal(isJdApplyLabel('Apply with LinkedIn'), true);
});

test('JD apply labels reject submit and chrome', () => {
  assert.equal(isJdApplyLabel('Submit application'), false);
  assert.equal(isJdApplyLabel('Submit'), false);
  assert.equal(isJdApplyLabel('Next'), false);
  assert.equal(isJdApplyLabel('Apply filters'), false);
  assert.equal(isJdApplyLabel('How to apply'), false);
  assert.equal(isJdApplyLabel('Already applied'), false);
  assert.equal(isJdApplyLabel('Easy Apply'), false);
  assert.equal(isJdApplyLabel('Easy Apply', { linkedin: true }), true);
});

test('apply hrefs include hash application and /apply paths', () => {
  assert.equal(isJdApplyHref('#application'), true);
  assert.equal(isJdApplyHref('https://jobs.lever.co/acme/abc/apply'), true);
  assert.equal(isJdApplyHref('https://boards.greenhouse.io/acme/jobs/1'), false);
});

test('visible apply fields ignore search chrome and a lone email', () => {
  assert.equal(hasVisibleApplyFields([]), false);
  assert.equal(hasVisibleApplyFields([{ label: 'Search jobs', type: 'search' }]), false);
  assert.equal(hasVisibleApplyFields([{ label: 'Email', type: 'email' }]), false);
  assert.equal(hasVisibleApplyFields([{ label: 'First Name', type: 'text' }]), true);
  assert.equal(
    hasVisibleApplyFields([
      { label: 'Email', type: 'email' },
      { label: 'Phone', type: 'tel' },
    ]),
    true
  );
});

test('cookie banner and site-feedback chrome is not an apply form', () => {
  assert.equal(isChromeField({ label: 'Performance Cookies', type: 'checkbox' }), true);
  assert.equal(isChromeField({ label: 'How would you rate your experience?', type: 'radio' }), true);
  assert.equal(isChromeField({ label: 'checkbox label', type: 'checkbox' }), true);
  assert.equal(isChromeField({ label: 'How would you rate your experience with React?', type: 'radio' }), false);
  assert.equal(isChromeField({ label: 'honeypot', type: 'text' }), true);
  assert.equal(isChromeField({ label: 'Who You Might Be:', type: 'text' }), true);
  assert.equal(isChromeField({ label: '', type: 'combobox', options: [] }), true);
  assert.equal(
    hasVisibleApplyFields([
      { label: 'Email', type: 'email' },
      { label: 'How would you rate your experience?', type: 'radio' },
      { label: 'Performance Cookies', type: 'checkbox' },
      { label: 'Functional Cookies', type: 'checkbox' },
      { label: 'Targeting Cookies', type: 'checkbox' },
      { label: 'checkbox label', type: 'checkbox' },
      { label: 'checkbox label', type: 'checkbox' },
    ]),
    false
  );
});

test('job-alert chrome is not an apply form', () => {
  assert.equal(
    hasVisibleApplyFields([
      { label: 'Search job title or team', type: 'combobox' },
      { label: 'Email Address', type: 'email', placeholder: 'Your email address' },
      { label: "you'll get emails, select frequency", type: 'combobox' },
    ]),
    false
  );
  assert.equal(
    hasVisibleApplyFields([
      { label: 'Email', type: 'email' },
      { label: "you'll get emails, select frequency", type: 'combobox' },
    ]),
    false
  );
  assert.equal(
    hasVisibleApplyFields([
      { label: 'Email', type: 'email' },
      { label: 'First Name', type: 'text' },
    ]),
    true
  );
});

test('pickJdApply only fires when the page has no apply form', () => {
  const candidates = [
    { text: 'Apply for this job', href: '/jobs/1/apply', inView: true },
    { text: 'Submit application', href: '', inView: true },
  ];
  const hit = pickJdApply(candidates);
  assert.equal(hit.ok, true);
  assert.equal(hit.text, 'Apply for this job');
  assert.equal(pickJdApply(candidates, { hasApplyFields: true }).skipped, 'has-fields');
});

test('pickJdApply prefers in-view posting CTA over footer Apply', () => {
  const hit = pickJdApply([
    { text: 'Apply', href: '/careers', inChrome: true, inView: false, index: 0 },
    { text: 'Apply now', href: '#application', inView: true, index: 1 },
  ]);
  assert.equal(hit.ok, true);
  assert.equal(hit.index, 1);
  assert.equal(hit.text, 'Apply now');
});

test('pickJdApply skips dialogs and can use an icon-only apply href', () => {
  assert.equal(pickJdApply([{ text: 'Apply', inDialog: true }]).ok, false);
  const icon = pickJdApply([{ text: '', href: '#application', inView: true, index: 0 }]);
  assert.equal(icon.ok, true);
  assert.equal(icon.text, 'Apply');
});

const FORM_TEXT = `Software Engineer (Frontend)
SUBMIT YOUR APPLICATION
ATTACH RESUME/CV
ADDITIONAL INFORMATION
If there's anything more you'd like to tell us
Current location`;

const JD_TEXT = `Staff Frontend Engineer
About the role
You will own the apply surface and ship weekly.
What we're looking for
Responsibilities include pairing on React forms and reviewing leftovers.
Requirements
5+ years building product UI.`;

const HUNT_STUB =
  'Principal Front-End Web Developer, Sunnyvale CA (Remote). Seeking a web front-end engineer with significant JS/HTML/CSS to maintain and enhance the FortiSwitch GUI.\n\nRequirements\n: 5+ years front-end, TypeScript, SCSS, HTML/CSS/JS ES6, AJAX/Promises, familiar with Vue or React.';

const FULL_POSTING = `${JD_TEXT}

Job Responsibilities
Locate, fix, and verify bugs in the product GUI.
Propose new features and write i18n-compliant HTML, JS, and CSS.
Interface with the rest of the team on C and Python integration.

Requirements
At least 5 years of experience in front-end web development.
Familiarity with TypeScript, SCSS, Vue or React, AJAX, and Promises.
Bachelor's or Master's degree in Computer Science or a related area.

The US base salary range for this full-time position is $148,000-$180,000.
Must be authorized to work in the U.S. without sponsorship.
Fortinet offers medical, dental, vision, 401(k), paid holidays, vacation, and a leave program.
Wage ranges depend on the labour market, job type, job level, and the candidate's experience.`;

test('looksLikeJobDescription rejects blanks, forms, and short chrome', () => {
  assert.equal(looksLikeJobDescription(''), false);
  assert.equal(looksLikeJobDescription('Apply now'), false);
  assert.equal(looksLikeJobDescription(FORM_TEXT), false);
  assert.equal(looksLikeJobDescription(JD_TEXT), true);
  assert.equal(needsPageScan(''), true);
  assert.equal(needsPageScan(FORM_TEXT), true);
  assert.equal(needsPageScan(JD_TEXT), false);
  assert.equal(heuristicJudge('').has_jd, false);
  assert.equal(heuristicJudge(FORM_TEXT).has_jd, false);
  assert.equal(heuristicJudge(JD_TEXT).has_jd, true);
});

test('isThinJd flags hunt teasers but keeps ingest postings', () => {
  assert.equal(isThinJd({ text: HUNT_STUB, source: 'hunt' }), true);
  assert.equal(isThinJd({ text: JD_TEXT, source: 'ingest' }), false);
  assert.equal(isThinJd({ text: FULL_POSTING, source: 'hunt' }), false);
  assert.equal(shouldReplaceJd({ text: HUNT_STUB, source: 'hunt' }, FULL_POSTING), true);
  assert.equal(shouldReplaceJd({ text: FULL_POSTING, source: 'host' }, HUNT_STUB), false);
});

test('abbreviated and summarized JDs are rejected; See more is an expand control', () => {
  assert.equal(isAbbreviatedJd(HUNT_STUB), true);
  assert.equal(isSummarizedJd(HUNT_STUB), true);
  assert.equal(isSummarizedJd('Seeking a frontend engineer. Requirements: React, TypeScript. Remote.'), true);
  assert.equal(isSummarizedJd(FULL_POSTING), false);
  assert.equal(isJdExpandLabel('See more'), true);
  assert.equal(isJdExpandLabel('Show more'), true);
  assert.equal(isJdExpandLabel('See more jobs like this'), false);
});

test('back labels match ATS return-to-posting CTAs', () => {
  assert.equal(isJdBackLabel('Back'), true);
  assert.equal(isJdBackLabel('Go back'), true);
  assert.equal(isJdBackLabel('←'), true);
  assert.equal(isJdBackLabel('Back to job'), true);
  assert.equal(isJdBackLabel('Back to this role'), true);
  assert.equal(isJdBackLabel('View job posting'), true);
  assert.equal(isJdBackLabel('Return to posting'), true);
  assert.equal(isJdBackLabel('Next'), false);
  assert.equal(isJdBackLabel('Continue'), false);
  assert.equal(isJdBackLabel('Apply'), false);
  assert.equal(isJdBackLabel('Submit'), false);
});

test('pickJdBack prefers an in-view Back to job over chrome Back', () => {
  const hit = pickJdBack([
    { text: 'Back', inChrome: true, inView: false, index: 0 },
    { text: 'Back to job', inView: true, index: 1 },
  ]);
  assert.equal(hit.ok, true);
  assert.equal(hit.index, 1);
  assert.equal(pickJdBack([{ text: 'Next' }]).ok, false);
});

test('parseJdJudge reads boolean and string has_jd', () => {
  assert.equal(parseJdJudge('{"has_jd":true,"reason":"posting"}').has_jd, true);
  assert.equal(parseJdJudge('Sure\n{"has_jd":false}').has_jd, false);
  assert.equal(parseJdJudge('{"has_jd":"true"}').has_jd, true);
  assert.equal(parseJdJudge('nope'), null);
});

test('parseJdJudge reads apply_surface and apply_cta', () => {
  const hit = parseJdJudge(
    '{"has_jd":true,"apply_surface":"needs_click","apply_cta":{"text":"Apply now","href":"/apply"},"reason":"listing"}'
  );
  assert.equal(hit.has_jd, true);
  assert.equal(hit.apply_surface, 'needs_click');
  assert.equal(hit.apply_cta.text, 'Apply now');
  assert.equal(hit.apply_cta.href, '/apply');
  const form = parseJdJudge('{"has_jd":false,"apply_surface":"form","reason":"application"}');
  assert.equal(form.apply_surface, 'form');
  assert.equal(form.apply_cta, undefined);
});

test('jd-judge prompt says chrome is not a form', () => {
  const prompt = buildJdJudgePrompt('About the role', {
    href: 'https://jobs.example.com/1',
    title: 'Eng',
    ctas: [{ text: 'Apply now', href: '/apply' }, { text: 'Accept cookies', href: '' }],
  });
  assert.match(prompt, /cookie\/newsletter\/job-alert widget is not a form/);
  assert.match(prompt, /apply_surface/);
  assert.match(prompt, /Apply now/);
  assert.match(prompt, /Accept cookies/);
});

test('applyFollowPlan is fill or click from the cue only', () => {
  assert.deepEqual(applyFollowPlan({ apply_surface: 'form' }), { action: 'fill' });
  assert.deepEqual(applyFollowPlan({ apply_surface: 'needs_click', apply_cta: { text: 'Apply now', href: '/apply' } }), {
    action: 'click',
    cta: { text: 'Apply now', href: '/apply' },
  });
  assert.deepEqual(applyFollowPlan({}), { action: 'click' });
  assert.equal(applySurfaceOf({ apply_surface: 'needs-click' }), 'needs_click');
});

test('CLICK_APPLY_SCRIPT no longer gates on field counts', () => {
  assert.equal(CLICK_APPLY_SCRIPT.includes('hasVisibleApplyFields'), false);
  assert.match(CLICK_APPLY_SCRIPT, /pickJdApply\(candidates, \{ linkedin \}\)/);
  assert.doesNotMatch(CLICK_APPLY_SCRIPT, /hasApplyFields \}/);
  assert.match(clickNamedApplyScript({ text: 'Apply now', href: '/go' }), /Apply now/);
  assert.equal(hrefIsOtherPage('https://jobs.example.com/1', 'https://jobs.example.com/1/apply'), true);
  assert.equal(hrefIsOtherPage('https://jobs.example.com/1', '#application'), false);
});

test('fillApplyCue keeps an existing cue and attaches a judge cue', async () => {
  const kept = await fillApplyCue(
    { text: JD_TEXT, apply_surface: 'form' },
    { judge: async () => ({ has_jd: true, apply_surface: 'needs_click' }) }
  );
  assert.equal(kept.apply_surface, 'form');
  const next = attachApplyCue({ text: JD_TEXT }, { apply_surface: 'needs_click', apply_cta: { text: 'Apply' } });
  assert.equal(next.apply_surface, 'needs_click');
  assert.equal(next.apply_cta.text, 'Apply');
});

function scriptKind(script) {
  const s = String(script);
  if (s.includes('magnetClickBack')) return 'back';
  if (s.includes('magnetClickOverview')) return 'overview';
  if (s.includes('magnetPageScan')) return 'scan';
  if (s.includes('magnetPageFp')) return 'fp';
  if (s.includes('pickJdApply')) return 'apply';
  if (s.includes('application/ld+json')) return 'jsonld';
  if (s.includes('jobDescriptionText')) return 'extract';
  if (s.includes('posting-page')) return 'host';
  return 'other';
}

function mockApplyThenPosting(opts = {}) {
  let page = opts.start || 'apply';
  const pages = {
    apply: {
      href: 'https://jobs.ashbyhq.com/acme/job/1/application',
      title: 'Apply',
      text: opts.applyText != null ? opts.applyText : FORM_TEXT,
      fp: 'apply|1',
    },
    posting: {
      href: 'https://jobs.ashbyhq.com/acme/job/1',
      title: 'Staff Frontend Engineer',
      text: opts.postingText != null ? opts.postingText : JD_TEXT,
      fp: 'posting|2',
    },
  };
  const evalFn = async (script) => {
    const kind = scriptKind(script);
    const cur = pages[page];
    if (kind === 'jsonld') return { ok: false };
    if (kind === 'host' || kind === 'extract' || kind === 'scan') {
      const text = cur.text;
      return {
        ok: text.length > 80,
        text,
        digest: text,
        length: text.length,
        href: cur.href,
        title: cur.title,
        source: 'scan',
      };
    }
    if (kind === 'fp') return { ok: true, href: cur.href, title: cur.title, fp: cur.fp };
    if (kind === 'overview') {
      if (!opts.overview) return { ok: false };
      pages.apply.text = opts.postingText != null ? opts.postingText : JD_TEXT;
      return { ok: true, text: 'Overview' };
    }
    if (kind === 'back') {
      if (opts.noBack) return { ok: false };
      if (opts.stuckBack) return { ok: true, text: 'Back' };
      if (page !== 'apply') return { ok: false };
      page = 'posting';
      return { ok: true, text: 'Back to job' };
    }
    if (kind === 'apply') {
      if (page !== 'posting') return { ok: false, skipped: 'has-fields' };
      page = 'apply';
      return { ok: true, text: 'Apply' };
    }
    return { ok: false };
  };
  return {
    evalFn,
    page: () => page,
    waitForChange: async () => {
      if (opts.stuckBack) return { ok: false };
      return { ok: page === 'posting', href: pages[page].href, fp: pages[page].fp };
    },
    waitAfterApply: async () => {},
    judge: async (text) => heuristicJudge(text),
  };
}

test('ensurePostingJd stamps apply cue from the judge', async () => {
  const tab = { jd: { text: JD_TEXT, source: 'ingest' } };
  await ensurePostingJd(tab, {
    evalFn: async () => ({ ok: false }),
    judge: async () => ({
      has_jd: true,
      apply_surface: 'needs_click',
      apply_cta: { text: 'Apply now', href: '/apply' },
    }),
  });
  assert.equal(tab.jd.apply_surface, 'needs_click');
  assert.equal(tab.jd.apply_cta.text, 'Apply now');
});

test('ensurePostingJd skips when the tab already has a posting', async () => {
  const tab = { jd: { text: JD_TEXT, source: 'ingest' }, jdVerified: false };
  const out = await ensurePostingJd(tab, { evalFn: async () => ({ ok: false }) });
  assert.equal(out.text, JD_TEXT);
  assert.equal(tab.jdVerified, true);
});

test('ensurePostingJd recaptures a thin hunt stub from the posting homepage', async () => {
  const tab = { jd: { text: HUNT_STUB, source: 'hunt' }, jdVerified: true };
  const mock = mockApplyThenPosting({ start: 'posting', postingText: FULL_POSTING });
  const out = await ensurePostingJd(tab, mock);
  assert.match(out.text, /Job Responsibilities/);
  assert.ok(out.text.length > HUNT_STUB.length);
  assert.equal(tab.jdVerified, true);
});

test('ensurePostingJd keeps a thin hunt stub when the page has no posting', async () => {
  const tab = { jd: { text: HUNT_STUB, source: 'hunt' }, jdVerified: true };
  const mock = mockApplyThenPosting({ noBack: true, start: 'apply' });
  const out = await ensurePostingJd(tab, mock);
  assert.equal(out.text, HUNT_STUB);
  assert.equal(tab.jdVerified, false);
});

test('ensurePostingJd page-scans a blank capture and keeps a found posting', async () => {
  const tab = { jd: null };
  const mock = mockApplyThenPosting({ start: 'posting' });
  const out = await ensurePostingJd(tab, mock);
  assert.equal(looksLikeJobDescription(out.text), true);
  assert.equal(tab.jdVerified, true);
  assert.equal(mock.page(), 'posting');
});

test('ensurePostingJd asks the judge after a page scan when selectors miss', async () => {
  let scanned = false;
  let judged = '';
  const tab = { jd: null };
  const out = await ensurePostingJd(tab, {
    evalFn: async (script) => {
      const kind = scriptKind(script);
      if (kind === 'scan') {
        scanned = true;
        return { ok: true, text: JD_TEXT, digest: JD_TEXT, length: JD_TEXT.length, source: 'scan' };
      }
      if (kind === 'fp') return { ok: true, href: 'https://x.test/job', fp: 'a', title: 'Role' };
      return { ok: false };
    },
    judge: async (text) => {
      judged = text;
      return heuristicJudge(text);
    },
    waitForChange: async () => ({ ok: false }),
  });
  assert.equal(scanned, true);
  assert.equal(looksLikeJobDescription(out.text), true);
  assert.match(judged, /About the role/);
});

test('ensurePostingJd goes back for the posting then returns to apply', async () => {
  const tab = { jd: { text: FORM_TEXT, source: 'extract' } };
  const mock = mockApplyThenPosting();
  const out = await ensurePostingJd(tab, mock);
  assert.equal(looksLikeJobDescription(out.text), true);
  assert.equal(tab.jdVerified, true);
  assert.equal(mock.page(), 'apply');
});

test('ensurePostingJd halts immediately when no Back button exists', async () => {
  const tab = { jd: null };
  const mock = mockApplyThenPosting({ noBack: true });
  await assert.rejects(() => ensurePostingJd(tab, mock), (err) => {
    assert.equal(err instanceof JdHaltError, true);
    assert.match(err.message, /no Back button/i);
    assert.equal(err.notified, true);
    return true;
  });
});

test('ensurePostingJd halts when Back still has no job description', async () => {
  const tab = { jd: null };
  const mock = mockApplyThenPosting({ postingText: FORM_TEXT });
  await assert.rejects(() => ensurePostingJd(tab, mock), (err) => {
    assert.equal(err.halt, true);
    assert.match(err.message, /still no job description/i);
    return true;
  });
});

test('ensurePostingJd clicks Overview before Back', async () => {
  const tab = { jd: null };
  const mock = mockApplyThenPosting({ overview: true });
  let backed = false;
  const orig = mock.evalFn;
  mock.evalFn = async (script) => {
    const kind = scriptKind(script);
    if (kind === 'back') backed = true;
    return orig(script);
  };
  const out = await ensurePostingJd(tab, mock);
  assert.equal(looksLikeJobDescription(out.text), true);
  assert.equal(backed, false);
  assert.equal(mock.page(), 'apply');
});

test('overview labels match ATS description tabs', () => {
  assert.equal(isJdOverviewLabel('Overview'), true);
  assert.equal(isJdOverviewLabel('Description'), true);
  assert.equal(isJdOverviewLabel('About the job'), true);
  assert.equal(isJdOverviewLabel('Job details'), true);
  assert.equal(isJdOverviewLabel('Apply'), false);
  const hit = pickJdOverview([
    { text: 'Overview', role: 'tab', inView: true, index: 0 },
    { text: 'Apply', inView: true, index: 1 },
  ]);
  assert.equal(hit.ok, true);
  assert.equal(hit.text, 'Overview');
});

test('ensurePostingJd halts when Back does not change the page', async () => {
  const tab = { jd: null };
  const mock = mockApplyThenPosting({ stuckBack: true });
  await assert.rejects(() => ensurePostingJd(tab, mock), (err) => {
    assert.equal(err.halt, true);
    assert.match(err.message, /didn.t leave this page/i);
    return true;
  });
});
