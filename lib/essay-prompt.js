const fs = require('fs');
const path = require('path');
const { looksLikeApplyForm } = require('./chat-intent');
const { isThinJd, looksLikeJobDescription } = require('./jd');

const RICHBOI_FILE = path.join(__dirname, '..', 'knowledge', 'richboi.md');
const SYSTEM_PROMPT_FILE = path.join(__dirname, '..', 'knowledge', 'system-prompt.md');

function richboiPath() {
  return process.env.MAGNET_VOICE_FILE || RICHBOI_FILE;
}

const DEFAULT_SYSTEM_PROMPT = `You are Magnet, a co-editor sitting next to the applicant.

Always reply with JSON only, no markdown wrapper:
{"reply":"string","drafts":[{"id":"field-id","text":"draft"}],"experience_updates":[{"employer":"string","text":"string"}],"profile_updates":[{"path":"identity.age","value":30}]}

Do the four stages in order in this turn, then emit once.

"reply" is what the applicant sees in chat. Magnet's voice, not the essay voice. "reply" must describe the drafts[] you actually emit. Name employers and products. Never mention internal card ids, tags, or source_card_ids.

"drafts" are optional page fills. Infer advise vs write vs lookup vs Magnet-bug from the user line; there is no mode. Leave the array empty when you are only advising or answering how to finish a draft they already have — unless they explicitly asked you to put text on the field.

If a question has non-empty "current" text, keep the applicant's wording. Append only if they asked to finish on the field. Rewrite only if they asked for a rewrite.
`;

function usefulCurrent(val) {
  const s = String(val || '').trim();
  if (!s) return '';
  if (
    /^(select|select one|choose|choose one|pick one|please select|n\/a|\.\.\.|type (your )?(answer|here)|enter text)$/i.test(
      s
    )
  ) {
    return '';
  }
  return s;
}

function loadRichboi() {
  if (require('./store/mode').isSupabase()) {
    const persist = require('../packages/persist');
    persist.open();
    return persist.nodeStore().getVoice();
  }
  try {
    return fs.readFileSync(richboiPath(), 'utf8');
  } catch (_) {
    return '';
  }
}

function saveRichboi(text) {
  if (require('./store/mode').isSupabase()) {
    const persist = require('../packages/persist');
    persist.open();
    return persist.nodeStore().setVoice(text);
  }
  const dest = richboiPath();
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, String(text ?? ''), 'utf8');
  return loadRichboi();
}

function loadSystemPrompt() {
  if (require('./store/mode').isSupabase()) {
    const persist = require('../packages/persist');
    persist.open();
    const text = persist.nodeStore().getSystemPrompt();
    if (String(text || '').trim()) return text;
    return DEFAULT_SYSTEM_PROMPT;
  }
  try {
    const text = fs.readFileSync(SYSTEM_PROMPT_FILE, 'utf8');
    if (String(text || '').trim()) return text;
  } catch (_) {}
  return DEFAULT_SYSTEM_PROMPT;
}

function saveSystemPrompt(text) {
  if (require('./store/mode').isSupabase()) {
    const persist = require('../packages/persist');
    persist.open();
    persist.nodeStore().setSystemPrompt(text);
    return loadSystemPrompt();
  }
  fs.writeFileSync(SYSTEM_PROMPT_FILE, String(text ?? ''), 'utf8');
  return loadSystemPrompt();
}

function loadVoicePlaybook() {
  return { richboi: loadRichboi() };
}

function wantsReuseRead(instruction) {
  return /\b(reuse|use what i wrote|adapt|prior|previous|last (similar|essay)|canonical)\b/i.test(
    String(instruction || '')
  );
}

function leftoverBlock(payload) {
  const rows = Array.isArray(payload.leftovers) ? payload.leftovers : [];
  const fills = Array.isArray(payload.review_fills) ? payload.review_fills : [];
  const asks = Array.isArray(payload.review_asks) ? payload.review_asks : [];
  if (!rows.length && !fills.length && !asks.length) return '';
  const age = payload.profile_age != null ? `\nProfile age on file: ${payload.profile_age}.` : '';
  const parts = [];
  if (rows.length) {
    parts.push(
      `Unfilled static leftovers (not essays). Draft onto these ids when the applicant just gave the fact. Do not paste opinions, strategy, or "waste of the box" comments onto leftovers — reply instead. Closed facts they just stated go in profile_updates (age, skill years, pay, work auth, EEO), not experience_updates. If options is empty, the page bubbles were not scraped — say that; do not invent a highlight policy.${age}\n${JSON.stringify(rows)}`
    );
  }
  if (fills.length || asks.length) {
    parts.push(
      `Leftover review already returned. Unaccepted fills and unanswered asks — draft onto these ids when the applicant just gave the fact.\n${JSON.stringify({ fills, asks })}`
    );
  }
  return parts.join('\n') + '\n';
}

function preferPostingJd(tab) {
  const live = tab && tab.jd;
  const liveText = (live && live.text) || '';
  let stored = null;
  try {
    const { getRecord } = require('./process-store');
    stored = getRecord((tab && tab.meta && tab.meta.url) || '').jd;
  } catch (_) {}
  const storedText = (stored && stored.text) || '';
  const liveForm = Boolean(liveText) && looksLikeApplyForm(liveText);
  const storedOk = storedText.length >= 80 && !looksLikeApplyForm(storedText);
  if (liveForm && storedOk) return stored;
  if (isThinJd(live) && storedOk && !isThinJd(stored) && looksLikeJobDescription(storedText)) return stored;
  if (isThinJd(stored) && liveText && !liveForm && !isThinJd(live) && looksLikeJobDescription(liveText)) {
    return live;
  }
  if (storedText.length > liveText.length + 80 && storedOk) return stored;
  if (liveText && !liveForm) return live;
  if (storedOk) return stored;
  return live;
}

function buildEssayPrompt(payload) {
  const { buildTurnPrompt } = require('./cascade');
  const { richboi } = loadVoicePlaybook();
  const prompt = buildTurnPrompt(payload);
  return { prompt, richboi, stories: '' };
}

module.exports = {
  usefulCurrent,
  loadVoicePlaybook,
  loadRichboi,
  saveRichboi,
  loadSystemPrompt,
  saveSystemPrompt,
  buildEssayPrompt,
  leftoverBlock,
  preferPostingJd,
  wantsReuseRead,
  RICHBOI_FILE,
  SYSTEM_PROMPT_FILE,
  DEFAULT_SYSTEM_PROMPT,
};
