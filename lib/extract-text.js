function extractText(result) {
  if (result == null) return '';
  if (typeof result === 'string') return result;
  const r = result.result ?? result.text ?? result.output ?? result.message;
  if (typeof r === 'string') return r;
  if (Array.isArray(r)) {
    const joined = r.map((x) => (x && (x.text || x.content)) || '').filter(Boolean).join('');
    return joined || JSON.stringify(r);
  }
  if (r && typeof r === 'object') {
    if (typeof r.text === 'string') return r.text;
    try {
      return JSON.stringify(r);
    } catch {
      return String(r);
    }
  }
  return '';
}

module.exports = { extractText };
