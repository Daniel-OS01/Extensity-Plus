(function(root) {
  function pruneText(value, maxLength) {
    var text = value == null ? "" : String(value);
    if (text.length <= maxLength) {
      return text;
    }
    return text.slice(0, Math.max(0, maxLength - 1)) + "…";
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

  function openTab(url) {
    return chromeCall(chrome.tabs, "create", [{ active: true, url: url }]);
  }

  function buildManageExtensionUrl(extensionId) {
    return "chrome://extensions/?id=" + encodeURIComponent(extensionId);
  }

  function buildPermissionsPageUrl(extensionId) {
    return "chrome://settings/content/siteDetails?site=chrome-extension://" + encodeURIComponent(extensionId);
  }

  function copyText(value) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(value);
    }

    return new Promise(function(resolve, reject) {
      var input = document.createElement("textarea");
      input.value = value;
      input.setAttribute("readonly", "readonly");
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      try {
        if (!document.execCommand("copy")) {
          throw new Error("Copy command failed.");
        }
        resolve();
      } catch (error) {
        reject(error);
      } finally {
        document.body.removeChild(input);
      }
    });
  }

  ko.extenders.countable = function(target) {
    target.count = ko.computed(function() {
      return target().length;
    });

    target.any = ko.computed(function() {
      return target().length > 0;
    });

    target.many = ko.computed(function() {
      return target().length > 1;
    });

    target.none = ko.computed(function() {
      return target().length === 0;
    });
  };

  function fadeOutMessage(id) {
    var element = document.getElementById(id);
    if (!element) {
      return;
    }
    element.className = "visible";
    _.delay(function() {
      element.className = "fadeout";
    }, 2000);
  }

  function chromeMessage(payload) {
    return new Promise(function(resolve, reject) {
      chrome.runtime.sendMessage(payload, function(response) {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (!response || !response.ok) {
          var err = new Error(response && response.error ? response.error : "Unexpected extension response.");
          err.code = (response && response.code) || null;
          reject(err);
          return;
        }

        resolve(response.payload);
      });
    });
  }
  function exportFilename(prefix, ext) {
    var d = new Date();
    var dd = String(d.getDate()).padStart(2, "0");
    var mm = String(d.getMonth() + 1).padStart(2, "0");
    var yyyy = d.getFullYear();
    return prefix + "-" + yyyy + "-" + mm + "-" + dd + "." + ext;
  }


  function downloadText(filename, content, mimeType) {
    var blob = new Blob([content], { type: mimeType || "text/plain;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(function() {
      URL.revokeObjectURL(url);
    }, 0);
  }

  /**
   * Reads a file as text.
   * @param {File|Blob} file - The file to read.
   * @return {Promise<string>} The file contents.
   */
  function readFileAsText(file) {
    return new Promise(function(resolve, reject) {
      var reader = new FileReader();
      reader.onload = function() {
        resolve(reader.result);
      };
      reader.onerror = function() {
        reject(new Error("Failed to read file."));
      };
      reader.readAsText(file);
    });
  }

  /**
   * Manages dismissed item identifiers and persists dismissal changes.
   *
   * Loads previously dismissed identifiers on construction and exposes observable
   * state with methods for adding and checking dismissals.
   */
  function DismissalsCollection() {
    var self = this;
    self.dismissals = ko.observableArray([]);

    self.dismiss = function(id) {
      if (self.dismissals.indexOf(id) !== -1) {
        return;
      }
      self.dismissals.push(id);
      if (root.ExtensityStorage && typeof root.ExtensityStorage.appendDismissal === "function") {
        root.ExtensityStorage.appendDismissal(id).catch(function() {});
        return;
      }
      if (chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ dismissals: self.dismissals() });
      }
    };

    self.dismissed = function(id) {
      return self.dismissals.indexOf(id) !== -1;
    };

    if (root.ExtensityStorage && typeof root.ExtensityStorage.loadDismissals === "function") {
      root.ExtensityStorage.loadDismissals().then(function(items) {
        self.dismissals(items || []);
      }).catch(function() {
        self.dismissals([]);
      });
      return;
    }

    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.get({ dismissals: [] }, function(result) {
        self.dismissals(result.dismissals || []);
      });
    }
  }

  /**
   * Creates an observable collection of synchronized options.
   * @param {Object} initialState - Initial option values and any pending Drive conflict state.
   */
  function OptionsCollection(initialState) {
    var self = this;
    var defaults = root.ExtensityStorage.getSyncDefaults();
    var state = root.ExtensityStorage.mergeDefaults(defaults, initialState || {});
    self.keys = Object.keys(defaults);

    self.keys.forEach(function(key) {
      self[key] = ko.observable(state[key]);
    });
    self.drivePendingConflict = ko.observable(state.drivePendingConflict || null);

    self.apply = function(nextState) {
      var merged = root.ExtensityStorage.mergeDefaults(defaults, nextState || {});
      self.keys.forEach(function(key) {
        self[key](merged[key]);
      });
      self.drivePendingConflict(nextState && nextState.drivePendingConflict || null);
    };

    self.toJS = function() {
      return self.keys.reduce(function(result, key) {
        result[key] = self[key]();
        return result;
      }, {});
    };

    self.save = function() {
      return ExtensityApi.saveOptions(self.toJS());
    };
  }

  var reservedNames = {
    "__always_on": "Always On",
    "__base": "Base",
    "__favorites": "Favorites"
  };

  var reservedIcons = {
    "__always_on": "fa-lightbulb-o",
    "__base": "fa-home",
    "__default": "fa-user-circle-o",
    "__favorites": "fa-star"
  };

  function clampInteger(value, fallback, min, max) {
    var parsed = parseInt(value, 10);
    if (!isFinite(parsed)) {
      parsed = fallback;
    }
    return Math.min(max, Math.max(min, parsed));
  }

  function firstDescriptionLine(value) {
    return String(value || "")
      .split(/\r?\n/)
      .map(function(line) {
        return line.trim();
      })
      .filter(Boolean)[0] || "";
  }

  function isChromeWebStoreUrl(value) {
    return /^https:\/\/(?:chromewebstore\.google\.com|chrome\.google\.com\/webstore)\//i.test(String(value || ""));
  }

  function defaultCategoryForInstallType(installType) {
    return installType === "development" ? "Developer" : "";
  }

  function profileDisplayName(name) {
    return reservedNames[name] || (name == null ? "" : String(name));
  }

  function compactProfileBadgeLabel(displayName, singleWordChars) {
    var words = String(displayName || "").trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      return "";
    }

    if (words.length === 1) {
      return words[0].slice(0, clampInteger(singleWordChars, 4, 1, 8));
    }

    return words.map(function(word) {
      return word.charAt(0).toUpperCase();
    }).join("");
  }

  function formatPopupProfileBadgeLabel(profileName, mode, singleWordChars) {
    var displayName = profileDisplayName(profileName);
    if (mode === "icons_only") {
      return "";
    }
    if (mode === "compact") {
      return compactProfileBadgeLabel(displayName, singleWordChars);
    }

    if (reservedNames[profileName]) {
      return reservedNames[profileName];
    }

    return pruneText(displayName, 30);
  }

  var PROFILE_COLORS = [
    "#E74C3C","#E67E22","#F1C40F","#2ECC71","#1ABC9C",
    "#3498DB","#9B59B6","#E91E63","#00BCD4","#607D8B"
  ];

  var PROFILE_ICONS = [
    "fa-rocket", "fa-bolt", "fa-star", "fa-fire", "fa-lightbulb-o",
    "fa-paint-brush", "fa-globe", "fa-shield", "fa-cogs", "fa-flask",
    "fa-leaf", "fa-diamond", "fa-music", "fa-gamepad", "fa-bookmark",
    "fa-cloud", "fa-paper-plane-o", "fa-puzzle-piece", "fa-code", "fa-graduation-cap",
    "fa-comments", "fa-comment-o", "fa-envelope-o", "fa-phone", "fa-microphone",
    "fa-commenting-o", "fa-whatsapp",
    "fa-folder-o", "fa-tags", "fa-files-o", "fa-clipboard", "fa-paperclip", "fa-cut", "fa-scissors",
    "fa-download", "fa-cloud-download",
    "fa-terminal", "fa-keyboard-o", "fa-magic",
    "fa-search", "fa-book", "fa-university", "fa-binoculars",
    "fa-shopping-cart", "fa-shopping-bag", "fa-credit-card", "fa-money",
    "fa-briefcase", "fa-calendar", "fa-camera", "fa-car", "fa-coffee", "fa-heart",
    "fa-map-marker", "fa-newspaper-o", "fa-pencil", "fa-plane", "fa-wrench",
    "fa-lock", "fa-bell", "fa-database", "fa-desktop", "fa-film", "fa-gift",
    "fa-users", "fa-video-camera", "fa-wifi", "fa-trophy", "fa-medkit", "fa-picture-o"
  ];

  function randomProfileColor() {
    return PROFILE_COLORS[Math.floor(Math.random() * PROFILE_COLORS.length)];
  }

  function randomProfileIcon() {
    return PROFILE_ICONS[Math.floor(Math.random() * PROFILE_ICONS.length)];
  }

  function hashProfileName(name) {
    var h = 5381;
    var str = String(name || "");
    for (var i = 0; i < str.length; i++) {
      h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    }
    return Math.abs(h);
  }

  function deterministicProfileColor(name) {
    return PROFILE_COLORS[hashProfileName(name) % PROFILE_COLORS.length];
  }

  function deterministicProfileIcon(name) {
    return PROFILE_ICONS[(hashProfileName(name) >> 3) % PROFILE_ICONS.length];
  }

  function ProfileModel(name, items, meta) {
    var self = this;
    var m = meta || {};
    self.name = ko.observable(name);
    self.items = ko.observableArray(root.ExtensityStorage.uniqueArray(items || []));
    self.selected = ko.observable(false);
    self.activate = function() { return false; };
    self.requestRemove = function() { return false; };

    self.reserved = ko.pureComputed(function() {
      return self.name().indexOf("__") === 0;
    });

    self.listVisible = ko.pureComputed(function() {
      return !self.reserved();
    });

    self.hasItems = ko.pureComputed(function() {
      return self.items().length > 0;
    });

    self.itemCount = ko.pureComputed(function() {
      return self.items().length;
    });

    self.isActive = ko.observable(false);

    self.short_name = ko.pureComputed(function() {
      return reservedNames[self.name()] || pruneText(self.name(), 30);
    });

    self.popupLabel = ko.observable(self.short_name());

    self.userIcon = ko.observable(m.icon || m.emoji || deterministicProfileIcon(name));

    self.icon = ko.pureComputed(function() {
      return reservedIcons[self.name()] || self.userIcon();
    });

    self.containsId = function(extensionId) {
      return self.items().indexOf(extensionId) !== -1;
    };

    self.color = ko.observable(m.color || deterministicProfileColor(name));

    self.rename = function(nextName) {
      var trimmed = (nextName || "").trim();
      if (!trimmed) {
        return;
      }
      self.name(trimmed);
    };
  }

  function ProfileCollectionModel(initialState) {
    var self = this;
    self.items = ko.observableArray([]).extend({ countable: null });
    self.localProfiles = ko.observable(false);
    self.applyState(initialState || { items: [], localProfiles: false });

    self.add = function(name, items) {
      var profile = new ProfileModel(name, items || [], {
        color: randomProfileColor(),
        icon: randomProfileIcon()
      });
      self.items.push(profile);
      return profile;
    };

    self.find = function(name) {
      return _(self.items()).find(function(profile) {
        return profile.name() === name;
      });
    };

    self.exists = function(name) {
      return !!self.find(name);
    };

    self.remove = function(profile) {
      self.items.remove(profile);
    };

    self.always_on = function() {
      return self.find("__always_on");
    };

    self.base = function() {
      return self.find("__base");
    };

    self.favorites = function() {
      return self.find("__favorites");
    };

    self.toMap = function() {
      return self.items().reduce(function(result, profile) {
        if (!profile.name()) {
          return result;
        }
        result[profile.name()] = root.ExtensityStorage.uniqueArray(profile.items());
        return result;
      }, {});
    };

    self.toMeta = function() {
      return self.items().reduce(function(result, profile) {
        if (profile.reserved()) {
          return result;
        }
        result[profile.name()] = { color: profile.color(), icon: profile.userIcon() };
        return result;
      }, {});
    };
  }

  ProfileCollectionModel.prototype.applyState = function(state) {
    var self = this;
    self.localProfiles(state && state.localProfiles ? true : false);
    self.items((state && state.items ? state.items : []).map(function(profile) {
      return new ProfileModel(profile.name, profile.items, { color: profile.color, icon: profile.icon });
    }));
  };

  function ExtensionModel(data) {
    var self = this;
    self.id = ko.observable("");
    self.alias = ko.observable("");
    self.name = ko.observable("");
    self.version = ko.observable("");
    self.description = ko.observable("");
    self.descriptionLine = ko.observable("");
    self.category = ko.observable("");
    self.type = ko.observable("extension");
    self.mayDisable = ko.observable(true);
    self.isApp = ko.observable(false);
    self.icon = ko.observable("");
    self.status = ko.observable(false);
    self.optionsUrl = ko.observable("");
    self.installType = ko.observable("");
    self.usageCount = ko.observable(0);
    self.lastUsed = ko.observable(0);
    self.installedAt = ko.observable(0);
    self.groupIds = ko.observableArray([]);
    self.groupBadges = ko.observableArray([]);
    self.alwaysOn = ko.observable(false);
    self.favorite = ko.observable(false);
    self.toolbarPinned = ko.observable(false);
    self.homepageUrl = ko.observable("");
    self.storeUrl = ko.observable("");
    self.metadataFetchedAt = ko.observable(0);
    self.metadataLoading = ko.observable(false);
    self.metadataSource = ko.observable("");
    self.profileBadges = ko.observableArray([]);
    self.selectedProfileId = ko.observable("");

    self.disabled = ko.pureComputed(function() {
      return !self.status();
    });

    self.is_development = ko.pureComputed(function() {
      return self.installType() === "development";
    });

    self.displayName = ko.pureComputed(function() {
      return self.alias() || self.name();
    });

    self.short_name = ko.pureComputed(function() {
      return pruneText(self.displayName(), 40);
    });

    self.searchText = ko.pureComputed(function() {
      return [
        self.alias(),
        self.name(),
        self.description()
      ].join(" ").toLowerCase();
    });

    self.profileSummary = ko.pureComputed(function() {
      var pieces = [];
      if (self.descriptionLine()) {
        pieces.push(self.descriptionLine());
      }
      if (self.category()) {
        pieces.push(self.category());
      }
      return pieces.join(" — ");
    });

    self.copyLinkUrl = ko.pureComputed(function() {
      return self.homepageUrl() || self.storeUrl() || "";
    });

    self.storeLinkAvailable = ko.pureComputed(function() {
      return !!self.storeUrl();
    });

    self.copyLinkAvailable = ko.pureComputed(function() {
      return !!self.copyLinkUrl();
    });

    self.canRemove = ko.pureComputed(function() {
      return self.installType() !== "admin";
    });

    self.toggleLabel = ko.pureComputed(function() {
      return self.status() ? "Disable" : "Enable";
    });

    self.toggleIconClass = ko.pureComputed(function() {
      return self.status() ? "fa-toggle-on" : "fa-toggle-off";
    });

    self.versionCategoryLine = ko.pureComputed(function() {
      var parts = [];
      if (self.version()) { parts.push(self.version()); }
      if (self.category()) { parts.push(self.category()); }
      return parts.join(" \u2014 ");
    });

    self.applySnapshot(data || {});
  }

  ExtensionModel.prototype.applySnapshot = function(data) {
    this.alias(data.alias || "");
    this.alwaysOn(!!data.alwaysOn);
    this.description(data.description || "");
    this.favorite(!!data.favorite);
    this.groupIds(data.groupIds || []);
    this.groupBadges(data.groupBadges || []);
    this.homepageUrl(data.homepageUrl || "");
    this.icon(data.icon || "");
    this.id(data.id || "");
    this.installType(data.installType || "");
    this.installedAt(data.installedAt || 0);
    this.isApp(!!data.isApp);
    this.lastUsed(data.lastUsed || 0);
    this.mayDisable(typeof data.mayDisable === "boolean" ? data.mayDisable : true);
    this.name(data.name || "");
    this.optionsUrl(data.optionsUrl || "");
    this.status(!!data.enabled);
    this.type(data.type || "extension");
    this.usageCount(data.usageCount || 0);
    this.version(data.version || "");
    this.descriptionLine(firstDescriptionLine(data.descriptionLine || data.description || ""));
    this.category(
      typeof data.category === "string"
        ? data.category
        : defaultCategoryForInstallType(data.installType)
    );
    this.storeUrl(
      data.storeUrl || (isChromeWebStoreUrl(data.homepageUrl) ? data.homepageUrl : "")
    );
    this.toolbarPinned(!!data.toolbarPinned);
    this.metadataFetchedAt(data.metadataFetchedAt || 0);
    this.metadataLoading(false);
    this.metadataSource(data.metadataSource || "");
  };

  ExtensionModel.prototype.applyMetadata = function(metadata) {
    var payload = metadata || {};
    if (payload.descriptionLine) {
      this.descriptionLine(firstDescriptionLine(payload.descriptionLine));
    }
    if (payload.category) {
      this.category(payload.category);
    }
    if (payload.storeUrl) {
      this.storeUrl(payload.storeUrl);
    }
    this.metadataFetchedAt(payload.fetchedAt || Date.now());
    this.metadataLoading(false);
    this.metadataSource(payload.source || "fallback");
  };

  function ExtensionCollectionModel(initialItems) {
    var self = this;
    self.items = ko.observableArray([]).extend({ countable: null });

    self.applyState(initialItems || []);

    self.extensions = ko.pureComputed(function() {
      return self.items().filter(function(item) {
        return !item.isApp() && item.mayDisable();
      });
    }).extend({ countable: null });

    self.apps = ko.pureComputed(function() {
      return self.items().filter(function(item) {
        return item.isApp();
      });
    }).extend({ countable: null });

    self.enabled = ko.pureComputed(function() {
      return self.extensions().filter(function(item) {
        return item.status();
      });
    }).extend({ countable: null });

    self.disabled = ko.pureComputed(function() {
      return self.extensions().filter(function(item) {
        return !item.status();
      });
    }).extend({ countable: null });
  }

  ExtensionCollectionModel.prototype.applyState = function(items) {
    this.items((items || []).map(function(item) {
      return new ExtensionModel(item);
    }));
  };

  ExtensionCollectionModel.prototype.find = function(extensionId) {
    return _(this.items()).find(function(item) {
      return item.id() === extensionId;
    });
  };


  function applyThemeClasses(options) {
    document.body.classList.toggle("dark-mode", options.colorScheme === "dark");
    document.body.classList.toggle("light-mode", options.colorScheme === "light");
  }

  function importSuccessMessage(importScope) {
    if (importScope === "profiles") {
      return "Profiles imported.";
    }
    if (importScope === "settings") {
      return "Settings imported.";
    }
    if (importScope === "profiles_settings") {
      return "Profiles and settings imported.";
    }
    if (importScope === "url_rules") {
      return "URL rules imported and merged with the existing rules.";
    }
    return "Backup imported.";
  }

  var BROWSER_SYNC_SUCCESS_REASON =
    "Extension settings and profiles are present in chrome.storage.sync for this profile. " +
    "This does not confirm Chromium account sync or entries in brave://sync-internals.";

  var BROWSER_SYNC_PARTIAL_REASONS = {
    minimal: "Minimal sync mode is active: options and profile metadata sync; custom profile memberships stay on this device.",
    smart: "Smart sync mode is active: reserved profiles and metadata sync; large custom profile memberships may stay on this device.",
    smart_quota: "Smart sync is using local profile storage because the profile payload exceeded sync limits."
  };

  function getSyncModeLabel(syncMode) {
    if (syncMode === "full") {
      return "Full sync";
    }
    if (syncMode === "minimal") {
      return "Minimal sync";
    }
    return "Smart sync";
  }

  function evaluateBrowserSyncHealth(input) {
    var params = input || {};
    var optionsKeys = params.optionsKeys || [];
    var syncData = params.syncData || {};
    var optionsData = params.optionsData || {};

    if (params.syncAvailable === false) {
      return {
        status: "not_connected",
        reason: "chrome.storage.sync is unavailable in this environment (extension sync area cannot be read)."
      };
    }

    if (params.syncReadError) {
      return {
        status: "not_connected",
        reason: "Could not read chrome.storage.sync: " + params.syncReadError
      };
    }

    if (params.optionsReadError) {
      return {
        status: "error",
        reason: "Could not read extension settings from chrome.storage.sync: " + params.optionsReadError
      };
    }

    var missingOptions = optionsKeys.filter(function(key) {
      return typeof optionsData[key] === "undefined";
    });
    var localProfilesEnabled = !!syncData.localProfiles;
    var syncProfilesPartial = !!syncData.syncProfilesPartial;
    var syncMode = root.ExtensityStorage && typeof root.ExtensityStorage.normalizeSyncMode === "function"
      ? root.ExtensityStorage.normalizeSyncMode(optionsData.syncMode || syncData.syncMode)
      : (optionsData.syncMode || syncData.syncMode || "smart");
    var profiles = syncData.profiles;
    var profilesInSync = profiles && typeof profiles === "object" && !Array.isArray(profiles);
    var profilesRequiredInSync = !(localProfilesEnabled && syncMode === "full" && !syncProfilesPartial);
    var hasMissingData = missingOptions.length > 0 || (profilesRequiredInSync && !profilesInSync);

    if (localProfilesEnabled && syncMode === "full" && !syncProfilesPartial) {
      return {
        status: "error",
        reason: "Profiles are stored locally only because sync quota fallback is active (localProfiles is set).",
        missingOptions: missingOptions,
        profilesInSync: profilesInSync,
        syncMode: syncMode,
        syncProfilesPartial: syncProfilesPartial
      };
    }

    if (hasMissingData) {
      var reason = !profilesInSync
        ? "Profiles are missing from chrome.storage.sync."
        : "Some extension settings keys are missing from chrome.storage.sync: " + missingOptions.slice(0, 5).join(", ");
      return {
        status: "error",
        reason: reason,
        missingOptions: missingOptions,
        profilesInSync: profilesInSync,
        syncMode: syncMode,
        syncProfilesPartial: syncProfilesPartial
      };
    }

    if (syncProfilesPartial || (localProfilesEnabled && syncMode !== "full")) {
      var partialReason = BROWSER_SYNC_PARTIAL_REASONS[syncMode] || BROWSER_SYNC_PARTIAL_REASONS.smart;
      if (syncMode === "smart" && localProfilesEnabled && params.diagnostics && params.diagnostics.lastSyncError) {
        partialReason = BROWSER_SYNC_PARTIAL_REASONS.smart_quota;
      }
      return {
        status: "synced_partial",
        reason: partialReason,
        missingOptions: [],
        profilesInSync: profilesInSync,
        syncMode: syncMode,
        syncProfilesPartial: true
      };
    }

    return {
      status: "synced",
      reason: BROWSER_SYNC_SUCCESS_REASON,
      missingOptions: [],
      profilesInSync: true,
      syncMode: syncMode,
      syncProfilesPartial: false
    };
  }

  function formatSyncErrorLabel(lastSyncError) {
    if (!lastSyncError) {
      return "";
    }
    var code = lastSyncError.code || "unknown";
    var labels = {
      quota: "Sync quota exceeded",
      quota_per_item: "Sync item too large",
      quota_total: "Sync storage full",
      sync_unavailable: "Sync unavailable",
      sync_conflict: "Sync conflict",
      unknown: "Sync write error",
      write_rate_limit: "Sync write rate limit"
    };
    return labels[code] || labels.unknown;
  }

  function formatSyncDiagnosticsSummary(diagnostics) {
    if (!diagnostics) {
      return "";
    }
    var parts = [];
    if (typeof diagnostics.bytesInUse === "number" && diagnostics.limits) {
      parts.push(
        "Sync area: " + diagnostics.bytesInUse + " / " + diagnostics.limits.quotaBytes + " bytes"
      );
    }
    if (diagnostics.syncMode) {
      parts.push("Mode: " + getSyncModeLabel(diagnostics.syncMode) + ".");
    }
    if (diagnostics.syncProfilesPartial) {
      parts.push("Profile memberships may be device-local by design in this mode.");
    } else if (diagnostics.localProfiles) {
      parts.push("Profiles are in local fallback mode (not in chrome.storage.sync).");
    }
    if (typeof diagnostics.profilesBytes === "number" && diagnostics.profilesBytesThreshold) {
      parts.push(
        "Profiles payload in sync: " + diagnostics.profilesBytes + " / " + diagnostics.profilesBytesThreshold + " bytes (smart threshold)"
      );
    }
    if (diagnostics.lastSyncError) {
      parts.push(formatSyncErrorLabel(diagnostics.lastSyncError) + ": " + diagnostics.lastSyncError.message);
    }
    if (diagnostics.syncOptionsUpdatedAt || diagnostics.syncProfilesUpdatedAt) {
      parts.push(
        "Revision markers — options: " + diagnostics.syncOptionsUpdatedAt +
        ", profiles: " + diagnostics.syncProfilesUpdatedAt
      );
    }
    return parts.join(" ");
  }

  function checkBrowserSyncHealth(optionsKeys) {
    return new Promise(function(resolve) {
      var diagnosticsPromise = root.ExtensityStorage && typeof root.ExtensityStorage.getSyncDiagnostics === "function"
        ? root.ExtensityStorage.getSyncDiagnostics()
        : Promise.resolve(null);

      if (!chrome.storage || !chrome.storage.sync || typeof chrome.storage.sync.get !== "function") {
        diagnosticsPromise.then(function(diagnostics) {
          var result = evaluateBrowserSyncHealth({
            syncAvailable: false,
            optionsKeys: optionsKeys || []
          });
          result.diagnostics = diagnostics;
          result.detailsSummary = formatSyncDiagnosticsSummary(diagnostics);
          resolve(result);
        });
        return;
      }

      chrome.storage.sync.get(["profiles", "localProfiles"], function(syncData) {
        var syncError = chrome.runtime.lastError;
        if (syncError) {
          diagnosticsPromise.then(function(diagnostics) {
            var result = evaluateBrowserSyncHealth({
              syncAvailable: true,
              syncReadError: syncError.message,
              optionsKeys: optionsKeys || []
            });
            result.diagnostics = diagnostics;
            result.detailsSummary = formatSyncDiagnosticsSummary(diagnostics);
            resolve(result);
          });
          return;
        }

        chrome.storage.sync.get(optionsKeys || [], function(optionsData) {
          var optionsError = chrome.runtime.lastError;
          diagnosticsPromise.then(function(diagnostics) {
            var result = evaluateBrowserSyncHealth({
              syncAvailable: true,
              syncData: syncData,
              optionsData: optionsData || {},
              optionsReadError: optionsError ? optionsError.message : null,
              optionsKeys: optionsKeys || []
            });
            result.diagnostics = diagnostics;
            result.detailsSummary = formatSyncDiagnosticsSummary(diagnostics);
            resolve(result);
          });
        });
      });
    });
  }

  function attachSyncRemoteUpdateListener(refreshHandler) {
    if (!chrome.runtime || typeof chrome.runtime.onMessage !== "object" || typeof refreshHandler !== "function") {
      return function() {};
    }
    var listener = function(message) {
      if (message && message.type === "SYNC_REMOTE_UPDATE") {
        refreshHandler();
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return function() {
      chrome.runtime.onMessage.removeListener(listener);
    };
  }

  var ExtensityApi = {
    assignExtensionProfile: function(extensionId, profileNameOrNull) {
      return chromeMessage({
        extensionId: extensionId,
        profileName: profileNameOrNull,
        type: "ASSIGN_EXTENSION_PROFILE"
      });
    },
    applyProfile: function(profileName) {
      return chromeMessage({ profileName: profileName, type: "APPLY_PROFILE" });
    },
    exportBackup: function(exportScope) {
      return chromeMessage({ exportScope: exportScope || "full", type: "EXPORT_BACKUP" });
    },
    getState: function() {
      return chromeMessage({ type: "GET_STATE" });
    },
    getExtensionMetadata: function(extensionIds, options) {
      var config = options || {};
      return chromeMessage({
        extensionIds: extensionIds,
        forceRefresh: !!config.forceRefresh,
        type: "GET_EXTENSION_METADATA"
      });
    },
    importBackup: function(envelope) {
      return chromeMessage({ envelope: envelope, type: "IMPORT_BACKUP" });
    },
    openDashboard: function(options) {
      var payload = { type: "OPEN_DASHBOARD" };
      if (options && options.deepLink) {
        payload.deepLink = options.deepLink;
      }
      return chromeMessage(payload);
    },
    saveAlias: function(extensionId, alias) {
      return chromeMessage({
        alias: alias,
        extensionId: extensionId,
        type: "SAVE_ALIAS"
      });
    },
    saveAliases: function(aliases) {
      return chromeMessage({
        aliases: aliases,
        type: "SAVE_ALIAS"
      });
    },
    saveGroups: function(groups, groupOrder) {
      return chromeMessage({
        groupOrder: groupOrder,
        groups: groups,
        type: "SAVE_GROUPS"
      });
    },
    saveOptions: function(options) {
      return chromeMessage({ options: options, type: "SAVE_OPTIONS" });
    },
    saveUrlRules: function(urlRules) {
      return chromeMessage({ type: "SAVE_URL_RULES", urlRules: urlRules });
    },
    testUrlRules: function(url) {
      return chromeMessage({
        type: "TEST_URL_RULES",
        url: url
      });
    },
    setExtensionState: function(extensionId, enabled, context) {
      return chromeMessage({
        context: context,
        enabled: enabled,
        extensionId: extensionId,
        type: "SET_EXTENSION_STATE"
      });
    },
    getDriveSyncStatus: function() {
      return chromeMessage({ type: "GET_DRIVE_SYNC_STATUS" });
    },
    setDriveWebClientId: function(clientId) {
      return chromeMessage({ type: "SET_DRIVE_WEB_CLIENT_ID", clientId: clientId });
    },
    testDriveConnection: function() {
      return chromeMessage({ type: "TEST_DRIVE_CONNECTION" });
    },
    previewDriveSync: function(options) {
      return chromeMessage(Object.assign({ type: "PREVIEW_DRIVE_SYNC" }, options || {}));
    },
    restoreDriveSyncBackup: function(backupId) {
      return chromeMessage({ backupId: backupId || null, type: "RESTORE_DRIVE_SYNC_BACKUP" });
    },
    selectDriveSyncFile: function(fileId) {
      return chromeMessage({ fileId: fileId, type: "SELECT_DRIVE_SYNC_FILE" });
    },
    deleteDriveFile: function(fileId) {
      return chromeMessage({ fileId: fileId, type: "DELETE_DRIVE_FILE" });
    },
    resolveDriveConflict: async function(resolution, overrideFailsafe) {
      if (resolution === "cancel") {
        return chromeMessage({ resolution: "cancel", type: "RESOLVE_DRIVE_CONFLICT" });
      }
      var previewPayload = await chromeMessage({
        direction: "sync",
        resolution: resolution,
        type: "PREVIEW_DRIVE_SYNC"
      });
      var preview = previewPayload && previewPayload.preview;
      if (!preview || preview.status !== "preview") {
        return { result: preview, state: previewPayload && previewPayload.state };
      }
      return chromeMessage({
        confirmationToken: preview.confirmationToken,
        overrideFailsafe: !!overrideFailsafe,
        resolution: resolution,
        type: "RESOLVE_DRIVE_CONFLICT"
      });
    },
    syncDrive: async function(options) {
      var payload = { type: "SYNC_DRIVE" };
      if (options) {
        if (options.direction) {
          payload.direction = options.direction;
        }
        if (options.interactive === false) {
          payload.interactive = false;
        }
      }
      if (payload.direction === "push" || payload.direction === "pull") {
        var previewPayload = await chromeMessage(Object.assign({}, payload, { type: "PREVIEW_DRIVE_SYNC" }));
        var preview = previewPayload && previewPayload.preview;
        // A preview only mints a confirmation token when there is something to confirm.
        // noop/conflict/cancelled previews return no token, and confirming with an absent
        // token always fails as preview_stale — so surface the preview result instead.
        if (!preview || preview.status !== "preview") {
          return { result: preview, state: previewPayload && previewPayload.state };
        }
        payload.confirmationToken = preview.confirmationToken;
        payload.overrideFailsafe = !!(options && options.overrideFailsafe);
        payload.requireConfirmation = true;
      }
      return chromeMessage(payload);
    },
    toggleAll: function() {
      return chromeMessage({ type: "TOGGLE_ALL" });
    },
    undoLast: function() {
      return chromeMessage({ type: "UNDO_LAST" });
    },
    uninstallExtension: function(extensionId) {
      return chromeMessage({
        extensionId: extensionId,
        type: "UNINSTALL_EXTENSION"
      });
    },
    pinExtensionToToolbar: function(extensionId) {
      return chromeMessage({
        extensionId: extensionId,
        type: "PIN_EXTENSION_TO_TOOLBAR"
      });
    },
    updateExtensionToolbarPinned: function(extensionId, shouldPin) {
      return chromeMessage({
        extensionId: extensionId,
        shouldPin: !!shouldPin,
        type: "UPDATE_EXTENSION_TOOLBAR_PINNED"
      });
    },
    updateExtensionProfileMembership: function(extensionId, profileName, shouldInclude) {
      return chromeMessage({
        extensionId: extensionId,
        profileName: profileName,
        shouldInclude: !!shouldInclude,
        type: "UPDATE_EXTENSION_PROFILE_MEMBERSHIP"
      });
    }
  };

  function inferTooltipFromElement(element) {
    var ariaLabel = (element.getAttribute("aria-label") || "").trim();
    if (ariaLabel) {
      return ariaLabel;
    }

    var labelledBy = (element.getAttribute("aria-labelledby") || "").trim();
    if (labelledBy) {
      var labelledElement = document.getElementById(labelledBy);
      if (labelledElement) {
        var labelledText = (labelledElement.textContent || "").trim();
        if (labelledText) {
          return labelledText;
        }
      }
    }

    if (element.id) {
      var label = document.querySelector('label[for="' + element.id + '"]');
      if (label) {
        var labelText = (label.textContent || "").trim();
        if (labelText) {
          return labelText;
        }
      }
    }

    var text = (element.textContent || element.value || element.placeholder || "").trim();
    if (text) {
      return text.replace(/\s+/g, " ");
    }

    return "";
  }

  function applyAutoTooltips(container) {
    if (typeof document === "undefined") {
      return;
    }

    var rootNode = container || document;
    var nodes = rootNode.querySelectorAll("button, input, select, textarea, a, [data-tooltip]");
    Array.prototype.forEach.call(nodes, function(node) {
      if (!node || node.getAttribute("title")) {
        return;
      }

      var explicit = (node.getAttribute("data-tooltip") || "").trim();
      if (explicit) {
        node.setAttribute("title", explicit);
        return;
      }

      var inferred = inferTooltipFromElement(node);
      if (inferred) {
        node.setAttribute("title", inferred);
      }
    });
  }

  root.DismissalsCollection = DismissalsCollection;
  root.ExtensityApi = ExtensityApi;
  root.ExtensityIO = {
    exportFilename: exportFilename,
    downloadText: downloadText,
    readFileAsText: readFileAsText
  };
  root.ExtensionCollectionModel = ExtensionCollectionModel;
  root.ExtensionModel = ExtensionModel;
  root.OptionsCollection = OptionsCollection;
  root.ProfileCollectionModel = ProfileCollectionModel;
  root.ProfileModel = ProfileModel;
  root.ExtensityPopupLabels = {
    formatProfileBadgeLabel: formatPopupProfileBadgeLabel
  };
  root.ExtensityTooltips = {
    applyAutoTooltips: applyAutoTooltips
  };
  root.ExtensityExtensionMetadata = {
    defaultCategoryForInstallType: defaultCategoryForInstallType,
    firstDescriptionLine: firstDescriptionLine,
    isChromeWebStoreUrl: isChromeWebStoreUrl
  };
  root.fadeOutMessage = fadeOutMessage;
  root.ExtensityEngine = {
    PROFILE_ICONS: PROFILE_ICONS
  };
  root.ExtensityBrowserSync = {
    attachSyncRemoteUpdateListener: attachSyncRemoteUpdateListener,
    checkBrowserSyncHealth: checkBrowserSyncHealth,
    evaluateBrowserSyncHealth: evaluateBrowserSyncHealth,
    formatSyncDiagnosticsSummary: formatSyncDiagnosticsSummary,
    formatSyncErrorLabel: formatSyncErrorLabel,
    getSyncModeLabel: getSyncModeLabel
  };
  root.ExtensityUtils = {
    applyThemeClasses: applyThemeClasses,
    buildManageExtensionUrl: buildManageExtensionUrl,
    buildPermissionsPageUrl: buildPermissionsPageUrl,
    chromeCall: chromeCall,
    clampInteger: clampInteger,
    copyText: copyText,
    importSuccessMessage: importSuccessMessage,
    openTab: openTab,
    pruneText: pruneText
  };
})(window);
