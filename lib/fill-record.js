const { isEphemeralSelector } = require('./field-recipes');
const { optionLabels, placeholderOption, fold, isPolarityLabel } = require('./option-match');

function preferWidgetSelector(sel) {
  const s = String(sel || '').trim();
  if (!s) return '';
  if (/select__control/.test(s)) return '.select__control';
  if (/p-select-dropdown|p-dropdown-trigger/.test(s)) return '.p-select-dropdown, .p-dropdown-trigger';
  if (isEphemeralSelector(s)) return '';
  return s;
}

function looksLikeChoiceSelector(sel) {
  return /labeled-(radio|checkbox)-\d+|\[type=["']?(radio|checkbox)|\[role=["']?(radio|checkbox)|input\[type=["']?(radio|checkbox)/i.test(
    String(sel || '')
  );
}

function compactSteps(steps) {
  const out = [];
  for (const step of steps || []) {
    if (!step || !step.op) continue;
    const prev = out[out.length - 1];
    if (step.op === 'wait') {
      if (!out.length) continue;
      if (prev && prev.op === 'wait') {
        prev.ms = Math.max(Number(prev.ms) || 0, Number(step.ms) || 0);
        continue;
      }
      out.push({ op: 'wait', ms: Number(step.ms) > 0 ? Number(step.ms) : 200 });
      continue;
    }
    if (step.op === 'type' && prev && prev.op === 'type') continue;
    if (step.op === 'clickOption' && prev && prev.op === 'clickOption') continue;
    if (step.op === 'click' && prev && prev.op === 'click' && prev.selector === step.selector) continue;
    out.push(step);
  }
  while (out.length && out[out.length - 1].op === 'wait') out.pop();
  return out;
}

function compileRecordedEvents(events) {
  const steps = [];
  let lastT = 0;
  let typed = false;
  for (const ev of events || []) {
    if (!ev || !ev.kind) continue;
    const t = Number(ev.t) || 0;
    if (lastT && t - lastT >= 180 && steps.length) {
      steps.push({ op: 'wait', ms: Math.min(400, Math.max(200, t - lastT)) });
    }
    if (t) lastT = t;
    if (ev.kind === 'click') {
      if (looksLikeChoiceSelector(ev.selector)) {
        steps.push({ op: 'clickOption' });
        continue;
      }
      const selector = preferWidgetSelector(ev.selector);
      steps.push(selector ? { op: 'click', selector } : { op: 'click' });
      continue;
    }
    if (ev.kind === 'option') {
      steps.push({ op: 'clickOption' });
      continue;
    }
    if (ev.kind === 'input') {
      if (!typed) {
        steps.push({ op: 'type' });
        typed = true;
      }
      continue;
    }
    if (ev.kind === 'key' && ev.key === 'Enter' && typed) {
      steps.push({ op: 'clickOption' });
    }
  }
  return compactSteps(steps);
}

function skipDecoy(field) {
  const label = String((field && field.label) || '');
  if (isPolarityLabel(label)) return true;
  const t = String((field && field.type) || '').toLowerCase();
  const family = String((field && field.shape && field.shape.family) || '');
  if ((t === 'radio' || t === 'checkbox' || family === 'choice_group') && optionLabels(field).length >= 2) {
    return true;
  }
  if (/\bcountry\b/i.test(label) && !/phone|dial|code/i.test(label)) return true;
  if (/\b(state|province)\b/i.test(label)) return true;
  return false;
}

function pickDecoy(field, intended) {
  if (!field || skipDecoy(field)) return null;
  const want = fold(intended);
  const opts = optionLabels(field).filter((t) => fold(t) !== want && !placeholderOption(t));
  if (opts.length) {
    const short = opts.find((t) => t.length <= 48);
    return short || opts[0];
  }
  if (/^(yes|true|i agree|i consent)$/i.test(String(intended || '').trim())) return 'No';
  if (/^(no|false)$/i.test(String(intended || '').trim())) return 'Yes';
  return null;
}

function formatStep(step) {
  if (!step || !step.op) return '';
  if (step.op === 'click') return step.selector ? `click ${step.selector}` : 'click';
  if (step.op === 'wait') return `wait ${Number(step.ms) || 200}ms`;
  if (step.op === 'clickOption') return 'click option';
  return String(step.op);
}

const PAGE_CSS_PATH = `
    const cssPath = (el) => {
      if (!el || el.nodeType !== 1) return '';
      if (el.id && document.querySelectorAll('#' + CSS.escape(el.id)).length === 1) {
        return '#' + CSS.escape(el.id);
      }
      const name = el.getAttribute('name');
      if (name) {
        const sel = el.tagName.toLowerCase() + '[name="' + CSS.escape(name) + '"]';
        if (document.querySelectorAll(sel).length === 1) return sel;
      }
      const cls = String(el.className || '')
        .split(/\\s+/)
        .filter((c) => c && !/^select__option/.test(c) && c !== 'magnet-flag');
      if (cls.includes('select__control')) return '.select__control';
      const aria = el.getAttribute('aria-label');
      if (aria) {
        const sel = el.tagName.toLowerCase() + '[aria-label="' + CSS.escape(aria) + '"]';
        if (document.querySelectorAll(sel).length === 1) return sel;
      }
      const parts = [];
      let n = el;
      for (let i = 0; i < 5 && n && n.nodeType === 1 && n !== document.documentElement; i++) {
        const tag = n.tagName.toLowerCase();
        const parent = n.parentElement;
        if (!parent) {
          parts.unshift(tag);
          break;
        }
        const same = [...parent.children].filter((c) => c.tagName === n.tagName);
        const idx = same.indexOf(n) + 1;
        parts.unshift(same.length > 1 ? tag + ':nth-of-type(' + idx + ')' : tag);
        n = parent;
      }
      const sel = parts.join(' > ');
      try {
        if (sel && document.querySelectorAll(sel).length === 1) return sel;
      } catch (_) {}
      return '';
    };
`;

function recordStartScript(fieldId) {
  const id = JSON.stringify(String(fieldId || ''));
  return `(() => {
    const fieldId = ${id};
    if (window.__magnetRecord && typeof window.__magnetRecord.stop === 'function') {
      try { window.__magnetRecord.stop(); } catch (_) {}
    }
    const el = document.querySelector('[data-magnet-field="' + fieldId + '"]');
    if (!el) return { ok: false, reason: 'missing' };
    const host =
      el.closest('fieldset, .form-group, .field, .select, .select-shell, [class*="question"], [class*="field"], [class*="Field"]') ||
      el.parentElement ||
      el;
    ${PAGE_CSS_PATH}
    const isOption = (n) => {
      if (!n || n.nodeType !== 1) return false;
      const role = n.getAttribute('role');
      if (role === 'option' || role === 'radio' || role === 'checkbox') return true;
      const type = (n.getAttribute('type') || '').toLowerCase();
      if (type === 'radio' || type === 'checkbox') return true;
      if (n.tagName === 'LABEL') return true;
      const cls = String(n.className || '');
      return /select__option|p-select-option|p-dropdown-item|radio-group-option|checkbox-group-option/.test(cls);
    };
    const optionOf = (n) => {
      let cur = n;
      for (let i = 0; i < 6 && cur && cur.nodeType === 1; i++) {
        if (isOption(cur)) return cur;
        cur = cur.parentElement;
      }
      return null;
    };
    const inList = (n) =>
      n &&
      n.closest &&
      n.closest('[role="listbox"], .select__menu, .select__menu-list, .p-select-list, .p-dropdown-items, .p-autocomplete-panel');
    const inScope = (n) => {
      if (!n || n.nodeType !== 1) return false;
      if (host.contains(n) || n === el) return true;
      if (optionOf(n) || inList(n)) return true;
      return false;
    };
    const events = [];
    const push = (row) => {
      events.push({ t: Date.now(), ...row });
    };
    const onClick = (e) => {
      if (!e.isTrusted) return;
      const n = e.target;
      if (!inScope(n)) return;
      const opt = optionOf(n);
      if (opt) {
        push({
          kind: 'option',
          selector: cssPath(opt) || '',
          text: String(opt.innerText || '').trim().slice(0, 80),
        });
        return;
      }
      push({
        kind: 'click',
        selector: cssPath(n) || cssPath(el) || '',
        tag: n.tagName,
      });
    };
    const onInput = (e) => {
      if (!e.isTrusted) return;
      const n = e.target;
      if (!host.contains(n) && n !== el) return;
      push({ kind: 'input', selector: cssPath(n) || '', value: String(n.value || '').slice(0, 120) });
    };
    const onKey = (e) => {
      if (!e.isTrusted) return;
      if (!['Enter', 'Escape', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
      const n = e.target;
      if (!inScope(n) && n !== el) return;
      push({ kind: 'key', key: e.key, selector: cssPath(n) || '' });
    };
    document.addEventListener('click', onClick, true);
    document.addEventListener('input', onInput, true);
    document.addEventListener('keydown', onKey, true);
    window.__magnetHarvestPause = true;
    window.__magnetRecord = {
      fieldId,
      events,
      stop: () => {
        document.removeEventListener('click', onClick, true);
        document.removeEventListener('input', onInput, true);
        document.removeEventListener('keydown', onKey, true);
        window.__magnetHarvestPause = false;
        const shell = el.closest && el.closest('.select-shell, .select__container, .select, .select__control');
        const sv = shell && shell.querySelector('.select__single-value');
        let value = '';
        if (sv && (sv.innerText || '').trim()) value = (sv.innerText || '').trim();
        else if (el.tagName === 'SELECT') {
          const opt = el.options[el.selectedIndex];
          value = ((opt && (opt.text || opt.value)) || el.value || '').trim();
        } else if (el.type === 'checkbox' || el.type === 'radio' || el.getAttribute('role') === 'radio') {
          const kind = el.type === 'checkbox' ? 'checkbox' : 'radio';
          const group = el.name
            ? [...document.querySelectorAll('input[type="' + kind + '"][name="' + CSS.escape(el.name) + '"]')]
            : [...host.querySelectorAll('input[type="' + kind + '"], [role="' + kind + '"]')];
          const hit = group.find((n) => n.checked || n.getAttribute('aria-checked') === 'true') || (el.checked ? el : null);
          if (hit) {
            const row =
              hit.closest('[class*="option"], label, .ashby-application-form-input-radio-group-option, .ashby-application-form-input-checkbox-group-option') ||
              hit;
            value = String((row && row.innerText) || hit.value || '').trim();
          }
        } else value = String(el.value || el.innerText || '').trim();
        const shot = { ok: true, fieldId, events: events.slice(), value };
        window.__magnetRecord = null;
        return shot;
      },
    };
    try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (_) {}
    return { ok: true, fieldId };
  })()`;
}

function recordStopScript() {
  return `(() => {
    if (!window.__magnetRecord || typeof window.__magnetRecord.stop !== 'function') {
      return { ok: false, reason: 'not-recording' };
    }
    return window.__magnetRecord.stop();
  })()`;
}

function settleFieldScript(fieldId) {
  const id = JSON.stringify(String(fieldId || ''));
  return `(async () => {
    const el = document.querySelector('[data-magnet-field="' + ${id} + '"]');
    if (el) {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
    }
    await new Promise((r) => setTimeout(r, 80));
    return { ok: true };
  })()`;
}

module.exports = {
  preferWidgetSelector,
  looksLikeChoiceSelector,
  compileRecordedEvents,
  skipDecoy,
  pickDecoy,
  formatStep,
  recordStartScript,
  recordStopScript,
  settleFieldScript,
};
