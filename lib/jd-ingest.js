/**
 * Fetch a job description at ingest time (ATS public JSON, then HTML JSON-LD).
 * No LLM. Does not open apply BrowserViews.
 */
const { scanJobDescription } = require('./jd-scan');
const { htmlToJdText } = require('./jd-format');

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/172.16.1.3 Safari/537.36';

function stripHtml(html) {
  return htmlToJdText(html);
}

function pack(text, source, extra = {}) {
  const cleaned = stripHtml(text).slice(0, 50000);
  if (!cleaned || cleaned.length < 80) return null;
  return {
    text: cleaned,
    source,
    captured_at: new Date().toISOString(),
    findings: scanJobDescription(cleaned),
    title: extra.title || '',
    company: extra.company || '',
    salary: extra.salary || '',
    location: extra.location || '',
    posting: extra.posting || '',
    applyUrl: extra.applyUrl || '',
  };
}

function parseAtsJob(href) {
  let u;
  try {
    u = new URL(href);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, '');
  const parts = u.pathname.split('/').filter(Boolean);
  if (/greenhouse\.io$/.test(host) && parts.length) {
    const jobsIdx = parts.indexOf('jobs');
    const slug = parts[0];
    const jobId = jobsIdx >= 0 ? String(parts[jobsIdx + 1] || '').replace(/#.*$/, '') : '';
    return { ats: 'greenhouse', slug, jobId, posting: href };
  }
  if (/ashbyhq\.com$/.test(host) && parts[0]) {
    const jobId = parts[1] && parts[1] !== 'application' ? parts[1] : '';
    const posting = jobId ? `https://${u.hostname}/${parts[0]}/${jobId}` : href;
    return { ats: 'ashby', slug: parts[0], jobId, posting };
  }
  if (/lever\.co$/.test(host) && parts[0]) {
    return { ats: 'lever', slug: parts[0], jobId: parts[1] || '', posting: href };
  }
  if (/smartrecruiters\.com$/.test(host)) {
    const slug = parts[0] === 'oneclick' ? parts[1] : parts[0];
    const jobId = parts.includes('jobs') ? parts[parts.indexOf('jobs') + 1] : parts[parts.length - 1];
    return { ats: 'smartrecruiters', slug, jobId, posting: href };
  }
  if (/workable\.com$/.test(host) && parts[0]) {
    const jIdx = parts.indexOf('j');
    return {
      ats: 'workable',
      slug: parts[0],
      jobId: jIdx >= 0 ? parts[jIdx + 1] : '',
      posting: href,
    };
  }
  if (/recruitee\.com$/.test(host)) {
    const slug = host.split('.')[0];
    return { ats: 'recruitee', slug, jobId: parts[parts.length - 1] || '', posting: href };
  }
  return null;
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': UA },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.json();
}

async function fetchGreenhouse(parsed) {
  if (!parsed.slug) return null;
  if (parsed.jobId) {
    try {
      const data = await fetchJson(
        `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(parsed.slug)}/jobs/${encodeURIComponent(parsed.jobId)}`
      );
      const packed = pack(data.content || data.description, 'greenhouse-json', {
        title: data.title,
        company: parsed.slug,
        location: data.location && data.location.name,
        posting: data.absolute_url || parsed.posting,
        applyUrl: data.absolute_url,
      });
      if (packed) return packed;
    } catch (_) {}
    const list = await fetchJson(
      `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(parsed.slug)}/jobs?content=true`
    );
    const hit = (list.jobs || []).find(
      (j) => String(j.id) === String(parsed.jobId) || String(j.absolute_url || '').includes(String(parsed.jobId))
    );
    if (hit) {
      return pack(hit.content || hit.description, 'greenhouse-json', {
        title: hit.title,
        company: parsed.slug,
        location: hit.location && hit.location.name,
        posting: hit.absolute_url || parsed.posting,
        applyUrl: hit.absolute_url,
      });
    }
  }
  return null;
}

async function fetchLever(parsed) {
  if (!parsed.slug) return null;
  if (parsed.jobId) {
    const data = await fetchJson(
      `https://api.lever.co/v0/postings/${encodeURIComponent(parsed.slug)}/${encodeURIComponent(parsed.jobId)}`
    );
    return pack(data.descriptionPlain || data.description, 'lever-json', {
      title: data.text,
      company: parsed.slug,
      location: data.categories && data.categories.location,
      salary: data.categories && data.categories.commitment,
      posting: data.hostedUrl || parsed.posting,
      applyUrl: data.applyUrl || data.hostedUrl,
    });
  }
  return null;
}

async function fetchAshby(parsed) {
  if (!parsed.slug) return null;
  const data = await fetchJson(
    `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(parsed.slug)}?includeCompensation=true`
  );
  const jobs = data.jobs || [];
  const hit =
    jobs.find((j) => {
      const blob = `${j.id || ''} ${j.applyUrl || ''} ${j.jobUrl || ''}`;
      return parsed.jobId && blob.includes(parsed.jobId);
    }) || (jobs.length === 1 ? jobs[0] : null);
  if (!hit) return null;
  return pack(hit.descriptionPlain || hit.descriptionHtml, 'ashby-json', {
    title: hit.title,
    company: parsed.slug,
    salary: hit.compensationTierSummary,
    location: hit.locationName || hit.location,
    posting: hit.jobUrl || parsed.posting,
    applyUrl: hit.applyUrl || hit.jobUrl,
  });
}

async function fetchSmartRecruiters(parsed) {
  if (!parsed.slug || !parsed.jobId) return null;
  const data = await fetchJson(
    `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(parsed.slug)}/postings/${encodeURIComponent(parsed.jobId)}`
  );
  return pack(data.jobAd && data.jobAd.sections && JSON.stringify(data.jobAd.sections), 'smartrecruiters-json', {
    title: data.name || data.title,
    company: parsed.slug,
    posting: parsed.posting,
    applyUrl: data.applyUrl,
  });
}

function remixJobFromHtml(html) {
  const start = html.indexOf('window.__remixContext =');
  if (start < 0) return null;
  const brace = html.indexOf('{', start);
  if (brace < 0) return null;
  const end = html.indexOf(';</script>', brace);
  if (end < 0) return null;
  try {
    const ctx = JSON.parse(html.slice(brace, end));
    const hits = [];
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      const content = node.content || node.contentHtml || node.description || node.jobDescription;
      if (content && String(content).length > 80 && (node.title || node.absolute_url || node.internal_job_id)) {
        hits.push(node);
      }
      for (const v of Object.values(node)) walk(v);
    };
    walk(ctx);
    return hits[0] || null;
  } catch {
    return null;
  }
}

function jsonLdFromHtml(html) {
  const blocks = [...String(html).matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const m of blocks) {
    try {
      const data = JSON.parse(m[1]);
      const arr = Array.isArray(data) ? data : [data];
      for (const item of arr) {
        const graph = item['@graph'] || [item];
        for (const node of graph) {
          const t = String((node && (node['@type'] || node.type)) || '');
          if (/jobposting/i.test(t)) return node;
        }
      }
    } catch (_) {}
  }
  return null;
}

async function fetchHtmlJd(url) {
  const res = await fetch(url, {
    headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': UA },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  const html = await res.text();
  const remix = remixJobFromHtml(html);
  if (remix) {
    return pack(remix.content || remix.contentHtml || remix.description, 'greenhouse-remix', {
      title: remix.title,
      posting: remix.absolute_url || url,
    });
  }
  const node = jsonLdFromHtml(html);
  if (node) {
    const org = node.hiringOrganization;
    return pack(node.description, 'jsonld', {
      title: node.title,
      company: (org && (org.name || org)) || '',
      posting: url,
    });
  }
  const og = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)/i);
  if (og && og[1] && og[1].length > 80) return pack(og[1], 'og', { posting: url });
  return null;
}

async function fetchJdForUrl(url, linkedin) {
  const targets = [url, linkedin].filter(Boolean);
  let lastErr = null;
  for (const href of targets) {
    const parsed = parseAtsJob(href);
    try {
      if (parsed && parsed.ats === 'greenhouse') {
        const hit = await fetchGreenhouse(parsed);
        if (hit) return hit;
      }
      if (parsed && parsed.ats === 'lever') {
        const hit = await fetchLever(parsed);
        if (hit) return hit;
      }
      if (parsed && parsed.ats === 'ashby') {
        const hit = await fetchAshby(parsed);
        if (hit) return hit;
      }
      if (parsed && parsed.ats === 'smartrecruiters') {
        const hit = await fetchSmartRecruiters(parsed);
        if (hit) return hit;
      }
    } catch (err) {
      lastErr = err;
    }
    try {
      const html = await fetchHtmlJd(href);
      if (html) return html;
    } catch (err) {
      lastErr = err;
    }
  }
  if (lastErr) console.warn('[magnet] jd-ingest', lastErr.message || lastErr);
  return null;
}

function jdFromBoardText(text, extra = {}) {
  return pack(text, extra.source || 'ats-json', extra);
}

async function mapPool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) || 1 }, worker));
  return out;
}

module.exports = {
  stripHtml,
  parseAtsJob,
  fetchJdForUrl,
  jdFromBoardText,
  mapPool,
  pack,
};
