const { normalizeSchema } = require('./search-schema');
const { huntStartUrls } = require('./hunt-start');
const { loginWall, loginPrompt } = require('./login-wall');
const { snapshotScript, clickScript, typeScript, scrollScript, slimSnap, pageJdReady, expandItemRef, ALREADY_LISTED } = require('./hunt-page');
const { listingAlreadyHeld } = require('./company-hold');
const { boardFromUrl } = require('./boards');

function parseHuntAction(text) {
  const raw = String(text || '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(raw.slice(start, end + 1));
    if (!obj || typeof obj !== 'object' || !obj.action) return null;
    return obj;
  } catch {
    return null;
  }
}

function decorateSnap(snap) {
  const src = snap && typeof snap === 'object' ? snap : {};
  const wall = loginWall(src);
  return { ...src, login: wall };
}

function companyRule(_plan, status) {
  const list = Array.isArray(status && status.heldCompanies) ? status.heldCompanies : [];
  const shown = list.slice(0, 80);
  const held = shown.length
    ? `Held companies: ${shown.join(', ')}${list.length > shown.length ? ', …' : ''}.`
    : 'Held companies: none yet.';
  return `- One listing per company. Skip companies already stored. A result marked skip=already-listed stays closed. If the page says the posting is already stored, go back and do not read it. If add_listing returns companyHeld, leave that company and keep hunting; it does not count toward the goal.\n${held}`;
}

function huntInstructions({ plan, starts, status }) {
  const s = normalizeSchema(plan);
  return `You drive a logged-in job hunt in the applicant's own browser. Cookies and passwords stay on their machine — never ask for a password or a cookie.

Goal: collect ${s.n} NEW listings that match this plan and are not already stored.
Plan JSON: ${JSON.stringify(s)}
Start URLs (open, search, paginate, open JDs):
${(starts || []).map((row) => `- ${row.site}: ${row.url}`).join('\n')}
Progress: ${Number((status && status.added) || 0)} / ${s.n}

Rules:
- Prefer real apply URLs (Greenhouse, Ashby, Lever, Workable, Recruitee, SmartRecruiters) or LinkedIn /jobs/view/ pages.
- Open the posting homepage (not a search card). Click See more / Show more / Read more until the full description is on screen.
- Never write, paraphrase, or summarize a job description. Magnet captures the full page text. add_listing is url/title/company/posting only — leave jd empty.
- If add_listing returns needJd, the page still has a teaser. Expand it or open the homepage, then add again. Do not paste a summary.
- Read enough of the on-page JD to confirm the plan (title, remote, pay, keywords). Skip mismatches.
- Call add_listing for matches. If it comes back dupe, skip that posting — Magnet already has the URL.
${companyRule(s, status)}
- If snapshot.login is true, the app is asking them to sign in. After they do, snapshot again. If skipped=true, leave that site and open the next start URL.
- Stop only when added >= n or every start site is exhausted.`;
}

function huntJsonUser(snap, status, plan) {
  const s = normalizeSchema(plan);
  const slim = slimSnap(snap || {}, {
    added: Number((status && status.added) || 0),
    need: s.n,
    jobs: (status && status.jobs) || [],
  });
  return `Current page snapshot:
${JSON.stringify(slim)}

Reply with ONE JSON object, no markdown:
{"action":"open","url":"https://..."}
{"action":"click","ref":"e12"}
{"action":"type","ref":"e3","text":"frontend","submit":true}
{"action":"scroll","dir":"down"}
{"action":"wait","ms":1200}
{"action":"add","url":"https://...","title":"...","company":"...","posting":"..."}
{"action":"done","reason":"..."}
Never include a jd field. If the last add returned needJd, click See more or open the posting homepage first.`;
}

function sleep(ms) {
  const n = process.env.NODE_TEST_CONTEXT ? Math.min(Number(ms) || 0, 5) : ms;
  return new Promise((r) => setTimeout(r, Math.max(0, Number(n) || 0)));
}

async function applyBrowserAction(browser, act) {
  const action = String((act && act.action) || '').toLowerCase();
  if (action === 'open') {
    await browser.open(act.url);
    await sleep(700);
    return decorateSnap(await browser.snapshot());
  }
  if (action === 'click') {
    await browser.click(act.ref);
    await sleep(500);
    return decorateSnap(await browser.snapshot());
  }
  if (action === 'type') {
    await browser.type(act.ref, act.text, Boolean(act.submit));
    await sleep(400);
    return decorateSnap(await browser.snapshot());
  }
  if (action === 'scroll') {
    await browser.scroll(act.dir || 'down');
    await sleep(250);
    return decorateSnap(await browser.snapshot());
  }
  if (action === 'wait') {
    await sleep(Math.min(5000, Math.max(200, Number(act.ms) || 800)));
    return decorateSnap(await browser.snapshot());
  }
  return decorateSnap(await browser.snapshot());
}

function heldAction(act, snap, jobs) {
  const action = String((act && act.action) || '').toLowerCase();
  if (action === 'open') return listingAlreadyHeld({ url: act.url }, jobs, boardFromUrl);
  if (action !== 'click') return false;
  const ref = String((act && act.ref) || '');
  const item = (snap && snap.items || []).find((row) => row && row.ref === ref);
  if (!item) return false;
  return listingAlreadyHeld({ url: item.href, href: item.href, name: item.name }, jobs, boardFromUrl);
}

async function runJsonHunt({
  schema,
  starts: optsStarts,
  existingUrls,
  existingJobs,
  browser,
  llm,
  onNeedLogin,
  onAdd,
  onProgress,
  maxRounds = 40,
} = {}) {
  const plan = normalizeSchema(schema);
  const starts = Array.isArray(optsStarts) && optsStarts.length ? optsStarts : huntStartUrls(plan);
  const have = new Set();
  const added = [];
  let snap = null;
  let startIdx = 0;

  async function openStart() {
    if (startIdx >= starts.length) return false;
    const row = starts[startIdx];
    startIdx += 1;
    if (typeof onProgress === 'function') onProgress(`Opening ${row.site}…`);
    await browser.open(row.url);
    await sleep(800);
    snap = decorateSnap(await browser.snapshot());
    return true;
  }

  async function maybeLogin() {
    if (!snap || !snap.login || !snap.login.login) return;
    if (typeof onNeedLogin !== 'function') {
      snap = { ...snap, skipped: true };
      return;
    }
    if (typeof onProgress === 'function') onProgress(loginPrompt(snap.login));
    const out = await onNeedLogin(snap.login);
    if (out && out.skipped) {
      snap = { ...snap, skipped: true };
      return;
    }
    await sleep(600);
    snap = decorateSnap(await browser.snapshot());
    if (snap.login && snap.login.login) snap = { ...snap, skipped: true };
  }

  if (!(await openStart())) {
    return { ok: true, jobs: [], added: 0, dupes: 0, urls: [], reply: 'No hunt start URLs.' };
  }
  await maybeLogin();
  if (snap && snap.skipped) {
    if (!(await openStart())) {
      return { ok: true, jobs: [], added: 0, dupes: 0, urls: [], reply: 'Sign-in skipped; nothing to hunt.' };
    }
    await maybeLogin();
  }

  for (let round = 0; round < maxRounds && added.length < plan.n; round += 1) {
    await maybeLogin();
    if (snap && snap.skipped) {
      const more = await openStart();
      if (!more) break;
      await maybeLogin();
      continue;
    }
    const status = { added: added.length, need: plan.n, jobs: existingJobs || [] };
    const system = huntInstructions({ plan, starts, status });
    const user = huntJsonUser(snap, status, plan);
    const out = await llm.prompt({ system, text: user });
    const act = parseHuntAction((out && (out.reply || out.text)) || '');
    if (!act || String(act.action).toLowerCase() === 'done') break;
    if (String(act.action).toLowerCase() === 'add') {
      const url = String(act.url || '').trim();
      if (!url || have.has(url)) continue;
      const expandRef = expandItemRef(snap && snap.items);
      if (expandRef) {
        try {
          snap = await applyBrowserAction(browser, { action: 'click', ref: expandRef });
        } catch (_) {}
      }
      const pageText = String((snap && snap.text) || '');
      if (!pageJdReady(pageText)) {
        snap = decorateSnap({
          ...(snap || {}),
          needJd: true,
          text: `Need the full posting text from the page — do not summarize. Click See more / Show more, or open the posting homepage, then add again.\n${pageText}`,
        });
        continue;
      }
      const job = {
        url,
        title: act.title || '',
        company: act.company || '',
        jdText: pageText,
        jdSource: 'host',
        posting: act.posting || url,
        linkedin: /linkedin\.com/i.test(url) ? url : act.linkedin || '',
      };
      have.add(url);
      if (typeof onAdd === 'function') {
        const row = await onAdd(job);
        if (row && row.companyHeld) {
          snap = decorateSnap({
            ...(snap || {}),
            text: `companyHeld: ${job.company || 'that company'} is already listed. Skip every other posting from that company.`,
          });
          continue;
        }
        if (!row) continue;
      }
      added.push(job);
      if (typeof onProgress === 'function') {
        onProgress(`Added ${added.length}/${plan.n}${job.company ? `: ${job.company}` : ''}`);
      }
      continue;
    }
    if (heldAction(act, snap, existingJobs || [])) {
      snap = decorateSnap({
        ...(snap || {}),
        skippedListing: true,
        text: ALREADY_LISTED,
      });
      continue;
    }
    try {
      snap = await applyBrowserAction(browser, act);
    } catch (err) {
      snap = decorateSnap({
        ...(snap || {}),
        text: `Action failed: ${err && err.message ? err.message : err}`,
        ok: false,
      });
    }
  }

  const n = added.length;
  return {
    ok: true,
    jobs: added,
    added: n,
    dupes: 0,
    urls: added.map((j) => j.url),
    reply: n
      ? `Added ${n} new listing${n === 1 ? '' : 's'} via logged-in hunt.`
      : 'Hunt finished with 0 new matches.',
  };
}

module.exports = {
  parseHuntAction,
  decorateSnap,
  huntInstructions,
  huntJsonUser,
  runJsonHunt,
  snapshotScript,
  clickScript,
  typeScript,
  scrollScript,
  slimSnap,
};
