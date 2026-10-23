function buildVoiceLearnPrompt({ voice, pairs } = {}) {
  const edits = (pairs || [])
    .map((p, i) => {
      const draft = String((p && p.llm_draft) || '').trim();
      const finalText = String((p && p.final) || '').trim();
      if (!finalText) return '';
      return `## Edit ${i + 1}\nQuestion: ${(p && p.label) || ''}\nDraft:\n${draft.slice(0, 1200)}\n\nFinal:\n${finalText.slice(0, 1800)}`;
    })
    .filter(Boolean)
    .join('\n\n');
  return `The applicant edited Magnet drafts. Infer reusable voice rules from how they changed the text.

Rules must work on the next company. No employer names, product names, or proper nouns. No "on Metabase" or "for JobMagnet".
Write imperative lines ("Describe the tool; do not name it.") not recaps of this essay.

Current voice:
${String(voice || '').slice(0, 4000)}

${edits || '(no edits)'}

Return JSON only:
{"rules":[{"id":"kebab-id","text":"one imperative rule"}]}
Empty rules array if the edits do not teach a reusable pattern.`;
}

function parseVoiceLearnJson(blob) {
  const text = String(blob || '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return { rules: [] };
  try {
    const obj = JSON.parse(text.slice(start, end + 1));
    const rules = Array.isArray(obj.rules) ? obj.rules : [];
    return {
      rules: rules
        .filter((r) => r && String(r.text || '').trim())
        .map((r) => ({
          id: String(r.id || r.text)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_|_$/g, '')
            .slice(0, 48) || 'rule',
          text: String(r.text || '').trim().slice(0, 240),
        })),
    };
  } catch {
    return { rules: [] };
  }
}

function wantLlmVoice(ctx = {}) {
  if (ctx.heuristic) return false;
  if (process.env.MAGNET_HEURISTIC_VOICE === '1') return false;
  if (process.env.NODE_TEST_CONTEXT) return false;
  return Boolean(process.env.CURSOR_API_KEY);
}

async function llmProposeVoiceRules(pairs, ctx = {}) {
  if (!pairs.length) return [];
  const prompt = buildVoiceLearnPrompt({ voice: ctx.voice || '', pairs });
  const { runPrompt } = require('./llm-call');
  let raw = '';
  if (ctx.promptText && ctx.Agent) {
    const extract =
      ctx.extractText ||
      ((result) => {
        if (result == null) return '';
        if (typeof result === 'string') return result;
        const r = result.result ?? result.text ?? result.output ?? result.message;
        if (typeof r === 'string') return r;
        return JSON.stringify(r || '');
      });
    raw = extract(await ctx.promptText(ctx.Agent, prompt, { name: 'jobmagnet-voice', tools: [] }));
  } else {
    raw = await runPrompt({ name: 'jobmagnet-voice', prompt, tools: [] });
  }
  return parseVoiceLearnJson(raw).rules;
}

module.exports = {
  buildVoiceLearnPrompt,
  parseVoiceLearnJson,
  wantLlmVoice,
  llmProposeVoiceRules,
};
