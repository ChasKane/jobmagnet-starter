/** Page scripts the LLM hunt evals. Same strings on Electron and React Native. */

function snapshotScript(cap = 8000) {
  const n = Math.max(1200, Math.min(Number(cap) || 8000, 16000));
  return `(() => {
    document.querySelectorAll('[data-magnet-ref]').forEach((el) => el.removeAttribute('data-magnet-ref'));
    const items = [];
    const take = (el, role) => {
      if (items.length >= 80) return;
      const r = el.getBoundingClientRect();
      if (r.width < 2 && r.height < 2) return;
      const name = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.value || '')
        .trim()
        .replace(/\\s+/g, ' ')
        .slice(0, 90);
      if (!name && role !== 'textbox') return;
      const ref = 'e' + items.length;
      el.setAttribute('data-magnet-ref', ref);
      items.push({ ref: ref, role: role, name: name, href: el.href || '' });
    };
    document.querySelectorAll('a[href], button, [role="button"], [role="link"], input, textarea, select').forEach((el) => {
      const tag = el.tagName.toLowerCase();
      const role =
        tag === 'a' || el.getAttribute('role') === 'link'
          ? 'link'
          : tag === 'button' || el.getAttribute('role') === 'button'
            ? 'button'
            : tag === 'select'
              ? 'select'
              : tag === 'input' || tag === 'textarea'
                ? 'textbox'
                : 'button';
      take(el, role);
    });
    const text = (document.body && document.body.innerText) || '';
    return {
      ok: true,
      url: location.href,
      title: document.title || '',
      text: String(text).slice(0, ${n}),
      items: items,
    };
  })()`;
}

function clickScript(ref) {
  const id = JSON.stringify(String(ref || ''));
  return `(() => {
    const el = document.querySelector('[data-magnet-ref="' + ${id} + '"]');
    if (!el) return { ok: false, error: 'missing' };
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    el.click();
    return { ok: true, href: el.href || '' };
  })()`;
}

function typeScript(ref, text, submit) {
  const id = JSON.stringify(String(ref || ''));
  const value = JSON.stringify(String(text ?? ''));
  const go = Boolean(submit);
  return `(() => {
    const el = document.querySelector('[data-magnet-ref="' + ${id} + '"]');
    if (!el) return { ok: false, error: 'missing' };
    el.focus();
    const v = ${value};
    if (el.isContentEditable) el.textContent = v;
    else el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    if (${go}) {
      const form = el.form || el.closest('form');
      if (form && typeof form.requestSubmit === 'function') form.requestSubmit();
      else if (form) form.submit();
      else el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    }
    return { ok: true };
  })()`;
}

function scrollScript(dir) {
  const delta = String(dir || '').toLowerCase() === 'up' ? -900 : 900;
  return `(() => {
    window.scrollBy(0, ${delta});
    return { ok: true, y: window.scrollY };
  })()`;
}

function pageJdReady(text) {
  const t = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length < 800) return false;
  if (/\b(see more jobs|similar jobs|jobs you might|results for)\b/i.test(t)) return false;
  if ((t.match(/\beasy apply\b/gi) || []).length >= 3) return false;
  return true;
}

function expandItemRef(items) {
  const list = Array.isArray(items) ? items : [];
  const hit = list.find((i) => {
    const name = String((i && i.name) || '').replace(/\s+/g, ' ').trim();
    if (/\b(jobs?\s+like|similar|results|alert)\b/i.test(name)) return false;
    return /^(see|show|read) more$/i.test(name);
  });
  return hit && hit.ref ? hit.ref : '';
}

const ALREADY_LISTED = 'Already listed. Do not read this posting. Go back to the results and open a company that is not on the list.';

function slimSnap(snap, extra = {}) {
  const src = snap && typeof snap === 'object' ? snap : {};
  const { listingAlreadyHeld } = require('./company-hold');
  const { boardFromUrl } = require('./boards');
  const jobs = extra.jobs || [];
  const pageHeld =
    Boolean(src.skippedListing) || listingAlreadyHeld({ url: src.url, title: src.title }, jobs, boardFromUrl);
  const items = (src.items || []).slice(0, 70).map((i) => {
    const href = i.href ? ` | ${i.href}` : '';
    const skip = listingAlreadyHeld({ url: i.href, href: i.href, name: i.name }, jobs, boardFromUrl);
    return `${i.ref} ${i.role} ${i.name || ''}${href}${skip ? ' skip=already-listed' : ''}`.trim();
  });
  const { jobs: _jobs, ...rest } = extra;
  return {
    url: src.url || '',
    title: src.title || '',
    login: Boolean(src.login && (src.login.login != null ? src.login.login : src.login)),
    skipped: Boolean(src.skipped),
    skippedListing: pageHeld,
    text: pageHeld ? ALREADY_LISTED : String(src.text || '').slice(0, 4000),
    items,
    ...rest,
  };
}

function readRefScript(ref) {
  const id = JSON.stringify(String(ref || ''));
  return `(() => {
    const el = document.querySelector('[data-magnet-ref="' + ${id} + '"]');
    if (!el) return { ok: false };
    const name = (el.innerText || el.getAttribute('aria-label') || '').trim().replace(/\\s+/g, ' ').slice(0, 160);
    return { ok: true, href: el.href || '', name: name };
  })()`;
}

module.exports = {
  snapshotScript,
  clickScript,
  typeScript,
  scrollScript,
  slimSnap,
  readRefScript,
  pageJdReady,
  expandItemRef,
  ALREADY_LISTED,
};
