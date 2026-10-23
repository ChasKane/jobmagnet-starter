const path = require('path');
const { EXTRACT_JD_SCRIPT, scanJobDescription } = require('./jd-scan');
const { htmlToJdText } = require('./jd-format');
const { looksLikeApplyForm } = require('./chat-intent');

const JSON_LD_SCRIPT = `(() => {
  const out = [];
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(s.textContent);
      const arr = Array.isArray(data) ? data : [data];
      for (const item of arr) {
        const t = item['@type'] || item.type;
        if (String(t).toLowerCase().includes('jobposting')) {
          return {
            ok: true,
            source: 'jsonld',
            text: String(item.description || ''),
            title: item.title || '',
            company: (item.hiringOrganization && item.hiringOrganization.name) || '',
          };
        }
      }
    } catch (_) {}
  }
  return { ok: false };
})()`;

const HOST_SCRIPT = `(() => {
  const sels = [
    '.job-details__description-content',
    '.job-details__description',
    '.job-description',
    '#content',
    '.posting-page',
    '[data-testid="job-description"]',
    '.jobs-description__content',
    '.jobs-description',
  ];
  for (const s of sels) {
    const el = document.querySelector(s);
    const text = el && (el.innerText || '').trim();
    if (text && text.length > 400) return { ok: true, source: 'host', text };
  }
  const blocks = [...document.querySelectorAll('h1,h2,h3,section,article,div')];
  let best = '';
  for (const el of blocks) {
    const t = (el.innerText || '').trim();
    if (t.length > 400 && /responsibilit|requirement|about the (role|job)|what you/i.test(t)) {
      if (t.length > best.length) best = t;
    }
  }
  if (best) return { ok: true, source: 'heuristic', text: best.slice(0, 50000) };
  return { ok: false };
})()`;

function normalizeCtaText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function isJdApplyHref(href) {
  return /#application\b|\/apply(\/|\?|$)|\/application(\/|\?|$)|easy[-_]?apply/i.test(String(href || ''));
}

function isJdApplyLabel(text, opts = {}) {
  const t = normalizeCtaText(text);
  if (!t || t.length > 80) return false;
  if (
    /\b(submit|next|continue|save|send|filter|filters|already applied|how to apply|don't apply|do not apply)\b/i.test(t)
  ) {
    return false;
  }
  if (/^easy apply$/i.test(t)) return Boolean(opts.linkedin);
  if (/^apply now\b/i.test(t) || /^apply$/i.test(t)) return true;
  if (/^apply for this (job|role|position)!?$/i.test(t)) return true;
  if (/^apply (for|to) .+$/i.test(t) && !/\b(filter|filters)\b/i.test(t)) return true;
  if (/^apply with (linkedin|indeed|resume)$/i.test(t)) return true;
  if (/^start (your )?application$/i.test(t)) return true;
  if (/^i['’]?m interested$/i.test(t)) return true;
  return false;
}

const PAGE_CHROME_SEL = [
  'nav',
  'header',
  'footer',
  'aside',
  '[class*="cookie" i]',
  '[id*="cookie" i]',
  '#onetrust-banner-sdk',
  '#onetrust-pc-sdk',
  '#onetrust-consent-sdk',
  '[id*="onetrust" i]',
  '[class*="onetrust" i]',
  '[id*="qualtrics" i]',
  '[class*="QSI"]',
  '[id^="QSI"]',
  '[id*="medallia" i]',
  '[class*="kampyle" i]',
  '[aria-label*="job alert" i]',
  '[class*="job-alert" i]',
  '[class*="jobalert" i]',
  '[class*="newsletter" i]',
  '[id*="newsletter" i]',
  '[class*="talent-community" i]',
].join(', ');

function fieldBlob(field) {
  return `${(field && field.label) || ''} ${(field && field.name) || ''} ${(field && field.type) || ''} ${(field && field.placeholder) || ''} ${(field && field.heading) || ''}`.toLowerCase();
}

function isChromeField(field) {
  const blob = fieldBlob(field);
  const type = String((field && field.type) || '').toLowerCase();
  const label = String((field && field.label) || '').replace(/\s+/g, ' ').trim();
  if (type === 'search') return true;
  if (field && field.inChrome) return true;
  if (/^checkbox label$/i.test(label)) return true;
  if (/\bhoneypot\b/i.test(blob) || /\bhoneypot\b/i.test(String((field && (field.name || field.domId)) || ''))) {
    return true;
  }
  if (/^who you might be:?$/i.test(label) || /^people you may know:?$/i.test(label)) return true;
  if (
    (type === 'combobox' || type === 'listbox') &&
    !label &&
    !((field && field.options) || []).length &&
    !(field && field.required)
  ) {
    return true;
  }
  if (/^(performance|functional|targeting|advertising|strictly necessary) cookies?$/i.test(label)) return true;
  if (/^how would you rate your (experience|visit)\??$/i.test(label)) return true;
  if (/^(was this page helpful|rate this page|site feedback)\??$/i.test(label)) return true;
  return /\b(search|subscribe|newsletter|job alert|notify me|keyword|talent community|you.?ll get emails|create job alert|sort by|job title or team|company updates|stay informed|cookie (consent|preferences|settings)|onetrust)\b/.test(
    blob
  ) || /\b(performance|functional|targeting|advertising) cookies?\b/.test(blob);
}

function isStrongApplyField(field) {
  const blob = fieldBlob(field);
  return /\b(first name|last name|full name|phone|resume|c\.?v\.?|cover letter|linkedin|work author|sponsor|legal(ly)? author)\b/.test(
    blob
  );
}

function isWeakIdentityField(field) {
  if (!field || isChromeField(field) || isStrongApplyField(field)) return false;
  const type = String(field.type || '').toLowerCase();
  if (type === 'email') return true;
  const label = String(field.label || '').replace(/\s+/g, ' ').trim();
  if (/^(e-?mail|e-?mail address|your e-?mail address)$/i.test(label)) return true;
  return /\byour e-?mail address\b/.test(fieldBlob(field));
}

function hasVisibleApplyFields(fields) {
  const rows = (Array.isArray(fields) ? fields : []).filter((f) => f && !isChromeField(f) && !isWeakIdentityField(f));
  if (rows.length >= 2) return true;
  return rows.some(isStrongApplyField);
}

function pickJdApply(candidates, opts = {}) {
  if (opts.hasApplyFields) return { ok: false, skipped: 'has-fields' };
  const list = Array.isArray(candidates) ? candidates : [];
  const ranked = list
    .map((c, i) => ({ c, index: c && c.index != null ? c.index : i }))
    .filter(({ c }) => {
      if (!c || c.inDialog) return false;
      if (isJdApplyLabel(c.text, opts)) return true;
      const text = normalizeCtaText(c.text);
      return (!text || text.length < 4) && isJdApplyHref(c.href);
    })
    .map(({ c, index }) => {
      let score = 0;
      const t = normalizeCtaText(c.text);
      if (/apply for this/i.test(t)) score += 6;
      else if (/apply now/i.test(t)) score += 5;
      else if (/^apply$/i.test(t)) score += 4;
      else if (/start /i.test(t)) score += 3;
      if (isJdApplyHref(c.href)) score += 4;
      if (c.inView) score += 3;
      if (c.inChrome) score -= 4;
      return { c, index, score };
    })
    .sort((a, b) => b.score - a.score);
  const hit = ranked[0];
  if (!hit) return { ok: false };
  return { ok: true, text: normalizeCtaText(hit.c.text) || 'Apply', index: hit.index };
}

const CLICK_APPLY_SCRIPT = `(() => {
  const normalizeCtaText = ${normalizeCtaText.toString()};
  const isJdApplyHref = ${isJdApplyHref.toString()};
  const isJdApplyLabel = ${isJdApplyLabel.toString()};
  const pickJdApply = ${pickJdApply.toString()};
  const textOf = (n) => {
    if (!n) return '';
    if (n.tagName === 'INPUT') return String(n.value || n.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim();
    return String(n.innerText || n.getAttribute('aria-label') || n.value || '').replace(/\\s+/g, ' ').trim();
  };
  const hidden = (el) => {
    const st = window.getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return true;
    const r = el.getBoundingClientRect();
    return r.width < 2 && r.height < 2;
  };
  const inDialog = (n) =>
    !!(n.closest('[role="dialog"], .p-dialog, .p-dialog-mask, mat-dialog-container, .modal, [class*="Modal"]'));
  const linkedin = /(?:^|\\.)linkedin\\.com$/i.test(location.hostname);
  const nodes = [...document.querySelectorAll('a, button, [role="button"], input[type="button"], input[type="submit"]')];
  const candidates = nodes.map((n, index) => {
    const r = n.getBoundingClientRect();
    const viewH = window.innerHeight || 800;
    return {
      index,
      text: textOf(n),
      href: n.getAttribute('href') || n.href || '',
      inDialog: inDialog(n),
      inView: r.top >= 0 && r.bottom <= viewH + 80 && r.height >= 2,
      inChrome: !!n.closest(${JSON.stringify(PAGE_CHROME_SEL)}),
    };
  });
  const picked = pickJdApply(candidates, { linkedin });
  if (!picked.ok) return picked;
  const el = nodes[picked.index];
  if (!el) return { ok: false };
  el.click();
  return { ok: true, text: picked.text };
})()`;

const LIST_VISIBLE_CTAS_SCRIPT = `(() => {
  const magnetVisibleCtas = 1;
  const textOf = (n) => {
    if (!n) return '';
    if (n.tagName === 'INPUT') return String(n.value || n.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim();
    return String(n.innerText || n.getAttribute('aria-label') || n.value || '').replace(/\\s+/g, ' ').trim();
  };
  const hidden = (el) => {
    const st = window.getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return true;
    const r = el.getBoundingClientRect();
    return r.width < 2 && r.height < 2;
  };
  const nodes = [...document.querySelectorAll('a, button, [role="button"], input[type="button"], input[type="submit"]')].filter(
    (n) => !hidden(n)
  );
  const ctas = nodes
    .slice(0, 60)
    .map((n) => ({
      text: textOf(n),
      href: n.getAttribute('href') || n.href || '',
    }))
    .filter((c) => c.text || c.href);
  return { ok: true, magnetVisibleCtas, href: location.href, title: document.title || '', ctas };
})()`;

function clickNamedApplyScript(cta) {
  const wantText = normalizeCtaText((cta && (cta.text || cta.label)) || '');
  const wantHref = String((cta && (cta.href || cta.url)) || '').trim();
  return `(() => {
    const wantText = ${JSON.stringify(wantText)};
    const wantHref = ${JSON.stringify(wantHref)};
    const normalizeCtaText = ${normalizeCtaText.toString()};
    const textOf = (n) => {
      if (!n) return '';
      if (n.tagName === 'INPUT') return String(n.value || n.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim();
      return String(n.innerText || n.getAttribute('aria-label') || n.value || '').replace(/\\s+/g, ' ').trim();
    };
    const hidden = (el) => {
      const st = window.getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return true;
      const r = el.getBoundingClientRect();
      return r.width < 2 && r.height < 2;
    };
    const hrefOf = (n) => String(n.getAttribute('href') || n.href || '').trim();
    const nodes = [...document.querySelectorAll('a, button, [role="button"], input[type="button"], input[type="submit"]')].filter(
      (n) => !hidden(n)
    );
    let hit = null;
    if (wantText) {
      hit = nodes.find((n) => normalizeCtaText(textOf(n)).toLowerCase() === wantText.toLowerCase());
    }
    if (!hit && wantHref) {
      hit = nodes.find((n) => {
        const href = hrefOf(n);
        return href && (href === wantHref || href.endsWith(wantHref) || wantHref.endsWith(href));
      });
    }
    if (!hit) return { ok: false };
    hit.click();
    return { ok: true, text: textOf(hit) || wantText || 'Apply', href: hrefOf(hit) || wantHref };
  })()`;
}

function hrefIsOtherPage(current, href) {
  const raw = String(href || '').trim();
  if (!raw || raw.startsWith('#') || /^javascript:/i.test(raw)) return false;
  try {
    const now = new URL(current || 'https://example.invalid/');
    const next = new URL(raw, now);
    return next.href.split('#')[0] !== now.href.split('#')[0];
  } catch {
    return Boolean(raw);
  }
}

function normalizeApplySurface(value) {
  const s = String(value || '')
    .toLowerCase()
    .replace(/-/g, '_');
  if (s === 'form') return 'form';
  if (s === 'needs_click') return 'needs_click';
  return '';
}

function normalizeApplyCta(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const text = normalizeCtaText(raw.text || raw.label || '');
  const href = String(raw.href || raw.url || '').trim();
  if (!text && !href) return null;
  return { text, href };
}

function applyCueFrom(verdict) {
  if (!verdict || typeof verdict !== 'object') return null;
  const apply_surface = normalizeApplySurface(verdict.apply_surface);
  if (!apply_surface) return null;
  const apply_cta = normalizeApplyCta(verdict.apply_cta);
  return apply_cta ? { apply_surface, apply_cta } : { apply_surface };
}

function hasApplyCue(jd) {
  return Boolean(normalizeApplySurface(jd && jd.apply_surface));
}

function applySurfaceOf(jd) {
  return normalizeApplySurface(jd && jd.apply_surface);
}

function applyCtaOf(jd) {
  return normalizeApplyCta(jd && jd.apply_cta);
}

function attachApplyCue(jd, verdict) {
  const cue = applyCueFrom(verdict);
  if (!jd || !cue) return jd || null;
  return { ...jd, ...cue };
}

function formatVisibleCtas(ctas) {
  const list = Array.isArray(ctas) ? ctas : [];
  return list
    .slice(0, 40)
    .map((c) => {
      const text = normalizeCtaText((c && (c.text || c.aria)) || '');
      const href = String((c && c.href) || '').trim();
      if (!text && !href) return '';
      return `- ${text || '(no text)'}${href ? ` ${href}` : ''}`;
    })
    .filter(Boolean)
    .join('\n');
}

function applyFollowPlan(jd) {
  const surface = applySurfaceOf(jd);
  const cta = applyCtaOf(jd);
  if (surface === 'form') return { action: 'fill' };
  if (surface === 'needs_click') return { action: 'click', cta };
  return { action: 'click' };
}

function packCaptured(text, source, extra = {}) {
  const cleaned = htmlToJdText(text);
  return {
    text: cleaned,
    source,
    captured_at: new Date().toISOString(),
    findings: scanJobDescription(cleaned),
    ...extra,
  };
}

async function captureJd(evalFn) {
  const jsonld = await evalFn(JSON_LD_SCRIPT);
  if (jsonld && jsonld.ok && jsonld.text && jsonld.text.length > 80) {
    return packCaptured(jsonld.text, 'jsonld', { title: jsonld.title });
  }
  const host = await evalFn(HOST_SCRIPT);
  if (host && host.ok && host.text) {
    return packCaptured(host.text, host.source);
  }
  const extract = await evalFn(EXTRACT_JD_SCRIPT);
  if (extract && extract.text && extract.length > 80) {
    return packCaptured(extract.text, 'extract');
  }
  return {
    text: '',
    source: 'miss',
    captured_at: new Date().toISOString(),
    findings: { ok: false, hasAlerts: false, findings: [] },
  };
}

const NEED_FULL_JD_HINT =
  'Need the full posting text from the page — do not summarize. Click See more / Show more, or open the posting homepage, then add_listing again (url/title/company only).';

/**
 * Click collapsed "See more" controls, then recapture. Hunt uses this so
 * ingest stores the homepage JD instead of a search-card snippet.
 */
async function expandAbbreviatedJd(evalFn, hooks = {}) {
  const wait = hooks.wait || (async () => {});
  const capture = hooks.captureJd || captureJd;
  if (!evalFn) return null;
  for (let i = 0; i < 3; i += 1) {
    const hit = await evalFn(CLICK_EXPAND_JD_SCRIPT);
    if (!hit || !hit.ok) break;
    await wait(hooks.waitMs != null ? hooks.waitMs : 400);
  }
  const captured = await capture(evalFn);
  if (!captured || !captured.text) return captured || null;
  if (looksLikeJobList(captured.text)) return null;
  return captured;
}

const POSTING_SIGNAL =
  /responsibilit|requirements?|qualifications?|what you.?ll|what we.?re looking|about the (role|job|position)|you will |we are looking|preferred qualifications|minimum qualifications|the role|what you will/i;

function looksLikeJobDescription(text) {
  const t = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length < 120) return false;
  if (looksLikeApplyForm(t)) return false;
  return POSTING_SIGNAL.test(t);
}

const THIN_JD_SOURCES = new Set(['hunt', 'search', 'og', 'linkedin']);

function jdTextOf(jd) {
  return typeof jd === 'string' ? jd : (jd && jd.text) || '';
}

function jdSourceOf(jd) {
  return typeof jd === 'object' && jd ? String(jd.source || '').toLowerCase() : '';
}

const JD_SECTION_RE =
  /^(job )?(responsibilit\w*|requirements?|qualifications?|about (the )?(role|job|us|you|company|team)|what you.?ll|what we.?re looking|education|benefits|why join)/im;

/** Card teasers, collapsed "See more" blobs, and search-result snippets. */
function isAbbreviatedJd(text) {
  const raw = String(text || '');
  const t = raw.replace(/\s+/g, ' ').trim();
  if (!t || t.length < 80) return true;
  if (/…|\.{3}\s*$/.test(t)) return true;
  if (/\b(see|show|read) more\b/i.test(t) && t.length < 2500) return true;
  if (t.length < 800) {
    const sections = raw.split('\n').filter((line) => JD_SECTION_RE.test(line.trim())).length;
    if (sections < 2) return true;
  }
  return false;
}

function looksLikeJobList(text) {
  const t = String(text || '');
  if ((t.match(/\beasy apply\b/gi) || []).length >= 3) return true;
  return /\b(see more jobs|similar jobs|jobs you might|results for|jobs in )\b/i.test(t);
}

/** LLM paraphrase / hunt teaser: short, few lines, no real posting body. */
function isSummarizedJd(text) {
  if (isAbbreviatedJd(text) || looksLikeJobList(text)) return true;
  const raw = String(text || '');
  const t = raw.replace(/\s+/g, ' ').trim();
  if (t.length >= 2000) return false;
  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const bullets = lines.filter((l) => /^[-*•]/.test(l)).length;
  if (t.length < 1200 && bullets < 4 && lines.length < 12) return true;
  return false;
}

/** Hunt/search teasers look like JDs but are missing the posting homepage. */
function isThinJd(jd) {
  const text = jdTextOf(jd);
  const source = jdSourceOf(jd);
  if (isAbbreviatedJd(text) || looksLikeJobList(text)) return true;
  const t = String(text)
    .replace(/\s+/g, ' ')
    .trim();
  if (THIN_JD_SOURCES.has(source) && t.length < 800) return true;
  return false;
}

function hasCompleteJd(jd) {
  return Boolean(jd && looksLikeJobDescription(jdTextOf(jd)) && !isThinJd(jd));
}

function shouldReplaceJd(existing, nextText) {
  const next = String(nextText || '').trim();
  if (next.length < 80) return false;
  if (!existing || !String(existing.text || '').trim()) return true;
  if (isThinJd(existing) && next.length > String(existing.text).length + 40) return true;
  return false;
}

function needsJdCapture(jd) {
  if (!jd || !String(jd.text || '').trim() || String(jd.text).length < 80) return true;
  return isThinJd(jd);
}

function needsPageScan(text) {
  const t = String(text || '').trim();
  if (!t || t.length < 80) return true;
  if (looksLikeApplyForm(t)) return true;
  return !looksLikeJobDescription(t);
}

function isJdOverviewLabel(text) {
  const t = normalizeCtaText(text);
  if (!t || t.length > 80) return false;
  return /^(overview|description|about the job|job details|job description|about this (job|role|position))$/i.test(t);
}

function isJdExpandLabel(text) {
  const t = normalizeCtaText(text);
  if (!t || t.length > 80) return false;
  if (/\b(jobs?\s+like|similar|results|alert|newsletter)\b/i.test(t)) return false;
  if (/^(see|show|read) more\b/i.test(t)) return true;
  if (/^(see|show|read|view) (the )?(full )?(job )?(description|posting|details)$/i.test(t)) return true;
  if (/^more about (this )?(job|role|position)$/i.test(t)) return true;
  if (/^…+$/.test(t) || /^\.{3,}$/.test(t)) return true;
  return false;
}

function pickJdExpand(candidates) {
  const list = Array.isArray(candidates) ? candidates : [];
  const ranked = list
    .map((c, i) => ({ c, index: c && c.index != null ? c.index : i }))
    .filter(({ c }) => {
      if (!c || c.inDialog || c.inChrome) return false;
      return isJdExpandLabel(c.text) || isJdExpandLabel(c.aria) || isJdExpandLabel(c.name);
    })
    .map(({ c, index }) => {
      const t = normalizeCtaText(c.text || c.aria || c.name);
      let score = 0;
      if (/description|posting/i.test(t)) score += 4;
      if (/^see more$/i.test(t)) score += 3;
      if (c.inView) score += 2;
      return { ...c, index, score, text: t };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index);
  if (!ranked.length) return { ok: false };
  return { ok: true, ...ranked[0] };
}

function pickJdExpandRef(items) {
  const hit = pickJdExpand(
    (items || []).map((i, index) => ({
      text: i.name || i.text,
      aria: i.aria,
      name: i.name,
      ref: i.ref,
      index,
      inView: true,
    }))
  );
  if (!hit.ok) return '';
  return hit.ref || '';
}

function pickJdOverview(candidates) {
  const list = Array.isArray(candidates) ? candidates : [];
  const ranked = list
    .map((c, i) => ({ c, index: c && c.index != null ? c.index : i }))
    .filter(({ c }) => {
      if (!c || c.inDialog || c.inChrome) return false;
      return isJdOverviewLabel(c.text) || isJdOverviewLabel(c.aria);
    })
    .map(({ c, index }) => {
      const t = normalizeCtaText(c.text || c.aria);
      let score = 0;
      if (/^overview$/i.test(t)) score += 8;
      else if (/^description$/i.test(t) || /^job description$/i.test(t)) score += 7;
      else if (/about the job/i.test(t)) score += 6;
      else if (/job details/i.test(t)) score += 5;
      if (c.role === 'tab' || c.tab) score += 3;
      if (c.inView) score += 2;
      if (c.selected || c.ariaSelected) score -= 6;
      return { ...c, index, score, text: t };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index);
  if (!ranked.length) return { ok: false };
  return { ok: true, ...ranked[0] };
}

function isJdBackLabel(text) {
  const t = normalizeCtaText(text);
  if (!t || t.length > 80) return false;
  if (/\b(next|continue|submit|apply|forward|skip|save)\b/i.test(t)) return false;
  if (/^(←|‹|<-)+$/.test(t) || /^arrow_back$/i.test(t)) return true;
  if (/^(go )?back$/i.test(t)) return true;
  if (/\bback to\b/i.test(t)) return true;
  if (/^return to\b/i.test(t)) return true;
  if (/view (the )?(job|posting|role|opening)\b/i.test(t)) return true;
  return false;
}

function pickJdBack(candidates) {
  const list = Array.isArray(candidates) ? candidates : [];
  const ranked = list
    .map((c, i) => ({ c, index: c && c.index != null ? c.index : i }))
    .filter(({ c }) => {
      if (!c || c.inDialog) return false;
      return isJdBackLabel(c.text) || isJdBackLabel(c.aria);
    })
    .map(({ c, index }) => {
      const t = normalizeCtaText(c.text || c.aria);
      let score = 0;
      if (/back to (the |this )?(job|role|posting|opening|position)\b/i.test(t)) score += 8;
      else if (/view (the )?(job|posting|role)\b/i.test(t)) score += 6;
      else if (/back to (all )?jobs\b/i.test(t)) score += 2;
      else if (/^(go )?back$/i.test(t) || /^(←|‹)/.test(t)) score += 5;
      if (c.inView) score += 3;
      if (c.inChrome) score -= 4;
      return { c, index, score };
    })
    .sort((a, b) => b.score - a.score);
  const hit = ranked[0];
  if (!hit) return { ok: false };
  return { ok: true, text: normalizeCtaText(hit.c.text || hit.c.aria) || 'Back', index: hit.index };
}

const PAGE_FP_SCRIPT = `(() => {
  const magnetPageFp = 1;
  const body = (document.body && (document.body.innerText || '')) || '';
  return {
    ok: true,
    magnetPageFp,
    href: location.href,
    title: document.title || '',
    fp: [document.title || '', body.length, body.slice(0, 160)].join('|'),
    length: body.length,
  };
})()`;

const PAGE_SCAN_SCRIPT = `(() => {
  const magnetPageScan = 1;
  const clean = (s) =>
    String(s || '')
      .replace(/\\u00a0/g, ' ')
      .replace(/[ \\t]+/g, ' ')
      .replace(/\\n{3,}/g, '\\n\\n')
      .trim();
  const postingRe = /responsibilit|requirement|qualification|about the (role|job|position)|what you|what we.?re looking|you will/i;
  const sels = [
    '.job-details__description-content',
    '.job-details__description',
    '[data-testid="jobDescriptionText"]',
    '.jobs-description',
    '.jobs-description__content',
    '.job-details',
    '#job-details',
    '.posting-page',
    '.posting',
    '[data-testid="job-description"]',
    '[class*="JobDescription"]',
    '[class*="job-description"]',
    '[class*="JobPosting"]',
    'article',
    'main',
    '[role="main"]',
    '#content',
  ];
  let best = '';
  for (const s of sels) {
    const el = document.querySelector(s);
    const t = el && clean(el.innerText || el.textContent || '');
    if (t && t.length > best.length) best = t;
  }
  const blocks = [...document.querySelectorAll('h1,h2,h3,section,article,div')];
  for (const el of blocks) {
    const t = clean(el.innerText || '');
    if (t.length > 400 && postingRe.test(t) && t.length > best.length) best = t;
  }
  const digest = clean((document.body && (document.body.innerText || document.body.textContent)) || '').slice(0, 12000);
  if (!best && digest.length > 80) best = digest;
  const text = best.slice(0, 50000);
  return {
    ok: text.length > 80,
    magnetPageScan,
    source: 'scan',
    href: location.href,
    title: document.title || '',
    text,
    digest,
    length: text.length,
  };
})()`;

const CLICK_OVERVIEW_SCRIPT = `(() => {
  const magnetClickOverview = 1;
  const normalizeCtaText = ${normalizeCtaText.toString()};
  const isJdOverviewLabel = ${isJdOverviewLabel.toString()};
  const pickJdOverview = ${pickJdOverview.toString()};
  const textOf = (n) => {
    if (!n) return '';
    if (n.tagName === 'INPUT') return String(n.value || n.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim();
    return String(n.innerText || n.getAttribute('aria-label') || n.value || '').replace(/\\s+/g, ' ').trim();
  };
  const hidden = (el) => {
    const st = window.getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return true;
    const r = el.getBoundingClientRect();
    return r.width < 2 && r.height < 2;
  };
  const inDialog = (n) =>
    !!(n.closest('[role="dialog"], .p-dialog, .p-dialog-mask, mat-dialog-container, .modal, [class*="Modal"]'));
  const nodes = [...document.querySelectorAll('[role="tab"], a, button, [role="button"]')].filter((n) => !hidden(n));
  const candidates = nodes.map((n, index) => {
    const r = n.getBoundingClientRect();
    const viewH = window.innerHeight || 800;
    const selected = n.getAttribute('aria-selected') === 'true' || n.getAttribute('aria-current') === 'page';
    return {
      index,
      text: textOf(n),
      aria: n.getAttribute('aria-label') || '',
      role: (n.getAttribute('role') || '').toLowerCase(),
      tab: (n.getAttribute('role') || '').toLowerCase() === 'tab',
      selected,
      ariaSelected: selected,
      inDialog: inDialog(n),
      inView: r.top >= 0 && r.bottom <= viewH + 80 && r.height >= 2,
      inChrome: !!n.closest(${JSON.stringify(PAGE_CHROME_SEL)}),
    };
  });
  const picked = pickJdOverview(candidates);
  if (!picked.ok) return picked;
  const el = nodes[picked.index];
  if (!el) return { ok: false };
  el.click();
  return { ok: true, text: picked.text };
})()`;

const CLICK_EXPAND_JD_SCRIPT = `(() => {
  const magnetClickExpand = 1;
  const normalizeCtaText = ${normalizeCtaText.toString()};
  const isJdExpandLabel = ${isJdExpandLabel.toString()};
  const pickJdExpand = ${pickJdExpand.toString()};
  const textOf = (n) => {
    if (!n) return '';
    if (n.tagName === 'INPUT') return String(n.value || n.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim();
    return String(n.innerText || n.getAttribute('aria-label') || n.value || '').replace(/\\s+/g, ' ').trim();
  };
  const hidden = (el) => {
    const st = window.getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return true;
    const r = el.getBoundingClientRect();
    return r.width < 2 && r.height < 2;
  };
  const inDialog = (n) =>
    !!(n.closest('[role="dialog"], .p-dialog, .p-dialog-mask, mat-dialog-container, .modal, [class*="Modal"]'));
  const nodes = [...document.querySelectorAll('a, button, [role="button"], [aria-expanded="false"]')].filter((n) => !hidden(n));
  const candidates = nodes.map((n, index) => {
    const r = n.getBoundingClientRect();
    const viewH = window.innerHeight || 800;
    return {
      index,
      text: textOf(n),
      aria: n.getAttribute('aria-label') || '',
      name: textOf(n),
      inDialog: inDialog(n),
      inView: r.top >= 0 && r.bottom <= viewH + 80 && r.height >= 2,
      inChrome: !!n.closest(${JSON.stringify(PAGE_CHROME_SEL)}),
    };
  });
  const picked = pickJdExpand(candidates);
  if (!picked.ok) return { ok: false, magnetClickExpand };
  const el = nodes[picked.index];
  if (!el) return { ok: false, magnetClickExpand };
  el.click();
  return { ok: true, magnetClickExpand, text: picked.text };
})()`;

const CLICK_BACK_SCRIPT = `(() => {
  const magnetClickBack = 1;
  const normalizeCtaText = ${normalizeCtaText.toString()};
  const isJdBackLabel = ${isJdBackLabel.toString()};
  const pickJdBack = ${pickJdBack.toString()};
  const textOf = (n) => {
    if (!n) return '';
    if (n.tagName === 'INPUT') return String(n.value || n.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim();
    return String(n.innerText || n.getAttribute('aria-label') || n.value || '').replace(/\\s+/g, ' ').trim();
  };
  const hidden = (el) => {
    const st = window.getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return true;
    const r = el.getBoundingClientRect();
    return r.width < 2 && r.height < 2;
  };
  const inDialog = (n) =>
    !!(n.closest('[role="dialog"], .p-dialog, .p-dialog-mask, mat-dialog-container, .modal, [class*="Modal"]'));
  const nodes = [...document.querySelectorAll('a, button, [role="button"], input[type="button"]')].filter((n) => !hidden(n));
  const candidates = nodes.map((n, index) => {
    const r = n.getBoundingClientRect();
    const viewH = window.innerHeight || 800;
    return {
      index,
      text: textOf(n),
      aria: String(n.getAttribute('aria-label') || n.getAttribute('title') || '').replace(/\\s+/g, ' ').trim(),
      href: n.getAttribute('href') || n.href || '',
      inDialog: inDialog(n),
      inView: r.top >= 0 && r.bottom <= viewH + 80 && r.height >= 2,
      inChrome: !!n.closest(${JSON.stringify(PAGE_CHROME_SEL)}),
    };
  });
  const picked = pickJdBack(candidates);
  if (!picked.ok) return { ok: false, magnetClickBack, candidates: candidates.length };
  const el = nodes[picked.index];
  if (!el) return { ok: false, magnetClickBack };
  el.click();
  return { ok: true, magnetClickBack, text: picked.text };
})()`;

class JdHaltError extends Error {
  constructor(message) {
    super(message);
    this.name = 'JdHaltError';
    this.halt = true;
    this.notified = false;
  }
}

function emptyJd() {
  return {
    text: '',
    source: 'miss',
    captured_at: new Date().toISOString(),
    findings: { ok: false, hasAlerts: false, findings: [] },
  };
}

function packScan(scan) {
  if (!scan) return emptyJd();
  const raw = looksLikeJobDescription(scan.text) ? scan.text : scan.digest || scan.text || '';
  if (!raw || String(raw).trim().length < 40) return emptyJd();
  return packCaptured(raw, scan.source || 'scan', { title: scan.title || '' });
}

function preferJd(a, b) {
  const at = (a && a.text) || '';
  const bt = (b && b.text) || '';
  const as = looksLikeJobDescription(at);
  const bs = looksLikeJobDescription(bt);
  if (bs && !as) return b;
  if (as && !bs) return a;
  if (bt.length > at.length + 80) return b;
  return a && a.text ? a : b;
}

function heuristicJudge(text) {
  const t = String(text || '').trim();
  if (!t) return { has_jd: false, reason: 'blank' };
  if (looksLikeJobDescription(t)) return { has_jd: true, apply_surface: 'needs_click', reason: 'heuristic' };
  if (looksLikeApplyForm(t)) return { has_jd: false, apply_surface: 'form', reason: 'apply-form' };
  return { has_jd: false, reason: 'not-jd-like' };
}

function buildJdJudgePrompt(text, meta = {}) {
  const controls = formatVisibleCtas(meta.ctas);
  return `Does this page text include a real job description (role overview, responsibilities, requirements), and is the saved URL already the application form? JSON only, no markdown:
{"has_jd":true|false,"apply_surface":"form"|"needs_click","apply_cta":{"text":"","href":""},"reason":""}
has_jd=true only if this is (or clearly contains) a job posting. Application forms, cookie banners, login walls, empty pages, nav chrome, and privacy policies are false.
apply_surface=form only when this URL already has the application (name, resume, questions). A listing, careers index, login wall, or cookie/newsletter/job-alert widget is not a form.
apply_surface=needs_click when an Apply / Easy Apply / Start application control or apply href must be used first. Name that control in apply_cta when you can see it.
URL: ${meta.href || ''}
Title: ${meta.title || ''}
Visible controls:
${controls || '(none listed)'}
Text:
${String(text || '').slice(0, 4500)}`;
}

function parseApplyCueFields(obj) {
  const cue = applyCueFrom(obj);
  return cue || {};
}

function parseJdJudge(blob) {
  const text = String(blob || '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(text.slice(start, end + 1));
    if (!obj || typeof obj !== 'object') return null;
    const cue = parseApplyCueFields(obj);
    if (obj.has_jd === true || obj.has_jd === 'true') return { has_jd: true, reason: String(obj.reason || ''), ...cue };
    if (obj.has_jd === false || obj.has_jd === 'false') return { has_jd: false, reason: String(obj.reason || ''), ...cue };
    return { has_jd: null, reason: String(obj.reason || 'unknown'), ...cue };
  } catch {
    return null;
  }
}

async function spawnJdJudge(text, meta = {}, opts = {}) {
  try {
    const ev = await require('./agent-client').invoke(
      'jd-judge',
      { text, href: meta.href || '', title: meta.title || '', ctas: meta.ctas || [] },
      { signal: opts.signal, timeout: 20000 }
    );
    if (ev && ev.cancelled) {
      const err = new Error('fill cancelled');
      err.cancelled = true;
      throw err;
    }
    return ev.result || ev;
  } catch (err) {
    if (err && err.cancelled) throw err;
    return null;
  }
}

async function judgeJdText(text, opts = {}) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return { has_jd: false, reason: 'blank' };
  const judge = opts.judge;
  if (judge) {
    try {
      const out = await judge(trimmed, opts.meta || {});
      if (out && typeof out.has_jd === 'boolean') return out;
    } catch (err) {
      if (err && err.cancelled) throw err;
    }
    return heuristicJudge(trimmed);
  }
  try {
    const out = await spawnJdJudge(trimmed, opts.meta || {}, { signal: opts.signal });
    if (out && typeof out.has_jd === 'boolean') return out;
  } catch (err) {
    if (err && err.cancelled) throw err;
  }
  return heuristicJudge(trimmed);
}

function judgeSourceText(captured, scan) {
  const primary = (captured && captured.text) || '';
  if (looksLikeJobDescription(primary)) return primary;
  if (scan && scan.digest) return scan.digest;
  if (scan && scan.text) return scan.text;
  return primary;
}

async function listJudgeCtas(evalFn) {
  if (!evalFn) return [];
  try {
    const listed = await evalFn(LIST_VISIBLE_CTAS_SCRIPT);
    return (listed && listed.ctas) || [];
  } catch {
    return [];
  }
}

function takeApplyCue(tab, hooks, verdict) {
  if (!tab || hasApplyCue(tab.jd)) return;
  tab.jd = attachApplyCue(tab.jd, verdict);
  if (typeof hooks.onApplyCue === 'function' && hasApplyCue(tab.jd)) hooks.onApplyCue(tab.jd);
}

async function fillApplyCue(jd, opts = {}) {
  if (!jd || !String(jd.text || '').trim()) return jd;
  if (hasApplyCue(jd)) return jd;
  let verdict;
  if (opts.judge) {
    verdict = await judgeJdText(jd.text, opts);
  } else if (process.env.NODE_TEST_CONTEXT && !opts.forceJudge) {
    verdict = heuristicJudge(jd.text);
  } else {
    verdict = await judgeJdText(jd.text, opts);
  }
  return attachApplyCue(jd, verdict) || jd;
}

async function stampApplyCue(tab, hooks, meta = {}) {
  if (!tab || hasApplyCue(tab.jd)) return tab && tab.jd;
  const text = meta.text || (tab.jd && tab.jd.text) || '';
  if (!String(text || '').trim()) return tab && tab.jd;
  const ctas = meta.ctas != null ? meta.ctas : await listJudgeCtas(hooks.evalFn);
  const href = meta.href || (hooks.getHref && hooks.getHref()) || '';
  const title = meta.title || '';
  tab.jd = await fillApplyCue(tab.jd, {
    judge: hooks.judge,
    signal: hooks.signal,
    meta: { href, title, ctas },
    forceJudge: Boolean(hooks.judge),
  });
  if (typeof hooks.onApplyCue === 'function' && hasApplyCue(tab.jd)) hooks.onApplyCue(tab.jd);
  return tab.jd;
}

/**
 * Confirm a real posting JD before resume / autofill / essays.
 * Blank or non-JD text → page scan. Still missing → click Back, grab JD, return to apply.
 * Halts immediately when no Back button exists or navigation gets stuck.
 */
async function ensurePostingJd(tab, hooks = {}) {
  const onStep = hooks.onStep || (() => {});
  const evalFn = hooks.evalFn;
  if (!tab || !evalFn) return tab && tab.jd;

  if (hasCompleteJd(tab.jd)) {
    tab.jdVerified = true;
    if (!hasApplyCue(tab.jd)) await stampApplyCue(tab, hooks, { text: tab.jd.text });
    return tab.jd;
  }
  if (tab.jd && !looksLikeJobDescription(tab.jd.text) && !isThinJd(tab.jd)) {
    tab.jd = null;
    tab.jdVerified = false;
  }

  const keepThin = (msg) => {
    if (looksLikeJobDescription(tab.jd && tab.jd.text)) {
      tab.jdVerified = hasCompleteJd(tab.jd);
      onStep('JD', { detail: msg || 'Keeping the short JD — homepage capture missed.' });
      return tab.jd;
    }
    return null;
  };

  const halt = (msg) => {
    const kept = keepThin(msg);
    if (kept) return kept;
    onStep('JD', { detail: msg, toast: msg });
    const err = new JdHaltError(msg);
    err.notified = true;
    throw err;
  };

  const checkAbort = hooks.throwIfAborted || (() => {});
  onStep('JD', { detail: 'Checking for a job description…' });
  let captured = await captureJd(evalFn);
  checkAbort();
  let scan = null;
  if (needsPageScan(captured && captured.text)) {
    onStep('JD', { detail: 'Scanning the page for a job description…' });
    scan = await evalFn(PAGE_SCAN_SCRIPT);
    captured = preferJd(captured, packScan(scan));
  }

  const ctas = await listJudgeCtas(evalFn);
  let verdict = await judgeJdText(judgeSourceText(captured, scan), {
    judge: hooks.judge,
    signal: hooks.signal,
    meta: {
      href: (scan && scan.href) || '',
      title: (captured && captured.title) || (scan && scan.title) || '',
      ctas,
    },
  });
  checkAbort();

  if (!verdict.has_jd && !scan) {
    onStep('JD', { detail: 'Not a job description — scanning the page…' });
    scan = await evalFn(PAGE_SCAN_SCRIPT);
    captured = preferJd(captured, packScan(scan));
    verdict = await judgeJdText(judgeSourceText(captured, scan), {
      judge: hooks.judge,
      signal: hooks.signal,
      meta: {
        href: (scan && scan.href) || '',
        title: (scan && scan.title) || '',
        ctas: await listJudgeCtas(evalFn),
      },
    });
    checkAbort();
  }

  if (verdict.has_jd && captured && captured.text) {
    tab.jd = preferJd(tab.jd, captured);
    tab.jdVerified = hasCompleteJd(tab.jd);
    takeApplyCue(tab, hooks, verdict);
    if (!hasApplyCue(tab.jd)) await stampApplyCue(tab, hooks, { text: tab.jd.text });
    return tab.jd;
  }

  onStep('JD', { detail: 'Looking for Overview / Description…' });
  const overview = await evalFn(CLICK_OVERVIEW_SCRIPT);
  if (overview && overview.ok) {
    onStep('JD', { detail: `Opening ${overview.text || 'Overview'}…` });
    if (typeof hooks.waitAfterOverview === 'function') await hooks.waitAfterOverview();
    else await new Promise((r) => setTimeout(r, process.env.NODE_TEST_CONTEXT ? 0 : 400));
    checkAbort();
    scan = await evalFn(PAGE_SCAN_SCRIPT);
    captured = preferJd(captured, packScan(scan));
    verdict = await judgeJdText(judgeSourceText(captured, scan), {
      judge: hooks.judge,
      signal: hooks.signal,
      meta: {
        href: (scan && scan.href) || '',
        title: (scan && scan.title) || '',
        ctas: await listJudgeCtas(evalFn),
      },
    });
    checkAbort();
    if (verdict.has_jd && captured && captured.text) {
      tab.jd = preferJd(tab.jd, captured);
      tab.jdVerified = hasCompleteJd(tab.jd);
      takeApplyCue(tab, hooks, verdict);
      if (!hasApplyCue(tab.jd)) await stampApplyCue(tab, hooks, { text: tab.jd.text });
      return tab.jd;
    }
  }

  onStep('JD', { detail: 'No job description here — looking for Back…' });
  const before = (await evalFn(PAGE_FP_SCRIPT)) || {};
  if (hooks.getHref && !before.href) before.href = hooks.getHref() || '';
  const clicked = await evalFn(CLICK_BACK_SCRIPT);
  if (!clicked || !clicked.ok) {
    return halt('No job description and no Back button — stopped');
  }

  onStep('JD', { detail: `Going back (${clicked.text || 'Back'})…` });
  const waitForChange = hooks.waitForChange || (async () => ({ ok: false }));
  const changed = await waitForChange(before);
  if (!changed || !changed.ok) {
    return halt('Back button didn’t leave this page — stopped');
  }

  onStep('JD', { detail: 'Grabbing the job description…' });
  let after = await captureJd(evalFn);
  let afterScan = null;
  if (needsPageScan(after && after.text)) {
    afterScan = await evalFn(PAGE_SCAN_SCRIPT);
    after = preferJd(after, packScan(afterScan));
  }
  const afterVerdict = await judgeJdText(judgeSourceText(after, afterScan), {
    judge: hooks.judge,
    signal: hooks.signal,
    meta: {
      href: (afterScan && afterScan.href) || (changed && changed.href) || '',
      title: (after && after.title) || '',
      ctas: await listJudgeCtas(evalFn),
    },
  });
  checkAbort();
  if (!afterVerdict.has_jd || !(after && after.text)) {
    return halt('Went back but still no job description — stopped');
  }

  tab.jd = preferJd(tab.jd, after);
  tab.jdVerified = hasCompleteJd(tab.jd);
  takeApplyCue(tab, hooks, afterVerdict);
  if (!hasApplyCue(tab.jd)) await stampApplyCue(tab, hooks, { text: tab.jd.text });

  onStep('JD', { detail: 'Returning to the apply form…' });
  const apply = await evalFn(CLICK_APPLY_SCRIPT);
  if (apply && apply.ok && !apply.skipped && hooks.waitAfterApply) {
    await hooks.waitAfterApply();
  }
  return tab.jd;
}

module.exports = {
  captureJd,
  ensurePostingJd,
  CLICK_APPLY_SCRIPT,
  LIST_VISIBLE_CTAS_SCRIPT,
  clickNamedApplyScript,
  hrefIsOtherPage,
  hasApplyCue,
  applySurfaceOf,
  applyCtaOf,
  attachApplyCue,
  applyCueFrom,
  applyFollowPlan,
  fillApplyCue,
  CLICK_OVERVIEW_SCRIPT,
  CLICK_EXPAND_JD_SCRIPT,
  CLICK_BACK_SCRIPT,
  PAGE_SCAN_SCRIPT,
  PAGE_FP_SCRIPT,
  JSON_LD_SCRIPT,
  HOST_SCRIPT,
  normalizeCtaText,
  isJdApplyHref,
  isJdApplyLabel,
  isJdOverviewLabel,
  pickJdOverview,
  isJdBackLabel,
  PAGE_CHROME_SEL,
  isChromeField,
  isWeakIdentityField,
  hasVisibleApplyFields,
  pickJdApply,
  pickJdBack,
  looksLikeJobDescription,
  isAbbreviatedJd,
  isSummarizedJd,
  looksLikeJobList,
  isThinJd,
  hasCompleteJd,
  shouldReplaceJd,
  needsJdCapture,
  isJdExpandLabel,
  pickJdExpand,
  pickJdExpandRef,
  expandAbbreviatedJd,
  NEED_FULL_JD_HINT,
  needsPageScan,
  heuristicJudge,
  buildJdJudgePrompt,
  parseJdJudge,
  judgeJdText,
  JdHaltError,
};
