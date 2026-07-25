importScripts(
  "storage.js",
  "migration.js",
  "import-export.js",
  "url-rules.js",
  "history-logger.js",
  "reminders.js",
  "logger.js",
  "drive-oauth-config.js",
  "drive-sync.js"
);

(function(root) {
  var storage = root.ExtensityStorage;
  var migrations = root.ExtensityMigrations;
  var importExport = root.ExtensityImportExport;
  var urlRules = root.ExtensityUrlRules;
  var history = root.ExtensityHistory;
  var reminders = root.ExtensityReminders;
  var driveSync = root.ExtensityDriveSync;
  var logger = root.ExtensityLogger;
  var driveSyncAlarmName = "extensity-drive-auto-sync";
  var driveChangeSyncAlarmName = "extensity-drive-change-sync";
  var driveStartupSyncAlarmName = "extensity-drive-startup-sync";
  var driveChangeSyncTimer = null;
  var driveApplyingPatches = false;
  var urlRuleTimeoutAlarmPrefix = "extensity-url-rule-timeout-";
  var urlEvaluationTimers = {};
  var tabRuleApplications = {};
  var metadataCacheTtlMs = 7 * 24 * 60 * 60 * 1000;
  var webStorePermissionOrigin = "https://chromewebstore.google.com/*";
  var _mgmtCache = null;
  var _mgmtCacheTime = 0;
  var _mgmtCacheEnabled = true;
  var _mgmtCacheTtlMs = 10000;

  function applyCacheOptions(opts) {
    _mgmtCacheEnabled = opts && opts.cacheManagementItems !== false;
    var ttl = opts && typeof opts.managementCacheTtlSeconds === "number" ? opts.managementCacheTtlSeconds : 10;
    _mgmtCacheTtlMs = Math.max(2, ttl) * 1000;
  }

  function invalidateManagementCache() {
    _mgmtCache = null;
    _mgmtCacheTime = 0;
  }

  function chromeCall(target, method, args) {
    return new Promise(function(resolve, reject) {
      var finalArgs = (args || []).slice();
      finalArgs.push(function(result) {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(result);
      });
      target[method].apply(target, finalArgs);
    });
  }

  function hasChromeMethod(target, method) {
    return !!target && typeof target[method] === "function";
  }

  function addChromeListener(eventTarget, listener) {
    if (!eventTarget || typeof eventTarget.addListener !== "function") {
      return false;
    }
    eventTarget.addListener(listener);
    return true;
  }

  function isAppType(type) {
    return ["hosted_app", "legacy_packaged_app", "packaged_app"].indexOf(type) !== -1;
  }

  function urlRuleTimeoutAlarmName() {
    return urlRuleTimeoutAlarmPrefix + storage.makeId("alarm");
  }

  function isUrlRuleTimeoutAlarm(name) {
    return String(name || "").indexOf(urlRuleTimeoutAlarmPrefix) === 0;
  }

  async function clearUrlRuleTimeoutQueue(queue) {
    var entries = Array.isArray(queue) ? queue : [];
    await Promise.all(entries.map(function(entry) {
      return chromeCall(chrome.alarms, "clear", [entry.alarmName]);
    }));
    await storage.saveLocalState({ urlRuleTimeoutQueue: [] });
  }

  function cloneRuleEntries(entries) {
    return (Array.isArray(entries) ? entries : []).map(function(entry) {
      return {
        enabled: !!entry.enabled,
        id: entry.id || entry.extensionId,
        ruleId: entry.ruleId || null,
        ruleName: entry.ruleName || null,
        tabId: entry.tabId != null ? entry.tabId : null,
        url: entry.url || ""
      };
    }).filter(function(entry) {
      return !!entry.id;
    });
  }

  function buildRuleApplication(entries, url, tabId) {
    var normalizedEntries = cloneRuleEntries(entries);
    return {
      entriesById: normalizedEntries.reduce(function(result, entry) {
        result[entry.id] = entry;
        return result;
      }, {}),
      enabledIds: storage.uniqueArray(normalizedEntries.filter(function(entry) {
        return entry.enabled;
      }).map(function(entry) {
        return entry.id;
      })),
      tabId: tabId,
      url: url || ""
    };
  }

  async function appendDebugHistoryRecords(records) {
    if (!records || !records.length) {
      return;
    }
    var localState = await storage.loadLocalState();
    await storage.saveLocalState({
      eventHistory: history.appendHistory(localState.eventHistory, records)
    });
  }

  function createDebugHistoryRecord(current, payload) {
    if (!current || !current.options || !current.options.debugHistoryVerbose) {
      return null;
    }
    return history.createEventRecord(payload);
  }

  async function scheduleUrlRuleTimeoutDisable(entries, minutes, tabId) {
    var normalizedEntries = cloneRuleEntries(entries).filter(function(entry) {
      return entry.enabled;
    });
    if (!normalizedEntries.length) {
      return;
    }

    var alarmName = urlRuleTimeoutAlarmName();
    var localState = await storage.loadLocalState();
    var queue = Array.isArray(localState.urlRuleTimeoutQueue) ? localState.urlRuleTimeoutQueue.slice() : [];
    queue.push({
      alarmName: alarmName,
      entries: normalizedEntries,
      tabId: tabId,
      timestamp: Date.now()
    });
    await storage.saveLocalState({ urlRuleTimeoutQueue: queue });
    chrome.alarms.create(alarmName, { delayInMinutes: minutes });
  }

  async function handleUrlRuleTimeoutAlarm(alarmName) {
    var localState = await storage.loadLocalState();
    var queue = Array.isArray(localState.urlRuleTimeoutQueue) ? localState.urlRuleTimeoutQueue.slice() : [];
    var entry = queue.find(function(item) { return item.alarmName === alarmName; });
    var nextQueue = queue.filter(function(item) { return item.alarmName !== alarmName; });
    await storage.saveLocalState({ urlRuleTimeoutQueue: nextQueue });

    if (!entry || !Array.isArray(entry.entries) || !entry.entries.length) {
      return;
    }

    var current = await loadContext();
    var disableChanges = cloneRuleEntries(entry.entries).map(function(change) {
      return {
        enabled: false,
        id: change.id,
        ruleId: change.ruleId,
        ruleName: change.ruleName,
        tabId: change.tabId,
        url: change.url
      };
    });
    var debugRecord = createDebugHistoryRecord(current, {
      action: "url_rule_timeout_alarm",
      debug: {
        entries: disableChanges,
        queueSize: nextQueue.length
      },
      event: "timeout",
      label: "URL rule timeout fired",
      result: "alarm_fired",
      tabId: entry.tabId,
      triggeredBy: "rule",
      url: disableChanges[0] && disableChanges[0].url ? disableChanges[0].url : ""
    });
    await applyExtensionChanges(disableChanges, { source: "rule", tabId: entry.tabId }, {
      action: "url_rule_timeout",
      historyRecords: debugRecord ? [debugRecord] : [],
      pushUndo: false
    });
  }

  function smallestIcon(icons) {
    var list = Array.isArray(icons) ? icons : [];
    if (!list.length) {
      return "";
    }

    return list.slice().sort(function(left, right) {
      return left.size - right.size;
    })[0].url || "";
  }

  function filterManagedItems(items) {
    return items.filter(function(item) {
      return item.id !== chrome.runtime.id && item.type !== "theme";
    });
  }

  function buildSnapshot(items) {
    return items.reduce(function(result, item) {
      if (item.type === "extension" && item.mayDisable) {
        result[item.id] = !!item.enabled;
      }
      return result;
    }, {});
  }

  function pushUndoEntry(undoStack, action, snapshot) {
    var stack = Array.isArray(undoStack) ? undoStack.slice() : [];
    stack.push({
      action: action,
      snapshot: snapshot,
      timestamp: Date.now()
    });
    return stack.slice(-20);
  }

  function applyUsageMetrics(localState, changes, context) {
    var usageCounters = storage.clone(localState.usageCounters || {});
    var recentlyUsed = Array.isArray(localState.recentlyUsed) ? localState.recentlyUsed.slice() : [];
    var shouldCount = ["bulk", "manual", "profile", "rule"].indexOf(context.source) !== -1;

    if (!shouldCount) {
      return {
        recentlyUsed: recentlyUsed,
        usageCounters: usageCounters
      };
    }

    changes.forEach(function(change) {
      usageCounters[change.id] = (usageCounters[change.id] || 0) + 1;
      recentlyUsed = [change.id].concat(recentlyUsed.filter(function(id) {
        return id !== change.id;
      }));
    });

    return {
      recentlyUsed: recentlyUsed.slice(0, 50),
      usageCounters: usageCounters
    };
  }

  function buildGroupLookup(groups) {
    return Object.keys(groups || {}).reduce(function(result, groupId) {
      var group = groups[groupId];
      var extensionIds = storage.uniqueArray(group && group.extensionIds ? group.extensionIds : []);
      extensionIds.forEach(function(extensionId) {
        if (!result[extensionId]) {
          result[extensionId] = [];
        }
        result[extensionId].push(groupId);
      });
      return result;
    }, {});
  }

  function normalizeGroup(group) {
    return {
      color: group.color || "#516C97",
      extensionIds: storage.uniqueArray(group.extensionIds || []),
      fixed: !!group.fixed,
      id: group.id || storage.makeId("group"),
      name: (group.name || "").trim() || "Untitled Group"
    };
  }

  function normalizeGroups(groups) {
    var normalized = {};
    var order = [];

    Object.keys(groups || {}).forEach(function(groupId) {
      var group = normalizeGroup(groups[groupId]);
      normalized[group.id] = group;
      order.push(group.id);
    });

    return {
      groupOrder: order,
      groups: normalized
    };
  }

  function firstDescriptionLine(value) {
    return String(value || "")
      .split(/\r?\n/)
      .map(function(line) {
        return line.trim();
      })
      .filter(Boolean)[0] || "";
  }

  function defaultCategoryForInstallType(installType) {
    return installType === "development" ? "Developer" : "";
  }

  function decodeHtmlEntities(value) {
    return String(value || "")
      .replace(/&quot;/g, "\"")
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&#(\d+);/g, function(match, code) {
        var parsed = parseInt(code, 10);
        return isFinite(parsed) ? String.fromCharCode(parsed) : match;
      });
  }

  function buildGenericStoreUrl(extensionId) {
    return "https://chromewebstore.google.com/detail/extension/" + extensionId;
  }

  function normalizeCategoryText(value) {
    var text = decodeHtmlEntities(String(value || ""))
      .replace(/\s+/g, " ")
      .trim();

    if (!text) {
      return "";
    }

    if (/^extensions?$/i.test(text)) {
      return "";
    }

    return text;
  }

  function normalizeStoreUrl(value) {
    if (!value) {
      return "";
    }
    if (/^https:\/\/chromewebstore\.google\.com\//i.test(value)) {
      return value;
    }
    if (/^https:\/\/chrome\.google\.com\/webstore\//i.test(value)) {
      return value.replace("https://chrome.google.com/webstore/", "https://chromewebstore.google.com/");
    }
    return "";
  }

  function isFreshMetadata(entry) {
    if (!entry || !entry.fetchedAt) {
      return false;
    }

    var maxAge = entry.source === "fallback"
      ? Math.min(metadataCacheTtlMs, 12 * 60 * 60 * 1000)
      : metadataCacheTtlMs;

    return (Date.now() - entry.fetchedAt) < maxAge;
  }

  function buildFallbackMetadata(item) {
    return {
      category: item.installType === "development" ? "Developer" : "",
      descriptionLine: firstDescriptionLine(item.description || ""),
      fetchedAt: Date.now(),
      source: "fallback",
      storeUrl: normalizeStoreUrl(item.homepageUrl || "")
    };
  }

  function parseChromeWebStoreHtml(html, requestUrl) {
    function firstMeaningfulCategoryLinkText() {
      var categoryLinkRegex = /<a[^>]+href="([^"]*\/category\/[^"]+)"[^>]*>([^<]+)<\/a>/ig;
      var match;

      while ((match = categoryLinkRegex.exec(html))) {
        var href = String(match[1] || "").toLowerCase();
        var linkText = normalizeCategoryText(match[2]);
        if (!linkText) {
          continue;
        }

        if (/\/(category\/extensions?)$/i.test(href) || /^extensions?$/i.test(linkText)) {
          continue;
        }

        if (/\/category\/extensions\//i.test(href)) {
          return linkText;
        }

        return linkText;
      }

      return "";
    }

    function readCategoryFromJsonObject(value) {
      if (!value || typeof value !== "object") {
        return "";
      }

      if (typeof value.applicationCategory === "string" && value.applicationCategory.trim()) {
        return normalizeCategoryText(value.applicationCategory);
      }
      if (typeof value.genre === "string" && value.genre.trim()) {
        return normalizeCategoryText(value.genre);
      }
      if (typeof value.category === "string" && value.category.trim()) {
        return normalizeCategoryText(value.category);
      }
      if (value.about && typeof value.about.name === "string" && value.about.name.trim()) {
        return normalizeCategoryText(value.about.name);
      }

      for (var key in value) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) {
          continue;
        }

        var nextValue = value[key];
        if (Array.isArray(nextValue)) {
          for (var j = 0; j < nextValue.length; j += 1) {
            var fromArray = readCategoryFromJsonObject(nextValue[j]);
            if (fromArray) {
              return fromArray;
            }
          }
          continue;
        }

        var nested = readCategoryFromJsonObject(nextValue);
        if (nested) {
          return nested;
        }
      }

      return "";
    }

    function categoryFromStructuredData() {
      var ldJsonRegex = /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/ig;
      var scriptMatch;
      while ((scriptMatch = ldJsonRegex.exec(html))) {
        try {
          var parsedJson = JSON.parse(scriptMatch[1]);
          var categoryFromLd = readCategoryFromJsonObject(parsedJson);
          if (categoryFromLd) {
            return categoryFromLd;
          }
        } catch (error) {
          // Ignore malformed blobs and continue with other candidates.
        }
      }

      var blobCategoryMatch = html.match(/"(?:applicationCategory|genre|category)"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/i);
      if (blobCategoryMatch && blobCategoryMatch[1]) {
        return normalizeCategoryText(blobCategoryMatch[1].replace(/\\"/g, '"'));
      }

      return "";
    }

    var canonicalMatch = html.match(/<link rel="canonical" href="([^"]+)"/i);
    var descriptionMatch = html.match(/<meta[^>]+name="description"[^>]+content="([^"]+)"/i)
      || html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]+)"/i);
    var category = categoryFromStructuredData() || firstMeaningfulCategoryLinkText();

    return {
      category: normalizeCategoryText(category),
      descriptionLine: firstDescriptionLine(decodeHtmlEntities(descriptionMatch ? descriptionMatch[1] : "")),
      fetchedAt: Date.now(),
      source: "store",
      storeUrl: normalizeStoreUrl(canonicalMatch ? canonicalMatch[1] : requestUrl)
    };
  }

  function hasWebStorePermission() {
    return new Promise(function(resolve) {
      chrome.permissions.contains(
        { origins: ["https://chromewebstore.google.com/*"] },
        function(granted) { resolve(granted); }
      );
    });
  }

  async function fetchChromeWebStoreMetadata(item) {
    var granted = await hasWebStorePermission();
    if (!granted) {
      throw new Error("Chrome Web Store access not granted.");
    }
    var requestUrl = buildGenericStoreUrl(item.id);
    var response = await fetch(requestUrl);
    if (!response.ok) {
      throw new Error("Store metadata fetch failed: " + response.status);
    }

    var html = await response.text();
    var parsed = parseChromeWebStoreHtml(html, requestUrl);
    if (!parsed.descriptionLine && !parsed.category && !parsed.storeUrl) {
      throw new Error("Store metadata parse failed.");
    }
    return parsed;
  }

  async function loadExtensionMetadata(extensionIds, options) {
    var config = options || {};
    var requestedIds = storage.uniqueArray(extensionIds || []);
    if (!requestedIds.length) {
      return {};
    }

    var localState = await storage.loadLocalState();
    var cache = storage.clone(localState.webStoreMetadata || {});
    var items = await getAllManagementItems();
    var itemMap = items.reduce(function(result, item) {
      result[item.id] = item;
      return result;
    }, {});
    var metadataMap = {};
    var cacheUpdated = false;

    for (var index = 0; index < requestedIds.length; index += 1) {
      var extensionId = requestedIds[index];
      var item = itemMap[extensionId];
      if (!item) {
        continue;
      }

      var fallback = buildFallbackMetadata(item);
      var cached = cache[extensionId];
      var cachedCategory = normalizeCategoryText(cached && cached.category);
      if (!config.forceRefresh && isFreshMetadata(cached)) {
        cachedCategory = normalizeCategoryText(cached.category);
        metadataMap[extensionId] = {
          category: cached.category !== undefined ? cachedCategory : fallback.category,
          descriptionLine: cached.descriptionLine || fallback.descriptionLine,
          fetchedAt: cached.fetchedAt,
          source: cached.source || "fallback",
          storeUrl: cached.storeUrl || fallback.storeUrl
        };
        continue;
      }

      var nextMetadata;
      if (item.installType === "development" || item.type !== "extension") {
        nextMetadata = fallback;
      } else {
        try {
          nextMetadata = fetchChromeWebStoreMetadata(item).then(function(parsed) {
            var parsedCategory = normalizeCategoryText(parsed.category);
            return {
              category: parsedCategory,
              descriptionLine: parsed.descriptionLine || fallback.descriptionLine,
              fetchedAt: parsed.fetchedAt,
              source: parsed.source,
              storeUrl: parsed.storeUrl || fallback.storeUrl
            };
          });
          nextMetadata = await nextMetadata;
        } catch (error) {
          nextMetadata = {
            category: cachedCategory || fallback.category,
            descriptionLine: (cached && cached.descriptionLine) || fallback.descriptionLine,
            fetchedAt: Date.now(),
            source: "fallback",
            storeUrl: normalizeStoreUrl((cached && cached.storeUrl) || fallback.storeUrl)
          };
        }
      }

      cache[extensionId] = nextMetadata;
      metadataMap[extensionId] = nextMetadata;
      cacheUpdated = true;
    }

    if (cacheUpdated) {
      await storage.saveLocalState({ webStoreMetadata: cache });
    }

    return metadataMap;
  }

  async function getAllManagementItems() {
    var now = Date.now();
    if (_mgmtCache && _mgmtCacheEnabled && (now - _mgmtCacheTime) < _mgmtCacheTtlMs) {
      return _mgmtCache;
    }
    var items = await chromeCall(chrome.management, "getAll", []);
    _mgmtCache = filterManagedItems(items);
    _mgmtCacheTime = Date.now();
    return _mgmtCache;
  }

  async function setExtensionEnabled(extensionId, enabled) {
    await chromeCall(chrome.management, "setEnabled", [extensionId, enabled]);
    invalidateManagementCache();
  }

  async function uninstallExtension(extensionId) {
    await chromeCall(chrome.management, "uninstall", [extensionId]);
  }

  async function createTab(url) {
    var targetUrl = /^[a-z]+:\/\//i.test(url) ? url : chrome.runtime.getURL(String(url).replace(/^\//, ""));
    return chromeCall(chrome.tabs, "create", [{ active: true, url: targetUrl }]);
  }

  function buildManageExtensionUrl(extensionId) {
    return "chrome://extensions/?id=" + encodeURIComponent(extensionId);
  }

  function wait(delayMs) {
    return new Promise(function(resolve) {
      setTimeout(resolve, delayMs);
    });
  }

  async function queryTabs(queryInfo) {
    return chromeCall(chrome.tabs, "query", [queryInfo || {}]);
  }

  async function updateTab(tabId, updateProperties) {
    return chromeCall(chrome.tabs, "update", [tabId, updateProperties || {}]);
  }

  async function removeTab(tabId) {
    return chromeCall(chrome.tabs, "remove", [tabId]);
  }

  function hasDebuggerApi() {
    return hasChromeMethod(chrome.debugger, "attach")
      && hasChromeMethod(chrome.debugger, "detach")
      && hasChromeMethod(chrome.debugger, "sendCommand");
  }

  async function findManageExtensionTab(extensionId) {
    if (!hasChromeMethod(chrome.tabs, "query")) {
      return null;
    }

    var targetUrl = buildManageExtensionUrl(extensionId);
    var tabs = await queryTabs({});
    return (tabs || []).find(function(tab) {
      return tab && tab.url === targetUrl;
    }) || null;
  }

  async function ensureManageExtensionTab(extensionId) {
    var existingTab = await findManageExtensionTab(extensionId);
    if (existingTab) {
      return {
        created: false,
        tab: existingTab
      };
    }

    return {
      created: true,
      tab: await chromeCall(chrome.tabs, "create", [{
        active: false,
        url: buildManageExtensionUrl(extensionId)
      }])
    };
  }

  function buildToolbarPinAutomationExpression(shouldClick) {
    return [
      "(function() {",
      "  function matchesAny(element, selectors) {",
      "    if (!element || typeof element.matches !== 'function') {",
      "      return false;",
      "    }",
      "    for (var index = 0; index < selectors.length; index += 1) {",
      "      if (element.matches(selectors[index])) {",
      "        return true;",
      "      }",
      "    }",
      "    return false;",
      "  }",
      "  function walkTree(root, matcher) {",
      "    var queue = [root];",
      "    while (queue.length) {",
      "      var current = queue.shift();",
      "      if (!current) {",
      "        continue;",
      "      }",
      "      if (current !== root && current.nodeType === 1 && matcher(current)) {",
      "        return current;",
      "      }",
      "      if (current.shadowRoot && current.shadowRoot.mode === 'open') {",
      "        queue.push(current.shadowRoot);",
      "      }",
      "      var children = current.children || [];",
      "      for (var childIndex = 0; childIndex < children.length; childIndex += 1) {",
      "        queue.push(children[childIndex]);",
      "      }",
      "    }",
      "    return null;",
      "  }",
      "  function scrollElementIntoView(target) {",
      "    if (!target || typeof target.scrollIntoView !== 'function') {",
      "      return;",
      "    }",
      "    try {",
      "      target.scrollIntoView({ block: 'center', inline: 'center' });",
      "    } catch (error) {}",
      "  }",
      "  function readSwitchState(element) {",
      "    if (!element) {",
      "      return null;",
      "    }",
      "    var ariaChecked = element.getAttribute && element.getAttribute('aria-checked');",
      "    if (ariaChecked === 'true') {",
      "      return true;",
      "    }",
      "    if (ariaChecked === 'false') {",
      "      return false;",
      "    }",
      "    if (typeof element.checked === 'boolean') {",
      "      return !!element.checked;",
      "    }",
      "    if (element.hasAttribute && element.hasAttribute('checked')) {",
      "      return true;",
      "    }",
      "    var checkedAttribute = element.getAttribute && element.getAttribute('checked');",
      "    if (checkedAttribute === 'true' || checkedAttribute === '') {",
      "      return true;",
      "    }",
      "    if (checkedAttribute === 'false') {",
      "      return false;",
      "    }",
      "    return null;",
      "  }",
      "  function elementCenterPoint(target) {",
      "    if (!target || typeof target.getBoundingClientRect !== 'function') {",
      "      return null;",
      "    }",
      "    scrollElementIntoView(target);",
      "    var rect = target.getBoundingClientRect();",
      "    if (!rect) {",
      "      return null;",
      "    }",
      "    var width = typeof rect.width === 'number' ? rect.width : (rect.right - rect.left);",
      "    var height = typeof rect.height === 'number' ? rect.height : (rect.bottom - rect.top);",
      "    if (!isFinite(rect.left) || !isFinite(rect.top) || !isFinite(width) || !isFinite(height)) {",
      "      return null;",
      "    }",
      "    return {",
      "      x: rect.left + (width / 2),",
      "      y: rect.top + (height / 2)",
      "    };",
      "  }",
      "  function clickElement(target) {",
      "    if (!target) {",
      "      return false;",
      "    }",
      "    scrollElementIntoView(target);",
      "    if (typeof target.click === 'function') {",
      "      target.click();",
      "      return true;",
      "    }",
      "    try {",
      "      target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, view: window }));",
      "      return true;",
      "    } catch (error) {",
      "      return false;",
      "    }",
      "  }",
      "  var hostSelectors = ['extensions-toggle-row#pin-to-toolbar', '#pin-to-toolbar', 'extensions-toggle-row'];",
      "  var controlSelectors = [",
      "    '#pin-to-toolbar [role=\"switch\"]',",
      "    '#pin-to-toolbar button[role=\"switch\"]',",
      "    '#pin-to-toolbar cr-toggle',",
      "    '#pin-to-toolbar leo-toggle button',",
      "    '#pin-to-toolbar leo-toggle [role=\"switch\"]',",
      "    '#pin-to-toolbar-button',",
      "    'cr-icon-button[aria-label*=\"Pin\"]',",
      "    '[aria-label*=\"Pin to\"]',",
      "    '[role=\"switch\"]',",
      "    'button[role=\"switch\"]',",
      "    'cr-toggle',",
      "    'leo-toggle button',",
      "    'leo-toggle [role=\"switch\"]'",
      "  ];",
      "  var host = walkTree(document, function(node) {",
      "    return matchesAny(node, hostSelectors);",
      "  });",
      "  if (!host) {",
      "    host = walkTree(document, function(node) {",
      "      if (!node || !node.getAttribute) { return false; }",
      "      var label = node.getAttribute('aria-label') || node.getAttribute('aria-labelledby') || '';",
      "      return /pin.+toolbar/i.test(label);",
      "    });",
      "  }",
      "  var control = host ? walkTree(host, function(node) {",
      "    return matchesAny(node, controlSelectors);",
      "  }) : null;",
      "  if (!control && host && matchesAny(host, controlSelectors)) {",
      "    control = host;",
      "  }",
      "  if (control && (control.tagName === 'CR-TOGGLE' || control.tagName === 'LEO-TOGGLE')) {",
      "    var innerBtn = control.shadowRoot && control.shadowRoot.querySelector('button, [role=\"switch\"]');",
      "    if (innerBtn) { control = innerBtn; }",
      "  }",
      "  var state = readSwitchState(control);",
      "  if (state === null) {",
      "    state = readSwitchState(host);",
      "  }",
      "  var pointerTarget = control || host;",
      "  var point = elementCenterPoint(pointerTarget);",
      "  var clicked = false;",
      "  var clickedTarget = '';",
      "  if (host && state === false && " + (shouldClick ? "true" : "false") + ") {",
      "    if (control && control !== host) {",
      "      clicked = clickElement(control);",
      "      clickedTarget = clicked ? 'control' : '';",
      "    }",
      "    if (!clicked) {",
      "      clicked = clickElement(host);",
      "      clickedTarget = clicked ? 'row' : clickedTarget;",
      "    }",
      "  }",
      "  return {",
      "    clicked: clicked,",
      "    clickedTarget: clickedTarget,",
      "    controlFound: !!control,",
      "    found: !!host,",
      "    isPinned: state === true,",
      "    pointerReady: !!point,",
      "    pointerTarget: point ? (control ? 'control' : 'row') : '',",
      "    pointerX: point ? point.x : null,",
      "    pointerY: point ? point.y : null,",
      "    stateKnown: state !== null",
      "  };",
      "})()"
    ].join("\n");
  }

  async function evaluateToolbarPinState(target, shouldClick) {
    var response = await chromeCall(chrome.debugger, "sendCommand", [target, "Runtime.evaluate", {
      awaitPromise: true,
      expression: buildToolbarPinAutomationExpression(shouldClick),
      returnByValue: true
    }]);

    if (response && response.exceptionDetails) {
      throw new Error("Toolbar pin automation evaluation failed.");
    }

    return response && response.result ? response.result.value : null;
  }

  async function dispatchDebuggerMouseEvent(target, params) {
    return chromeCall(chrome.debugger, "sendCommand", [target, "Input.dispatchMouseEvent", params]);
  }

  async function attemptPointerToolbarPin(target, state) {
    var x = Number(state && state.pointerX);
    var y = Number(state && state.pointerY);
    if (!isFinite(x) || !isFinite(y)) {
      return false;
    }

    await dispatchDebuggerMouseEvent(target, {
      type: "mouseMoved",
      x: x,
      y: y,
      button: "none",
      buttons: 0
    });
    await wait(50);
    await dispatchDebuggerMouseEvent(target, {
      type: "mousePressed",
      x: x,
      y: y,
      button: "left",
      buttons: 1,
      clickCount: 1
    });
    await wait(50);
    await dispatchDebuggerMouseEvent(target, {
      type: "mouseReleased",
      x: x,
      y: y,
      button: "left",
      buttons: 0,
      clickCount: 1
    });
    return true;
  }

  async function waitForTabComplete(tabId, timeoutMs) {
    var deadline = Date.now() + timeoutMs;
    var lastTab = null;

    while (Date.now() < deadline) {
      lastTab = await getTab(tabId).catch(function() {
        return null;
      });
      if (lastTab && (!lastTab.status || lastTab.status === "complete")) {
        return lastTab;
      }
      await wait(100);
    }

    return lastTab;
  }

  async function waitForToolbarPinState(target, predicate, timeoutMs) {
    var deadline = Date.now() + timeoutMs;
    var lastState = null;
    var attempts = 0;

    while (Date.now() < deadline) {
      lastState = await evaluateToolbarPinState(target, false);
      if (!predicate || predicate(lastState)) {
        return lastState;
      }
      await wait(attempts === 0 ? 50 : 150);
      attempts += 1;
    }

    return lastState;
  }

  async function revealManageExtensionTab(extensionId, tabState) {
    if (tabState && tabState.tab && tabState.tab.id != null && hasChromeMethod(chrome.tabs, "update")) {
      try {
        return await updateTab(tabState.tab.id, { active: true });
      } catch (error) {
        return tabState.tab;
      }
    }

    return chromeCall(chrome.tabs, "create", [{
      active: true,
      url: buildManageExtensionUrl(extensionId)
    }]);
  }

  async function openToolbarPinFallback(extensionId, tabState, reason) {
    var tab = await revealManageExtensionTab(extensionId, tabState);
    return {
      result: "opened_fallback",
      reason: reason || "pinning_failed",
      tabId: tab && tab.id != null ? tab.id : null,
      url: buildManageExtensionUrl(extensionId)
    };
  }

  async function attemptToolbarPinWithDebugger(tabId) {
    var target = { tabId: tabId };
    var attached = false;
    function isPinnedState(state) {
      return state && state.found && state.stateKnown && state.isPinned;
    }

    try {
      await chromeCall(chrome.debugger, "attach", [target, "1.3"]);
      attached = true;

      var initialState = await waitForToolbarPinState(target, function(state) {
        return state && state.found;
      }, 5000);

      if (!initialState || !initialState.found) {
        return {
          reason: "pin_control_not_found",
          result: "failed"
        };
      }

      if (!initialState.stateKnown) {
        return {
          reason: "pin_state_unknown",
          result: "failed"
        };
      }

      if (initialState.isPinned) {
        return { result: "already_pinned" };
      }

      if (initialState.pointerReady) {
        try {
          await attemptPointerToolbarPin(target, initialState);
          await wait(150);
          var pointerState = await waitForToolbarPinState(target, function(state) {
            return state && state.found && state.stateKnown;
          }, 1000);
          if (isPinnedState(pointerState)) {
            return { result: "pinned" };
          }
        } catch (error) {}
      }

      var clickState = await evaluateToolbarPinState(target, true);
      if (isPinnedState(clickState)) {
        return { result: "pinned" };
      }

      if (!clickState || !clickState.clicked) {
        return {
          reason: "pin_click_failed",
          result: "failed"
        };
      }

      var finalState = await waitForToolbarPinState(target, isPinnedState, 2000);

      if (isPinnedState(finalState)) {
        return { result: "pinned" };
      }

      return {
        reason: "pin_not_confirmed",
        result: "failed"
      };
    } finally {
      if (attached) {
        try {
          await chromeCall(chrome.debugger, "detach", [target]);
        } catch (error) {}
      }
    }
  }

  async function getTab(tabId) {
    return chromeCall(chrome.tabs, "get", [tabId]);
  }

  async function clearAlarm(alarmName) {
    return chromeCall(chrome.alarms, "clear", [alarmName]);
  }

  async function loadContext() {
    var results = await Promise.all([
      storage.loadSyncOptions(),
      storage.loadLocalState(),
      storage.loadProfiles(),
      getAllManagementItems()
    ]);
    var localState = results[1];
    var installFirstSeenAt = storage.clone(localState.installFirstSeenAt || {});
    var installMapChanged = false;

    results[3].forEach(function(item, index) {
      if (!installFirstSeenAt[item.id]) {
        installFirstSeenAt[item.id] = Date.now() + index;
        installMapChanged = true;
      }
    });

    if (installMapChanged) {
      await storage.saveLocalState({ installFirstSeenAt: installFirstSeenAt });
      localState = Object.assign({}, localState, { installFirstSeenAt: installFirstSeenAt });
    }

    return {
      items: results[3],
      localState: localState,
      options: results[0],
      profiles: results[2]
    };
  }

  /**
   * Builds the normalized, alphabetically sorted extension list for public state.
   * @param {Array<Object>} items - Chrome management items to normalize.
   * @param {Object} state - Current local state and profile data used to enrich each extension.
   * @return {Array<Object>} Normalized extension records with metadata, groups, usage data, and status flags.
   */
  function normalizeExtensions(items, state) {
    var aliases = state.localState.aliases || {};
    var counters = state.localState.usageCounters || {};
    var recentList = Array.isArray(state.localState.recentlyUsed) ? state.localState.recentlyUsed : [];
    var groups = state.localState.groups || {};
    var groupLookup = buildGroupLookup(groups);
    var metadataCache = state.localState.webStoreMetadata || {};
    var alwaysOn = state.profiles.map.__always_on || [];
    var favorites = state.profiles.map.__favorites || [];
    var toolbarPins = state.localState.toolbarPins || [];
    var installFirstSeenAt = state.localState.installFirstSeenAt || {};

    // ⚡ Bolt Optimization: Replace O(N) array indexOf inside map loop with O(1) Sets and Maps
    var alwaysOnSet = new Set(alwaysOn);
    var favoritesSet = new Set(favorites);
    var toolbarPinsSet = new Set(toolbarPins);

    // ⚡ Bolt Optimization: Precompute Map for recent list scores to avoid calling indexOf multiple times per item
    var recentMap = new Map();
    var recentLength = recentList.length;
    for (var i = 0; i < recentLength; i++) {
        var recentId = recentList[i];
        if (!recentMap.has(recentId)) {
            recentMap.set(recentId, recentLength - i);
        }
    }

    return items.slice().sort(function(left, right) {
      return left.name.toUpperCase().localeCompare(right.name.toUpperCase());
    }).map(function(item) {
      var extensionGroups = (groupLookup[item.id] || []).map(function(groupId) {
        var group = groups[groupId];
        return {
          color: group.color || "#516C97",
          id: groupId,
          name: group.name || "Group"
        };
      });
      var fallbackMetadata = buildFallbackMetadata(item);
      var cachedMetadata = metadataCache[item.id] || {};
      var normalizedCategory = cachedMetadata.category !== undefined
        ? normalizeCategoryText(cachedMetadata.category)
        : fallbackMetadata.category;
      var normalizedStoreUrl = normalizeStoreUrl(cachedMetadata.storeUrl) || fallbackMetadata.storeUrl;

      // ⚡ Bolt Optimization: O(1) lookup
      var recentScore = recentMap.get(item.id);

      return {
        alias: aliases[item.id] || "",
        alwaysOn: alwaysOnSet.has(item.id),
        category: normalizedCategory,
        description: item.description || "",
        descriptionLine: cachedMetadata.descriptionLine || fallbackMetadata.descriptionLine,
        displayName: aliases[item.id] || item.name,
        enabled: !!item.enabled,
        favorite: favoritesSet.has(item.id),
        groupBadges: extensionGroups,
        groupIds: groupLookup[item.id] || [],
        homepageUrl: item.homepageUrl || "",
        icon: smallestIcon(item.icons),
        id: item.id,
        installType: item.installType,
        isApp: isAppType(item.type),
        installedAt: installFirstSeenAt[item.id] || 0,
        lastUsed: recentScore !== undefined ? recentScore : 0,
        mayDisable: !!item.mayDisable,
        metadataFetchedAt: cachedMetadata.fetchedAt || fallbackMetadata.fetchedAt,
        metadataSource: cachedMetadata.source || fallbackMetadata.source,
        name: item.name,
        optionsUrl: item.optionsUrl || "",
        storeUrl: normalizedStoreUrl,
        toolbarPinned: toolbarPinsSet.has(item.id),
        type: item.type,
        usageCount: counters[item.id] || 0,
        version: item.version || ""
      };
    });
  }

  /**
   * Creates the local state exposed to other extension components.
   * @param {Object} localState - The local state to sanitize.
   * @return {Object} A cloned state object without Web Store metadata.
   */
  function buildPublicLocalState(localState) {
    var nextState = storage.clone(localState || {});
    delete nextState.webStoreMetadata;
    return nextState;
  }

  /**
   * Build the public application state from current extension context.
   * @returns {Object} The current extensions, local state, manifest metadata, options, and profiles.
   */
  async function buildState() {
    var context = await loadContext();
    context.options = Object.assign({}, context.options, {
      drivePendingConflict: context.localState.drivePendingConflict || null
    });
    return {
      extensions: normalizeExtensions(context.items, context),
      localState: buildPublicLocalState(context.localState),
      metadata: {
        version: chrome.runtime.getManifest().version
      },
      options: context.options,
      profiles: context.profiles
    };
  }

  async function applyExtensionChanges(desiredChanges, context, config) {
    var options = config || {};
    var current = await loadContext();
    var itemMap = current.items.reduce(function(result, item) {
      result[item.id] = item;
      return result;
    }, {});
    var changes = [];

    (Array.isArray(desiredChanges) ? desiredChanges : []).forEach(function(entry) {
      var extensionId = entry.id || entry.extensionId;
      var item = itemMap[extensionId];
      if (!item || item.type !== "extension" || !item.mayDisable) {
        return;
      }

      if (!!item.enabled === !!entry.enabled) {
        return;
      }

      changes.push({
        enabled: !!entry.enabled,
        id: extensionId,
        name: item.name,
        previousEnabled: !!item.enabled,
        profileId: entry.profileId || null,
        ruleId: entry.ruleId || null,
        ruleName: entry.ruleName || null,
        tabId: entry.tabId != null ? entry.tabId : null,
        url: entry.url || ""
      });
    });

    var extraHistoryRecords = (options.historyRecords || []).filter(Boolean);

    if (!changes.length) {
      var noChangePatch = {};
      if (extraHistoryRecords.length) {
        noChangePatch.eventHistory = history.appendHistory(current.localState.eventHistory, extraHistoryRecords);
      }
      if (options.localPatch) {
        Object.keys(options.localPatch).forEach(function(key) {
          noChangePatch[key] = options.localPatch[key];
        });
      }
      if (Object.keys(noChangePatch).length) {
        await storage.saveLocalState(noChangePatch);
      }
      if (options.syncPatch) {
        await storage.saveSyncOptions(options.syncPatch);
      }
      return buildState();
    }

    var localPatch = {
      eventHistory: history.appendHistory(
        current.localState.eventHistory,
        extraHistoryRecords.concat(history.createRecords(changes, Object.assign({}, context || {}, {
          action: options.action || (context && context.source) || "manual",
          debugVerbose: !!current.options.debugHistoryVerbose
        })))
      )
    };
    var usage = applyUsageMetrics(current.localState, changes, context);
    localPatch.recentlyUsed = usage.recentlyUsed;
    localPatch.usageCounters = usage.usageCounters;

    if (options.pushUndo !== false) {
      localPatch.undoStack = pushUndoEntry(
        current.localState.undoStack,
        options.action || context.source,
        buildSnapshot(current.items)
      );
    }

    await Promise.all(changes.map(function(change) {
      return setExtensionEnabled(change.id, change.enabled);
    }));

    localPatch.reminderQueue = await reminders.syncReminderQueue(
      current.localState.reminderQueue,
      changes,
      current.options,
      context
    );

    if (options.localPatch) {
      Object.keys(options.localPatch).forEach(function(key) {
        localPatch[key] = options.localPatch[key];
      });
    }

    await storage.saveLocalState(localPatch);
    if (options.syncPatch) {
      await storage.saveSyncOptions(options.syncPatch);
    }
    return buildState();
  }

  async function runToggleAll() {
    var current = await loadContext();
    var restoreIds = Array.isArray(current.localState.bulkToggleRestore) ? current.localState.bulkToggleRestore.slice() : [];

    if (restoreIds.length > 0) {
      return applyExtensionChanges(
        restoreIds.map(function(extensionId) {
          return { enabled: true, id: extensionId };
        }),
        { source: "bulk" },
        {
          action: "toggle_all_restore",
          localPatch: { bulkToggleRestore: [] },
          syncPatch: { activeProfile: null }
        }
      );
    }

    var alwaysOn = current.profiles.map.__always_on || [];
    var enabledIds = current.items.filter(function(item) {
      return item.type === "extension" && item.mayDisable && item.enabled;
    }).map(function(item) {
      return item.id;
    });

    var disableIds = enabledIds.filter(function(extensionId) {
      if (!current.options.keepAlwaysOn) {
        return true;
      }
      return alwaysOn.indexOf(extensionId) === -1;
    });

    return applyExtensionChanges(
      disableIds.map(function(extensionId) {
        return { enabled: false, id: extensionId };
      }),
      { source: "bulk" },
      {
        action: "toggle_all_disable",
        localPatch: { bulkToggleRestore: enabledIds },
        syncPatch: { activeProfile: null }
      }
    );
  }

  /**
   * Applies a named profile and its always-on extensions.
   * @param {string} profileName - The name of the profile to apply.
   * @return {Object} The rebuilt extension state after applying the profile.
   */
  async function runApplyProfile(profileName) {
    var current = await loadContext();
    var targetProfile = current.profiles.map[profileName];

    if (!targetProfile) {
      throw new Error("Unknown profile: " + profileName);
    }

    var alwaysOn = current.profiles.map.__always_on || [];
    var desiredIds = storage.uniqueArray(targetProfile.concat(alwaysOn));
    var changes = current.items.filter(function(item) {
      return item.type === "extension" && item.mayDisable;
    }).map(function(item) {
      return {
        enabled: desiredIds.indexOf(item.id) !== -1,
        id: item.id,
        profileId: profileName
      };
    });

    return applyExtensionChanges(
      changes,
      { profileId: profileName, source: "profile" },
      {
        action: "apply_profile",
        syncPatch: { activeProfile: profileName }
      }
    );
  }

  /**
   * Restores extension states from the most recent undo entry.
   * @return {Object} The updated extension state.
   */
  async function runUndo() {
    var localState = await storage.loadLocalState();
    var undoStack = Array.isArray(localState.undoStack) ? localState.undoStack.slice() : [];
    var lastEntry = undoStack.pop();

    if (!lastEntry) {
      return buildState();
    }

    var changes = Object.keys(lastEntry.snapshot || {}).map(function(extensionId) {
      return {
        enabled: !!lastEntry.snapshot[extensionId],
        id: extensionId
      };
    });

    return applyExtensionChanges(
      changes,
      { source: "undo" },
      {
        action: "undo_last",
        localPatch: {
          bulkToggleRestore: [],
          undoStack: undoStack
        },
        pushUndo: false,
        syncPatch: { activeProfile: null }
      }
    );
  }

  /**
   * Updates Drive synchronization timestamps for the specified categories and schedules change-based synchronization.
   * @param {string[]} categoryIds - Category identifiers whose timestamps should be updated.
   */
  async function touchDriveCategories(categoryIds) {
    if (!driveSync || typeof driveSync.bumpCategoryTimestamp !== "function") {
      return;
    }
    var ids = Array.isArray(categoryIds) ? categoryIds : [];
    if (!ids.length) {
      return;
    }
    var localState = await storage.loadLocalState();
    var meta = driveSync.normalizeDriveMeta(localState.driveSyncMeta);
    ids.forEach(function(categoryId) {
      meta = driveSync.bumpCategoryTimestamp(meta, categoryId);
    });
    await storage.saveLocalState({ driveSyncMeta: meta });
    if (!driveApplyingPatches) {
      await scheduleDriveChangeSync();
    }
  }

  /**
   * Builds the runtime context required for Drive synchronization.
   * @returns {Object} The application context with Drive metadata, extension environment details, extension identity, installation type, and sync writer ID.
   */
  async function loadDriveContext() {
    var context = await loadContext();
    var syncMeta = await storage.loadSyncMeta();
    var extensionEnvironment = driveSync && typeof driveSync.getExtensionEnvironment === "function"
      ? await driveSync.getExtensionEnvironment()
      : {
          extensionId: chrome.runtime && chrome.runtime.id ? chrome.runtime.id : "",
          installType: "unknown"
        };
    context.driveSyncMeta = context.localState.driveSyncMeta;
    context.extensionEnvironment = extensionEnvironment;
    context.extensionId = extensionEnvironment.extensionId || "";
    context.installType = extensionEnvironment.installType || "unknown";
    context.options = Object.assign({}, context.options, {
      syncWriterId: syncMeta.syncWriterId || ""
    });
    return context;
  }

  /**
   * Persists Drive synchronization metadata to local state.
   * @param {Object} meta - The Drive synchronization metadata to save.
   */
  async function saveDriveMeta(meta) {
    await storage.saveLocalState({ driveSyncMeta: meta });
  }

  /**
   * Stores the current Drive sync conflict state.
   * @param {Object|null} conflict - Conflict details, or `null` to clear the pending conflict.
   */
  async function saveDrivePendingConflict(conflict) {
    await storage.saveLocalState({ drivePendingConflict: conflict || null });
  }

  /**
   * Saves a local backup associated with a Drive synchronization operation.
   * @param {Object} snapshot - Optional sync metadata, including timestamp, direction, and remote data.
   * @return {Promise<string>} The saved backup identifier.
   * @throws {Error} With code `backup_quota` when the backups exceed the safe local storage budget.
   */
  async function saveDriveBackup(snapshot) {
    var state = await buildState();
    var localState = await storage.loadLocalState();
    var backups = Array.isArray(localState.driveSyncBackups) ? localState.driveSyncBackups.slice() : [];
    var record = {
      at: snapshot && snapshot.at || Date.now(),
      direction: snapshot && snapshot.direction || "sync",
      id: storage.makeId("drive-backup"),
      localBackup: importExport.buildBackupEnvelope(state),
      remoteEnvelope: snapshot && snapshot.remoteEnvelope || null
    };
    backups.push(record);
    backups = backups.slice(-3);
    if (storage.estimatePayloadBytes(backups) > 8 * 1024 * 1024) {
      var quotaError = new Error("Drive sync backup would exceed the safe local storage budget.");
      quotaError.code = "backup_quota";
      throw quotaError;
    }
    await storage.saveLocalState({ driveSyncBackups: backups });
    return record.id;
  }

  /**
   * Persists the current Drive synchronization transaction for recovery.
   * @param {Object} transaction - Transaction data to save.
   */
  async function saveDriveTransaction(transaction) {
    await storage.saveLocalState({ driveSyncTxn: transaction });
  }

  /**
   * Clears the persisted Drive synchronization transaction.
   * @returns {Promise<void>} Resolves when the transaction state has been cleared.
   */
  async function clearDriveTransaction() {
    await storage.saveLocalState({ driveSyncTxn: null });
  }

  /**
   * Recovers a pending Drive sync transaction from its local backup.
   * @return {boolean} `true` if the transaction was recovered, `false` if no transaction exists or its backup is unavailable.
   */
  async function recoverDriveTransaction() {
    var localState = await storage.loadLocalState();
    var transaction = localState.driveSyncTxn;
    if (!transaction) {
      return false;
    }
    var backups = Array.isArray(localState.driveSyncBackups) ? localState.driveSyncBackups : [];
    var backup = backups.find(function(item) {
      return item.id === transaction.backupRef;
    });
    if (!backup || !backup.localBackup) {
      await storage.saveLocalState({
        drivePendingConflict: {
          at: Date.now(),
          reason: "transaction_recovery_missing_backup",
          transaction: transaction,
          trigger: "recovery"
        }
      });
      return false;
    }
    await importBackup({ envelope: backup.localBackup });
    await storage.saveLocalState({
      drivePendingConflict: {
        at: Date.now(),
        backupId: backup.id,
        reason: "transaction_recovered",
        trigger: "recovery"
      },
      driveSyncTxn: null
    });
    return true;
  }

  /**
   * Records a Drive synchronization event in local history.
   * @param {Object} payload - Synchronization details, including status, direction, and trigger information.
   */
  async function appendDriveAudit(payload) {
    var localState = await storage.loadLocalState();
    var record = history.createEventRecord({
      action: "drive_sync",
      debug: payload,
      event: payload && payload.status === "conflict" || payload && payload.status === "failsafe" ? "error" : "info",
      label: payload && payload.status || "sync",
      result: payload && payload.direction || "sync",
      triggeredBy: payload && payload.trigger || "drive"
    });
    await storage.saveLocalState({
      eventHistory: history.appendHistory(localState.eventHistory, [record])
    });
  }

  /**
   * Creates persistence callbacks for Drive synchronization operations.
   * @return {Object} Callbacks for recording audits, backups, metadata, patches, conflicts, options, and transactions.
   */
  function driveSyncCallbacks() {
    return {
      appendAudit: appendDriveAudit,
      clearTransaction: clearDriveTransaction,
      saveBackup: saveDriveBackup,
      saveDriveMeta: saveDriveMeta,
      savePatches: applyDrivePatches,
      savePendingConflict: saveDrivePendingConflict,
      saveSyncOptions: function(patch) {
        return storage.saveSyncOptions(patch);
      },
      saveTransaction: saveDriveTransaction
    };
  }

  /**
   * Applies state patches received from Drive synchronization and returns the updated application state.
   * @param {Object} patches - Drive synchronization patches for sync options, profiles, and local state.
   * @returns {Object} The rebuilt application state after applying the patches.
   */
  async function applyDrivePatches(patches) {
    driveApplyingPatches = true;
    try {
      if (patches.syncOptions) {
        await storage.saveSyncOptions(patches.syncOptions);
        applyCacheOptions(await storage.loadSyncOptions());
      }
      if (patches.profiles) {
        await storage.saveProfiles(patches.profiles.map, patches.profiles.meta);
      }
      if (patches.localState) {
        var currentLocal = await storage.loadLocalState();
        await storage.saveLocalState(Object.assign({}, currentLocal, patches.localState));
      }
      return buildState();
    } finally {
      driveApplyingPatches = false;
    }
  }

  /**
   * Reschedules the periodic Drive synchronization alarm based on the current sync options.
   */
  async function rescheduleDriveSyncAlarm() {
    if (!hasChromeMethod(chrome.alarms, "clear") || !hasChromeMethod(chrome.alarms, "create")) {
      return;
    }
    await chromeCall(chrome.alarms, "clear", [driveSyncAlarmName]);
    var options = await storage.loadSyncOptions();
    if (!options.driveSync || !options.driveTimeBasedSync) {
      return;
    }
    var minutes = Math.max(15, Number(options.driveAutoSyncIntervalMinutes) || 60);
    chrome.alarms.create(driveSyncAlarmName, {
      delayInMinutes: minutes,
      periodInMinutes: minutes
    });
  }

  /**
   * Maps a Drive sync overwrite strategy to its synchronization direction.
   * @param {string} strategy - The configured overwrite strategy.
   * @return {string} `"push"` for remote overwrite, `"pull"` for local overwrite, or `"sync"` otherwise.
   */
  function driveDirectionForStrategy(strategy) {
    if (strategy === "overwrite_remote") {
      return "push";
    }
    if (strategy === "overwrite_local") {
      return "pull";
    }
    return "sync";
  }

  /**
   * Determines whether an automatic Drive synchronization may run for the specified trigger.
   * @param {string} trigger - The synchronization trigger: `"periodic"`, `"change"`, or `"startup"`.
   * @return {Object|null} The current sync options when synchronization is allowed, otherwise `null`.
   */
  async function canRunAutomaticDriveSync(trigger) {
    var options = await storage.loadSyncOptions();
    var localState = await storage.loadLocalState();
    if (!options.driveSync || localState.drivePendingConflict || localState.driveSyncTxn) {
      return null;
    }
    if (
      driveSync
      && typeof driveSync.hasPendingPreviewConfirmation === "function"
      && await driveSync.hasPendingPreviewConfirmation()
    ) {
      return null;
    }
    if (trigger === "periodic" && !options.driveTimeBasedSync) {
      return null;
    }
    if (trigger === "change" && !options.driveChangeBasedSync) {
      return null;
    }
    if (trigger === "startup" && !options.driveSyncOnStartup) {
      return null;
    }
    return options;
  }

  /**
   * Schedules a debounced automatic Drive sync for change-triggered updates when enabled.
   */
  async function scheduleDriveChangeSync() {
    var options = await canRunAutomaticDriveSync("change");
    if (!options) {
      return;
    }
    if (driveChangeSyncTimer) {
      clearTimeout(driveChangeSyncTimer);
    }
    driveChangeSyncTimer = setTimeout(function() {
      driveChangeSyncTimer = null;
      var clearAlarm = hasChromeMethod(chrome.alarms, "clear")
        ? chromeCall(chrome.alarms, "clear", [driveChangeSyncAlarmName])
        : Promise.resolve();
      clearAlarm.then(function() {
        return runAutoDriveSync("change");
      }).catch(function(error) {
        logger.error("drive_change_sync_failed", { message: error && error.message });
      });
    }, 5000);
    if (hasChromeMethod(chrome.alarms, "clear") && hasChromeMethod(chrome.alarms, "create")) {
      await chromeCall(chrome.alarms, "clear", [driveChangeSyncAlarmName]);
      chrome.alarms.create(driveChangeSyncAlarmName, { delayInMinutes: 0.5 });
    }
  }

  /**
   * Schedule a delayed startup-triggered Drive sync when automatic synchronization is available.
   */
  async function scheduleDriveStartupSync() {
    var options = await canRunAutomaticDriveSync("startup");
    if (!options || !hasChromeMethod(chrome.alarms, "create")) {
      return;
    }
    chrome.alarms.create(driveStartupSyncAlarmName, { delayInMinutes: 0.5 });
  }

  /**
   * Runs a background Drive synchronization for the specified automatic-sync trigger.
   * @param {string} [trigger="periodic"] - The event that initiated synchronization.
   * @return {Object|undefined} The synchronization result, or a cancellation object when automatic synchronization is paused.
   */
  async function runAutoDriveSync(trigger) {
    var source = trigger || "periodic";
    var options = await canRunAutomaticDriveSync(source);
    if (!options) {
      return { status: "cancelled", reason: "automatic_sync_paused" };
    }
    try {
      var result = await driveSync.syncDrive(Object.assign({
        direction: driveDirectionForStrategy(options.driveSyncStrategy),
        interactive: false,
        loadContext: loadDriveContext,
        trigger: source
      }, driveSyncCallbacks()));
      await storage.saveSyncOptions({
        driveAuthStatus: "authorized",
        lastDriveSyncError: null
      });
      return result;
    } catch (error) {
      var normalized = driveSync && typeof driveSync.normalizeDriveError === "function"
        ? driveSync.normalizeDriveError(error, "sync_failed")
        : { code: (error && error.code) || "sync_failed" };
      await storage.saveSyncOptions({
        driveAuthStatus: normalized.code === "auth" ? "needs_interactive_sign_in" : "error",
        lastDriveSyncError: buildDriveErrorPayload(error)
      });
      if (!error || error.code !== "auth") {
        logger.error("drive_auto_sync_failed", { message: error && error.message, code: error && error.code });
      }
    }
  }

  function buildDriveErrorPayload(error) {
    var normalized = driveSync && typeof driveSync.normalizeDriveError === "function"
      ? driveSync.normalizeDriveError(error, "sync_failed")
      : {
          code: (error && error.code) || "sync_failed",
          message: (error && error.message) || "Drive sync failed."
        };

    return {
      at: Date.now(),
      code: normalized.code || "sync_failed",
      message: normalized.message || "Drive sync failed."
    };
  }

  async function saveAliases(payload) {
    var localState = await storage.loadLocalState();
    var aliases = storage.clone(localState.aliases || {});

    if (payload.aliases) {
      aliases = storage.clone(payload.aliases);
    } else if (payload.extensionId) {
      aliases[payload.extensionId] = (payload.alias || "").trim();
      if (!aliases[payload.extensionId]) {
        delete aliases[payload.extensionId];
      }
    }

    await storage.saveLocalState({ aliases: aliases });
    await touchDriveCategories(["aliases"]);
    return buildState();
  }

  async function saveGroups(payload) {
    var normalized = normalizeGroups(payload.groups || {});
    if (Array.isArray(payload.groupOrder) && payload.groupOrder.length > 0) {
      normalized.groupOrder = payload.groupOrder.filter(function(groupId) {
        return Object.prototype.hasOwnProperty.call(normalized.groups, groupId);
      });
    }

    await storage.saveLocalState(normalized);
    await touchDriveCategories(["groups"]);
    return buildState();
  }

  async function saveUrlRules(payload) {
    await storage.saveLocalState({
      urlRules: urlRules.normalizeRules(payload.urlRules || [])
    });
    await touchDriveCategories(["urlRules"]);
    return buildState();
  }

  async function saveOptions(payload) {
    var previousOptions = await storage.loadSyncOptions();
    var nextOptions = await storage.saveSyncOptions(payload.options || {});
    applyCacheOptions(nextOptions);
    if (payload.options && payload.options.syncMode && payload.options.syncMode !== previousOptions.syncMode) {
      var profilesState = await storage.loadProfiles();
      await storage.saveProfiles(profilesState.map, profilesState.meta);
      await touchDriveCategories(["profiles"]);
    }
    var localState = await storage.loadLocalState();

    if (!nextOptions.enableReminders) {
      await Promise.all(localState.reminderQueue.map(function(item) {
        return clearAlarm(item.alarmName);
      }));
      await storage.saveLocalState({ reminderQueue: [] });
    }

    if (nextOptions.urlRuleDisableOnClose || Number(nextOptions.urlRuleTimeoutMinutes || 0) <= 0) {
      await clearUrlRuleTimeoutQueue(localState.urlRuleTimeoutQueue);
    }

    await touchDriveCategories(["options"]);
    await rescheduleDriveSyncAlarm();
    return buildState();
  }

  async function recordInstallFirstSeen(itemInfo) {
    if (!itemInfo || !itemInfo.id || itemInfo.id === chrome.runtime.id || itemInfo.type === "theme") {
      return;
    }

    var localState = await storage.loadLocalState();
    var installFirstSeenAt = storage.clone(localState.installFirstSeenAt || {});
    if (installFirstSeenAt[itemInfo.id]) {
      return;
    }

    installFirstSeenAt[itemInfo.id] = Date.now();
    await storage.saveLocalState({ installFirstSeenAt: installFirstSeenAt });
  }

  async function updateExtensionProfileMembership(payload) {
    var extensionId = payload.extensionId;
    var profileName = (payload.profileName || "").trim();
    var shouldInclude = !!payload.shouldInclude;
    if (!extensionId || !profileName) {
      throw new Error("Both extensionId and profileName are required.");
    }

    var profilesState = await storage.loadProfiles();
    if (!Object.prototype.hasOwnProperty.call(profilesState.map, profileName)) {
      throw new Error("Unknown profile: " + profileName);
    }

    var nextProfiles = storage.clone(profilesState.map);
    var existingItems = Array.isArray(nextProfiles[profileName]) ? nextProfiles[profileName].slice() : [];
    nextProfiles[profileName] = shouldInclude
      ? storage.uniqueArray(existingItems.concat([extensionId]))
      : existingItems.filter(function(id) { return id !== extensionId; });

    await storage.saveProfiles(nextProfiles);
    await touchDriveCategories(["profiles"]);
    return buildState();
  }

  async function updateExtensionToolbarPinned(payload) {
    var extensionId = payload.extensionId;
    var shouldPin = !!payload.shouldPin;
    if (!extensionId) {
      throw new Error("extensionId is required.");
    }

    var localState = await storage.loadLocalState();
    var currentPins = Array.isArray(localState.toolbarPins) ? localState.toolbarPins : [];
    var nextPins = shouldPin
      ? storage.uniqueArray(currentPins.concat([extensionId]))
      : currentPins.filter(function(id) { return id !== extensionId; });

    await storage.saveLocalState({ toolbarPins: nextPins });
    return buildState();
  }

  async function pinExtensionToToolbar(payload) {
    var extensionId = typeof payload === "string" ? payload : payload.extensionId;
    var tabState = null;

    if (!extensionId) {
      throw new Error("extensionId is required.");
    }

    var opts = typeof storage.loadSyncOptions === "function" ? await storage.loadSyncOptions() : {};
    var pinMethod = opts && opts.pinMethod === "manual" ? "manual" : "auto";

    if (pinMethod === "manual") {
      return openToolbarPinFallback(extensionId, null, "manual_mode");
    }

    if (!hasDebuggerApi()) {
      return openToolbarPinFallback(extensionId, null, "debugger_unavailable");
    }

    try {
      tabState = await ensureManageExtensionTab(extensionId);
      if (!tabState.tab || tabState.tab.id == null) {
        return openToolbarPinFallback(extensionId, tabState, "details_tab_unavailable");
      }

      await waitForTabComplete(tabState.tab.id, 4000);

      var pinResult = await attemptToolbarPinWithDebugger(tabState.tab.id);
      if (pinResult.result === "pinned" || pinResult.result === "already_pinned") {
        if (tabState.created && hasChromeMethod(chrome.tabs, "remove")) {
          try {
            await removeTab(tabState.tab.id);
          } catch (error) {}
        }

        return {
          result: pinResult.result,
          tabId: tabState.tab.id,
          url: buildManageExtensionUrl(extensionId)
        };
      }

      return openToolbarPinFallback(extensionId, tabState, pinResult.reason);
    } catch (error) {
      return openToolbarPinFallback(
        extensionId,
        tabState,
        error && error.message ? error.message : "pinning_failed"
      );
    }
  }

  async function importBackup(payload) {
    var parsed = importExport.validateImportPayload(payload.envelope);
    var importScope = parsed.scope;

    if (parsed.scope === "profiles") {
      await storage.saveProfiles(parsed.profiles);
      await touchDriveCategories(["profiles"]);
      return { state: await buildState(), importScope: importScope };
    }

    if (parsed.scope === "settings") {
      await storage.saveSyncOptions(parsed.settings);
      await touchDriveCategories(["options"]);
      return { state: await buildState(), importScope: importScope };
    }

    if (parsed.scope === "profiles_settings") {
      await storage.saveProfiles(parsed.profiles);
      await touchDriveCategories(["profiles"]);
      await storage.saveSyncOptions(parsed.settings);
      await touchDriveCategories(["options"]);
      return { state: await buildState(), importScope: importScope };
    }

    var envelope = parsed;
    var currentLocalState = await storage.loadLocalState();

    await Promise.all(currentLocalState.reminderQueue.map(function(item) {
      return clearAlarm(item.alarmName);
    }));

    await storage.saveSyncOptions(envelope.settings);
    await touchDriveCategories(["options"]);
    await storage.saveProfiles(envelope.profiles);
    await touchDriveCategories(["profiles"]);
    await storage.saveLocalState({
      aliases: envelope.aliases,
      bulkToggleRestore: [],
      eventHistory: Array.isArray(envelope.localState.eventHistory) ? envelope.localState.eventHistory : [],
      groupOrder: envelope.groupOrder,
      groups: envelope.groups,
      recentlyUsed: Array.isArray(envelope.localState.recentlyUsed) ? envelope.localState.recentlyUsed : [],
      reminderQueue: [],
      undoStack: Array.isArray(envelope.localState.undoStack) ? envelope.localState.undoStack : [],
      urlRules: Array.isArray(envelope.urlRules) ? envelope.urlRules : [],
      usageCounters: envelope.localState.usageCounters || {}
    });

    var extensionStateMap = envelope.localState.extensionStates || {};
    var changes = Object.keys(extensionStateMap).map(function(extensionId) {
      return {
        enabled: !!extensionStateMap[extensionId],
        id: extensionId
      };
    });

    var state = await applyExtensionChanges(
      changes,
      { source: "import" },
      {
        action: "import_backup",
        localPatch: { bulkToggleRestore: [] },
        pushUndo: false,
        syncPatch: { activeProfile: envelope.localState.activeProfile || envelope.settings.activeProfile || null }
      }
    );
    return { state: state, importScope: importScope };
  }

  async function exportBackup(payload) {
    var state = await buildState();
    var scope = payload && payload.exportScope ? payload.exportScope : "full";
    return {
      envelope: importExport.buildScopedExport(state, scope)
    };
  }

  async function getExtensionMetadataPayload(payload) {
    return {
      metadata: await loadExtensionMetadata(payload.extensionIds || [], {
        forceRefresh: !!payload.forceRefresh
      })
    };
  }

  /**
   * Assigns an extension to a profile, removing it from other profiles first.
   * @param {string} extensionId - The extension identifier to assign.
   * @param {string} profileName - The target profile name, or an empty value to remove the extension from all profiles.
   * @returns {Promise<Object>} The updated extension state.
   * @throws {Error} If the extension identifier is missing or the profile does not exist.
   */
  async function assignExtensionProfile(extensionId, profileName) {
    if (!extensionId) {
      throw new Error("Missing extension id.");
    }

    var profilesState = await storage.loadProfiles();
    var map = storage.clone(profilesState.map || {});
    Object.keys(map).forEach(function(name) {
      if (name.indexOf("__") === 0) {
        return;
      }
      map[name] = (map[name] || []).filter(function(id) {
        return id !== extensionId;
      });
    });

    if (profileName) {
      if (!map[profileName] || profileName.indexOf("__") === 0) {
        throw new Error("Unknown profile: " + profileName);
      }
      map[profileName] = storage.uniqueArray((map[profileName] || []).concat([extensionId]));
    }

    await storage.saveProfiles(map);
    await touchDriveCategories(["profiles"]);
    return buildState();
  }

  /**
   * Uninstall an extension and return the updated application state.
   * @param {string} extensionId - The ID of the extension to uninstall.
   * @return {Promise<Object>} The updated application state.
   */
  async function runUninstallExtension(extensionId) {
    await uninstallExtension(extensionId);
    return buildState();
  }

  /**
   * Runs a Drive synchronization and returns the synchronization result with updated application state.
   * @param {Object} [message] - Synchronization options, including direction, conflict resolution, selected file, and confirmation settings.
   * @returns {Promise<Object>} An object containing the synchronization result and updated application state.
   * @throws {Error} Re-throws synchronization errors after recording the failure status.
   */
  async function syncDriveNow(message) {
    var payload = message || {};
    var direction = payload.direction || "sync";
    logger.info("drive_sync_started", { direction: direction });
    try {
      var result = await driveSync.syncDrive(Object.assign({
        direction: direction,
        interactive: payload.interactive !== false,
        loadContext: loadDriveContext,
        confirmationToken: payload.confirmationToken || null,
        overrideFailsafe: !!payload.overrideFailsafe,
        requireConfirmation: !!payload.requireConfirmation,
        resolution: payload.resolution || null,
        selectedFileId: payload.selectedFileId || null,
        trigger: payload.trigger || "manual"
      }, driveSyncCallbacks()));
      if (result.status !== "conflict") {
        await rescheduleDriveSyncAlarm();
      }
      await storage.saveSyncOptions({
        driveAuthStatus: "authorized",
        lastDriveSyncError: null
      });
      if (result.status === "conflict") {
        logger.warn("drive_sync_conflict", { direction: direction });
      } else {
        logger.info("drive_sync_complete", { direction: direction, status: result.status });
      }
      return {
        result: result,
        state: await buildState()
      };
    } catch (error) {
      var normalized = driveSync && typeof driveSync.normalizeDriveError === "function"
        ? driveSync.normalizeDriveError(error, "sync_failed")
        : { code: (error && error.code) || "sync_failed" };
      await storage.saveSyncOptions({
        driveAuthStatus: normalized.code === "auth" ? "needs_interactive_sign_in" : "error",
        lastDriveSyncError: buildDriveErrorPayload(error)
      });
      logger.error("drive_sync_failed", { direction: direction, code: normalized.code, message: error && error.message });
      throw error;
    }
  }

  /**
   * Preview the changes that a Drive synchronization would apply.
   * @param {Object} [message] - Sync options, including direction, conflict resolution, or a selected Drive file.
   * @returns {Object} The Drive synchronization preview result.
   */
  async function previewDriveSync(message) {
    var payload = message || {};
    return await driveSync.syncDrive(Object.assign({
      direction: payload.direction || "sync",
      interactive: true,
      loadContext: loadDriveContext,
      preview: true,
      resolution: payload.resolution || null,
      selectedFileId: payload.selectedFileId || null,
      trigger: "preview"
    }, driveSyncCallbacks()));
  }

  /**
   * Restores a saved Drive synchronization backup and clears pending recovery data.
   * @param {Object} [message] - Optional request containing the backup identifier to restore.
   * @returns {Object} The restored backup ID, restoration timestamp, and resulting application state.
   * @throws {Error} If the requested or latest backup is unavailable.
   */
  async function restoreDriveSyncBackup(message) {
    var localState = await storage.loadLocalState();
    var backups = Array.isArray(localState.driveSyncBackups) ? localState.driveSyncBackups : [];
    var requestedId = message && message.backupId;
    var backup = requestedId
      ? backups.find(function(item) { return item.id === requestedId; })
      : backups[backups.length - 1];
    if (!backup || !backup.localBackup) {
      throw new Error("No Drive sync backup is available to restore.");
    }
    var restored = await importBackup({ envelope: backup.localBackup });
    await storage.saveLocalState({ drivePendingConflict: null, driveSyncTxn: null });
    return {
      backupId: backup.id,
      restoredAt: Date.now(),
      state: restored.state
    };
  }

  /**
   * Selects the Drive file used for synchronization and clears its cached version metadata and pending conflict.
   * @param {Object} message - Message containing the selected Drive file ID.
   * @returns {Promise<Object>} The selected `fileId` and updated application state.
   * @throws {Error} If a Drive file ID is not provided.
   */
  async function selectDriveSyncFile(message) {
    if (!message || !message.fileId) {
      throw new Error("A Drive file ID is required.");
    }
    var localState = await storage.loadLocalState();
    var meta = driveSync.normalizeDriveMeta(localState.driveSyncMeta);
    meta.fileId = String(message.fileId);
    meta.fileModifiedTime = null;
    meta.fileSize = null;
    meta.fileVersion = null;
    await storage.saveLocalState({ drivePendingConflict: null, driveSyncMeta: meta });
    return { fileId: meta.fileId, state: await buildState() };
  }

  /**
   * Deletes a duplicate Drive sync file and, if it was part of the current pending
   * conflict, removes it from the conflict's file list (or clears the conflict once
   * only one candidate remains).
   * @param {Object} message - Must include `fileId`, the Drive file ID to delete.
   * @return {Object} `{ deletedFileId, state }`.
   */
  async function deleteDriveSyncFile(message) {
    if (!message || !message.fileId) {
      throw new Error("A Drive file ID is required.");
    }
    await driveSync.deleteDriveFile(message.fileId, { interactive: true });
    var localState = await storage.loadLocalState();
    var conflict = localState.drivePendingConflict;
    if (conflict && conflict.reason === "duplicate_remote_files" && Array.isArray(conflict.duplicateFiles)) {
      var remaining = conflict.duplicateFiles.filter(function(file) {
        return file && file.id !== message.fileId;
      });
      if (remaining.length <= 1) {
        await storage.saveLocalState({ drivePendingConflict: null });
      } else {
        await storage.saveLocalState({
          drivePendingConflict: Object.assign({}, conflict, { duplicateFiles: remaining })
        });
      }
    }
    var meta = driveSync.normalizeDriveMeta(localState.driveSyncMeta);
    if (meta.fileId === message.fileId) {
      meta.fileId = null;
      meta.fileModifiedTime = null;
      meta.fileSize = null;
      meta.fileVersion = null;
      await storage.saveLocalState({ driveSyncMeta: meta });
    }
    return { deletedFileId: message.fileId, state: await buildState() };
  }

  /**
   * Retrieves the current Drive sync status.
   * @returns {Promise<Object>} An object containing the current Drive sync status.
   */
  async function getDriveSyncStatusNow() {
    return {
      status: await driveSync.getDriveSyncStatus({
        loadContext: loadDriveContext
      })
    };
  }
  async function openDashboard(message) {
    var deepLink = message && message.deepLink;
    var targetPath = await buildDashboardTargetPath(deepLink);
    await focusOrCreateDashboardTab(targetPath);
    return { opened: true };
  }

  async function buildDashboardTargetPath(deepLink) {
    if (!deepLink || deepLink.tab !== "rules" || deepLink.source !== "add_active_site") {
      return "dashboard.html";
    }

    var url = deepLink.tabUrl || "";
    if (!url && hasChromeMethod(chrome.tabs, "query")) {
      var tabs = await queryTabs({ active: true, lastFocusedWindow: true });
      var activeTab = Array.isArray(tabs) && tabs.length ? tabs[0] : null;
      if (!activeTab) {
        var fallbackTabs = await queryTabs({ active: true, currentWindow: true });
        activeTab = Array.isArray(fallbackTabs) && fallbackTabs.length ? fallbackTabs[0] : null;
      }
      url = activeTab && activeTab.url ? activeTab.url : "";
    }

    var info = urlRules.buildHostnamePattern(url);
    if (!info.supported) {
      return "dashboard.html#rules?error=" + encodeURIComponent(info.reason || "unsupported_url");
    }

    var draftId = storage.makeId("rule");
    var params = new URLSearchParams();
    params.set("draftId", draftId);
    params.set("host", info.canonicalHost);
    params.set("pattern", info.pattern);
    params.set("suggestWww", info.suggestWww ? "1" : "0");
    params.set("source", "add_active_site");
    if (deepLink.extensionId) {
      params.set("extensionId", String(deepLink.extensionId));
    }
    return "dashboard.html#rules?" + params.toString();
  }

  async function focusOrCreateDashboardTab(targetPath) {
    var fullUrl = chrome.runtime.getURL(String(targetPath).replace(/^\//, ""));
    var baseDashboardUrl = chrome.runtime.getURL("dashboard.html");
    var existing = null;
    if (hasChromeMethod(chrome.tabs, "query")) {
      try {
        var allTabs = await queryTabs({});
        existing = (Array.isArray(allTabs) ? allTabs : []).find(function(tab) {
          return tab && tab.url && (
            tab.url === baseDashboardUrl ||
            tab.url.startsWith(baseDashboardUrl + "?") ||
            tab.url.startsWith(baseDashboardUrl + "#")
          );
        }) || null;
      } catch (error) {
        existing = null;
      }
    }
    if (existing && existing.id != null && hasChromeMethod(chrome.tabs, "update")) {
      var hashIndex = fullUrl.indexOf("#");
      var reloadUrl = hashIndex >= 0
        ? fullUrl.slice(0, hashIndex) + "?_r=" + Date.now() + fullUrl.slice(hashIndex)
        : fullUrl;
      await chromeCall(chrome.tabs, "update", [existing.id, { active: true, url: reloadUrl }]);
      return existing;
    }
    return chromeCall(chrome.tabs, "create", [{ active: true, url: fullUrl }]);
  }

  async function testUrlRules(url) {
    var current = await loadContext();
    var analysis = urlRules.analyzeUrl(url, current.localState.urlRules);
    var itemMap = current.items.reduce(function(result, item) {
      result[item.id] = item;
      return result;
    }, {});
    var finalChanges = Object.keys(analysis.finalChanges).map(function(extensionId) {
      var change = analysis.finalChanges[extensionId];
      var item = itemMap[extensionId];
      return {
        enabled: !!change.enabled,
        extensionId: extensionId,
        extensionName: item ? item.name : extensionId,
        previousEnabled: item ? !!item.enabled : null,
        ruleId: change.ruleId || null,
        ruleName: change.ruleName || null,
        urlPattern: change.urlPattern || ""
      };
    });
    var result = finalChanges.length ? "changed" : analysis.result;
    if (finalChanges.length) {
      var hasActualChange = finalChanges.some(function(change) {
        return change.previousEnabled !== null && change.previousEnabled !== change.enabled;
      });
      if (!hasActualChange) {
        result = "no_op";
      }
    }
    return {
      finalChanges: finalChanges,
      matchedRules: analysis.matchedRules,
      perExtension: analysis.perExtension,
      result: result,
      url: url
    };
  }

  async function cycleProfiles(step) {
    var state = await buildState();
    var names = state.profiles.items.filter(function(profile) {
      return profile.name.indexOf("__") !== 0;
    }).map(function(profile) {
      return profile.name;
    });

    if (!names.length) {
      return buildState();
    }

    var currentIndex = names.indexOf(state.options.activeProfile);
    var nextIndex = currentIndex === -1
      ? (step > 0 ? 0 : names.length - 1)
      : (currentIndex + step + names.length) % names.length;

    return runApplyProfile(names[nextIndex]);
  }

  function clearRuleApplication(tabId) {
    delete tabRuleApplications[tabId];
  }

  /**
   * Evaluates URL rules for a tab and applies the resulting extension state changes.
   * @param {string} url - The tab URL to evaluate.
   * @param {?number} tabId - The tab identifier used to track rule applications for close-time handling.
   * @return {Object} The updated extension state.
   */
  async function evaluateRulesForUrl(url, tabId) {
    var current = await loadContext();
    var analysis = urlRules.analyzeUrl(url, current.localState.urlRules);
    var desired = analysis.finalChanges;
    var desiredEntries = Object.keys(desired).map(function(extensionId) {
      return {
        enabled: desired[extensionId].enabled,
        id: extensionId,
        ruleId: desired[extensionId].ruleId,
        ruleName: desired[extensionId].ruleName,
        tabId: tabId,
        url: url
      };
    });
    var itemMap = current.items.reduce(function(result, item) {
      result[item.id] = item;
      return result;
    }, {});
    var actualChanges = desiredEntries.filter(function(entry) {
      var item = itemMap[entry.id];
      return item && item.type === "extension" && item.mayDisable && (!!item.enabled !== !!entry.enabled);
    });
    var debugRecord = createDebugHistoryRecord(current, {
      action: "url_rule_evaluation",
      debug: {
        matchedEntries: desiredEntries,
        matchedRuleCount: storage.uniqueArray(desiredEntries.map(function(entry) { return entry.ruleId; })).length
      },
      event: "evaluation",
      label: "URL rule evaluation",
      result: !desiredEntries.length ? "no_match" : (!actualChanges.length ? "no_op" : "changed"),
      tabId: tabId,
      triggeredBy: "rule",
      url: url
    });

    if (tabId != null) {
      if (desiredEntries.length) {
        tabRuleApplications[tabId] = buildRuleApplication(desiredEntries, url, tabId);
      } else {
        clearRuleApplication(tabId);
      }
    }

    if (debugRecord) {
      await appendDebugHistoryRecords([debugRecord]);
    }

    if (!desiredEntries.length) {
      return buildState();
    }

    return applyExtensionChanges(
      desiredEntries,
      { source: "rule", tabId: tabId, url: url },
      {
        action: "url_rule",
        pushUndo: false,
        syncPatch: { activeProfile: null }
      }
    );
  }

  /**
   * Schedules debounced URL rule evaluation for a supported tab URL.
   * @param {number} tabId - The tab whose URL rules should be evaluated.
   * @param {string} url - The URL to evaluate.
   */
  function scheduleRuleEvaluation(tabId, url) {
    if (urlEvaluationTimers[tabId]) {
      clearTimeout(urlEvaluationTimers[tabId]);
      delete urlEvaluationTimers[tabId];
    }
    if (!urlRules.isSupportedUrl(url)) {
      clearRuleApplication(tabId);
      return;
    }

    urlEvaluationTimers[tabId] = setTimeout(function() {
      delete urlEvaluationTimers[tabId];
      evaluateRulesForUrl(url, tabId).catch(function(error) {
        logger.error("url_rule_failed", { message: error && error.message });
      });
    }, 300);
  }

  /**
   * Routes a background message to its supported state, backup, dashboard, extension, or Drive operation.
   * @param {Object} message - Message containing a supported `type` and operation-specific fields.
   * @return {Promise<Object>} The operation-specific response.
   * @throws {Error} If the message type is unsupported or the operation fails.
   */
  async function handleMessage(message) {
    switch (message.type) {
      case "APPLY_PROFILE":
        return { state: await runApplyProfile(message.profileName) };
      case "ASSIGN_EXTENSION_PROFILE":
        return { state: await assignExtensionProfile(message.extensionId, message.profileName) };
      case "EXPORT_BACKUP":
        return await exportBackup(message);
      case "GET_EXTENSION_METADATA":
        return await getExtensionMetadataPayload(message);
      case "GET_STATE":
        return { state: await buildState() };
      case "IMPORT_BACKUP":
        return await importBackup(message);
      case "OPEN_DASHBOARD":
        return await openDashboard(message);
      case "PIN_EXTENSION_TO_TOOLBAR":
        return await pinExtensionToToolbar(message);
      case "SAVE_ALIAS":
        return { state: await saveAliases(message) };
      case "SAVE_GROUPS":
        return { state: await saveGroups(message) };
      case "SAVE_OPTIONS":
        return { state: await saveOptions(message) };
      case "SAVE_URL_RULES":
        return { state: await saveUrlRules(message) };
      case "TEST_URL_RULES":
        return await testUrlRules(message.url);
      case "SET_EXTENSION_STATE":
        return {
          state: await applyExtensionChanges(
            [{ enabled: !!message.enabled, id: message.extensionId }],
            message.context || { source: "manual" },
            {
              action: "set_extension_state",
              syncPatch: { activeProfile: null }
            }
          )
        };
      case "DELETE_DRIVE_FILE":
        return await deleteDriveSyncFile(message);
      case "GET_DRIVE_SYNC_STATUS":
        return await getDriveSyncStatusNow();
      case "PREVIEW_DRIVE_SYNC":
        return { preview: await previewDriveSync(message) };
      case "RESTORE_DRIVE_SYNC_BACKUP":
        return await restoreDriveSyncBackup(message);
      case "SELECT_DRIVE_SYNC_FILE":
        return await selectDriveSyncFile(message);
      case "SET_DRIVE_WEB_CLIENT_ID":
        await new Promise(function(resolve) {
          chrome.storage.local.set({ driveWebClientIdOverride: message.clientId || "" }, resolve);
        });
        driveSync.setWebClientId(message.clientId || "");
        return { ok: true };
      case "TEST_DRIVE_CONNECTION":
        return { report: await driveSync.testDriveConnection({ loadContext: loadDriveContext }) };
      case "RESOLVE_DRIVE_CONFLICT":
        return await syncDriveNow({
          confirmationToken: message.confirmationToken,
          direction: "sync",
          interactive: false,
          overrideFailsafe: !!message.overrideFailsafe,
          requireConfirmation: message.resolution !== "cancel",
          resolution: message.resolution
        });
      case "SYNC_DRIVE":
        return await syncDriveNow(message);
      case "TOGGLE_ALL":
        return { state: await runToggleAll() };
      case "UNDO_LAST":
        return { state: await runUndo() };
      case "UNINSTALL_EXTENSION":
        return { state: await runUninstallExtension(message.extensionId) };
      case "UPDATE_EXTENSION_TOOLBAR_PINNED":
        return { state: await updateExtensionToolbarPinned(message) };
      case "UPDATE_EXTENSION_PROFILE_MEMBERSHIP":
        return { state: await updateExtensionProfileMembership(message) };
      default:
        throw new Error("Unsupported message type: " + message.type);
    }
  }

  /**
   * Runs available data migrations during extension initialization.
   *
   * Legacy local-storage migration failures are logged and skipped; subsequent
   * migrations continue to run.
   */
  async function runMigrations() {
    try {
      await migrations.migrateLegacyLocalStorage();
    } catch (error) {
      logger.warn("legacy_migration_skipped", { message: error && error.message });
    }
    await migrations.migrateTo2_0_0();
    if (migrations.migratePopupListStyle) {
      await migrations.migratePopupListStyle();
    }
    if (migrations.migrateSyncModesAndDismissals) {
      await migrations.migrateSyncModesAndDismissals();
    }
    if (migrations.migrateDriveSyncRemediation) {
      await migrations.migrateDriveSyncRemediation();
    }
  }

  addChromeListener(chrome.runtime && chrome.runtime.onInstalled, function() {
    runMigrations().then(function() {
      return scheduleDriveStartupSync();
    }).catch(function(error) {
      logger.error("migration_failed", { message: error && error.message });
    });
  });

  addChromeListener(chrome.runtime && chrome.runtime.onStartup, function() {
    runMigrations().then(function() {
      return scheduleDriveStartupSync();
    }).catch(function(error) {
      logger.error("startup_migration_failed", { message: error && error.message });
    });
  });

  addChromeListener(chrome.management && chrome.management.onInstalled, function(itemInfo) {
    invalidateManagementCache();
    recordInstallFirstSeen(itemInfo).catch(function(error) {
      logger.error("install_first_seen_failed", { message: error && error.message });
    });
  });

  addChromeListener(chrome.management && chrome.management.onUninstalled, invalidateManagementCache);
  addChromeListener(chrome.management && chrome.management.onEnabled, invalidateManagementCache);
  addChromeListener(chrome.management && chrome.management.onDisabled, invalidateManagementCache);

  var syncEchoUntil = 0;
  var syncEchoKeys = {};
  var syncIngestTimer = null;
  var lastKnownSyncOptionsUpdatedAt = 0;
  var lastKnownSyncProfilesUpdatedAt = 0;

  if (typeof storage.registerSyncWriteHook === "function") {
    storage.registerSyncWriteHook(function(keys) {
      syncEchoUntil = Date.now() + 2500;
      syncEchoKeys = (keys || []).reduce(function(result, key) {
        result[key] = true;
        return result;
      }, {});
    });
  }

  function isLocalSyncEcho(changes) {
    if (Date.now() > syncEchoUntil) {
      return false;
    }
    var changedKeys = Object.keys(changes || {});
    if (!changedKeys.length) {
      return false;
    }
    return changedKeys.every(function(key) {
      return !!syncEchoKeys[key];
    });
  }

  function hasRelevantSyncChanges(changes) {
    return Object.keys(changes || {}).some(function(key) {
      return storage.isRelevantSyncChangeKey(key);
    });
  }

  function broadcastSyncRemoteUpdate() {
    if (!chrome.runtime || typeof chrome.runtime.sendMessage !== "function") {
      return;
    }
    chrome.runtime.sendMessage({ type: "SYNC_REMOTE_UPDATE" }).catch(function() {});
  }

  async function ingestRemoteSyncChanges(changes) {
    var meta = await storage.loadSyncMeta();
    var remoteOptionsAt = changes && changes.syncOptionsUpdatedAt
      ? (changes.syncOptionsUpdatedAt.newValue || 0)
      : meta.syncOptionsUpdatedAt;
    var remoteProfilesAt = changes && changes.syncProfilesUpdatedAt
      ? (changes.syncProfilesUpdatedAt.newValue || 0)
      : meta.syncProfilesUpdatedAt;
    var shouldRefresh = remoteOptionsAt > lastKnownSyncOptionsUpdatedAt
      || remoteProfilesAt > lastKnownSyncProfilesUpdatedAt
      || !!(changes && (changes.profiles || changes.profileMeta || changes.localProfiles));

    lastKnownSyncOptionsUpdatedAt = storage.pickNewerTimestamp(
      lastKnownSyncOptionsUpdatedAt,
      meta.syncOptionsUpdatedAt
    );
    lastKnownSyncProfilesUpdatedAt = storage.pickNewerTimestamp(
      lastKnownSyncProfilesUpdatedAt,
      meta.syncProfilesUpdatedAt
    );

    if (!shouldRefresh) {
      return;
    }

    var context = await loadContext();
    applyCacheOptions(context.options);
    broadcastSyncRemoteUpdate();
  }

  async function initializeSyncRevisionMarkers() {
    var meta = await storage.loadSyncMeta();
    lastKnownSyncOptionsUpdatedAt = meta.syncOptionsUpdatedAt || 0;
    lastKnownSyncProfilesUpdatedAt = meta.syncProfilesUpdatedAt || 0;
  }

  addChromeListener(chrome.storage && chrome.storage.onChanged, function(changes, areaName) {
    if (areaName !== "sync") {
      return;
    }
    if (isLocalSyncEcho(changes)) {
      return;
    }
    if (!hasRelevantSyncChanges(changes)) {
      return;
    }
    if (syncIngestTimer) {
      clearTimeout(syncIngestTimer);
    }
    syncIngestTimer = setTimeout(function() {
      syncIngestTimer = null;
      ingestRemoteSyncChanges(changes).catch(function(error) {
        logger.warn("sync_ingest_failed", { message: error && error.message });
      });
    }, 300);
  });

  addChromeListener(chrome.runtime && chrome.runtime.onMessage, function(message, sender, sendResponse) {
    handleMessage(message).then(function(payload) {
      sendResponse({ ok: true, payload: payload });
    }).catch(function(error) {
      sendResponse({
        code: (error && error.code) || null,
        error: error.message,
        ok: false
      });
    });
    return true;
  });

  addChromeListener(chrome.commands && chrome.commands.onCommand, function(command) {
    if (command === "toggle-all-extensions") {
      runToggleAll().catch(function(error) {
        logger.error("toggle_all_command_failed", { message: error && error.message });
      });
      return;
    }

    if (command === "cycle-next-profile") {
      cycleProfiles(1).catch(function(error) {
        logger.error("cycle_next_profile_failed", { message: error && error.message });
      });
      return;
    }

    if (command === "cycle-previous-profile") {
      cycleProfiles(-1).catch(function(error) {
        logger.error("cycle_previous_profile_failed", { message: error && error.message });
      });
    }
  });

  addChromeListener(chrome.tabs && chrome.tabs.onUpdated, function(tabId, changeInfo, tab) {
    var url = changeInfo.url || tab.url;
    if (!url) {
      return;
    }
    if (changeInfo.status === "complete" || changeInfo.url) {
      scheduleRuleEvaluation(tabId, url);
    }
  });

  addChromeListener(chrome.tabs && chrome.tabs.onActivated, function(activeInfo) {
    getTab(activeInfo.tabId).then(function(tab) {
      if (tab && tab.url) {
        scheduleRuleEvaluation(tab.id, tab.url);
      }
    }).catch(function(error) {
      logger.error("tab_activation_failed", { message: error && error.message });
    });
  });

  addChromeListener(chrome.webNavigation && chrome.webNavigation.onHistoryStateUpdated, function(details) {
    scheduleRuleEvaluation(details.tabId, details.url);
  });

  addChromeListener(chrome.tabs && chrome.tabs.onRemoved, function(tabId) {
    var application = tabRuleApplications[tabId];
    delete tabRuleApplications[tabId];
    if (!application || !application.enabledIds.length) { return; }

    loadContext().then(function(ctx) {
      var options = ctx.options || {};
      var disableOnClose = !!options.urlRuleDisableOnClose;
      var minutes = Number(options.urlRuleTimeoutMinutes || 0);
      var entries = application.enabledIds.map(function(id) {
        var ruleEntry = application.entriesById[id] || {};
        return {
          enabled: true,
          id: id,
          ruleId: ruleEntry.ruleId || null,
          ruleName: ruleEntry.ruleName || null,
          tabId: tabId,
          url: ruleEntry.url || application.url || ""
        };
      });
      if (disableOnClose) {
        var disableChanges = entries.map(function(entry) {
          return {
            enabled: false,
            id: entry.id,
            ruleId: entry.ruleId,
            ruleName: entry.ruleName,
            tabId: entry.tabId,
            url: entry.url
          };
        });
        var closeDebugRecord = createDebugHistoryRecord(ctx, {
          action: "url_rule_close_disable",
          debug: {
            entries: disableChanges
          },
          event: "close",
          label: "URL rule close disable",
          result: "closing_tab",
          tabId: tabId,
          triggeredBy: "rule",
          url: application.url || ""
        });
        applyExtensionChanges(disableChanges, { source: "rule" }, {
          action: "url_rule_close",
          historyRecords: closeDebugRecord ? [closeDebugRecord] : [],
          pushUndo: false
        }).catch(function(err) {
          logger.error("rule_close_disable_failed", { message: err && err.message });
        });
        return;
      }
      if (minutes <= 0) {
        return;
      }
      var timeoutDebugRecord = createDebugHistoryRecord(ctx, {
        action: "url_rule_timeout_scheduled",
        debug: {
          delayMinutes: minutes,
          entries: entries
        },
        event: "timeout",
        label: "URL rule timeout scheduled",
        result: "scheduled",
        tabId: tabId,
        triggeredBy: "rule",
        url: application.url || ""
      });
      if (timeoutDebugRecord) {
        appendDebugHistoryRecords([timeoutDebugRecord]).catch(function(err) {
          logger.warn("rule_timeout_debug_history_failed", { message: err && err.message });
        });
      }
      scheduleUrlRuleTimeoutDisable(entries, minutes, tabId).catch(function(err) {
        logger.error("rule_timeout_schedule_failed", { message: err && err.message });
      });
    }).catch(function(err) {
      logger.error("rule_timeout_context_failed", { message: err && err.message });
    });
  });

  addChromeListener(chrome.alarms && chrome.alarms.onAlarm, function(alarm) {
    if (reminders.isReminderAlarm(alarm.name)) {
      reminders.handleAlarm(alarm.name).catch(function(error) {
        logger.error("reminder_alarm_failed", { message: error && error.message });
      });
      return;
    }
    if (isUrlRuleTimeoutAlarm(alarm.name)) {
      handleUrlRuleTimeoutAlarm(alarm.name).catch(function(error) {
        logger.error("url_rule_timeout_alarm_failed", { message: error && error.message });
      });
      return;
    }
    if (alarm.name === driveSyncAlarmName || alarm.name === driveChangeSyncAlarmName || alarm.name === driveStartupSyncAlarmName) {
      var trigger = alarm.name === driveChangeSyncAlarmName
        ? "change"
        : alarm.name === driveStartupSyncAlarmName ? "startup" : "periodic";
      if (trigger === "change" && driveChangeSyncTimer) {
        clearTimeout(driveChangeSyncTimer);
        driveChangeSyncTimer = null;
      }
      runAutoDriveSync(trigger).then(function() {
        if (trigger === "change" && hasChromeMethod(chrome.alarms, "clear")) {
          return chromeCall(chrome.alarms, "clear", [driveChangeSyncAlarmName]);
        }
      }).catch(function(error) {
        logger.error("drive_sync_alarm_failed", { message: error && error.message });
      });
    }
  });

  runMigrations().then(function() {
    return initializeSyncRevisionMarkers();
  }).then(function() {
    return recoverDriveTransaction();
  }).then(function() {
    return rescheduleDriveSyncAlarm();
  }).then(function() {
    return scheduleDriveStartupSync();
  }).catch(function(error) {
    logger.error("initial_migration_failed", { message: error && error.message });
  });

  if (typeof storage.loadSyncOptions === "function") {
    storage.loadSyncOptions().then(applyCacheOptions).catch(function(error) {
      logger.error("cache_options_load_failed", { message: error && error.message });
    });
  }

  if (chrome.storage && chrome.storage.local) {
    chrome.storage.local.get("driveWebClientIdOverride", function(result) {
      var override = result && result.driveWebClientIdOverride;
      if (override && typeof override === "string" && override.trim()) {
        driveSync.setWebClientId(override.trim());
      }
    });
  }

  root.ExtensityBackground = {
    buildDashboardTargetPath: buildDashboardTargetPath,
    buildFallbackMetadata: buildFallbackMetadata,
    buildGenericStoreUrl: buildGenericStoreUrl,
    buildManageExtensionUrl: buildManageExtensionUrl,
    buildToolbarPinAutomationExpression: buildToolbarPinAutomationExpression,
    defaultCategoryForInstallType: defaultCategoryForInstallType,
    firstDescriptionLine: firstDescriptionLine,
    focusOrCreateDashboardTab: focusOrCreateDashboardTab,
    isAppType: isAppType,
    loadExtensionMetadata: loadExtensionMetadata,
    normalizeExtensions: normalizeExtensions,
    normalizeStoreUrl: normalizeStoreUrl,
    openDashboard: openDashboard,
    parseChromeWebStoreHtml: parseChromeWebStoreHtml,
    pinExtensionToToolbar: pinExtensionToToolbar
  };
})(self);
