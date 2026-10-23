const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PAINT_CSS, INVENTORY_SCRIPT, chatTargetScript, paintScript, flashFieldScript, harvestSelectOptionsScript } = require('./paint');
const { PAGE_CHROME_SEL } = require('./jd');

test('inventory skips cookie and feedback chrome', () => {
  assert.match(INVENTORY_SCRIPT, /onetrust/);
  assert.ok(INVENTORY_SCRIPT.includes(JSON.stringify(PAGE_CHROME_SEL)));
});

test('chat chip is field-relative, not viewport-fixed', () => {
  const chip = PAINT_CSS.match(/\.magnet-chat-chip\{[^}]+\}/)[0];
  assert.match(chip, /position:absolute/);
  assert.doesNotMatch(chip, /position:fixed/);
  const script = chatTargetScript('m1');
  assert.match(script, /data-magnet-chat-host/);
  assert.doesNotMatch(script, /document\.documentElement\.appendChild\(chip\)/);
  assert.doesNotMatch(script, /position:\s*['"]fixed['"]/);
  assert.doesNotMatch(script, /scrollIntoView/);
});

test('inventory walks past the react-select wrapper to a sibling native select', () => {
  assert.match(INVENTORY_SCRIPT, /pairedNativeSelect/);
  assert.match(INVENTORY_SCRIPT, /fromOneSelect/);
  assert.match(INVENTORY_SCRIPT, /visibleMenuOptions/);
  assert.match(INVENTORY_SCRIPT, /querySelectorAll\('select'\)/);
  assert.match(INVENTORY_SCRIPT, /keepFieldOptions/);
  assert.match(INVENTORY_SCRIPT, /looksLikeDialCountryList/);
  assert.match(INVENTORY_SCRIPT, /magnetForeignControls\(host, el\)\.length > 1/);
  assert.match(INVENTORY_SCRIPT, /magnetForeignControls\(outer, el\)\.length <= 1/);
});

test('harvest opens a closed react-select and scrapes the live menu', () => {
  const script = harvestSelectOptionsScript(['m-orient'], { open: true });
  assert.match(script, /ALLOW_OPEN = true/);
  assert.match(script, /m-orient/);
  assert.match(script, /pairedNativeSelect/);
  assert.match(script, /visibleMenuOptions/);
  assert.match(script, /fireOpen/);
  assert.match(script, /aria-expanded/);
  assert.match(script, /Escape/);
  assert.match(script, /select__option/);
  assert.match(script, /optionsById/);
  assert.match(script, /select__single-value/);
});

test('inventory reads the selected radio label, not a blank value', () => {
  assert.match(INVENTORY_SCRIPT, /selectedChoiceValue/);
  assert.match(INVENTORY_SCRIPT, /n\.checked/);
  assert.match(INVENTORY_SCRIPT, /nodes\.length <= 1/);
  assert.match(INVENTORY_SCRIPT, /return on \? 'Yes' : ''/);
});

test('inventory stamps cluster HTML then page HTML', () => {
  assert.match(INVENTORY_SCRIPT, /hostHtml/);
  assert.match(INVENTORY_SCRIPT, /clusterHtml/);
  assert.match(INVENTORY_SCRIPT, /pageHtml/);
  assert.match(INVENTORY_SCRIPT, /MAGNET_ALIAS_NEEDLES/);
  assert.doesNotMatch(INVENTORY_SCRIPT, /cloneNode/);
  assert.match(INVENTORY_SCRIPT, /boxedCount/);
});

test('paint outlines the question host, not a hosted input', () => {
  assert.match(PAINT_CSS, /data-magnet-hosted/);
  assert.match(PAINT_CSS, /data-magnet-proxy/);
  assert.match(INVENTORY_SCRIPT, /stampPaintHost/);
  assert.match(INVENTORY_SCRIPT, /paintHostOf/);
  const painted = paintScript('m1', 'green');
  assert.match(painted, /stampPaintHost/);
  assert.doesNotMatch(painted, /hidden\s*\n\s*\?\s*\(el\.closest/);
  const flash = flashFieldScript('m1');
  assert.match(flash, /paintHostOf|stampPaintHost/);
  assert.doesNotMatch(flash, /hidden\s*\n\s*\?\s*\(el\.closest/);
});

test('chat target marks the question host', () => {
  const script = chatTargetScript('m1');
  assert.match(script, /paintHostOf/);
  assert.match(script, /data-magnet-chat-target/);
});

test('inventory scopes cascade to the Ashby application form', () => {
  assert.match(INVENTORY_SCRIPT, /ashby-application-form-container/);
  assert.match(INVENTORY_SCRIPT, /isHeadingQuestion/);
  assert.match(INVENTORY_SCRIPT, /headingTag \? isHeadingQuestion/);
});

test('inventory keeps closed react-selects and reads wrapping ethnicity prompts', () => {
  assert.match(INVENTORY_SCRIPT, /questionFromNode/);
  assert.match(INVENTORY_SCRIPT, /f\.reactSelect \|\| f\.select/);
  assert.match(INVENTORY_SCRIPT, /if \(!radio && !check\) return 'id:'/);
  assert.match(INVENTORY_SCRIPT, /select__multi-value__label/);
});
