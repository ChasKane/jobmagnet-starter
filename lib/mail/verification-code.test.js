const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extractVerificationCode, pickVerificationCode, codeQuery } = require('./verification-code');

test('reads a labeled verification code', () => {
  const text = 'A verification code was sent to you. Your security code is 4F8C2A1B. It expires soon.';
  assert.equal(extractVerificationCode(text), '4F8C2A1B');
});

test('does not treat ordinary words as a code', () => {
  assert.equal(extractVerificationCode('The code is required before Greenhouse will continue.'), '');
  assert.equal(extractVerificationCode('Visit greenhouse.io to finish.'), '');
});

test('reads a mixed-case Greenhouse code with no digit', () => {
  const text =
    'Copy and paste this code into the security code field on your application: TzNhFJSn After you enter the code, resubmit your application.';
  assert.equal(extractVerificationCode(text), 'TzNhFJSn');
});

test('reads a Greenhouse code on the same line as the field prompt', () => {
  const text =
    'Copy and paste this code into the security code field on your application: Gmk6YHj5 After you enter the code, resubmit your application.';
  assert.equal(extractVerificationCode(text), 'Gmk6YHj5');
});

test('reads a digit-free code on its own line', () => {
  const text = 'Enter the security code field on your application\n\nKMNQPWZX\n\nThis code expires in 10 minutes.';
  assert.equal(extractVerificationCode(text), 'KMNQPWZX');
});

test('picks the company message that arrived after submit', () => {
  const hit = pickVerificationCode(
    [
      {
        from: 'Greenhouse <no-reply@greenhouse-mail.io>',
        subject: 'Security code for Keeper Security',
        date: '2026-10-06T23:21:00.000Z',
        text: 'Your security code is K7NQ2P9X',
      },
      {
        from: 'Greenhouse <no-reply@greenhouse-mail.io>',
        subject: 'Security code for Other Co',
        date: '2026-10-06T23:22:00.000Z',
        text: 'Your security code is AABBCCD1',
      },
    ],
    { since: '2026-10-06T23:20:00.000Z', company: 'Keeper Security' }
  );
  assert.equal(hit.code, 'K7NQ2P9X');
});

test('ignores a code from before the submit', () => {
  const hit = pickVerificationCode(
    [
      {
        from: 'Greenhouse <no-reply@greenhouse-mail.io>',
        subject: 'Security code',
        date: '2026-10-06T23:00:00.000Z',
        text: 'Your security code is OLDCODE1',
      },
    ],
    { since: '2026-10-06T23:20:00.000Z', company: 'Keeper Security' }
  );
  assert.equal(hit, null);
});

test('query is limited to messages after the submit', () => {
  const q = codeQuery({ company: 'Keeper Security', since: '2026-10-06T23:20:00.000Z' });
  assert.match(q, /after:\d+/);
  assert.match(q, /verification code/);
  assert.match(q, /Keeper Security/);
});
