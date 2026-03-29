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
    self.aboutTab = ko.pureComputed(function() { return self.activeTab() === "about"; });
    self.showTabHistory = function() { self.activeTab("history"); };
    self.showTabGroups = function() { self.activeTab("groups"); };
    self.showTabRules = function() { self.activeTab("rules"); };
    self.showTabAliases = function() { self.activeTab("aliases"); };
    self.showTabData = function() { self.activeTab("data"); };
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
      self.rules(urlRules.map(function(rule) {
        var editor = new RuleEditor(rule, self.extensions());
        editor.isSelected(editor.id() === self.selectedRuleId());
        return editor;
      }));
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

    self.addRule = function() {
      self.rules.push(new RuleEditor({}));
    };

    self.removeRule = function(rule) {
      self.rules.remove(rule);
    };

    self.saveRules = function() {
      var rules = self.rules().map(function(rule) {
        return rule.toJS();
      });

      self.performAction(ExtensityApi.saveUrlRules(rules)).then(function() {
        self.message("URL rules saved.");
      }).catch(function() {});
    };

    self.exportJson = function() {
      self.performAction(ExtensityApi.exportBackup()).then(function(payload) {
        ExtensityIO.downloadText(
          ExtensityIO.exportFilename("extensity-plus-backup", "json"),
          JSON.stringify(payload.envelope, null, 2),
          "application/json;charset=utf-8"
        );
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
        self.message("Backup imported.");
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

    self.syncDrive = function() {
      self.performAction(ExtensityApi.syncDrive()).then(function() {
        self.message("Drive sync completed.");
      }).catch(function() {});
    };
  }

  _.defer(function() {
    var vm = new DashboardViewModel();
    ko.bindingProvider.instance = new ko.secureBindingsProvider({});
    ko.applyBindings(vm, document.getElementById("dashboard-page"));
    vm.refresh();
  });
});
