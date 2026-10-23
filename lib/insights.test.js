const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  rankOf,
  bucketKey,
  classifyMail,
  editClass,
  normalizeConfig,
  activeStyle,
  buildInsights,
} = require('./insights');

const senior = {
  url: 'https://jobs.example.com/senior',
  title: 'Senior Frontend Engineer',
  company: 'Northwind',
  level: '',
  status: 'submitted',
  submitted_at: '2026-01-07T15:00:00Z',
};
const mid = {
  url: 'https://jobs.example.com/mid',
  title: 'Frontend Engineer',
  company: 'Contoso',
  level: 'mid',
  status: 'submitted',
  submitted_at: '2026-01-20T15:00:00Z',
};
const openRole = {
  url: 'https://jobs.example.com/open',
  title: 'Senior Backend Engineer',
  level: 'senior',
  status: 'open',
};

function essay(partial) {
  return {
    url: senior.url,
    ts: '2026-01-07T12:00:00Z',
    label: 'Why us',
    final: 'one two three four five',
    llm_draft: 'one two three four five',
    unchanged: true,
    overlap: 1,
    ...partial,
  };
}

test('rank comes from the stored level, then the title', () => {
  assert.equal(rankOf({ title: 'Senior Frontend Engineer' }), 'senior');
  assert.equal(rankOf({ level: 'mid', title: 'Senior Frontend Engineer' }), 'mid');
  assert.equal(rankOf({ level: 'Mid-Level', title: 'Engineer' }), 'mid');
  assert.equal(rankOf({ title: 'Staff Frontend' }), 'staff');
  assert.equal(rankOf({ title: 'Jr. Backend' }), 'junior');
  assert.equal(rankOf({ title: 'Software Engineer' }), '');
});

test('weeks bucket to Monday and months stay on the calendar month', () => {
  assert.equal(bucketKey('2026-01-07T15:00:00Z', 'week'), '2026-01-05');
  assert.equal(bucketKey('2026-01-04T12:00:00Z', 'week'), '2025-12-29');
  assert.equal(bucketKey('2026-01-31T00:00:00Z', 'month'), '2026-01');
});

test('mail scan verdicts become confirmations, rejections, and interviews', () => {
  assert.equal(classifyMail({ verdict: 'received', reason: 'received' }), 'received');
  assert.equal(classifyMail({ verdict: 'reject', reason: 'template' }), 'reject');
  assert.equal(classifyMail({ verdict: 'not_reject', reason: 'interview' }), 'interview');
  assert.equal(classifyMail({ verdict: 'noise', reason: 'marketing' }), 'noise');
  assert.equal(classifyMail({ subject: 'Thank you for applying to Northwind' }), 'received');
  assert.equal(classifyMail({ subject: 'Your interview invitation' }), 'interview');
});

test('essay edits split into kept, light, and rewrite', () => {
  assert.equal(editClass({ unchanged: true, overlap: 1 }).edit, 'kept');
  assert.equal(editClass({ overlap: 0.6, final: 'a b', llm_draft: 'a c' }).edit, 'light');
  assert.equal(editClass({ overlap: 0.1, final: 'rewritten answer', llm_draft: 'draft' }).edit, 'rewrite');
});

test('submissions over time respect title and rank filters', () => {
  const out = buildInsights(
    { jobs: [senior, mid, openRole], mail: [], essays: [] },
    { grain: 'week', title: 'frontend', ranks: ['senior'] }
  );
  assert.equal(out.summary.submissions, 1);
  assert.equal(out.summary.undated, 0);
  const series = out.charts.find((chart) => chart.id === 'submissions').series[0];
  assert.deepEqual(
    series.points.filter((point) => point.value > 0).map((point) => [point.t, point.value]),
    [['2026-01-05', 1]]
  );
  assert.match(out.charts[0].svg, /data-series="submissions"/);
});

test('email series count scan outcomes and hide unmatched mail when a filter is on', () => {
  const mail = [
    { id: 'r1', verdict: 'received', reason: 'received', date: '2026-01-08T00:00:00Z', matched_url: senior.url },
    { id: 'r2', verdict: 'reject', date: '2026-01-21T00:00:00Z', matched_url: mid.url },
    { id: 'r3', verdict: 'not_reject', reason: 'interview', date: '2026-01-22T00:00:00Z', matched_url: senior.url },
    { id: 'n1', verdict: 'noise', reason: 'marketing', date: '2026-01-08T00:00:00Z' },
    { id: 'u1', subject: 'Thank you for applying', date: '2026-01-09T00:00:00Z' },
  ];
  const filtered = buildInsights({ jobs: [senior, mid], mail, essays: [] }, { grain: 'week', ranks: ['senior'] });
  const mailChart = filtered.charts.find((chart) => chart.id === 'mail');
  const byKey = Object.fromEntries(mailChart.series.map((row) => [row.key, row]));
  assert.equal(byKey.received.points.find((point) => point.t === '2026-01-05').value, 1);
  assert.equal(byKey.reject.points.every((point) => point.value === 0), true);
  assert.equal(byKey.interview.points.find((point) => point.t === '2026-01-19').value, 1);
  assert.equal(filtered.summary.hiddenMail > 0, true);
  assert.equal(filtered.summary.confirmed, 1);
  assert.equal(filtered.summary.interviews, 1);

  const all = buildInsights({ jobs: [senior, mid], mail, essays: [] }, { grain: 'week' });
  assert.equal(all.summary.receivedUnmatched, 1);
  assert.equal(all.summary.rejected, 1);
});

test('essay style series track words and rewrite share, with style bands on the chart', () => {
  const essays = [
    essay({ ts: '2026-01-07T12:00:00Z', final: 'one two three four', llm_draft: 'one two three four', overlap: 1 }),
    essay({
      ts: '2026-01-21T12:00:00Z',
      url: mid.url,
      final: 'a completely different story about the work',
      llm_draft: 'short draft',
      unchanged: false,
      overlap: 0.1,
    }),
  ];
  const out = buildInsights(
    { jobs: [senior, mid], mail: [], essays },
    {
      grain: 'week',
      styles: [{ name: 'Short hook', start: '2026-01-01', end: '2026-01-14', notes: 'Open on the product.' }],
    }
  );
  const style = out.charts.find((chart) => chart.id === 'essay-style');
  const words = style.series.find((row) => row.key === 'words');
  const rewrite = style.series.find((row) => row.key === 'rewrite');
  assert.equal(words.points.find((point) => point.t === '2026-01-05').value, 4);
  assert.equal(rewrite.points.find((point) => point.t === '2026-01-05').value, 0);
  assert.equal(rewrite.points.find((point) => point.t === '2026-01-19').value, 1);
  assert.match(style.svg, /Short hook/);
  assert.match(style.svg, /data-series="words"/);
  assert.equal(out.comparison[0].name, 'Short hook');
  assert.equal(out.comparison[0].essays, 1);
  assert.equal(out.comparison[0].meanWords, 4);
  assert.equal(out.comparison[0].rewriteShare, 0);
});

test('the later style owns the overlap, and outcomes follow the application not the mail date', () => {
  const jobs = [
    { ...senior, submitted_at: '2026-01-10T00:00:00Z' },
    { ...mid, submitted_at: '2026-01-20T00:00:00Z' },
    {
      url: 'https://jobs.example.com/senior-2',
      title: 'Senior Backend Engineer',
      level: 'senior',
      status: 'rejected',
      submitted_at: '2026-01-22T00:00:00Z',
    },
  ];
  const mail = [
    { id: 'ok', verdict: 'received', date: '2026-02-02T00:00:00Z', matched_url: senior.url },
    { id: 'no', verdict: 'reject', date: '2026-01-12T00:00:00Z', matched_url: 'https://jobs.example.com/senior-2' },
    { id: 'no2', verdict: 'reject', date: '2026-01-25T00:00:00Z', matched_url: 'https://jobs.example.com/senior-2' },
  ];
  const styles = [
    { id: 'long', name: 'Long story', start: '2026-01-01', end: '2026-01-31' },
    { id: 'short', name: 'Short hook', start: '2026-01-15', end: '' },
  ];
  assert.equal(activeStyle(normalizeConfig({ styles }).styles, '2026-01-20', { title: 'Senior', rank: 'senior' }).id, 'short');
  assert.equal(activeStyle(normalizeConfig({ styles }).styles, '2026-01-10', { title: 'Senior', rank: 'senior' }).id, 'long');

  const out = buildInsights({ jobs, mail, essays: [] }, { grain: 'week', styles, ranks: ['senior'] });
  const byName = Object.fromEntries(out.comparison.map((row) => [row.name, row]));
  assert.equal(byName['Long story'].submissions, 1);
  assert.equal(byName['Long story'].confirmed, 1);
  assert.equal(byName['Long story'].confirmRate, 1);
  assert.equal(byName['Short hook'].submissions, 1);
  assert.equal(byName['Short hook'].rejected, 1);
  assert.equal(byName['Short hook'].rejectRate, 1);
  assert.equal(byName['No style'], undefined);
});

test('a style scoped to senior does not claim mid applications', () => {
  const out = buildInsights(
    { jobs: [senior, mid], mail: [], essays: [] },
    { styles: [{ name: 'Senior voice', start: '2026-01-01', ranks: ['senior'] }] }
  );
  const byName = Object.fromEntries(out.comparison.map((row) => [row.name, row]));
  assert.equal(byName['Senior voice'].submissions, 1);
  assert.equal(byName['No style'].submissions, 1);
});

test('config keeps known metrics and drops a style with no start date', () => {
  const config = normalizeConfig({
    grain: 'year',
    charts: [{ id: 'custom', title: 'Mine', metrics: ['submissions', 'nope', 'words'] }],
    styles: [{ name: 'Missing', notes: 'no date' }, { name: 'Kept', start: '2026-03-01', notes: 'Shorter open.' }],
  });
  assert.equal(config.grain, 'week');
  assert.deepEqual(config.charts[0].metrics, ['submissions', 'words']);
  assert.equal(config.styles.length, 1);
  assert.equal(config.styles[0].name, 'Kept');
});

test('an empty snapshot still returns the default graphs', () => {
  const out = buildInsights({}, null);
  assert.equal(out.charts.length, 3);
  assert.equal(out.axis.length, 0);
  assert.equal(out.charts[0].svg, '');
  assert.equal(out.summary.submissions, 0);
});

test('insights config round-trips in the knowledge directory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'magnet-insights-'));
  const prev = process.env.MAGNET_KNOWLEDGE;
  process.env.MAGNET_KNOWLEDGE = dir;
  try {
    const data = require('./insights-data');
    const written = data.writeConfig({
      grain: 'day',
      title: 'frontend',
      ranks: ['senior', 'nope'],
      styles: [{ name: 'Short hook', start: '2026-04-01' }],
    });
    assert.equal(written.ranks.length, 1);
    assert.equal(fs.existsSync(path.join(dir, 'insights.json')), true);
    const payload = data.insightsPayload(undefined, {
      loadJobs: () => ({
        jobs: [{ url: 'https://jobs.example.com/s', title: 'Senior Frontend', status: 'submitted', submitted_at: '2026-04-02' }],
        processEssays: [],
      }),
      loadEssays: () => [],
      loadIndex: () => ({
        m1: { verdict: 'received', reason: 'received', date: '2026-04-03', matched_url: 'https://jobs.example.com/s' },
      }),
    });
    assert.equal(payload.config.grain, 'day');
    assert.equal(payload.summary.submissions, 1);
    assert.equal(payload.summary.confirmed, 1);
    assert.equal(payload.comparison[0].name, 'Short hook');
    assert.equal(payload.comparison[0].confirmed, 1);
  } finally {
    if (prev == null) delete process.env.MAGNET_KNOWLEDGE;
    else process.env.MAGNET_KNOWLEDGE = prev;
    delete require.cache[require.resolve('./insights-data')];
  }
});
