(function(root) {
  var storage = root.ExtensityStorage;
  var supportedVersion = "2.0.0";

  function csvEscape(value) {
    var text = value == null ? "" : String(value);
    return '"' + text.replace(/"/g, '""') + '"';
  }

  function buildExtensionStateMap(extensions) {
    return extensions.reduce(function(result, extension) {
      if (!extension.mayDisable || extension.isApp) {
        return result;
      }
      result[extension.id] = !!extension.enabled;
      return result;
    }, {});
  }

  function buildBackupEnvelope(state) {
    return {
      version: supportedVersion,
      exportedAt: Date.now(),
      settings: storage.clone(state.options),
      profiles: storage.clone(state.profiles.map),
      aliases: storage.clone(state.localState.aliases),
      groups: storage.clone(state.localState.groups),
      groupOrder: storage.clone(state.localState.groupOrder),
      urlRules: storage.clone(state.localState.urlRules),
      localState: {
        activeProfile: state.options.activeProfile,
        eventHistory: storage.clone(state.localState.eventHistory),
        extensionStates: buildExtensionStateMap(state.extensions),
        reminderQueue: storage.clone(state.localState.reminderQueue),
        recentlyUsed: storage.clone(state.localState.recentlyUsed),
        undoStack: storage.clone(state.localState.undoStack),
        usageCounters: storage.clone(state.localState.usageCounters)
      }
    };
  }

  function validateBackupEnvelope(envelope) {
    if (!envelope || Object.prototype.toString.call(envelope) !== "[object Object]") {
      throw new Error("Backup payload must be a JSON object.");
    }

    if (envelope.version !== supportedVersion) {
      throw new Error("Unsupported backup version: " + envelope.version);
    }

    if (!envelope.settings || !envelope.profiles || !envelope.localState) {
      throw new Error("Backup payload is missing required keys.");
    }

    return {
      aliases: envelope.aliases || {},
      groupOrder: Array.isArray(envelope.groupOrder) ? envelope.groupOrder : [],
      groups: envelope.groups || {},
      localState: envelope.localState,
      profiles: storage.normalizeProfileMap(envelope.profiles),
      settings: envelope.settings,
      urlRules: Array.isArray(envelope.urlRules) ? envelope.urlRules : [],
      version: envelope.version
    };
  }

  function buildExtensionsCsv(extensions) {
    var header = [
      "id",
      "name",
      "alias",
      "enabled",
      "type",
      "usageCount",
      "lastUsed",
      "groups"
    ];

    var rows = extensions.map(function(extension) {
      return [
        csvEscape(extension.id),
        csvEscape(extension.name),
        csvEscape(extension.alias || ""),
        csvEscape(extension.enabled),
        csvEscape(extension.type),
        csvEscape(extension.usageCount || 0),
        csvEscape(extension.lastUsed || 0),
        csvEscape((extension.groupIds || []).join("|"))
      ].join(",");
    });

    return [header.join(",")].concat(rows).join("\n");
  }

  root.ExtensityImportExport = {
    buildBackupEnvelope: buildBackupEnvelope,
    buildExtensionsCsv: buildExtensionsCsv,
    validateBackupEnvelope: validateBackupEnvelope,
    _csvEscape: csvEscape
  };
})(typeof window !== "undefined" ? window : self);
