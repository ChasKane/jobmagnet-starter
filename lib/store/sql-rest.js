/** SQLite-shaped store SQL → Supabase PostgREST. No Postgres socket. */

const api = require('./api');
const { loadEnv } = require('./mode');

const TABLE_RENAME = { events: 'graph_events' };

const JSONB_COLS = new Set([
  'jd',
  'posting',
  'extra',
  'identity',
  'eeo',
  'work',
  'policy',
  'model_params',
  'custom_models',
  'sidebar_filters',
  'shape',
  'steps',
  'payload',
  'messages',
  'folded',
  'output',
]);

const ARRAY_COLS = new Set([
  'industries',
  'skills',
  'source_card_ids',
  'aliases',
  'host_includes',
  'label_includes',
  'match_patterns',
  'keywords',
  'human_flags',
]);

const DELETE_ALL = {
  applicant_education: 'id=not.is.null',
  applicant_employment: 'id=not.is.null',
  applicant_skills: 'slug=not.is.null',
  applicant_answers: 'class=not.is.null',
  field_recipes: 'id=not.is.null',
  mail_messages: 'id=not.is.null',
  mail_queue: 'id=not.is.null',
  tag_rules: 'kind=not.is.null',
  strategy_scores: 'fingerprint=not.is.null',
  strategy_fingerprints: 'fingerprint=not.is.null',
  footprints: 'id=not.is.null',
  experience_notes: 'id=not.is.null',
  voice_pending_rules: 'id=not.is.null',
  essay_commits: 'id=not.is.null',
  answer_commits: 'id=not.is.null',
  llm_log: 'id=not.is.null',
  jobs: 'id=not.is.null',
  application_events: 'id=not.is.null',
  application_contacts: 'id=not.is.null',
  essays: 'id=not.is.null',
};

function rewriteSql(sql) {
  let text = String(sql || '').trim();
  const ignore = /\bINSERT\s+OR\s+IGNORE\s+INTO\b/i.test(text);
  const replace = /\bINSERT\s+OR\s+REPLACE\s+INTO\b/i.test(text);
  text = text.replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\b/gi, 'INSERT INTO');
  text = text.replace(/\bINSERT\s+OR\s+REPLACE\s+INTO\b/gi, 'INSERT INTO');
  text = text.replace(/\b(INTO|FROM|UPDATE|JOIN)\s+events\b/gi, '$1 graph_events');
  text = text.replace(/\bstart\s*,\s*end\s*,/gi, 'start, end_date,');
  text = text.replace(/\bend\s*=/gi, 'end_date =');
  return { text, ignore, replace };
}

function strip(sql) {
  return String(sql || '').replace(/\s+/g, ' ').trim();
}

function unquoteIdent(name) {
  return String(name || '')
    .replace(/^["`]|["`]$/g, '')
    .replace(/^\w+\./, '')
    .trim();
}

function tableName(name) {
  const raw = unquoteIdent(name).toLowerCase();
  return TABLE_RENAME[raw] || raw;
}

function encodeValue(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  const text = String(value);
  if (text === '') return '""';
  // Quoted filters break on ? (it splits the HTTP query) and on : (PostgREST casts).
  // Percent-encoding is what PostgREST decodes inside eq / in / or.
  return encodeURIComponent(text);
}

function inList(values) {
  return `(${values.map(encodeValue).join(',')})`;
}

/** PostgREST echoes the request URL in Content-Location. A long IN overflows Node's header cap. */
const IN_FILTER_MAX = 4500;

function inFilterText(pred) {
  return `${pred.col}=in.${inList(pred.values)}`;
}

function chunkInValues(col, values) {
  const chunks = [];
  let current = [];
  let len = `${col}=in.()`.length;
  for (const value of values) {
    const piece = encodeValue(value);
    const add = piece.length + (current.length ? 1 : 0);
    if (current.length && len + add > IN_FILTER_MAX) {
      chunks.push(current);
      current = [value];
      len = `${col}=in.()`.length + piece.length;
    } else {
      current.push(value);
      len += add;
    }
  }
  if (current.length) chunks.push(current);
  return chunks.length ? chunks : [[]];
}

function selectChunks(plan) {
  const where = plan && plan.where;
  if (!where || !where.preds || !where.preds.length) return [plan];
  const oversized = where.preds.filter((pred) => pred.type === 'in' && inFilterText(pred).length > IN_FILTER_MAX);
  if (!oversized.length) return [plan];
  if (where.kind === 'or') {
    const plans = [];
    for (const pred of where.preds) {
      if (pred.type === 'in' && inFilterText(pred).length > IN_FILTER_MAX) {
        for (const values of chunkInValues(pred.col, pred.values)) {
          plans.push({ ...plan, where: { kind: 'and', preds: [{ ...pred, values }] } });
        }
      } else {
        plans.push({ ...plan, where: { kind: 'and', preds: [pred] } });
      }
    }
    return plans;
  }
  const target = oversized[0];
  const rest = where.preds.filter((pred) => pred !== target);
  return chunkInValues(target.col, target.values).map((values) => ({
    ...plan,
    where: { kind: 'and', preds: [...rest, { ...target, values }] },
  }));
}

function concatRows(groups) {
  const seen = new Set();
  const out = [];
  for (const row of groups.flat()) {
    const key = row && row.id != null ? `id:${row.id}` : JSON.stringify(row);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function eqFilter(col, value) {
  if (value === null || value === undefined) return `${col}=is.null`;
  return `${col}=eq.${encodeValue(value)}`;
}

function readLiteral(text) {
  const s = String(text || '').trim();
  if (/^null$/i.test(s)) return null;
  if (/^true$/i.test(s)) return true;
  if (/^false$/i.test(s)) return false;
  if (/^'-?\d+(\.\d+)?'$/.test(s) || /^-?\d+(\.\d+)?$/.test(s)) return Number(String(s).replace(/^'|'$/g, ''));
  if (s.startsWith("'")) {
    return s
      .slice(1, s.endsWith("'") ? -1 : undefined)
      .replace(/''/g, "'");
  }
  return s;
}

function splitArgs(list) {
  const out = [];
  let cur = '';
  let depth = 0;
  let quote = null;
  for (let i = 0; i < list.length; i += 1) {
    const c = list[i];
    if (quote) {
      cur += c;
      if (c === quote) {
        if (list[i + 1] === quote) {
          cur += list[i + 1];
          i += 1;
        } else quote = null;
      }
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      cur += c;
      continue;
    }
    if (c === '(') {
      depth += 1;
      cur += c;
      continue;
    }
    if (c === ')') {
      depth -= 1;
      cur += c;
      continue;
    }
    if (c === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function splitClauses(text, sep) {
  const re = new RegExp(`^\\s+${sep}\\s+`, 'i');
  const out = [];
  let cur = '';
  let depth = 0;
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quote) {
      cur += c;
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      cur += c;
      continue;
    }
    if (c === '(') {
      depth += 1;
      cur += c;
      continue;
    }
    if (c === ')') {
      depth -= 1;
      cur += c;
      continue;
    }
    const m = depth === 0 ? text.slice(i).match(re) : null;
    if (m) {
      out.push(cur.trim());
      cur = '';
      i += m[0].length - 1;
      continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function bindToken(token, params, index) {
  const text = String(token || '').trim();
  const any = text.match(/^\?(?:::[\w\[\]]+)?$/);
  if (any || text === '?') {
    const value = params[index.n];
    index.n += 1;
    return { value, fromParam: true };
  }
  return { value: readLiteral(text), fromParam: false };
}

function parsePredicate(raw, params, index) {
  let text = String(raw || '').trim();
  if (text.startsWith('(') && text.endsWith(')')) text = text.slice(1, -1).trim();
  const anyEq = text.match(/^(.+?)\s*=\s*ANY\s*\(\s*\?(?:::[\w\[\]]+)?\s*\)$/i);
  if (anyEq) {
    const value = params[index.n];
    index.n += 1;
    return { type: 'in', col: unquoteIdent(anyEq[1]), values: Array.isArray(value) ? value : value == null ? [] : [value] };
  }
  const inEq = text.match(/^(.+?)\s+IN\s*\((.+)\)\s*$/i);
  if (inEq) {
    const values = splitArgs(inEq[2]).map((part) => bindToken(part, params, index).value);
    return { type: 'in', col: unquoteIdent(inEq[1]), values };
  }
  const lower = text.match(/^lower\s*\(\s*([\w.]+)\s*\)\s*=\s*lower\s*\(\s*\?\s*\)$/i);
  if (lower) {
    const value = params[index.n];
    index.n += 1;
    return { type: 'ilike', col: unquoteIdent(lower[1]), value };
  }
  const anyLit = text.match(/^\?\s*=\s*'([^']*)'$/);
  if (anyLit) {
    const value = params[index.n];
    index.n += 1;
    return { type: 'param_eq_lit', value, lit: anyLit[1] };
  }
  const eq = text.match(/^(.+?)\s*=\s*(.+)$/);
  if (eq) {
    const col = unquoteIdent(eq[1]);
    const right = bindToken(eq[2], params, index);
    return { type: 'eq', col, value: right.value };
  }
  throw new Error(`unsupported where clause: ${text}`);
}

function parseWhere(where, params, index) {
  if (!where) return { kind: 'all', preds: [] };
  const text = String(where).trim();
  if (/\sOR\s/i.test(text) && /\sAND\s/i.test(text)) {
    throw new Error(`unsupported mixed AND/OR where: ${text}`);
  }
  if (/\sOR\s/i.test(text)) {
    return { kind: 'or', preds: splitClauses(text, 'OR').map((part) => parsePredicate(part, params, index)) };
  }
  if (/\sAND\s/i.test(text)) {
    return { kind: 'and', preds: splitClauses(text, 'AND').map((part) => parsePredicate(part, params, index)) };
  }
  return { kind: 'and', preds: [parsePredicate(text, params, index)] };
}

function predQuery(pred) {
  if (pred.type === 'eq') return eqFilter(pred.col, pred.value);
  if (pred.type === 'ilike') return `${pred.col}=ilike.${encodeValue(pred.value)}`;
  if (pred.type === 'in') {
    if (!pred.values.length) return '__empty=eq.1';
    return `${pred.col}=in.${inList(pred.values)}`;
  }
  throw new Error(`cannot encode ${pred.type}`);
}

function whereQuery(where) {
  if (!where || where.kind === 'all' || !where.preds.length) return '';
  if (where.preds.some((pred) => pred.type === 'param_eq_lit')) {
    const skip = where.preds.find((pred) => pred.type === 'param_eq_lit' && String(pred.value) === String(pred.lit));
    const rest = where.preds.filter((pred) => pred.type !== 'param_eq_lit');
    if (skip) return whereQuery({ kind: 'and', preds: rest });
    return whereQuery({ kind: rest.length > 1 ? where.kind : 'and', preds: rest });
  }
  if (where.kind === 'or') {
    if (where.preds.length === 1) return predQuery(where.preds[0]);
    return `or=(${where.preds.map((pred) => predQuery(pred).replace('=', '.')).join(',')})`;
  }
  return where.preds.map(predQuery).join('&');
}

function parseOrder(order) {
  if (!order) return '';
  return String(order)
    .split(',')
    .map((part) => {
      const m = part.trim().match(/^([\w.]+)(?:\s+(ASC|DESC))?$/i);
      if (!m) return '';
      const col = unquoteIdent(m[1]);
      const dir = m[2] && /desc/i.test(m[2]) ? 'desc' : 'asc';
      return `${col}.${dir}`;
    })
    .filter(Boolean)
    .join(',');
}

function parseSelectList(list) {
  const distinct = /^\s*DISTINCT\s+/i.test(list);
  const body = list.replace(/^\s*DISTINCT\s+/i, '').trim();
  if (body === '*' || /^\w+\.\*$/.test(body)) {
    return { distinct, cols: ['*'], aliases: {}, computed: null };
  }
  const aliases = {};
  const cols = [];
  let computed = null;
  for (const part of splitArgs(body)) {
    const max = part.match(/^COALESCE\s*\(\s*MAX\s*\(\s*([\w.]+)\s*\)\s*,\s*-1\s*\)\s+AS\s+(\w+)$/i);
    if (max) {
      computed = { kind: 'max', col: unquoteIdent(max[1]), as: max[2] };
      continue;
    }
    const preview = part.match(/^substr\s*\(\s*([\w.]+)\s*,\s*1\s*,\s*(\d+)\s*\)\s+AS\s+(\w+)$/i);
    if (preview) {
      computed = { kind: 'preview', col: unquoteIdent(preview[1]), n: Number(preview[2]), as: preview[3] };
      cols.push(unquoteIdent(preview[1]));
      continue;
    }
    const ok = part.match(/^1(?:\s+AS\s+(\w+))?$/i);
    if (ok) {
      computed = { kind: 'ok', as: ok[1] || 'ok' };
      continue;
    }
    const agg = part.match(/^(?:GROUP_CONCAT|string_agg)\s*\(/i);
    if (agg) {
      computed = computed || { kind: 'tags' };
      aliases.tags = true;
      continue;
    }
    const aliased = part.match(/^([\w.]+)\s+AS\s+(\w+)$/i);
    if (aliased) {
      cols.push(unquoteIdent(aliased[1]));
      aliases[unquoteIdent(aliased[2])] = unquoteIdent(aliased[1]);
      continue;
    }
    cols.push(unquoteIdent(part));
  }
  return { distinct, cols: cols.length ? cols : ['*'], aliases, computed };
}

function parseSelect(sql, params) {
  const text = strip(sql);
  const joinTags = /FROM\s+cards(?:\s+\w+)?\s+LEFT\s+JOIN\s+card_tags/i.test(text);
  const m = text.match(
    /^SELECT\s+(.+?)\s+FROM\s+([\w.]+)(?:\s+(?!WHERE\b|GROUP\b|ORDER\b|LIMIT\b|LEFT\b|JOIN\b)\w+)?(?:\s+LEFT\s+JOIN\s+[\s\S]+?)?(?:\s+WHERE\s+(.+?))?(?:\s+GROUP\s+BY\s+[\s\S]+?)?(?:\s+ORDER\s+BY\s+(.+?))?(?:\s+LIMIT\s+(.+))?\s*$/i
  );
  if (!m) throw new Error(`unsupported select: ${text}`);
  const list = parseSelectList(m[1]);
  const walk = { n: 0 };
  const where = parseWhere(m[3], params, walk);
  let limit = null;
  if (m[5]) {
    if (String(m[5]).trim() === '?') {
      limit = Number(params[walk.n]);
      walk.n += 1;
    } else {
      limit = Number(readLiteral(m[5]));
    }
  }
  return {
    op: 'select',
    table: tableName(m[2]),
    where,
    order: parseOrder(m[4]),
    limit,
    list,
    joinTags,
  };
}

function isJsonColumn(table, col) {
  // jobs.posting is a URL string. applications.posting is jsonb. Same name, different types.
  if (table === 'jobs' && col === 'posting') return false;
  return JSONB_COLS.has(col);
}

function coerceWrite(col, value, table) {
  if (value === undefined) return undefined;
  if (isJsonColumn(table, col)) {
    if (value == null || value === '') return value == null ? null : null;
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }
    return value;
  }
  if (ARRAY_COLS.has(col)) {
    if (value == null) return [];
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [value];
      } catch {
        return value ? [value] : [];
      }
    }
    return [value];
  }
  return value;
}

function rowFromCols(cols, values, table) {
  const row = {};
  cols.forEach((col, i) => {
    const key = col === 'end' ? 'end_date' : col;
    const coerced = coerceWrite(key, values[i], table);
    if (coerced !== undefined) row[key] = coerced;
  });
  return row;
}

function parseInsert(sql, params, flags) {
  const text = strip(sql);
  const m = text.match(
    /^INSERT\s+INTO\s+([\w.]+)\s*\((.+?)\)\s*VALUES\s*\((.+)\)(?:\s*ON\s+CONFLICT(?:\s*\(([^)]*)\))?\s+(DO\s+NOTHING|DO\s+UPDATE[\s\S]+))?\s*$/i
  );
  if (!m) throw new Error(`unsupported insert: ${text}`);
  const cols = splitArgs(m[2]).map((col) => {
    const name = unquoteIdent(col);
    return name === 'end' ? 'end_date' : name;
  });
  const index = { n: 0 };
  const values = splitArgs(m[3]).map((part) => bindToken(part.replace(/\s*::\w+\s*$/, ''), params, index).value);
  const conflictCols = m[4]
    ? splitArgs(m[4])
        .map((col) => unquoteIdent(col))
        .filter(Boolean)
    : [];
  const conflict = m[5] ? String(m[5]) : '';
  return {
    op: 'insert',
    table: tableName(m[1]),
    row: rowFromCols(cols, values, tableName(m[1])),
    ignore: flags.ignore || /DO\s+NOTHING/i.test(conflict),
    merge: flags.replace || /DO\s+UPDATE/i.test(conflict),
    onConflict: conflictCols,
  };
}

function parseSet(list, params, index, table) {
  const body = {};
  for (const part of splitArgs(list)) {
    const coalesce = part.match(/^([\w.]+)\s*=\s*coalesce\s*\(\s*\?\s*,\s*\1\s*\)$/i);
    if (coalesce) {
      const value = params[index.n];
      index.n += 1;
      if (value != null) body[unquoteIdent(coalesce[1])] = value;
      continue;
    }
    const inc = part.match(/^([\w.]+)\s*=\s*\1\s*\+\s*(\d+)$/i);
    if (inc) {
      body.__inc = { col: unquoteIdent(inc[1]), by: Number(inc[2]) };
      continue;
    }
    const eq = part.match(/^([\w.]+)\s*=\s*(.+)$/);
    if (!eq) throw new Error(`unsupported set: ${part}`);
    const col = unquoteIdent(eq[1]) === 'end' ? 'end_date' : unquoteIdent(eq[1]);
    body[col] = coerceWrite(col, bindToken(eq[2], params, index).value, table);
  }
  return body;
}

function parseUpdate(sql, params) {
  const text = strip(sql);
  const m = text.match(/^UPDATE\s+([\w.]+)\s+SET\s+(.+?)(?:\s+WHERE\s+(.+))?\s*$/i);
  if (!m) throw new Error(`unsupported update: ${text}`);
  const index = { n: 0 };
  const body = parseSet(m[2], params, index, tableName(m[1]));
  const where = parseWhere(m[3], params, index);
  return { op: 'update', table: tableName(m[1]), body, where };
}

function parseDelete(sql, params) {
  const text = strip(sql);
  const m = text.match(/^DELETE\s+FROM\s+([\w.]+)(?:\s+WHERE\s+(.+))?\s*$/i);
  if (!m) throw new Error(`unsupported delete: ${text}`);
  return { op: 'delete', table: tableName(m[1]), where: parseWhere(m[2], params, { n: 0 }) };
}

function planSql(sql, params = []) {
  const { text, ignore, replace } = rewriteSql(sql);
  const head = strip(text);
  if (/^BEGIN|^COMMIT|^ROLLBACK|^PRAGMA|^CREATE\b|^ALTER\b|^DROP\b/i.test(head)) {
    return { op: 'noop' };
  }
  if (/^SELECT\b/i.test(head)) return parseSelect(text, params);
  if (/^INSERT\b/i.test(head)) return parseInsert(text, params, { ignore, replace });
  if (/^UPDATE\b/i.test(head)) return parseUpdate(text, params);
  if (/^DELETE\b/i.test(head)) return parseDelete(text, params);
  throw new Error(`unsupported sql: ${head.slice(0, 160)}`);
}

function qs(parts) {
  return parts.filter(Boolean).join('&');
}

function applyList(rows, list) {
  if (!list || !list.computed) {
    if (list && list.distinct && list.cols[0] && list.cols[0] !== '*') {
      const col = list.cols[0];
      const seen = new Set();
      const out = [];
      for (const row of rows) {
        const key = row[col];
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(row);
      }
      return out;
    }
    return rows;
  }
  if (list.computed.kind === 'max') {
    const n = rows.length ? Number(rows[0][list.computed.col]) : -1;
    return [{ [list.computed.as]: Number.isFinite(n) ? n : -1 }];
  }
  if (list.computed.kind === 'ok') {
    return rows.length ? [{ [list.computed.as]: 1 }] : [];
  }
  if (list.computed.kind === 'preview') {
    return rows.map((row) => ({
      ...row,
      [list.computed.as]: String(row[list.computed.col] || '').slice(0, list.computed.n),
    }));
  }
  return rows;
}

function emptyWhere(where) {
  return Boolean(where && where.preds && where.preds.some((pred) => pred.type === 'in' && !pred.values.length));
}

function totalsFromApps(rest) {
  const rows = rest.select('applications', 'select=status');
  const out = { submitted: 0, passed: 0, rejected: 0 };
  for (const row of rows) {
    if (Object.prototype.hasOwnProperty.call(out, row.status)) out[row.status] += 1;
  }
  return [out];
}

function runSelect(rest, plan) {
  if (emptyWhere(plan.where)) return [];
  const parts = selectChunks(plan);
  if (parts.length > 1) return concatRows(parts.map((part) => runSelect(rest, part)));
  if (plan.table === 'application_totals') {
    try {
      const rows = rest.select('application_totals', 'select=submitted,passed,rejected');
      if (rows && rows.length && rows[0] && rows[0].submitted != null) return rows;
    } catch (_) {}
    return totalsFromApps(rest);
  }
  if (plan.joinTags) {
    const cards = runSelect(rest, { ...plan, table: 'cards', joinTags: false, list: { cols: ['*'], computed: null } });
    const tags = rest.select('card_tags', 'select=card_id,tag');
    const byId = new Map();
    for (const row of tags) {
      const list = byId.get(row.card_id) || [];
      list.push(row.tag);
      byId.set(row.card_id, list);
    }
    const joined = cards.map((row) => ({
      ...row,
      tags: (byId.get(row.id) || []).filter(Boolean).join(','),
    }));
    return applyList(joined, plan.list);
  }
  if (plan.list && plan.list.computed && plan.list.computed.kind === 'max') {
    const rows = rest.select(plan.table, qs([`select=${plan.list.computed.col}`, `order=${plan.list.computed.col}.desc.nullslast`, 'limit=1']));
    return applyList(rows, plan.list);
  }
  const spec = selectRequest(plan);
  const rows = rest.select(spec.table, spec.query);
  return applyList(rows, plan.list);
}

function selectRequest(plan) {
  const parts = [];
  if (plan.list && plan.list.cols[0] !== '*' && !(plan.list.computed && plan.list.computed.kind === 'ok')) {
    const cols = [...plan.list.cols];
    if (plan.list.computed && plan.list.computed.kind === 'preview' && !cols.includes(plan.list.computed.col)) {
      cols.push(plan.list.computed.col);
    }
    parts.push(`select=${cols.join(',')}`);
  } else if (plan.list && plan.list.computed && plan.list.computed.kind === 'ok') {
    parts.push('select=id');
  }
  const filter = whereQuery(plan.where);
  if (filter) parts.push(filter);
  if (plan.order) parts.push(`order=${plan.order}`);
  if (plan.limit != null && Number.isFinite(plan.limit)) parts.push(`limit=${plan.limit}`);
  return { table: plan.table, query: qs(parts) };
}

async function runSelectAsync(rest, plan) {
  if (emptyWhere(plan.where)) return [];
  const parts = selectChunks(plan);
  if (parts.length > 1) {
    const groups = [];
    for (const part of parts) groups.push(await runSelectAsync(rest, part));
    return concatRows(groups);
  }
  if (
    plan.table === 'application_totals' ||
    plan.joinTags ||
    (plan.list && plan.list.computed && plan.list.computed.kind === 'max')
  ) {
    return runSelect(rest, plan);
  }
  const spec = selectRequest(plan);
  const rows = await rest.selectAsync(spec.table, spec.query);
  return applyList(rows, plan.list);
}

function runInsert(rest, plan) {
  const rows = rest.insert(plan.table, plan.row, {
    merge: plan.merge,
    ignore: plan.ignore,
    onConflict: plan.onConflict,
    returning: false,
  });
  return { changes: 1, rows };
}

function runUpdate(rest, plan) {
  if (emptyWhere(plan.where)) return { changes: 0 };
  const body = { ...plan.body };
  const inc = body.__inc;
  delete body.__inc;
  if (inc) {
    const current = runSelect(rest, {
      op: 'select',
      table: plan.table,
      where: plan.where,
      list: { cols: ['*'], computed: null },
    });
    const row = current[0];
    if (!row) return { changes: 0 };
    body[inc.col] = Number(row[inc.col] || 0) + inc.by;
  }
  const filter = whereQuery(plan.where) || DELETE_ALL[plan.table];
  rest.patch(plan.table, filter, body);
  return { changes: 1 };
}

async function runUpdateAsync(rest, plan) {
  if (plan.body && plan.body.__inc) return runUpdate(rest, plan);
  if (emptyWhere(plan.where)) return { changes: 0 };
  const filter = whereQuery(plan.where) || DELETE_ALL[plan.table];
  await rest.patchAsync(plan.table, filter, plan.body);
  return { changes: 1 };
}

async function executeAsync(rest, sql, params = []) {
  const plan = planSql(sql, params);
  if (plan.op === 'noop') return { changes: 0, rows: [] };
  if (plan.op === 'select') return { rows: await runSelectAsync(rest, plan), changes: 0 };
  if (plan.op === 'update') return runUpdateAsync(rest, plan);
  return execute(rest, sql, params);
}

function runDelete(rest, plan) {
  if (emptyWhere(plan.where)) return { changes: 0 };
  const filter = whereQuery(plan.where) || DELETE_ALL[plan.table];
  if (!filter) throw new Error(`refusing unfiltered delete from ${plan.table}`);
  rest.del(plan.table, filter);
  return { changes: 1 };
}

function execute(rest, sql, params = []) {
  const plan = planSql(sql, params);
  if (plan.op === 'noop') return { changes: 0, rows: [] };
  if (plan.op === 'select') return { rows: runSelect(rest, plan), changes: 0 };
  if (plan.op === 'insert') return runInsert(rest, plan);
  if (plan.op === 'update') return runUpdate(rest, plan);
  if (plan.op === 'delete') return runDelete(rest, plan);
  throw new Error(`unsupported plan ${plan.op}`);
}

function makeDriver(rest) {
  const client = rest || require('./rest');
  return {
    query(sql, params = []) {
      return (execute(client, sql, params).rows || []).map(api.wrapRow);
    },
    async queryAsync(sql, params = []) {
      const result = await executeAsync(client, sql, params);
      return (result.rows || []).map(api.wrapRow);
    },
    queryOne(sql, params = []) {
      const rows = this.query(sql, params);
      return rows[0];
    },
    async queryOneAsync(sql, params = []) {
      const rows = await this.queryAsync(sql, params);
      return rows[0];
    },
    exec(sql, params = []) {
      const text = String(sql || '');
      if (!params.length && /;\s*\n/.test(text) && /^\s*CREATE|PRAGMA|ALTER/i.test(text)) {
        return { changes: 0 };
      }
      const result = execute(client, sql, params);
      return { changes: result.changes || 0 };
    },
    async execAsync(sql, params = []) {
      const text = String(sql || '');
      if (!params.length && /;\s*\n/.test(text) && /^\s*CREATE|PRAGMA|ALTER/i.test(text)) {
        return { changes: 0 };
      }
      const result = await executeAsync(client, sql, params);
      return { changes: result.changes || 0 };
    },
    execScript() {
      return { changes: 0 };
    },
    transaction(fn) {
      const result = fn();
      return { result, stmts: [] };
    },
    close() {},
  };
}

function open() {
  loadEnv();
  if (api.getDriver() && api.getDriver().__rest) {
    return exposed();
  }
  require('./rest').requireConfig();
  const driver = makeDriver();
  driver.__rest = true;
  api.setDriver(driver);
  return exposed();
}

function close() {
  api.close();
}

function exposed() {
  return {
    query: api.query,
    queryOne: api.queryOne,
    exec: api.exec,
    execScript: api.execScript,
    transaction: api.transaction,
    close,
  };
}

module.exports = {
  open,
  close,
  makeDriver,
  planSql,
  rewriteSql,
  whereQuery,
  execute,
};
