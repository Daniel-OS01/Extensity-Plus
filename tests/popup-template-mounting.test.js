const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");

test("popup header is mounted only when showHeader is strictly enabled", () => {
  const html = fs.readFileSync(path.join(repoRoot, "index.html"), "utf8");
  const indexScript = fs.readFileSync(path.join(repoRoot, "js/index.js"), "utf8");

  assert.match(html, /<div id="popup-header-mount"><\/div>/);
  assert.match(html, /<template id="popup-header-template">[\s\S]*<section id="header" class="main">/);
  assert.doesNotMatch(html, /<section id="header" class="main" data-sbind="visible: opts\.showHeader">/);
  assert.match(indexScript, /options\.showHeader === true \? "popup-header-template" : null/);
  assert.match(indexScript, /syncTemplateMount\("popup-header-mount", headerTemplateId, viewModel\);/);
});

test("popup sort toolbar is mounted only when showPopupSort is strictly enabled", () => {
  const html = fs.readFileSync(path.join(repoRoot, "index.html"), "utf8");
  const indexScript = fs.readFileSync(path.join(repoRoot, "js/index.js"), "utf8");

  assert.match(html, /<div id="popup-sort-toolbar-mount"><\/div>/);
  assert.match(html, /<template id="popup-sort-toolbar-template">[\s\S]*<section id="toolbar" class="main">/);
  assert.match(html, /<template id="popup-sort-toolbar-error-template">[\s\S]*<section id="toolbar-error" class="main">/);
  assert.doesNotMatch(html, /<section id="toolbar" class="main" data-sbind="visible: opts\.showPopupSort">/);
  assert.match(indexScript, /options\.showPopupSort === true \? "popup-sort-toolbar-template" : "popup-sort-toolbar-error-template"/);
  assert.match(indexScript, /syncTemplateMount\("popup-sort-toolbar-mount", sortTemplateId, viewModel\);/);
});
