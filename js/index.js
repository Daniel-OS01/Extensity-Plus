document.addEventListener("DOMContentLoaded", function() {
  function levenshteinWithin(source, query, limit) {
    var left = source.toLowerCase();
    var right = query.toLowerCase();

    if (Math.abs(left.length - right.length) > limit) {
      return false;
    }

    var previous = [];
    for (var index = 0; index <= right.length; index += 1) {
      previous[index] = index;
    }

    for (var row = 1; row <= left.length; row += 1) {
      var current = [row];
      var rowMin = current[0];

      for (var column = 1; column <= right.length; column += 1) {
        var cost = left[row - 1] === right[column - 1] ? 0 : 1;
        current[column] = Math.min(
          current[column - 1] + 1,
          previous[column] + 1,
          previous[column - 1] + cost
        );
        rowMin = Math.min(rowMin, current[column]);
      }

      if (rowMin > limit) {
        return false;
      }
      previous = current;
    }

    return previous[right.length] <= limit;
  }

  function focusSiblingRow(target, direction) {
    var rows = Array.prototype.slice.call(document.querySelectorAll(".keyboard-row"));
    var index = rows.indexOf(target);
    if (index === -1) {
      return;
    }

    var next = rows[index + direction];
    if (next) {
      next.focus();
    }
  }

  function SearchViewModel() {
    var self = this;
    self.q = ko.observable("");

    self.matchesExtension = function(extension) {
      var query = (self.q() || "").trim().toLowerCase();
      if (!query) {
        return true;
      }

      var haystacks = [
        extension.alias(),
        extension.name(),
        extension.description()
      ].filter(Boolean).map(function(item) {
        return item.toLowerCase();
      });

      if (haystacks.some(function(item) {
        return item.indexOf(query) !== -1;
      })) {
        return true;
      }

      if (query.length < 3) {
        return false;
      }

      return haystacks.some(function(item) {
        return item.split(/\s+/).some(function(word) {
          return levenshteinWithin(word, query, 2);
        });
      });
    };
  }

  function SwitchViewModel(owner) {
    var self = this;
    self.owner = owner;
    self.restoreList = ko.observableArray([]);

    self.any = ko.computed(function() {
      return self.restoreList().length > 0;
    });

    self.toggleStyle = ko.pureComputed(function() {
      return self.any() ? "fa-toggle-off" : "fa-toggle-on";
    });

    self.flip = function() {
      self.owner.performAction(ExtensityApi.toggleAll());
    };

    self.undo = function() {
      self.owner.performAction(ExtensityApi.undoLast());
    };
  }

  function ExtensityViewModel() {
    var self = this;
    self.loading = ko.observable(true);
    self.error = ko.observable("");
    self.busy = ko.observable(false);
    self.opts = new OptionsCollection();
    self.profiles = new ProfileCollectionModel();
    self.exts = new ExtensionCollectionModel();
    self.dismissals = new DismissalsCollection();
    self.search = new SearchViewModel();
    self.switch = new SwitchViewModel(self);
    self.activeProfile = ko.observable(null);
    self.expandedExtensionId = ko.observable(null);
    self.extensionProfileMembership = ko.observable({});
    self.undoDepth = ko.observable(0);

    self.bodyClass = ko.pureComputed(function() {
      var classes = [];
      classes.push(self.opts.viewMode() === "grid" ? "grid-view" : "list-view");
      if (self.opts.viewMode() === "list") {
        classes.push("popup-list-style-" + self.opts.popupListStyle());
      }
      if (self.opts.contrastMode() === "high") {
        classes.push("high-contrast");
      }
      var scheme = self.opts.colorScheme();
      if (scheme === "dark") { classes.push("dark-mode"); }
      if (scheme === "light") { classes.push("light-mode"); }
      classes.push(self.opts.popupActionRowLayout() === "vertical" ? "action-layout-vertical" : "action-layout-horizontal");
      classes.push(self.opts.popupHeaderIconSize() === "compact" ? "popup-header-icons-compact" : "popup-header-icons-normal");
      classes.push("popup-scrollbar-" + self.opts.popupScrollbarMode());
      classes.push(self.opts.popupTableActionPanelPosition() === "below_name" ? "table-action-panel-below-name" : "table-action-panel-side");
      classes.push(self.opts.popupProfilePillTextMode() === "icons_only" ? "profile-pill-icons-only" : "profile-pill-text-visible");
      classes.push(self.opts.popupProfilePillShowIcons() || self.opts.popupProfilePillTextMode() === "icons_only" ? "profile-pill-icons-visible" : "profile-pill-icons-hidden");
      return classes.join(" ");
    });

    self.scrollbarClass = ko.pureComputed(function() {
      return "popup-scrollbar-" + self.opts.popupScrollbarMode();
    });

    self.isCompactPopupList = ko.pureComputed(function() {
      return self.opts.viewMode() === "list" && self.opts.popupListStyle() === "compact";
    });

    self.isTablePopupList = ko.pureComputed(function() {
      return self.opts.viewMode() === "list" && self.opts.popupListStyle() === "table";
    });

    self.assignableProfiles = ko.pureComputed(function() {
      return self.profiles.items().filter(function(profile) {
        return !profile.reserved();
      });
    });

    self.profileMembershipRows = ko.pureComputed(function() {
      var expandedId = self.expandedExtensionId();
      var memberMap = expandedId ? (self.extensionProfileMembership()[expandedId] || {}) : {};
      return self.profiles.items().filter(function(profile) {
        return !profile.reserved();
      }).map(function(profile) {
        var profileName = profile.name();
        var isMember = !!memberMap[profileName];
        return {
          label: profile.short_name() + " \u00b7 " + (isMember ? "Remove" : "Add"),
          active: isMember,
          toggleFn: function() {
            if (!expandedId) { return false; }
            self.performAction(ExtensityApi.updateExtensionProfileMembership(expandedId, profileName, !isMember));
            return false;
          }
        };
      });
    });

    self.profileDropdownOptions = ko.pureComputed(function() {
      var expandedId = self.expandedExtensionId();
      var memberMap = expandedId ? (self.extensionProfileMembership()[expandedId] || {}) : {};
      return self.profiles.items().filter(function(profile) {
        return !profile.reserved();
      }).map(function(profile) {
        var profileName = profile.name();
        var isMember = !!memberMap[profileName];
        return {
          label: (isMember ? "\u2713 " : "\u2003") + profile.short_name(),
          value: profileName
        };
      });
    });

    self.onProfileMembershipChange = function(data, event) {
      var selectedName = event.target.value;
      event.target.value = "";
      if (!selectedName || !self.expandedExtensionId()) { return false; }
      var expandedId = self.expandedExtensionId();
      var memberMap = self.extensionProfileMembership()[expandedId] || {};
      var isMember = !!memberMap[selectedName];
      self.performAction(ExtensityApi.updateExtensionProfileMembership(expandedId, selectedName, !isMember));
      return false;
    };

    ko.computed(function() {
      var itemPadding = parseFloat(self.opts.itemPaddingPx());
      var itemVerticalSpace = parseFloat(self.opts.itemVerticalSpacePx());
      function px(value, fallback) {
        var parsed = parseFloat(value);
        return (isFinite(parsed) ? parsed : fallback) + "px";
      }
      var style = document.documentElement.style;
      style.setProperty("--font-size", px(self.opts.fontSizePx(), 12));
      style.setProperty("--item-padding-v", (isFinite(itemPadding) ? Math.max(itemPadding, 0) : 10) + "px");
      style.setProperty("--item-padding-v-adjust", (isFinite(itemPadding) ? Math.min(itemPadding, 0) : 0) + "px");
      style.setProperty("--item-padding-x", px(self.opts.itemPaddingXPx(), 12));
      style.setProperty("--item-name-gap", px(self.opts.itemNameGapPx(), 10));
      style.setProperty("--item-spacing", px(self.opts.itemSpacingPx(), 8));
      style.setProperty("--item-v-space", (isFinite(itemVerticalSpace) ? Math.max(itemVerticalSpace, 0) : 0) + "px");
      style.setProperty("--item-v-space-adjust", (isFinite(itemVerticalSpace) ? Math.min(itemVerticalSpace, 0) : 0) + "px");
      style.setProperty("--extension-icon-size", px(self.opts.extensionIconSizePx(), 16));
      style.setProperty("--popup-main-padding-x", px(self.opts.popupMainPaddingPx(), 0));
      style.setProperty("--popup-width", px(self.opts.popupWidthPx(), 380));
      if (self.opts.accentColor()) { style.setProperty("--accent", self.opts.accentColor()); }
      if (self.opts.popupBgColor()) { document.body.style.background = self.opts.popupBgColor(); }
      if (self.opts.fontFamily()) { document.body.style.fontFamily = self.opts.fontFamily(); }
    });

    self.activeProfileObj = ko.pureComputed(function() {
      var name = self.activeProfile();
      if (!name) { return null; }
      var found = null;
      self.profiles.items().forEach(function(p) {
        if (p.name() === name) { found = p; }
      });
      return found;
    });

    self.activeProfileBadgeStyle = ko.pureComputed(function() {
      var p = self.activeProfileObj();
      return p ? "border-left-color:" + p.color() : "";
    });

    self.activeProfileIconClass = ko.pureComputed(function() {
      var p = self.activeProfileObj();
      return p ? "fa " + p.icon() : "fa";
    });

    self.activeProfileName = ko.pureComputed(function() {
      var p = self.activeProfileObj();
      return p ? p.short_name() : "";
    });

    self.profilePillIconsOnly = ko.pureComputed(function() {
      return self.opts.popupProfilePillTextMode() === "icons_only";
    });

    self.showProfilePillCheck = function(profile) {
      return !self.profilePillIconsOnly() && profile.isActive();
    };

    self.showProfilePillReservedIcon = function(profile, reservedName) {
      if (profile.name() !== reservedName) {
        return false;
      }
      if (self.profilePillIconsOnly()) {
        return true;
      }
      return self.opts.popupProfilePillShowIcons() && !profile.isActive();
    };

    self.showProfilePillCustomIcon = function(profile) {
      if (profile.reserved() || !profile.icon()) {
        return false;
      }
      if (self.profilePillIconsOnly()) {
        return true;
      }
      return self.opts.popupProfilePillShowIcons() && !profile.isActive();
    };

    self.showProfilePillText = function() {
      return !self.profilePillIconsOnly();
    };

    self.canUndo = ko.pureComputed(function() {
      return self.undoDepth() > 0;
    });

    self.viewToggleIcon = ko.pureComputed(function() {
      return self.opts.viewMode() === "grid" ? "fa-list" : "fa-th-large";
    });

    self.applyState = function(state) {
      self.opts.apply(state.options);
      self.activeProfile(state.options.activeProfile);
      self.profiles.applyState(state.profiles);
      self.exts.applyState(state.extensions);
      self.switch.restoreList(state.localState.bulkToggleRestore || []);
      self.undoDepth((state.localState.undoStack || []).length);

      // Mark active profile pill
      self.profiles.items().forEach(function(profile) {
        profile.isActive(profile.name() === state.options.activeProfile);
        profile.popupLabel(ExtensityPopupLabels.formatProfileBadgeLabel(
          profile.name(),
          self.opts.popupProfilePillTextMode(),
          self.opts.popupProfilePillSingleWordChars()
        ));
      });

      // Compute profile membership badges for each extension
      var profileMap = {};
      var colorIndex = 0;
      var badgeMode = self.opts.popupProfileBadgeTextMode();
      var singleWordChars = self.opts.popupProfileBadgeSingleWordChars();
      self.profiles.items().forEach(function(profile) {
        if (!profile.reserved()) {
          var hexColor = profile.color();
          var isHex = hexColor && hexColor.indexOf("#") === 0;
          var colorClass = isHex ? "" : ("profile-color-" + (colorIndex % 5));
          var badgeStyle = isHex ? ("border-left-color:" + hexColor) : "";
          colorIndex += 1;
          profile.items().forEach(function(extId) {
            if (!profileMap[extId]) { profileMap[extId] = []; }
            profileMap[extId].push({
              badgeStyle: badgeStyle,
              colorClass: colorClass,
              name: ExtensityPopupLabels.formatProfileBadgeLabel(profile.name(), badgeMode, singleWordChars)
            });
          });
        }
      });
      self.exts.items().forEach(function(ext) {
        var badges = (profileMap[ext.id()] || []).slice();
        if (self.opts.showAlwaysOnBadge() && ext.alwaysOn()) {
          badges.unshift({
            badgeStyle: "",
            colorClass: "always-on-badge",
            name: ExtensityPopupLabels.formatProfileBadgeLabel("__always_on", badgeMode, singleWordChars)
          });
        }
        ext.profileBadges(badges);
      });

      var profileMembership = {};
      self.profiles.items().forEach(function(profile) {
        if (profile.reserved()) {
          return;
        }
        profile.items().forEach(function(extensionId) {
          if (!profileMembership[extensionId]) {
            profileMembership[extensionId] = {};
          }
          profileMembership[extensionId][profile.name()] = true;
        });
      });
      self.extensionProfileMembership(profileMembership);

      if (self.expandedExtensionId() && !self.exts.find(self.expandedExtensionId())) {
        self.expandedExtensionId(null);
      }

      document.body.className = self.bodyClass();
      document.documentElement.className = self.scrollbarClass();
      if (window.ExtensityTooltips && window.ExtensityTooltips.applyAutoTooltips) {
        window.ExtensityTooltips.applyAutoTooltips(document.body);
      }
      self.loading(false);
      self.error("");
    };

    self.performAction = function(request) {
      self.busy(true);
      self.error("");

      return request.then(function(payload) {
        if (payload.state) {
          self.applyState(payload.state);
        }
      }).catch(function(error) {
        self.error(error.message);
      }).finally(function() {
        self.busy(false);
      });
    };

    self.refresh = function() {
      self.loading(true);
      return self.performAction(ExtensityApi.getState());
    };

    self.openChromeExtensions = function() {
      chrome.tabs.create({ url: "chrome://extensions" });
      window.close();
    };

    self.openDashboard = function() {
      self.performAction(ExtensityApi.openDashboard()).finally(function() {
        window.close();
      });
    };

    self.launchApp = function(app) {
      chrome.management.launchApp(app.id());
    };

    self.launchOptions = function(extension) {
      return ExtensityUtils.openTab(extension.optionsUrl());
    };

    self.isRowExpanded = function(extensionId) {
      return self.expandedExtensionId() === extensionId;
    };

    self.ensureExtensionMetadata = function(extension) {
      if (extension.metadataLoading() || extension.metadataFetchedAt()) {
        return Promise.resolve();
      }

      extension.metadataLoading(true);
      return ExtensityApi.getExtensionMetadata([extension.id()]).then(function(payload) {
        var metadata = payload.metadata && payload.metadata[extension.id()];
        if (metadata) {
          extension.applyMetadata(metadata);
          return;
        }
        extension.metadataLoading(false);
      }).catch(function(error) {
        extension.metadataLoading(false);
        throw error;
      });
    };

    self.toggleCompactRow = function(extension) {
      var nextId = self.isRowExpanded(extension.id()) ? null : extension.id();
      self.expandedExtensionId(nextId);
      if (nextId) {
        self.ensureExtensionMetadata(extension).catch(function(error) {
          self.error(error.message);
        });
      }
    };

    self.toggleTableRow = function(extension) {
      var nextId = self.isRowExpanded(extension.id()) ? null : extension.id();
      self.expandedExtensionId(nextId);
      if (nextId) {
        self.ensureExtensionMetadata(extension).catch(function(error) {
          self.error(error.message);
        });
      }
    };

    self.toggleCompactExtension = function(extension) {
      self.performAction(ExtensityApi.setExtensionState(extension.id(), !extension.status(), {
        source: "manual"
      }));
    };

    self.toggleCompactCheckbox = function(extension) {
      self.toggleCompactExtension(extension);
      return false;
    };

    self.openManagePage = function(extension) {
      return ExtensityUtils.openTab(ExtensityUtils.buildManageExtensionUrl(extension.id())).catch(function(error) {
        self.error(error.message);
      });
    };

    self.openPermissionsPage = function(extension) {
      return ExtensityUtils.openTab(ExtensityUtils.buildPermissionsPageUrl(extension.id())).catch(function() {
        return ExtensityUtils.openTab(ExtensityUtils.buildManageExtensionUrl(extension.id()));
      }).catch(function(error) {
        self.error(error.message);
      });
    };

    self.canCopyLink = function(extension) {
      return !!extension.copyLinkUrl();
    };

    self.copyExtensionLink = function(extension) {
      if (!self.canCopyLink(extension)) {
        return;
      }
      ExtensityUtils.copyText(extension.copyLinkUrl()).catch(function(error) {
        self.error(error.message);
      });
    };

    self.openChromeWebStore = function(extension) {
      if (!extension.storeLinkAvailable()) {
        return;
      }
      ExtensityUtils.openTab(extension.storeUrl()).catch(function(error) {
        self.error(error.message);
      });
    };

    self.canRemoveExtension = function(extension) {
      return extension.installType() !== "admin";
    };

    self.extensionMembershipMap = function(extension) {
      return self.extensionProfileMembership()[extension.id()] || {};
    };

    self.isExtensionInProfile = function(extension, profileName) {
      return !!self.extensionMembershipMap(extension)[profileName];
    };

    self.toggleExtensionProfileMembership = function(extension, profile) {
      if (!profile || profile.reserved()) {
        return false;
      }

      var shouldInclude = !self.isExtensionInProfile(extension, profile.name());
      self.performAction(ExtensityApi.updateExtensionProfileMembership(extension.id(), profile.name(), shouldInclude));
      return false;
    };

    self.extensionMembershipButtonLabel = function(extension, profile) {
      return self.isExtensionInProfile(extension, profile.name()) ? "Remove" : "Add";
    };

    self.removeExtension = function(extension) {
      if (!self.canRemoveExtension(extension)) {
        return;
      }
      self.performAction(ExtensityApi.uninstallExtension(extension.id()));
    };

    self.toggleViewMode = function() {
      var nextOptions = self.opts.toJS();
      nextOptions.viewMode = self.opts.viewMode() === "grid" ? "list" : "grid";
      self.performAction(ExtensityApi.saveOptions(nextOptions));
    };

    self.setSortMode = function(mode) {
      var nextOptions = self.opts.toJS();
      nextOptions.sortMode = mode;
      self.performAction(ExtensityApi.saveOptions(nextOptions));
    };

    self.setSortAlpha = function() { self.setSortMode("alpha"); };
    self.setSortFrequency = function() { self.setSortMode("frequency"); };
    self.setSortRecent = function() { self.setSortMode("recent"); };

    self.setProfile = function(profile) {
      self.performAction(ExtensityApi.applyProfile(profile.name()));
    };

    self.toggleExtension = function(extension) {
      self.performAction(ExtensityApi.setExtensionState(extension.id(), !extension.status(), {
        source: "manual"
      }));
    };

    self.handleRowKeydown = function(item, event) {
      if (event.key === "ArrowDown") {
        focusSiblingRow(event.currentTarget, 1);
        event.preventDefault();
        return;
      }

      if (event.key === "ArrowUp") {
        focusSiblingRow(event.currentTarget, -1);
        event.preventDefault();
        return;
      }

      if (event.key !== " " && event.key !== "Enter") {
        return;
      }

      if (item.isApp && item.isApp()) {
        self.launchApp(item);
      } else {
        self.toggleExtension(item);
      }
      event.preventDefault();
    };

    self.handleCompactRowKeydown = function(item, event) {
      if (event.key === "ArrowDown") {
        focusSiblingRow(event.currentTarget, 1);
        event.preventDefault();
        return;
      }

      if (event.key === "ArrowUp") {
        focusSiblingRow(event.currentTarget, -1);
        event.preventDefault();
      }
    };

    self.handleTableRowKeydown = function(item, event) {
      if (event.key === "ArrowDown") {
        focusSiblingRow(event.currentTarget, 1);
        event.preventDefault();
        return;
      }

      if (event.key === "ArrowUp") {
        focusSiblingRow(event.currentTarget, -1);
        event.preventDefault();
        return;
      }

      if (event.key !== " " && event.key !== "Enter") {
        return;
      }

      var target = event.target;
      var interactive = target && target.closest && target.closest("button, input, select, a");
      if (interactive && interactive !== event.currentTarget) {
        return;
      }

      self.toggleTableRow(item);
      event.preventDefault();
    };

    self.filterProfile = function(profile) {
      if (!profile.reserved()) {
        return true;
      }
      return self.opts.showReserved() && profile.hasItems();
    };

    self.sortExtensions = function(items) {
      return items.slice().sort(function(left, right) {
        if (self.opts.enabledFirst() && left.status() !== right.status()) {
          return left.status() ? -1 : 1;
        }

        if (self.opts.sortMode() === "frequency" && left.usageCount() !== right.usageCount()) {
          return right.usageCount() - left.usageCount();
        }

        if (self.opts.sortMode() === "recent" && left.lastUsed() !== right.lastUsed()) {
          return right.lastUsed() - left.lastUsed();
        }

        return left.displayName().toUpperCase().localeCompare(right.displayName().toUpperCase());
      });
    };

    self.listedExtensions = ko.computed(function() {
      return self.sortExtensions(self.exts.extensions().filter(function(extension) {
        return self.search.matchesExtension(extension);
      }));
    }).extend({ countable: null });

    self.listedApps = ko.computed(function() {
      return self.exts.apps().filter(function(app) {
        return self.search.matchesExtension(app);
      }).sort(function(left, right) {
        return left.displayName().toUpperCase().localeCompare(right.displayName().toUpperCase());
      });
    }).extend({ countable: null });

    self.listedItems = ko.computed(function() {
      return self.exts.items().filter(function(item) {
        return self.search.matchesExtension(item);
      }).sort(function(left, right) {
        return left.displayName().toUpperCase().localeCompare(right.displayName().toUpperCase());
      });
    }).extend({ countable: null });

    self.listedProfiles = ko.computed(function() {
      return self.profiles.items().filter(self.filterProfile);
    }).extend({ countable: null });

    self.listedFavorites = ko.computed(function() {
      return self.sortExtensions(self.exts.extensions().filter(function(extension) {
        return extension.favorite() && self.search.matchesExtension(extension);
      }));
    }).extend({ countable: null });

    self.emptyItems = ko.pureComputed(function() {
      if (self.opts.groupApps()) {
        return self.listedApps.none() && self.listedExtensions.none();
      }
      return self.listedItems.none();
    });
  }

  _.defer(function() {
    var vm = new ExtensityViewModel();
    ko.bindingProvider.instance = new ko.secureBindingsProvider({});
    ko.applyBindings(vm, document.body);
    vm.refresh();
  });
});
