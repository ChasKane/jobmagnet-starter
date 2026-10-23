/** Internal work the graph knows. Drafts use glosses; names live on tags. */

const PRODUCTS = [
  {
    id: 'jobmagnet',
    employer: '',
    tags: ['jobmagnet', 'forms', 'electron', 'frontend'],
    draft: 'never',
    name: 'JobMagnet',
    gloss:
      'a job-application form auto-filler with an LLM essay/cover-letter drafting sidebar and a career-story content graph that grows from real form answers',
    aliases: [
      /\bjobmagnet\b/i,
      /\bjob magnet\b/i,
      /\bapply browser\b/i,
      /job[- ]application form auto-?fill/i,
      /career stor(?:y|ies) content graph/i,
      /content graph of (?:my )?career/i,
      /deterministic auto-?filler/i,
      /review panel that lets me query/i,
      /essay fields on job applications/i,
    ],
  },
];

function escapeRe(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function productFromText(text) {
  const body = String(text || '');
  if (!body.trim()) return null;
  for (const product of PRODUCTS) {
    if (product.aliases.some((re) => re.test(body))) return product;
  }
  return null;
}

function productsInText(text) {
  const body = String(text || '');
  return PRODUCTS.filter((p) => p.aliases.some((re) => re.test(body)));
}

function employerFromProducts(text) {
  const hit = productFromText(text);
  return hit ? hit.employer : '';
}

function stripDraftNames(text) {
  let out = String(text || '');
  for (const product of PRODUCTS) {
    if (product.draft !== 'never') continue;
    const re = new RegExp(`\\b${escapeRe(product.name)}\\b`, 'gi');
    out = out.replace(re, product.gloss);
    if (product.id === 'jobmagnet') out = out.replace(/\bJob Magnet\b/gi, product.gloss);
  }
  return out.replace(/\s+/g, ' ').trim();
}

function formatCardForDraft(card) {
  const raw = `${(card && card.claim) || ''}\n${(card && card.proof) || ''}\n${((card && card.tags) || []).join(' ')}`;
  const hits = productsInText(raw);
  let claim = String((card && card.claim) || '').trim();
  let proof = String((card && card.proof) || '').trim();
  for (const product of hits) {
    if (product.draft === 'never' || product.draft === 'gloss') {
      const re = new RegExp(`\\b${escapeRe(product.name)}\\b`, 'gi');
      claim = claim.replace(re, product.gloss);
      proof = proof.replace(re, product.gloss);
    }
    if (product.draft === 'never') {
      claim = claim.replace(/\bJob Magnet\b/gi, product.gloss);
      proof = proof.replace(/\bJob Magnet\b/gi, product.gloss);
    }
  }
  const tags = [...new Set([...((card && card.tags) || []), ...hits.map((p) => p.id)])];
  const never = hits.filter((p) => p.draft === 'never').map((p) => p.name);
  const title = String((card && card.employer) || '').trim() || 'Work';
  const lines = [
    `### ${title}`,
    `internal_id: ${(card && card.id) || 'card'} (do not write this id in reply or drafts)`,
    `Tags: ${tags.join(', ') || '(none)'}`,
    never.length ? `Do not write these names: ${never.join(', ')}. Use the gloss in the claim/proof.` : '',
    claim,
    proof,
    (card && card.honesty_bound) ? `Bound: ${card.honesty_bound}` : '',
  ];
  return lines.filter(Boolean).join('\n');
}

function draftProductBlock() {
  const rows = PRODUCTS.map((p) => `- ${p.name} (${p.draft === 'never' ? 'never write this name' : p.draft}): ${p.gloss}`).join(
    '\n'
  );
  return `Internal products. Tags and this list are for you. Drafts describe the work; they do not name-drop tools the reader has never heard of. JobMagnet is never written. Use the gloss.\n${rows}\n`;
}

module.exports = {
  PRODUCTS,
  productFromText,
  productsInText,
  employerFromProducts,
  stripDraftNames,
  formatCardForDraft,
  draftProductBlock,
};
