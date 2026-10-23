/** Essay question buckets. Cover letters are decided before this. */

const WHY_ROLE_RE =
  /\b(?:why (?:us|this|the company|the role|the team|do you want|are you|would you|have you|did you apply|should (?:we|i))|what (?:made|makes) you (?:apply|want)|what interests you|why .+\bapply|interest(?:ed)? in (?:this|the|our|working|joining)|what(?:'s| is) it about .{0,80}(?:role|company|team|product|us))\b/i;

function fieldLabel(field) {
  if (!field) return '';
  if (typeof field === 'string') return field;
  return field.label || field.heading || '';
}

function guessBucket(field) {
  return WHY_ROLE_RE.test(fieldLabel(field)) ? 'why-role' : 'standard';
}

function guessBuckets(fields) {
  const map = new Map();
  for (const field of fields || []) {
    if (!field || !field.id) continue;
    map.set(field.id, guessBucket(field));
  }
  return map;
}

function buildClassifyPrompt(fields) {
  const questions = (fields || []).map((field) => ({
    id: field.id,
    label: fieldLabel(field),
  }));
  return `Classify every essay question in this list. One JSON object, no markdown.

{"buckets":[{"id":"field-id","bucket":"why-role"}]}

bucket is "why-role" or "standard".

why-role: the question asks why this role, why this company, why us, what made you apply, or what interests you about this job. The answer is a reason for wanting the work.
standard: every other essay. A project, a time, how you build, tools, communication, or experience stays standard even when the label mentions the company.

Cover letters and open "anything else?" boxes are already removed. Do not add a third bucket. Classify every id.

Questions:
${JSON.stringify(questions)}`;
}

function bucketsFromText(raw, fields) {
  const text = String(raw || '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return guessBuckets(fields);
  let parsed;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return guessBuckets(fields);
  }
  const rows = Array.isArray(parsed && parsed.buckets) ? parsed.buckets : null;
  if (!rows) return guessBuckets(fields);
  const allowed = new Set((fields || []).map((field) => field && field.id).filter(Boolean));
  const map = guessBuckets(fields);
  for (const row of rows) {
    const id = row && row.id;
    const bucket = row && row.bucket === 'why-role' ? 'why-role' : row && row.bucket === 'standard' ? 'standard' : '';
    if (!id || !allowed.has(id) || !bucket) continue;
    map.set(id, bucket);
  }
  return map;
}

function bucketsFromModel(out, fields) {
  if (out && typeof out === 'object' && Array.isArray(out.buckets)) {
    return bucketsFromText(JSON.stringify(out), fields);
  }
  const blobs = [];
  if (typeof out === 'string') blobs.push(out);
  if (out && typeof out === 'object') {
    for (const key of ['raw', 'reply', 'text', 'result']) {
      if (out[key]) blobs.push(out[key]);
    }
  }
  for (const blob of blobs) {
    const text = String(blob);
    if (text.includes('"buckets"')) return bucketsFromText(text, fields);
  }
  return guessBuckets(fields);
}

function shouldRouteWhyRole(instruction) {
  const text = String(instruction || '').trim();
  if (!text) return true;
  if (/\b(how might|how should|how do i|what should|any ideas|advice|don't write|do not write|leave (it|this|the draft))\b/i.test(text)) {
    return false;
  }
  return /\b(draft|rewrite|write (it|this|the|these|them)|fill (it|this|the|these)|answer (it|this|the|these|them))\b/i.test(text);
}

function buildWhyRolePrompt(ctx = {}) {
  const fields = ctx.fields || [];
  const cards = ctx.cards || '(no cards)';
  const jd = String(ctx.jd || '').slice(0, 8000);
  const instruction = String(ctx.instruction || '').trim();
  return `${ctx.system || ''}

Essay voice applies to the sentences after the opener. Chat reply stays Magnet, not this voice.
${ctx.voice || ''}

## Why-role pipe
These questions are why-role. Do not use the four-stage essay answer. Do not write a résumé tour.

For each question, drafts[].text has this order:

1. Open with a line in this family, like a person who means it: "Omg because y'all are building the coolest solution in the industry..." Name their product in that line.

2. Look up that product and its competitors with webSearch or webFetch before you write the next sentence. If you are certain of one feature this product has that those competitors do not, say that feature and name the competitor. If you are not certain, skip this section. Do not guess a differentiator. Do not write a feature from memory.

3. Then a few sentences on the product the applicant has actually worked on that is closest to this JD. Use only the source cards. Name that product and the overlap. Stop. Do not add a second story.

The opener may be hot. The rest stays specific. No em dashes. No "not X, but Y". Never write JobMagnet or Job Magnet.

Source cards — the only work you may cite. If a fact is not in a card, omit it.
${cards}

Company: ${ctx.company || ''}
Title: ${ctx.title || ''}
${instruction ? `User message:\n${instruction}\n` : ''}JD (trimmed):
${jd}
Questions (id, label, maxLength, current):
${JSON.stringify(fields)}

Return JSON only: {"reply":"string","drafts":[{"id":"field-id","text":"draft"}],"experience_updates":[],"profile_updates":[]}`;
}

module.exports = {
  WHY_ROLE_RE,
  guessBucket,
  guessBuckets,
  buildClassifyPrompt,
  bucketsFromText,
  bucketsFromModel,
  shouldRouteWhyRole,
  buildWhyRolePrompt,
};
