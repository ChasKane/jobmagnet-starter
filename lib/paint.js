/** Injected stylesheet + paint helpers for magnet field states. */

const { pageCascadeSource } = require('./question-cascade');
const { pageClusterSource } = require('./cluster');
const { PAGE_CHROME_SEL } = require('./jd');

const PAINT_CSS = `
[data-magnet-field]:not([data-magnet-hosted]),[data-magnet-proxy]{outline:2px solid rgba(250,204,21,.85)!important;outline-offset:1px;}
[data-magnet-state="green"]{outline-color:rgba(52,211,153,.9)!important;}
[data-magnet-state="orange"]{outline-color:rgba(251,146,60,.95)!important;}
[data-magnet-state="red"]{outline-color:rgba(248,113,113,.95)!important;}
[data-magnet-state="skip"]{outline:none!important;}
[data-magnet-busy="1"]{cursor:text!important;}
textarea[data-magnet-field],[data-magnet-field][contenteditable="true"]{cursor:text!important;}
.magnet-busy-chip{position:fixed;z-index:2147483645;pointer-events:none;background:#9a3412;color:#fff7ed;font:600 12px/1.2 system-ui,sans-serif;padding:6px 10px;border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,.35);max-width:min(280px,70vw);}
.magnet-saved-chip{position:fixed;z-index:2147483644;pointer-events:none;color:#166534;font:600 11px/1.2 system-ui,sans-serif;}
.magnet-busy-chip::before{content:"";display:inline-block;width:10px;height:10px;margin-right:6px;border-radius:50%;border:2px solid #fed7aa;border-top-color:transparent;animation:magnet-spin .7s linear infinite;vertical-align:-1px;}
@keyframes magnet-spin{to{transform:rotate(360deg)}}
[data-magnet-chat-target="1"]{outline:2px solid rgba(167,139,250,.95)!important;outline-offset:2px;}
.magnet-chat-chip{position:absolute;right:4px;bottom:4px;z-index:4;pointer-events:none;background:#5b21b6;color:#f5f3ff;font:600 10px/1 system-ui,sans-serif;padding:3px 6px;border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,.35);}
`;

const FLAG_CSS = `
#magnet-flag-root{position:fixed;inset:0;z-index:2147483646;pointer-events:none;display:none;}
html.magnet-flagging #magnet-flag-root{display:block;}
.magnet-flag-bar{position:absolute;display:flex;gap:4px;pointer-events:auto;}
.magnet-flag-btn{appearance:none;margin:0;padding:3px 7px;border-radius:6px;border:1px solid #4b5568;background:#1f2937;color:#e5e7eb;font:11px/1.2 system-ui,sans-serif;cursor:pointer;}
.magnet-flag-btn:hover{background:#374151;border-color:#9ca3af;}
.magnet-flag-btn.is-on{background:#14532d;border-color:#4ade80;color:#dcfce7;}
`;

function selectOptionsSource() {
  return `
  const optionTextsFromSelect = (sel) => {
    if (!sel || sel.tagName !== 'SELECT') return [];
    return [...sel.options]
      .map((o) => String(o.text || o.value || '').trim())
      .filter((t) => t && !GENERIC_LABEL.test(t));
  };
  const looksLikeDialCountryList = (opts) => {
    const list = (opts || []).map((o) => String(o || ''));
    if (list.length < 6) return false;
    let n = 0;
    for (const o of list) {
      if (/\\+\\d{1,4}\\b/.test(o)) n += 1;
    }
    return n >= 4;
  };
  const keepFieldOptions = (el, opts) => {
    const list = [...new Set((opts || []).filter(Boolean))];
    if (list.length < 2) return [];
    if (looksLikeDialCountryList(list) && !(typeof isPhoneCountryWidget === 'function' && isPhoneCountryWidget(el))) {
      return [];
    }
    return list;
  };
  const pairedNativeSelect = (el) => {
    if (!el) return [];
    const allowIti = typeof isPhoneCountryWidget === 'function' && isPhoneCountryWidget(el);
    const fromOneSelect = (root) => {
      if (!root || !root.querySelectorAll) return [];
      const sels = [...root.querySelectorAll('select')].filter(
        (sel) => allowIti || !sel.closest('.iti, .phone-input, .phone-input__country, .iti__country-list')
      );
      if (sels.length !== 1) return [];
      return optionTextsFromSelect(sels[0]);
    };
    const block = typeof fieldBlock === 'function' ? fieldBlock(el) : null;
    if (block) {
      const hit = keepFieldOptions(el, fromOneSelect(block));
      if (hit.length >= 2) return hit.slice(0, 400);
      const lab = block.querySelector('label[for]');
      const forId = lab && lab.getAttribute('for');
      const named = forId ? document.getElementById(forId) : null;
      const fromLab = keepFieldOptions(el, optionTextsFromSelect(named));
      if (fromLab.length >= 2) return fromLab.slice(0, 400);
    }
    let box = el.parentElement;
    for (let i = 0; i < 8 && box && box !== document.body; i++) {
      const hit = keepFieldOptions(el, fromOneSelect(box));
      if (hit.length >= 2) return hit.slice(0, 400);
      box = box.parentElement;
    }
    return [];
  };
  const visibleMenuOptions = (el) => {
    const labels = [];
    const addNode = (n) => {
      if (!n) return;
      const t = clip(n.innerText || n.getAttribute('aria-label') || '');
      if (t && t.length <= 200 && !GENERIC_LABEL.test(t)) labels.push(t);
    };
    const addMenu = (menu) => {
      if (!menu) return;
      for (const n of menu.querySelectorAll('[role="option"], .select__option, .p-select-option')) addNode(n);
    };
    const ids = [el && el.getAttribute('aria-controls'), el && el.getAttribute('aria-owns')].filter(Boolean);
    for (const id of ids) addMenu(document.getElementById(id));
    if (labels.length >= 2) return [...new Set(labels)].slice(0, 80);
    const shell = el && (el.closest('.select__control, .select-shell, .select__container, p-select, .p-select') || el.parentElement);
    if (shell) {
      for (const menu of shell.querySelectorAll('[role="listbox"], .select__menu, .select__menu-list, .p-select-list')) {
        addMenu(menu);
      }
    }
    if (labels.length < 2) {
      const open = [...document.querySelectorAll('.select__menu, .select__menu-list, [role="listbox"]')].filter((n) => {
        const st = window.getComputedStyle(n);
        if (st.display === 'none' || st.visibility === 'hidden') return false;
        return n.getClientRects().length > 0;
      });
      for (const menu of open) addMenu(menu);
    }
    return keepFieldOptions(el, labels).slice(0, 80);
  };
  `;
}

function harvestSelectOptionsScript(ids, opts = {}) {
  const list = (ids || []).map((id) => String(id || '').trim()).filter(Boolean).slice(0, 40);
  const allowOpen = opts.open === true;
  return `(() => {
    const ALLOW_OPEN = ${allowOpen ? 'true' : 'false'};
    const GENERIC_LABEL = /^(select|select one|choose|choose one|pick|pick one|please select|n\\/a|\\.\\.\\.|start typing.*|type to search.*|search\\.\\.\\.|begin typing.*|attach|dropbox|google drive|or enter manually|enter manually|paste)(\\.\\.\\.)?$/i;
    const clip = (s) => String(s || '').trim().split('\\n')[0].trim().slice(0, 200);
    const fieldBlock = (el) => {
      const tight = el.closest('.field-wrapper, .text-input, .phone-input__country, .form-group, .canned-questions, .field, .control-group, .application-question, .attach-or-paste, .file-upload, p-floatlabel, .p-floatlabel, .p-field, .p-formgroup, p-select, .p-select, [data-field="cover_letter"], [class*="field-entry"], [class*="FieldEntry"], [class*="form-field"], [class*="yesno"], [role="group"]');
      if (tight) return tight;
      const loose = el.closest('fieldset, .question, [class*="question"]');
      if (!loose) return null;
      const controls = loose.querySelectorAll('input, textarea, select, [role="combobox"]');
      if (controls.length > 8) return null;
      return loose;
    };
    const isPhoneCountryWidget = (el) => {
      if (!el) return false;
      if (el.closest && el.closest('.phone-input, .phone-input__country, fieldset.phone-input, .iti')) return true;
      const key = String((el.getAttribute && (el.getAttribute('aria-label') || el.name || el.id)) || '').toLowerCase();
      return /phone country|country code|dial code/.test(key);
    };
    ${selectOptionsSource()}
    const fireOpen = (node) => {
      if (!node) return;
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
      if (typeof node.click === 'function') node.click();
    };
    const closeMenu = (el) => {
      if (!el) return;
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
    };
    const harvestOne = async (el) => {
      const role = String((el && el.getAttribute && el.getAttribute('role')) || '').toLowerCase();
      const combo = Boolean(
        el &&
          (el.tagName === 'SELECT' ||
            role === 'combobox' ||
            role === 'listbox' ||
            (el.classList && el.classList.contains('select__input')) ||
            (el.closest && el.closest('.select__control, .select-shell, p-select, .p-select')))
      );
      if (!combo) return [];
      const native = pairedNativeSelect(el);
      if (native.length >= 2) return native;
      const already = visibleMenuOptions(el);
      if (already.length >= 2) return already;
      const shell = el.closest('.select-shell, .select__container, .select, .select__control, p-select, .p-select') || el.parentElement;
      const shown = shell && shell.querySelector('.select__single-value, .p-select-label, [class*="single-value"]');
      const shownText = shown && String(shown.innerText || '').trim();
      if (shownText && !GENERIC_LABEL.test(shownText)) return [];
      if (!ALLOW_OPEN) return [];
      const control = el.closest('.select__control, .select-shell, p-select, .p-select') || el;
      const wasOpen = el.getAttribute('aria-expanded') === 'true';
      if (!wasOpen) fireOpen(control);
      const until = Date.now() + 1400;
      let opts = visibleMenuOptions(el);
      while (opts.length < 2 && Date.now() < until) {
        await new Promise((r) => setTimeout(r, 40));
        if (el.getAttribute('aria-expanded') !== 'true') fireOpen(control);
        opts = visibleMenuOptions(el);
      }
      if (!wasOpen) closeMenu(el);
      return keepFieldOptions(el, opts);
    };
    return (async () => {
      const ids = ${JSON.stringify(list)};
      const optionsById = {};
      for (const id of ids) {
        const el = document.querySelector('[data-magnet-field="' + id + '"]');
        if (!el) continue;
        try {
          const opts = await harvestOne(el);
          if (opts && opts.length >= 2) optionsById[id] = opts;
        } catch (_) {}
      }
      return { ok: true, optionsById };
    })();
  })()`;
}

const FLAG_INSTALL = `
  (function installMagnetFlags() {
    if (!document.getElementById('magnet-flag-style')) {
      const s = document.createElement('style');
      s.id = 'magnet-flag-style';
      s.textContent = ${JSON.stringify(FLAG_CSS)};
      document.documentElement.appendChild(s);
    }
    let root = document.getElementById('magnet-flag-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'magnet-flag-root';
      document.documentElement.appendChild(root);
    }
    const FLAGS = [
      ['wrong_value', 'Wrong value'],
      ['filled_but_not_touched', "ATS didn't notice"],
      ['couldnt_add_row', "Couldn't add row"],
    ];
    const place = () => {
      root.innerHTML = '';
      if (!document.documentElement.classList.contains('magnet-flagging')) return;
      for (const el of document.querySelectorAll('[data-magnet-field]')) {
        let r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > innerHeight) {
          const id = el.getAttribute('data-magnet-field');
          const host = document.querySelector('[data-magnet-proxy="'+id+'"]') || el.closest('.form-group, .canned-questions, [class*="question"]');
          if (!host) continue;
          r = host.getBoundingClientRect();
          if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > innerHeight) continue;
        }
        const bar = document.createElement('div');
        bar.className = 'magnet-flag-bar';
        bar.style.top = Math.max(4, r.top - 28) + 'px';
        bar.style.left = Math.max(4, r.left) + 'px';
        const id = el.getAttribute('data-magnet-field');
        for (const [flag, label] of FLAGS) {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'magnet-flag-btn' + (el.getAttribute('data-magnet-flag-' + flag) === '1' ? ' is-on' : '');
          b.textContent = label;
          b.title = label;
          b.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            b.classList.add('is-on');
            el.setAttribute('data-magnet-flag-' + flag, '1');
            if (window.magnetAts) window.magnetAts.debugFlag(id, flag);
          });
          bar.appendChild(b);
        }
        root.appendChild(bar);
      }
    };
    window.__magnetSetFlagging = (on) => {
      document.documentElement.classList.toggle('magnet-flagging', !!on);
      place();
    };
    if (!window.__magnetFlagsBound) {
      window.__magnetFlagsBound = true;
      window.addEventListener('scroll', place, true);
      window.addEventListener('resize', place);
    }
  })();
`;

function paintHostSource() {
  return `
  const MAGNET_HOST_SEL = '.field-wrapper, .form-group, .canned-questions, .field, .control-group, .application-question, .attach-or-paste, .file-upload, [data-field="cover_letter"], [class*="field-entry"], [class*="FieldEntry"], [class*="form-field"], [class*="yesno"], [class*="question"], fieldset, [role="group"]';
  const MAGNET_TIGHT_SEL = '.text-input, .phone-input__country, p-floatlabel, .p-floatlabel, .p-field, .p-formgroup, p-select, .p-select, .select-shell, .select__control, .select__container, .select';
  const magnetForeignControls = (box, el) => {
    if (!box || !box.querySelectorAll) return [];
    const nodes = [...box.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="file"]), textarea, select, [role="combobox"]')];
    return nodes.filter((n) => {
      if (n === el) return false;
      if (el.contains && (el.contains(n) || n.contains(el))) return false;
      const en = String(el.name || '');
      if (en && n.name === en) return false;
      const id = el.getAttribute && el.getAttribute('data-magnet-field');
      if (id && n.getAttribute && n.getAttribute('data-magnet-field') === id) return false;
      return true;
    });
  };
  const magnetHasQuestion = (box, el) => {
    if (!box) return false;
    if (el.id) {
      try {
        const lab = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
        if (lab && box.contains(lab) && lab !== box) return true;
      } catch (_) {}
    }
    const wrap = el.closest && el.closest('label');
    if (wrap && box.contains(wrap) && wrap !== el) return true;
    if (box.querySelector && box.querySelector('legend') && magnetForeignControls(box, el).length <= 1) return true;
    const kids = box.children ? [...box.children] : [];
    for (const kid of kids) {
      if (kid.contains && kid.contains(el)) continue;
      if (kid.querySelector && kid.querySelector('input, textarea, select, [role="combobox"]')) continue;
      const t = String(kid.innerText || '').trim().split('\\n')[0].trim();
      if (t.length >= 4 && t.length < 280) return true;
    }
    return false;
  };
  const paintHostOf = (el) => {
    if (!el) return null;
    const id = el.getAttribute && el.getAttribute('data-magnet-field');
    if (id) {
      try {
        const tagged = document.querySelector('[data-magnet-proxy="' + CSS.escape(id) + '"]');
        if (tagged) return tagged;
      } catch (_) {}
    }
    let host = el.closest && el.closest(MAGNET_HOST_SEL);
    while (host && magnetForeignControls(host, el).length > 1) {
      const kids = [...host.querySelectorAll(MAGNET_HOST_SEL)].filter(
        (n) => n !== host && n.contains(el) && magnetForeignControls(n, el).length <= 1
      );
      if (kids.length) {
        host = kids.sort((a, b) => (a.contains(b) ? 1 : b.contains(a) ? -1 : 0))[0];
        break;
      }
      const tight = el.closest && el.closest(MAGNET_TIGHT_SEL);
      host = tight && host.contains(tight) && magnetForeignControls(tight, el).length <= 1 ? tight : null;
      break;
    }
    if (host && host.matches && host.matches(MAGNET_TIGHT_SEL) && !magnetHasQuestion(host, el)) {
      const outer = host.closest(MAGNET_HOST_SEL);
      if (outer && outer !== host && magnetForeignControls(outer, el).length <= 1) host = outer;
    }
    if (host && !magnetHasQuestion(host, el)) {
      let n = host;
      for (let i = 0; i < 5 && n && n.parentElement; i++) {
        const p = n.parentElement;
        if (/^(FORM|MAIN|BODY|HTML|HEADER|NAV)$/i.test(p.tagName)) break;
        if (magnetForeignControls(p, el).length > 1) break;
        n = p;
        if (magnetHasQuestion(n, el)) {
          host = n;
          break;
        }
      }
    }
    if (!host) {
      const tight = el.closest && el.closest(MAGNET_TIGHT_SEL);
      const parent = (tight && tight.parentElement) || el.parentElement;
      host = parent && magnetHasQuestion(parent, el) && magnetForeignControls(parent, el).length <= 1
        ? parent
        : (tight || parent || el);
    }
    if (host && /^(FORM|MAIN|BODY|HTML)$/i.test(host.tagName)) host = el.parentElement || el;
    if (host && magnetForeignControls(host, el).length > 1) {
      const tight = el.closest && el.closest(MAGNET_TIGHT_SEL);
      host = tight || el;
    }
    return host || el;
  };
  const stampPaintHost = (el, id, state) => {
    const host = paintHostOf(el);
    if (!host) return el;
    if (host !== el) {
      el.setAttribute('data-magnet-hosted', '1');
      host.setAttribute('data-magnet-proxy', id);
      if (state) host.setAttribute('data-magnet-state', state);
    } else {
      el.removeAttribute('data-magnet-hosted');
    }
    return host;
  };
  `;
}

const INVENTORY_SCRIPT = `(() => {
    ${pageCascadeSource()}
    ${pageClusterSource()}
    ${paintHostSource()}
  const hidden = (el) => {
    if (!el || el.disabled) return true;
    if (el.classList.contains('iti__search-input') || el.closest('.iti__dropdown-content, .iti__country-list')) return true;
    if (el.tagName === 'SELECT' && el.closest('.iti, .phone-input')) {
      const wrap = el.closest('.iti, .phone-input');
      const vis = wrap && wrap.querySelector('[role="combobox"], .iti__selected-flag, .phone-input__country');
      if (vis && vis !== el) return true;
    }
    const type = (el.getAttribute('type') || '').toLowerCase();
    const role = (el.getAttribute('role') || '').toLowerCase();
    const st = window.getComputedStyle(el);
    const isChoice =
      type === 'radio' ||
      type === 'checkbox' ||
      el.tagName === 'SELECT' ||
      role === 'radio' ||
      role === 'checkbox' ||
      role === 'combobox' ||
      role === 'listbox';
    if (isChoice) {
      if (st.display === 'none' || st.visibility === 'hidden') {
        if (el.tagName === 'SELECT' && el.closest('.form-group, fieldset, .canned-questions, [class*="question"]')) {
          const block = el.closest('.form-group, fieldset, .canned-questions, [class*="question"], .select-shell, p-select, .p-select, .select__control');
          const custom = block && block.querySelector('[role="combobox"], .select__input, .select__control, .p-select');
          if (custom && custom !== el) return true;
          return false;
        }
        const lab =
          (el.id && document.querySelector('label[for="'+CSS.escape(el.id)+'"]')) ||
          (el.name && document.querySelector('label[for="'+CSS.escape(el.name)+'"]')) ||
          el.closest('label');
        const yesno = el.closest('[class*="yesno"], [class*="YesNo"]');
        const optionBtns = el.parentElement && [...el.parentElement.querySelectorAll('button')].filter((b) => /^(yes|no)$/i.test((b.innerText || '').trim()));
        if (lab || yesno || (optionBtns && optionBtns.length >= 2)) return false;
        return true;
      }
      return false;
    }
    if (el.closest && el.closest('.select__control, .select__value-container, .select-shell, p-select, .p-select')) return false;
    if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') return true;
    const r = el.getBoundingClientRect();
    return r.width < 2 && r.height < 2;
  };
  const clip = (s) => String(s || '').trim().split('\\n')[0].trim().slice(0, 200);
  const optionLabel = (el) => {
    const id = el.id && document.querySelector('label[for="'+CSS.escape(el.id)+'"]');
    if (id) return clip(id.innerText);
    const wrap = el.closest('label');
    if (wrap) return clip(wrap.innerText);
    return String(el.value || '').trim();
  };
  const AUTOCOMPLETE_LABEL = {
    'given-name': 'First Name',
    'family-name': 'Last Name',
    email: 'Email',
    tel: 'Phone',
    url: 'Website',
    organization: 'Company',
    'street-address': 'Street',
    'address-line1': 'Address line 1',
    'address-line2': 'Address line 2',
    'address-level2': 'City',
    'address-level1': 'State',
    'postal-code': 'Zip',
    country: 'Country',
    'country-name': 'Country',
    'cntry-name': 'Country',
  };
  const TOKEN_LABELS = [
    [/\\bfirst[_-]?name\\b/i, 'First Name'],
    [/\\blast[_-]?name\\b/i, 'Last Name'],
    [/systemfield_name/i, 'Full Name'],
    [/\\bfull[_-]?name\\b/i, 'Full Name'],
    [/\\bemail\\b/i, 'Email'],
    [/\\blinkedin\\b/i, 'LinkedIn Profile'],
    [/\\bgithub\\b/i, 'GitHub'],
    [/\\b(website|portfolio)\\b/i, 'Website'],
    [/\\bcandidate[-_]?location\\b/i, 'Location (City)'],
    [/\\bcountry[_-]?code\\b/i, 'Country code'],
    [/\\bcountry\\b/i, 'Country'],
    [/\\bphone\\b/i, 'Phone'],
    [/\\bcover[_-]?letter\\b/i, 'Cover Letter'],
  ];
  const isCombo = (el) => {
    const role = (el.getAttribute('role') || '').toLowerCase();
    return (
      role === 'combobox' ||
      role === 'listbox' ||
      el.tagName === 'SELECT' ||
      el.classList.contains('select__input') ||
      !!el.closest('.select__control, .select-shell')
    );
  };
  const isPhoneCountryWidget = (el) => {
    if (!isCombo(el)) return false;
    if (el.closest('.phone-input, .phone-input__country, fieldset.phone-input, .iti')) return true;
    const tels = [...document.querySelectorAll('input[type="tel"], input#phone')];
    if (!tels.length) return false;
    const cr = el.getBoundingClientRect();
    if (cr.width < 2 && cr.height < 2) return false;
    return tels.some((tel) => {
      const tr = tel.getBoundingClientRect();
      if (tr.width < 2) return false;
      const sameRow = Math.abs((cr.top + cr.bottom) / 2 - (tr.top + tr.bottom) / 2) < 32;
      const leftOf = cr.left < tr.left && cr.right <= tr.left + 16;
      return sameRow && leftOf;
    });
  };
  const GENERIC_LABEL = /^(select|select one|choose|choose one|pick|pick one|please select|n\\/a|\\.\\.\\.|start typing.*|type to search.*|search\\.\\.\\.|begin typing.*|attach|dropbox|google drive|or enter manually|enter manually|paste)(\\.\\.\\.)?$/i;
  const isChoiceEl = (el) => {
    const type = (el.getAttribute('type') || '').toLowerCase();
    const role = (el.getAttribute('role') || '').toLowerCase();
    return type === 'radio' || type === 'checkbox' || role === 'radio' || role === 'checkbox';
  };
  const ashbyForm = document.querySelector('.ashby-application-form-container, .ashby-survey-form-container');
  const ashbyEntryOf = (el) =>
    el &&
    el.closest &&
    el.closest(
      '.ashby-application-form-field-entry, .ashby-application-form-input-radio-group, .ashby-application-form-input-checkbox-group, [class*="_fieldEntry_"]'
    );
  const ashbyTitleOf = (el) => {
    const entry = ashbyEntryOf(el);
    if (!entry) return '';
    const t = entry.querySelector('.ashby-application-form-question-title, legend');
    return clip(t && t.innerText);
  };
  const ashbyPrimaryOf = (entry) => {
    if (!entry) return null;
    return (
      entry.querySelector('[role="combobox"], .ashby-application-form-input-autocomplete') ||
      entry.querySelector(
        'input[type="text"], input[type="email"], input[type="tel"], textarea, input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="submit"]):not([type="button"])'
      ) ||
      entry.querySelector('.ashby-application-form-input-yesno input[type="checkbox"]') ||
      entry.querySelector('input[type="radio"]') ||
      entry.querySelector('input[type="checkbox"]')
    );
  };
  const fieldBlock = (el) => {
    const tight = el.closest('.field-wrapper, .text-input, .phone-input__country, .form-group, .canned-questions, .field, .control-group, .application-question, .attach-or-paste, .file-upload, p-floatlabel, .p-floatlabel, .p-field, .p-formgroup, p-select, .p-select, [data-field="cover_letter"], [class*="field-entry"], [class*="FieldEntry"], [class*="form-field"], [class*="yesno"], [role="group"]');
    if (tight) return tight;
    const loose = el.closest('fieldset, .question, [class*="question"]');
    if (!loose) return null;
    const controls = loose.querySelectorAll('input, textarea, select, [role="combobox"]');
    if (controls.length > 8) return null;
    return loose;
  };
  ${selectOptionsSource()}
  const ownText = (node) => {
    if (!node) return '';
    const own = [...node.childNodes]
      .filter((c) => c.nodeType === 3)
      .map((c) => String(c.textContent || '').trim())
      .filter(Boolean)
      .join(' ');
    if (own) return clipLine(own);
    if (!node.childElementCount) return clipLine(node.innerText);
    return '';
  };
  const questionFromNode = (node) => {
    if (!node) return '';
    const aria = clip(node.getAttribute && node.getAttribute('aria-label'));
    if (aria && isQuestionLike(aria) && !isSectionChrome(aria)) return aria;
    const labelled = node.getAttribute && node.getAttribute('aria-labelledby');
    if (labelled) {
      const t = labelled.split(/\\s+/).map((id) => {
        const hit = document.getElementById(id);
        return hit ? clip(hit.innerText) : '';
      }).filter(Boolean).join(' ');
      if (t && isQuestionLike(t) && !isSectionChrome(t)) return clip(t);
    }
    const lines = String(node.innerText || '')
      .split('\\n')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const line of lines.slice(0, 8)) {
      const t = clip(line);
      if (t.length < 8 || t.length > 240) continue;
      if (GENERIC_LABEL.test(t) || isInstructionLabel(t) || isSectionChrome(t)) continue;
      if (isQuestionLike(t)) return t;
    }
    return '';
  };
  const clusterOf = (el) => {
    const name = String(el.name || '');
    const type = (el.getAttribute('type') || '').toLowerCase();
    const role = (el.getAttribute('role') || '').toLowerCase();
    const radio = type === 'radio' || role === 'radio';
    const check = type === 'checkbox' || role === 'checkbox';
    if (name && (radio || check)) {
      const sel = (el.tagName || 'input').toLowerCase() + '[name="' + CSS.escape(name) + '"]';
      if (name.endsWith('[]') || document.querySelectorAll(sel).length >= 2) return 'n:' + name;
    }
    if (!radio && !check) return 'id:' + (el.id || el.getAttribute('data-magnet-field') || '');
    const kind = radio ? 'input[type="radio"], [role="radio"]' : 'input[type="checkbox"], [role="checkbox"]';
    let box = el.parentElement;
    for (let i = 0; i < 10 && box && box !== document.body; i++) {
      const n = box.querySelectorAll(kind).length;
      if (n >= 2 && n <= 80) {
        return 'b:' + String(box.getAttribute('aria-labelledby') || box.id || box.className || '').slice(0, 60);
      }
      box = box.parentElement;
    }
    return 'id:' + (el.id || el.getAttribute('data-magnet-field') || '');
  };
  const pickPrimaryEl = (els) => {
    const score = (n) => {
      const type = (n.getAttribute('type') || '').toLowerCase();
      const role = (n.getAttribute('role') || '').toLowerCase();
      const tag = n.tagName.toLowerCase();
      if (n.classList.contains('select__input') || role === 'combobox' || role === 'listbox' || tag === 'select') return 50;
      if (tag === 'textarea' || n.isContentEditable) return 40;
      if (tag === 'input' && type !== 'radio' && type !== 'checkbox') return 30;
      if (type === 'radio' || role === 'radio') return 10;
      if (type === 'checkbox' || role === 'checkbox') return 8;
      return 1;
    };
    return els.slice().sort((a, b) => score(b) - score(a))[0];
  };
  const pathSkeleton = (el) => {
    const parts = [];
    let n = el;
    for (let i = 0; i < 6 && n && n.nodeType === 1 && n !== document.documentElement; i++) {
      const tag = n.tagName.toLowerCase();
      const role = (n.getAttribute('role') || '').toLowerCase();
      const cls = [...n.classList].filter((c) => !/^m[a-z0-9]{4,}$/.test(c) && !/magnet/.test(c)).slice(0, 2).join('.');
      parts.unshift(tag + (role ? '[role=' + role + ']' : '') + (cls ? '.' + cls : ''));
      n = n.parentElement;
    }
    return parts.join('>');
  };
  const clipMemo = new WeakMap();
  const clipHtml = (node, max) => {
    if (!node || node.nodeType !== 1) return '';
    const cap = max || 24000;
    const prior = clipMemo.get(node);
    if (prior && prior.cap >= cap) return prior.html.slice(0, cap);
    const skip = { SCRIPT: 1, STYLE: 1, IFRAME: 1, SVG: 1, NOSCRIPT: 1 };
    let out = '';
    const walk = (n) => {
      if (!n || n.nodeType !== 1 || out.length >= cap || skip[n.tagName]) return;
      const tag = n.tagName.toLowerCase();
      let open = '<' + tag;
      const attrs = n.attributes;
      if (attrs) {
        for (let i = 0; i < attrs.length && out.length + open.length < cap; i++) {
          const attr = attrs[i];
          if (!attr || attr.name === 'style') continue;
          open += ' ' + attr.name + '="' + String(attr.value || '').replace(/"/g, '&quot;').slice(0, 180) + '"';
        }
      }
      open += '>';
      out += open;
      if (out.length >= cap) return;
      for (const child of n.childNodes) {
        if (out.length >= cap) break;
        if (child.nodeType === 3) {
          const text = child.nodeValue || '';
          out += text.length > cap - out.length ? text.slice(0, cap - out.length) : text;
        } else if (child.nodeType === 1) walk(child);
      }
      if (out.length < cap) out += '</' + tag + '>';
    };
    walk(node);
    const html = out.length > cap ? out.slice(0, cap) : out;
    clipMemo.set(node, { cap, html });
    return html;
  };
  const hostOf = (el) => paintHostOf(el) || fieldBlock(el) || el.parentElement || el;
  const clusterHostOf = (host) => {
    let n = host;
    for (let i = 0; i < 3 && n && n.parentElement && n.parentElement !== document.body && n.parentElement !== document.documentElement; i++) {
      n = n.parentElement;
    }
    return n || host;
  };
  const shapeOf = (el, options, familyHint) => {
    const role = (el.getAttribute('role') || '').toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    const reactSelect = !!(el.classList.contains('select__input') || el.closest('.select__control, .select-shell'));
    let family = familyHint || 'text';
    if (reactSelect) family = 'react_select';
    else if (el.tagName === 'SELECT') family = 'native_select';
    else if (role === 'combobox' || role === 'listbox' || type === 'combobox') family = 'combobox';
    else if (type === 'checkbox' || type === 'radio' || role === 'radio' || role === 'checkbox') family = 'choice_group';
    const open = (family === 'react_select' || family === 'combobox') && !(options || []).length ? 'click-typeahead' : 'visible';
    const attrs = [el.getAttribute('name'), el.getAttribute('data-field'), el.getAttribute('aria-label')]
      .map((s) => String(s || '').trim().toLowerCase())
      .filter(Boolean);
    return {
      family,
      open,
      optionCount: (options || []).length,
      optionHash: optionHash(options),
      bits: bitsForFamily(family, open),
      path: pathSkeleton(el),
      attrs,
    };
  };
  const pageRoot =
    ashbyForm ||
    document.querySelector(
      '#application_form, #application, .application--form, #main_fields, form, .application-form, main, [role="main"]'
    ) ||
    document.body;
  const cascadeByEl = (() => {
    const root = pageRoot;
    const elements = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let node = walker.currentNode;
    while (node) {
      elements.push(node);
      node = walker.nextNode();
    }
    const broadCount = new Map();
    const boxedCount = new Map();
    const bump = (map, el) => {
      let p = el;
      while (p) {
        map.set(p, (map.get(p) || 0) + 1);
        if (p === root) break;
        p = p.parentElement;
      }
    };
    for (const el of elements) {
      const tag = (el.tagName || '').toLowerCase();
      const type = (el.getAttribute('type') || '').toLowerCase();
      const role = (el.getAttribute('role') || '').toLowerCase();
      const broad =
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        role === 'radio' ||
        role === 'checkbox' ||
        role === 'combobox';
      const boxed =
        tag === 'textarea' ||
        tag === 'select' ||
        role === 'combobox' ||
        (tag === 'input' && type !== 'hidden' && type !== 'submit' && type !== 'button' && type !== 'file');
      if (broad) bump(broadCount, el);
      if (boxed) bump(boxedCount, el);
    }
    const events = [];
    let idx = 0;
    for (const el of elements) {
      const type = (el.getAttribute('type') || '').toLowerCase();
      const role = (el.getAttribute('role') || '').toLowerCase();
      const tag = (el.tagName || '').toLowerCase();
      const isControl =
        (tag === 'input' || tag === 'textarea' || tag === 'select' || role === 'radio' || role === 'checkbox' || role === 'combobox' || role === 'listbox') &&
        type !== 'hidden' &&
        type !== 'file' &&
        type !== 'submit' &&
        type !== 'button';
      if (isControl) {
        events.push({ kind: 'control', id: 'c' + idx, cluster: clusterOf(el), el });
        idx += 1;
        continue;
      }
      if (broadCount.get(el)) {
        const boxed = boxedCount.get(el) || 0;
        if (boxed >= 1 && boxed <= 2) {
          const qt = questionFromNode(el);
          if (qt) events.push({ kind: 'question', text: qt });
        }
        continue;
      }
      node = el;
      if (!/^(H1|H2|H3|H4|H5|LEGEND|LABEL|P|DIV|SPAN|STRONG|DT)$/.test(node.tagName)) {
        continue;
      }
      const labelled = node.getAttribute && node.getAttribute('aria-labelledby');
      if (labelled) {
        const ariaT = labelled.split(/\\s+/).map((id) => {
          const hit = document.getElementById(id);
          return hit ? clipLine(hit.innerText) : '';
        }).filter(Boolean).join(' ');
        if (ariaT && (isQuestionLike(ariaT) || (!isInstructionLabel(ariaT) && !isSectionChrome(ariaT) && ariaT.length >= 4))) {
          events.push({ kind: 'question', text: ariaT });
        }
      }
      const t = ownText(node) || (/^(H1|H2|H3|H4|H5|LEGEND|P|LABEL)$/.test(node.tagName) ? clipLine(node.innerText) : '');
      const forAttr = node.tagName === 'LABEL' && (node.getAttribute('for') || node.htmlFor);
      const headingTag = /^(H1|H2|H3|H4|H5)$/.test(node.tagName);
      if (isInstructionLabel(t)) events.push({ kind: 'instruction', text: t });
      else if (
        (headingTag ? isHeadingQuestion(t) : isQuestionLike(t)) ||
        (node.tagName === 'LEGEND' && t && !isSectionChrome(t) && !isInstructionLabel(t)) ||
        (forAttr && t && t.length >= 4 && !isSectionChrome(t) && !isInstructionLabel(t))
      ) events.push({ kind: 'question', text: t });
    }
    const paired = pairCascade(events);
    const map = new WeakMap();
    for (const ev of events) {
      if (ev.kind === 'control' && paired[ev.id] && ev.el) map.set(ev.el, paired[ev.id]);
    }
    return map;
  })();
  const cascadeQuestion = (el) => (el && cascadeByEl.get(el)) || '';
  const headingNear = (el) => {
    const block = fieldBlock(el);
    const hosts = [];
    if (block) {
      hosts.push(block);
      if (block.parentElement) hosts.push(block.parentElement);
    } else if (el.parentElement) hosts.push(el.parentElement);
    const group = el.closest('[role="group"], fieldset, [data-field="cover_letter"], .attach-or-paste');
    if (group && !hosts.includes(group)) hosts.unshift(group);
    const er = el.getBoundingClientRect();
    for (const host of hosts) {
      const controls = host.querySelectorAll('input:not([type="hidden"]), textarea, select, [role="combobox"]');
      const choiceCount = host.querySelectorAll('input[type="checkbox"], input[type="radio"], [role="radio"], [role="checkbox"]').length;
      if (isChoiceEl(el)) {
        const texty = [...controls].filter((n) => !/^(checkbox|radio)$/i.test(n.type || '')).length;
        if (texty > 6 && choiceCount < 2) continue;
      } else if (controls.length > 8) {
        continue;
      }
      const hostAria = clip(host.getAttribute && host.getAttribute('aria-label'));
      if (hostAria.length >= 2 && !GENERIC_LABEL.test(hostAria) && !isInstructionLabel(hostAria) && !isSectionChrome(hostAria)) return hostAria;
      if (magnetForeignControls(host, el).length <= 1) {
        const wrapQ = questionFromNode(host);
        if (wrapQ) return wrapQ;
      }
      const nodes = [...host.querySelectorAll('legend, h1, h2, h3, h4, label, p, [class*="label"], [class*="title"], [class*="heading"]')];
      for (const n of nodes) {
        if (n.contains(el) || (el.id && n.getAttribute('for') === el.id)) {
          if (magnetForeignControls(n, el).length <= 1) {
            const qt = questionFromNode(n);
            if (qt) return qt;
          }
          continue;
        }
        const t = clip(n.innerText);
        if (t.length < 2 || t.length > 240 || GENERIC_LABEL.test(t) || isInstructionLabel(t) || isSectionChrome(t)) continue;
        const nr = n.getBoundingClientRect();
        if (nr.bottom > er.top + 12 && !n.contains(el)) continue;
        return t;
      }
      let sib = host.previousElementSibling;
      for (let i = 0; i < 3 && sib; i++) {
        if (sib.querySelector && sib.querySelector('input, textarea, select')) {
          sib = sib.previousElementSibling;
          continue;
        }
        const t = clip(sib.innerText);
        if (t.length >= 4 && t.length < 240 && !GENERIC_LABEL.test(t) && !isInstructionLabel(t) && !isSectionChrome(t)) return t;
        sib = sib.previousElementSibling;
      }
    }
    return '';
  };
  const nameHint = (el) => {
    const m = String(el.name || '').match(/\\[([a-z_]+)\\]/i);
    return m ? m[1].replace(/_/g, ' ') : '';
  };
  const labelFor = (el) => {
    const candidates = [];
    const choice = isChoiceEl(el);
    const ashbyTitle = ashbyTitleOf(el);
    if (ashbyTitle) candidates.push({ text: ashbyTitle, score: 120 });
    const push = (text, score) => {
      const t = clip(text);
      if (t.length < 2) return;
      if (/^(attach|dropbox|google drive|or enter manually|enter manually|paste)$/i.test(t)) return;
      if (GENERIC_LABEL.test(t) || isInstructionLabel(t) || isSectionChrome(t)) score = Math.min(score, 4);
      candidates.push({ text: t, score });
    };
    const cascade = cascadeQuestion(el);
    if (cascade) push(cascade, choice ? 128 : 74);
    const heading = headingNear(el);
    if (heading) push(heading, choice ? 96 : 70);
    const prime = el.closest('p-select, .p-select');
    if (prime && prime.parentElement) {
      const parentLab = prime.parentElement.querySelector('label, legend, .p-floatlabel-label');
      if (parentLab) push(parentLab.innerText, 90);
      else push(prime.parentElement.innerText, 90);
    }
    const ac = (el.getAttribute('autocomplete') || '').toLowerCase();
    if (AUTOCOMPLETE_LABEL[ac]) push(AUTOCOMPLETE_LABEL[ac], 100);
    const tokens = [el.id, el.name].filter(Boolean).join(' ');
    for (const [re, lab] of TOKEN_LABELS) {
      if (tokens && re.test(tokens)) {
        push(lab, 92);
        break;
      }
    }
    if (el.id) {
      const lab = document.querySelector('label[for="'+CSS.escape(el.id)+'"]');
      if (lab) push(lab.innerText, choice ? 18 : 88);
    }
    const aria = el.getAttribute('aria-label');
    if (aria) push(aria, choice ? 20 : 84);
    const by = el.getAttribute('aria-labelledby');
    if (by) {
      const t = by.split(/\\s+/).map((id) => document.getElementById(id)).filter(Boolean).map((n) => (n.innerText || '').trim()).join(' ').trim();
      if (t) push(t, choice ? 22 : 80);
    }
    const wrap = el.closest('label');
    if (wrap && magnetForeignControls(wrap, el).length <= 1) {
      const qt = questionFromNode(wrap);
      push(qt || wrap.innerText, choice ? 16 : 88);
    }
    const blockQ = fieldBlock(el);
    if (blockQ && magnetForeignControls(blockQ, el).length <= 1) {
      const hostQ = questionFromNode(blockQ);
      if (hostQ) push(hostQ, 84);
    }
    const hint = nameHint(el);
    if (hint) push(hint, 60);
    const block = fieldBlock(el);
    if (block) {
      const lab = block.querySelector('legend, label, .label');
      if (lab) {
        const forId = lab.getAttribute('for');
        const optionLab = el.id && forId === el.id;
        if (!optionLab) push(lab.innerText, 55);
      }
    }
    const fs = el.closest('fieldset');
    if (fs) {
      const leg = fs.querySelector('legend');
      if (leg && clip(leg.innerText)) push(leg.innerText, 50);
    }
    if (isCombo(el) && GENERIC_LABEL.test(el.getAttribute('placeholder') || '')) {
      push('Location (City)', 40);
    }
    const ph = el.getAttribute('placeholder');
    if (ph) push(ph, 8);
    if (!candidates.length) return optionLabel(el);
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0].text;
  };
  const questionMarker = (box, input) => {
    if (!box || !box.getAttribute) return '';
    const labelled = box.getAttribute('aria-labelledby');
    if (labelled) {
      const t = labelled.split(/\\s+/).map((id) => {
        const node = document.getElementById(id);
        return node ? clip(node.innerText) : '';
      }).filter(Boolean).join(' ');
      if (t.length >= 4 && !GENERIC_LABEL.test(t) && !isInstructionLabel(t)) return t;
    }
    const kids = box.children ? [...box.children] : [];
    for (const kid of kids) {
      if (kid.querySelector && kid.querySelector('input, select, textarea, [role="combobox"]')) continue;
      if (!/^(LEGEND|LABEL|P|H1|H2|H3|H4|SPAN|DIV)$/.test(kid.tagName)) continue;
      const t = clip(kid.innerText);
      if (t.length >= 8 && t.length < 240 && !GENERIC_LABEL.test(t) && !isInstructionLabel(t)) return t;
    }
    const prev = box.previousElementSibling;
    if (prev && !(prev.querySelector && prev.querySelector('input, select, textarea, [role="combobox"]'))) {
      const t = clip(prev.innerText);
      if (t.length >= 8 && t.length < 240 && !GENERIC_LABEL.test(t) && !isInstructionLabel(t)) return t;
    }
    const head = headingNear(input);
    if (head && head.length >= 8) {
      const hit = kids.some((kid) => {
        const t = clip(kid.innerText);
        return t === clip(head) || (t.length >= 8 && clip(head).startsWith(t.slice(0, 24)));
      });
      if (hit) return head;
    }
    return '';
  };
  const choiceListKey = (el, kindSel, prefix) => {
    let box = el.parentElement;
    let fallback = '';
    for (let i = 0; i < 12 && box && box !== document.body; i++) {
      const n = box.querySelectorAll(kindSel).length;
      if (n < 1 || n > 80) {
        box = box.parentElement;
        continue;
      }
      const marker = questionMarker(box, el);
      if (n === 1 && !marker) {
        box = box.parentElement;
        continue;
      }
      const key = prefix + (marker || clip(box.getAttribute('aria-labelledby') || box.id || box.className).slice(0, 40) || 'list').slice(0, 80);
      if (n >= 2 && n <= 80 && !fallback) fallback = key;
      if (marker && n >= 1 && n <= 80) return prefix + marker.slice(0, 80);
      box = box.parentElement;
    }
    return fallback;
  };
  const choiceGroupKey = (el, i) => {
    const type = (el.getAttribute('type') || '').toLowerCase();
    const role = (el.getAttribute('role') || '').toLowerCase();
    const name = String(el.name || '');
    const labelled = el.getAttribute('aria-labelledby') || '';
    const radio = type === 'radio' || role === 'radio';
    const check = type === 'checkbox' || role === 'checkbox';
    if (!radio && !check) return '';
    const cascade = cascadeQuestion(el);
    if (cascade) return (radio ? 'radio:q:' : 'check:q:') + cascade.slice(0, 80);
    const kindSel = radio ? 'input[type="radio"], [role="radio"]' : 'input[type="checkbox"], [role="checkbox"]';
    const listKey = choiceListKey(el, kindSel, radio ? 'radio:list:' : 'check:list:');
    if (listKey) return listKey;
    if (radio) {
      const g = name || labelled || el.id || String(i);
      const prefix = String(g).split('_')[0];
      return prefix.length >= 8 ? 'radio:' + prefix : 'radio:' + g;
    }
    if (name && (name.endsWith('[]') || document.querySelectorAll('input[name="'+CSS.escape(name)+'"]').length >= 2)) {
      return 'check:' + name;
    }
    if (labelled) return 'check:lab:' + labelled;
    const heading = headingNear(el);
    if (heading && heading.length >= 12) return 'check:q:' + heading.slice(0, 80);
    return '';
  };
  const nodes = [...document.querySelectorAll('input, textarea, select, [contenteditable="true"], [role="radio"], [role="checkbox"], [role="combobox"], [role="listbox"]')];
  const fields = [];
  const seenShells = new Set();
  const ashbySeen = new Set();
  const candidates = [];
  nodes.forEach((el, i) => {
    if (hidden(el)) return;
    const type = (el.getAttribute('type') || el.tagName).toLowerCase();
    const role = (el.getAttribute('role') || '').toLowerCase();
    if (el.classList.contains('g-recaptcha-response')) return;
    if (el.closest(${JSON.stringify(PAGE_CHROME_SEL)})) return;
    if (el.closest('.ashby-application-form-autofill-pane, .grecaptcha-badge, .g-recaptcha')) return;
    if (/window\\.__|ddRumApplicationId|__appData/.test(String(el.value || el.innerText || el.getAttribute('aria-label') || ''))) return;
    if (ashbyForm && !ashbyForm.contains(el) && !el.closest('.ashby-survey-form-container')) return;
    if (type === 'file' || type === 'hidden' || type === 'submit' || type === 'button') return;
    const ashbyEntry = ashbyEntryOf(el);
    if (ashbyEntry) {
      const primary = ashbyPrimaryOf(ashbyEntry);
      if (primary && primary !== el) return;
      if (ashbySeen.has(ashbyEntry)) return;
      ashbySeen.add(ashbyEntry);
    }
    const comboShell = el.closest('.select-shell, .select__container, .select__control, p-select, .p-select');
    if (comboShell && (el.tagName === 'SELECT' || isCombo(el))) {
      if (seenShells.has(comboShell)) return;
      const primary = comboShell.querySelector('[role="combobox"], .select__input');
      if (primary && primary !== el && el.tagName === 'SELECT') return;
      seenShells.add(comboShell);
    }
    const id = el.getAttribute('data-magnet-field') || ('m' + Math.random().toString(36).slice(2, 8) + i);
    el.setAttribute('data-magnet-field', id);
    if (!el.getAttribute('data-magnet-state')) el.setAttribute('data-magnet-state', 'yellow');
    candidates.push({ el, i });
  });
  const grouped = new Map();
  for (const row of candidates) {
    const key = clusterOf(row.el);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  for (const [clusterId, rows] of grouped.entries()) {
    const groupEls = rows.map((r) => r.el);
    const el = pickPrimaryEl(groupEls) || rows[0].el;
    const i = (rows.find((r) => r.el === el) || rows[0]).i;
    const type = (el.getAttribute('type') || el.tagName).toLowerCase();
    const role = (el.getAttribute('role') || '').toLowerCase();
    const id = el.getAttribute('data-magnet-field');
    if (!el.getAttribute('data-magnet-state')) el.setAttribute('data-magnet-state', 'yellow');
    stampPaintHost(el, id, el.getAttribute('data-magnet-state') || 'yellow');
    const reactSelect = !!(
      el.classList.contains('select__input') ||
      el.closest('.select__control, .select-shell')
    );
    const reactShell = reactSelect
      ? (el.closest('.select-shell, .select__container, .select') || el.closest('.select__control'))
      : null;
    const reactVal = reactShell && reactShell.querySelector('.select__single-value');
    const selectedChoiceValue = () => {
      const isChoice = (n) => {
        if (!n) return false;
        const t = (n.getAttribute('type') || '').toLowerCase();
        const r = (n.getAttribute('role') || '').toLowerCase();
        return t === 'radio' || t === 'checkbox' || r === 'radio' || r === 'checkbox';
      };
      if (ashbyEntryOf(el)) {
        const yesno = [
          ...ashbyEntryOf(el).querySelectorAll('.ashby-application-form-input-yesno-option, [data-option]'),
        ];
        const pressed = yesno.filter(
          (b) => b.getAttribute('aria-pressed') === 'true' || /selected|checked/.test(String(b.className || ''))
        );
        if (pressed.length) {
          return pressed
            .map((b) => clip(b.innerText || b.getAttribute('data-option')))
            .filter((t) => t && !GENERIC_LABEL.test(t))
            .join(', ');
        }
      }
      let nodes = groupEls.filter(isChoice);
      if (nodes.length < 2 && el.name) {
        nodes = [
          ...document.querySelectorAll(
            'input[name="' + CSS.escape(el.name) + '"], [role="radio"][name="' + CSS.escape(el.name) + '"]'
          ),
        ];
      }
      const selected = nodes.filter(
        (n) => n.checked || n.getAttribute('aria-checked') === 'true' || n.getAttribute('aria-pressed') === 'true'
      );
      if (
        selected.length === 1 &&
        nodes.length <= 1 &&
        (el.type === 'checkbox' || role === 'checkbox')
      ) {
        const on =
          selected[0].checked ||
          selected[0].getAttribute('aria-checked') === 'true' ||
          selected[0].getAttribute('aria-pressed') === 'true';
        return on ? 'Yes' : '';
      }
      return selected
        .map((n) => optionLabel(n))
        .filter((t) => t && !GENERIC_LABEL.test(t))
        .join(', ');
    };
    const rawVal = (() => {
      if (el.type === 'checkbox' || el.type === 'radio' || role === 'radio' || role === 'checkbox') {
        return selectedChoiceValue();
      }
      if (el.tagName === 'SELECT') {
        const opt = el.options[el.selectedIndex];
        const t = ((opt && (opt.text || opt.value)) || '').trim();
        return GENERIC_LABEL.test(t) ? '' : t;
      }
      if (reactSelect) {
        const multi = [...(reactShell ? reactShell.querySelectorAll('.select__multi-value__label') : [])]
          .map((n) => clip(n.innerText))
          .filter(Boolean);
        if (multi.length) return multi.join(', ');
        return ((reactVal && reactVal.innerText) || '').trim();
      }
      if (isCombo(el)) {
        const shell = el.closest('p-select, .p-select, .select-shell, .select__container') || el.parentElement;
        const sv = shell && shell.querySelector('.select__single-value, .p-select-label, [class*="single-value"]');
        if (sv && clip(sv.innerText) && !GENERIC_LABEL.test(sv.innerText)) return clip(sv.innerText);
        return '';
      }
      return (el.value || el.innerText || '').trim();
    })();
    if (!el.getAttribute('data-magnet-prefill') && String(rawVal).trim()) {
      el.setAttribute('data-magnet-prefill', String(rawVal).trim());
    }
    const ashbyEntry = ashbyEntryOf(el);
    const optionList = (() => {
      if (el.tagName === 'SELECT') {
        return keepFieldOptions(el, [...el.options].map((o) => String(o.text || o.value || '').trim()).filter(Boolean)).slice(0, 400);
      }
      if (ashbyEntry) {
        const yesno = [...ashbyEntry.querySelectorAll('.ashby-application-form-input-yesno-option, [data-option]')];
        if (yesno.length >= 2) {
          return yesno.map((b) => clip(b.innerText || b.getAttribute('data-option'))).filter(Boolean);
        }
        const grouped = [
          ...ashbyEntry.querySelectorAll(
            '.ashby-application-form-input-radio-group-option, .ashby-application-form-input-checkbox-group-option'
          ),
        ];
        if (grouped.length) {
          return grouped.map((n) => clip(n.innerText)).filter(Boolean).slice(0, 48);
        }
      }
      if (type === 'radio' || role === 'radio' || type === 'checkbox' || role === 'checkbox') {
        const fromGroup = groupEls.map((n) => optionLabel(n)).filter(Boolean);
        if (fromGroup.length >= 2) return [...new Set(fromGroup)].slice(0, 48);
        let nodes = el.name
          ? [...document.querySelectorAll('input[name="'+CSS.escape(el.name)+'"]')]
          : [];
        if (nodes.length < 2) {
          const key = choiceGroupKey(el, i);
          if (key) {
            nodes = [...document.querySelectorAll('input[type="radio"], input[type="checkbox"], [role="radio"]')].filter(
              (n) => choiceGroupKey(n) === key
            );
          }
        }
        return nodes.map((n) => optionLabel(n)).filter(Boolean).slice(0, 48);
      }
      if (!reactSelect && !isCombo(el) && el.tagName !== 'SELECT') return [];
      const listId = el.getAttribute('aria-controls');
      const list = listId ? document.getElementById(listId) : null;
      const host = el.closest('p-select, .p-select, .select-shell, .select__container') || el.parentElement;
      const nodes = [
        ...(list ? [...list.querySelectorAll('[role="option"], .select__option, .p-select-option, li')] : []),
        ...(host ? [...host.querySelectorAll('[role="option"], .p-select-option')] : []),
      ];
      const labels = keepFieldOptions(el, nodes.map((n) => clip(n.innerText || n.getAttribute('aria-label'))).filter(Boolean));
      if (labels.length >= 2) return labels.slice(0, 40);
      const nativeOpts = pairedNativeSelect(el);
      if (nativeOpts.length >= 2) return nativeOpts;
      const menuOpts = visibleMenuOptions(el);
      if (menuOpts.length >= 2) return menuOpts;
      const block = fieldBlock(el) || el.closest('.form-group, .canned-questions, fieldset, [class*="question"], [role="group"]');
      if (!block) return [...new Set(labels)].slice(0, 40);
      const pills = [...block.querySelectorAll('button, [role="radio"], [role="option"], [role="checkbox"], label, li')];
      const texts = pills
        .map((n) => clip(n.innerText || n.getAttribute('aria-label')))
        .filter((t) => t && t.length <= 48 && !GENERIC_LABEL.test(t) && (/\\d/.test(t) || /prefer not|decline|do not wish/i.test(t)));
      if (texts.length >= 2) return [...new Set(texts)].slice(0, 48);
      return [...new Set(labels)].slice(0, 40);
    })();
    const validationNear = (() => {
      if (el.validationMessage) return clip(el.validationMessage);
      const by = el.getAttribute('aria-describedby');
      if (by) {
        const t = by.split(/\\s+/).map((aid) => document.getElementById(aid)).filter(Boolean).map((n) => clip(n.innerText)).filter(Boolean).join(' ');
        if (t) return t;
      }
      const block = fieldBlock(el);
      if (block) {
        const err = block.querySelector('[class*="error"], [role="alert"], .invalid-feedback');
        if (err) return clip(err.innerText);
      }
      return '';
    })();
    const cascade = cascadeQuestion(el) || '';
    const rawLabel = labelFor(el);
    const label = preferredQuestion(rawLabel, cascade);
    const starRequired = (t) => /[*＊✱※]\\s*$/.test(String(t || '')) || /[?\\s][*＊✱※](?:\\s|$)/.test(String(t || ''));
    const requiredMark = (() => {
      if (el.required || el.getAttribute('aria-required') === 'true') return true;
      const group = el.closest('[role="group"], fieldset, [aria-required]');
      if (group && group.getAttribute('aria-required') === 'true') return true;
      if (starRequired(label) || starRequired(rawLabel) || starRequired(cascade)) return true;
      const block = fieldBlock(el);
      if (!block) return false;
      return [...block.querySelectorAll('[class*="required"], [class*="asterisk"], [aria-hidden="true"], abbr, sup, span')].some((n) => {
        const t = String(n.textContent || '').trim();
        return t.length <= 2 && /[*＊✱※]/.test(t);
      });
    })();
    const fieldType = role === 'radio' ? 'radio' : role === 'checkbox' ? 'checkbox' : role === 'combobox' ? 'combobox' : role === 'listbox' ? 'listbox' : type;
    const hostEl = hostOf(el);
    const clusterEl = clusterHostOf(hostEl);
    fields.push({
      id,
      clusterId,
      tag: el.tagName.toLowerCase(),
      type: fieldType,
      name: el.name || '',
      domId: el.id || '',
      autocomplete: el.getAttribute('autocomplete') || '',
      phoneCountry: isPhoneCountryWidget(el),
      label,
      heading: cascade,
      value: String(rawVal).trim(),
      prefill: el.getAttribute('data-magnet-prefill') || String(rawVal).trim(),
      userValue: el.getAttribute('data-magnet-user-value') || '',
      required: requiredMark,
      maxlength: el.maxLength > 0 ? el.maxLength : null,
      select: el.tagName === 'SELECT',
      reactSelect,
      contenteditable: el.isContentEditable,
      checked: Boolean(
        el.checked ||
          groupEls.some((n) => n.checked || n.getAttribute('aria-checked') === 'true') ||
          selectedChoiceValue()
      ),
      options: optionList,
      validation: validationNear,
      magnetState: el.getAttribute('data-magnet-state') || '',
      controls: groupEls.map((n) => ({
        id: n.getAttribute('data-magnet-field') || '',
        tag: n.tagName.toLowerCase(),
        type: (n.getAttribute('type') || n.getAttribute('role') || n.tagName).toLowerCase(),
        name: n.name || '',
      })),
      shape: shapeOf(el, optionList, fieldType === 'radio' || fieldType === 'checkbox' ? 'choice_group' : ''),
      hostHtml: clipHtml(hostEl, 12000),
      clusterHtml: clipHtml(clusterEl, 40000),
    });
  }
  const realFields = fields.filter((f) => {
    const lab = String(f.label || '').trim();
    if (/^window\\.__|ddRumApplicationId|__appData/.test(lab)) return false;
    if ((f.options || []).length >= 2) return true;
    if (f.reactSelect || f.select || f.type === 'combobox' || f.type === 'listbox') return true;
    if (!lab || GENERIC_LABEL.test(lab) || isInstructionLabel(lab)) return false;
    return true;
  });
  const kept = realFields.length ? realFields : fields.slice(0, 1);
  fields.length = 0;
  fields.push(...kept);
  if (!document.getElementById('magnet-paint')) {
    const s = document.createElement('style');
    s.id = 'magnet-paint';
    document.documentElement.appendChild(s);
  }
  document.getElementById('magnet-paint').textContent = ${JSON.stringify(PAINT_CSS)};
  ${FLAG_INSTALL}
  return { href: location.href, fields, pageHtml: clipHtml(pageRoot, 160000) };
})()`;

const FLAG_SCRIPT = `(() => { ${FLAG_INSTALL} return true; })()`;

function paintScript(id, state) {
  return `(() => {
    ${paintHostSource()}
    const el = document.querySelector('[data-magnet-field="${id}"]');
    if (!el) return false;
    el.setAttribute('data-magnet-state', ${JSON.stringify(state)});
    if (${JSON.stringify(state)} !== 'orange') el.removeAttribute('aria-busy');
    if (el.tagName === 'TEXTAREA' || el.isContentEditable) el.style.setProperty('cursor', 'text', 'important');
    stampPaintHost(el, ${JSON.stringify(id)}, ${JSON.stringify(state)});
    return true;
  })()`;
}

const PAINT_MISSED_SCRIPT = `(() => {
  ${paintHostSource()}
  for (const el of document.querySelectorAll('[data-magnet-field][data-magnet-state="yellow"]')) {
    el.setAttribute('data-magnet-state', 'red');
    stampPaintHost(el, el.getAttribute('data-magnet-field'), 'red');
  }
  for (const g of document.querySelectorAll('.form-group, .canned-questions')) {
    if (g.getAttribute('data-magnet-state') === 'green' || g.getAttribute('data-magnet-state') === 'orange' || g.getAttribute('data-magnet-state') === 'skip') continue;
    if (g.querySelector('[data-magnet-state="green"], [data-magnet-state="orange"], [data-magnet-state="skip"]')) continue;
    const sel = g.querySelector('select');
    const emptySelect = sel && !String(sel.value || '').trim();
    const radios = [...g.querySelectorAll('input[type="radio"]')];
    const emptyRadios = radios.length >= 2 && !radios.some((n) => n.checked);
    if (emptySelect || emptyRadios) {
      g.setAttribute('data-magnet-state', 'red');
      if (!g.getAttribute('data-magnet-proxy')) {
        g.setAttribute('data-magnet-proxy', (sel && sel.getAttribute('data-magnet-field')) || 'missed');
      }
    }
  }
  return true;
})()`;

function busyScript(id, on, label) {
  const text = label || 'Matching experience…';
  return `(() => {
    const el = document.querySelector('[data-magnet-field="${id}"]');
    const chipId = ${JSON.stringify('magnet-busy-' + id)};
    let chip = document.getElementById(chipId);
    if (!el) {
      if (chip) chip.remove();
      return false;
    }
    if (${on ? 'true' : 'false'}) {
      el.setAttribute('data-magnet-busy', '1');
      el.setAttribute('aria-busy', 'true');
      el.style.setProperty('cursor', 'text', 'important');
      if (el.placeholder != null && el.getAttribute('data-magnet-ph') == null) {
        el.setAttribute('data-magnet-ph', el.placeholder || '');
      }
      if (el.placeholder != null) el.placeholder = ${JSON.stringify(text)};
      if (!chip) {
        chip = document.createElement('div');
        chip.id = chipId;
        chip.setAttribute('data-magnet-chip', '1');
        document.body.appendChild(chip);
      }
      chip.textContent = ${JSON.stringify(text)};
      const r = el.getBoundingClientRect();
      Object.assign(chip.style, {
        position: 'fixed',
        zIndex: '2147483645',
        pointerEvents: 'none',
        background: '#9a3412',
        color: '#fff7ed',
        font: '600 12px/1.2 system-ui,sans-serif',
        padding: '6px 10px',
        borderRadius: '6px',
        boxShadow: '0 4px 16px rgba(0,0,0,.35)',
        top: Math.max(8, r.top - 32) + 'px',
        left: Math.max(8, r.left) + 'px',
      });
    } else {
      el.removeAttribute('data-magnet-busy');
      el.removeAttribute('aria-busy');
      if (el.tagName === 'TEXTAREA' || el.isContentEditable) el.style.setProperty('cursor', 'text', 'important');
      else el.style.removeProperty('cursor');
      const ph = el.getAttribute('data-magnet-ph');
      if (ph != null) {
        el.placeholder = ph;
        el.removeAttribute('data-magnet-ph');
      }
      if (chip) chip.remove();
    }
    return true;
  })()`;
}

function flashFieldScript(id) {
  return `(() => {
    ${paintHostSource()}
    const el = document.querySelector('[data-magnet-field="${id}"]');
    if (!el) return false;
    const host = stampPaintHost(el, ${JSON.stringify(id)}, el.getAttribute('data-magnet-state')) || el;
    try { host.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (_) {}
    const prev = host.getAttribute('data-magnet-flash-bg');
    if (prev == null) host.setAttribute('data-magnet-flash-bg', host.style.backgroundColor || '');
    host.style.setProperty('background-color', 'rgba(250, 204, 21, 0.55)', 'important');
    host.style.setProperty('transition', 'background-color .15s ease-out', 'important');
    clearTimeout(host.__magnetFlash);
    host.__magnetFlash = setTimeout(() => {
      const saved = host.getAttribute('data-magnet-flash-bg');
      host.removeAttribute('data-magnet-flash-bg');
      host.style.removeProperty('background-color');
      host.style.removeProperty('transition');
      if (saved) host.style.backgroundColor = saved;
    }, 1400);
    return true;
  })()`;
}

function chatTargetScript(id) {
  const target = JSON.stringify(id || '');
  return `(() => {
    const VOID = /^(INPUT|TEXTAREA|SELECT|IMG|HR|BR)$/i;
    const id = ${target};
    if (id) {
      const cur = document.querySelector('[data-magnet-field="' + id + '"]');
      const marked = cur && (
        cur.getAttribute('data-magnet-chat-target') === '1' ||
        document.querySelector('[data-magnet-proxy="' + id + '"][data-magnet-chat-target="1"]')
      );
      if (marked && document.querySelector('.magnet-chat-chip')) return true;
    }
    document.querySelectorAll('[data-magnet-chat-target]').forEach((el) => el.removeAttribute('data-magnet-chat-target'));
    document.querySelectorAll('.magnet-chat-chip').forEach((el) => el.remove());
    document.querySelectorAll('[data-magnet-chat-host]').forEach((el) => {
      if (el.getAttribute('data-magnet-chat-pos') === '1') el.style.removeProperty('position');
      el.removeAttribute('data-magnet-chat-pos');
      el.removeAttribute('data-magnet-chat-host');
    });
    ${paintHostSource()}
    if (!id) return true;
    const el = document.querySelector('[data-magnet-field="' + id + '"]');
    if (!el) return false;
    const box = paintHostOf(el) || el;
    box.setAttribute('data-magnet-chat-target', '1');
    if (box !== el) {
      el.setAttribute('data-magnet-hosted', '1');
      box.setAttribute('data-magnet-proxy', id);
    }
    let host = !VOID.test(box.tagName) && !box.isContentEditable ? box : (box.parentElement || box);
    if (!host || host === document.body || host === document.documentElement || getComputedStyle(host).display === 'contents') {
      host = box.closest('div, section, fieldset, form, label, li, td, p') || host;
    }
    if (!host) return false;
    if (getComputedStyle(host).position === 'static') {
      host.style.position = 'relative';
      host.setAttribute('data-magnet-chat-pos', '1');
    }
    host.setAttribute('data-magnet-chat-host', '1');
    const chip = document.createElement('span');
    chip.className = 'magnet-chat-chip';
    chip.textContent = 'chat';
    host.appendChild(chip);
    const hr = host.getBoundingClientRect();
    const br = box.getBoundingClientRect();
    chip.style.right = Math.max(4, hr.right - br.right + 4) + 'px';
    chip.style.bottom = Math.max(2, hr.bottom - br.bottom + 4) + 'px';
    return true;
  })()`;
}

module.exports = {
  INVENTORY_SCRIPT,
  FLAG_SCRIPT,
  paintScript,
  busyScript,
  flashFieldScript,
  chatTargetScript,
  harvestSelectOptionsScript,
  PAINT_CSS,
  PAINT_MISSED_SCRIPT,
};
