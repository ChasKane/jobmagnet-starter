/** MailPort: classify and decide without a Gmail-only product. */

const { reviewMessage, decide, classifyRejection } = require('../../packages/core/src/mail-decide');

function createMailPort(adapters = {}) {
  return {
    classify: classifyRejection,
    review: reviewMessage,
    decide,
    connect: adapters.connect,
    signOut: adapters.signOut,
    scan: adapters.scan,
    status: adapters.status,
  };
}

module.exports = { createMailPort, reviewMessage, decide, classifyRejection };
