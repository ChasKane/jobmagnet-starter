const app = document.getElementById('app');

let view = null;
let config = null;
let formDraft = null;
let replaceForm = false;
let titleTimer = null;
let focusRestore = null;
let saveQueue = Promise.resolve();

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pct(value) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return `${Math.round(Number(value) * 1000) / 10}%`;
}

function num(value) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  const rounded = Math.round(Number(value) * 10) / 10;
  return String(rounded);
}

function blankConfig() {
  return { grain: 'week', title: '', ranks: [], charts: [], styles: [] };
}

function draft() {
  return JSON.parse(JSON.stringify(config || (view && view.config) || blankConfig()));
}

function pair(count, rate) {
  if (!count) return '0';
  return `${count} · ${pct(rate)}`;
}

function summaryCard(label, value) {
  return `<div class="stat"><b>${esc(value)}</b><span>${esc(label)}</span></div>`;
}

function chartCard(chart) {
  const metrics = (view.metrics || []).map((metric) => {
    const on = chart.metrics.includes(metric.key) ? ' on' : '';
    return `<button type="button" class="chip metric${on}" data-metric="${esc(metric.key)}" data-chart="${esc(chart.id)}">${esc(metric.label)}</button>`;
  });
  const kinds = new Set((chart.series || []).map((row) => row.kind));
  const scaled = (chart.series || []).filter((row) => row.kind !== 'count').length;
  const hint =
    (kinds.has('count') && scaled) || scaled > 1
      ? '<p class="hint">Lines are scaled to their own peak, so a word count can share the graph with a rate. Hover a point for the real value.</p>'
      : '';
  const legend = (chart.series || [])
    .map((row) => `<span class="legend"><i style="background:${esc(row.color)}"></i>${esc(row.label)}</span>`)
    .join('');
  const body = chart.svg
    ? chart.svg
    : '<p class="empty">Nothing in this filter yet.</p>';
  return `<article class="card">
    <div class="card-head">
      <input type="text" data-chart-title="${esc(chart.id)}" value="${esc(chart.title)}" aria-label="Graph title" />
      <span class="actions">
        <button type="button" class="btn ghost" data-move="${esc(chart.id)}" data-dir="-1">Up</button>
        <button type="button" class="btn ghost" data-move="${esc(chart.id)}" data-dir="1">Down</button>
        <button type="button" class="btn ghost" data-remove-chart="${esc(chart.id)}">Remove</button>
      </span>
    </div>
    <div class="metrics">${metrics.join('')}</div>
    ${body}
    <div class="legend">${legend}</div>
    ${hint}
  </article>`;
}

function styleRow(style) {
  const scope = [
    style.title ? `title “${style.title}”` : '',
    style.ranks && style.ranks.length ? style.ranks.join(', ') : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const when = `${style.start} → ${style.end || 'now'}`;
  return `<div class="style-row">
    <div>
      <div class="style-name"><i class="swatch" style="background:${esc(style.color || '#38bdf8')}"></i><strong>${esc(style.name)}</strong></div>
      <div class="style-notes">${esc(when)}${scope ? ` · ${esc(scope)}` : ''}${style.notes ? ` — ${esc(style.notes)}` : ''}</div>
    </div>
    <span class="actions">
      <button type="button" class="btn ghost" data-edit-style="${esc(style.id)}">Edit</button>
      <button type="button" class="btn ghost" data-remove-style="${esc(style.id)}">Delete</button>
    </span>
  </div>`;
}

function comparisonTable(rows) {
  if (!rows || !rows.length) {
    return '<p class="empty">Name a style with the dates you were sending it. The table assigns each scanned reply to the style active when you submitted, which is the comparison to use for an A/B read.</p>';
  }
  const body = rows
    .map((row) => {
      return `<tr>
        <td><div class="style-name"><i class="swatch" style="background:${esc(row.color)}"></i>${esc(row.name)}</div>${row.notes ? `<div class="style-notes">${esc(row.notes)}</div>` : ''}</td>
        <td>${row.start ? `${esc(row.start)} → ${esc(row.end || 'now')}` : '—'}</td>
        <td>${esc(row.submissions)}</td>
        <td>${esc(pair(row.confirmed, row.confirmRate))}</td>
        <td>${esc(pair(row.rejected, row.rejectRate))}</td>
        <td>${esc(pair(row.interviews, row.interviewRate))}</td>
        <td>${esc(row.essays)}</td>
        <td>${esc(num(row.meanWords))}</td>
        <td>${esc(pct(row.rewriteShare))}</td>
      </tr>`;
    })
    .join('');
  return `<div class="table-wrap"><table>
    <thead><tr>
      <th>Style</th><th>Window</th><th>Submits</th><th>Confirmed</th><th>Rejected</th><th>Interview</th><th>Essays</th><th>Words</th><th>Rewrite</th>
    </tr></thead>
    <tbody>${body}</tbody>
  </table></div>`;
}

function rankChips(ranks, selected, attr) {
  return (ranks || [])
    .map((rank) => {
      const on = selected.includes(rank.id) ? ' on' : '';
      return `<button type="button" class="chip${on}" ${attr}="${esc(rank.id)}">${esc(rank.label)}</button>`;
    })
    .join('');
}

function styleColor(style) {
  const row = (view.comparison || []).find((item) => item.id === style.id);
  return (row && row.color) || '#38bdf8';
}

function formStyle() {
  return formDraft || { name: '', start: '', end: '', notes: '', title: '', ranks: [] };
}

function syncForm() {
  const name = document.getElementById('style-name');
  if (!name) return;
  formDraft = {
    id: formDraft && formDraft.id,
    name: name.value,
    start: document.getElementById('style-start').value,
    end: document.getElementById('style-end').value,
    title: document.getElementById('style-title').value,
    notes: document.getElementById('style-notes').value,
    ranks: [...document.querySelectorAll('[data-style-rank].on')].map((node) => node.getAttribute('data-style-rank')),
  };
}

function render() {
  if (!replaceForm) syncForm();
  replaceForm = false;
  const active = document.activeElement;
  if (active && active.id) focusRestore = { id: active.id, start: active.selectionStart, end: active.selectionEnd };
  if (!view) {
    app.textContent = 'Loading insights…';
    return;
  }
  if (view.error && !view.config) {
    app.innerHTML = `<p class="error">${esc(view.error)}</p>`;
    return;
  }
  const cfg = config || view.config || blankConfig();
  const summary = view.summary || {};
  const form = formStyle();
  const footnotes = [];
  if (summary.undated) footnotes.push(`${summary.undated} submitted without a date, left off the timeline.`);
  if (summary.receivedUnmatched) footnotes.push(`${summary.receivedUnmatched} confirmation${summary.receivedUnmatched === 1 ? '' : 's'} did not match an application.`);
  if (summary.hiddenMail) footnotes.push(`${summary.hiddenMail} scanned message${summary.hiddenMail === 1 ? '' : 's'} hidden by the title or rank filter.`);
  app.innerHTML = `
    <header class="toolbar">
      <nav class="views" aria-label="Insights and library">
        <button type="button" class="chip on" data-page="insights">Insights</button>
        <button type="button" class="chip" data-page="library">Library</button>
      </nav>
      <div class="brand">
        <h1>Insights</h1>
        <button type="button" class="btn ghost" data-refresh>Refresh</button>
      </div>
      <p class="note">Submissions, scanned mail, and essay style on one timeline. Story cards, the autofill profile, and the raw logs are in Library. Dates are UTC, the same clock Magnet stores.</p>
      <div class="filters">
        <label class="field">Title contains
          <input id="title-filter" type="search" value="${esc(cfg.title || '')}" placeholder="frontend, backend…" />
        </label>
        <label class="field">Bucket
          <select id="grain">
            <option value="day"${cfg.grain === 'day' ? ' selected' : ''}>Day</option>
            <option value="week"${cfg.grain === 'week' ? ' selected' : ''}>Week</option>
            <option value="month"${cfg.grain === 'month' ? ' selected' : ''}>Month</option>
          </select>
        </label>
        <div class="field">Rank
          <div class="ranks">${rankChips(view.ranks, cfg.ranks || [], 'data-rank')}</div>
        </div>
      </div>
    </header>
    <section class="summary">
      ${summaryCard('Submissions', summary.submissions || 0)}
      ${summaryCard('Confirmed', summary.confirmed || 0)}
      ${summaryCard('Rejected', summary.rejected || 0)}
      ${summaryCard('Interviews', summary.interviews || 0)}
      ${summaryCard('Essays', summary.essays || 0)}
      ${summaryCard('Mean words', num(summary.meanWords))}
      ${summaryCard('Rewrite share', pct(summary.rewriteShare))}
    </section>
    ${footnotes.length ? `<p class="foot">${esc(footnotes.join(' '))}</p>` : ''}
    ${view.error ? `<p class="error">${esc(view.error)}</p>` : ''}
    <section class="section">
      <div class="section-head">
        <h2>Graphs</h2>
        <button type="button" class="btn primary" data-add-chart>Add graph</button>
      </div>
      <p class="hint">Turn series on or off per graph. Shaded bands are the essay styles below. Mail is plotted on the day it arrived.</p>
      ${(view.charts || []).length ? (view.charts || []).map(chartCard).join('') : '<p class="empty">Add a graph to plot a series.</p>'}
    </section>
    <section class="section">
      <div class="section-head"><h2>Essay styles</h2></div>
      <p class="hint">A style is the essay you were sending between two dates. Add one when the writing changes. The table compares outcomes for applications submitted in that window, even if the reply arrived later.</p>
      <div class="style-list">${(cfg.styles || []).map((style) => styleRow({ ...style, color: styleColor(style) })).join('') || '<p class="empty">No styles yet.</p>'}</div>
      <form id="style-form" class="form">
        <label class="field">Name
          <input id="style-name" type="text" value="${esc(form.name || '')}" placeholder="Short hook" required />
        </label>
        <label class="field">Start
          <input id="style-start" type="date" value="${esc(form.start || '')}" required />
        </label>
        <label class="field">End
          <input id="style-end" type="date" value="${esc(form.end || '')}" />
        </label>
        <label class="field">Limit to title
          <input id="style-title" type="text" value="${esc(form.title || '')}" placeholder="optional" />
        </label>
        <label class="field wide">What changed
          <textarea id="style-notes" placeholder="Shorter open, one concrete project, no bio.">${esc(form.notes || '')}</textarea>
        </label>
        <div class="field wide">Limit to rank
          <div class="ranks">${rankChips(view.ranks, form.ranks || [], 'data-style-rank')}</div>
        </div>
        <div class="actions wide">
          <button type="submit" class="btn primary">${formDraft && formDraft.id ? 'Update style' : 'Add style'}</button>
          ${formDraft && formDraft.id ? '<button type="button" class="btn ghost" data-cancel-style>Cancel</button>' : ''}
          <span id="style-error" class="error"></span>
        </div>
      </form>
    </section>
    <section class="section">
      <h2>Style comparison</h2>
      ${comparisonTable(view.comparison)}
    </section>
  `;
  if (focusRestore) {
    const el = document.getElementById(focusRestore.id);
    if (el) {
      el.focus();
      if (focusRestore.start != null && el.setSelectionRange) {
        try {
          el.setSelectionRange(focusRestore.start, focusRestore.end);
        } catch (_) {}
      }
    }
    focusRestore = null;
  }
}

function persist(next) {
  config = JSON.parse(JSON.stringify(next));
  saveQueue = saveQueue.then(() => flush());
  return saveQueue;
}

async function flush() {
  const sent = JSON.parse(JSON.stringify(config));
  try {
    const out = window.magnetInsights
      ? await window.magnetInsights.save(sent)
      : { error: 'Insights preload is missing.' };
    if (!out || (out.error && !out.charts)) {
      view = { ...(view || {}), ...(out || {}), error: (out && out.error) || 'Save failed' };
      render();
      return;
    }
    view = out;
    if (out.config && JSON.stringify(config) === JSON.stringify(sent)) config = out.config;
    render();
  } catch (err) {
    view = { ...(view || {}), error: (err && err.message) || 'Save failed' };
    render();
  }
}

function selectedStyleRanks() {
  return [...document.querySelectorAll('[data-style-rank].on')].map((node) => node.getAttribute('data-style-rank'));
}

function readStyleForm() {
  return {
    id: formDraft && formDraft.id,
    name: document.getElementById('style-name').value.trim(),
    start: document.getElementById('style-start').value,
    end: document.getElementById('style-end').value,
    title: document.getElementById('style-title').value.trim(),
    notes: document.getElementById('style-notes').value.trim(),
    ranks: selectedStyleRanks(),
  };
}

async function refresh() {
  try {
    if (!window.magnetInsights) {
      view = { error: 'Insights preload is missing.' };
      render();
      return;
    }
    const out = await window.magnetInsights.get();
    view = out;
    if (out && out.config) config = out.config;
    replaceForm = true;
    render();
  } catch (err) {
    view = { error: (err && err.message) || 'Insights failed' };
    render();
  }
}

app.addEventListener('click', (event) => {
  const page = event.target.closest('[data-page]');
  if (page) {
    const name = page.getAttribute('data-page');
    if (name && name !== 'insights' && window.magnetInsights && window.magnetInsights.openPage) {
      window.magnetInsights.openPage(name);
    }
    return;
  }
  const rank = event.target.closest('[data-rank]');
  if (rank) {
    const id = rank.getAttribute('data-rank');
    const next = draft();
    const set = new Set(next.ranks || []);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    next.ranks = [...set];
    persist(next);
    return;
  }
  const styleRank = event.target.closest('[data-style-rank]');
  if (styleRank) {
    styleRank.classList.toggle('on');
    return;
  }
  const metric = event.target.closest('[data-metric]');
  if (metric) {
    const chartId = metric.getAttribute('data-chart');
    const key = metric.getAttribute('data-metric');
    const next = draft();
    const chart = next.charts.find((row) => row.id === chartId);
    if (!chart) return;
    if (chart.metrics.includes(key)) {
      if (chart.metrics.length === 1) return;
      chart.metrics = chart.metrics.filter((item) => item !== key);
    } else chart.metrics.push(key);
    persist(next);
    return;
  }
  const removeChart = event.target.closest('[data-remove-chart]');
  if (removeChart) {
    const id = removeChart.getAttribute('data-remove-chart');
    const next = draft();
    next.charts = next.charts.filter((chart) => chart.id !== id);
    persist(next);
    return;
  }
  const move = event.target.closest('[data-move]');
  if (move) {
    const id = move.getAttribute('data-move');
    const dir = Number(move.getAttribute('data-dir')) || 0;
    const next = draft();
    const index = next.charts.findIndex((chart) => chart.id === id);
    const target = index + dir;
    if (index < 0 || target < 0 || target >= next.charts.length) return;
    const [row] = next.charts.splice(index, 1);
    next.charts.splice(target, 0, row);
    persist(next);
    return;
  }
  if (event.target.closest('[data-add-chart]')) {
    const next = draft();
    next.charts.push({ id: `chart-${Date.now().toString(36)}`, title: 'Graph', metrics: ['submissions'] });
    persist(next);
    return;
  }
  const edit = event.target.closest('[data-edit-style]');
  if (edit) {
    const id = edit.getAttribute('data-edit-style');
    formDraft = (draft().styles || []).find((style) => style.id === id) || null;
    replaceForm = true;
    render();
    return;
  }
  const removeStyle = event.target.closest('[data-remove-style]');
  if (removeStyle) {
    const id = removeStyle.getAttribute('data-remove-style');
    const next = draft();
    next.styles = (next.styles || []).filter((style) => style.id !== id);
    if (formDraft && formDraft.id === id) {
      formDraft = null;
      replaceForm = true;
    }
    persist(next);
    return;
  }
  if (event.target.closest('[data-cancel-style]')) {
    formDraft = null;
    replaceForm = true;
    render();
    return;
  }
  if (event.target.closest('[data-refresh]')) {
    refresh();
  }
});

app.addEventListener('change', (event) => {
  if (event.target.id === 'grain') {
    const next = draft();
    next.grain = event.target.value;
    persist(next);
    return;
  }
  const title = event.target.getAttribute && event.target.getAttribute('data-chart-title');
  if (title) {
    const next = draft();
    const chart = next.charts.find((row) => row.id === title);
    if (!chart) return;
    chart.title = event.target.value.trim();
    persist(next);
  }
});

app.addEventListener('input', (event) => {
  if (event.target.id !== 'title-filter') return;
  const next = draft();
  next.title = event.target.value;
  config = next;
  clearTimeout(titleTimer);
  titleTimer = setTimeout(() => persist(draft()), 250);
});

app.addEventListener('submit', (event) => {
  if (!event.target || event.target.id !== 'style-form') return;
  event.preventDefault();
  const style = readStyleForm();
  const error = document.getElementById('style-error');
  if (!style.name || !style.start) {
    if (error) error.textContent = 'Name and start date are required.';
    return;
  }
  const next = draft();
  if (style.id) {
    const index = next.styles.findIndex((row) => row.id === style.id);
    if (index >= 0) next.styles[index] = { ...next.styles[index], ...style };
    else next.styles.push(style);
  } else {
    delete style.id;
    next.styles.push(style);
  }
  formDraft = null;
  replaceForm = true;
  persist(next);
});

if (window.magnetInsights && window.magnetInsights.onRefresh) window.magnetInsights.onRefresh(() => refresh());
refresh();
