/** DOM primitives: set a value so React/ATS notice, then verify. */

const { pageMatcherSource } = require('./option-match');
const { attachMirrorScript, flushEssayMirrorsScript } = require('./essay-mirror');

const PAGE_SCROLL_HELPERS = `
    const bringIntoView = (node) => {
      if (typeof window.__magnetBringIntoView === 'function') {
        window.__magnetBringIntoView(node);
        return;
      }
      if (!node || window.__magnetAutoScroll !== true) return;
      try { node.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (_) {}
    };
    const focusEl = (node) => {
      if (!node || typeof node.focus !== 'function') return;
      try { node.focus({ preventScroll: true }); } catch (_) { try { node.focus(); } catch (_) {} }
      bringIntoView(node);
    };
`;

function autoScrollArmScript(reset) {
  return `(() => {
    window.__magnetAutoScroll = ${reset ? 'true' : 'false'};
    if (window.__magnetScrollGuard) return true;
    const mark = (e) => {
      if (window.__magnetAutoScrolling) return;
      if (e && e.type === 'keydown') {
        const t = e.target;
        const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
        if (['PageUp', 'PageDown', 'Home', 'End'].includes(e.key)) {
          window.__magnetAutoScroll = false;
          return;
        }
        if (typing) return;
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === ' ') window.__magnetAutoScroll = false;
        return;
      }
      window.__magnetAutoScroll = false;
    };
    window.addEventListener('wheel', mark, { capture: true, passive: true });
    window.addEventListener('touchmove', mark, { capture: true, passive: true });
    window.addEventListener('keydown', mark, { capture: true });
    window.__magnetBringIntoView = (node) => {
      if (!node || window.__magnetAutoScroll !== true) return;
      if (typeof node.scrollIntoView !== 'function') return;
      try { node.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (_) {}
    };
    window.__magnetScrollGuard = true;
    return true;
  })()`;
}

function fillAndVerifyScript(fieldId, value, strategies, label, opts) {
  const payload = JSON.stringify({
    fieldId,
    value,
    strategies,
    label: label || '',
    selector: (opts && opts.selector) || '',
    fallbacks: (opts && opts.fallbacks) || [],
    force: Boolean(opts && opts.force),
    yearsCount: Boolean(opts && opts.yearsCount),
  });
  return `(async () => {
    const { fieldId, value, strategies, label, selector, fallbacks, force, yearsCount } = ${payload};
    ${PAGE_SCROLL_HELPERS}
    const wants = [String(value), ...(Array.isArray(fallbacks) ? fallbacks : [])]
      .map((w) => String(w || '').trim())
      .filter((w, i, a) => w && a.findIndex((x) => x.toLowerCase() === w.toLowerCase()) === i);
    const want = wants[0] || String(value);
    const wantBool = !yearsCount && /^(true|yes|on|1)$/i.test(want);
    const wantNo = !yearsCount && /^(false|no|off|0)$/i.test(want);
    ${pageMatcherSource()}
    const n = fold;
    const aliasGroup = groupOf;
    const choiceRegexes = () => polarityRegexes(label, wants);
    const shortLabel = (text) => {
      const lines = String(text || '').split('\\n').map((s) => s.trim()).filter(Boolean);
      const last = lines[lines.length - 1] || '';
      return last.length <= 160 ? last : last.slice(0, 160);
    };
    const rowOwnText = (node) => {
      if (!node) return '';
      if (node.id) {
        const lab = document.querySelector('label[for="'+CSS.escape(node.id)+'"]');
        if (lab) {
          const lines = String(lab.innerText || '').split('\\n').map((s) => s.trim()).filter(Boolean);
          if (lines.length <= 2) {
            const t = shortLabel(lab.innerText);
            if (t && t.length <= 160) return t;
          }
        }
      }
      let row = node.parentElement;
      for (let i = 0; i < 8 && row; i++) {
        const inputs = row.querySelectorAll('input[type="checkbox"], input[type="radio"], [role="radio"], [role="checkbox"]');
        if (inputs.length === 1) {
          const t = shortLabel(row.innerText);
          if (t && t.length <= 160) return t;
        }
        row = row.parentElement;
      }
      if (node.nextSibling && node.nextSibling.nodeType === 3) {
        const t = String(node.nextSibling.textContent || '').trim();
        if (t && t.length <= 160) return t;
      }
      const sib = node.nextElementSibling;
      if (sib && !sib.querySelector('input, [role="radio"], [role="checkbox"]')) {
        const t = shortLabel(sib.innerText);
        if (t && t.length <= 160) return t;
      }
      return '';
    };
    const optionText = (node) => {
      if (!node) return '';
      const own = rowOwnText(node);
      if (own) return own;
      if (node.tagName === 'BUTTON' || node.getAttribute('role') === 'button') {
        return shortLabel(node.innerText || node.getAttribute('aria-label') || '');
      }
      const aria = shortLabel(node.getAttribute('aria-label') || '');
      if (aria) return aria;
      const raw = String(node.value || '').trim();
      if (raw && raw.length <= 48 && !/^[a-f0-9-]{16,}$/i.test(raw)) return raw;
      return '';
    };
    const isYesNoButton = (node) => {
      if (!node || node.tagName !== 'BUTTON') return false;
      const t = String(node.innerText || '').trim();
      if (/^(yes|no)$/i.test(t)) return true;
      if (node.getAttribute('data-option') && /^(yes|no)$/i.test(String(node.getAttribute('data-option') || ''))) return true;
      return /yesno-option|input-yesno-option/i.test(String(node.className || ''));
    };
    const fireClick = (node) => {
      if (!node) return;
      bringIntoView(node);
      if (isYesNoButton(node) && typeof node.click === 'function') {
        const prev = node.getAttribute('type');
        if (prev === 'submit') node.setAttribute('type', 'button');
        try { node.click(); } catch (_) {}
        if (prev === 'submit') node.setAttribute('type', 'submit');
        return;
      }
      const r = node.getBoundingClientRect();
      const opts = {
        bubbles: true,
        cancelable: true,
        view: window,
        buttons: 1,
        button: 0,
        clientX: r.left + Math.max(1, r.width / 2),
        clientY: r.top + Math.max(1, r.height / 2),
      };
      try { node.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerId: 1, pointerType: 'mouse', isPrimary: true })); } catch (_) {
        node.dispatchEvent(new MouseEvent('pointerdown', opts));
      }
      node.dispatchEvent(new MouseEvent('mousedown', opts));
      try { node.dispatchEvent(new PointerEvent('pointerup', { ...opts, pointerId: 1, pointerType: 'mouse', isPrimary: true })); } catch (_) {
        node.dispatchEvent(new MouseEvent('pointerup', opts));
      }
      node.dispatchEvent(new MouseEvent('mouseup', opts));
      node.dispatchEvent(new MouseEvent('click', opts));
      if (typeof node.click === 'function' && node.tagName !== 'BUTTON') node.click();
    };
    const checkRadio = (node) => {
      if (!node) return;
      if (node.tagName === 'BUTTON' || node.getAttribute('role') === 'button') {
        fireClick(node);
        return;
      }
      if (node instanceof HTMLInputElement && (node.type === 'checkbox' || node.type === 'radio')) {
        const wrap = node.closest('label');
        const lab = node.id ? document.querySelector('label[for="'+CSS.escape(node.id)+'"]') : null;
        if ((lab && lab.querySelector('a')) || (wrap && wrap.querySelector('a'))) {
          node.click();
          return;
        }
      }
      if (node.id) {
        const lab = document.querySelector('label[for="'+CSS.escape(node.id)+'"]');
        if (lab && !lab.querySelector('a')) {
          fireClick(lab);
          return;
        }
      }
      const wrap = node.closest('label');
      if (wrap && !wrap.querySelector('a')) {
        fireClick(wrap);
        return;
      }
      const opt = node.closest('[class*="_option_"], [class*="option"]');
      if (opt && opt !== node) {
        fireClick(opt);
        return;
      }
      if (node instanceof HTMLInputElement) {
        const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked');
        if (desc && desc.set) desc.set.call(node, true);
        else node.checked = true;
        node.dispatchEvent(new Event('input', { bubbles: true }));
        node.dispatchEvent(new Event('change', { bubbles: true }));
      }
      fireClick(node);
    };
    const ashbyEntry = (node) =>
      node &&
      node.closest &&
      node.closest(
        '.ashby-application-form-field-entry, .ashby-application-form-input-radio-group, .ashby-application-form-input-checkbox-group, [class*="_fieldEntry_"]'
      );
    const scopeFor = (node) =>
      ashbyEntry(node) ||
      (node && (node.closest('fieldset, .form-group, .field, .control-group, li, [class*="question"], [class*="field-entry"], [class*="FieldEntry"], [class*="yesno"]') || node.parentElement || document));
    const isSelectedNode = (node) => {
      if (!node) return false;
      if (node.tagName === 'OPTION') return node.selected;
      if (node.checked || node.getAttribute('aria-checked') === 'true' || node.getAttribute('aria-selected') === 'true' || node.getAttribute('aria-pressed') === 'true') return true;
      if (node.classList && [...node.classList].some((c) => /(?:^|_)(active|selected|checked)(?:_|$)/i.test(c))) return true;
      const host = node.closest && node.closest('[class*="_option_"]');
      if (host && /(?:^|\\s)true(?:\\s|$)/.test(host.className || '')) return true;
      return false;
    };
    const yesNoButtons = (root) => {
      let host = root && (root.closest('[class*="yesno"], [class*="YesNo"], .ashby-application-form-input-yesno') || root.parentElement);
      if (host && /yesno-option/i.test(String(host.className || '')) && host.parentElement) host = host.parentElement;
      if (!host) return [];
      return [...host.querySelectorAll('button')].filter((b) => /^(yes|no)$/i.test(String(b.innerText || '').trim()) || isYesNoButton(b));
    };
    const isReactSelectNode = (node) =>
      !!(node && (node.classList.contains('select__input') || node.closest('.select__control, .select-shell')));
    const reactShellFor = (node) =>
      (node && (node.closest('.select-shell, .select__container, .select') || node.closest('.select__control'))) ||
      scopeFor(node);
    const menuUsable = (list) => {
      if (!list) return false;
      const st = window.getComputedStyle(list);
      if (st.display === 'none' || st.visibility === 'hidden') return false;
      const opts = list.querySelectorAll('.select__option, [role="option"]');
      if (opts.length) return true;
      return list.getClientRects().length > 0 && /listbox|select__menu/i.test(String(list.getAttribute('role') || '') + ' ' + list.className);
    };
    const reactMenu = (root) => {
      if (!root || !root.getAttribute) return null;
      if (root.getAttribute('aria-expanded') === 'false') return null;
      const ids = [root.getAttribute('aria-controls'), root.getAttribute('aria-owns')].filter(Boolean);
      if (ids.length) {
        for (const id of ids) {
          const list = document.getElementById(id);
          if (menuUsable(list)) return list;
        }
        return null;
      }
      const shell = reactShellFor(root);
      const inShell = shell && [...shell.querySelectorAll('.select__menu, .select__menu-list, [role="listbox"]')].find(menuUsable);
      return inShell || null;
    };
    const collectChoices = (root) => {
      if (!root) return [];
      if (root.tagName === 'SELECT') {
        return [...root.options].map((o) => ({ node: o, hay: ((o.text || '') + ' ' + (o.value || '')).trim() }));
      }
      if (isReactSelectNode(root)) {
        const list = reactMenu(root);
        if (!list) return [];
        const nodes = [...list.querySelectorAll('.select__option, [role="option"]')];
        return nodes.map((node) => ({
          node,
          hay: ((node.innerText || '') + ' ' + (node.getAttribute('aria-label') || '')).trim(),
        }));
      }
      const type = (root.getAttribute('type') || '').toLowerCase();
      if (type === 'radio' || type === 'checkbox' || root.getAttribute('role') === 'radio') {
        const btns = yesNoButtons(root);
        if (btns.length >= 2) {
          return btns.map((node) => ({ node, hay: optionText(node) }));
        }
        let nodes = [];
        if (root.name) {
          nodes = [...document.querySelectorAll('input[name="'+CSS.escape(root.name)+'"]')];
        }
        if (nodes.length < 2) {
          const idBase = String(root.id || '').replace(/-labeled-radio-\\d+$/i, '');
          const nameBase = String(root.name || '').split('_')[0];
          const all = [...document.querySelectorAll('input[type="radio"], input[type="checkbox"], [role="radio"]')];
          const byPrefix = all.filter((n) => {
            if (idBase && ((n.id || '').startsWith(idBase) || (n.name || '').startsWith(idBase))) return true;
            if (nameBase && nameBase.length >= 8 && ((n.name || '').startsWith(nameBase) || (n.id || '').startsWith(nameBase))) return true;
            return false;
          });
          if (byPrefix.length >= 2 && byPrefix.length <= 80) nodes = byPrefix;
        }
        if (nodes.length < 2) {
          const labelled = root.getAttribute('aria-labelledby');
          if (labelled) {
            const same = [...document.querySelectorAll('input[type="radio"], input[type="checkbox"], [role="radio"]')].filter(
              (n) => n.getAttribute('aria-labelledby') === labelled
            );
            if (same.length >= 2) nodes = same;
          }
        }
        if (nodes.length < 2) {
          const kindSel =
            root.getAttribute('role') === 'radio' || (root.getAttribute('type') || '').toLowerCase() === 'radio'
              ? 'input[type="radio"], [role="radio"]'
              : 'input[type="checkbox"]';
          const questionHere = (box) => {
            if (!box) return false;
            if (box.getAttribute && box.getAttribute('aria-labelledby')) return true;
            const kids = box.children ? [...box.children] : [];
            for (const kid of kids) {
              if (kid.querySelector && kid.querySelector('input, select, textarea, [role="combobox"]')) continue;
              const t = shortLabel(kid.innerText);
              if (t && t.length >= 8 && t.length < 240) return true;
            }
            const prev = box.previousElementSibling;
            if (prev && !(prev.querySelector && prev.querySelector('input, select, textarea, [role="combobox"]'))) {
              const t = shortLabel(prev.innerText);
              if (t && t.length >= 8) return true;
            }
            return false;
          };
          let box = root.parentElement;
          let fallback = [];
          for (let i = 0; i < 12 && box && box !== document.body; i++) {
            const found = [...box.querySelectorAll(kindSel)];
            if (found.length < 1 || found.length > 80) {
              box = box.parentElement;
              continue;
            }
            const marked = questionHere(box);
            if (found.length === 1 && !marked) {
              box = box.parentElement;
              continue;
            }
            if (found.length >= 2 && found.length <= 80 && !fallback.length) fallback = found;
            if (marked && found.length >= 1 && found.length <= 80) {
              nodes = found;
              break;
            }
            box = box.parentElement;
          }
          if (nodes.length < 2 && fallback.length) nodes = fallback;
        }
        if (!nodes.length) nodes = [root];
        return nodes.map((node) => ({ node, hay: optionText(node) }));
      }
      const local = [...scopeFor(root).querySelectorAll('[role="option"], .p-select-option, .p-dropdown-item')];
      const overlayRoot =
        document.querySelector('.p-select-overlay:not(.p-hidden), .p-select-list, .p-dropdown-panel, .cdk-overlay-pane [role="listbox"]') ||
        (() => {
          const id = root.getAttribute && root.getAttribute('aria-controls');
          return id ? document.getElementById(id) : null;
        })();
      const overlay = overlayRoot
        ? [...overlayRoot.querySelectorAll('[role="option"], .p-select-option, .p-dropdown-item, li')]
        : [];
      const nodes = local.length ? local : overlay;
      return nodes.map((node) => ({
        node,
        hay: ((node.innerText || '') + ' ' + (node.getAttribute('aria-label') || '')).trim(),
      }));
    };
    const visibleChoiceRows = (root) => {
      const locked = ashbyEntry(root);
      let host = locked || root;
      if (!locked) {
        for (let i = 0; i < 14 && host && host !== document.body; i++) {
          const inputs = host.querySelectorAll('input[type="checkbox"], input[type="radio"], [role="radio"], [role="checkbox"]');
          if (inputs.length >= 3 && inputs.length <= 80) break;
          host = host.parentElement;
        }
      }
      if (!host) host = (root && root.parentElement) || document;
      const rows = [];
      const seen = new Set();
      for (const input of host.querySelectorAll('input[type="checkbox"], input[type="radio"], [role="radio"], [role="checkbox"]')) {
        const h = rowOwnText(input) || optionText(input);
        const key = n(h);
        if (!key || key.length > 160 || seen.has(key)) continue;
        seen.add(key);
        rows.push({ node: input, hay: h });
      }
      return rows;
    };
    const allChoices = (root) => {
      const seen = new Set();
      const out = [];
      for (const c of collectChoices(root).concat(visibleChoiceRows(root))) {
        if (!c || !c.node || seen.has(c.node)) continue;
        seen.add(c.node);
        out.push({ node: c.node, hay: c.hay || rowOwnText(c.node) || optionText(c.node) });
      }
      return out;
    };
    const realChoices = (root) => {
      const fromDom = allChoices(root).filter((c) => c.hay && !/^no options$/i.test(c.hay) && !/select\\.?\\.?\\.?$/i.test(c.hay));
      return fromDom;
    };
    const pickChoice = (root) => {
      const choices = realChoices(root);
      const pick = pickClosestOption(
        choices.map((c) => c.hay),
        wants[0],
        wants.slice(1),
        label
      );
      if (pick && pick.option) {
        const hit = choices.find((c) => c.hay === pick.option);
        if (hit) return hit.node;
      }
      return null;
    };
    const selectedChoice = (root) => {
      const choices = allChoices(root);
      return choices.find((c) => {
        const node = c.node;
        if (node.tagName === 'OPTION') return node.selected || root.value === node.value;
        return isSelectedNode(node) || (node.classList && node.classList.contains('select__option--is-selected'));
      }) || null;
    };
    const isChoiceWidget = () =>
      el.tagName === 'SELECT' ||
      el.type === 'radio' ||
      el.type === 'checkbox' ||
      el.getAttribute('role') === 'radio' ||
      el.getAttribute('role') === 'combobox' ||
      el.getAttribute('role') === 'listbox';
    const findByLabel = () => {
      if (!label) return null;
      const key = n(label).slice(0, 40);
      if (!key) return null;
      const nodes = [...document.querySelectorAll('label, legend, p, h3, h4, span, div')];
      const q = nodes.find((node) => {
        const t = (node.innerText || '').trim();
        return t.length > 8 && t.length < 320 && n(t).includes(key.slice(0, 24));
      });
      return q ? scopeFor(q) : null;
    };
    let el = document.querySelector('[data-magnet-field="' + fieldId + '"]');
    if (!el && selector) {
      try { el = document.querySelector(selector); } catch (_) {}
    }
    if (!el) {
      const scope = findByLabel();
      if (scope) {
        el = scope.querySelector('input[type="radio"], input[type="checkbox"], [role="radio"]') || scope.querySelector('input, select, textarea');
      }
    }
    if (!el) return { ok: false, reason: 'missing' };
    const isReactSelect = () => isReactSelectNode(el);
    const isPlaceholderZero = (s) => {
      const t = String(s || '').trim();
      if (!t) return true;
      if (/^(select|select one|choose|choose one|pick one|please select|n\\/a|\\.\\.\\.$)/i.test(t)) return true;
      const d = t.replace(/[$,\\s]/g, '');
      return d === '0' || d === '0.00';
    };
    const current = () => {
      const yesBtns = yearsCount ? [] : yesNoButtons(el);
      if (yesBtns.length >= 2) {
        const pressed = yesBtns.find((b) => b.getAttribute('aria-pressed') === 'true' || isSelectedNode(b));
        if (pressed) return optionText(pressed) || String(pressed.getAttribute('data-option') || '');
        return '';
      }
      if (isReactSelect()) {
        const shell = reactShellFor(el);
        const multi = [...(shell ? shell.querySelectorAll('.select__multi-value__label') : [])]
          .map((n) => String(n.innerText || '').trim())
          .filter(Boolean);
        if (multi.length) return multi.join(', ');
        const sv = shell && shell.querySelector('.select__single-value');
        return ((sv && sv.innerText) || '').trim();
      }
      const texty =
        el.tagName === 'TEXTAREA' ||
        (el.tagName === 'INPUT' && !/^(checkbox|radio|hidden|file|submit|button)$/i.test(el.type || ''));
      if (texty && el.getAttribute('role') !== 'combobox' && el.getAttribute('role') !== 'listbox') {
        return String(el.value || '').trim();
      }
      const sel = selectedChoice(el);
      if (sel && sel.hay) return sel.hay;
      if (el.type === 'checkbox' || el.type === 'radio' || el.getAttribute('role') === 'radio') return el.checked || el.getAttribute('aria-checked') === 'true' ? 'true' : 'false';
      if (el.tagName === 'SELECT') {
        const opt = el.options[el.selectedIndex];
        const t = ((opt && (opt.text || opt.value)) || '').trim();
        return isPlaceholderZero(t) ? '' : t;
      }
      if (el.getAttribute('role') === 'combobox') {
        const shell = el.closest('p-select, .p-select, .select-shell') || el.parentElement;
        const sv = shell && shell.querySelector('.select__single-value, .p-select-label, [class*="single-value"]');
        if (sv && (sv.innerText || '').trim() && !isPlaceholderZero(sv.innerText)) return (sv.innerText || '').trim();
        return '';
      }
      if (el.isContentEditable) return (el.innerText || '').trim();
      return String(el.value || '').trim();
    };
    const committed = () => {
      const got = current();
      if (!got || isPlaceholderZero(got)) return false;
      if (el.getAttribute('role') === 'combobox' && !isReactSelect()) {
        const choices = realChoices(el);
        if (choices.length) return choices.some((c) => c.hay && (n(c.hay) === n(got) || matchesCandidate(c.hay, got)));
        return false;
      }
      return true;
    };
    if (!force && el.type !== 'checkbox' && el.type !== 'radio' && el.getAttribute('role') !== 'radio' && committed()) {
      return { ok: true, skipped: 'nonempty', value: current() };
    }
    const nativeSet = (node, v) => {
      if (!node || node.type === 'radio' || node.type === 'checkbox' || node.getAttribute('role') === 'radio') return;
      if (node.isContentEditable) {
        focusEl(node);
        node.textContent = v;
        node.dispatchEvent(new InputEvent('input', { bubbles: true, data: v, inputType: 'insertText' }));
        node.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }
      const proto =
        node.tagName === 'TEXTAREA'
          ? HTMLTextAreaElement.prototype
          : node.tagName === 'SELECT'
            ? HTMLSelectElement.prototype
            : HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      const prev = node.value;
      if (desc && desc.set) desc.set.call(node, v);
      else node.value = v;
      const tracker = node._valueTracker;
      if (tracker && typeof tracker.setValue === 'function') tracker.setValue(prev == null ? '' : prev);
      node.dispatchEvent(new InputEvent('input', { bubbles: true, data: String(v), inputType: 'insertFromPaste' }));
      node.dispatchEvent(new Event('input', { bubbles: true }));
      node.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const clickRowFor = (hit) => {
      if (!hit) return;
      if (hit.tagName === 'BUTTON' || hit.getAttribute('role') === 'button' || isYesNoButton(hit) || hit.hasAttribute('data-option')) {
        checkRadio(hit);
        return;
      }
      let row = hit.parentElement;
      for (let i = 0; i < 8 && row; i++) {
        if (/yesno/i.test(String(row.className || '')) && row.querySelectorAll('button').length >= 2) {
          break;
        }
        const nIn = row.querySelectorAll('input[type="checkbox"], input[type="radio"], [role="radio"], [role="checkbox"]').length;
        if (nIn === 1) {
          fireClick(row);
          return;
        }
        row = row.parentElement;
      }
      checkRadio(hit);
    };
    const clickVisibleName = () => {
      const keys = new Set();
      for (const w of wants) {
        const nw = n(w);
        if (nw) keys.add(nw);
        const g = aliasGroup(w);
        if (g) keys.add(g);
      }
      if (!keys.size) return null;
      let host = ashbyEntry(el) || el;
      if (!ashbyEntry(el)) {
        for (let i = 0; i < 14 && host && host !== document.body; i++) {
          const nIn = host.querySelectorAll('input[type="checkbox"], input[type="radio"], [role="radio"], [role="checkbox"]').length;
          if (nIn >= 3 && nIn <= 80) break;
          host = host.parentElement;
        }
      }
      if (!host || host === document.body || host === document.documentElement) {
        host =
          el.closest(
            'fieldset, .form-group, .canned-questions, [class*="question"], [role="group"], .application-question, li'
          ) ||
          el.parentElement ||
          el;
      }
      const matchNode = (node) => {
        if (!node || node.nodeType !== 1) return false;
        const own = [...node.childNodes]
          .filter((c) => c.nodeType === 3)
          .map((c) => String(c.textContent || '').trim())
          .filter(Boolean)
          .join(' ');
        const leaf = node.childElementCount === 0 ? String(node.innerText || '').trim() : '';
        const t = own || leaf;
        if (!t || t.length > 48) return false;
        return keys.has(n(t)) || keys.has(aliasGroup(t));
      };
      const walk = (node) => {
        if (!node || node.nodeType !== 1) return null;
        if (matchNode(node)) return node;
        for (const child of node.children) {
          const hit = walk(child);
          if (hit) return hit;
        }
        return null;
      };
      const target = walk(host);
      if (!target) return null;
      fireClick(target);
      const input =
        (target.closest('label') && target.closest('label').querySelector('input, [role="radio"], [role="checkbox"]')) ||
        target.querySelector('input, [role="radio"], [role="checkbox"]') ||
        target;
      checkRadio(input);
      return input;
    };
    let lastChoice = null;
    const clickWantInScope = () => {
      const hit = pickChoice(el);
      if (hit) {
        if (el.tagName === 'SELECT') {
          nativeSet(el, hit.value);
        } else clickRowFor(hit);
        lastChoice = hit;
        return hit;
      }
      lastChoice = clickVisibleName();
      return lastChoice;
    };
    const monthNames = ['january','february','march','april','may','june','july','august','september','october','november','december'];
    for (const name of strategies) {
      try {
        if (name === 'native_value') {
          if (isReactSelect()) continue;
          if (el.type === 'radio' || el.getAttribute('role') === 'radio' || el.tagName === 'SELECT') {
            clickWantInScope();
          } else if (el.type === 'checkbox') {
            if (wants.some((w) => w && !isBareBool(w)) || allChoices(el).length > 1) clickWantInScope();
            else if (el.checked !== wantBool) checkRadio(el);
          } else nativeSet(el, want);
        } else if (name === 'input_events') {
          if (isReactSelect()) continue;
          if (el.type === 'radio' || el.type === 'checkbox' || el.getAttribute('role') === 'radio') {
            clickWantInScope();
          } else {
            focusEl(el);
            nativeSet(el, '');
            const chunk = 24;
            for (let i = 0; i < want.length; i += chunk) {
              nativeSet(el, want.slice(0, i + chunk));
              el.dispatchEvent(new InputEvent('input', { bubbles: true, data: want.slice(i, i + chunk), inputType: 'insertText' }));
            }
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.blur && el.blur();
          }
        } else if (name === 'select_value' && el.tagName === 'SELECT') {
          clickWantInScope();
        } else if (name === 'select_text' && el.tagName === 'SELECT') {
          clickWantInScope();
        } else if (name === 'label_click') {
          clickWantInScope();
        } else if (name === 'react_select') {
          if (!isReactSelect()) continue;
          const control = el.closest('.select__control') || el;
          const pressEscape = (target) => {
            const node = target || document;
            node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
          };
          const closeMenu = () => {
            const inDialog = !!(el.closest && el.closest('[role="dialog"], [aria-modal="true"], .modal'));
            pressEscape(el);
            if (!inDialog) pressEscape(document);
            nativeSet(el, '');
            if (inDialog && el.blur) el.blur();
          };
          const openMenu = async (until) => {
            closeMenu();
            if (document.activeElement && document.activeElement !== el && document.activeElement.blur) {
              document.activeElement.blur();
            }
            focusEl(el);
            if (el.getAttribute('aria-expanded') !== 'true') fireClick(control);
            while (el.getAttribute('aria-expanded') !== 'true' && Date.now() < until) {
              fireClick(control);
              await new Promise((r) => setTimeout(r, 40));
            }
          };
          const waitForHit = async (until) => {
            let hit = pickChoice(el);
            while (!hit && Date.now() < until) {
              await new Promise((r) => setTimeout(r, 40));
              hit = pickChoice(el);
              if (!hit && realChoices(el).length) break;
            }
            return hit;
          };
          const filterText = wants.find((w) => w && !isBareBool(w)) || '';
          const deadline = Date.now() + 1800;
          await openMenu(deadline);
          let hit = await waitForHit(deadline);
          if (!hit && filterText) {
            const prefix = filterText.slice(0, 16);
            nativeSet(el, '');
            nativeSet(el, prefix);
            el.dispatchEvent(new InputEvent('input', { bubbles: true, data: prefix, inputType: 'insertText' }));
            hit = await waitForHit(Date.now() + 1200);
          }
          const landedReact = () => {
            const got = current();
            return Boolean(got && wants.some((w) => matchesCandidate(got, w)));
          };
          if (hit) {
            fireClick(hit);
            if (typeof hit.click === 'function') hit.click();
            const until = Date.now() + 500;
            while (!landedReact() && Date.now() < until) {
              await new Promise((r) => setTimeout(r, 40));
            }
          } else closeMenu();
        } else if (name === 'combobox') {
          if (el.type === 'radio' || el.type === 'checkbox' || el.getAttribute('role') === 'radio') {
            clickWantInScope();
          } else {
            const isAshbyAuto =
              /ashby-application-form-input-autocomplete/.test(String(el.className || '')) ||
              (el.getAttribute('role') === 'combobox' && /start typing|type to search/i.test(el.placeholder || ''));
            focusEl(el);
            if (isAshbyAuto) {
              nativeSet(el, '');
              nativeSet(el, want);
              el.dispatchEvent(new InputEvent('input', { bubbles: true, data: want, inputType: 'insertText' }));
              const until = Date.now() + 1600;
              let opt = pickChoice(el);
              while (!opt && Date.now() < until) {
                await new Promise((r) => setTimeout(r, 50));
                opt = pickChoice(el);
              }
              if (opt) fireClick(opt);
              else {
                const inDialog = !!(el.closest && el.closest('[role="dialog"], [aria-modal="true"], .modal'));
                if (!inDialog) {
                  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
                }
                nativeSet(el, '');
                if (inDialog && el.blur) el.blur();
              }
            } else {
              const chevron = (el.closest('p-select, .p-select') || el.parentElement || el).querySelector('.p-select-dropdown, .p-dropdown-trigger');
              fireClick(chevron || el);
              const until = Date.now() + 1200;
              let opt = pickChoice(el);
              while (!opt && Date.now() < until) {
                await new Promise((r) => setTimeout(r, 40));
                opt = pickChoice(el);
              }
              const filterText = wants.find((w) => w && !isBareBool(w)) || '';
              if (!opt && filterText) {
                nativeSet(el, filterText.slice(0, 16));
                await new Promise((r) => setTimeout(r, 120));
                opt = pickChoice(el);
              }
              if (opt) fireClick(opt);
              else {
                const inDialog = !!(el.closest && el.closest('[role="dialog"], [aria-modal="true"], .modal'));
                if (!inDialog) {
                  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
                }
                nativeSet(el, '');
                if (inDialog && el.blur) el.blur();
              }
            }
          }
        } else if (name === 'date_mask') {
          if (isReactSelect() || el.type === 'radio' || el.type === 'checkbox' || el.getAttribute('role') === 'radio') continue;
          let masked = want;
          if (/^\\d{4}-\\d{2}$/.test(want)) {
            const [y, m] = want.split('-');
            masked = m + '/' + y;
          }
          nativeSet(el, masked);
          if (el.tagName === 'SELECT') {
            const nNum = Number(want);
            const nameHit = monthNames[nNum - 1];
            const opt = [...el.options].find((o) => {
              const t = (o.text || '').toLowerCase();
              return t === want || o.value === want || (nameHit && t.startsWith(nameHit.slice(0, 3)));
            });
            if (opt) {
              el.value = opt.value;
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }
        }
      } catch (err) {
        continue;
      }
      await new Promise((r) => setTimeout(r, 80));
      const got = current();
      const yesBtns = yearsCount ? [] : yesNoButtons(el);
      if (yesBtns.length >= 2) {
        const pressed = yesBtns.find((b) => b.getAttribute('aria-pressed') === 'true' || isSelectedNode(b));
        const hay = pressed ? (optionText(pressed) || String(pressed.getAttribute('data-option') || '')) : '';
        if (hay && wants.some((w) => matchesCandidate(hay, w) || n(hay) === n(w) || n(hay) === n(w).slice(0, 3))) {
          return { ok: true, strategy: name, value: hay };
        }
      }
      const picked = pickChoice(el);
      const sel = selectedChoice(el);
      const boolWant = !yearsCount && /^(true|false|yes|no|on|off)$/i.test(want);
      const digits = (s) => String(s || '').replace(/[^\\d]/g, '');
      const grouped = isChoiceWidget() && allChoices(el).length > 1;
      const namedWant = yearsCount || wants.some((w) => w && !isBareBool(w));
      const choiceHay = (sel && sel.hay) || '';
      const choiceOk =
        grouped &&
        Boolean(picked && sel && sel.node === picked) &&
        (wants.some((w) => matchesCandidate(choiceHay, w)) || choiceRegexes().some((re) => re.test(choiceHay)));
      const namedOk =
        namedWant &&
        sel &&
        (wants.some((w) => matchesCandidate(sel.hay, w)) || choiceRegexes().some((re) => re.test(sel.hay)));
      const reactOk =
        isReactSelect() &&
        got &&
        (wants.some((w) => matchesCandidate(got, w)) || choiceRegexes().some((re) => re.test(got)));
      const lastHay = lastChoice ? rowOwnText(lastChoice) || optionText(lastChoice) : '';
      const lastOk =
        Boolean(lastChoice) &&
        namedWant &&
        lastHay &&
        wants.some((w) => matchesCandidate(lastHay, w) || n(lastHay) === n(w));
      const selectedNamed =
        namedWant &&
        allChoices(el).find(
          (c) =>
            c &&
            (isSelectedNode(c.node) || c.node.checked) &&
            wants.some((w) => matchesCandidate(c.hay, w) || n(c.hay) === n(w))
        );
      const ok = isReactSelect()
        ? reactOk
        : namedOk
          ? true
          : Boolean(selectedNamed)
            ? true
            : lastOk && (isSelectedNode(lastChoice) || lastChoice.checked || lastChoice.getAttribute('aria-checked') === 'true' || force)
              ? true
            : grouped
            ? Boolean(choiceOk || (picked && sel && sel.node === picked))
            : el.type === 'checkbox'
              ? !namedWant && boolWant && String(el.checked) === String(wantBool)
              : digits(want).length >= 4 && digits(got) === digits(want)
                ? true
                : got.toLowerCase() === want.toLowerCase() || got.includes(want);
      if (ok) {
        const shown = (selectedNamed && selectedNamed.hay) || (lastOk && lastHay) || ((grouped || namedWant) && sel ? sel.hay : got);
        return { ok: true, strategy: name, value: shown };
      }
    }
    return { ok: false, reason: 'unverified', value: current() };
  })()`;
}

function readFieldScript(fieldId) {
  return `(() => {
    const el = document.querySelector('[data-magnet-field="${fieldId}"]');
    if (!el) return '';
    if (el.type === 'radio' || el.getAttribute('role') === 'radio') {
      const group = el.name
        ? [...document.querySelectorAll('input[type="radio"][name="'+CSS.escape(el.name)+'"]')]
        : [el];
      const hit = group.find((n) => n.checked || n.getAttribute('aria-checked') === 'true');
      if (!hit) return '';
      const lab = (hit.id && document.querySelector('label[for="'+CSS.escape(hit.id)+'"]')) || hit.closest('label');
      return ((lab && lab.innerText) || hit.value || '').trim();
    }
    if (el.classList.contains('select__input') || el.closest('.select__control, .select-shell')) {
      const shell = el.closest('.select-shell, .select__container, .select') || el.closest('.select__control') || el;
      const multi = [...shell.querySelectorAll('.select__multi-value__label')].map((n) => String(n.innerText || '').trim()).filter(Boolean);
      if (multi.length) return multi.join(', ');
      const sv = shell.querySelector('.select__single-value');
      if (sv && (sv.innerText || '').trim()) return (sv.innerText || '').trim();
    }
    if (el.tagName === 'SELECT') {
      const opt = el.options[el.selectedIndex];
      return ((opt && (opt.text || opt.value)) || el.value || '').trim();
    }
    if (el.type === 'checkbox') {
      const host = el.closest('.ashby-application-form-input-yesno, [class*="yesno"], [class*="_fieldEntry_"]');
      const btns = host ? [...host.querySelectorAll('button')].filter((b) => /^(yes|no)$/i.test((b.innerText || '').trim()) || b.hasAttribute('data-option')) : [];
      if (btns.length >= 2) {
        const pressed = btns.find((b) => b.getAttribute('aria-pressed') === 'true');
        return pressed ? String(pressed.innerText || pressed.getAttribute('data-option') || '').trim() : '';
      }
      const name = el.name || '';
      const group = name
        ? [...document.querySelectorAll('input[type="checkbox"][name="'+CSS.escape(name)+'"]')]
        : [];
      if (group.length >= 2) {
        const hit = group.find((n) => n.checked);
        if (!hit) return '';
        const lab = (hit.id && document.querySelector('label[for="'+CSS.escape(hit.id)+'"]')) || hit.closest('label');
        return ((lab && lab.innerText) || hit.value || '').trim();
      }
      return el.checked ? 'Yes' : 'No';
    }
    if (el.isContentEditable) return (el.innerText || '').trim();
    return String(el.value || '').trim();
  })()`;
}

function fieldSelectorScript(fieldId) {
  return `(() => {
    const el = document.querySelector('[data-magnet-field="${fieldId}"]');
    if (!el) return '';
    if (el.id && document.querySelectorAll('#' + CSS.escape(el.id)).length === 1) {
      return '#' + CSS.escape(el.id);
    }
    const name = el.getAttribute('name');
    if (name) {
      const sel = el.tagName.toLowerCase() + '[name="' + CSS.escape(name) + '"]';
      if (document.querySelectorAll(sel).length === 1) return sel;
    }
    const aria = el.getAttribute('aria-label');
    if (aria) {
      const sel = el.tagName.toLowerCase() + '[aria-label="' + CSS.escape(aria) + '"]';
      if (document.querySelectorAll(sel).length === 1) return sel;
    }
    return '';
  })()`;
}


function runStepsScript(fieldId, steps, value, opts) {
  const payload = JSON.stringify({
    fieldId,
    steps: Array.isArray(steps) ? steps : [],
    value: value == null ? '' : String(value),
    selector: (opts && opts.selector) || '',
    fallbacks: (opts && opts.fallbacks) || [],
    label: (opts && opts.label) || '',
  });
  return `(async () => {
    const { fieldId, steps, value, selector, fallbacks, label } = ${payload};
    ${PAGE_SCROLL_HELPERS}
    ${pageMatcherSource()}
    const wants = [String(value), ...(Array.isArray(fallbacks) ? fallbacks : [])]
      .map((w) => String(w || '').trim())
      .filter((w, i, a) => w && a.findIndex((x) => x.toLowerCase() === w.toLowerCase()) === i);
    const want = wants[0] || String(value);
    let el = document.querySelector('[data-magnet-field="' + fieldId + '"]');
    if (!el && selector) {
      try { el = document.querySelector(selector); } catch (_) {}
    }
    if (!el) return { ok: false, reason: 'missing', strategy: 'steps' };
    const nativeSet = (node, v) => {
      if (!node) return;
      const proto = node.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      const prev = node.value;
      if (desc && desc.set) desc.set.call(node, v);
      else node.value = v;
      const tracker = node._valueTracker;
      if (tracker && typeof tracker.setValue === 'function') tracker.setValue(prev == null ? '' : prev);
      node.dispatchEvent(new InputEvent('input', { bubbles: true, data: String(v), inputType: 'insertFromPaste' }));
      node.dispatchEvent(new Event('input', { bubbles: true }));
      node.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const fireClick = (node) => {
      if (!node || typeof node.click !== 'function') return;
      bringIntoView(node);
      node.click();
    };
    const choiceText = (node) => {
      if (!node) return '';
      const lab =
        (node.id && document.querySelector('label[for="' + CSS.escape(node.id) + '"]')) ||
        node.closest('label') ||
        node.closest('[class*="option"]') ||
        node;
      return String((lab && (lab.innerText || lab.text || lab.getAttribute('aria-label'))) || node.value || '').trim();
    };
    const choiceGroup = () => {
      const kind = el.type === 'checkbox' ? 'checkbox' : 'radio';
      if (el.name) {
        const named = [...document.querySelectorAll('input[type="' + kind + '"][name="' + CSS.escape(el.name) + '"]')];
        if (named.length >= 2) return named;
      }
      const idBase = String(el.id || '').replace(/-labeled-(radio|checkbox)-\\d+$/i, '');
      if (idBase) {
        const sibs = [...document.querySelectorAll('[id^="' + CSS.escape(idBase) + '-labeled-"]')];
        if (sibs.length >= 2) return sibs;
      }
      const host =
        el.closest(
          'fieldset, .form-group, .field, [class*="question"], [class*="field"], [class*="radio-group"], [class*="checkbox-group"]'
        ) || el.parentElement;
      if (host) {
        const inHost = [...host.querySelectorAll('input[type="' + kind + '"], [role="' + kind + '"]')];
        if (inHost.length >= 2) return inHost;
      }
      return [el];
    };
    const current = () => {
      if (el.type === 'radio' || el.getAttribute('role') === 'radio') {
        const hit = choiceGroup().find((n) => n.checked || n.getAttribute('aria-checked') === 'true');
        return hit ? choiceText(hit) : '';
      }
      if (el.type === 'checkbox') {
        const group = choiceGroup();
        if (group.length >= 2) {
          const hit = group.find((n) => n.checked);
          return hit ? choiceText(hit) : '';
        }
        return el.checked ? 'Yes' : 'No';
      }
      if (el.isContentEditable) return (el.innerText || '').trim();
      if (el.tagName === 'SELECT') {
        const opt = el.options[el.selectedIndex];
        return ((opt && (opt.text || opt.value)) || el.value || '').trim();
      }
      const shell = el.closest && el.closest('.select-shell, .select__container, .select, .select__control');
      const reactInput = el.classList && (el.classList.contains('select__input') || (el.closest && el.closest('.select__control')));
      if (reactInput) {
        const multi = shell ? [...shell.querySelectorAll('.select__multi-value__label')].map((n) => String(n.innerText || '').trim()).filter(Boolean) : [];
        if (multi.length) return multi.join(', ');
        const sv = shell && shell.querySelector('.select__single-value');
        if (sv && (sv.innerText || '').trim()) return (sv.innerText || '').trim();
        return '';
      }
      const sv = shell && shell.querySelector('.select__single-value');
      if (sv && (sv.innerText || '').trim()) return (sv.innerText || '').trim();
      return String(el.value || '').trim();
    };
    const clickOption = (match) => {
      const host =
        el.closest(
          'fieldset, .form-group, .field, .select, .select-shell, [class*="question"], [class*="field"], [class*="Field"]'
        ) ||
        el.parentElement ||
        el;
      let nodes = choiceGroup();
      if (nodes.length < 2) {
        nodes = [
          ...host.querySelectorAll(
            '[role="option"], .select__option, .p-select-option, option, button, [role="radio"], [role="checkbox"], label, input[type="radio"], input[type="checkbox"]'
          ),
        ];
      }
      if (nodes.length < 2) {
        const menu = document.querySelector('.select__menu, [role="listbox"], .p-select-list, .p-dropdown-items');
        if (menu) nodes = [...menu.querySelectorAll('[role="option"], .select__option, option')];
      }
      const labels = nodes.map((n) => choiceText(n)).filter(Boolean);
      const pick = pickClosestOption(labels, match || want, wants, label);
      if (!pick || !pick.option) return false;
      const hit = nodes.find((n) => choiceText(n) === pick.option);
      if (!hit) return false;
      fireClick(hit);
      return true;
    };
    for (const step of steps) {
      const op = String((step && step.op) || '').trim();
      try {
        if (op === 'wait') {
          await new Promise((r) => setTimeout(r, Number(step.ms) > 0 ? Number(step.ms) : 200));
        } else if (op === 'click') {
          if (/labeled-(radio|checkbox)-\\d+/i.test(String(step.selector || ''))) {
            clickOption(want);
          } else {
            let node = null;
            if (step.selector) {
              const host = el.closest('.select, .select-shell, .form-group, .field, [class*="question"]') || el.parentElement || el;
              try { node = el.querySelector(step.selector) || host.querySelector(step.selector); } catch (_) {}
            }
            fireClick(node || el);
          }
        } else if (op === 'type') {
          focusEl(el);
          nativeSet(el, want);
        } else if (op === 'clickOption') {
          clickOption(want);
        } else if (op === 'poke') {
          continue;
        }
      } catch (_) {}
      await new Promise((r) => setTimeout(r, 60));
    }
    const got = current();
    const ok = wants.some((w) => {
      if (!got) return false;
      if (got.toLowerCase() === String(w).toLowerCase()) return true;
      const pick = pickClosestOption([got], w, wants, label);
      return Boolean(pick && pick.option);
    });
    return { ok, reason: ok ? undefined : 'unverified', strategy: 'steps', value: got };
  })()`;
}

function executeRunScript(fieldId, source, selector) {
  const payload = JSON.stringify({
    fieldId,
    source: String(source || ''),
    selector: selector || '',
  });
  return `(async () => {
    const { fieldId, source, selector } = ${payload};
    let el = document.querySelector('[data-magnet-field="' + fieldId + '"]');
    if (!el && selector) {
      try { el = document.querySelector(selector); } catch (_) {}
    }
    const current = () => {
      if (!el) return '';
      if (el.type === 'checkbox' || el.type === 'radio') return el.checked ? 'true' : 'false';
      if (el.isContentEditable) return (el.innerText || '').trim();
      return String(el.value || '').trim();
    };
    try {
      const fn = new Function('el', 'fieldId', source);
      await fn(el, fieldId);
      const got = current();
      return { ok: true, strategy: 'run', value: got };
    } catch (err) {
      return { ok: false, reason: String(err && err.message ? err.message : err), strategy: 'run', value: current() };
    }
  })()`;
}

function harvestDue(state) {
  if (!state || state.paused) return false;
  const val = String(state.value || '').trim();
  if (!val) return false;
  if (/^(select|select one|choose|choose one|pick|pick one|please select|n\/a|\.{2,})(\.\.\.)?$/i.test(val)) {
    return false;
  }
  const pre = String(state.prefill || '').trim();
  if (pre && val === pre && !state.userDirty) return false;
  return Boolean(state.userDirty || state.focused);
}

function harvestPauseScript(on) {
  return `(() => { window.__magnetHarvestPause = ${on ? 'true' : 'false'}; return true; })()`;
}

function harvestSweepScript() {
  return `(() => {
    if (typeof window.__magnetHarvestSweep === 'function') return window.__magnetHarvestSweep();
    return [];
  })()`;
}

function harvestAttachScript() {
  return `(() => {
    if (window.__magnetHarvest) return true;
    window.__magnetHarvest = true;
    const harvestDue = ${harvestDue.toString()};
    const stamp = (el) => {
      if (!el.getAttribute('data-magnet-field')) {
        el.setAttribute('data-magnet-field', 'm' + Math.random().toString(36).slice(2, 10));
      }
      return el.getAttribute('data-magnet-field');
    };
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
    const fieldOf = (node) => {
      if (!node || !node.closest) return null;
      const tagged = node.closest('[data-magnet-field]');
      if (tagged) return tagged;
      const proxy = node.closest('[data-magnet-proxy]');
      if (proxy) {
        const id = proxy.getAttribute('data-magnet-proxy');
        if (id) {
          const host = document.querySelector('[data-magnet-field="' + CSS.escape(id) + '"]');
          if (host) return host;
        }
      }
      return node.closest('input, textarea, select, [contenteditable="true"], [role="combobox"]');
    };
    const valueOf = (el) => {
      if (!el) return '';
      if (el.type === 'checkbox' || el.type === 'radio') return el.checked ? 'Yes' : 'No';
      if (el.isContentEditable) return (el.innerText || '').trim();
      if (el.tagName === 'SELECT') {
        const opt = el.options[el.selectedIndex];
        return ((opt && (opt.text || opt.value)) || el.value || '').trim();
      }
      const shell = el.closest && el.closest('.select-shell, .select__container, .select, .select__control');
      const reactInput = el.classList && (el.classList.contains('select__input') || (el.closest && el.closest('.select__control')));
      if (reactInput) {
        const multi = shell ? [...shell.querySelectorAll('.select__multi-value__label')].map((n) => String(n.innerText || '').trim()).filter(Boolean) : [];
        if (multi.length) return multi.join(', ');
        const shown = shell && shell.querySelector('.select__single-value');
        if (shown && (shown.innerText || '').trim()) return (shown.innerText || '').trim();
        return '';
      }
      const sv = shell && shell.querySelector('.select__single-value');
      if (sv && (sv.innerText || '').trim()) return (sv.innerText || '').trim();
      return String(el.value || '').trim();
    };
    const stateOf = (el) => ({
      paused: Boolean(window.__magnetHarvestPause),
      value: valueOf(el),
      prefill: (el && el.getAttribute('data-magnet-prefill')) || '',
      userDirty: el && el.getAttribute('data-magnet-dirty') === '1',
      focused: el && el.getAttribute('data-magnet-focused') === '1',
    });
    const markPrefill = (el) => {
      if (!el || el.getAttribute('data-magnet-prefill') != null) return;
      const v = valueOf(el);
      if (!String(v || '').trim()) return;
      el.setAttribute('data-magnet-prefill', v);
    };
    const payloadOf = (el) => {
      const id = stamp(el);
      const val = valueOf(el);
      const selector = el.getAttribute('data-magnet-click-sel') || cssPath(el);
      const steps = selector ? [{ op: 'click', selector }] : [];
      return { id, value: val, selector, steps };
    };
    const emitHarvest = (el, force) => {
      if (!el) return null;
      if (!harvestDue({ ...stateOf(el), focused: force ? true : stateOf(el).focused, userDirty: force ? true : stateOf(el).userDirty })) {
        return null;
      }
      if (window.__magnetHarvestPause) return null;
      el.removeAttribute('data-magnet-focused');
      const shot = payloadOf(el);
      const prev = el.getAttribute('data-magnet-user-value');
      if (prev === shot.value && !force) return null;
      el.setAttribute('data-magnet-user-value', shot.value);
      if (window.magnetAts && window.magnetAts.harvest) {
        window.magnetAts.harvest(shot);
      }
      return shot;
    };
    const timers = new WeakMap();
    const schedule = (el) => {
      if (!el || window.__magnetHarvestPause) return;
      markPrefill(el);
      el.setAttribute('data-magnet-dirty', '1');
      const old = timers.get(el);
      if (old) clearTimeout(old);
      timers.set(el, setTimeout(() => emitHarvest(el), 400));
    };
    document.addEventListener(
      'click',
      (e) => {
        if (!e.isTrusted) return;
        const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
        const el = fieldOf(e.target) || path.find((n) => n && n.getAttribute && n.getAttribute('data-magnet-field'));
        if (!el || !el.setAttribute) return;
        stamp(el);
        markPrefill(el);
        const sel = cssPath(el);
        if (sel) el.setAttribute('data-magnet-click-sel', sel);
        el.setAttribute('data-magnet-dirty', '1');
        schedule(el);
      },
      true
    );
    document.addEventListener(
      'focusin',
      (e) => {
        if (!e.isTrusted) return;
        const el = fieldOf(e.target);
        if (!el) return;
        const id = stamp(el);
        markPrefill(el);
        el.setAttribute('data-magnet-focused', '1');
        if (window.magnetAts && window.magnetAts.fieldFocus) {
          window.magnetAts.fieldFocus({ id, focused: true });
        }
      },
      true
    );
    const onEdit = (e) => {
      if (!e.isTrusted) return;
      const el = fieldOf(e.target);
      if (el) schedule(el);
    };
    document.addEventListener('change', onEdit, true);
    document.addEventListener('input', onEdit, true);
    document.addEventListener(
      'focusout',
      (e) => {
        const el = fieldOf(e.target);
        if (el) setTimeout(() => emitHarvest(el), 0);
      },
      true
    );
    const mo = new MutationObserver(() => {
      document.querySelectorAll('[data-magnet-dirty="1"]').forEach((el) => {
        const host = el.closest('.select-shell, .select__container, .select, .select__control') || el;
        const chips = host.querySelector && [...host.querySelectorAll('.select__single-value, .select__multi-value__label')];
        if (chips && chips.some((n) => String(n.innerText || '').trim())) schedule(el);
      });
    });
    try {
      mo.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
    } catch (_) {}
    window.__magnetHarvestSweep = () => {
      const out = [];
      document.querySelectorAll('[data-magnet-field]').forEach((el) => {
        if (el.getAttribute('data-magnet-dirty') !== '1') return;
        const shot = emitHarvest(el, true);
        if (shot) out.push(shot);
      });
      return out;
    };
    return true;
  })()`;
}

module.exports = {
  fillAndVerifyScript,
  readFieldScript,
  attachMirrorScript,
  flushEssayMirrorsScript,
  fieldSelectorScript,
  runStepsScript,
  executeRunScript,
  harvestAttachScript,
  harvestSweepScript,
  harvestPauseScript,
  harvestDue,
  autoScrollArmScript,
};
