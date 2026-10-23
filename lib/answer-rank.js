function tokens(s) {
  return new Set(String(s || '').toLowerCase().match(/[a-z][a-z0-9+]{2,}/g) || []);
}

function jaccard(a, b) {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size && !B.size) return 1;
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const t of A) {
    if (B.has(t)) n += 1;
  }
  return n / (A.size + B.size - n);
}

/**
 * Rank a saved answer by how much the applicant actually wrote.
 * applicant = Magnet never drafted; rewrite = far from the LLM draft; edit = light touch; magnet = shipped as-is.
 */
function rankAnswer(row) {
  const draft = String((row && row.llm_draft) || '').trim();
  const finalText = String((row && row.final) || '').trim();
  if (!finalText) return { origin: 'empty', score: 0, overlap: 0 };
  if (!draft) return { origin: 'applicant', score: 100, overlap: 0 };
  const overlap = jaccard(draft, finalText);
  if (row.unchanged === true || draft === finalText || overlap >= 0.92) {
    return { origin: 'magnet', score: 8, overlap };
  }
  const draftTok = tokens(draft);
  const finalTok = tokens(finalText);
  let added = 0;
  for (const t of finalTok) {
    if (!draftTok.has(t)) added += 1;
  }
  const addedRatio = finalTok.size ? added / finalTok.size : 0;
  const lenRatio =
    Math.min(draft.length, finalText.length) / Math.max(draft.length, finalText.length || 1);
  const grewPersonal = addedRatio >= 0.25 && finalText.length >= draft.length * 1.2;
  if (overlap < 0.42 || lenRatio < 0.45 || grewPersonal) {
    return { origin: 'rewrite', score: 70 + Math.round((1 - overlap) * 25), overlap };
  }
  return { origin: 'edit', score: 32 + Math.round((1 - overlap) * 30), overlap };
}

function withRank(row) {
  const ranked = rankAnswer(row);
  return { ...row, ...ranked };
}

module.exports = { tokens, jaccard, rankAnswer, withRank };
