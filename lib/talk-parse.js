function parseJsonObject(text) {
  const start = String(text || '').indexOf('{');
  const end = String(text || '').lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(String(text).slice(start, end + 1));
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : null;
  } catch {
    return null;
  }
}

function asUpdates(list) {
  return (Array.isArray(list) ? list : [])
    .filter((u) => u && typeof u === 'object' && (u.path || u.key) && u.value != null)
    .map((u) => ({ path: String(u.path || u.key), value: u.value }));
}

function unescapeDraftText(s) {
  const text = String(s || '');
  if (text.includes('\\n') && !text.includes('\n')) return text.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
  return text;
}

function asDrafts(list) {
  return (Array.isArray(list) ? list : [])
    .filter((d) => d && (d.text || d.reply || d.value))
    .map((d) => ({
      id: String(d.id || ''),
      label: String(d.label || d.id || ''),
      text: unescapeDraftText(d.text || d.reply || d.value || ''),
    }));
}

function asExperience(list) {
  return (Array.isArray(list) ? list : []).filter((u) => u && typeof u === 'object');
}

/** Talk replies are prose. Optional trailing JSON for drafts/updates. Whole-blob JSON still works. */
function parseTalkReply(blob) {
  const text = String(blob || '').trim();
  if (!text) {
    return { reply: '', drafts: [], profile_updates: [], experience_updates: [], asks: [] };
  }
  const whole = parseJsonObject(text);
  const looksWhole =
    whole &&
    (Object.prototype.hasOwnProperty.call(whole, 'reply') ||
      Array.isArray(whole.drafts) ||
      Array.isArray(whole.profile_updates) ||
      Array.isArray(whole.experience_updates));
  if (looksWhole && text[0] === '{') {
    return {
      reply: String(whole.reply || '').trim(),
      drafts: asDrafts(whole.drafts),
      profile_updates: asUpdates(whole.profile_updates),
      experience_updates: asExperience(whole.experience_updates),
      asks: Array.isArray(whole.asks) ? whole.asks : [],
    };
  }
  const last = text.lastIndexOf('\n{');
  const brace = last >= 0 ? last + 1 : -1;
  const trail = brace >= 0 ? parseJsonObject(text.slice(brace)) : null;
  const trailing =
    trail &&
    (Array.isArray(trail.profile_updates) ||
      Array.isArray(trail.drafts) ||
      Array.isArray(trail.experience_updates) ||
      trail.reply != null);
  if (trailing) {
    const reply = text.slice(0, brace).trim() || String(trail.reply || '').trim();
    return {
      reply,
      drafts: asDrafts(trail.drafts),
      profile_updates: asUpdates(trail.profile_updates),
      experience_updates: asExperience(trail.experience_updates),
      asks: Array.isArray(trail.asks) ? trail.asks : [],
    };
  }
  return { reply: text, drafts: [], profile_updates: [], experience_updates: [], asks: [] };
}

module.exports = { parseTalkReply, parseJsonObject, unescapeDraftText };
