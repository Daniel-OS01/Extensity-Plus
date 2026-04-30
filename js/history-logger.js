(function(root) {
  var storage = root.ExtensityStorage;
  var maxRecords = 500;

  function safeJson(value) {
    try {
      return JSON.stringify(value);
    } catch (error) {
      return "";
    }
  }

  function createEventRecord(payload) {
    var event = payload || {};
    return {
      action: event.action || event.triggeredBy || "manual",
      debug: event.debug ? safeJson(event.debug) : "",
      event: event.event || "info",
      extensionId: event.extensionId || null,
      extensionName: event.extensionName || "",
      id: storage.makeId("history"),
      label: event.label || "",
      nextEnabled: typeof event.nextEnabled === "boolean" ? event.nextEnabled : null,
      previousEnabled: typeof event.previousEnabled === "boolean" ? event.previousEnabled : null,
      profileId: event.profileId || null,
      result: event.result || "",
      ruleId: event.ruleId || null,
      ruleName: event.ruleName || null,
      tabId: event.tabId != null ? event.tabId : null,
      timestamp: Date.now(),
      triggeredBy: event.triggeredBy || "manual",
      url: event.url || ""
    };
  }

  function createRecords(changes, context) {
    var source = context && context.source ? context.source : "manual";
    var action = context && context.action ? context.action : source;
    var debugVerbose = !!(context && context.debugVerbose);
    return changes.map(function(change) {
      return createEventRecord({
        action: action,
        debug: debugVerbose ? {
          action: action,
          contextRuleId: context && context.ruleId ? context.ruleId : null,
          previousEnabled: !!change.previousEnabled,
          ruleName: change.ruleName || (context && context.ruleName) || null,
          source: source,
          tabId: change.tabId != null ? change.tabId : (context && context.tabId != null ? context.tabId : null),
          url: change.url || (context && context.url) || ""
        } : null,
        event: change.enabled ? "enabled" : "disabled",
        extensionId: change.id,
        extensionName: change.name,
        nextEnabled: !!change.enabled,
        previousEnabled: !!change.previousEnabled,
        profileId: change.profileId || (context && context.profileId) || null,
        result: change.enabled ? "state_changed_on" : "state_changed_off",
        ruleId: change.ruleId || (context && context.ruleId) || null,
        ruleName: change.ruleName || (context && context.ruleName) || null,
        tabId: change.tabId != null ? change.tabId : (context && context.tabId != null ? context.tabId : null),
        triggeredBy: source,
        url: change.url || (context && context.url) || ""
      });
    });
  }

  function appendHistory(existing, records) {
    var list = Array.isArray(existing) ? existing.slice() : [];
    return list.concat(records).slice(-maxRecords);
  }

  root.ExtensityHistory = {
    appendHistory: appendHistory,
    createEventRecord: createEventRecord,
    createRecords: createRecords
  };
})(typeof window !== "undefined" ? window : self);
