const SAVE_PAUSE_MS = 2000;

function createMirrorSaver({ save, delay, schedule, cancel }) {
  const wait = delay == null ? SAVE_PAUSE_MS : delay;
  const arm = schedule || ((fn, ms) => setTimeout(fn, ms));
  const disarm = cancel || ((id) => clearTimeout(id));
  let timer = null;
  let pending = null;
  let lastSaved;

  const persist = (value) => {
    if (timer != null) disarm(timer);
    timer = null;
    pending = null;
    if (value === lastSaved) return Promise.resolve({ ok: true, skipped: true });
    lastSaved = value;
    return Promise.resolve(save(value));
  };

  return {
    prime(value) {
      lastSaved = value;
      pending = null;
      if (timer != null) disarm(timer);
      timer = null;
    },
    onInput(value) {
      pending = value;
      if (timer != null) disarm(timer);
      timer = arm(() => {
        timer = null;
        persist(pending);
      }, wait);
    },
    onBlur(value) {
      pending = value;
      return persist(value);
    },
    flush() {
      if (timer == null && pending == null) return Promise.resolve({ ok: true, skipped: true });
      return persist(pending);
    },
  };
}

function attachMirrorScript(fieldId) {
  const id = String(fieldId || '');
  return `(() => {
    const el = document.querySelector(${JSON.stringify(`[data-magnet-field="${id}"]`)});
    if (!el || el.__magnetMirror) return { ok: false };
    el.__magnetMirror = true;
    const fieldId = ${JSON.stringify(id)};
    const createMirrorSaver = ${createMirrorSaver.toString()};
    const markId = 'magnet-saved-' + fieldId;
    const readVal = () => (el.isContentEditable ? (el.innerText || '') : (el.value || ''));
    const hideSaved = () => {
      const mark = document.getElementById(markId);
      if (mark) mark.remove();
    };
    const showSaved = () => {
      let mark = document.getElementById(markId);
      if (!mark) {
        mark = document.createElement('div');
        mark.id = markId;
        mark.className = 'magnet-saved-chip';
        mark.textContent = 'saved';
        document.documentElement.appendChild(mark);
      }
      mark.hidden = false;
      const r = el.getBoundingClientRect();
      Object.assign(mark.style, {
        position: 'fixed',
        zIndex: '2147483644',
        pointerEvents: 'none',
        top: Math.max(4, r.top - 22) + 'px',
        left: Math.max(8, r.left) + 'px',
      });
    };
    const persist = async (value, show) => {
      const api = window.magnetMirror;
      if (!api) return { ok: false };
      let result = { ok: true };
      if (typeof api.save === 'function') {
        try { result = (await api.save(fieldId, value)) || { ok: true }; }
        catch (_) { result = { ok: false }; }
      } else if (typeof api.send === 'function') {
        api.send(fieldId, value);
      }
      if (show && result && result.ok !== false) showSaved();
      return result;
    };
    const saver = createMirrorSaver({
      delay: ${SAVE_PAUSE_MS},
      schedule: (fn, ms) => window.setTimeout(fn, ms),
      cancel: (t) => window.clearTimeout(t),
      save: (value) => persist(value, true),
    });
    saver.prime(readVal());
    window.__magnetEssayMirrors = window.__magnetEssayMirrors || {};
    window.__magnetEssayMirrors[fieldId] = saver;
    window.__magnetFlushEssayMirrors = () => Promise.all(
      Object.keys(window.__magnetEssayMirrors).map((k) => window.__magnetEssayMirrors[k].flush())
    ).then((rows) => ({ ok: true, flushed: rows.length }));
    if (!window.__magnetEssayMirrorPagehide) {
      window.__magnetEssayMirrorPagehide = true;
      window.addEventListener('pagehide', () => {
        const api = window.magnetMirror;
        if (!api || typeof api.send !== 'function') return;
        for (const node of document.querySelectorAll('[data-magnet-field]')) {
          if (!node.__magnetMirror) continue;
          const val = node.isContentEditable ? (node.innerText || '') : (node.value || '');
          api.send(node.getAttribute('data-magnet-field'), val);
        }
      });
    }
    el.addEventListener('input', () => {
      hideSaved();
      saver.onInput(readVal());
    });
    el.addEventListener('blur', () => { saver.onBlur(readVal()); });
    return { ok: true };
  })()`;
}

function flushEssayMirrorsScript() {
  return `(() => {
    if (typeof window.__magnetFlushEssayMirrors === 'function') {
      return window.__magnetFlushEssayMirrors();
    }
    return { ok: true, flushed: 0 };
  })()`;
}

module.exports = {
  SAVE_PAUSE_MS,
  createMirrorSaver,
  attachMirrorScript,
  flushEssayMirrorsScript,
};
