const { isTightCanaryField } = require('./audit');

/**
 * Detect JD traps: LLM/prompt hijacks and "prove you read this" cover-letter canaries.
 */

const LLM_HIJACK_PATTERNS = [
  {
    id: 'if-you-are-llm',
    re: /\bif\s+you\s+are\s+(an?\s+)?(ai|llm|language\s+model|chatgpt|claude|gpt|gemini|copilot)\b/i,
    summary: 'JD addresses LLMs directly ("if you are an AI/LLM…")',
  },
  {
    id: 'ignore-instructions',
    re: /\bignore\s+(all\s+)?(previous|prior|above)\s+instructions\b/i,
    summary: 'Prompt-injection style "ignore previous instructions"',
  },
  {
    id: 'as-an-ai',
    re: /\bas\s+an\s+(ai|llm|language\s+model)\b.{0,80}\b(you\s+must|do\s+the\s+following|respond|output|begin)\b/i,
    summary: 'Instructs the reader "as an AI" to take an action',
  },
  {
    id: 'reveal-ai',
    re: /\b(reveal|disclose|admit|state)\s+that\s+you\s+are\s+(an?\s+)?(ai|llm|bot|language\s+model)\b/i,
    summary: 'Asks applicant/AI to reveal they are an LLM',
  },
  {
    id: 'ai-applicants-forbidden',
    re: /\b(no|do\s+not|don't)\s+(use|submit|apply).{0,40}\b(ai|chatgpt|llm|automated|bot)\b.{0,40}\b(application|apply|resume|cover\s*letter)\b/i,
    summary: 'Forbids AI-assisted applications',
  },
  {
    id: 'robots-must',
    re: /\b(robots?|bots?|automated\s+systems?|language\s+models?)\s+(must|should|will)\b/i,
    summary: 'Special instructions aimed at robots/bots/LLMs',
  },
  {
    id: 'llm-do-this',
    re: /\b(llm|chatgpt|claude|gpt-?\d|language\s+model).{0,60}\b(do\s+the\s+following|insert|output|print|append|add\s+the\s+phrase)\b/i,
    summary: 'Tells an LLM to insert/output something',
  },
];

const COVER_TRAP_PATTERNS = [
  {
    id: 'include-in-cover',
    re: /\b(include|put|write|type|mention|reference|use)\b.{0,60}\b(word|phrase|sentence|string|code|keyword)\b.{0,80}\b(cover\s*letter|application\s+letter|opening\s+paragraph|first\s+sentence)\b/i,
    summary: 'Asks for a specific word/phrase in the cover letter',
  },
  {
    id: 'cover-so-we-know',
    re: /\b(cover\s*letter|application).{0,120}\b(so\s+we\s+know|to\s+(prove|show|confirm)\s+you\s+(read|actually\s+read)|proves?\s+you\s+read)\b/i,
    summary: 'Cover-letter canary ("so we know you read this")',
  },
  {
    id: 'start-cover-with',
    re: /\b(start|begin|open)\s+your\s+cover\s*letter\s+with\b/i,
    summary: 'Requires cover letter to start with a prescribed line',
  },
  {
    id: 'subject-must-contain',
    re: /\b(subject\s+line|email\s+subject).{0,60}\b(must|should)\s+(include|contain|be)\b/i,
    summary: 'Requires a specific email/application subject line',
  },
  {
    id: 'mention-in-cover',
    re: /\bmention\b.{0,40}\b(in\s+your\s+cover\s*letter|somewhere\s+in\s+your\s+application)\b/i,
    summary: 'Requires mentioning something in cover letter / application',
  },
  {
    id: 'favorite-canary',
    re: /\b(favorite|favourite)\s+(dinosaur|animal|color|colour|movie|book|snack|planet)\b.{0,80}\b(cover\s*letter|application|resume|subject)\b/i,
    summary: 'Favorite-X canary (classic ATS read-check)',
  },
];

/** Pull short quoted / backtick canaries near cover-letter language. */
function extractCanaryPhrases(text) {
  const out = [];
  const windowRe =
    /(?:cover\s*letters?|application\s+letters?|opening\s+paragraph|subject\s+line)[^.!?\n]{0,200}|[^.!?\n]{0,200}(?:cover\s*letters?|application\s+letters?)/gi;
  let m;
  while ((m = windowRe.exec(text))) {
    const chunk = m[0];
    const quotes = [
      ...chunk.matchAll(/[“"]([^"“”]{2,80})[”"]/g),
      ...chunk.matchAll(/'([^']{2,80})'/g),
      ...chunk.matchAll(/`([^`]{2,80})`/g),
    ];
    for (const q of quotes) {
      const phrase = q[1].trim();
      if (phrase && !out.includes(phrase)) out.push(phrase);
    }
    const worded = [
      ...chunk.matchAll(
        /\b(?:word|phrase|keyword|string|code)\s+[“"'`]?([A-Za-z0-9][\w-]{1,40})[”"'`]?/gi
      ),
    ];
    for (const q of worded) {
      const phrase = q[1].trim();
      if (phrase && !/^(in|the|your|a|an)$/i.test(phrase) && !out.includes(phrase)) {
        out.push(phrase);
      }
    }
  }
  return out.slice(0, 8);
}

function snippetAround(text, index, radius = 110) {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + radius);
  return text
    .slice(start, end)
    .replace(/\s+/g, ' ')
    .trim();
}

function applyTrapPatterns(text) {
  const findings = [];
  const src = String(text || '');
  for (const p of LLM_HIJACK_PATTERNS) {
    const m = p.re.exec(src);
    if (m) {
      findings.push({
        kind: 'llm_hijack',
        id: p.id,
        summary: p.summary,
        snippet: snippetAround(src, m.index),
      });
    }
  }
  for (const p of COVER_TRAP_PATTERNS) {
    const m = p.re.exec(src);
    if (m) {
      findings.push({
        kind: 'cover_trap',
        id: p.id,
        summary: p.summary,
        snippet: snippetAround(src, m.index),
      });
    }
  }
  return findings;
}

function scanJobDescription(rawText) {
  const text = String(rawText || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const findings = [];

  if (!text || text.length < 40) {
    return {
      ok: false,
      reason: 'too-short',
      findings: [],
      canaryPhrases: [],
      textLength: text.length,
    };
  }

  findings.push(...applyTrapPatterns(text));

  const canaryPhrases = extractCanaryPhrases(text);
  for (const phrase of canaryPhrases) {
    if (
      !findings.some(
        (f) => f.kind === 'cover_trap' && f.snippet && f.snippet.includes(phrase)
      )
    ) {
      findings.push({
        kind: 'cover_trap',
        id: 'quoted-canary',
        summary: `Quoted canary near cover-letter language: “${phrase}”`,
        snippet: phrase,
        phrase,
      });
    }
  }

  return {
    ok: true,
    textLength: text.length,
    findings,
    canaryPhrases,
    llmHijacks: findings.filter((f) => f.kind === 'llm_hijack'),
    coverTraps: findings.filter((f) => f.kind === 'cover_trap'),
    hasAlerts: findings.length > 0,
  };
}

function fieldQuestionText(field) {
  if (!field) return '';
  return [field.label, field.question, field.help, field.description]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(' — ');
}

function scanFormQuestions(fields) {
  const findings = [];
  const seen = new Set();
  const add = (finding) => {
    const key = [finding.kind, finding.id, finding.fieldId, finding.phrase || finding.summary].join('|');
    if (seen.has(key)) return;
    seen.add(key);
    findings.push(finding);
  };
  for (const field of fields || []) {
    const label = String((field && field.label) || '').trim();
    const text = fieldQuestionText(field);
    if (isTightCanaryField(field)) {
      add({
        kind: 'cover_trap',
        id: 'form-canary',
        summary: `Form canary: ${label || field.id}`,
        fieldId: field.id,
        snippet: label,
      });
    }
    if (text.length < 8) continue;
    for (const finding of applyTrapPatterns(text)) {
      add({
        ...finding,
        fieldId: field.id,
        summary: `${finding.summary} — ${label || field.id}`,
      });
    }
  }
  return {
    findings,
    hasAlerts: findings.length > 0,
  };
}

/**
 * Page script: pull readable JD / posting body from common ATS + LinkedIn layouts.
 */
const EXTRACT_JD_SCRIPT = `(() => {
  const pick = (...sels) => {
    for (const s of sels) {
      const el = document.querySelector(s);
      if (el && (el.innerText || '').trim().length > 80) return el;
    }
    return null;
  };
  const el =
    pick(
      '[data-testid="jobDescriptionText"]',
      '.jobs-description',
      '.jobs-description__content',
      '.job-details',
      '#job-details',
      '.posting-page',
      '.posting',
      '[class*="JobDescription"]',
      '[class*="job-description"]',
      '[class*="JobPosting"]',
      'article',
      'main',
      '[role="main"]'
    ) || document.body;
  const text = (el.innerText || el.textContent || '')
    .replace(/\\u00a0/g, ' ')
    .replace(/[ \\t]+/g, ' ')
    .replace(/\\n{3,}/g, '\\n\\n')
    .trim()
    .slice(0, 50000);
  return {
    ok: true,
    href: location.href,
    title: document.title,
    text,
    length: text.length,
  };
})()`;

module.exports = {
  LLM_HIJACK_PATTERNS,
  COVER_TRAP_PATTERNS,
  EXTRACT_JD_SCRIPT,
  scanJobDescription,
  scanFormQuestions,
  extractCanaryPhrases,
};
