/**
 * Turn ATS / JSON-LD HTML (or collapsed LinkedIn blobs) into readable JD text + blocks.
 * UMD: Node `require` and chrome `<script>` (sandboxed preload cannot load this file).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JdFormat = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
'use strict';


const HEADINGS = [
  'Role Overview',
  'The Role',
  'About the Role',
  'About the Job',
  'About the Position',
  'About the Team',
  'About the Company',
  'About Us',
  'About You',
  "What You'll Do",
  'What You Will Do',
  "What You'll Bring",
  "What You'll Need",
  "What We're Looking For",
  'What We Are Looking For',
  'Responsibilities',
  'Key Responsibilities',
  'Your Responsibilities',
  'Qualifications',
  'Required Qualifications',
  'Minimum Qualifications',
  'Basic Qualifications',
  'Preferred Qualifications',
  'Requirements',
  'Required Skills',
  'Must Have',
  'Must-Haves',
  'Nice to Have',
  'Nice-to-Haves',
  'Bonus Points',
  'Benefits',
  'Perks',
  'Compensation',
  'Compensation & Benefits',
  'Compensation and Benefits',
  'What We Offer',
  'Who You Are',
  'Who We Are',
  'Our Mission',
  'Our Values',
  'Why Join',
  "Why You'll Love This Role",
  'Equal Opportunity',
  'Equal Employment Opportunity',
  'Location',
  'Tech Stack',
  'Technical Stack',
  'Your Impact',
  'How You Will Make an Impact',
];

const LIST_HEADING =
  /what you|responsib|qualif|require|must.?have|nice.?to.?have|preferred|who you are|bonus|what (?:we(?:.re| are) looking|you.?ll bring)/i;

const QUAL_SPLIT =
  /(?<=\S)\s+(?=(?:\d+\+?\s+years?\b|Experience (?:with|in|using)\b|Strong \w|Proven \w|Bachelor|Master|PhD\b|Knowledge of\b|Ability to\b|Familiarity with\b|Proficiency (?:in|with)\b|Excellent \w|Solid \w|Hands-on\b|Background in\b|Understanding of\b|Passion for\b|Comfortable with\b|Expertise (?:in|with)\b|Skilled in\b|Proficient (?:in|with)\b|Degree in\b))/;

const VERB_SPLIT =
  /(?<=[a-z0-9).])\s+(?=(?:Build|Architect|Collaborate|Work|Tune|Design|Own|Lead|Partner|Write|Develop|Create|Drive|Ship|Maintain|Implement|Ensure|Support|Help|Manage|Coordinate|Contribute|Define|Establish|Improve|Optimize|Deliver|Execute|Identify|Analyze|Communicate|Advocate|Mentor|Guide|Shape|Influence|Translate|Prototype|Test|Debug|Review|Document|Champion|Engage|Facilitate|Prioritize|Operate|Scale|Integrate|Migrate|Refactor|Monitor|Troubleshoot|Automate|Research|Present|Align|Unblock|Grow|Coach|Hire|Recruit|Plan|Run|Launch|Iterate|Explore|Evaluate|Select|Adopt|Introduce|Upgrade|Reduce|Increase|Raise|Set|Take|Play|Serve|Act|Provide|Offer|Bring|Join|Sit|Report|Interface|Liaise|Bridge)\b)/;

function decodeEntities(s) {
  return String(s || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function headingAlt(name) {
  return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/['’]/g, "['’]");
}

const HEADING_SPLIT_RE = (() => {
  const alts = HEADINGS.flatMap((h) => [headingAlt(h), headingAlt(h.toUpperCase())]).sort(
    (a, b) => b.length - a.length
  );
  return new RegExp(String.raw`(^|\s+)(${alts.join('|')})(?=\s|:|$)`, 'g');
})();

function isHeadingLine(s) {
  const t = String(s || '')
    .replace(/['’]/g, "'")
    .replace(/[:：]\s*$/, '')
    .trim();
  if (t.length < 2 || t.length > 56) return false;
  return HEADINGS.some((h) => h.replace(/['’]/g, "'").toLowerCase() === t.toLowerCase());
}

function splitCollapsedHeadings(text) {
  HEADING_SPLIT_RE.lastIndex = 0;
  return String(text || '').replace(HEADING_SPLIT_RE, '\n\n$2\n');
}

function normalizeJdText(text) {
  let s = decodeEntities(text)
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const lineCount = s ? s.split('\n').length : 0;
  if (s && lineCount < 5) s = splitCollapsedHeadings(s).replace(/\n{3,}/g, '\n\n').trim();
  return s;
}

function htmlToJdText(html) {
  const raw = String(html || '');
  if (!/<[a-z][\s\S]*>/i.test(raw)) return normalizeJdText(raw);
  const s = raw
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<h[1-6][^>]*>/gi, '\n\n')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<\/li>/gi, '')
    .replace(/<\/(p|div|section|article|ul|ol|tr|blockquote|figcaption|header)>/gi, '\n')
    .replace(/<(p|div|section|article)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return normalizeJdText(s);
}

function splitListBody(body, heading) {
  const rawLines = String(body || '')
    .split('\n')
    .map((l) => l.replace(/^[•●○◦▪▸►\-–—*]\s+/, '').trim())
    .filter(Boolean);
  if (rawLines.length >= 2 && rawLines.every((l) => l.length < 360)) return rawLines;

  if (!LIST_HEADING.test(heading || '')) return null;

  const trimmed = rawLines.join(' ').replace(/\s+/g, ' ').trim();
  if (!trimmed) return null;

  const bySent = trimmed
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (bySent.length >= 3 && bySent.every((s) => s.length >= 16 && s.length <= 360)) return bySent;

  const byQual = trimmed
    .split(QUAL_SPLIT)
    .map((s) => s.trim())
    .filter(Boolean);
  if (byQual.length >= 2 && byQual.every((s) => s.length >= 12 && s.length <= 420)) return byQual;

  const byVerb = trimmed
    .split(VERB_SPLIT)
    .map((s) => s.trim())
    .filter(Boolean);
  if (byVerb.length >= 3 && byVerb.every((s) => s.length >= 12 && s.length <= 420)) return byVerb;

  return null;
}

function pushBody(blocks, body, heading) {
  const list = splitListBody(body, heading);
  if (list) {
    blocks.push({ type: 'ul', items: list });
    return;
  }
  const text = String(body || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join(' ');
  if (text) blocks.push({ type: 'p', text });
}

function parseJdBlocks(text) {
  const normalized = normalizeJdText(text);
  if (!normalized) return [];
  const chunks = normalized.split(/\n{2,}/);
  const blocks = [];
  let pendingHeading = '';
  for (const chunk of chunks) {
    const lines = chunk
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (!lines.length) continue;
    const first = lines[0].replace(/[:：]\s*$/, '');
    if (isHeadingLine(first)) {
      blocks.push({ type: 'h', text: first });
      pendingHeading = first;
      const rest = lines.slice(1);
      if (!rest.length) continue;
      pushBody(blocks, rest.join('\n'), pendingHeading);
      pendingHeading = '';
      continue;
    }
    pushBody(blocks, chunk, pendingHeading);
    pendingHeading = '';
  }
  return blocks;
}

return {
  HEADINGS,
  htmlToJdText,
  normalizeJdText,
  parseJdBlocks,
};
});
