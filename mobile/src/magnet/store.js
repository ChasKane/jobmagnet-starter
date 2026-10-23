import { createMemoryStore, boardsSeed } from '../../../packages/core/src/rn';
import { createSqlStore } from '../../../packages/core/src/sql-store';
import { setDriver } from '../../../lib/store/api';

const SEED = {
  boards: boardsSeed,
  jobs: [
    {
      id: 'sample-contoso',
      url: 'magnet://sample/contoso',
      company: 'Contoso',
      title: 'Sample apply',
      notes: 'Local fixture — safe to autofill.',
    },
  ],
  profile: {},
  resumes: [],
  voice: 'Write like a specific human. No AI tells. Name real work.',
  systemPrompt: 'You are Magnet, a co-editor sitting next to the applicant.',
};

let singleton = null;
let usingSql = false;

function fileApi() {
  try {
    return require('expo-file-system/legacy');
  } catch {
    try {
      return require('expo-file-system');
    } catch {
      return null;
    }
  }
}

function seedIfEmpty(store) {
  if (!store.listJobs().length) {
    for (const job of SEED.jobs) store.upsertJob(job);
  }
  if (!store.getProfile() || !Object.keys(store.getProfile()).length) store.setProfile(SEED.profile);
  if (!store.listResumes().length) SEED.resumes.forEach((r) => store.importResume(r));
  if (!store.getVoice()) store.setVoice(SEED.voice);
  if (!store.getSystemPrompt()) store.setSystemPrompt(SEED.systemPrompt);
  if (typeof store.listBoards === 'function' && !store.listBoards().length) {
    for (const board of boardsSeed) store.upsertBoard(board);
  }
}

export function getStore() {
  if (singleton) return singleton;
  try {
    const { openMobileSqlite } = require('./sql-driver');
    const driver = openMobileSqlite();
    setDriver(driver);
    singleton = createSqlStore(driver);
    usingSql = true;
  } catch {
    singleton = createMemoryStore(SEED);
    usingSql = false;
  }
  return singleton;
}

export async function hydrateStore() {
  const store = getStore();
  const fs = fileApi();
  const dir = fs && (fs.documentDirectory || fs.cacheDirectory);
  if (dir) {
    const path = `${dir}magnet-bundle.json`;
    try {
      const info = await fs.getInfoAsync(path);
      if (info.exists) {
        const raw = await fs.readAsStringAsync(path);
        store.importBundle(JSON.parse(raw));
      }
    } catch (_) {}
  }
  seedIfEmpty(store);
  return store;
}

export async function persistStore() {
  const store = getStore();
  const fs = fileApi();
  const dir = fs && (fs.documentDirectory || fs.cacheDirectory);
  if (!dir) return null;
  const path = `${dir}magnet-bundle.json`;
  const bundle = store.exportBundle();
  await fs.writeAsStringAsync(path, JSON.stringify(bundle));
  return path;
}

export function bundlePathHint() {
  const fs = fileApi();
  const dir = fs && (fs.documentDirectory || fs.cacheDirectory);
  return dir ? `${dir}magnet-bundle.json` : usingSql ? 'magnet.sqlite' : '';
}

export async function bytesFromUri(uri) {
  const fs = fileApi();
  if (!fs || !uri) return null;
  try {
    if (fs.readAsStringAsync) return await fs.readAsStringAsync(uri, { encoding: fs.EncodingType ? fs.EncodingType.Base64 : 'base64' });
  } catch (_) {}
  return null;
}

export function isSqlStore() {
  return usingSql;
}
