const {
  hasApiTokens,
  accessToken,
  listAllNewIds,
  getMessage,
  refreshTokens,
} = require('../../../packages/core/src/gmail-api');

function creds(store) {
  const s = store.getSettings();
  return {
    clientId: s.gmailClientId || '',
    clientSecret: s.gmailClientSecret || '',
    tokens: s.gmailAuth || null,
  };
}

function createMobileMail(store) {
  return {
    async connect() {
      const { tokens } = creds(store);
      if (tokens && (tokens.email || tokens.access_token || tokens.web)) {
        store.setMailStatus({ connected: true, email: tokens.email || '' });
        return { ok: true, connected: true, email: tokens.email || '', reply: tokens.email ? `Signed in as ${tokens.email}.` : 'Signed in to Gmail.' };
      }
      return { ok: false, needUi: true };
    },
    async signOut() {
      store.saveSettings({ gmailAuth: null });
      store.setMailStatus({ connected: false, email: '' });
      return { ok: true };
    },
    async scan({ seen } = {}) {
      const { clientId, clientSecret, tokens } = creds(store);
      if (!hasApiTokens(tokens) || !clientId) {
        return { ok: false, needUi: true, needWebScan: true };
      }
      let auth = tokens;
      const token = await accessToken({ clientId, clientSecret, tokens: auth });
      if (!token) return { ok: false, needUi: true, needWebScan: true };
      if (auth.refresh_token) {
        try {
          const next = await refreshTokens({ clientId, clientSecret, tokens: auth });
          if (next) {
            auth = next;
            store.saveSettings({ gmailAuth: next });
          }
        } catch (_) {}
      }
      const known = seen || {};
      const ids = await listAllNewIds(token, known);
      const messages = [];
      const nextSeen = { ...known };
      for (const id of ids.slice(0, 80)) {
        try {
          messages.push(await getMessage(token, id));
          nextSeen[id] = true;
        } catch (_) {}
      }
      return { ok: true, messages, seen: nextSeen };
    },
    status() {
      return store.getMailStatus();
    },
  };
}

module.exports = { createMobileMail };
