const { COMMANDS, isCommand } = require('./commands');
const { createMagnetApp, FIND_FILE_SCRIPT, simpleFillScript } = require('./magnet-app');
const { createMemoryStore, emptyProcess } = require('./memory-store');
const { createSqlStore } = require('./sql-store');
const { runPortableAutofill, VERIFY_FILE_SCRIPT, attachBytesScript } = require('./apply-run');
const jobs = require('./jobs');
const searchSchema = require('./search-schema');
const autofillQueue = require('./autofill-queue');
const { valueFromProfile } = require('./static-values');
const mailDecide = require('./mail-decide');
const mailNotify = require('./mail-notify');
const chatTabs = require('../../../lib/chat-tabs');

module.exports = {
  COMMANDS,
  isCommand,
  createMagnetApp,
  createMemoryStore,
  createSqlStore,
  runPortableAutofill,
  VERIFY_FILE_SCRIPT,
  attachBytesScript,
  emptyProcess,
  FIND_FILE_SCRIPT,
  simpleFillScript,
  valueFromProfile,
  ...searchSchema,
  ...autofillQueue,
  ...jobs,
  ...mailDecide,
  ...mailNotify,
  chatTabs,
};
