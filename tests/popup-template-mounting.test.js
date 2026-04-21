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
  assert.match(indexScript, /function mountPopupHeaderIfEnabled\(state, viewModel\)/);
  assert.match(indexScript, /safeState\.options\.showHeader !== true/);
  assert.match(indexScript, /syncTemplateMount\("popup-header-mount", null, viewModel\)/);
  assert.match(indexScript, /syncTemplateMount\("popup-header-mount", "popup-header-template", viewModel\)/);
  assert.match(indexScript, /mountPopupHeaderIfEnabled\(null, vm\)/);
});

test("popup sort toolbar is mounted only when showPopupSort is strictly enabled", () => {
  const html = fs.readFileSync(path.join(repoRoot, "index.html"), "utf8");
  const indexScript = fs.readFileSync(path.join(repoRoot, "js/index.js"), "utf8");

  assert.match(html, /<div id="popup-sort-toolbar-mount"><\/div>/);
  assert.match(html, /<template id="popup-sort-toolbar-template">[\s\S]*<section id="toolbar" class="main">/);
  assert.match(html, /<template id="popup-sort-toolbar-error-template">[\s\S]*<section id="toolbar-error" class="main">/);
  assert.doesNotMatch(html, /<section id="toolbar" class="main" data-sbind="visible: opts\.showPopupSort">/);
  assert.match(indexScript, /function mountPopupSortToolbar\(state, viewModel\)/);
  assert.match(indexScript, /safeState\.options\.showPopupSort === true/);
  assert.match(indexScript, /syncTemplateMount\("popup-sort-toolbar-mount", templateId, viewModel\)/);
  assert.match(indexScript, /mountPopupSortToolbar\(null, vm\)/);
});

test("popup chrome mount helper is idempotent and rebind-safe", () => {
  const indexScript = fs.readFileSync(path.join(repoRoot, "js/index.js"), "utf8");

  assert.match(indexScript, /function syncTemplateMount\(mountId, templateId, viewModel\)/);
  assert.match(indexScript, /currentTemplateId === nextTemplateId/);
  assert.match(indexScript, /if \(!templateId\) \{\s*mountNode\.textContent = "";\s*mountNode\.setAttribute\("data-template-id", ""\);/);
  assert.match(indexScript, /mountNode\.setAttribute\("data-template-id", nextTemplateId\)/);
  assert.match(indexScript, /viewModel\._popupBindingsReady === true/);
  assert.match(indexScript, /ko\.applyBindingsToDescendants\(viewModel, mountNode\)/);
  assert.match(indexScript, /mountPopupHeaderIfEnabled\(state, self\)/);
  assert.match(indexScript, /mountPopupSortToolbar\(state, self\)/);
  assert.match(indexScript, /function normalizePopupState\(state\)/);
});

test("popup files contain no unresolved merge markers", () => {
  const html = fs.readFileSync(path.join(repoRoot, "index.html"), "utf8");
  const indexScript = fs.readFileSync(path.join(repoRoot, "js/index.js"), "utf8");

  assert.doesNotMatch(html, /^<<<<<<<|^=======|^>>>>>>>/m);
  assert.doesNotMatch(indexScript, /^<<<<<<<|^=======|^>>>>>>>/m);
});

test("popup favorites section renders as a dedicated divider list", () => {
  const html = fs.readFileSync(path.join(repoRoot, "index.html"), "utf8");
  const indexScript = fs.readFileSync(path.join(repoRoot, "js/index.js"), "utf8");

  assert.match(html, /<section id="favorites-section" data-sbind="visible: listedFavorites\.any">/);
  assert.match(html, /<h1>Favorites<\/h1>/);
  assert.match(html, /template: \{name: 'item-template', foreach: listedFavorites\}/);
  assert.match(indexScript, /self\.listedFavorites = ko\.computed\(function\(\) \{/);
  assert.match(indexScript, /self\.isFavoriteItem = function\(item\) \{/);
  assert.match(indexScript, /return self\.search\.matchesExtension\(item\) && self\.isFavoriteItem\(item\);/);
});

test("popup hides content by default until knockout applies loading state", () => {
  const html = fs.readFileSync(path.join(repoRoot, "index.html"), "utf8");

  assert.match(html, /<section id="content" class="main" style="display:none;" data-sbind="visible: !loading\(\)">/);
  assert.match(html, /<section id="loading-section" class="main" data-sbind="visible: loading">/);
});
