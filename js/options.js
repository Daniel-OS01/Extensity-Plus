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
      if (self.options.localProfiles && self.options.localProfiles()) {
        return "Local storage";
      }
      return "Chrome sync storage";
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
        self.message("Backup imported.");
        fadeOutMessage("save-result");
      }).catch(function(error) {
        self.error(error.message);
      }).finally(function() {
        self.busy(false);
        event.target.value = "";
      });
    };

  }

  function attachSyncStatusMethods(self) {
    self.syncStatus = ko.observable("");
    self.syncStatusReason = ko.observable("");
    self.syncStatusTimestamp = ko.observable(0);

    self.syncStatusLabel = ko.pureComputed(function() {
      var status = self.syncStatus();
      if (!status) { return ""; }
      var labels = { synced: "Synced", error: "Error", not_connected: "Not connected" };
      var reason = self.syncStatusReason();
      var base = labels[status] || status;
      return reason ? base + ": " + reason : base;
    });

    self.checkBrowserSyncStatus = function() {
      self.syncStatus("checking");
      self.syncStatusReason("");
      self.syncStatusTimestamp(0);

      if (!chrome.storage || !chrome.storage.sync || typeof chrome.storage.sync.get !== "function") {
        self.syncStatus("not_connected");
        self.syncStatusReason("Browser sync storage is unavailable in this environment.");
        self.syncStatusTimestamp(Date.now());
        return;
      }

      chrome.storage.sync.get(["profiles", "localProfiles"], function(syncData) {
        var syncError = chrome.runtime.lastError;
        if (syncError) {
          self.syncStatus("not_connected");
          self.syncStatusReason("Could not access browser sync storage: " + syncError.message);
          self.syncStatusTimestamp(Date.now());
          return;
        }

        var optionsKeys = self.options.keys || [];
        chrome.storage.sync.get(optionsKeys, function(optionsData) {
          var optionsError = chrome.runtime.lastError;
          if (optionsError) {
            self.syncStatus("error");
            self.syncStatusReason("Could not read sync settings data: " + optionsError.message);
            self.syncStatusTimestamp(Date.now());
            return;
          }

          var missingOptions = optionsKeys.filter(function(key) {
            return typeof optionsData[key] === "undefined";
          });
          var localProfilesEnabled = !!syncData.localProfiles;
          var profiles = syncData.profiles;
          var profilesInSync = profiles && typeof profiles === "object" && !Array.isArray(profiles);
          var hasMissingData = missingOptions.length > 0 || (!localProfilesEnabled && !profilesInSync);

          if (localProfilesEnabled) {
            self.syncStatus("error");
            self.syncStatusReason("Profiles are local-only because sync quota fallback is active.");
          } else if (hasMissingData) {
            self.syncStatus("error");
            if (!profilesInSync) {
              self.syncStatusReason("Profiles are missing from sync storage.");
            } else {
              self.syncStatusReason("Some settings keys are missing from sync storage: " + missingOptions.slice(0, 5).join(", "));
            }
          } else {
            self.syncStatus("synced");
            self.syncStatusReason("Settings and profiles are present in browser sync storage.");
          }
          self.syncStatusTimestamp(Date.now());
        });
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
    self.needsWebStorePermission = ko.observable(false);
    self.options = new OptionsCollection();
    self.activeProfileOptions = createObservableArray([{ label: "None", value: null }]);

    attachPermissionMethods(self);
    attachDataMethods(self);
    attachPresetMethods(self);
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
    vm.refresh();
  });
});
