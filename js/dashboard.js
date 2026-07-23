document.addEventListener("DOMContentLoaded", function() {
  function numericOption(value, fallback) {
    var parsed = typeof value === "number" ? value : parseFloat(value);
    return isFinite(parsed) ? parsed : fallback;
  }


  function applyCssVars(options) {
    var itemPadding = numericOption(options.itemPaddingPx, 10);
    var itemVerticalSpace = numericOption(options.itemVerticalSpacePx, 0);
    var style = document.documentElement.style;
    style.setProperty("--font-size", numericOption(options.fontSizePx, 12) + "px");
    style.setProperty("--item-padding-v", Math.max(itemPadding, 0) + "px");
    style.setProperty("--item-padding-v-adjust", Math.min(itemPadding, 0) + "px");
    style.setProperty("--item-spacing", numericOption(options.itemSpacingPx, 8) + "px");
    style.setProperty("--item-v-space", Math.max(itemVerticalSpace, 0) + "px");
    style.setProperty("--item-v-space-adjust", Math.min(itemVerticalSpace, 0) + "px");
    style.setProperty("--extension-icon-size", numericOption(options.extensionIconSizePx, 16) + "px");
    style.setProperty("--popup-width", numericOption(options.popupWidthPx, 380) + "px");
  }

  function GroupEditor(group) {
    var self = this;
    self.id = ko.observable(group.id || ExtensityStorage.makeId("group"));
    self.name = ko.observable(group.name || "");
    self.color = ko.observable(group.color || "#516C97");
    self.fixed = ko.observable(!!group.fixed);
    self.extensionIds = ko.observableArray(group.extensionIds || []);

    self.toJS = function() {
      return {
        color: self.color(),
        extensionIds: ExtensityStorage.uniqueArray(self.extensionIds()),
        fixed: self.fixed(),
        id: self.id(),
        name: (self.name() || "").trim() || "Untitled Group"
      };
    };
  }

  function selectionSummary(names) {
    var list = (Array.isArray(names) ? names : []).filter(Boolean).slice().sort(function(left, right) {
      return left.localeCompare(right);
    });
    if (!list.length) {
      return "No extensions selected";
    }
    if (list.length === 1) {
      return list[0];
    }
    if (list.length === 2) {
      return list[0] + ", " + list[1];
    }
    return list[0] + ", " + list[1] + " +" + (list.length - 2);
  }

  function RuleEditor(rule, extensions) {
    var self = this;
    var extensionList = Array.isArray(extensions) ? extensions.slice() : [];
    var lookupName = function(id) {
      var match = extensionList.find(function(extension) {
        return extension.id === id;
      });
      return match ? (match.alias || match.name) : id;
    };
    self.id = ko.observable(rule.id || ExtensityStorage.makeId("rule"));
    self.name = ko.observable(rule.name || "");
    self.urlPattern = ko.observable(rule.urlPattern || "");
    self.matchMethod = ko.observable(rule.matchMethod || "wildcard");
    self.active = ko.observable(rule.active !== false);
    self.enableIds = ko.observableArray(rule.enableIds || []);
    self.disableIds = ko.observableArray(rule.disableIds || []);
    self.enableFilter = ko.observable("");
    self.disableFilter = ko.observable("");
    self.showEnable = ko.observable(false);
    self.showDisable = ko.observable(false);
    self.availableExtensions = ko.observableArray(extensionList);
    self.isDraft = ko.observable(!!rule.isDraft);
    self.draftHost = ko.observable(rule.draftHost || "");
    self.draftWww = ko.observable(!!rule.draftWww);
    self.draftWwwLabel = ko.pureComputed(function() {
      var host = self.draftHost();
      return host ? "Also match www." + host : "Also match the www. variant";
    });

    self.toggleEnableList = function() {
      self.showEnable(!self.showEnable());
    };

    self.toggleDisableList = function() {
      self.showDisable(!self.showDisable());
    };

    self.enableSummary = ko.pureComputed(function() {
      return selectionSummary((self.enableIds() || []).map(function(id) {
        return lookupName(id);
      }));
    });

    self.disableSummary = ko.pureComputed(function() {
      return selectionSummary((self.disableIds() || []).map(function(id) {
        return lookupName(id);
      }));
    });

    self.enableToggleLabel = ko.pureComputed(function() {
      return self.showEnable() ? "Hide list" : "Edit list";
    });

    self.disableToggleLabel = ko.pureComputed(function() {
      return self.showDisable() ? "Hide list" : "Edit list";
    });

    self.filteredEnableExtensions = ko.pureComputed(function() {
      var normalized = String(self.enableFilter() || "").trim().toLowerCase();
      return self.availableExtensions().filter(function(extension) {
        if (!normalized) {
          return true;
        }
        var name = String(extension.name || "").toLowerCase();
        var alias = String(extension.alias || "").toLowerCase();
        return name.indexOf(normalized) !== -1 || alias.indexOf(normalized) !== -1;
      });
    });

    self.filteredDisableExtensions = ko.pureComputed(function() {
      var normalized = String(self.disableFilter() || "").trim().toLowerCase();
      return self.availableExtensions().filter(function(extension) {
        if (!normalized) {
          return true;
        }
        var name = String(extension.name || "").toLowerCase();
        var alias = String(extension.alias || "").toLowerCase();
        return name.indexOf(normalized) !== -1 || alias.indexOf(normalized) !== -1;
      });
    });

    self.isSelected = ko.observable(false);
    self.peerRules = ko.observableArray([]);
    self.duplicatePatternNote = ko.pureComputed(function() {
      var pattern = (self.urlPattern() || "").trim();
      if (!pattern) {
        return "";
      }
      var ownId = self.id();
      var hasDuplicate = self.peerRules().some(function(peer) {
        if (!peer || peer === self || peer.id() === ownId) {
          return false;
        }
        return (peer.urlPattern() || "").trim() === pattern;
      });
      return hasDuplicate ? "A rule already covers this pattern." : "";
    });

    self.toJS = function() {
      return {
        active: self.active(),
        disableIds: ExtensityStorage.uniqueArray(self.disableIds()),
        enableIds: ExtensityStorage.uniqueArray(self.enableIds()),
        id: self.id(),
        matchMethod: self.matchMethod(),
        name: (self.name() || "").trim() || "Untitled Rule",
        urlPattern: (self.urlPattern() || "").trim()
      };
    };
  }

  var DRAFT_HASH_MAX = 512;
  var DRAFT_PATTERN_SAFE = /^[A-Za-z0-9.\-:*\/]+$/;
  var DRAFT_HOST_SAFE = /^[a-z0-9.\-]+$/;
  var DRAFT_EXTENSION_ID_SAFE = /^[a-z0-9_-]{1,64}$/i;

  function resolveDraftEnableIds(draft, extensions) {
    if (!draft || !draft.extensionId) {
      return [];
    }
    var list = Array.isArray(extensions) ? extensions : [];
    if (!list.some(function(extension) {
      return extension && extension.id === draft.extensionId;
    })) {
      return [];
    }
    return [draft.extensionId];
  }

  function parseRuleDraft(hash) {
    if (!hash || typeof hash !== "string" || hash.length > DRAFT_HASH_MAX) {
      return null;
    }
    var stripped = hash.charAt(0) === "#" ? hash.slice(1) : hash;
    var queryIndex = stripped.indexOf("?");
    if (queryIndex === -1) {
      return null;
    }
    var tab = stripped.slice(0, queryIndex);
    if (tab !== "rules") {
      return null;
    }
    var params;
    try {
      params = new URLSearchParams(stripped.slice(queryIndex + 1));
    } catch (error) {
      return null;
    }
    if (params.get("error")) {
      return { tab: tab, error: params.get("error") };
    }
    var draftId = params.get("draftId") || "";
    var host = (params.get("host") || "").toLowerCase();
    var pattern = params.get("pattern") || "";
    var suggestWww = params.get("suggestWww") === "1";
    var source = params.get("source") || "";
    if (!draftId || !host || !pattern || source !== "add_active_site") {
      return null;
    }
    if (!DRAFT_HOST_SAFE.test(host)) {
      return null;
    }
    if (!DRAFT_PATTERN_SAFE.test(pattern) || pattern.indexOf("://") === -1) {
      return null;
    }
    var extensionId = params.get("extensionId") || "";
    if (extensionId && !DRAFT_EXTENSION_ID_SAFE.test(extensionId)) {
      return null;
    }
    return {
      draftId: draftId,
      extensionId: extensionId,
      host: host,
      pattern: pattern,
      source: source,
      suggestWww: suggestWww,
      tab: tab
    };
  }

  function AliasEditor(extension) {
    this.alias = ko.observable(extension.alias || "");
    this.id = extension.id;
    this.name = extension.name;
  }

  function historyLabelForEvent(event) {
    var map = {
      close: "Close",
      disabled: "Disabled",
      enabled: "Enabled",
      evaluation: "Evaluation",
      info: "Info",
      timeout: "Timeout"
    };
    return map[event] || (event || "Info");
  }

  function getSyncStatusLabel(status) {
    if (status === "synced" || status === "synced_partial") {
      return status === "synced_partial" ? "Synced (partial)" : "Synced";
    }
    if (status === "error") {
      return "Sync Error";
    }
    return "Not Connected";
  }

  function getSyncStatusBadgeClass(status) {
    if (status === "synced" || status === "synced_partial") {
      return "sync-status-badge sync-status-synced";
    }
    if (status === "error") {
      return "sync-status-badge sync-status-error";
    }
    return "sync-status-badge sync-status-disconnected";
  }

  function formatDateTime(timestamp) {
    if (!timestamp) {
      return "Never";
    }
    return new Date(timestamp).toLocaleString();
  }

  function formatDriveInstallType(status) {
    if (!status || !status.installType) {
      return "Unknown";
    }
    if (status.installType === "development") {
      return "Local / development";
    }
    if (status.installType === "normal") {
      return "Store / normal";
    }
    return "Unknown";
  }

  function formatDriveAuthState(status) {
    if (!status) {
      return "Unknown";
    }
    if (status.driveAuthStatus === "authorized") {
      return "Authorized";
    }
    if (status.driveAuthStatus === "needs_interactive_sign_in") {
      return "Needs sign-in";
    }
    if (status.driveAuthStatus === "error") {
      return "Error";
    }
    return "Unknown";
  }

  function formatDriveAuthProvider(status) {
    if (!status || !status.authProvider) {
      return "Unknown";
    }
    if (status.authProvider === "web_fallback") {
      return "Brave web fallback";
    }
    return "Chrome extension token";
  }

  function formatDriveWebFallback(status) {
    if (!status) {
      return "Unknown";
    }
    if (!status.webFallbackConfigured) {
      return "Not configured";
    }
    if (status.webAuthPreferred) {
      return "Configured and preferred in Brave";
    }
    return "Configured";
  }

  function formatDriveAutoSync(status) {
    if (!status) {
      return "Unknown";
    }
    if (!status.driveSync) {
      return "Disabled";
    }
    return "Enabled every " + (status.intervalMinutes || 60) + " minutes";
  }

  /**
   * Formats the most recent Drive synchronization time.
   * @param {Object} status - Drive synchronization status data.
   * @return {string} The formatted synchronization time, or `"Never"` when no synchronization has occurred.
   */
  function formatDriveLastSync(status) {
    if (!status || !status.lastDriveSync) {
      return "Never";
    }
    return formatDateTime(status.lastDriveSync);
  }

  /**
   * Formats the most recent Drive sync error for display.
   * @param {Object|null|undefined} status - Drive sync status data.
   * @returns {string} The error message, or `"None"` when no error is recorded.
   */
  function formatDriveLastError(status) {
    if (!status || !status.lastDriveSyncError) {
      return "None";
    }
    if (typeof status.lastDriveSyncError === "string") {
      return status.lastDriveSyncError;
    }
    if (status.lastDriveSyncError.message) {
      return status.lastDriveSyncError.message;
    }
    return "Drive sync error";
  }

  /**
   * Builds display-ready rows summarizing Google Drive synchronization status, including remote file, local payload, recovery, and backup details.
   * @param {Object|null|undefined} status - Drive synchronization status data.
   * @return {Array<Object>} Rows containing labels and formatted status values.
   */
  function buildDriveStatusRows(status) {
    var normalized = status || {};
    return [
      { label: "Configured", value: normalized.configured ? "Yes" : "No" },
      { label: "Auth state", value: formatDriveAuthState(normalized) },
      { label: "Auth path", value: formatDriveAuthProvider(normalized) },
      { label: "Extension ID", value: normalized.extensionId || "Unavailable" },
      { label: "Install type", value: formatDriveInstallType(normalized) },
      { label: "Web fallback", value: formatDriveWebFallback(normalized) },
      { label: "Auto-sync", value: formatDriveAutoSync(normalized) },
      { label: "Last sync", value: formatDriveLastSync(normalized) },
      { label: "App-data file ID", value: normalized.fileId || "Not assigned yet" },
      { label: "Drive file size", value: normalized.remote && normalized.remote.size ? normalized.remote.size + " bytes" : "Unknown" },
      { label: "Drive modified", value: normalized.remote && normalized.remote.modifiedTime || "Unknown" },
      { label: "Drive version", value: normalized.remote && normalized.remote.version || "Unknown" },
      { label: "Local payload", value: normalized.local && normalized.local.bytes ? normalized.local.bytes + " bytes" : "Unknown" },
      { label: "Recovery journal", value: normalized.transaction ? normalized.transaction.phase || "Pending" : "Clear" },
      { label: "Undo backup", value: normalized.backupAvailable ? "Available" : "Unavailable" },
      { label: "Last error", value: formatDriveLastError(normalized) },
      {
        label: "Drive storage",
        value: "The sync file lives in the hidden appDataFolder, so there is no browsable folder URL."
      }
    ];
  }

  /**
   * Builds a user-facing headline describing the current Google Drive sync state.
   * @param {Object|null|undefined} status - Drive sync status information.
   * @return {string} A headline describing the sync configuration, authorization, or readiness state.
   */
  function buildDriveStatusHeadline(status) {
    if (!status) {
      return "Google Drive sync status unavailable.";
    }
    if (!status.configured) {
      return "Drive sync is not configured for this build.";
    }
    if (status.driveAuthStatus === "needs_interactive_sign_in") {
      return "Drive sync needs sign-in. Run Sync Drive once to authorize background auto-sync.";
    }
    if (status.driveAuthStatus === "error") {
      return "Drive sync reported an error. Check the last error below.";
    }
    if (!status.driveSync) {
      return "Drive sync is configured but disabled.";
    }
    return "Drive sync is ready.";
  }

  /**
   * Describes the active Google Drive authentication path and fallback configuration.
   * @param {Object|null|undefined} status - Drive authentication status information.
   * @return {string} A human-readable description of the authentication path.
   */
  function buildDriveStatusDetails(status) {
    if (!status) {
      return "Google Drive status is unavailable.";
    }
    if (status.webAuthPreferred) {
      return "Brave is using the Web OAuth fallback path.";
    }
    if (status.webFallbackConfigured) {
      return "Web OAuth fallback is configured for Brave if the Chrome extension flow fails.";
    }
    return "Chrome extension OAuth is active. Brave fallback is not configured.";
  }

  /**
   * Create the dashboard's Knockout view model and initialize its state, actions, computed values, and synchronization controls.
   */
  function DashboardViewModel() {
    var self = this;
    self.loading = ko.observable(true);
    self.busy = ko.observable(false);
    self.error = ko.observable("");
    self.message = ko.observable("");
    self.activeTab = ko.observable("history");
    self.historyTab = ko.pureComputed(function() { return self.activeTab() === "history"; });
    self.groupsTab = ko.pureComputed(function() { return self.activeTab() === "groups"; });
    self.rulesTab = ko.pureComputed(function() { return self.activeTab() === "rules"; });
    self.aliasesTab = ko.pureComputed(function() { return self.activeTab() === "aliases"; });
    self.dataTab = ko.pureComputed(function() { return self.activeTab() === "data"; });
    self.syncStatusTab = ko.pureComputed(function() { return self.activeTab() === "sync_status"; });
    self.aboutTab = ko.pureComputed(function() { return self.activeTab() === "about"; });
    self.showTabHistory = function() { self.activeTab("history"); };
    self.showTabGroups = function() { self.activeTab("groups"); };
    self.showTabRules = function() { self.activeTab("rules"); };
    self.showTabAliases = function() { self.activeTab("aliases"); };
    self.showTabData = function() { self.activeTab("data"); };
    self.showTabSyncStatus = function() {
      self.activeTab("sync_status");
      self.refreshDriveSyncStatus();
    };
    self.showTabAbout = function() { self.activeTab("about"); };
    self.appVersion = ko.observable("");
    self.needsWebStorePermission = ko.observable(false);

    self.checkWebStorePermission = function() {
      chrome.permissions.contains(
        { origins: ["https://chromewebstore.google.com/*"] },
        function(granted) { self.needsWebStorePermission(!granted); }
      );
    };

    self.requestWebStorePermission = function() {
      chrome.permissions.request(
        { origins: ["https://chromewebstore.google.com/*"] },
        function(granted) { self.needsWebStorePermission(!granted); }
      );
    };

    self.options = new OptionsCollection();
    self.extensions = ko.observableArray([]);
    self.aliasRows = ko.observableArray([]);
    self.groups = ko.observableArray([]);
    self.rules = ko.observableArray([]);
    self.historyRows = ko.observableArray([]);
    self.historySourceFilter = ko.observable("all");
    self.historyResultFilter = ko.observable("all");
    self.ruleTesterUrl = ko.observable("");
    self.ruleTestResult = ko.observable(null);
    self.selectedRuleId = ko.observable("");
    self.syncStatus = ko.observable("not_connected");
    self.syncStatusReason = ko.observable("Run a check to verify extension data in chrome.storage.sync.");
    self.syncStatusDetails = ko.observable("");
    self.syncStatusTimestamp = ko.observable(null);
    self.syncStatusLabel = ko.pureComputed(function() {
      return getSyncStatusLabel(self.syncStatus());
    });
    self.syncStatusBadgeClass = ko.pureComputed(function() {
      return getSyncStatusBadgeClass(self.syncStatus());
    });
    self.syncStatusCheckedAt = ko.pureComputed(function() {
      if (!self.syncStatusTimestamp()) {
        return "";
      }
      return "Last checked: " + new Date(self.syncStatusTimestamp()).toLocaleString();
    });
    self.driveStatus = ko.observable(null);
    self.driveStatusTimestamp = ko.observable(null);
    self.driveStatusHeadline = ko.pureComputed(function() {
      return buildDriveStatusHeadline(self.driveStatus());
    });
    self.driveStatusDetails = ko.pureComputed(function() {
      return buildDriveStatusDetails(self.driveStatus());
    });
    self.driveStatusCheckedAt = ko.pureComputed(function() {
      if (!self.driveStatusTimestamp()) {
        return "";
      }
      return "Last checked: " + new Date(self.driveStatusTimestamp()).toLocaleString();
    });
    self.driveStatusRows = ko.pureComputed(function() {
      return buildDriveStatusRows(self.driveStatus());
    });
    self.driveWebClientIdInput = ko.observable("");
    self.driveOAuthClientLabel = ko.pureComputed(function() {
      var s = self.driveStatus();
      return (s && s.configured) ? "Configured (manifest)" : "Not configured";
    });
    self.driveOAuthExtensionId = ko.pureComputed(function() {
      var s = self.driveStatus();
      return (s && s.extensionId) ? s.extensionId : "Unknown";
    });
    self.driveOAuthInstallType = ko.pureComputed(function() {
      var s = self.driveStatus();
      return (s && s.installType) ? s.installType : "Unknown";
    });
    self.driveOAuthAuthPath = ko.pureComputed(function() {
      var s = self.driveStatus();
      return (s && s.webAuthPreferred) ? "Brave web fallback" : "Chrome extension token";
    });
    self.driveOAuthRedirectUri = ko.pureComputed(function() {
      var s = self.driveStatus();
      return (s && s.extensionId) ? "https://" + s.extensionId + ".chromiumapp.org/drive" : "";
    });

    self.filteredHistoryRows = ko.pureComputed(function() {
      var sourceFilter = self.historySourceFilter();
      var resultFilter = self.historyResultFilter();
      return self.historyRows().filter(function(row) {
        if (sourceFilter !== "all" && row.triggeredBy !== sourceFilter) {
          return false;
        }
        if (resultFilter !== "all" && row.result !== resultFilter) {
          return false;
        }
        return true;
      });
    });

    self.ruleTestSummary = ko.pureComputed(function() {
      var result = self.ruleTestResult();
      if (!result) {
        return "";
      }
      if (result.result === "unsupported_url") {
        return "Only http and https URLs can be tested.";
      }
      if (result.result === "no_match") {
        return "No URL rules matched this URL.";
      }
      if (result.result === "no_op") {
        return "Rules matched, but the final state matches the current extension states.";
      }
      return "Rules matched and would change extension state.";
    });

    self.ruleResultBadgeClass = function(result) {
      return "event-badge event-" + (result || "info");
    };

    self.openRelatedRule = function(row) {
      if (!row || !row.ruleId) {
        return;
      }
      self.selectedRuleId(row.ruleId);
      self.activeTab("rules");
    };

    self.clearRuleSelection = function() {
      self.selectedRuleId("");
    };

    self.testRules = function() {
      var url = String(self.ruleTesterUrl() || "").trim();
      if (!url) {
        self.ruleTestResult(null);
        self.error("Enter a URL to test.");
        return;
      }
      self.performAction(ExtensityApi.testUrlRules(url)).then(function(payload) {
        var matchedRules = (payload.matchedRules || []).map(function(rule) {
          return Object.assign({}, rule, {
            affectedCount: (rule.enableIds || []).length + (rule.disableIds || []).length,
            badgeClass: "event-badge event-info",
            isSelected: rule.id === self.selectedRuleId()
          });
        });
        var finalChanges = (payload.finalChanges || []).map(function(change) {
          var chain = payload.perExtension && payload.perExtension[change.extensionId] ? payload.perExtension[change.extensionId] : [];
          var overrides = chain.slice(0, -1).map(function(entry) {
            return (entry.ruleName || entry.ruleId || "Rule") + " → " + (entry.enabled ? "enable" : "disable");
          });
          return Object.assign({}, change, {
            actionLabel: change.enabled ? "Enable" : "Disable",
            badgeClass: self.ruleResultBadgeClass(change.enabled ? "state_changed_on" : "state_changed_off"),
            overrideLine: overrides.join(" • "),
            overrides: overrides,
            stateLabel: (change.previousEnabled ? "On" : "Off") + " → " + (change.enabled ? "On" : "Off")
          });
        });
        self.ruleTestResult({
          finalChanges: finalChanges,
          matchedRules: matchedRules,
          result: payload.result,
          url: payload.url
        });
      }).catch(function() {});
    };

    self.applyState = function(state) {
      var localState = state && state.localState ? state.localState : {};
      var extensionList = Array.isArray(state && state.extensions) ? state.extensions : [];
      var groupOrder = Array.isArray(localState.groupOrder) ? localState.groupOrder : [];
      var groups = localState.groups || {};
      var urlRules = Array.isArray(localState.urlRules) ? localState.urlRules : [];
      var eventHistory = Array.isArray(localState.eventHistory) ? localState.eventHistory : [];
      self.appVersion((state.metadata && state.metadata.version) || "");
      self.options.apply(state.options);
      ExtensityUtils.applyThemeClasses(state.options);
      applyCssVars(state.options);
      self.extensions(extensionList.filter(function(extension) {
        return !extension.isApp;
      }));
      self.aliasRows(self.extensions().map(function(extension) {
        return new AliasEditor(extension);
      }));
      self.groups(groupOrder.filter(function(groupId) {
        return Object.prototype.hasOwnProperty.call(groups, groupId);
      }).map(function(groupId) {
        return new GroupEditor(groups[groupId]);
      }));
      var ruleEditors = urlRules.map(function(rule) {
        var editor = new RuleEditor(rule, self.extensions());
        editor.isSelected(editor.id() === self.selectedRuleId());
        return editor;
      });
      self.rules(ruleEditors);
      self.refreshPeerRules();
      self.historyRows(eventHistory.slice().reverse().map(function(row) {
        var details = [];
        if (row.action) { details.push("action=" + row.action); }
        if (row.ruleName) { details.push("rule=" + row.ruleName); }
        if (row.result) { details.push("result=" + row.result); }
        if (row.url) { details.push("url=" + row.url); }
        if (row.tabId != null) { details.push("tab=" + row.tabId); }
        if (typeof row.previousEnabled === "boolean" && typeof row.nextEnabled === "boolean") {
          details.push("state=" + (row.previousEnabled ? "on" : "off") + "→" + (row.nextEnabled ? "on" : "off"));
        }
        if (row.debug) { details.push("debug=" + row.debug); }
        return {
          event: historyLabelForEvent(row.event),
          extensionName: row.extensionName || row.label || "Rule event",
          id: row.id,
          result: row.result || "",
          ruleId: row.ruleId || null,
          triggeredBy: row.triggeredBy,
          details: details.join(" • "),
          timestamp: row.timestamp,
          badgeClass: "event-badge event-" + (row.result || row.event || "unknown"),
          formattedDate: new Date(row.timestamp).toLocaleString()
        };
      }));
      if (self.ruleTestResult()) {
        self.ruleTestResult(null);
      }
      self.applyPendingDraft();
      if (window.ExtensityTooltips && window.ExtensityTooltips.applyAutoTooltips) {
        window.ExtensityTooltips.applyAutoTooltips(document.body);
      }
      self.loading(false);
      self.error("");
      self.checkWebStorePermission();
    };

    self.pendingDraft = null;

    self.applyPendingDraft = function() {
      var draft = self.pendingDraft;
      if (!draft) {
        return;
      }
      self.pendingDraft = null;
      try {
        if (window.history && typeof window.history.replaceState === "function") {
          window.history.replaceState(null, "", window.location.pathname + window.location.search);
        }
      } catch (error) {
        // ignore — replaceState is best-effort
      }
      self.activeTab("rules");
      if (draft.error) {
        self.error("Cannot add a URL rule for this site. URL rules only support http and https.");
        return;
      }
      var editor = new RuleEditor({
        active: true,
        draftHost: draft.host,
        draftWww: draft.suggestWww,
        enableIds: resolveDraftEnableIds(draft, self.extensions()),
        disableIds: [],
        id: draft.draftId,
        isDraft: true,
        matchMethod: "wildcard",
        name: draft.host,
        urlPattern: draft.pattern
      }, self.extensions());
      editor.showEnable(true);
      editor.isSelected(true);
      self.rules.unshift(editor);
      self.refreshPeerRules();
      self.selectedRuleId(draft.draftId);
      self.message("Draft for " + draft.host + " — review extensions and click Save URL rules.");
    };

    self.performAction = function(request) {
      self.busy(true);
      self.error("");

      return request.then(function(payload) {
        if (payload.state) {
          self.applyState(payload.state);
        }
        return payload;
      }).catch(function(error) {
        self.error(error.message);
        throw error;
      }).finally(function() {
        self.busy(false);
      });
    };

    self.refresh = function() {
      self.loading(true);
      return self.performAction(ExtensityApi.getState()).then(function(payload) {
        return self.refreshDriveSyncStatus().then(function() {
          return payload;
        });
      });
    };

    self.refreshDriveSyncStatus = function() {
      if (typeof ExtensityApi === "undefined" || typeof ExtensityApi.getDriveSyncStatus !== "function") {
        self.driveStatus(null);
        self.driveStatusTimestamp(Date.now());
        return Promise.resolve(null);
      }
      return ExtensityApi.getDriveSyncStatus().then(function(payload) {
        self.driveStatusTimestamp(Date.now());
        var status = payload && payload.status ? payload.status : null;
        self.driveStatus(status);
        if (status && status.webClientId && !self.driveWebClientIdInput()) {
          self.driveWebClientIdInput(status.webClientId);
        }
        return payload;
      }).catch(function() {
        self.driveStatusTimestamp(Date.now());
        self.driveStatus(null);
        return null;
      });
    };

    self.isTab = function(tab) {
      return self.activeTab() === tab;
    };

    self.eventBadgeClass = function(event) {
      return "event-badge event-" + (event || "unknown");
    };

    self.saveAliases = function() {
      var aliases = self.aliasRows().reduce(function(result, row) {
        if ((row.alias() || "").trim()) {
          result[row.id] = row.alias().trim();
        }
        return result;
      }, {});

      self.performAction(ExtensityApi.saveAliases(aliases)).then(function() {
        self.message("Aliases saved.");
      }).catch(function() {});
    };

    self.addGroup = function() {
      self.groups.push(new GroupEditor({}));
    };

    self.removeGroup = function(group) {
      self.groups.remove(group);
    };

    self.saveGroups = function() {
      var groups = {};
      var order = self.groups().map(function(group) {
        var data = group.toJS();
        groups[data.id] = data;
        return data.id;
      });

      self.performAction(ExtensityApi.saveGroups(groups, order)).then(function() {
        self.message("Groups saved.");
      }).catch(function() {});
    };

    self.refreshPeerRules = function() {
      var current = self.rules();
      current.forEach(function(rule) {
        rule.peerRules(current);
      });
    };

    self.addRule = function() {
      self.rules.push(new RuleEditor({}, self.extensions()));
      self.refreshPeerRules();
    };

    self.removeRule = function(rule) {
      self.rules.remove(rule);
      self.refreshPeerRules();
    };

    self.saveRules = function() {
      var rules = [];
      self.rules().forEach(function(rule) {
        var raw = rule.toJS();
        rules.push(raw);
        if (rule.isDraft() && rule.draftWww() && rule.draftHost()) {
          var host = rule.draftHost();
          var siblingPattern = "*://www." + host + "/*";
          var siblingExists = rules.some(function(existing) {
            return existing.urlPattern === siblingPattern;
          });
          if (!siblingExists) {
            rules.push({
              active: raw.active,
              disableIds: raw.disableIds.slice(),
              enableIds: raw.enableIds.slice(),
              id: ExtensityStorage.makeId("rule"),
              matchMethod: raw.matchMethod,
              name: (raw.name || host) + " (www)",
              urlPattern: siblingPattern
            });
          }
        }
      });

      self.performAction(ExtensityApi.saveUrlRules(rules)).then(function() {
        self.message("URL rules saved.");
      }).catch(function() {});
    };

    function downloadBackup(payload, filenamePrefix) {
      ExtensityIO.downloadText(
        ExtensityIO.exportFilename(filenamePrefix, "json"),
        JSON.stringify(payload.envelope, null, 2),
        "application/json;charset=utf-8"
      );
    }

    self.exportJson = function() {
      self.performAction(ExtensityApi.exportBackup()).then(function(payload) {
        downloadBackup(payload, "extensity-plus-backup");
      }).catch(function() {});
    };

    self.exportProfilesJson = function() {
      self.performAction(ExtensityApi.exportBackup("profiles")).then(function(payload) {
        downloadBackup(payload, "extensity-plus-profiles");
      }).catch(function() {});
    };

    self.exportSettingsJson = function() {
      self.performAction(ExtensityApi.exportBackup("settings")).then(function(payload) {
        downloadBackup(payload, "extensity-plus-settings");
      }).catch(function() {});
    };

    self.exportProfilesSettingsJson = function() {
      self.performAction(ExtensityApi.exportBackup("profiles_settings")).then(function(payload) {
        downloadBackup(payload, "extensity-plus-profiles-settings");
      }).catch(function() {});
    };

    self.exportCsv = function() {
      self.performAction(ExtensityApi.getState()).then(function(payload) {
        var csv = ExtensityImportExport.buildExtensionsCsv(payload.state.extensions);
        ExtensityIO.downloadText(ExtensityIO.exportFilename("extensity-extensions", "csv"), csv, "text/csv;charset=utf-8");
      }).catch(function() {});
    };

    self.importJson = function(viewModel, event) {
      var file = event.target.files && event.target.files[0];
      if (!file) {
        return;
      }

      self.busy(true);
      ExtensityIO.readFileAsText(file).then(function(content) {
        return JSON.parse(content);
      }).then(function(envelope) {
        return ExtensityApi.importBackup(envelope);
      }).then(function(payload) {
        self.applyState(payload.state);
        self.message(ExtensityUtils.importSuccessMessage(payload.importScope));
      }).catch(function(error) {
        self.error(error.message);
      }).finally(function() {
        self.busy(false);
        event.target.value = "";
      });
    };

    self.formatHistoryDate = function(timestamp) {
      return new Date(timestamp).toLocaleString();
    };

    self.driveConflictVisible = ko.pureComputed(function() {
      return !!self.options.drivePendingConflict();
    });
    self.driveConflictSummary = ko.pureComputed(function() {
      var conflict = self.options.drivePendingConflict();
      if (!conflict) {
        return "";
      }
      try {
        return ExtensityDriveSync.describeDrivePendingConflict(conflict);
      } catch (err) {
        return "Drive sync conflict" + (conflict.reason ? " (" + conflict.reason + ")" : "") +
          ". Click Cancel or check for an extension update.";
      }
    });
    self.driveConflictResolvable = ko.pureComputed(function() {
      return ExtensityDriveSync.isDriveConflictResolvable(self.options.drivePendingConflict());
    });
    self.driveConflictDuplicateFiles = ko.pureComputed(function() {
      var conflict = self.options.drivePendingConflict();
      if (!conflict || conflict.reason !== "duplicate_remote_files" || !Array.isArray(conflict.duplicateFiles)) {
        return [];
      }
      return conflict.duplicateFiles.map(function(file) {
        return {
          id: file.id,
          modifiedLabel: file.modifiedTime ? new Date(file.modifiedTime).toLocaleString() : "Unknown modified time",
          name: file.name || "extensity-plus-sync.json",
          sizeLabel: file.size ? (file.size + " bytes") : "Unknown size"
        };
      });
    });
    self.driveConflictHasDuplicates = ko.pureComputed(function() {
      return self.driveConflictDuplicateFiles().length > 0;
    });
    self.driveDeleteDuplicateFile = function(file) {
      if (!file || !file.id) {
        return Promise.resolve();
      }
      self.error("");
      return self.performAction(ExtensityApi.deleteDriveFile(file.id)).then(function() {
        self.message("Deleted duplicate Drive sync file.");
        return self.refreshDriveSyncStatus();
      }).catch(function(err) {
        self.error((err && err.message) || "Failed to delete the Drive sync file.");
      });
    };
    self.driveSyncStatusLabel = ko.pureComputed(function() {
      var authStatus = typeof self.options.driveAuthStatus === "function"
        ? self.options.driveAuthStatus()
        : "unknown";
      var driveError = self.options.lastDriveSyncError();
      var at = self.options.lastDriveSync();
      if (authStatus === "needs_interactive_sign_in") {
        return "Google Drive sync needs sign-in. Run Sync Drive once to authorize background auto-sync.";
      }
      if (driveError && driveError.message) {
        return "Google Drive error: " + driveError.message;
      }
      if (!at) {
        return "Google Drive: not synced yet. Configure OAuth client id and run Sync Drive.";
      }
      return "Google Drive last sync: " + new Date(at).toLocaleString();
    });

    function handleDriveSyncResult(payload) {
      var result = payload && payload.result ? payload.result : {};
      if (result.status === "conflict" || result.status === "failsafe") {
        self.message(result.message || "Drive sync needs your input.");
        self.refreshDriveSyncStatus();
        return;
      }
      if (result.status === "cancelled") {
        self.message("Drive sync cancelled.");
        self.refreshDriveSyncStatus();
        return;
      }
      self.message("Drive sync completed (" + (result.status || "ok") + ").");
      self.refreshDriveSyncStatus();
    }

    function handleDriveSyncError(err) {
      self.error((err && err.message) || "Drive sync failed.");
      return self.refresh().catch(function() {});
    }

    self.driveSyncNow = function() {
      return self.performAction(ExtensityApi.syncDrive({ direction: "sync" })).then(handleDriveSyncResult).catch(handleDriveSyncError);
    };

    self.drivePush = function() {
      return self.performAction(ExtensityApi.syncDrive({ direction: "push" })).then(handleDriveSyncResult).catch(handleDriveSyncError);
    };

    self.drivePull = function() {
      return self.performAction(ExtensityApi.syncDrive({ direction: "pull" })).then(handleDriveSyncResult).catch(handleDriveSyncError);
    };

    self.driveResolveKeepLocal = function() {
      return self.performAction(ExtensityApi.resolveDriveConflict("keep_local")).then(handleDriveSyncResult).catch(handleDriveSyncError);
    };

    self.driveResolveKeepRemote = function() {
      return self.performAction(ExtensityApi.resolveDriveConflict("keep_remote")).then(handleDriveSyncResult).catch(handleDriveSyncError);
    };

    self.driveResolveCancel = function() {
      return self.performAction(ExtensityApi.resolveDriveConflict("cancel")).then(handleDriveSyncResult).catch(handleDriveSyncError);
    };

    self.saveDriveSettings = function() {
      self.performAction(ExtensityApi.saveOptions(self.options.toJS())).then(function(payload) {
        if (payload && payload.state) {
          self.applyState(payload.state);
        }
        self.message("Drive sync settings saved.");
        self.refreshDriveSyncStatus();
      }).catch(function() {});
    };

    self.restoreDriveBackup = function() {
      self.performAction(ExtensityApi.restoreDriveSyncBackup()).then(function(payload) {
        if (payload && payload.state) {
          self.applyState(payload.state);
        }
        self.message("Latest Drive sync backup restored.");
        self.refreshDriveSyncStatus();
      }).catch(function() {});
    };

    self.openGoogleDrive = function() {
      if (typeof window !== "undefined" && typeof window.open === "function") {
        window.open("https://drive.google.com/drive/u/0", "_blank", "noopener,noreferrer");
      }
    };

    self.checkSyncStatus = function() {
      self.busy(true);
      self.error("");
      self.message("");

      ExtensityBrowserSync.checkBrowserSyncHealth(self.options.keys || []).then(function(result) {
        self.syncStatus(result.status);
        self.syncStatusReason(result.reason);
        self.syncStatusDetails(result.detailsSummary || "");
        self.syncStatusTimestamp(Date.now());
        self.busy(false);
      });
    };

    var _logger = typeof window !== "undefined" && window.ExtensityLogger ? window.ExtensityLogger : null;
    var _levelClass = { error: "event-badge event-state_changed_off", warn: "event-badge event-scheduled", info: "event-badge event-state_changed_on", debug: "event-badge event-meta" };

    function buildLogRow(entry) {
      var rawTs = entry.timestamp || "";
      var epochTs = rawTs ? new Date(rawTs).getTime() : Date.now();
      return {
        isLogEntry: true,
        isHistoryEntry: false,
        epochTs: isFinite(epochTs) ? epochTs : Date.now(),
        level: entry.level,
        levelBadgeClass: _levelClass[entry.level] || "event-badge",
        timestamp: rawTs.replace("T", " ").slice(0, 19),
        message: entry.message,
        dataLine: entry.data ? JSON.stringify(entry.data) : null
      };
    }

    var _debugOrigConsoleError = null;
    var _debugOrigConsoleWarn = null;
    var _debugOrigOnerror = null;

    function installDebugHooks() {
      if (_debugOrigConsoleError !== null) { return; }
      _debugOrigConsoleError = console.error;
      _debugOrigConsoleWarn = console.warn;
      console.error = function() {
        _debugOrigConsoleError.apply(console, arguments);
        if (_logger) { _logger.error("[console.error] " + Array.prototype.slice.call(arguments).join(" ")); }
      };
      console.warn = function() {
        _debugOrigConsoleWarn.apply(console, arguments);
        if (_logger) { _logger.warn("[console.warn] " + Array.prototype.slice.call(arguments).join(" ")); }
      };
      _debugOrigOnerror = window.onerror || null;
      window.onerror = function(msg, src, line) {
        if (_logger) { _logger.error("[uncaught] " + msg, { src: src, line: line }); }
        if (typeof _debugOrigOnerror === "function") { return _debugOrigOnerror.apply(window, arguments); }
      };
    }

    function removeDebugHooks() {
      if (_debugOrigConsoleError !== null) {
        console.error = _debugOrigConsoleError;
        _debugOrigConsoleError = null;
      }
      if (_debugOrigConsoleWarn !== null) {
        console.warn = _debugOrigConsoleWarn;
        _debugOrigConsoleWarn = null;
      }
      window.onerror = _debugOrigOnerror;
      _debugOrigOnerror = null;
    }

    self.logEntries = ko.observableArray([]);
    self.logLevel = ko.observable(_logger ? _logger.getLevel() : "warn");
    self.errorsOnly = ko.observable(false);
    self.logEmpty = ko.pureComputed(function() { return self.logEntries().length === 0; });

    if (_logger) {
      _logger.loadLevel(function(level) {
        self.logLevel(level);
        if (level === "debug") { installDebugHooks(); }
      });
      _logger.subscribe(function(entry) {
        self.logEntries.unshift(buildLogRow(entry));
      });
      _logger.readShared(function(entries) {
        var rows = entries.map(buildLogRow);
        self.logEntries(rows.reverse().concat(self.logEntries()));
      });
    }

    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener(function(changes, area) {
        if (area !== "local" || !changes.extensityLog) { return; }
        var newList = changes.extensityLog.newValue;
        var oldList = changes.extensityLog.oldValue || [];
        if (!Array.isArray(newList)) { return; }
        var added = newList.slice(oldList.length);
        added.forEach(function(entry) {
          self.logEntries.unshift(buildLogRow(entry));
        });
      });
    }

    self.logLevel.subscribe(function(val) {
      if (_logger) {
        _logger.setLevel(val);
      }
      if (val === "debug") {
        installDebugHooks();
      } else {
        removeDebugHooks();
      }
    });

    self.clearLog = function() {
      if (_logger) {
        _logger.clearEntries();
        _logger.clearShared();
      }
      self.logEntries([]);
    };

    self.copyLog = function() {
      var text = self.logEntries().slice().reverse().map(function(row) {
        return [row.timestamp, row.level.toUpperCase(), row.message, row.dataLine].filter(Boolean).join(" | ");
      }).join("\n");
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        navigator.clipboard.writeText(text);
      }
    };

    self.unifiedTimeline = ko.computed(function() {
      var historyItems = self.filteredHistoryRows().map(function(row) {
        return {
          isHistoryEntry: true,
          isLogEntry: false,
          epochTs: row.timestamp,
          event: row.event,
          extensionName: row.extensionName,
          triggeredBy: row.triggeredBy,
          details: row.details,
          ruleId: row.ruleId,
          badgeClass: row.badgeClass,
          result: row.result,
          formattedDate: row.formattedDate,
          id: row.id
        };
      });
      var logItems = self.logEntries();
      var all = self.errorsOnly() ? logItems.filter(function(row) {
        return row.level === "error";
      }) : historyItems.concat(logItems);
      all.sort(function(a, b) { return b.epochTs - a.epochTs; });
      return all;
    });

    self.unifiedEmpty = ko.pureComputed(function() {
      return self.unifiedTimeline().length === 0;
    });

    self.driveConnectionReport = ko.observable(null);

    self.driveTestSteps = ko.pureComputed(function() {
      var report = self.driveConnectionReport();
      if (!report || !Array.isArray(report.steps)) {
        return [];
      }
      return report.steps.map(function(s) {
        return {
          name: s.name,
          detail: s.detail || "",
          statusBadge: s.status,
          statusOk: s.status === "ok",
          statusWarn: s.status === "warn" || s.status === "info" || s.status === "skip",
          statusFail: s.status === "fail"
        };
      });
    });

    self.testDriveConnection = function() {
      self.busy(true);
      self.error("");
      self.driveConnectionReport(null);
      ExtensityApi.testDriveConnection().then(function(result) {
        var report = result && result.report ? result.report : null;
        self.driveConnectionReport(report);
        if (_logger && report) {
          if (report.success) {
            _logger.info("Drive connection test passed.");
          } else {
            _logger.warn("Drive connection test failed.");
          }
        }
      }).catch(function(err) {
        self.error((err && err.message) || "Drive connection test failed.");
        if (_logger) {
          _logger.error("Drive connection test error.", { message: err && err.message });
        }
      }).finally(function() {
        self.busy(false);
      });
    };

    self.saveDriveWebClientId = function() {
      var clientId = (self.driveWebClientIdInput() || "").trim();
      self.busy(true);
      self.error("");
      ExtensityApi.setDriveWebClientId(clientId).then(function() {
        self.message("Web OAuth client ID saved. Drive sync will use the new value on next attempt.");
        return self.refreshDriveSyncStatus();
      }).catch(function(err) {
        self.error((err && err.message) || "Failed to save web client ID.");
      }).finally(function() {
        self.busy(false);
      });
    };
  }

  if (typeof window !== "undefined") {
    window.ExtensityDashboardInternals = {
      buildDriveStatusDetails: buildDriveStatusDetails,
      buildDriveStatusHeadline: buildDriveStatusHeadline,
      buildDriveStatusRows: buildDriveStatusRows,
      parseRuleDraft: parseRuleDraft,
      resolveDraftEnableIds: resolveDraftEnableIds
    };
  }

  _.defer(function() {
    var vm = new DashboardViewModel();
    vm.pendingDraft = parseRuleDraft(window.location.hash);
    ko.bindingProvider.instance = new ko.secureBindingsProvider({});
    ko.applyBindings(vm, document.getElementById("dashboard-page"));
    if (typeof ExtensityBrowserSync !== "undefined" && ExtensityBrowserSync.attachSyncRemoteUpdateListener) {
      ExtensityBrowserSync.attachSyncRemoteUpdateListener(function() {
        vm.refresh();
        vm.refreshDriveSyncStatus();
      });
    }
    vm.refresh();
  });
});
