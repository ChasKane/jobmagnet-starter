module.exports = {
  existsSync() {
    return false;
  },
  readFileSync() {
    return '';
  },
  writeFileSync() {},
  appendFileSync() {},
  mkdirSync() {},
  readdirSync() {
    return [];
  },
  statSync() {
    return { isFile: () => false, isDirectory: () => false };
  },
};
