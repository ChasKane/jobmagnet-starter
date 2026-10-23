export const FIND_FILE_SCRIPT = `(() => {
  const inputs = [...document.querySelectorAll('input[type="file"]')];
  const visible = inputs.filter((el) => {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    if (el.disabled) return false;
    if (st.display === 'none') return false;
    return true;
  });
  const named = (el) => /resume|cv|upload/i.test(el.name + el.id + (el.getAttribute('aria-label') || ''));
  const el = visible.find(named) || inputs.find(named) || visible[0] || inputs[0];
  if (!el) return { ok: false };
  if (el.files && el.files.length) return { ok: true, already: true, selector: el.id ? ('#' + CSS.escape(el.id)) : 'input[type="file"]' };
  if (!el.id) el.setAttribute('data-magnet-file', '1');
  return { ok: true, already: false, selector: el.id ? ('#' + CSS.escape(el.id)) : '[data-magnet-file="1"]' };
})()`;

export const INVENTORY_SCRIPT = `(() => {
  const fields = [...document.querySelectorAll('input, textarea, select')].map((el, i) => {
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (type === 'hidden' || type === 'submit' || type === 'button') return null;
    const id = el.id || el.name || ('f' + i);
    el.setAttribute('data-magnet-field', id);
    const lab = (el.id && document.querySelector('label[for="'+el.id+'"]')) || el.closest('label');
    return {
      id,
      name: el.name || '',
      label: (lab && lab.innerText) || el.getAttribute('aria-label') || el.placeholder || id,
      type: type || el.tagName.toLowerCase(),
      tag: el.tagName.toLowerCase(),
      current: el.value || '',
    };
  }).filter(Boolean);
  return { fields, url: location.href };
})()`;

export const BRIDGE_SCRIPT = `(() => {
  if (window.__magnetBridge) return true;
  window.__magnetBridge = true;
  const post = (type, payload) => {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type, payload }));
    }
  };
  let timer = null;
  document.addEventListener('touchstart', (e) => {
    const el = e.target && e.target.closest && e.target.closest('[data-magnet-field], input, textarea, select');
    if (!el) return;
    timer = setTimeout(() => {
      post('field-longpress', {
        id: el.getAttribute('data-magnet-field') || el.id || el.name || '',
        label: el.getAttribute('aria-label') || el.name || '',
      });
    }, 480);
  }, { passive: true });
  const clear = () => { if (timer) clearTimeout(timer); timer = null; };
  document.addEventListener('touchend', clear, { passive: true });
  document.addEventListener('touchmove', clear, { passive: true });
  document.addEventListener('focusin', (e) => {
    const el = e.target && e.target.closest && e.target.closest('[data-magnet-field]');
    if (el) post('field-focus', { id: el.getAttribute('data-magnet-field'), label: el.name || '' });
  });
  return true;
})()`;

export function wrapEval(id, script) {
  return `(() => {
    try {
      const __r = ${script};
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'eval-result', id: ${JSON.stringify(id)}, result: __r }));
    } catch (e) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'eval-result', id: ${JSON.stringify(id)}, error: String(e && e.message || e) }));
    }
    true;
  })();`;
}

export function simpleFillScript(fieldId, value) {
  const id = JSON.stringify(String(fieldId || ''));
  const val = JSON.stringify(String(value ?? ''));
  return `(() => {
    const id = ${id};
    const value = ${val};
    const el = document.querySelector('[data-magnet-field="'+id+'"]')
      || document.getElementById(id)
      || document.querySelector('[name="'+id+'"]');
    if (!el) return { ok: false, error: 'missing' };
    el.setAttribute('data-magnet-field', id);
    el.setAttribute('data-magnet-state', 'green');
    el.style.outline = '2px solid rgba(52,211,153,.9)';
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
