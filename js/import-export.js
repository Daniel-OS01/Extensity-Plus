(function(root) {
  var storage = root.ExtensityStorage;
  var supportedVersion = "2.0.0";
  var supportedScopes = ["full", "profiles", "settings", "profiles_settings", "url_rules"];

  function csvEscape(value) {
    var text = value == null ? "" : String(value);
    return '"' + text.replace(/"/g, '""') + '"';
  }

  function isObject(value) {
    return value && Object.prototype.toString.call(value) === "[object Object]";
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
    var envelope = {
      version: supportedVersion,
      exportedAt: Date.now(),
      exportScope: "full",
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
    return envelope;
  }

  function buildScopedExport(state, exportScope) {
    var scope = exportScope || "full";
    var payload = {
      version: supportedVersion,
      exportedAt: Date.now()
    };

    if (scope === "full") {
      return buildBackupEnvelope(state);
    }

    payload.exportScope = scope;

    if (scope === "profiles") {
      payload.profiles = storage.clone(state.profiles.map);
      return payload;
    }

    if (scope === "settings") {
      payload.settings = storage.clone(state.options);
      return payload;
    }

    if (scope === "profiles_settings") {
      payload.profiles = storage.clone(state.profiles.map);
      payload.settings = storage.clone(state.options);
      return payload;
    }

    if (scope === "url_rules") {
      payload.urlRules = storage.clone(state.localState.urlRules || []);
      return payload;
    }

    throw new Error("Unknown export scope: " + scope);
  }

  function detectImportScope(envelope) {
    if (supportedScopes.indexOf(envelope.exportScope) >= 0) {
      return envelope.exportScope;
    }

    var hasProfiles = isObject(envelope.profiles);
    var hasSettings = isObject(envelope.settings);
    var hasLocalState = isObject(envelope.localState);
    var hasUrlRules = Array.isArray(envelope.urlRules);

    if (hasProfiles && hasSettings && hasLocalState) {
      return "full";
    }
    if (hasProfiles && hasSettings) {
      return "profiles_settings";
    }
    if (hasProfiles) {
      return "profiles";
    }
    if (hasSettings) {
      return "settings";
    }
    // Checked last so a full or profiles/settings backup that also carries urlRules is
    // still detected by its richer scope.
    if (hasUrlRules) {
      return "url_rules";
    }

    throw new Error("Unrecognized backup JSON. Expected profiles, settings and/or URL rules, or a full backup with localState.");
  }

  function normalizeFullEnvelope(envelope) {
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

  function validateImportPayload(envelope) {
    if (!envelope || Object.prototype.toString.call(envelope) !== "[object Object]") {
      throw new Error("Backup payload must be a JSON object.");
    }

    if (envelope.version !== supportedVersion) {
      throw new Error("Unsupported backup version: " + envelope.version);
    }

    var scope = detectImportScope(envelope);

    if (scope === "full") {
      return Object.assign({ scope: "full" }, normalizeFullEnvelope(envelope));
    }

    var result = {
      scope: scope,
      version: envelope.version
    };

    if (scope === "profiles" || scope === "profiles_settings") {
      result.profiles = storage.normalizeProfileMap(envelope.profiles);
    }

    if (scope === "settings" || scope === "profiles_settings") {
      result.settings = envelope.settings;
    }

    if (scope === "url_rules") {
      result.urlRules = Array.isArray(envelope.urlRules) ? storage.clone(envelope.urlRules) : [];
    }

    return result;
  }

  function validateBackupEnvelope(envelope) {
    var validated = validateImportPayload(envelope);
    if (validated.scope !== "full") {
      throw new Error("Backup payload is missing required keys.");
    }

    return {
      aliases: validated.aliases,
      groupOrder: validated.groupOrder,
      groups: validated.groups,
      localState: validated.localState,
      profiles: validated.profiles,
      settings: validated.settings,
      urlRules: validated.urlRules,
      version: validated.version
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
    buildScopedExport: buildScopedExport,
    buildExtensionsCsv: buildExtensionsCsv,
    detectImportScope: detectImportScope,
    validateBackupEnvelope: validateBackupEnvelope,
    validateImportPayload: validateImportPayload,
    _csvEscape: csvEscape
  };
})(typeof window !== "undefined" ? window : self);
