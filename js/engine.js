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
    return buildManageExtensionUrl(extensionId) + "#permissions";
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
          reject(new Error(response && response.error ? response.error : "Unexpected extension response."));
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

  function DismissalsCollection() {
    var self = this;
    self.dismissals = ko.observableArray([]);

    self.dismiss = function(id) {
      if (self.dismissals.indexOf(id) !== -1) {
        return;
      }
      self.dismissals.push(id);
      chrome.storage.sync.set({ dismissals: self.dismissals() });
    };

    self.dismissed = function(id) {
      return self.dismissals.indexOf(id) !== -1;
    };

    chrome.storage.sync.get({ dismissals: [] }, function(result) {
      self.dismissals(result.dismissals || []);
    });
  }

  function OptionsCollection(initialState) {
    var self = this;
    var defaults = root.ExtensityStorage.getSyncDefaults();
    var state = root.ExtensityStorage.mergeDefaults(defaults, initialState || {});
    self.keys = Object.keys(defaults);

    self.keys.forEach(function(key) {
      self[key] = ko.observable(state[key]);
    });

    self.apply = function(nextState) {
      var merged = root.ExtensityStorage.mergeDefaults(defaults, nextState || {});
      self.keys.forEach(function(key) {
        self[key](merged[key]);
      });
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
    "fa-rocket","fa-bolt","fa-star","fa-fire","fa-lightbulb-o",
    "fa-paint-brush","fa-globe","fa-shield","fa-cogs","fa-flask",
    "fa-leaf","fa-diamond","fa-music","fa-gamepad","fa-bookmark",
    "fa-cloud","fa-paper-plane-o","fa-puzzle-piece","fa-code","fa-graduation-cap"
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
    openDashboard: function() {
      return chromeMessage({ type: "OPEN_DASHBOARD" });
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
    syncDrive: function() {
      return chromeMessage({ type: "SYNC_DRIVE" });
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
  root.ExtensityUtils = {
    applyThemeClasses: applyThemeClasses,
    buildManageExtensionUrl: buildManageExtensionUrl,
    buildPermissionsPageUrl: buildPermissionsPageUrl,
    chromeCall: chromeCall,
    clampInteger: clampInteger,
    copyText: copyText,
    openTab: openTab,
    pruneText: pruneText
  };
})(window);
