const paint = require('../../lib/paint');
const staticFill = require('../../lib/static-fill');
const { FIND_FILE_SCRIPT, simpleFillScript } = require('../core/src/magnet-app');

const BRIDGE_SCRIPT = `(() => {
  if (window.__magnetBridge) return true;
  window.__magnetBridge = true;
  const post = (type, payload) => {
    const body = JSON.stringify({ type, payload });
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage(body);
    }
    if (window.magnetMirror && typeof window.magnetMirror.post === 'function') {
      window.magnetMirror.post(type, payload);
    }
  };
  document.addEventListener('focusin', (e) => {
    const el = e.target && e.target.closest && e.target.closest('[data-magnet-field]');
    if (!el) return;
    post('field-focus', {
      id: el.getAttribute('data-magnet-field'),
      label: el.getAttribute('aria-label') || el.name || '',
    });
  });
  document.addEventListener('contextmenu', (e) => {
    const el = e.target && e.target.closest && e.target.closest('[data-magnet-field]');
    if (!el) return;
    post('field-longpress', {
      id: el.getAttribute('data-magnet-field'),
      label: el.getAttribute('aria-label') || el.name || '',
    });
  });
  return true;
})()`;

const LONGPRESS_SCRIPT = `(() => {
  if (window.__magnetLongPress) return true;
  window.__magnetLongPress = true;
  let timer = null;
  let target = null;
  const post = (payload) => {
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'field-longpress', payload }));
    }
  };
  const clear = () => { if (timer) clearTimeout(timer); timer = null; target = null; };
  document.addEventListener('touchstart', (e) => {
    const el = e.target && e.target.closest && e.target.closest('[data-magnet-field], input, textarea, select');
    if (!el) return;
    target = el;
    timer = setTimeout(() => {
      const id = el.getAttribute('data-magnet-field') || el.id || el.name || '';
      post({ id, label: el.getAttribute('aria-label') || el.name || '' });
    }, 480);
  }, { passive: true });
  document.addEventListener('touchend', clear, { passive: true });
  document.addEventListener('touchmove', clear, { passive: true });
  return true;
})()`;

function inventoryScript() {
  return paint.INVENTORY_SCRIPT;
}

function paintFieldsScript(fields) {
  return typeof paint.paintScript === 'function' ? paint.paintScript(fields) : '';
}

module.exports = {
  INVENTORY_SCRIPT: paint.INVENTORY_SCRIPT,
  PAINT_CSS: paint.PAINT_CSS,
  paintScript: paint.paintScript,
  flashFieldScript: paint.flashFieldScript,
  chatTargetScript: paint.chatTargetScript,
  fillAndVerifyScript: staticFill.fillAndVerifyScript,
  readFieldScript: staticFill.readFieldScript,
  FIND_FILE_SCRIPT,
  simpleFillScript,
  BRIDGE_SCRIPT,
  LONGPRESS_SCRIPT,
  inventoryScript,
  paintFieldsScript,
};
