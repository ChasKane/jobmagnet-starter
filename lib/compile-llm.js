function buildCompilePrompt(rows, { employers, existingTags } = {}) {
  return `Compile applicant-sourced text into story cards. Do not invent facts.
If something is only a reasonable inference (leadership, ownership, impact numbers), put it in honesty_bound or omit it.
Quote proof closely from the source. Prefer one card per distinct claim.
Product names (JobMagnet, Page Builder) belong in tags, not in claim/proof. Claim/proof describe the work the way a stranger would read it. JobMagnet is "a job-application form auto-filler with an LLM essay sidebar and a career-story content graph."
If source_card_ids are present, edit those cards. Do not open a new card for the same work.

Known employers (reuse these names when the text matches):
${JSON.stringify(employers || [])}

Existing tags (reuse when they fit; you may add specific tech or categorical tags):
${JSON.stringify(existingTags || [])}

Sources:
${JSON.stringify(rows || [])}

Return JSON only:
{"cards":[{"employer":"","claim":"one checkable sentence","proof":"quoted support","honesty_bound":"what we must not overclaim","tags":["react","backend"],"people":[{"name":"","relation":"manager|teammate|client|user"}],"question_shapes":["why-us","proud-project","conflict","failure","cover","general"],"links":[{"to_employer":"","to_claim":"","kind":"related|same-project"}]}]}
Empty cards array if nothing is usable.`;
}

function parseCompileJson(blob) {
  const text = String(blob || '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return { cards: [] };
  try {
    const obj = JSON.parse(text.slice(start, end + 1));
    const cards = Array.isArray(obj.cards) ? obj.cards : [];
    return {
      cards: cards
        .filter((c) => c && String(c.claim || c.proof || '').trim())
        .map((c) => ({
          employer: String(c.employer || '').trim(),
          claim: String(c.claim || '').trim().slice(0, 240),
          proof: String(c.proof || c.claim || '').trim().slice(0, 2000),
          honesty_bound: String(c.honesty_bound || '').trim(),
          tags: (Array.isArray(c.tags) ? c.tags : []).map((t) => String(t).trim().toLowerCase()).filter(Boolean),
          people: (Array.isArray(c.people) ? c.people : [])
            .map((p) => ({
              name: String((p && p.name) || '').trim(),
              relation: String((p && p.relation) || '').trim(),
            }))
            .filter((p) => p.name),
          question_shapes: (Array.isArray(c.question_shapes) ? c.question_shapes : [])
            .map((s) => String(s).trim().toLowerCase())
            .filter(Boolean),
          links: (Array.isArray(c.links) ? c.links : [])
            .map((l) => ({
              to_employer: String((l && l.to_employer) || '').trim(),
              to_claim: String((l && l.to_claim) || '').trim(),
              kind: String((l && l.kind) || 'related').trim() || 'related',
            }))
            .filter((l) => l.to_claim || l.to_employer),
        })),
    };
  } catch {
    return { cards: [] };
  }
}

function wantLlmCompile(ctx = {}) {
  if (ctx.heuristic) return false;
  if (process.env.MAGNET_HEURISTIC_COMPILE === '1') return false;
  if (process.env.NODE_TEST_CONTEXT) return false;
  return Boolean(process.env.CURSOR_API_KEY);
}

async function llmProposeCards(rows, ctx = {}) {
  if (!rows.length) return [];
  const prompt = buildCompilePrompt(rows, {
    employers: ctx.employers || [],
    existingTags: ctx.existingTags || [],
  });
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
    raw = extract(await ctx.promptText(ctx.Agent, prompt, { name: 'jobmagnet-compile', tools: [] }));
  } else {
    raw = await runPrompt({ name: 'jobmagnet-compile', prompt, tools: [] });
  }
  return parseCompileJson(raw).cards;
}

module.exports = { buildCompilePrompt, parseCompileJson, wantLlmCompile, llmProposeCards };
