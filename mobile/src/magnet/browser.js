import { wrapEval, INVENTORY_SCRIPT, FIND_FILE_SCRIPT, simpleFillScript, BRIDGE_SCRIPT } from './scripts';

function inventoryScript() {
  try {
    const pack = require('../../../packages/browser-scripts');
    return pack.INVENTORY_SCRIPT || INVENTORY_SCRIPT;
  } catch {
    return INVENTORY_SCRIPT;
  }
}

export function createBrowserBridge() {
  let webview = null;
  const pending = new Map();
  let seq = 0;

  return {
    setWebView(ref) {
      webview = ref;
    },
    injectBridge() {
      if (webview) webview.injectJavaScript(`${BRIDGE_SCRIPT};true;`);
    },
    handleMessage(raw) {
      let msg = raw;
      try {
        msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
      } catch {
        return null;
      }
      if (msg && msg.type === 'eval-result' && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error));
        else resolve(msg.result);
      }
      return msg;
    },
    eval(script, timeoutMs = 8000) {
      if (!webview) return Promise.reject(new Error('No apply page'));
      const id = `e${seq++}`;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        webview.injectJavaScript(wrapEval(id, script));
        setTimeout(() => {
          if (pending.has(id)) {
            pending.delete(id);
            reject(new Error('eval timeout'));
          }
        }, timeoutMs);
      });
    },
    async inventory() {
      return this.eval(inventoryScript());
    },
    fill(fieldId, value) {
      try {
        const pack = require('../../../packages/browser-scripts');
        if (pack.fillAndVerifyScript) return this.eval(pack.fillAndVerifyScript(fieldId, value));
      } catch {
        /* fall through */
      }
      return this.eval(simpleFillScript(fieldId, value));
    },
    findFile() {
      return this.eval(FIND_FILE_SCRIPT);
    },
  };
}
