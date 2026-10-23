const nav = document.getElementById('sections');
const listEl = document.getElementById('list');
const detailEl = document.getElementById('detail');
const statusEl = document.getElementById('status');
const searchEl = document.getElementById('q');
const workEl = document.querySelector('.work');

let catalog = [];
let section = null;
let rows = [];
let total = 0;
let selected = '';
let draft = null;
let yamlText = '';
let raw = false;
let meta = null;
let limit = 80;
let q = '';
let searchTimer = null;

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function api() {
  return window.magnetInsights;
}

function setStatus(text, bad) {
  statusEl.textContent = text || '';
  statusEl.classList.toggle('bad', Boolean(bad));
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function pathAttr(path) {
  return esc(JSON.stringify(path));
}

function setPath(root, path, value) {
  let cur = root;
  for (let i = 0; i < path.length - 1; i++) {
    if (cur[path[i]] == null || typeof cur[path[i]] !== 'object') cur[path[i]] = {};
    cur = cur[path[i]];
  }
  cur[path[path.length - 1]] = value;
}

function labelOf(key) {
  return String(key).replace(/_/g, ' ');
}

function blankItem(path, value) {
  const sample = (value || []).find((item) => item && typeof item === 'object' && !Array.isArray(item));
  if (sample) {
    const blank = {};
    for (const key of Object.keys(sample)) {
      const child = sample[key];
      if (typeof child === 'boolean') blank[key] = false;
      else if (typeof child === 'number') blank[key] = 0;
      else if (Array.isArray(child)) blank[key] = [];
      else if (child && typeof child === 'object') blank[key] = {};
      else blank[key] = '';
    }
    return blank;
  }
  const leaf = path[path.length - 1];
  if (leaf === 'education') {
    return { school: '', degree: '', start: '', end: '', current: false, gpa: '', gpa_scale: '', honors: false };
  }
  if (leaf === 'employment') {
    return { employer: '', title: '', start: '', end: '', current: false, location: '', bullets: '' };
  }
  if (leaf === 'people') return { name: '', relation: '' };
  return '';
}

function blankKey(path) {
  const parent = path[path.length - 1];
  if (parent === 'skills') return { years: 0, since: '', aliases: [] };
  if (parent === 'answers') return { label: '', value: '', class: '', confidence: 'confirmed', source: 'library' };
  return '';
}

function blankDraft(id) {
  if (id === 'cards') {
    return {
      employer: '',
      claim: '',
      proof: '',
      honesty_bound: '',
      confidence: 'corroborated',
      source: 'library',
      tags: [],
      people: [],
      shapes: [],
    };
  }
  if (id === 'notes') return { employer: '', at: new Date().toISOString(), text: '' };
  if (id === 'timeline') return { employer: '', title: '', start: '', end: '', location: '', current: false };
  if (id === 'bindings') return { question_shape: '', card_id: '', tag: '', source: 'library' };
  if (id === 'moments') return { text: '', tags: '', confidence: '', source: 'library' };
  if (id === 'positions') return { text: '', source: 'library' };
  if (id === 'recipes') return { label_key: '', label_includes: [], host_includes: [], profile_key: '', value: '' };
  if (id === 'aliases') return { class: '', phrase: '' };
  if (id === 'boards') return { company: '', ats: '', slug: '', source_url: '' };
  return {};
}

function control(path, value) {
  const name = labelOf(path[path.length - 1] || 'value');
  const leaf = String(path[path.length - 1] || '');
  if (typeof value === 'boolean') {
    return `<label class="field bool"><input class="check" type="checkbox" data-path="${pathAttr(path)}" data-kind="bool"${value ? ' checked' : ''} /> ${esc(name)}</label>`;
  }
  if (leaf === 'confidence' || leaf.endsWith('confidence')) {
    const options = ['unverified', 'corroborated', 'confirmed'];
    if (value && !options.includes(value)) options.unshift(value);
    const opts = options
      .map((option) => `<option value="${esc(option)}"${option === value ? ' selected' : ''}>${esc(option)}</option>`)
      .join('');
    return `<label class="field">${esc(name)}<select data-path="${pathAttr(path)}" data-kind="text">${opts}</select></label>`;
  }
  if (typeof value === 'number') {
    return `<label class="field">${esc(name)}<input type="number" data-path="${pathAttr(path)}" data-kind="number" value="${esc(value)}" /></label>`;
  }
  const text = value == null ? '' : String(value);
  const long = text.length > 80 || text.includes('\n');
  const kind = value == null ? 'nullish' : 'text';
  if (long) {
    return `<label class="field">${esc(name)}<textarea data-path="${pathAttr(path)}" data-kind="${kind}">${esc(text)}</textarea></label>`;
  }
  return `<label class="field">${esc(name)}<input type="text" data-path="${pathAttr(path)}" data-kind="${kind}" value="${esc(text)}" /></label>`;
}

function canRemoveKey(path) {
  return path.length === 2 && ['skills', 'answers', 'policy'].includes(path[0]);
}

function renderNode(path, value) {
  if (Array.isArray(value)) {
    const primitive = value.every((item) => item == null || typeof item !== 'object');
    if (primitive) {
      return `<label class="field">${esc(labelOf(path[path.length - 1] || 'list'))}<textarea data-path="${pathAttr(path)}" data-kind="lines">${esc(value.join('\n'))}</textarea></label>`;
    }
    const cards = value
      .map((item, index) => {
        const child = path.concat(index);
        return `<fieldset data-block><legend>${esc(labelOf(path[path.length - 1] || 'item'))} ${index + 1}</legend>${renderNode(child, item)}<button type="button" class="btn ghost" data-remove="${pathAttr(child)}">Remove</button></fieldset>`;
      })
      .join('');
    return `${cards}<button type="button" class="btn" data-add="${pathAttr(path)}">Add</button>`;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    const fields = keys
      .map((key) => {
        const child = path.concat(key);
        const inner = renderNode(child, value[key]);
        const remove = canRemoveKey(child) ? `<button type="button" class="btn ghost" data-remove-key="${pathAttr(child)}">Remove</button>` : '';
        if (value[key] && typeof value[key] === 'object') {
          return `<fieldset data-block><legend>${esc(labelOf(key))}</legend>${inner}${remove}</fieldset>`;
        }
        return `<div data-block>${inner}${remove}</div>`;
      })
      .join('');
    const parent = path[path.length - 1];
    const adder = ['skills', 'answers', 'policy'].includes(parent)
      ? `<div class="actions"><input type="text" data-new-key="${pathAttr(path)}" placeholder="New ${esc(labelOf(parent))} key" /><button type="button" class="btn" data-add-key="${pathAttr(path)}">Add</button></div>`
      : '';
    if (!path.length) return fields + adder;
    return fields + adder;
  }
  return control(path, value);
}

function renderNav() {
  const groups = [];
  for (const row of catalog) {
    const last = groups[groups.length - 1];
    if (!last || last.name !== row.group) groups.push({ name: row.group, rows: [row] });
    else last.rows.push(row);
  }
  nav.innerHTML = groups
    .map((group) => {
      const buttons = group.rows
        .map((row) => {
          const on = section && section.id === row.id ? ' on' : '';
          const count = row.count == null ? '' : `<span class="n">${esc(row.count)}</span>`;
          return `<button type="button" class="sec${on}" data-section="${esc(row.id)}"><span>${esc(row.label)}</span>${count}</button>`;
        })
        .join('');
      return `<div class="group">${esc(group.name)}</div>${buttons}`;
    })
    .join('');
}

function renderList() {
  workEl.classList.toggle('single', Boolean(section && section.single));
  if (!section || section.single) {
    listEl.innerHTML = '';
    return;
  }
  if (!rows.length) {
    listEl.innerHTML = '<p class="empty">Nothing in this section yet.</p>';
    return;
  }
  const items = rows
    .map((row) => {
      const on = row.id === selected ? ' on' : '';
      return `<button type="button" class="item${on}" data-id="${esc(row.id)}"><b>${esc(row.title)}</b><span>${esc(row.subtitle || '')}</span></button>`;
    })
    .join('');
  const more = rows.length < total ? `<button type="button" class="more" id="more">Show more (${rows.length} of ${total})</button>` : '';
  listEl.innerHTML = items + more;
}

function renderDetail() {
  if (!section) {
    detailEl.innerHTML = '';
    return;
  }
  if (!draft && !section.single) {
    detailEl.innerHTML = `<p class="help">${esc(section.help || '')}</p><p class="empty">Select a row${section.create ? ', or add one.' : '.'}</p>`;
    return;
  }
  const actions = [];
  if (section.edit) actions.push(`<button type="button" class="btn" id="save">${raw && section.mode === 'profile' ? 'Save YAML' : 'Save'}</button>`);
  if (section.create) actions.push('<button type="button" class="btn" id="create">New</button>');
  if (section.edit && (section.mode === 'record' || section.mode === 'profile')) {
    actions.push(`<button type="button" class="btn ghost" id="raw">${raw ? 'Form' : section.mode === 'profile' ? 'Raw YAML' : 'Raw JSON'}</button>`);
  }
  if (section.remove && selected) actions.push('<button type="button" class="btn danger" id="delete">Delete</button>');
  const metaLine = meta
    ? `<p class="meta">${esc([meta.id, meta.created_at, (meta.links || []).map((link) => `${link.kind} ${link.to_id}`).join(', ')].filter(Boolean).join(' · '))}</p>`
    : '';
  let body = '';
  if (section.mode === 'text' || section.mode === 'yaml') {
    body = `<textarea class="raw" id="text-body">${esc((draft && draft.text) || '')}</textarea>`;
  } else if (!section.edit) {
    body = `<pre class="json">${esc(JSON.stringify(draft, null, 2))}</pre>`;
  } else if (raw && section.mode === 'profile') {
    body = `<textarea class="raw" id="text-body">${esc(yamlText || '')}</textarea>`;
  } else if (raw) {
    body = `<textarea class="raw" id="text-body">${esc(JSON.stringify(draft, null, 2))}</textarea>`;
  } else {
    const filter = section.id === 'profile' ? '<input class="filter" id="detail-filter" type="search" placeholder="Filter fields" />' : '';
    body = `${filter}<div id="form">${renderNode([], draft || {})}</div>`;
  }
  detailEl.innerHTML = `<div class="detail-head"><div><p class="help">${esc(section.help || '')}</p>${metaLine}</div><div class="actions">${actions.join('')}</div></div>${body}`;
}

function showError(error) {
  setStatus(error || 'Something failed', true);
}

async function loadCatalog() {
  const out = await api().libraryCatalog();
  if (!out || out.error) {
    showError(out && out.error);
    return;
  }
  catalog = out.sections || [];
  renderNav();
}

async function openSection(id, keepQuery) {
  section = catalog.find((row) => row.id === id) || null;
  if (!section) return;
  if (!keepQuery) {
    selected = '';
    draft = null;
    meta = null;
    raw = false;
    limit = 80;
  }
  renderNav();
  const out = await api().libraryQuery({ section: id, q, limit });
  if (!out || out.error) {
    rows = [];
    total = 0;
    renderList();
    detailEl.innerHTML = '';
    showError(out && out.error);
    return;
  }
  section = { ...section, ...out, rows: undefined, record: undefined };
  rows = out.rows || [];
  total = out.total || rows.length;
  const navRow = catalog.find((row) => row.id === id);
  if (navRow) navRow.count = total;
  renderNav();
  renderList();
  if (section.single) {
    draft = clone(out.record);
    yamlText = out.yaml || '';
    renderDetail();
  } else if (!keepQuery) {
    draft = null;
    meta = null;
    renderDetail();
  }
  setStatus('');
}

async function openRow(id) {
  selected = id;
  raw = false;
  renderList();
  const out = await api().libraryRead({ section: section.id, id });
  if (!out || out.error) {
    showError(out && out.error);
    return;
  }
  draft = clone(out.record);
  meta = out.meta || null;
  renderDetail();
  setStatus('');
}

function readTextBody() {
  const box = document.getElementById('text-body');
  return box ? box.value : '';
}

async function save() {
  if (!section || !section.edit) return;
  let record = draft;
  let action = selected ? 'save' : 'create';
  if (section.mode === 'text' || section.mode === 'yaml') {
    record = { text: readTextBody() };
    action = 'save';
  } else if (raw && section.mode === 'profile') {
    record = { text: readTextBody() };
    action = 'yaml';
  } else if (raw) {
    try {
      record = JSON.parse(readTextBody());
    } catch (err) {
      showError(`JSON: ${err.message || err}`);
      return;
    }
  }
  if (section.single) action = section.mode === 'profile' && raw ? 'yaml' : 'save';
  const out = await api().libraryWrite({ section: section.id, action, id: selected, record });
  if (!out || out.error || out.ok === false) {
    showError((out && (out.error || 'Save failed')) || 'Save failed');
    return;
  }
  const nextId = out.id || selected;
  await openSection(section.id, true);
  if (nextId && !section.single) await openRow(nextId);
  else if (section.single) renderDetail();
  setStatus('Saved.');
}

async function remove() {
  if (!section || !selected) return;
  const out = await api().libraryWrite({ section: section.id, action: 'delete', id: selected });
  if (!out || out.error || out.ok === false) {
    showError((out && out.error) || 'Delete failed');
    return;
  }
  selected = '';
  draft = null;
  meta = null;
  await openSection(section.id, true);
  renderDetail();
  setStatus('Deleted.');
}

function startNew() {
  selected = '';
  meta = null;
  raw = false;
  draft = blankDraft(section && section.id);
  renderList();
  renderDetail();
  setStatus('');
}

function toggleRaw() {
  if (raw && section && section.mode !== 'profile' && section.mode === 'record') {
    try {
      draft = JSON.parse(readTextBody());
    } catch (err) {
      showError(`JSON: ${err.message || err}`);
      return;
    }
  }
  if (raw && section && section.mode === 'profile') yamlText = readTextBody();
  raw = !raw;
  renderDetail();
}

nav.addEventListener('click', (event) => {
  const button = event.target.closest('[data-section]');
  if (!button) return;
  q = '';
  searchEl.value = '';
  openSection(button.getAttribute('data-section')).catch((err) => showError(err.message || err));
});

listEl.addEventListener('click', (event) => {
  if (event.target.closest('#more')) {
    limit += 80;
    openSection(section.id, true).catch((err) => showError(err.message || err));
    return;
  }
  const button = event.target.closest('[data-id]');
  if (!button) return;
  openRow(button.getAttribute('data-id')).catch((err) => showError(err.message || err));
});

detailEl.addEventListener('input', (event) => {
  const el = event.target.closest('[data-path]');
  if (!el || !draft || raw) return;
  const path = JSON.parse(el.getAttribute('data-path'));
  let value = el.value;
  if (el.dataset.kind === 'bool') value = el.checked;
  else if (el.dataset.kind === 'number') value = value === '' ? null : Number(value);
  else if (el.dataset.kind === 'nullish') value = value === '' ? null : value;
  else if (el.dataset.kind === 'lines') value = value ? value.split('\n') : [];
  setPath(draft, path, value);
});

detailEl.addEventListener('change', (event) => {
  const el = event.target.closest('[data-path]');
  if (!el || !draft || el.dataset.kind !== 'bool') return;
  setPath(draft, JSON.parse(el.getAttribute('data-path')), el.checked);
});

detailEl.addEventListener('click', (event) => {
  if (event.target.closest('#save')) {
    save().catch((err) => showError(err.message || err));
    return;
  }
  if (event.target.closest('#delete')) {
    remove().catch((err) => showError(err.message || err));
    return;
  }
  if (event.target.closest('#create')) {
    startNew();
    return;
  }
  if (event.target.closest('#raw')) {
    toggleRaw();
    return;
  }
  const add = event.target.closest('[data-add]');
  if (add && draft) {
    const path = JSON.parse(add.getAttribute('data-add'));
    let list = draft;
    for (const key of path) list = list[key];
    list.push(blankItem(path, list));
    renderDetail();
    return;
  }
  const removeItem = event.target.closest('[data-remove]');
  if (removeItem && draft) {
    const path = JSON.parse(removeItem.getAttribute('data-remove'));
    const index = path[path.length - 1];
    let list = draft;
    for (const key of path.slice(0, -1)) list = list[key];
    list.splice(index, 1);
    renderDetail();
    return;
  }
  const addKey = event.target.closest('[data-add-key]');
  if (addKey && draft) {
    const path = JSON.parse(addKey.getAttribute('data-add-key'));
    const input = addKey.previousElementSibling;
    const key = input ? input.value.trim() : '';
    if (!key) return;
    let obj = draft;
    for (const part of path) obj = obj[part];
    if (obj[key] != null) {
      showError('That key is already there.');
      return;
    }
    obj[key] = blankKey(path);
    if (path[path.length - 1] === 'answers' && obj[key] && typeof obj[key] === 'object') obj[key].label = key;
    renderDetail();
    return;
  }
  const removeKey = event.target.closest('[data-remove-key]');
  if (removeKey && draft) {
    const path = JSON.parse(removeKey.getAttribute('data-remove-key'));
    const key = path[path.length - 1];
    let obj = draft;
    for (const part of path.slice(0, -1)) obj = obj[part];
    delete obj[key];
    renderDetail();
  }
});

detailEl.addEventListener('input', (event) => {
  if (event.target.id !== 'detail-filter') return;
  const needle = event.target.value.trim().toLowerCase();
  detailEl.querySelectorAll('#form [data-block]').forEach((block) => {
    block.hidden = Boolean(needle) && !block.innerText.toLowerCase().includes(needle);
  });
});

searchEl.addEventListener('input', () => {
  q = searchEl.value;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    if (section) openSection(section.id, true).catch((err) => showError(err.message || err));
  }, 200);
});

document.getElementById('refresh').addEventListener('click', () => {
  const id = (section && section.id) || 'cards';
  const row = selected;
  loadCatalog()
    .then(() => openSection(id, false))
    .then(() => (row && section && !section.single ? openRow(row) : null))
    .catch((err) => showError(err.message || err));
});

document.addEventListener('click', (event) => {
  const page = event.target.closest('[data-page]');
  if (!page || !api() || !api().openPage) return;
  const name = page.getAttribute('data-page');
  if (name && name !== 'library') api().openPage(name);
});

if (!api()) {
  setStatus('Library preload is missing.', true);
} else {
  loadCatalog()
    .then(() => openSection('cards'))
    .catch((err) => showError(err.message || err));
}
