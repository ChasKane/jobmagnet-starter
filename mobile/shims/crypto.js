module.exports = {
  createHash() {
    return {
      update() {
        return this;
      },
      digest() {
        return '0'.repeat(16);
      },
    };
  },
};
