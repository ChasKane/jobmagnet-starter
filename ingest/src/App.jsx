import React, { useState } from 'react';

export default function App() {
  const [message, setMessage] = useState('');
  const [log, setLog] = useState([]);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const text = message.trim();
    if (!text || !window.magnetIngest) return;
    setBusy(true);
    setLog((l) => [...l, { role: 'you', text }]);
    setMessage('');
    try {
      const out = await window.magnetIngest.submit(text);
      setLog((l) => [...l, { role: 'magnet', text: out.reply || JSON.stringify(out) }]);
    } catch (err) {
      setLog((l) => [...l, { role: 'magnet', text: String(err.message || err) }]);
    }
    setBusy(false);
  }

  return (
    <div style={page}>
      <h1 style={{ fontSize: 16, margin: '0 0 12px' }}>Ingest</h1>
      <div style={{ flex: 1, overflow: 'auto', marginBottom: 12 }}>
        {log.map((row, i) => (
          <div key={i} style={{ marginBottom: 8, color: row.role === 'you' ? '#e8eaef' : '#86efac' }}>
            <strong>{row.role}</strong>
            <div>{row.text}</div>
          </div>
        ))}
      </div>
      <textarea
        style={area}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder='find 10 remote FE 140k+  ·  add these: https://…  ·  scan inbox  ·  sign in to gmail'
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
        }}
      />
      <button type="button" style={btn} disabled={busy} onClick={submit}>
        Submit
      </button>
    </div>
  );
}

const page = {
  fontFamily: 'IBM Plex Sans, Segoe UI, sans-serif',
  background: '#12141a',
  color: '#e8eaef',
  height: '100vh',
  margin: 0,
  padding: 16,
  display: 'flex',
  flexDirection: 'column',
  boxSizing: 'border-box',
};
const area = {
  width: '100%',
  minHeight: 80,
  background: '#1a1d27',
  color: '#e8eaef',
  border: '1px solid #2e3445',
  borderRadius: 8,
  padding: 8,
  boxSizing: 'border-box',
};
const btn = {
  marginTop: 8,
  padding: '10px 14px',
  background: '#3b82f6',
  color: '#fff',
  border: 0,
  borderRadius: 8,
  fontWeight: 650,
  cursor: 'pointer',
};
