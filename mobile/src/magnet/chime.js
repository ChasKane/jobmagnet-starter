const CHIME_SCRIPT = `(() => {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const now = ctx.currentTime;
    const notes = [
      { f: 587.33, t: 0, d: 0.09 },
      { f: 880, t: 0.08, d: 0.16 },
    ];
    for (const note of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = note.f;
      gain.gain.setValueAtTime(0.0001, now + note.t);
      gain.gain.exponentialRampToValueAtTime(0.16, now + note.t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + note.t + note.d);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + note.t);
      osc.stop(now + note.t + note.d + 0.02);
    }
  } catch (e) {}
})(); true;`;

function playChime(webRef) {
  if (!webRef || typeof webRef.injectJavaScript !== 'function') return;
  try {
    webRef.injectJavaScript(CHIME_SCRIPT);
  } catch (_) {}
}

function chatSoundOn(settings) {
  return !settings || settings.chatSound !== false;
}

module.exports = { playChime, chatSoundOn };
