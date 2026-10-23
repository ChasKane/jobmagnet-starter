const { test } = require('node:test');
const assert = require('node:assert/strict');
const scripts = require('./index');

test('exports injectable page scripts without clicking upload', () => {
  assert.equal(typeof scripts.INVENTORY_SCRIPT, 'string');
  assert.match(scripts.INVENTORY_SCRIPT, /data-magnet-field|querySelector/);
  assert.equal(typeof scripts.FIND_FILE_SCRIPT, 'function');
  const find = scripts.FIND_FILE_SCRIPT();
  assert.doesNotMatch(find, /Upload resume|CLICK_UPLOAD/i);
  assert.match(find, /input\[type="file"\]/);
  assert.match(scripts.BRIDGE_SCRIPT, /ReactNativeWebView/);
  assert.match(scripts.LONGPRESS_SCRIPT, /touchstart/);
});
