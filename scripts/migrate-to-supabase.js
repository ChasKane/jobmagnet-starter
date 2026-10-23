#!/usr/bin/env node
/**
 * One-shot import into Supabase over HTTP. Idempotent. Does not commit data.
 *   node scripts/migrate-to-supabase.js [--force]
 * Schema changes go in the Supabase SQL editor, not a Postgres socket.
 */
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { canonicalUrl } = require('../lib/job-identity');
const { loadEnv } = require('../lib/store/mode');
const store = require('../lib/store');
const rest = require('../lib/store/rest');

const ROOT = path.join(__dirname, '..');
const KNOWLEDGE = path.join(ROOT, 'knowledge');
const force = process.argv.includes('--force');

function readYaml(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return yaml.load(fs.readFileSync(file, 'utf8')) || fallback;
  } catch (err) {
    console.warn('skip', path.basename(file), err.message || err);
    return fallback;
  }
}

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function conflict(updateSql) {
  return force ? updateSql : 'DO NOTHING';
}

function toQmarks(sql) {
  return String(sql).replace(/\$(\d+)/g, '?');
}

function makeClient() {
  process.env.MAGNET_STORE = 'supabase';
  store.open();
  return {
    async query(sql, params = []) {
      const text = toQmarks(sql);
      if (/^\s*select/i.test(text)) return { rows: store.query(text, params) };
      const info = store.exec(text, params);
      return { rows: [], rowCount: (info && info.changes) || 0 };
    },
    async end() {
      store.close();
    },
  };
}

async function applyFile() {
  console.warn('Schema is applied in the Supabase SQL editor, not over HTTP.');
}

async function count(_client, table) {
  return rest.count(table, 'select=*');
}

async function importJobs(client, doc) {
  let n = 0;
  for (const [index, job] of (doc.jobs || []).entries()) {
    if (!job || !job.url) continue;
    const id = String(job.id || `job-${index}`);
    const canon = canonicalUrl(job.url);
    await client.query(
      `INSERT INTO jobs (id, url, canonical_url, company, title, linkedin, posting, logo, hostname, salary, yoe, level, location, industries, skills, notes, sort_index)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (id) ${conflict(`DO UPDATE SET url=excluded.url, canonical_url=excluded.canonical_url, company=excluded.company, title=excluded.title, location=excluded.location, notes=excluded.notes, updated_at=now()`)}`,
      [
        id,
        job.url,
        canon,
        job.company || '',
        job.title || '',
        job.linkedin || '',
        job.posting || '',
        job.logo || '',
        job.hostname || '',
        job.salary || '',
        job.yoe || '',
        job.level || '',
        job.location || '',
        job.industries || [],
        job.skills || [],
        job.notes || '',
        index,
      ]
    );
    if (job.agent || job.submitted_at) {
      const existing = await client.query('SELECT * FROM applications WHERE canonical_url = $1', [canon]);
      const row = existing.rows[0];
      const submittedAt = (row && row.submitted_at) || job.submitted_at || new Date().toISOString();
      if (!row) {
        await client.query(
          `INSERT INTO applications (job_id, url, canonical_url, status, source, submitted_at)
           VALUES ($1,$2,$3,'submitted','agent',$4)`,
          [id, job.url, canon, submittedAt]
        );
      } else {
        await client.query(
          `UPDATE applications SET source = ?, status = ?, submitted_at = ?, job_id = ? WHERE canonical_url = ?`,
          ['agent', row.status === 'open' ? 'submitted' : row.status, submittedAt, row.job_id || id, canon]
        );
      }
    }
    n += 1;
  }
  for (const bug of doc.bugs || []) {
    if (!bug || !bug.id) continue;
    await client.query(
      `INSERT INTO incidents (id, kind, format, area, host, company, url, what, where_text, evidence)
       VALUES ($1,'bug',$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) ${conflict('DO UPDATE SET what=excluded.what, evidence=excluded.evidence')}`,
      [String(bug.id), bug.format || 'JM-BUG', bug.area || '', bug.host || '', bug.company || '', bug.url || '', bug.what || '', bug.where || '', bug.evidence || '']
    );
  }
  for (const blocker of doc.blockers || []) {
    if (!blocker || !blocker.id) continue;
    await client.query(
      `INSERT INTO incidents (id, kind, format, area, host, company, url, what, where_text, evidence)
       VALUES ($1,'blocker',$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) ${conflict('DO UPDATE SET what=excluded.what, evidence=excluded.evidence')}`,
      [
        String(blocker.id),
        blocker.format || 'SITE-BLOCK',
        blocker.area || '',
        blocker.host || '',
        blocker.company || '',
        blocker.url || '',
        blocker.what || '',
        blocker.where || '',
        blocker.evidence || '',
      ]
    );
  }
  return n;
}

async function importProcess(client, byUrl) {
  let n = 0;
  for (const [url, rec] of Object.entries(byUrl || {})) {
    if (!url || !rec) continue;
    const canon = canonicalUrl(url);
    const job = await client.query('SELECT id FROM jobs WHERE canonical_url = $1 OR url = $2 LIMIT 1', [canon, url]);
    const status = ['open', 'submitted', 'passed', 'rejected', 'withdrawn', 'interviewing', 'offer'].includes(rec.status)
      ? rec.status
      : 'open';
    await client.query(
      `INSERT INTO applications (job_id, url, canonical_url, status, prep_notes, jd, posting, submitted_at, rejected_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (canonical_url) ${conflict(`DO UPDATE SET status=excluded.status, prep_notes=excluded.prep_notes, jd=excluded.jd, posting=excluded.posting, updated_at=now()`)}`,
      [
        (job.rows[0] && job.rows[0].id) || null,
        url,
        canon,
        status,
        rec.prep_notes || '',
        rec.jd ? JSON.stringify(rec.jd) : null,
        rec.posting ? JSON.stringify(rec.posting) : null,
        rec.submitted_at || null,
        rec.rejected_at || null,
      ]
    );
    const app = await client.query('SELECT id FROM applications WHERE canonical_url = $1', [canon]);
    const applicationId = app.rows[0] && app.rows[0].id;
    if (!applicationId) continue;
    if (force) {
      await client.query('DELETE FROM application_events WHERE application_id = $1', [applicationId]);
      await client.query('DELETE FROM application_contacts WHERE application_id = $1', [applicationId]);
      await client.query('DELETE FROM essays WHERE application_id = $1', [applicationId]);
    }
    const haveEvents = await client.query('SELECT 1 FROM application_events WHERE application_id = $1 LIMIT 1', [applicationId]);
    if (force || !haveEvents.rows.length) {
      for (const event of rec.events || []) {
        await client.query(
          `INSERT INTO application_events (application_id, at, type, title, body, contact_id, deleted) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [applicationId, event.at || new Date().toISOString(), event.type || 'note', event.title || '', event.body || '', event.contact_id || null, Boolean(event.deleted)]
        );
      }
      for (const contact of rec.contacts || []) {
        await client.query(
          `INSERT INTO application_contacts (id, application_id, name, email, role, extra) VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (id) DO NOTHING`,
          [String(contact.id || `c-${n}`), applicationId, contact.name || '', contact.email || '', contact.role || '', JSON.stringify(contact)]
        );
      }
      for (const essay of rec.essays || []) {
        await client.query(
          `INSERT INTO essays (application_id, field_id, label, normalized_key, llm_draft, final, source_card_ids) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            applicationId,
            essay.id || '',
            essay.label || '',
            essay.normalized_key || '',
            essay.llm_draft || '',
            essay.final || '',
            essay.source_card_ids || [],
          ]
        );
      }
    }
    n += 1;
  }
  return n;
}

async function importProfile(client, doc) {
  if (!doc || typeof doc !== 'object') return;
  const skills = doc.skills || {};
  await client.query(
    `INSERT INTO applicant (id, identity, eeo, work, policy, skills_as_of) VALUES (true, $1,$2,$3,$4,$5)
     ON CONFLICT (id) DO UPDATE SET identity=excluded.identity, eeo=excluded.eeo, work=excluded.work, policy=excluded.policy`,
    [JSON.stringify(doc.identity || {}), JSON.stringify(doc.eeo || {}), JSON.stringify(doc.work || {}), JSON.stringify(doc.policy || {}), null]
  );
  if (force) {
    await client.query('DELETE FROM applicant_education');
    await client.query('DELETE FROM applicant_employment');
    await client.query('DELETE FROM applicant_skills');
    await client.query('DELETE FROM applicant_answers');
  }
  const edu = await count(client, 'applicant_education');
  if (force || !edu) {
    for (const [index, row] of (doc.education || []).entries()) {
      if (!row || !row.school) continue;
      await client.query(
        `INSERT INTO applicant_education (sort_index, school, degree, start, end_date, current, gpa, gpa_scale, honors) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [index, row.school, row.degree || '', row.start || null, row.end || null, Boolean(row.current), row.gpa || null, row.gpa_scale || null, Boolean(row.honors)]
      );
    }
    for (const [index, row] of (doc.employment || []).entries()) {
      if (!row || !row.employer) continue;
      await client.query(
        `INSERT INTO applicant_employment (sort_index, employer, title, start, end_date, current, location, bullets) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [index, row.employer, row.title || '', row.start || null, row.end || null, Boolean(row.current), row.location || '', row.bullets || '']
      );
    }
    for (const [slug, skill] of Object.entries(skills)) {
      if (slug === 'as_of' || !skill || typeof skill !== 'object') continue;
      await client.query(
        `INSERT INTO applicant_skills (slug, years, since, aliases) VALUES ($1,$2,$3,$4) ON CONFLICT (slug) DO NOTHING`,
        [slug, Number(skill.years) || 0, skill.since || null, skill.aliases || []]
      );
    }
    for (const [key, answer] of Object.entries(doc.answers || {})) {
      if (!answer || typeof answer !== 'object') continue;
      await client.query(
        `INSERT INTO applicant_answers (class, slug, value, confidence, source, label, confirmed_at) VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (class) DO NOTHING`,
        [answer.class || key, answer.slug || key, answer.value == null ? '' : String(answer.value), answer.confidence || 'confirmed', answer.source || '', answer.label || '', answer.confirmed_at || null]
      );
    }
  }
}

async function importLogs(client) {
  const archive = path.join(KNOWLEDGE, 'archive');
  for (const row of readJsonl(path.join(archive, 'answers.jsonl'))) {
    await client.query(
      `INSERT INTO essay_commits (ts, company, url, label, normalized_key, llm_draft, final, unchanged, origin, overlap, score, source_card_ids)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        row.ts || new Date().toISOString(),
        row.company || null,
        row.url || null,
        row.label || null,
        row.normalized_key || null,
        row.llm_draft || null,
        row.final || null,
        row.unchanged == null ? null : Boolean(row.unchanged),
        row.origin || null,
        row.overlap == null ? null : row.overlap,
        row.score == null ? null : row.score,
        row.source_card_ids || [],
      ]
    );
  }
  for (const row of readJsonl(path.join(archive, 'llm.jsonl'))) {
    await client.query(
      `INSERT INTO llm_log (ts, caller, model, model_params, request_id, input, output, error, duration_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        row.ts || new Date().toISOString(),
        row.caller || null,
        row.model || null,
        row.model_params ? JSON.stringify(row.model_params) : null,
        row.request_id || null,
        row.input || null,
        row.output ? JSON.stringify(row.output) : null,
        row.error || null,
        row.duration_ms || null,
      ]
    );
  }
}

async function main() {
  loadEnv();
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required. Do not use a Postgres URL.');
    process.exit(1);
  }
  const client = makeClient();
  await applyFile();
  const jobsDoc = readYaml(path.join(KNOWLEDGE, 'jobs.yaml'), { jobs: [] });
  const jobs = await importJobs(client, jobsDoc);
  const processDoc = readYaml(path.join(KNOWLEDGE, 'process.yaml'), { by_url: {} });
  const apps = await importProcess(client, processDoc.by_url);
  await importProfile(client, readYaml(path.join(KNOWLEDGE, 'applicant-profile.yaml'), {}));
  let chats = { by_url: {}, ui: null };
  try {
    chats = JSON.parse(fs.readFileSync(path.join(KNOWLEDGE, 'archive', 'chats.json'), 'utf8'));
  } catch (_) {
    chats = { by_url: {}, ui: null };
  }
  for (const [key, row] of Object.entries((chats && chats.by_url) || {})) {
    const messages = Array.isArray(row) ? row : (row && row.messages) || [];
    await client.query(
      `INSERT INTO chats (key, company, title, messages, folded, page_subtab, agent_id, snapshot_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (key) DO NOTHING`,
      [
        key,
        (row && row.company) || '',
        (row && row.title) || '',
        JSON.stringify(messages),
        JSON.stringify((row && row.folded) || []),
        (row && row.pageSubtab) || 'chat',
        (row && row.agentId) || '',
        (row && row.snapshotKey) || '',
      ]
    );
  }
  if (chats && chats.ui) {
    await client.query('UPDATE chat_ui SET payload = $1, updated_at = $2 WHERE id = true', [
      chats.ui,
      new Date().toISOString(),
    ]);
  }
  if (force) {
    await client.query('DELETE FROM essay_commits');
    await client.query('DELETE FROM llm_log');
  }
  if (force || !(await count(client, 'essay_commits'))) await importLogs(client);
  const totals = await client.query('SELECT submitted, passed, rejected FROM application_totals');
  console.log(
    JSON.stringify(
      {
        jobsYaml: (jobsDoc.jobs || []).length,
        jobsImported: jobs,
        jobs: await count(client, 'jobs'),
        applicationsTouched: apps,
        applications: await count(client, 'applications'),
        incidents: await count(client, 'incidents'),
        applicantAnswers: await count(client, 'applicant_answers'),
        chats: await count(client, 'chats'),
        essayCommits: await count(client, 'essay_commits'),
        llmLog: await count(client, 'llm_log'),
        totals: totals.rows[0],
      },
      null,
      2
    )
  );
  await client.end();
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
