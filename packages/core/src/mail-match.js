function fold(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '');
}

function stripCorp(f) {
  return String(f || '').replace(
    /(incorporated|inc|llc|corp|corporation|ltd|limited|company|labs|lab|technologies|technology|tech|io)$/g,
    ''
  );
}

function domainFromFrom(from) {
  const m = String(from || '').match(/@([a-z0-9.-]+\.[a-z]{2,})/i);
  if (!m) return '';
  return m[1]
    .toLowerCase()
    .replace(/^(mail|jobs|careers|apply|noreply|no-reply|talent|recruiting)\./, '');
}

function extractCompany(msg) {
  const text = `${msg.subject || ''}\n${msg.text || ''}`;
  const pats = [
    /your application (?:to|at|for(?: a role at)?)\s+([A-Z][A-Za-z0-9&.'’ -]{1,50})/i,
    /update (?:on|from)\s+(?:your application (?:to|at)\s+)?([A-Z][A-Za-z0-9&.'’ -]{1,50})/i,
    /thank you for (?:your interest in|applying to)\s+([A-Z][A-Za-z0-9&.'’ -]{1,50})/i,
  ];
  for (const re of pats) {
    const m = text.match(re);
    if (m) return m[1].replace(/[.,;:!]+$/, '').trim();
  }
  const display = String(msg.from || '').match(/^"?([^"<@]+)"?\s*</);
  if (display) {
    const name = display[1].trim();
    if (name && !/noreply|no-reply|greenhouse|lever|ashby|workday|smartrecruiters|notifications?/i.test(name)) {
      return name.replace(/\s+(talent|recruiting|careers|jobs|team)$/i, '').trim();
    }
  }
  return '';
}

function fromDomainBonus(from, companyFold) {
  const host = domainFromFrom(from);
  if (!host || !companyFold) return 0;
  const slug = host.split('.')[0] || '';
  const cf = stripCorp(companyFold);
  if (slug && cf && (slug === cf || cf.includes(slug) || slug.includes(cf))) return 25;
  return 0;
}

const ATS_VENDORS = new Set(['ashby', 'greenhouse', 'lever', 'workday', 'smartrecruiters']);

function scoreJob(job, msg, extractedFold) {
  const cf = fold(job.company);
  if (!cf) return 0;
  const stripped = stripCorp(cf);
  // A letter sent through an ATS names the employer. Do not score the vendor's own job
  // just because the footer or from-domain contains "ashby" / "greenhouse".
  if ((ATS_VENDORS.has(cf) || ATS_VENDORS.has(stripped)) && extractedFold) {
    const named = stripCorp(extractedFold);
    if (extractedFold !== cf && named !== stripped) return 0;
  }
  const hay = fold(`${msg.subject || ''} ${msg.text || ''} ${extractedFold || ''}`);
  let score = 0;
  if (extractedFold && (extractedFold === cf || stripCorp(extractedFold) === stripped)) score += 90;
  if (cf.length >= 3 && hay.includes(cf)) score += 80;
  else if (stripped.length >= 3 && hay.includes(stripped)) score += 60;
  else {
    const tokens = String(job.company || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 4 && !/inc|llc|corp|ltd|the|and/.test(t));
    const hits = tokens.filter((t) => hay.includes(t)).length;
    if (hits && hits === tokens.length) score += 40;
  }
  score += fromDomainBonus(msg.from, cf);
  const tf = fold(job.title);
  if (tf && tf.length >= 8 && hay.includes(tf)) score += 15;
  return score;
}

function matchCompany(msg, jobs) {
  const extracted = extractCompany(msg);
  const extractedFold = fold(extracted);
  const scored = (jobs || [])
    .map((job) => ({
      url: job.url,
      company: job.company,
      title: job.title || '',
      status: job.status || 'open',
      score: scoreJob(job, msg, extractedFold),
    }))
    .filter((j) => j.score >= 40)
    .sort((a, b) => b.score - a.score || String(a.company).localeCompare(String(b.company)));

  const unique =
    scored.length === 1 || (scored.length >= 2 && scored[0].score - scored[1].score >= 20 && scored[0].score >= 60);

  const byStatus = (want) => scored.filter((j) => want.includes(j.status));

  return {
    extracted,
    matches: scored,
    unique,
    submitted: byStatus(['submitted']),
    interviewing: byStatus(['interviewing']),
    offer: byStatus(['offer']),
    open: byStatus(['open']),
    closed: byStatus(['rejected', 'passed', 'withdrawn']),
    active: byStatus(['submitted', 'interviewing']),
  };
}

module.exports = { fold, stripCorp, extractCompany, scoreJob, matchCompany, domainFromFrom };
