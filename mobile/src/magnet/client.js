const { createMagnetApp, snapshotScript, clickScript, typeScript, scrollScript, loginWall } = require('../../../packages/core/src/rn');
const { createFetchLlm } = require('../../../packages/llm/src/fetch-client');
const { getStore, persistStore } = require('./store');
const { createMobileFilePort } = require('./files');
const { createMobileMail } = require('./mail');

let app = null;
const files = createMobileFilePort();
let browser = null;
let huntBrowser = null;
let huntLoginHandler = null;
let huntOpenHandler = null;
let huntProgressHandler = null;

function setBrowser(next) {
  browser = next;
}

function setHuntBrowser(next) {
  huntBrowser = next;
}

function setHuntHandlers(handlers = {}) {
  huntLoginHandler = handlers.onLogin || null;
  huntOpenHandler = handlers.onOpen || null;
  huntProgressHandler = handlers.onProgress || null;
}

function getFiles() {
  return files;
}

function decorateSnap(snap) {
  return { ...(snap || {}), login: loginWall(snap || {}) };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function huntEval(script) {
  const target = huntBrowser || browser;
  if (!target || typeof target.eval !== 'function') throw new Error('No hunt page');
  let last;
  for (let i = 0; i < 8; i += 1) {
    try {
      return decorateSnap(await target.eval(script, 20000));
    } catch (err) {
      last = err;
      await sleep(400);
    }
  }
  throw last || new Error('No hunt page');
}

function getMagnet() {
  if (app) return app;
  const store = getStore();
  app = createMagnetApp({
    store,
    files,
    browserFor() {
      return browser;
    },
    mail: createMobileMail(store),
    llm: createFetchLlm(() => {
      const settings = store.getSettings();
      return {
        url: settings.llmUrl,
        apiKey: settings.llmKey,
        model: settings.modelId,
      };
    }),
    onHuntLogin: (wall) =>
      huntLoginHandler ? huntLoginHandler(wall) : Promise.resolve({ skipped: true }),
    onHuntProgress: (text, messages) => {
      if (huntProgressHandler) huntProgressHandler(text, messages);
    },
    browserHunt: {
      async open(url) {
        if (huntOpenHandler) await huntOpenHandler(url);
        await sleep(1400);
        return huntEval(snapshotScript());
      },
      async snapshot() {
        return huntEval(snapshotScript());
      },
      async click(ref) {
        await huntEval(clickScript(ref));
        await sleep(500);
        return huntEval(snapshotScript());
      },
      async type(ref, text, submit) {
        await huntEval(typeScript(ref, text, submit));
        await sleep(400);
        return huntEval(snapshotScript());
      },
      async scroll(dir) {
        await huntEval(scrollScript(dir));
        await sleep(250);
        return huntEval(snapshotScript());
      },
    },
  });
  ['upsertJob', 'completeJob', 'passJob', 'importResume', 'importBundle', 'setVoice', 'setSettings', 'sendChat', 'ingest', 'approveSearch', 'mailConnect', 'mailScan', 'mailSignOut', 'mailImport', 'mailResolve', 'markNoticeRead'].forEach(
    (name) => {
      const orig = app[name].bind(app);
      app[name] = async (payload) => {
        const out = await orig(payload);
        persistStore().catch(() => {});
        return out;
      };
    }
  );
  return app;
}

module.exports = { getMagnet, setBrowser, setHuntBrowser, setHuntHandlers, getFiles };
