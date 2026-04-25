const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const fs = require("node:fs");

const { loadBrowserScript } = require("./helpers/load-browser-script");

const repoRoot = path.resolve(__dirname, "..");

function loadDashboard() {
  const exportTarget = {};
  const fakeWindow = exportTarget;
  const fakeDocument = {
    addEventListener(event, handler) {
      if (event === "DOMContentLoaded") {
        handler();
      }
    }
  };
  const fakeUnderscore = {
    defer() {}
  };

  loadBrowserScript(path.join(repoRoot, "js/dashboard.js"), {
    document: fakeDocument,
    window: fakeWindow,
    _: fakeUnderscore,
    ko: undefined,
    ExtensityStorage: undefined,
    chrome: undefined
  });

  return fakeWindow;
}

test("parseRuleDraft accepts a valid draft hash", () => {
  const win = loadDashboard();
  const result = win.ExtensityDashboardInternals.parseRuleDraft(
    "#rules?draftId=rule-x&host=github.com&pattern=*%3A%2F%2Fgithub.com%2F*&suggestWww=1&source=add_active_site"
  );
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    draftId: "rule-x",
    host: "github.com",
    pattern: "*://github.com/*",
    source: "add_active_site",
    suggestWww: true,
    tab: "rules"
  });
});

test("parseRuleDraft suggestWww=0 means false", () => {
  const win = loadDashboard();
  const result = win.ExtensityDashboardInternals.parseRuleDraft(
    "#rules?draftId=rule-x&host=keep.google.com&pattern=*%3A%2F%2Fkeep.google.com%2F*&suggestWww=0&source=add_active_site"
  );
  assert.equal(result.suggestWww, false);
});

test("parseRuleDraft surfaces error param without other fields", () => {
  const win = loadDashboard();
  const result = win.ExtensityDashboardInternals.parseRuleDraft("#rules?error=unsupported_scheme");
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { tab: "rules", error: "unsupported_scheme" });
});

test("parseRuleDraft rejects oversize hash", () => {
  const win = loadDashboard();
  const longPattern = "*".repeat(600);
  const hash = "#rules?draftId=x&host=h&pattern=" + encodeURIComponent(longPattern) + "&suggestWww=0&source=add_active_site";
  assert.equal(win.ExtensityDashboardInternals.parseRuleDraft(hash), null);
});

test("parseRuleDraft rejects malformed pattern", () => {
  const win = loadDashboard();
  const badHash = "#rules?draftId=x&host=h&pattern=" + encodeURIComponent("javascript:alert(1)") + "&suggestWww=0&source=add_active_site";
  assert.equal(win.ExtensityDashboardInternals.parseRuleDraft(badHash), null);
});

test("parseRuleDraft rejects unknown source", () => {
  const win = loadDashboard();
  const hash = "#rules?draftId=x&host=h&pattern=*%3A%2F%2Fh%2F*&suggestWww=0&source=other";
  assert.equal(win.ExtensityDashboardInternals.parseRuleDraft(hash), null);
});

test("parseRuleDraft rejects non-rules tab", () => {
  const win = loadDashboard();
  const hash = "#groups?draftId=x&host=h&pattern=*%3A%2F%2Fh%2F*&suggestWww=0&source=add_active_site";
  assert.equal(win.ExtensityDashboardInternals.parseRuleDraft(hash), null);
});

test("parseRuleDraft rejects empty/non-string input", () => {
  const win = loadDashboard();
  assert.equal(win.ExtensityDashboardInternals.parseRuleDraft(""), null);
  assert.equal(win.ExtensityDashboardInternals.parseRuleDraft(null), null);
  assert.equal(win.ExtensityDashboardInternals.parseRuleDraft(undefined), null);
});

test("dashboard.html contains the draft www checkbox and duplicate-pattern note", () => {
  const html = fs.readFileSync(path.join(repoRoot, "dashboard.html"), "utf8");
  assert.match(html, /data-sbind="visible: isDraft"/);
  assert.match(html, /checked: draftWww/);
  assert.match(html, /text: draftWwwLabel/);
  assert.match(html, /text: duplicatePatternNote/);
});

test("popup template uses fa-link button bound to addActiveSiteToUrlRulesAction", () => {
  const html = fs.readFileSync(path.join(repoRoot, "index.html"), "utf8");
  assert.doesNotMatch(html, /click: copyLinkAction/);
  assert.match(html, /click: addActiveSiteToUrlRulesAction/);
  assert.match(html, /enable: addActiveSiteEnabled/);
  assert.match(html, /<i class="fa fa-link"/);
});
