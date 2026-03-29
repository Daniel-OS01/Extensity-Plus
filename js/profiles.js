document.addEventListener("DOMContentLoaded", function() {
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

  function ProfilesViewModel() {
    var self = this;

    function compareExtensionsByName(left, right) {
      return left.displayName().toUpperCase().localeCompare(right.displayName().toUpperCase());
    }

    self.loading = ko.observable(true);
    self.busy = ko.observable(false);
    self.error = ko.observable("");
    self.needsWebStorePermission = ko.observable(false);
    self.opts = new OptionsCollection();
    self.ext = new ExtensionCollectionModel();
    self.profiles = new ProfileCollectionModel();
    self.current_profile = ko.observable(null);
    self.add_name = ko.observable("");
    self.extSortMode = ko.observable("alpha");
    self.profileCountMap = ko.observable({});
    self.expandedExtensionId = ko.observable(null);
    self.extensionProfileMembership = ko.observable({});

    self.version = ko.observable("");

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

    self.current_name = ko.pureComputed(function() {
      return self.current_profile() ? self.current_profile().name() : null;
    });

    self.currentProfileIcon = ko.pureComputed(function() {
      var p = self.current_profile();
      return p ? p.icon() : "";
    });

    self.currentProfileColor = ko.pureComputed(function() {
      var p = self.current_profile();
      return p ? p.color() : "";
    });

    self.currentProfileIsNamed = ko.pureComputed(function() {
      return !!self.current_profile();
    });

    self.iconOptions = (window.ExtensityEngine && window.ExtensityEngine.PROFILE_ICONS || []).map(function(cls) {
      return { value: cls, label: cls.replace("fa-", "").replace(/-/g, " ") };
    });

    self.editable = ko.pureComputed(function() {
      return !!self.current_profile();
    });

    self.layoutClass = ko.pureComputed(function() {
      return self.opts.profileDisplay() === "portrait" ? "profiles-portrait" : "profiles-landscape";
    });

    self.layoutIsLandscape = ko.pureComputed(function() {
      return self.opts.profileDisplay() === "landscape";
    });

    self.layoutIsPortrait = ko.pureComputed(function() {
      return self.opts.profileDisplay() === "portrait";
    });

    self.shouldShowProfilesExtensionMetadata = ko.pureComputed(function() {
      return !!self.opts.showProfilesExtensionMetadata();
    });

    self.resolvedProfileDirection = ko.pureComputed(function() {
      return self.opts.profileLayoutDirection() === "rtl" ? "rtl" : "ltr";
    });

    self.profileNameDir = ko.pureComputed(function() {
      return self.opts.profileNameDirection() === "rtl" ? "rtl" : "ltr";
    });

    self.currentProfileNameDir = ko.pureComputed(function() {
      return self.profileNameDir();
    });

    self.bodyClass = ko.pureComputed(function() {
      var classes = [
        self.layoutClass(),
        "profiles-dir-" + self.resolvedProfileDirection(),
        "profiles-name-dir-" + self.profileNameDir()
      ];
      var scheme = self.opts.colorScheme();
      if (scheme === "dark") { classes.push("dark-mode"); }
      if (scheme === "light") { classes.push("light-mode"); }
      if (self.opts.profileExtensionSide() === "right") { classes.push("profiles-ext-side-right"); }
      return classes.join(" ");
    });

    self.selectedCount = ko.pureComputed(function() {
      return self.profiles.items().filter(function(profile) {
        return profile.selected() && !profile.reserved();
      }).length;
    });

    self.sortedExtensions = ko.pureComputed(function() {
      var countMap = self.profileCountMap();
      var items = self.ext.extensions().slice();
      var mode = self.extSortMode();

      if (mode === "popular") {
        return items.sort(function(left, right) {
          if (right.usageCount() !== left.usageCount()) {
            return right.usageCount() - left.usageCount();
          }
          return compareExtensionsByName(left, right);
        });
      }

      if (mode === "recent") {
        return items.sort(function(left, right) {
          if (right.lastUsed() !== left.lastUsed()) {
            return right.lastUsed() - left.lastUsed();
          }
          return compareExtensionsByName(left, right);
        });
      }

      if (mode === "profileCount") {
        return items.sort(function(left, right) {
          var leftCount = countMap[left.id()] || 0;
          var rightCount = countMap[right.id()] || 0;
          if (rightCount !== leftCount) {
            return rightCount - leftCount;
          }
          return compareExtensionsByName(left, right);
        });
      }

      return items.sort(compareExtensionsByName);
    });

    self.sortIsAlpha = ko.pureComputed(function() {
      return self.extSortMode() === "alpha";
    });

    self.sortIsPopular = ko.pureComputed(function() {
      return self.extSortMode() === "popular";
    });

    self.sortIsRecent = ko.pureComputed(function() {
      return self.extSortMode() === "recent";
    });

    self.sortIsProfileCount = ko.pureComputed(function() {
      return self.extSortMode() === "profileCount";
    });

    self.setSortAlpha = function() {
      self.extSortMode("alpha");
    };

    self.setSortPopular = function() {
      self.extSortMode("popular");
    };

    self.setSortRecent = function() {
      self.extSortMode("recent");
    };

    self.setSortProfileCount = function() {
      self.extSortMode("profileCount");
    };

    self.applyState = function(state) {
      var countMap = {};
      var currentName = self.current_name();
      self.version((state.metadata && state.metadata.version) || "");
      self.opts.apply(state.options);
      self.ext.applyState(state.extensions);
      self.profiles.applyState(state.profiles);
      self.decorateProfiles();

      self.profiles.items().forEach(function(profile) {
        if (profile.reserved()) {
          return;
        }

        profile.items().forEach(function(extensionId) {
          countMap[extensionId] = (countMap[extensionId] || 0) + 1;
        });
      });

      if (currentName && self.profiles.find(currentName)) {
        self.selectByName(currentName);
      } else if (self.profiles.items().length > 0) {
        self.current_profile(self.profiles.items()[0]);
      }

      self.extensionProfileMembership(self.buildExtensionProfileMembershipMap());
      self.profileCountMap(countMap);

      var membershipMap = self.extensionProfileMembership();
      self.ext.extensions().forEach(function(extension) {
        var memberProfiles = membershipMap[extension.id()] || {};
        var badges = self.profiles.items().filter(function(profile) {
          return !!memberProfiles[profile.name()];
        }).map(function(profile) {
          return { name: profile.short_name(), color: profile.color(), iconClass: profile.icon() };
        });
        extension.profileBadges(badges);
      });
      document.body.className = self.bodyClass();
      document.body.setAttribute("dir", self.resolvedProfileDirection());
      if (window.ExtensityTooltips && window.ExtensityTooltips.applyAutoTooltips) {
        window.ExtensityTooltips.applyAutoTooltips(document.body);
      }
      self.syncCurrentProfileFlags();
      self.loading(false);
      self.error("");
      self.checkWebStorePermission();

      self.refreshExtensionMetadata();
    };

    self.buildExtensionProfileMembershipMap = function() {
      var membership = {};
      self.profiles.items().forEach(function(profile) {
        profile.items().forEach(function(extensionId) {
          if (!membership[extensionId]) {
            membership[extensionId] = {};
          }
          membership[extensionId][profile.name()] = true;
        });
      });
      return membership;
    };

    self.assignableProfiles = ko.pureComputed(function() {
      return self.profiles.items().filter(function(profile) {
        return !profile.reserved();
      });
    });

    self.profileMembershipRows = ko.pureComputed(function() {
      var expandedId = self.expandedExtensionId();
      var memberMap = expandedId ? (self.extensionProfileMembership()[expandedId] || {}) : {};
      return self.profiles.items().map(function(profile) {
        var profileName = profile.name();
        var isMember = !!memberMap[profileName];
        return {
          label: profile.short_name() + " \u00b7 " + (isMember ? "Remove" : "Add"),
          active: isMember,
          icon: profile.icon(),
          toggleFn: function() {
            if (!expandedId) { return false; }
            self.performAction(ExtensityApi.updateExtensionProfileMembership(expandedId, profileName, !isMember));
            return false;
          }
        };
      });
    });

    self.decorateProfile = function(profile) {
      if (!profile) {
        return profile;
      }

      profile.activate = function() {
        self.select(profile);
        return false;
      };

      profile.requestRemove = function() {
        self.remove(profile);
        return false;
      };

      return profile;
    };

    self.decorateProfiles = function() {
      self.profiles.items().forEach(function(profile) {
        self.decorateProfile(profile);
      });
    };

    self.syncCurrentProfileFlags = function() {
      var currentName = self.current_name();
      self.profiles.items().forEach(function(profile) {
        profile.isActive(profile.name() === currentName);
      });
    };

    self.refreshExtensionMetadata = function() {
      var extensionIds;

      if (!self.shouldShowProfilesExtensionMetadata()) {
        return Promise.resolve();
      }

      extensionIds = self.ext.extensions().map(function(extension) {
        return extension.id();
      });

      if (!extensionIds.length) {
        return Promise.resolve();
      }

      return ExtensityApi.getExtensionMetadata(extensionIds).then(function(payload) {
        var metadata = payload.metadata || {};
        self.ext.extensions().forEach(function(extension) {
          if (metadata[extension.id()]) {
            extension.applyMetadata(metadata[extension.id()]);
          }
        });
      }).catch(function() {
        return null;
      });
    };

    self.refresh = function() {
      self.loading(true);
      self.busy(true);
      return ExtensityApi.getState().then(function(payload) {
        self.applyState(payload.state);
      }).catch(function(error) {
        self.error(error.message);
      }).finally(function() {
        self.busy(false);
      });
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

    self.saveOptionPatch = function(patch) {
      var nextOptions = self.opts.toJS();
      Object.keys(patch || {}).forEach(function(key) {
        nextOptions[key] = patch[key];
      });

      self.busy(true);
      self.error("");
      return ExtensityApi.saveOptions(nextOptions).then(function(payload) {
        self.applyState(payload.state);
        return payload;
      }).catch(function(error) {
        self.error(error.message);
        throw error;
      }).finally(function() {
        self.busy(false);
      });
    };

    self.setLayoutLandscape = function() {
      if (self.layoutIsLandscape()) {
        return Promise.resolve();
      }
      return self.saveOptionPatch({ profileDisplay: "landscape" });
    };

    self.setLayoutPortrait = function() {
      if (self.layoutIsPortrait()) {
        return Promise.resolve();
      }
      return self.saveOptionPatch({ profileDisplay: "portrait" });
    };

    self.select = function(profile) {
      self.current_profile(profile);
    };

    self.selectByName = function(name) {
      var profile = self.profiles.find(name);
      if (profile) {
        self.current_profile(profile);
      }
    };

    self.selectAlwaysOn = function() {
      self.selectByName("__always_on");
    };

    self.selectFavorites = function() {
      self.selectByName("__favorites");
    };

    self.add = function() {
      var name = (self.add_name() || "").trim();
      if (!name) {
        return;
      }

      var existing = self.profiles.find(name);
      if (existing) {
        self.current_profile(existing);
        self.add_name("");
        return;
      }

      var enabledIds = self.ext.enabled().map(function(extension) {
        return extension.id();
      });
      var profile = self.profiles.add(name, enabledIds);
      self.decorateProfile(profile);
      self.current_profile(profile);
      self.add_name("");
    };

    self.remove = function(profile) {
      var isCurrent = profile === self.current_profile();
      if (!window.confirm("Are you sure you want to remove this profile?")) {
        return;
      }

      self.profiles.remove(profile);
      if (isCurrent) {
        self.current_profile(self.profiles.items()[0] || null);
      }
    };

    self.bulkDelete = function() {
      if (!self.selectedCount()) {
        return;
      }

      if (!window.confirm("Delete the selected profiles?")) {
        return;
      }

      var currentName = self.current_name();
      self.profiles.items.remove(function(profile) {
        return profile.selected() && !profile.reserved();
      });

      if (!self.profiles.find(currentName)) {
        self.current_profile(self.profiles.items()[0] || null);
      }
    };

    self.toggleAll = function() {
      if (!self.current_profile()) {
        return;
      }

      self.current_profile().items(self.ext.extensions().map(function(extension) {
        return extension.id();
      }));
    };

    self.toggleNone = function() {
      if (!self.current_profile()) {
        return;
      }

      self.current_profile().items([]);
    };

    self.toggleExtensionDetails = function(extension) {
      var nextId = self.expandedExtensionId() === extension.id() ? null : extension.id();
      self.expandedExtensionId(nextId);
    };

    self.isExtensionExpanded = function(extensionId) {
      return self.expandedExtensionId() === extensionId;
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

    self.openManagePage = function(extension) {
      return openTab(buildManageExtensionUrl(extension.id())).catch(function(error) {
        self.error(error.message);
      });
    };

    self.openPermissionsPage = function(extension) {
      return openTab(buildPermissionsPageUrl(extension.id())).catch(function() {
        return openTab(buildManageExtensionUrl(extension.id()));
      }).catch(function(error) {
        self.error(error.message);
      });
    };

    self.canRemoveExtension = function(extension) {
      return extension.installType() !== "admin";
    };

    self.removeExtension = function(extension) {
      if (!self.canRemoveExtension(extension)) {
        return;
      }
      self.performAction(ExtensityApi.uninstallExtension(extension.id()));
    };

    self.launchOptions = function(extension) {
      return openTab(extension.optionsUrl()).catch(function(error) {
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
      copyText(extension.copyLinkUrl()).catch(function(error) {
        self.error(error.message);
      });
    };

    self.openChromeWebStore = function(extension) {
      if (!extension.storeLinkAvailable()) {
        return;
      }
      openTab(extension.storeUrl()).catch(function(error) {
        self.error(error.message);
      });
    };

    self.save = function() {
      self.busy(true);
      ExtensityStorage.saveProfiles(self.profiles.toMap(), self.profiles.toMeta()).then(function() {
        fadeOutMessage("save-result");
        return self.refresh();
      }).catch(function(error) {
        self.error(error.message);
      }).finally(function() {
        self.busy(false);
      });
    };

    self.close = function() {
      window.close();
    };

    self.current_profile.subscribe(function() {
      self.syncCurrentProfileFlags();
    });
  }

  _.defer(function() {
    var vm = new ProfilesViewModel();
    ko.bindingProvider.instance = new ko.secureBindingsProvider({});
    ko.applyBindings(vm, document.getElementById("profiles-page"));
    (new DismissalsCollection()).dismiss("profile_page_viewed");
    vm.refresh();
  });
});
