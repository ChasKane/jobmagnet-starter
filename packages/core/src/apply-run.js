const { classifyField } = require('../../../lib/classify');
const { reviewGate, filterAskable } = require('../../../lib/review-gate');
const { pickClosestOption } = require('../../../lib/option-match');
const { valueFromProfile } = require('./static-values');
const { hasAutofillRun, jobLooksFilled } = require('./autofill-queue');

const VERIFY_FILE_SCRIPT = `(() => {
  const inputs = [...document.querySelectorAll('input[type="file"]')];
  const withFiles = inputs.filter((el) => el.files && el.files.length);
  const file = withFiles[0] && withFiles[0].files[0];
  const text = (document.body.innerText || '').slice(0, 4000);
  const stillUpload = /upload (resume|cv)|attach (resume|cv)|choose file|no file chosen/i.test(text) && !file;
  return {
    ok: Boolean(file) && !stillUpload,
    name: file ? file.name : '',
    size: file ? file.size : 0,
    count: withFiles.reduce((n, el) => n + el.files.length, 0),
    stillUpload: Boolean(stillUpload),
  };
})()`;

const CLICK_UPLOAD_SCRIPT = `(() => {
  const re = /upload (resume|cv|file)|attach (resume|cv)/i;
  const el = [...document.querySelectorAll('button, a, [role="button"], label, input[type="file"]')].find((n) =>
    re.test((n.innerText || n.getAttribute('aria-label') || n.name || ''))
  );
  if (!el) {
    const file = document.querySelector('input[type="file"]');
    if (file) { file.click(); return { ok: true, clicked: 'file' }; }
    return { ok: false };
  }
  el.click();
  return { ok: true };
})()`;

const CLICK_APPLY_SCRIPT = `(() => {
  const re = /\\b(apply now|apply for this job|apply)\\b/i;
  const el = [...document.querySelectorAll('a, button, [role="button"]')].find((n) => {
    const t = (n.innerText || n.getAttribute('aria-label') || '').trim();
    return re.test(t) && t.length < 40;
  });
  if (!el) return { ok: false };
  el.click();
  return { ok: true, text: (el.innerText || '').trim() };
})()`;

function attachBytesScript(selector, filename, mime, base64) {
  const sel = JSON.stringify(String(selector || ''));
  const name = JSON.stringify(String(filename || 'resume.pdf'));
  const type = JSON.stringify(String(mime || 'application/pdf'));
  const b64 = JSON.stringify(String(base64 || ''));
  return `(() => {
    const el = document.querySelector(${sel}) || document.querySelector('input[type="file"]');
    if (!el) return { ok: false, error: 'missing' };
    const b64 = ${b64};
    if (!b64) return { ok: false, error: 'no-bytes' };
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const file = new File([bytes], ${name}, { type: ${type} });
    const dt = new DataTransfer();
    dt.items.add(file);
    try { el.files = dt.files; } catch (err) { return { ok: false, error: String(err && err.message || err) }; }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: Boolean(el.files && el.files.length), name: el.files[0] && el.files[0].name, size: el.files[0] && el.files[0].size };
  })()`;
}

function emitStep(onStep, id, extra) {
  if (typeof onStep !== 'function') return;
  try {
    onStep(id, extra || {});
  } catch (_) {}
}

function intendedValue(field, profile) {
  const fromProfile = valueFromProfile(field, profile);
  if (fromProfile != null) {
    const opts = field.options || [];
    if (opts.length) {
      const pick = pickClosestOption(opts, fromProfile, undefined, field.label);
      if (pick && pick.option) return pick.option.value != null ? pick.option.value : pick.option.label || pick.option;
    }
    return fromProfile;
  }
  return null;
}

function scripts() {
  try {
    return require('../../browser-scripts');
  } catch (_) {
    return {};
  }
}

function fillScript(pack, id, value) {
  if (pack && typeof pack.fillAndVerifyScript === 'function') return pack.fillAndVerifyScript(id, value);
  const fid = JSON.stringify(String(id || ''));
  const val = JSON.stringify(String(value ?? ''));
  return `(() => {
    const id = ${fid};
    const value = ${val};
    const el = document.querySelector('[data-magnet-field="'+id+'"]')
      || document.getElementById(id)
      || document.querySelector('[name="'+id+'"]');
    if (!el) return { ok: false, error: 'missing' };
    el.focus();
    if (el.tagName === 'SELECT') {
      const opt = [...el.options].find((o) => o.value === value || o.text === value);
      if (opt) el.value = opt.value;
    } else if (el.type === 'checkbox' || el.type === 'radio') {
      el.checked = /^(yes|true|on|1)$/i.test(value);
    } else {
      el.value = value;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, value: el.value };
  })()`;
}

function readFieldScript(id) {
  const fid = JSON.stringify(String(id || ''));
  return `(() => {
    const id = ${fid};
    const el = document.querySelector('[data-magnet-field="'+id+'"]')
      || document.getElementById(id)
      || document.querySelector('[name="'+id+'"]');
    if (!el) return '';
    return el.value || el.innerText || '';
  })()`;
}

function retrievePack(store, job, fields, instruction) {
  let retrieveCardIds = [];
  let retrieved = '';
  try {
    const { retrieveForDraft } = require('../../../lib/retrieve');
    const got = retrieveForDraft({
      fields,
      company: job && job.company,
      title: job && job.title,
      instruction: instruction || '',
    });
    retrieveCardIds = (got.cards || []).map((c) => c.id).filter(Boolean);
    retrieved = got.block || '';
  } catch (_) {}
  if (store && typeof store.pickTurnBodies === 'function') {
    try {
      const { inferShape } = require('../../../lib/cascade');
      const bodies = store.pickTurnBodies({
        fields,
        company: job && job.company,
        title: job && job.title,
        instruction,
        inferShape,
        retrieveCardIds,
      });
      if (bodies && bodies.length) {
        retrieveCardIds = [...new Set(retrieveCardIds.concat(bodies.map((b) => b.id).filter(Boolean)))];
      }
    } catch (_) {}
  }
  if (store && typeof store.searchAnswers === 'function' && !retrieved) {
    try {
      const hits = store.searchAnswers({
        similar_to: (fields[0] && fields[0].label) || '',
        company: job && job.company,
        limit: 2,
      });
      if (hits && hits.length) {
        retrieved = hits
          .map((d) => `${d.company || ''} · ${d.label || ''}\n${String(d.text || '').slice(0, 700)}`)
          .join('\n\n');
      }
    } catch (_) {}
  }
  return { retrieveCardIds, retrieved };
}

async function harvestPortable({ browser, job, fields }) {
  const essays = [];
  if (!browser) return { essays };
  let inv = Array.isArray(fields) ? fields.slice() : [];
  if (!inv.length && typeof browser.inventory === 'function') {
    try {
      const out = await browser.inventory();
      inv = (out && out.fields) || out || [];
    } catch (_) {
      inv = [];
    }
  }
  for (const field of inv) {
    if (!field || !field.id) continue;
    const classified = classifyField(field, { url: job && job.url, host: job && job.hostname });
    let value = field.value || '';
    if (typeof browser.eval === 'function') {
      try {
        const raw = await browser.eval(readFieldScript(field.id));
        if (typeof raw === 'string' && raw.trim()) value = raw;
      } catch (_) {}
    }
    const text = String(value || '').trim();
    if (classified.route !== 'needs_llm' || text.length < 40) continue;
    let origin = 'applicant';
    try {
      const { rankAnswer } = require('../../../lib/answer-rank');
      origin = rankAnswer({
        llm_draft: field.llm_draft || '',
        final: text,
        unchanged: String(field.llm_draft || '') === text,
      }).origin || origin;
    } catch (_) {}
    const row = {
      id: field.id,
      label: field.label || '',
      text,
      final: text,
      llm_draft: field.llm_draft || '',
      origin,
      company: (job && job.company) || '',
      url: (job && job.url) || '',
      ts: new Date().toISOString(),
    };
    essays.push(row);
    try {
      const { recordEssay } = require('../../../lib/essay-log');
      recordEssay(row);
    } catch (_) {}
  }
  try {
    const { harvestSweepScript } = require('../../../lib/static-fill');
    if (typeof browser.eval === 'function' && harvestSweepScript) await browser.eval(harvestSweepScript());
  } catch (_) {}
  return { essays };
}

async function runPortableAutofill({ job, rec, browser, files, llm, store, stage, chain, onStep, signal }) {
  const cancelled = () => signal && signal.cancelled;
  const notify = (id, extra) => emitStep(onStep, id, extra);
  const profile = store && typeof store.getProfile === 'function' ? store.getProfile() : {};
  const pack = scripts();
  const filled = [];
  const leftovers = [];
  const steps = [];

  if (typeof store.listRecipes === 'function') {
    try {
      const { setRecipeSource } = require('../../../lib/field-recipes');
      setRecipeSource(store.listRecipes());
    } catch (_) {}
  }
  try {
    const { setProfileDoc } = require('../../../lib/confirmations');
    if (typeof setProfileDoc === 'function') setProfileDoc(profile);
  } catch (_) {}

  if (!stage || stage === 'all' || stage === 'jd') {
    notify('JD', { detail: 'Find job description' });
    if (browser && typeof browser.eval === 'function') {
      try {
        const { EXTRACT_JD_SCRIPT, scanJobDescription } = require('../../../lib/jd-scan');
        await browser.eval(CLICK_APPLY_SCRIPT);
        const raw = await browser.eval(EXTRACT_JD_SCRIPT || pack.INVENTORY_SCRIPT);
        const text = raw && (raw.text || raw.jd || '');
        if (text && store && job && typeof store.writeProcess === 'function') {
          const scan = typeof scanJobDescription === 'function' ? scanJobDescription(text) : { text };
          store.writeProcess(job.url, { jd: { text: scan.text || text, alerts: scan.alerts || [] } });
        }
      } catch (_) {}
    }
  }

  if (cancelled()) return { ok: true, cancelled: true, filled, leftovers };

  if ((!stage || stage === 'resume' || stage === 'all') && files && typeof files.attach === 'function') {
    notify('Apply?', { detail: 'Attach resume' });
    steps.push('resume');
  }

  if (!browser) return { ok: false, error: 'No apply page', steps, filled, leftovers };

  let fields = [];
  if (typeof browser.inventory === 'function') {
    const inv = await browser.inventory();
    fields = (inv && inv.fields) || inv || [];
  } else if (typeof browser.eval === 'function' && pack.INVENTORY_SCRIPT) {
    const inv = await browser.eval(pack.INVENTORY_SCRIPT);
    fields = (inv && inv.fields) || [];
  }

  if (chain && rec && (hasAutofillRun(rec) || jobLooksFilled(rec, fields))) {
    notify('Done', { detail: 'Skipped' });
    return { ok: true, skipped: 'non-empty', filled: [], leftovers: [] };
  }

  if (pack.paintScript && typeof browser.eval === 'function' && fields.length) {
    try {
      await browser.eval(pack.paintScript(fields));
    } catch (_) {}
  }

  if (!stage || stage === 'fill' || stage === 'all') {
    notify('Fill', { detail: 'Fill form fields' });
    steps.push('fill');
    for (const field of fields) {
      if (cancelled()) return { ok: true, cancelled: true, filled, leftovers };
      const classified = classifyField(field, { url: job && job.url, host: job && job.hostname, profile });
      field.route = classified.route;
      if (classified.route === 'needs_llm' || classified.route === 'employment') {
        leftovers.push({ ...field, reason: classified.route });
        continue;
      }
      if (classified.route === 'skip') continue;
      const value = intendedValue(field, profile);
      if (value == null) {
        leftovers.push({ ...field, reason: 'unknown' });
        continue;
      }
      const gate = reviewGate({ ...field, intended: value, route: classified.route });
      if (gate.ask) {
        leftovers.push({ ...field, reason: gate.reason, intended: value });
        continue;
      }
      if (typeof browser.eval === 'function') {
        await browser.eval(fillScript(pack, field.id, value));
      } else if (typeof browser.fill === 'function') {
        await browser.fill(field.id, value);
      }
      filled.push({ id: field.id, value });
    }
  }

  if (!stage || stage === 'all' || stage === 'fill') {
    notify('Review', { detail: 'Review leftovers' });
  }

  let drafts = [];
  if (!stage || stage === 'essays' || stage === 'all') {
    const { isCannedOpenLetter, isReplaceableEssay, coverLetterText } = require('../../../lib/open-letter');
    const essays = fields.filter((f) => classifyField(f, { url: job && job.url, profile }).route === 'needs_llm');
    const canned = essays.filter((f) => isCannedOpenLetter(f));
    const generate = essays.filter((f) => !isCannedOpenLetter(f));
    if (canned.length) {
      notify('Essays', { detail: 'Typing…' });
      steps.push('essays');
      for (const field of canned) {
        if (cancelled()) return { ok: true, cancelled: true, filled, leftovers, drafts };
        const current = field.value || field.current || '';
        if (!isReplaceableEssay(current)) continue;
        const text = coverLetterText(field.maxlength || field.maxLength);
        drafts.push({ id: field.id, text });
        field.llm_draft = text;
        try {
          const { recordEssay } = require('../../../lib/essay-log');
          recordEssay({
            id: field.id,
            label: field.label,
            llm_draft: text,
            final: text,
            company: job && job.company,
            url: job && job.url,
          });
        } catch (_) {}
        if (typeof browser.eval === 'function') {
          await browser.eval(fillScript(pack, field.id, text));
        } else if (typeof browser.fill === 'function') {
          await browser.fill(field.id, text);
        }
      }
    }
    if (generate.length && llm && typeof llm.prompt === 'function') {
      notify('Essays', { detail: 'Match experience and draft' });
      if (!steps.includes('essays')) steps.push('essays');
      const {
        buildClassifyPrompt,
        buildWhyRolePrompt,
        bucketsFromModel,
        guessBuckets,
      } = require('../../../lib/essay-buckets');
      const { formatCardForDraft } = require('../../../lib/products');
      let bucketMap = guessBuckets(generate);
      try {
        const classified = await llm.prompt({
          mode: 'classify',
          prompt: buildClassifyPrompt(generate),
          job,
          fields: generate.map((field) => ({ id: field.id, label: field.label })),
          text: buildClassifyPrompt(generate),
        });
        bucketMap = bucketsFromModel(classified, generate);
      } catch {
        bucketMap = guessBuckets(generate);
      }
      const why = generate.filter((field) => bucketMap.get(field.id) === 'why-role');
      const standard = generate.filter((field) => bucketMap.get(field.id) !== 'why-role');
      const generated = [];
      const voice = store && typeof store.getVoice === 'function' ? store.getVoice() : '';
      const system = store && typeof store.getSystemPrompt === 'function' ? store.getSystemPrompt() : '';
      if (why.length) {
        const packRetrieve = retrievePack(store, job, why, 'Why this role.');
        const bodies =
          store && typeof store.pickTurnBodies === 'function'
            ? store.pickTurnBodies({ fields: why, retrieveCardIds: packRetrieve.retrieveCardIds, job }) || []
            : [];
        const out = await llm.prompt({
          mode: 'why-role',
          prompt: buildWhyRolePrompt({
            system,
            voice,
            company: job && job.company,
            title: job && job.title,
            jd: (rec && rec.jd && rec.jd.text) || '',
            fields: why,
            cards: bodies.map((card) => formatCardForDraft(card)).join('\n\n') || '(no cards)',
          }),
          system,
          voice,
          job,
          fields: why,
          text: 'Why-role pipe.',
          retrieveCardIds: packRetrieve.retrieveCardIds,
          retrieved: packRetrieve.retrieved,
          store,
        });
        generated.push(...((out && out.drafts) || []));
      }
      if (standard.length) {
        const packRetrieve = retrievePack(
          store,
          job,
          standard,
          'Draft leftover essay fields from the bound cards and retrieved priors.'
        );
        const out = await llm.prompt({
          mode: 'draft',
          system,
          voice,
          job,
          fields: standard,
          text: 'Draft the leftover essay fields. Return JSON {"reply":"","drafts":[{"id":"field-id","text":"..."}]}',
          retrieveCardIds: packRetrieve.retrieveCardIds,
          retrieved: packRetrieve.retrieved,
          pickBodies: store && typeof store.pickTurnBodies === 'function' ? (p) => store.pickTurnBodies(p) : undefined,
          store,
        });
        generated.push(...((out && out.drafts) || []));
      }
      drafts = drafts.concat(generated);
      for (const draft of generated) {
        const hit = leftovers.find((f) => f.id === draft.id) || generate.find((f) => f.id === draft.id);
        if (hit) {
          hit.llm_draft = draft.text;
          try {
            const { recordEssay } = require('../../../lib/essay-log');
            recordEssay({
              id: draft.id,
              label: hit.label,
              llm_draft: draft.text,
              final: draft.text,
              company: job && job.company,
              url: job && job.url,
            });
          } catch (_) {}
        }
        if (typeof browser.eval === 'function') {
          await browser.eval(fillScript(pack, draft.id, draft.text));
        }
      }
    }
  }

  notify('Done', { detail: '' });
  return {
    ok: true,
    stage: stage || 'all',
    filled,
    leftovers,
    drafts,
    review: filterAskable(leftovers),
  };
}

module.exports = {
  runPortableAutofill,
  harvestPortable,
  retrievePack,
  VERIFY_FILE_SCRIPT,
  CLICK_UPLOAD_SCRIPT,
  CLICK_APPLY_SCRIPT,
  attachBytesScript,
  fillScript,
  readFieldScript,
};
