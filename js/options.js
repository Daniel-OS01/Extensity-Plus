document.addEventListener("DOMContentLoaded", function() {
  function createObservableArray(initialValue) {
    if (ko.observableArray) {
      return ko.observableArray(initialValue || []);
    }

    var obs = ko.observable((initialValue || []).slice());
    obs.push = function(item) {
      var nextValue = obs().slice();
      nextValue.push(item);
      obs(nextValue);
    };
    return obs;
  }

  function numericOption(value, fallback) {
    var parsed = typeof value === "number" ? value : parseFloat(value);
    return isFinite(parsed) ? parsed : fallback;
  }

  function normalizeEnum(value, allowed, fallback) {
    return allowed.indexOf(value) !== -1 ? value : fallback;
  }

  function normalizePopupListStyle(value) {
    return normalizeEnum(value, ["card", "flat", "compact", "table"], "card");
  }

  function normalizeDirection(value) {
    return value === "rtl" ? "rtl" : "ltr";
  }

  function normalizePopupTextMode(value) {
    if (value === "compact" || value === "icons_only") {
      return value;
    }
    return "full";
  }

  function normalizePopupPanelPosition(value) {
    return value === "below_name" ? "below_name" : "side";
  }

  function normalizePopupHeaderIconSize(value) {
    return value === "compact" ? "compact" : "normal";
  }

  function normalizePopupScrollbarMode(value) {
    if (value === "visible" || value === "compact") {
      return value;
    }
    return "invisible";
  }

  function normalizeActiveProfile(value, allowedProfiles) {
    if (value == null || value === "") {
      return null;
    }

    var normalized = String(value).trim();
    if (!normalized) {
      return null;
    }

    if (Array.isArray(allowedProfiles) && allowedProfiles.indexOf(normalized) === -1) {
      return null;
    }

    return normalized;
  }

  function profileOptionLabel(name) {
    var reserved = {
      "__always_on": "Always On",
      "__base": "Base",
      "__favorites": "Favorites"
    };

    return reserved[name] || String(name || "");
  }

  function buildActiveProfileOptions(profileItems) {
    var items = Array.isArray(profileItems) ? profileItems : [];
    return [{ label: "None", value: null }].concat(items.filter(function(profile) {
      return profile && profile.name;
    }).map(function(profile) {
      return {
        label: profileOptionLabel(profile.name),
        value: profile.name
      };
    }));
  }

  function normalizeOptionState(options, allowedProfiles) {
    var normalized = Object.assign({}, options || {});
    normalized.activeProfile = normalizeActiveProfile(normalized.activeProfile, allowedProfiles);
    normalized.colorScheme = normalizeEnum(normalized.colorScheme, ["auto", "light", "dark"], "auto");
    normalized.contrastMode = normalizeEnum(normalized.contrastMode, ["normal", "high"], "normal");
    normalized.profileDisplay = normalizeEnum(normalized.profileDisplay, ["landscape", "portrait"], "landscape");
    normalized.popupListStyle = normalizePopupListStyle(normalized.popupListStyle);
    normalized.sortMode = normalizeEnum(normalized.sortMode, ["alpha", "frequency", "recent"], "recent");
    normalized.viewMode = normalizeEnum(normalized.viewMode, ["list", "grid"], "list");
    normalized.profileExtensionSide = normalized.profileExtensionSide === "right" ? "right" : "left";
    normalized.profileLayoutDirection = normalizeDirection(normalized.profileLayoutDirection);
    normalized.profileNameDirection = normalizeDirection(normalized.profileNameDirection);
    normalized.popupActionRowLayout = normalized.popupActionRowLayout === "vertical" ? "vertical" : "horizontal";
    normalized.popupHeaderIconSize = normalizePopupHeaderIconSize(normalized.popupHeaderIconSize);
    normalized.popupScrollbarMode = normalizePopupScrollbarMode(normalized.popupScrollbarMode);
    normalized.localProfiles = normalized.localProfiles === true;
    normalized.popupProfilePillShowIcons = normalized.popupProfilePillShowIcons === true;
    normalized.popupProfilePillTextMode = normalizePopupTextMode(normalized.popupProfilePillTextMode);
    normalized.popupTableActionPanelPosition = normalizePopupPanelPosition(normalized.popupTableActionPanelPosition);
    normalized.pinMethod = normalizeEnum(normalized.pinMethod, ["auto", "manual"], "auto");
    normalized.syncMode = normalizeEnum(normalized.syncMode, ["full", "smart", "minimal"], "smart");
    normalized.syncProfilesPartial = normalized.syncProfilesPartial === true;
    normalized.driveAuthStatus = normalizeEnum(
      normalized.driveAuthStatus,
      ["unknown", "authorized", "needs_interactive_sign_in", "error"],
      "unknown"
    );
    if (typeof ExtensityDriveSync !== "undefined" && typeof ExtensityDriveSync.normalizeCategoryFlags === "function") {
      normalized.driveSyncCategories = ExtensityDriveSync.normalizeCategoryFlags(normalized.driveSyncCategories);
    }
    normalized.driveAutoSyncIntervalMinutes = Math.max(
      15,
      parseInt(normalized.driveAutoSyncIntervalMinutes, 10) || 60
    );
    return normalized;
  }


  function applyCssVars(options) {
    var itemPadding = numericOption(options.itemPaddingPx, 10);
    var itemVerticalSpace = numericOption(options.itemVerticalSpacePx, 0);
    var style = document.documentElement.style;
    style.setProperty("--font-size", numericOption(options.fontSizePx, 12) + "px");
    style.setProperty("--item-padding-v", Math.max(itemPadding, 0) + "px");
    style.setProperty("--item-padding-v-adjust", Math.min(itemPadding, 0) + "px");
    style.setProperty("--item-padding-x", numericOption(options.itemPaddingXPx, 12) + "px");
    style.setProperty("--item-name-gap", numericOption(options.itemNameGapPx, 10) + "px");
    style.setProperty("--item-spacing", numericOption(options.itemSpacingPx, 8) + "px");
    style.setProperty("--item-v-space", Math.max(itemVerticalSpace, 0) + "px");
    style.setProperty("--item-v-space-adjust", Math.min(itemVerticalSpace, 0) + "px");
    style.setProperty("--extension-icon-size", numericOption(options.extensionIconSizePx, 16) + "px");
    style.setProperty("--popup-main-padding-x", numericOption(options.popupMainPaddingPx, 0) + "px");
    style.setProperty("--popup-width", numericOption(options.popupWidthPx, 380) + "px");
    if (options.accentColor) { style.setProperty("--accent", options.accentColor); }
    if (options.popupBgColor) { document.body.style.background = options.popupBgColor; }
    if (options.fontFamily) { document.body.style.fontFamily = options.fontFamily; }
  }

  function formatTimestamp(timestamp) {
    if (!timestamp) {
      return "Not synced yet";
    }
    return new Date(timestamp).toLocaleString();
  }


  function attachPermissionMethods(self) {
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
  }

  function attachDataMethods(self) {
    function downloadBackup(payload, filenamePrefix) {
      ExtensityIO.downloadText(
        ExtensityIO.exportFilename(filenamePrefix, "json"),
        JSON.stringify(payload.envelope, null, 2),
        "application/json;charset=utf-8"
      );
    }

    self.lastDriveSyncLabel = ko.pureComputed(function() {
      return formatTimestamp(self.options.lastDriveSync());
    });
    self.localProfilesLabel = ko.pureComputed(function() {
      var mode = self.options.syncMode ? self.options.syncMode() : "smart";
      if (self.options.syncProfilesPartial && self.options.syncProfilesPartial()) {
        if (mode === "minimal") {
          return "Minimal sync (memberships local; options/metadata in sync)";
        }
        return "Smart sync (reserved profiles in sync; custom memberships may be local)";
      }
      if (self.options.localProfiles && self.options.localProfiles()) {
        return "Local storage (quota fallback)";
      }
      return "Chrome sync storage";
    });
    self.syncModeDescription = ko.pureComputed(function() {
      var mode = self.options.syncMode ? self.options.syncMode() : "smart";
      if (mode === "full") {
        return "Sync all options and full profile memberships when quota allows.";
      }
      if (mode === "minimal") {
        return "Sync essential options and profile metadata only; memberships stay on this device.";
      }
      return "Sync all options plus reserved profiles; large custom profiles stay local when needed.";
    });
    self.exportJson = function() {
      self.performAction(ExtensityApi.exportBackup()).then(function(payload) {
        downloadBackup(payload, "extensity-plus-backup");
      });
    };

    self.exportProfilesJson = function() {
      self.performAction(ExtensityApi.exportBackup("profiles")).then(function(payload) {
        downloadBackup(payload, "extensity-plus-profiles");
      });
    };

    self.exportSettingsJson = function() {
      self.performAction(ExtensityApi.exportBackup("settings")).then(function(payload) {
        downloadBackup(payload, "extensity-plus-settings");
      });
    };

    self.exportProfilesSettingsJson = function() {
      self.performAction(ExtensityApi.exportBackup("profiles_settings")).then(function(payload) {
        downloadBackup(payload, "extensity-plus-profiles-settings");
      });
    };

    self.exportCsv = function() {
      self.performAction(ExtensityApi.getState()).then(function(payload) {
        var csv = ExtensityImportExport.buildExtensionsCsv(payload.state.extensions);
        ExtensityIO.downloadText(ExtensityIO.exportFilename("extensity-extensions", "csv"), csv, "text/csv;charset=utf-8");
      });
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
        fadeOutMessage("save-result");
      }).catch(function(error) {
        self.error(error.message);
      }).finally(function() {
        self.busy(false);
        event.target.value = "";
      });
    };

  }

  function buildDriveCategoryChecked(self) {
    var bindings = {};
    if (typeof ExtensityDriveSync === "undefined" || !Array.isArray(ExtensityDriveSync.CATEGORY_IDS)) {
      return bindings;
    }
    ExtensityDriveSync.CATEGORY_IDS.forEach(function(categoryId) {
      bindings[categoryId] = ko.pureComputed({
        read: function() {
          var categories = self.options.driveSyncCategories() || {};
          return !!categories[categoryId];
        },
        write: function(value) {
          var categories = Object.assign({}, self.options.driveSyncCategories() || {});
          categories[categoryId] = !!value;
          self.options.driveSyncCategories(categories);
        }
      });
    });
    return bindings;
  }

  function attachDriveSyncMethods(self) {
    self.driveCategoryChecked = buildDriveCategoryChecked(self);
    self.driveConfiguredLabel = ko.observable("");
    self.driveEnvironmentLabel = ko.observable("");
    self.driveExtensionIdLabel = ko.observable("");
    self.driveAuthProviderLabel = ko.observable("");
    self.driveConflictVisible = ko.pureComputed(function() {
      return !!self.options.drivePendingConflict();
    });
    self.driveConflictSummary = ko.pureComputed(function() {
      var conflict = self.options.drivePendingConflict();
      if (!conflict || !Array.isArray(conflict.categories)) {
        return "";
      }
      var labels = conflict.categories.map(function(entry) {
        return entry.label || entry.categoryId;
      });
      return "Sync conflict in: " + labels.join(", ") + ". Choose which copy to keep.";
    });
    self.lastDriveSyncErrorLabel = ko.pureComputed(function() {
      var error = self.options.lastDriveSyncError();
      if (!error) {
        return "";
      }
      if (typeof error === "string") {
        return error;
      }
      return error.message || "";
    });
    self.lastDriveSyncErrorVisible = ko.pureComputed(function() {
      return !!self.lastDriveSyncErrorLabel();
    });

    function describeDriveSyncStatus(status) {
      if (!status) {
        return "Google Drive sync status is unavailable.";
      }
      if (!status.configured) {
        return "Drive sync is not configured for this build.";
      }
      if (status.driveAuthStatus === "needs_interactive_sign_in") {
        return "Drive sync needs sign-in. Click Sync now once to authorize background auto-sync.";
      }
      if (status.driveAuthStatus === "error") {
        return "Drive sync reported an error. Check the last error below.";
      }
      if (!status.driveSync) {
        return "Drive sync is configured but disabled.";
      }
      return "Drive sync is ready.";
    }

    function describeDriveEnvironment(status) {
      var installType = status && status.installType ? status.installType : "unknown";
      if (installType === "development") {
        return "Environment: Local / development build";
      }
      if (installType === "normal") {
        return "Environment: Store / normal install";
      }
      return "Environment: Unknown";
    }

    function describeDriveExtensionId(status) {
      var extensionId = status && status.extensionId ? status.extensionId : "";
      return extensionId ? "Extension ID: " + extensionId : "Extension ID unavailable";
    }

    function describeDriveAuthProvider(status) {
      if (!status) {
        return "Auth: Unknown";
      }
      if (status.webAuthPreferred) {
        return "Auth: Brave web fallback preferred";
      }
      if (status.webFallbackConfigured) {
        return "Auth: Chrome extension OAuth with Brave web fallback configured";
      }
      return "Auth: Chrome extension OAuth";
    }

    function refreshDriveConfiguredLabel() {
      if (typeof ExtensityApi === "undefined" || typeof ExtensityApi.getDriveSyncStatus !== "function") {
        self.driveConfiguredLabel("Google Drive sync status unavailable.");
        self.driveEnvironmentLabel("Environment: Unknown");
        self.driveExtensionIdLabel("Extension ID unavailable");
        self.driveAuthProviderLabel("Auth: Unknown");
        return Promise.resolve();
      }

      return ExtensityApi.getDriveSyncStatus().then(function(payload) {
        var status = payload && payload.status ? payload.status : null;
        self.driveConfiguredLabel(describeDriveSyncStatus(status));
        self.driveEnvironmentLabel(describeDriveEnvironment(status));
        self.driveExtensionIdLabel(describeDriveExtensionId(status));
        self.driveAuthProviderLabel(describeDriveAuthProvider(status));
      }).catch(function() {
        self.driveConfiguredLabel("Google Drive sync status unavailable.");
        self.driveEnvironmentLabel("Environment: Unknown");
        self.driveExtensionIdLabel("Extension ID unavailable");
        self.driveAuthProviderLabel("Auth: Unknown");
      });
    }

    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage && typeof chrome.runtime.onMessage.addListener === "function") {
      chrome.runtime.onMessage.addListener(function(message) {
        if (message && message.type === "SYNC_REMOTE_UPDATE") {
          refreshDriveConfiguredLabel();
        }
      });
    }

    function handleDriveSyncResult(payload) {
      var result = payload && payload.result ? payload.result : {};
      if (result.status === "conflict") {
        self.message(result.message || "Drive sync needs your input.");
        return;
      }
      if (result.status === "cancelled") {
        self.message("Drive sync cancelled.");
        return;
      }
      self.message("Drive sync completed (" + (result.status || "ok") + ").");
    }

    function runDriveSyncRequest(request) {
      return self.save().then(function() {
        return self.performAction(request);
      }).then(function(payload) {
        handleDriveSyncResult(payload);
        return payload;
      });
    }

    self.driveSyncNow = function() {
      return runDriveSyncRequest(ExtensityApi.syncDrive({ direction: "sync" }));
    };

    self.drivePush = function() {
      return runDriveSyncRequest(ExtensityApi.syncDrive({ direction: "push" }));
    };

    self.drivePull = function() {
      return runDriveSyncRequest(ExtensityApi.syncDrive({ direction: "pull" }));
    };

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
          statusBadge: s.status
        };
      });
    });

    self.testDriveConnection = function() {
      self.busy(true);
      self.error("");
      self.driveConnectionReport(null);
      ExtensityApi.testDriveConnection().then(function(result) {
        self.driveConnectionReport(result && result.report ? result.report : null);
      }).catch(function(err) {
        self.error((err && err.message) || "Drive connection test failed.");
      }).finally(function() {
        self.busy(false);
      });
    };

    self.driveResolveKeepLocal = function() {
      return runDriveSyncRequest(ExtensityApi.resolveDriveConflict("keep_local"));
    };

    self.driveResolveKeepRemote = function() {
      return runDriveSyncRequest(ExtensityApi.resolveDriveConflict("keep_remote"));
    };

    self.driveResolveCancel = function() {
      return runDriveSyncRequest(ExtensityApi.resolveDriveConflict("cancel"));
    };

    self.refreshDriveSyncStatus = refreshDriveConfiguredLabel;
    refreshDriveConfiguredLabel();
  }

  function attachSyncStatusMethods(self) {
    self.syncStatus = ko.observable("");
    self.syncStatusReason = ko.observable("");
    self.syncStatusDetails = ko.observable("");
    self.syncStatusTimestamp = ko.observable(0);

    self.syncStatusLabel = ko.pureComputed(function() {
      var status = self.syncStatus();
      if (!status) { return ""; }
      var labels = {
        synced: "Synced",
        synced_partial: "Synced (partial)",
        error: "Error",
        not_connected: "Not connected"
      };
      var reason = self.syncStatusReason();
      var base = labels[status] || status;
      return reason ? base + ": " + reason : base;
    });

    self.checkBrowserSyncStatus = function() {
      self.syncStatus("checking");
      self.syncStatusReason("");
      self.syncStatusTimestamp(0);

      ExtensityBrowserSync.checkBrowserSyncHealth(self.options.keys || []).then(function(result) {
        self.syncStatus(result.status);
        self.syncStatusReason(result.reason);
        self.syncStatusDetails(result.detailsSummary || "");
        self.syncStatusTimestamp(Date.now());
      });
    };
  }

  function attachPresetMethods(self) {
    self.applyPresetNone = function() {
      self.options.itemPaddingPx(0);
      self.options.itemPaddingXPx(0);
      self.options.itemNameGapPx(0);
      self.options.itemSpacingPx(0);
      self.options.popupListStyle("table");
      applyCssVars(self.options.toJS());
      self.save();
    };

    self.applyPresetCompact = function() {
      self.options.fontSizePx(11);
      self.options.itemPaddingPx(6);
      self.options.itemPaddingXPx(10);
      self.options.itemNameGapPx(8);
      self.options.itemSpacingPx(4);
      self.save();
    };

    self.applyPresetDefault = function() {
      self.options.fontSizePx(12);
      self.options.itemPaddingPx(10);
      self.options.itemPaddingXPx(12);
      self.options.itemNameGapPx(10);
      self.options.itemSpacingPx(8);
      self.save();
    };

    self.applyPresetComfortable = function() {
      self.options.fontSizePx(13);
      self.options.itemPaddingPx(14);
      self.options.itemPaddingXPx(14);
      self.options.itemNameGapPx(12);
      self.options.itemSpacingPx(12);
      self.save();
    };

    self.resetAccentColor = function() {
      self.options.accentColor("");
      applyCssVars(self.options.toJS());
      self.save();
    };

    self.resetPopupBgColor = function() {
      self.options.popupBgColor("");
      document.body.style.background = "";
      self.save();
    };
  }

  function OptionsViewModel() {
    var self = this;
    self.loading = ko.observable(true);
    self.busy = ko.observable(false);
    self.error = ko.observable("");
    self.message = ko.observable("");
    self.version = ko.observable("");
    self.needsWebStorePermission = ko.observable(false);
    self.options = new OptionsCollection();
    self.activeProfileOptions = createObservableArray([{ label: "None", value: null }]);

    attachPermissionMethods(self);
    attachDataMethods(self);
    attachPresetMethods(self);
    attachDriveSyncMethods(self);
    attachSyncStatusMethods(self);

    self.applyState = function(state) {
      var profileItems = state && state.profiles && Array.isArray(state.profiles.items)
        ? state.profiles.items
        : [];
      var allowedProfiles = profileItems.length
        ? profileItems.map(function(profile) { return profile.name; })
        : null;
      var normalizedOptions = normalizeOptionState(state.options, allowedProfiles);
      self.activeProfileOptions(buildActiveProfileOptions(profileItems));
      self.options.apply(normalizedOptions);
      ExtensityUtils.applyThemeClasses(normalizedOptions);
      applyCssVars(normalizedOptions);
      if (window.ExtensityTooltips && window.ExtensityTooltips.applyAutoTooltips) {
        window.ExtensityTooltips.applyAutoTooltips(document.body);
      }
      if (typeof self.refreshDriveSyncStatus === "function") {
        self.refreshDriveSyncStatus();
      }
      self.version((state && state.metadata && state.metadata.version) || "");
      self.loading(false);
      self.error("");
      self.checkWebStorePermission();
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
      return self.performAction(ExtensityApi.getState());
    };

    self.save = function() {
      var allowedProfiles = self.activeProfileOptions().map(function(option) {
        return option.value;
      }).filter(Boolean);
      var payload = normalizeOptionState(self.options.toJS(), allowedProfiles);
      return self.performAction(ExtensityApi.saveOptions(payload)).then(function() {
        self.message("Saved!");
        fadeOutMessage("save-result");
      });
    };

    self.close = function() {
      window.close();
    };

    self.openDashboard = function() {
      self.performAction(ExtensityApi.openDashboard());
    };

    self.openShortcutSettings = function() {
      chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
    };

  }

  _.defer(function() {
    var vm = new OptionsViewModel();
    ko.bindingProvider.instance = new ko.secureBindingsProvider({});
    ko.applyBindings(vm, document.getElementById("options-page"));
    if (typeof ExtensityBrowserSync !== "undefined" && ExtensityBrowserSync.attachSyncRemoteUpdateListener) {
      ExtensityBrowserSync.attachSyncRemoteUpdateListener(function() {
        vm.refresh();
      });
    }
    vm.refresh();
  });
});
