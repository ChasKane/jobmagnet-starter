/** Canned letter for a cover-letter box or an open "anything else?" box. */

const { normalizeQuestion } = require('./normalize');

const COVER_LETTER = `I have friends everywhere.

In 2024 I stayed at a magical place called the Mystical Yoga Farm in Guatemala. I connected deeply with people from all over the world, all walks of life.

I had a night terror one morning at the farm. I couldn't move a muscle but I was wide awake. My only sensations were crushing fear and sadness, and the certainty that I was utterly alone and always had been.

It was a familiar feeling because I had struggled with it all my life, and I had grown so accustomed to it that I forgot it was there, that scarcity and fear driving my actions in subtle ways.

And then I remembered where I was, surrounded by swarms of the best friends I had ever made, and for the first time, I was able to get back to sleep without fighting desperately to wake myself from the night terror. I went back to sleep... and from that day onward, all my fears and insecurities slowly started to crumble.

The rest of my time between jobs went to things I can dwell in or with. A yurt. A masonry heater. A camper. A sauna. Each one solved a problem that mattered to me, and that problem came with a set of constraints no one had solved yet. I enjoy solving problems like that.

Sometimes I see problems from an angle no one else has yet, and I love when that happens. I come at life from an abundance mindset, knowing the solution to any problem is merely waiting for me to allow it to happen.

I kept a hand in software through those years, part time, on my terms. I'm ready for that to be full time, at one company, for a long time.

Give me a problem no one has solved yet.`;

const COVER_RE =
  /\b(cover letters?|covering letters?|motivation letters?|letters? of (interest|motivation|introduction))\b/;
const CATCH_RE =
  /\b(anything else|any other information|anything we should know|what else should we know|what else would you like(?: us)? to know|additional (?:information|comments|details|notes)|other (?:information|comments|details)|something else you(?:d| would)? like)\b/;
const TOPICAL_RE =
  /\b(experience with|your experience|this role|this position|this company|this team|this job|why (?:you|we|this|our)|a time|proud of|interested in|qualifications)\b/;
const LEAD_QUESTION_RE =
  /^(why|what|how|when|describe|explain|tell|please (?:share|describe|explain|tell))\b/;

function fieldLabel(field) {
  if (!field) return '';
  if (typeof field === 'string') return field;
  return field.label || field.heading || '';
}

function isNonText(field) {
  if (!field || typeof field !== 'object') return false;
  const type = String(field.type || field.tag || '').toLowerCase();
  if (['checkbox', 'radio', 'select', 'select-one', 'combobox', 'listbox', 'file', 'hidden', 'submit', 'button'].includes(type)) {
    return true;
  }
  if (field.select || field.reactSelect) return true;
  const opts = Array.isArray(field.options) ? field.options : [];
  return opts.length >= 2;
}

function canHoldLetter(field) {
  if (!field || typeof field !== 'object') return true;
  const max = Number(field.maxlength || field.maxLength) || 0;
  if (max > 0 && max < 180) return false;
  return true;
}

function isCoverLetterPrompt(text) {
  const key = normalizeQuestion(text);
  const hit = key.match(COVER_RE);
  if (!hit) return false;
  const before = key.slice(0, hit.index).trim();
  if (/\b(do not|dont|without|instead of|other than)\b/.test(before)) return false;
  if (LEAD_QUESTION_RE.test(key) && before.split(' ').filter(Boolean).length > 6) return false;
  return true;
}

function isOpenCatchAllPrompt(text) {
  const key = normalizeQuestion(text);
  if (!key || !CATCH_RE.test(key)) return false;
  if (TOPICAL_RE.test(key)) return false;
  if (/\b(work authorization|visa|sponsor|salary|compensation|relocat|notice period|start date)\b/.test(key)) {
    return false;
  }
  if (LEAD_QUESTION_RE.test(key)) {
    const idx = key.search(CATCH_RE);
    if (idx > 18) return false;
  }
  const rest = key
    .replace(
      /\b(please|optional|if applicable|feel free to|let us know|is there|are there|do you have|would you like to share|use this space to|youd like us to know|you would like us to know|youd like to (?:share|add|tell us|include|know)|you would like to (?:share|add|tell us|include)|you want us to know|you want to tell us|we should know|about you|about yourself|to consider|you think would be helpful|that would be helpful|anything else|any other information|something else|additional information|additional comments|additional details|additional notes|other information|other comments|other details|what else should we know|what else would you like us to know)\b/g,
      ' '
    )
    .replace(/\s+/g, ' ')
    .trim();
  if (
    /\b(why|describe|explain|tell|example|project|experience|role|position|company|skill|salary|visa|sponsor|notice)\b|\b(authoriz|relocat)/.test(
      rest
    )
  ) {
    return false;
  }
  return rest.split(' ').filter(Boolean).length <= 10;
}

function idSaysCoverLetter(field) {
  if (!field || typeof field !== 'object') return false;
  const blob = normalizeQuestion([field.name, field.domId].filter(Boolean).join(' '));
  return /\bcover letter\b/.test(blob);
}

function isCannedOpenLetter(field) {
  if (isNonText(field) || !canHoldLetter(field)) return false;
  const label = fieldLabel(field);
  if (isCoverLetterPrompt(label) || isOpenCatchAllPrompt(label)) return true;
  if (!idSaysCoverLetter(field)) return false;
  const key = normalizeQuestion(label);
  return !key;
}

function isReplaceableEssay(value) {
  const flat = String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/…/g, '...')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (!flat) return true;
  return flat === 'let me think on this...' || flat === 'let me think on this';
}

function fitCoverLetter(text, maxLength) {
  const body = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  const max = Number(maxLength) || 0;
  if (!max || body.length <= max) return body;
  const paras = body.split(/\n\n+/);
  let out = '';
  for (const para of paras) {
    const next = out ? `${out}\n\n${para}` : para;
    if (next.length > max) break;
    out = next;
  }
  return out || body.slice(0, max);
}

function coverLetterText(maxLength) {
  return fitCoverLetter(COVER_LETTER, maxLength);
}

module.exports = {
  COVER_LETTER,
  isCannedOpenLetter,
  isCoverLetterPrompt,
  isOpenCatchAllPrompt,
  isReplaceableEssay,
  fitCoverLetter,
  coverLetterText,
};
