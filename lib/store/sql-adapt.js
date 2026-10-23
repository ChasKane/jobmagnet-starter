/** SQLite graph SQL → Postgres. Placeholders, INSERT OR IGNORE, events, timeline.end, GROUP_CONCAT. */

function adaptSql(sql) {
  let text = String(sql || '');
  const ignore = /\bINSERT\s+OR\s+IGNORE\s+INTO\b/i.test(text);
  text = text.replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\b/gi, 'INSERT INTO');
  text = text.replace(/\bINSERT\s+OR\s+REPLACE\s+INTO\b/gi, 'INSERT INTO');
  text = text.replace(/\b(INTO|FROM|UPDATE|JOIN)\s+events\b/gi, '$1 graph_events');
  text = text.replace(
    /\bGROUP_CONCAT\s*\(\s*([^,()]+)\s*,\s*'([^']*)'\s*\)/gi,
    (_m, expr, sep) => `string_agg(${expr}::text, '${sep}')`
  );
  text = text.replace(/\bstart\s*,\s*end\s*,/gi, 'start, end_date,');
  text = text.replace(/\bend\s*=/gi, 'end_date =');
  if (ignore) {
    text = text.replace(/;\s*$/, '');
    if (!/\bon\s+conflict\b/i.test(text)) text += ' ON CONFLICT DO NOTHING';
  }
  let out = '';
  let n = 0;
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quote) {
      out += c;
      if (c === quote) {
        if (text[i + 1] === quote) {
          out += text[i + 1];
          i += 1;
        } else quote = null;
      }
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      out += c;
      continue;
    }
    if (c === '?') {
      n += 1;
      out += `$${n}`;
      continue;
    }
    out += c;
  }
  return out;
}

module.exports = { adaptSql };
