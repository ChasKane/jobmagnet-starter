const { attachBytesScript, VERIFY_FILE_SCRIPT, CLICK_UPLOAD_SCRIPT } = require('../../../packages/core/src/apply-run');

function nativeChooser() {
  try {
    const { NativeModules } = require('react-native');
    return NativeModules.MagnetChooser || null;
  } catch {
    return null;
  }
}

function createMobileFilePort() {
  let pending = null;
  return {
    getPending() {
      return pending;
    },
    async attach({ resume, magnetInitiated, selector, eval: evalJs }) {
      if (!magnetInitiated) {
        return { ok: false, error: 'refusing to intercept a user file picker' };
      }
      if (!resume) return { ok: false, error: 'No resume in vault' };
      pending = { resume, selector, at: Date.now() };
      const bytes = resume.bytes;
      if (bytes && typeof evalJs === 'function') {
        const first = await evalJs(attachBytesScript(selector, resume.filename || 'resume.pdf', resume.mime, bytes));
        const verify = await evalJs(VERIFY_FILE_SCRIPT);
        if (first && first.ok && verify && verify.ok) {
          pending = null;
          return { ok: true, method: 'bytes', resume, verify };
        }
        const chooser = nativeChooser();
        if (chooser && typeof chooser.arm === 'function') {
          await chooser.arm(resume.abs || '', resume.filename || 'resume.pdf', bytes);
          await evalJs(CLICK_UPLOAD_SCRIPT);
          const again = await evalJs(VERIFY_FILE_SCRIPT);
          if (again && again.ok) {
            pending = null;
            return { ok: true, method: 'chooser', resume, verify: again };
          }
        }
        return {
          ok: false,
          queued: true,
          resume,
          needTap: true,
          detail: `${resume.label} is in the vault. Tap the site upload if the file did not land.`,
        };
      }
      return {
        ok: true,
        queued: true,
        resume,
        detail: `${resume.label} ready from vault. User taps on the ATS upload control still open the system picker.`,
      };
    },
  };
}

module.exports = { createMobileFilePort };
