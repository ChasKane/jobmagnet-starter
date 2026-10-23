import assert from 'node:assert/strict';
import test from 'node:test';
import {
  digitsFromJid,
  incomingFields,
  phoneJid,
  questionText,
  samePhone,
  statusText,
} from './format.js';

test('phone helpers compare full international numbers', () => {
  assert.equal(samePhone('+1 (206) 555-1212', '12065551212'), true);
  assert.equal(samePhone('5551212', '12065551212'), false);
  assert.equal(digitsFromJid('12065551212:4@s.whatsapp.net'), '12065551212');
  assert.equal(digitsFromJid('999@lid'), '');
  assert.equal(phoneJid('+44 7700 900123'), '447700900123@s.whatsapp.net');
});

test('status and question texts name the run and the question id', () => {
  assert.match(statusText({ agent: 'jobmagnet', message: 'Opening the PR' }), /^Cloud agent · jobmagnet\nOpening the PR$/);
  const q = questionText({ id: 'q2', agent: '', question: 'Ship it?' });
  assert.match(q, /^Cloud agent\nq2 — reply to this message\n\nShip it\?$/);
});

test('incoming fields unwrap quotes and captions', () => {
  const quoted = incomingFields({
    message: {
      ephemeralMessage: {
        message: {
          extendedTextMessage: {
            text: 'use blue',
            contextInfo: { stanzaId: 'ABC' },
          },
        },
      },
    },
  });
  assert.deepEqual(quoted, { text: 'use blue', quotedId: 'ABC', fallback: '' });

  const photo = incomingFields({ message: { imageMessage: { caption: '' } } });
  assert.equal(photo.text, '');
  assert.match(photo.fallback, /without text/);
});
