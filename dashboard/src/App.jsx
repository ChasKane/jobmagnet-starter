import React, { useEffect, useState } from 'react';

const TYPES = [
  'note',
  'email',
  'recruiter_screen',
  'hiring_manager',
  'panel',
  'onsite',
  'offer',
  'withdrawn',
];

export default function App() {
  const [data, setData] = useState(null);
  const [note, setNote] = useState('');
  const [eventType, setEventType] = useState('note');
  const [eventTitle, setEventTitle] = useState('');
  const [person, setPerson] = useState({ name: '', role: '', email: '' });
  const [findOpen, setFindOpen] = useState(false);
  const [findQ, setFindQ] = useState('');

  function refresh() {
    if (!window.magnetDash) return;
    window.magnetDash.get().then(setData);
  }

  useEffect(() => {
    refresh();
    if (window.magnetDash) return window.magnetDash.onUpdate(setData);
  }, []);

  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setFindOpen(true);
      }
      if (e.key === 'Escape') setFindOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!data || !data.job) {
    return (
      <div style={page}>
        <p style={{ color: '#8b93a7' }}>Select a submitted row.</p>
      </div>
    );
  }

  const rec = data.process || {};
  const mail = data.mail || {};
  const events = (rec.events || []).filter((e) => !e.deleted);
  const hideReject = rec.status === 'rejected' || rec.status === 'passed';
  const hay = findQ.trim().toLowerCase();
  const match = (text) => !hay || String(text || '').toLowerCase().includes(hay);
  const pending = mail.pending || [];
  const kept = mail.kept || [];

  function afterMail(out) {
    if (out && out.job) setData(out);
    else refresh();
  }

  return (
    <div style={page}>
      {findOpen && (
        <input
          autoFocus
          style={findInp}
          value={findQ}
          placeholder="Find in dashboard"
          onChange={(e) => setFindQ(e.target.value)}
        />
      )}
      <header style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 20, fontWeight: 650 }}>{data.job.name}</div>
        <div style={{ color: '#8b93a7' }}>{data.job.title}</div>
        <div style={chip}>{rec.status || 'submitted'}</div>
        {rec.submitted_at && (
          <div style={{ fontSize: 12, color: '#8b93a7', marginTop: 4 }}>Applied {rec.submitted_at.slice(0, 10)}</div>
        )}
        {(data.job.posting || data.job.linkedin) && (
          <div style={{ fontSize: 12, color: '#8b93a7', marginTop: 4 }}>{data.job.posting || data.job.linkedin}</div>
        )}
      </header>

      <div style={{ display: 'flex', gap: 8, margin: '0 0 12px', flexWrap: 'wrap' }}>
        <button
          type="button"
          style={ghost}
          onClick={() => window.magnetDash.connectMail().then(afterMail)}
        >
          {mail.connected ? mail.email ? `Signed in as ${mail.email}` : 'Signed in' : 'Sign in to Gmail'}
        </button>
        {mail.connected && (
          <button type="button" style={ghost} onClick={() => window.magnetDash.signOutMail().then(afterMail)}>
            Sign out
          </button>
        )}
        <button
          type="button"
          style={ghost}
          onClick={() =>
            window.magnetDash.scanMail().then((out) => {
              if (out && out.needConnect) return window.magnetDash.connectMail().then(afterMail);
              afterMail(out);
            })
          }
        >
          Scan inbox
        </button>
        {mail.scanned_at && (
          <span style={{ color: '#8b93a7', fontSize: 12, alignSelf: 'center' }}>
            Last scan {String(mail.scanned_at).slice(0, 16)} · {mail.indexed || 0} indexed
          </span>
        )}
      </div>

      {pending.length > 0 && (
        <section style={{ marginBottom: 16 }}>
          <h2 style={h2}>Inbox review ({pending.length})</h2>
          {pending.map((row) => (
            <div key={row.id} style={{ marginBottom: 10, borderBottom: '1px solid #2e3445', paddingBottom: 8 }}>
              <div>
                <strong>{row.subject || row.id}</strong>
                <span style={{ color: '#8b93a7' }}> · {row.reason}</span>
              </div>
              <div style={{ color: '#8b93a7', fontSize: 12 }}>{row.from}</div>
              <div style={{ color: '#8b93a7', fontSize: 12 }}>{row.snippet}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                <button type="button" style={ghost} onClick={() => window.magnetDash.resolveMail(row.id, 'yes').then(afterMail)}>
                  Reject first
                </button>
                <button type="button" style={ghost} onClick={() => window.magnetDash.resolveMail(row.id, 'no').then(afterMail)}>
                  Not a reject
                </button>
                {(row.candidates || []).map((c) => (
                  <button
                    key={c.url}
                    type="button"
                    style={ghost}
                    onClick={() => window.magnetDash.resolveMail(row.id, c.url).then(afterMail)}
                  >
                    Reject {c.company} {c.title ? `· ${c.title}` : ''}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      {kept.length > 0 && (
        <section style={{ marginBottom: 16 }}>
          <h2 style={h2}>Mail</h2>
          {kept.map((row) => (
            <div key={row.id} style={{ marginBottom: 10, borderBottom: '1px solid #2e3445', paddingBottom: 8 }}>
              <div>
                <strong>{row.subject}</strong>
                <span style={{ color: '#8b93a7' }}> · {(row.date || '').slice(0, 16)}</span>
              </div>
              <div style={{ color: '#8b93a7', fontSize: 12 }}>{row.from}</div>
              <pre style={pre}>{row.text}</pre>
            </div>
          ))}
        </section>
      )}

      {!hideReject && (
        <button
          type="button"
          style={rejectBtn}
          onClick={() => window.magnetDash.rejected(note).then(setData)}
        >
          Rejected
        </button>
      )}

      <div style={{ display: 'flex', gap: 8, margin: '12px 0', flexWrap: 'wrap' }}>
        <button type="button" style={ghost} onClick={() => window.magnetDash.openPosting()}>
          Open posting
        </button>
        <button type="button" style={ghost} onClick={() => window.magnetDash.showDashboard()}>
          Dashboard
        </button>
        <button type="button" style={ghost} onClick={() => window.magnetDash.openExternal()}>
          Open in browser
        </button>
        <button type="button" style={ghost} onClick={() => window.magnetDash.overflow('withdrawn').then(setData)}>
          Withdrawn
        </button>
        <button type="button" style={ghost} onClick={() => window.magnetDash.overflow('back-submitted').then(setData)}>
          Back to submitted
        </button>
        <button type="button" style={ghost} onClick={() => window.magnetDash.overflow('back-open').then(setData)}>
          Back to Open
        </button>
      </div>

      <section>
        <h2 style={h2}>Prep</h2>
        {match((rec.jd && rec.jd.text) || '') && (
          <pre style={pre}>{(rec.jd && rec.jd.text) || '(no JD stored)'}</pre>
        )}
        {(rec.essays || []).filter((e) => match(e.label + e.final + e.llm_draft)).map((e, i) => (
          <div key={i} style={{ marginBottom: 8 }}>
            <div style={{ fontWeight: 600 }}>{e.label}</div>
            <div style={{ color: '#c4c9d4' }}>{e.final || e.llm_draft}</div>
          </div>
        ))}
        <textarea
          style={area}
          value={rec.prep_notes || ''}
          onChange={(ev) => {
            rec.prep_notes = ev.target.value;
            setData({ ...data, process: rec });
          }}
          onBlur={() => window.magnetDash.saveNotes(rec.prep_notes || '')}
          placeholder="Interview notes…"
        />
      </section>

      <section>
        <h2 style={h2}>People</h2>
        {(rec.contacts || []).map((c) => (
          <div key={c.id} style={{ marginBottom: 6 }}>
            {c.name} · {c.role} · {c.email}
          </div>
        ))}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <input style={inp} placeholder="Name" value={person.name} onChange={(e) => setPerson({ ...person, name: e.target.value })} />
          <input style={inp} placeholder="Role" value={person.role} onChange={(e) => setPerson({ ...person, role: e.target.value })} />
          <input style={inp} placeholder="Email" value={person.email} onChange={(e) => setPerson({ ...person, email: e.target.value })} />
          <button
            type="button"
            style={ghost}
            onClick={() => {
              window.magnetDash.addContact(person).then(setData);
              setPerson({ name: '', role: '', email: '' });
            }}
          >
            Add
          </button>
        </div>
      </section>

      <section>
        <h2 style={h2}>Timeline</h2>
        {events.filter((e) => match(e.type + e.title + e.body)).map((e, i) => (
          <div key={i} style={{ marginBottom: 8, borderBottom: '1px solid #2e3445', paddingBottom: 6 }}>
            <strong>{e.type}</strong> · {e.title} · {(e.at || '').slice(0, 16)}
            <div style={{ color: '#8b93a7' }}>{e.body}</div>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          <select style={inp} value={eventType} onChange={(e) => setEventType(e.target.value)}>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <input style={inp} placeholder="Title" value={eventTitle} onChange={(e) => setEventTitle(e.target.value)} />
          <input style={inp} placeholder="Note" value={note} onChange={(e) => setNote(e.target.value)} />
          <button
            type="button"
            style={ghost}
            onClick={() => {
              window.magnetDash
                .event({ type: eventType, title: eventTitle || eventType, body: note })
                .then(setData);
              setEventTitle('');
              setNote('');
            }}
          >
            Add event
          </button>
        </div>
      </section>
    </div>
  );
}

const page = {
  fontFamily: 'IBM Plex Sans, Segoe UI, sans-serif',
  background: '#12141a',
  color: '#e8eaef',
  minHeight: '100vh',
  margin: 0,
  padding: 24,
};
const h2 = { fontSize: 14, margin: '20px 0 8px' };
const chip = {
  display: 'inline-block',
  marginTop: 8,
  padding: '2px 8px',
  borderRadius: 99,
  background: '#1a1d27',
  border: '1px solid #2e3445',
  fontSize: 12,
};
const rejectBtn = {
  width: '100%',
  padding: '18px 12px',
  fontSize: 22,
  fontWeight: 700,
  background: '#dc2626',
  color: '#fff',
  border: 0,
  borderRadius: 12,
  cursor: 'pointer',
};
const ghost = {
  background: '#1a1d27',
  color: '#e8eaef',
  border: '1px solid #2e3445',
  borderRadius: 8,
  padding: '6px 10px',
  cursor: 'pointer',
};
const pre = {
  whiteSpace: 'pre-wrap',
  maxHeight: 160,
  overflow: 'auto',
  background: '#1a1d27',
  padding: 10,
  borderRadius: 8,
  fontSize: 12,
  color: '#8b93a7',
};
const area = {
  width: '100%',
  minHeight: 80,
  background: '#1a1d27',
  color: '#e8eaef',
  border: '1px solid #2e3445',
  borderRadius: 8,
  padding: 8,
};
const inp = {
  background: '#1a1d27',
  color: '#e8eaef',
  border: '1px solid #2e3445',
  borderRadius: 6,
  padding: '6px 8px',
};
const findInp = {
  ...inp,
  width: '100%',
  marginBottom: 12,
};
