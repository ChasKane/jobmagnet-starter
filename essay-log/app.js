const qEl = document.getElementById('q');
const companyEl = document.getElementById('company');
const sortEl = document.getElementById('sort');
const uniqueEl = document.getElementById('unique');
const shortEl = document.getElementById('short');
const listEl = document.getElementById('list');
const countEl = document.getElementById('count');

let timer = null;
let lastCompanies = [];

function opts() {
  return {
    q: qEl.value || '',
    company: companyEl.value || '',
    sort: sortEl.value || 'ts',
    unique: uniqueEl.checked,
    min: shortEl.checked ? 0 : 40,
    all: shortEl.checked,
    limit: 200,
  };
}

function queryString(params) {
  const qs = new URLSearchParams();
  if (params.q) qs.set('q', params.q);
  if (params.company) qs.set('company', params.company);
  if (params.sort) qs.set('sort', params.sort);
  qs.set('unique', params.unique ? '1' : '0');
  qs.set('min', String(params.min));
  qs.set('all', params.all ? '1' : '0');
  qs.set('limit', String(params.limit));
  return qs.toString();
}

async function loadEssays(params) {
  if (window.magnetEssayLog && typeof window.magnetEssayLog.list === 'function') {
    return window.magnetEssayLog.list(params);
  }
  const res = await fetch(`/essay-log?${queryString(params)}`);
  if (!res.ok) throw new Error('essay-log ' + res.status);
  return res.json();
}

function fillCompanies(names) {
  const current = companyEl.value;
  const next = names || [];
  if (next.join('\u0001') === lastCompanies.join('\u0001')) return;
  lastCompanies = next;
  companyEl.innerHTML = '';
  const all = document.createElement('option');
  all.value = '';
  all.textContent = 'All';
  companyEl.appendChild(all);
  for (const name of next) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    companyEl.appendChild(opt);
  }
  if (current && next.includes(current)) companyEl.value = current;
}

function card(row) {
  const el = document.createElement('article');
  el.className = 'card';
  const meta = document.createElement('div');
  meta.className = 'card-meta';
  const company = document.createElement('button');
  company.type = 'button';
  company.className = 'btn company';
  company.textContent = row.company || 'Unknown';
  company.addEventListener('click', () => {
    companyEl.value = row.company || '';
    refresh();
  });
  const when = document.createElement('span');
  when.className = 'when';
  when.textContent = String(row.ts || '').slice(0, 10) || 'undated';
  const origin = document.createElement('span');
  origin.className = 'origin';
  origin.textContent = row.origin || '';
  meta.append(company, when);
  if (row.origin) meta.append(origin);
  const question = document.createElement('p');
  question.className = 'question';
  question.textContent = row.label;
  const body = document.createElement('pre');
  body.className = 'body';
  body.textContent = row.text;
  const actions = document.createElement('div');
  actions.className = 'card-actions';
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'btn';
  copy.textContent = 'Copy';
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(`${row.label}\n\n${row.text}`);
      copy.textContent = 'Copied';
      setTimeout(() => {
        copy.textContent = 'Copy';
      }, 1200);
    } catch (_) {
      copy.textContent = 'Copy failed';
    }
  });
  actions.append(copy);
  if (row.url) {
    const link = document.createElement('a');
    link.className = 'link';
    link.href = row.url;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.textContent = 'Application';
    actions.append(link);
  }
  el.append(meta, question, body, actions);
  return el;
}

async function refresh() {
  const params = opts();
  const out = await loadEssays(params);
  fillCompanies(out.companies || []);
  countEl.textContent = String(out.total || 0);
  listEl.innerHTML = '';
  const rows = out.essays || [];
  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = shortEl.checked ? 'No application-log answers matched.' : 'No user drafts matched.';
    listEl.appendChild(empty);
    return;
  }
  for (const row of rows) listEl.appendChild(card(row));
}

function queueRefresh() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    refresh().catch((err) => {
      listEl.textContent = String(err.message || err);
    });
  }, 80);
}

qEl.addEventListener('input', queueRefresh);
companyEl.addEventListener('change', queueRefresh);
sortEl.addEventListener('change', queueRefresh);
uniqueEl.addEventListener('change', queueRefresh);
shortEl.addEventListener('change', queueRefresh);
refresh().catch((err) => {
  listEl.textContent = String(err.message || err);
});
