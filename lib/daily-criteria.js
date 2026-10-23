const STATE_NAMES = {
  AL: 'Alabama',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  DC: 'District of Columbia',
  FL: 'Florida',
  GA: 'Georgia',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming',
};

const NON_CONTIGUOUS = {
  AK: 'Alaska',
  HI: 'Hawaii',
};

const FOREIGN = [
  'united kingdom',
  'england',
  'scotland',
  'wales',
  'london',
  'canada',
  'toronto',
  'vancouver',
  'montreal',
  'germany',
  'berlin',
  'munich',
  'france',
  'paris',
  'india',
  'bangalore',
  'bengaluru',
  'hyderabad',
  'pune',
  'mumbai',
  'ireland',
  'dublin',
  'netherlands',
  'amsterdam',
  'australia',
  'sydney',
  'melbourne',
  'singapore',
  'japan',
  'tokyo',
  'brazil',
  'mexico',
  'spain',
  'madrid',
  'barcelona',
  'poland',
  'warsaw',
  'portugal',
  'lisbon',
  'israel',
  'tel aviv',
  'sweden',
  'stockholm',
  'norway',
  'oslo',
  'denmark',
  'copenhagen',
  'switzerland',
  'zurich',
  'austria',
  'vienna',
  'italy',
  'milan',
  'rome',
  'china',
  'beijing',
  'shanghai',
  'taiwan',
  'taipei',
  'korea',
  'seoul',
  'philippines',
  'manila',
  'romania',
  'bucharest',
  'ukraine',
  'kyiv',
  'estonia',
  'tallinn',
  'czech',
  'prague',
  'hungary',
  'budapest',
  'argentina',
  'buenos aires',
  'colombia',
  'chile',
  'santiago',
  'nigeria',
  'kenya',
  'nairobi',
  'south africa',
  'dubai',
  'emea',
  'apac',
  'latam',
  'europe',
  'tbilisi',
];

function hasWord(text, phrase) {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`(?:^|[^a-z])${escaped}(?:$|[^a-z])`, 'i').test(text);
}

function hasAbbrev(location, abbr) {
  return new RegExp(`(?:^|[\\s,/(])${abbr}(?:$|[\\s,).])`).test(location);
}

function mentionsNamed(location, names) {
  return Object.entries(names).some(([abbr, name]) => {
    if (name === 'District of Columbia') {
      return hasAbbrev(location, 'DC') || /D\.C\./.test(location) || hasWord(location, name);
    }
    return hasAbbrev(location, abbr) || hasWord(location, name);
  });
}

function mentionsForeign(location) {
  if (hasWord(location, 'uk') || hasWord(location, 'uae')) return true;
  return FOREIGN.some((name) => hasWord(location, name));
}

function isRemoteOnly(location) {
  return /\bremote\b/i.test(location) && !/\bhybrid\b/i.test(location) && !/\bon-?site\b/i.test(location);
}

function isEligibleLocation(location) {
  const loc = String(location || '').trim();
  if (!loc) return false;
  if (isRemoteOnly(loc)) return true;
  if (mentionsNamed(loc, NON_CONTIGUOUS)) return false;
  const contiguous = mentionsNamed(loc, STATE_NAMES);
  const foreign = mentionsForeign(loc);
  if (foreign && !contiguous) return false;
  if (contiguous) return true;
  if (/\b(united states|u\.s\.a\.|u\.s\.|usa)\b/i.test(loc)) return true;
  return false;
}

function roleSignals(text) {
  const blob = String(text || '');
  return {
    frontend: /front[\s-]?end|\bui engineer\b|\bui developer\b|user interface|\breact\b|web developer/i.test(blob),
    fullstack: /full[\s-]?stack/i.test(blob),
    backend:
      /back[\s-]?end|server[\s-]?side|\bapi engineer\b|platform engineer|infrastructure engineer|\bdevops\b|site reliability|\bsre\b|data engineer|machine learning engineer|\bml engineer\b|\bios engineer\b|\bandroid engineer\b|mobile engineer/i.test(
        blob
      ),
  };
}

function isEligibleRole(title, description) {
  const fromTitle = roleSignals(title);
  if (fromTitle.fullstack) return true;
  if (fromTitle.frontend) return true;
  if (fromTitle.backend) return false;
  const fromAll = roleSignals(`${title || ''} ${description || ''}`);
  if (fromAll.fullstack) return true;
  if (fromAll.frontend && !fromAll.backend) return true;
  return false;
}

function rejectionReason(job) {
  if (!job || !job.url) return 'missing url';
  if (!isEligibleRole(job.title, job.description)) return 'not frontend or full stack';
  if (!isEligibleLocation(job.location)) return 'location is not remote or contiguous US';
  return '';
}

function acceptJobs(jobs) {
  const accepted = [];
  const rejected = [];
  for (const job of jobs || []) {
    const reason = rejectionReason(job);
    if (reason) rejected.push({ ...job, reason });
    else accepted.push(job);
  }
  return { accepted, rejected };
}

module.exports = {
  isEligibleLocation,
  isEligibleRole,
  rejectionReason,
  acceptJobs,
};
