document.addEventListener("DOMContentLoaded", function() {
  function numericOption(value, fallback) {
    var parsed = typeof value === "number" ? value : parseFloat(value);
    return isFinite(parsed) ? parsed : fallback;
  }

  function normalizePopupListStyle(value) {
    var allowed = ["card", "flat", "compact", "table"];
    return allowed.indexOf(value) !== -1 ? value : "card";
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

  function normalizeOptionState(options) {
    var normalized = Object.assign({}, options || {});
    normalized.popupListStyle = normalizePopupListStyle(normalized.popupListStyle);
    normalized.profileExtensionSide = normalized.profileExtensionSide === "right" ? "right" : "left";
    normalized.profileLayoutDirection = normalizeDirection(normalized.profileLayoutDirection);
    normalized.profileNameDirection = normalizeDirection(normalized.profileNameDirection);
    normalized.popupActionRowLayout = normalized.popupActionRowLayout === "vertical" ? "vertical" : "horizontal";
    normalized.popupHeaderIconSize = normalizePopupHeaderIconSize(normalized.popupHeaderIconSize);
    normalized.popupScrollbarMode = normalizePopupScrollbarMode(normalized.popupScrollbarMode);
    normalized.popupProfilePillShowIcons = normalized.popupProfilePillShowIcons === true;
    normalized.popupProfilePillTextMode = normalizePopupTextMode(normalized.popupProfilePillTextMode);
    normalized.popupTableActionPanelPosition = normalizePopupPanelPosition(normalized.popupTableActionPanelPosition);
    return normalized;
  }


  function applyThemeClasses(options) {
    document.body.classList.toggle("dark-mode", options.colorScheme === "dark");
    document.body.classList.toggle("light-mode", options.colorScheme === "light");
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

  function OptionsViewModel() {
    var self = this;
    self.loading = ko.observable(true);
    self.busy = ko.observable(false);
    self.error = ko.observable("");
    self.message = ko.observable("");
    self.needsWebStorePermission = ko.observable(false);
    self.options = new OptionsCollection();

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

    self.lastDriveSyncLabel = ko.pureComputed(function() {
      return formatTimestamp(self.options.lastDriveSync());
    });

    self.applyState = function(state) {
      var normalizedOptions = normalizeOptionState(state.options);
      self.options.apply(normalizedOptions);
      applyThemeClasses(normalizedOptions);
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
      var payload = normalizeOptionState(self.options.toJS());
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

    self.exportJson = function() {
      self.performAction(ExtensityApi.exportBackup()).then(function(payload) {
        ExtensityIO.downloadText(
          ExtensityIO.exportFilename("extensity-plus-backup", "json"),
          JSON.stringify(payload.envelope, null, 2),
          "application/json;charset=utf-8"
        );
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

    self.syncDrive = function() {
      self.performAction(ExtensityApi.syncDrive()).then(function() {
        self.message("Drive sync completed.");
      }).catch(function() {});
    };

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

  _.defer(function() {
    var vm = new OptionsViewModel();
    ko.bindingProvider.instance = new ko.secureBindingsProvider({});
    ko.applyBindings(vm, document.getElementById("options-page"));
    vm.refresh();
  });
});
