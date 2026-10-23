/** React Native entry — no Node builtins, no Electron lib/. */

const { COMMANDS, isCommand } = require('./commands');
const { createMagnetApp, FIND_FILE_SCRIPT, simpleFillScript, mailShortcut } = require('./magnet-app');
const { createMemoryStore, emptyProcess } = require('./memory-store');
const { createSqlStore } = require('./sql-store');
const { runPortableAutofill, VERIFY_FILE_SCRIPT, attachBytesScript } = require('./apply-run');
const jobs = require('./jobs');
const searchSchema = require('./search-schema');
const autofillQueue = require('./autofill-queue');
const { valueFromProfile } = require('./static-values');
const gmailWeb = require('./gmail-web');
const gmailApi = require('./gmail-api');
const mailNotify = require('./mail-notify');
const boards = require('./boards');
const boardsSeed = require('./boards-seed');
const loginWall = require('./login-wall');
const huntStart = require('./hunt-start');
const huntPage = require('./hunt-page');
const llmHunt = require('./llm-hunt');

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
  mailShortcut,
  valueFromProfile,
  ...searchSchema,
  ...autofillQueue,
  ...jobs,
  ...gmailWeb,
  ...gmailApi,
  ...mailNotify,
  ...boards,
  boardsSeed,
  ...loginWall,
  ...huntStart,
  ...huntPage,
  ...llmHunt,
};
