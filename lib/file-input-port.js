/**
 * Electron FileInputPort.
 * Magnet-initiated attach uses CDP and never clicks the ATS upload CTA
 * (a synthetic click would open the native picker on mobile/WebView).
 * User taps on the page's own file control are not intercepted.
 */

async function attachViaCdp(wc, selector, abs) {
  const dbg = wc.debugger;
  let attachedHere = false;
  if (!dbg.isAttached()) {
    dbg.attach('1.3');
    attachedHere = true;
  }
  try {
    const { root } = await dbg.sendCommand('DOM.getDocument', { depth: -1 });
    const { nodeId } = await dbg.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector });
    if (!nodeId) return { ok: false, error: 'no-node' };
    await dbg.sendCommand('DOM.setFileInputFiles', { nodeId, files: [abs] });
    return { ok: true };
  } finally {
    if (attachedHere && dbg.isAttached()) {
      try {
        dbg.detach();
      } catch (_) {}
    }
  }
}

function createElectronFileInput({ getWebContents, setFileInput } = {}) {
  return {
    async attach({ selector, resume, magnetInitiated }) {
      if (!magnetInitiated) {
        return { ok: false, error: 'refusing to intercept a user file picker' };
      }
      const abs = resume && resume.abs;
      if (!abs) return { ok: false, error: 'Resume file missing' };
      const wc = typeof getWebContents === 'function' ? getWebContents() : null;
      if (!wc) return { ok: false, error: 'No apply page' };
      if (typeof setFileInput === 'function') return setFileInput(wc, selector, abs);
      return attachViaCdp(wc, selector, abs);
    },
  };
}

module.exports = { createElectronFileInput, attachViaCdp };
