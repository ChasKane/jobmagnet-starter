const persist = require('../packages/persist');
const { createMagnetApp } = require('../packages/core');
const { createElectronFileInput } = require('./file-input-port');
const { scanInbox, mailStatus } = require('./mail/scan');
const { createMailPort } = require('./mail/port');
const {
  connected: gmailConnected,
  signedInEmail,
} = require('./mail/oauth');

function createElectronMagnet({ getTab, evalFirstOk, setFileInput, connectMail, signOutMail } = {}) {
  persist.migrateFromYaml();
  const store = persist.nodeStore();

  return createMagnetApp({
    store,
    files: {
      async attach({ selector, resume, job, magnetInitiated }) {
        if (!magnetInitiated) return { ok: false, error: 'refusing to intercept a user file picker' };
        const tab = typeof getTab === 'function' ? getTab(job && job.id) : null;
        const wc = tab && tab.atsView && tab.atsView.webContents;
        if (!wc) return { ok: false, error: 'No apply page' };
        const abs = resume && resume.abs;
        if (!abs) return { ok: false, error: 'Resume file missing' };
        return setFileInput(wc, selector, abs);
      },
    },
    browserFor(id) {
      const tab = typeof getTab === 'function' ? getTab(id) : null;
      if (!tab || !tab.atsView) return null;
      return {
        eval: (js) => evalFirstOk(tab.atsView.webContents, js),
        async inventory() {
          const { INVENTORY_SCRIPT } = require('../packages/browser-scripts');
          return evalFirstOk(tab.atsView.webContents, INVENTORY_SCRIPT);
        },
      };
    },
    mail: createMailPort({
      async connect() {
        if (typeof connectMail === 'function') return connectMail();
        return { ok: Boolean(gmailConnected()), email: signedInEmail() };
      },
      async signOut() {
        if (typeof signOutMail === 'function') return signOutMail();
        return { ok: true };
      },
      async scan() {
        const out = await scanInbox();
        store.setMailStatus({
          connected: Boolean(gmailConnected()),
          email: signedInEmail() || '',
          scanned_at: new Date().toISOString(),
          indexed: (out && out.indexed) || 0,
          pending: (out && out.pending && out.pending.length) || 0,
        });
        return out || { ok: true };
      },
      status() {
        return mailStatus();
      },
    }),
  });
}

module.exports = { createElectronMagnet };
