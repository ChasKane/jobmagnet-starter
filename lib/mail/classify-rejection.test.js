const { test } = require('node:test');
const assert = require('node:assert/strict');
const { classifyRejection, planFiling } = require('./classify-rejection');

test('Greenhouse template is definite reject', () => {
  const out = classifyRejection({
    from: 'Acme <no-reply@greenhouse-mail.io>',
    subject: 'Your application to Acme',
    text: 'Thank you for your interest in Acme. After careful review, we will not be moving forward with your application.',
  });
  assert.equal(out.verdict, 'reject');
  assert.equal(planFiling(out).archive, true);
  assert.equal(planFiling(out).notify, false);
});

test('Lever template is definite reject', () => {
  const out = classifyRejection({
    from: 'Lever <hello@hire.lever.co>',
    subject: 'Update on your application',
    text: 'We enjoyed learning about you. We have decided to pursue other candidates at this time.',
  });
  assert.equal(out.verdict, 'reject');
});

test('Ashby template is definite reject', () => {
  const out = classifyRejection({
    from: 'Jobs <notifications@ashbyhq.com>',
    subject: 'Application update',
    text: 'Unfortunately you were not selected to continue in the process for this role.',
  });
  assert.equal(out.verdict, 'reject');
});

test('application received is not a reject', () => {
  const out = classifyRejection({
    from: 'Acme <no-reply@greenhouse-mail.io>',
    subject: 'Application received',
    text: 'Thanks for applying to Acme. We received your application and will be in touch.',
  });
  assert.equal(out.verdict, 'received');
  assert.equal(planFiling(out).bucket, 'received');
  assert.equal(planFiling(out).archive, true);
  assert.equal(planFiling(out).notify, false);
});

test("we've received your application is archived as a receipt", () => {
  const out = classifyRejection({
    from: 'Acme <no-reply@greenhouse-mail.io>',
    subject: "We've received your application",
    text: "We've received your application for Frontend Engineer and will review it soon.",
  });
  assert.equal(out.verdict, 'received');
  assert.equal(planFiling(out).archive, true);
});

test("we've decided not to move forward is archived as a reject", () => {
  const out = classifyRejection({
    from: 'Acme <no-reply@greenhouse-mail.io>',
    subject: 'Your application to Acme',
    text: "We've decided not to move forward with your application.",
  });
  assert.equal(out.verdict, 'reject');
  assert.equal(planFiling(out).archive, true);
});

test('thanks for applying alone is not definite reject', () => {
  const out = classifyRejection({
    from: 'jobs@acme.com',
    subject: 'Thanks for applying',
    text: 'Thank you for applying to the Frontend Engineer role at Acme. Our team will review your materials.',
  });
  assert.equal(out.verdict, 'received');
  assert.equal(planFiling(out).archive, true);
});

test('thanks plus deny clause is reject', () => {
  const out = classifyRejection({
    from: 'Acme <no-reply@greenhouse-mail.io>',
    subject: 'Thanks for applying',
    text: 'Thank you for applying. Unfortunately we will not be moving forward with your candidacy.',
  });
  assert.equal(out.verdict, 'reject');
});

test('Calendly interview invite is not a reject', () => {
  const out = classifyRejection({
    from: 'Recruiter <recruiter@acme.com>',
    subject: 'Interview invitation',
    text: 'Please schedule your interview here: https://calendly.com/acme/screen',
  });
  assert.equal(out.verdict, 'not_reject');
  assert.equal(planFiling(out).bucket, 'other');
  assert.equal(planFiling(out).notify, true);
  assert.equal(planFiling(out).archive, false);
});

test('CodeSignal assessment is not a reject', () => {
  const out = classifyRejection({
    from: 'CodeSignal <noreply@codesignal.com>',
    subject: 'Your assessment invitation',
    text: 'Complete the CodeSignal assessment for Frontend Engineer.',
  });
  assert.equal(out.verdict, 'not_reject');
});

test('recruiter inbound is not a reject', () => {
  const out = classifyRejection({
    from: 'Pat <pat@acme.com>',
    subject: 'Are you open to a role?',
    text: 'I came across your profile and reached out. If this role isn\'t a fit, no worries.',
  });
  assert.equal(out.verdict, 'not_reject');
});

test('newsletter is noise', () => {
  const out = classifyRejection({
    from: 'Digest <jobs@linkedin.com>',
    subject: 'Weekly job alert',
    text: 'New roles this week. Unsubscribe or manage email preferences.',
  });
  assert.equal(out.verdict, 'noise');
});

test('position filled plus application is reject', () => {
  const out = classifyRejection({
    from: 'Acme <no-reply@greenhouse-mail.io>',
    subject: 'Your application',
    text: 'Thank you for your application. The position has been filled.',
  });
  assert.equal(out.verdict, 'reject');
});
