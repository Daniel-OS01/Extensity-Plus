(function(root) {
  var storage = root.ExtensityStorage;

  function wildcardToRegExp(pattern) {
    var escaped = String(pattern)
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*");
    return new RegExp("^" + escaped + "$");
  }

  function uniqueIds(ids) {
    return storage.uniqueArray(ids || []);
  }

  function isSupportedUrl(url) {
    try {
      var parsed = new URL(url);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch (error) {
      return false;
    }
  }

  function matchUrl(url, pattern, method) {
    if (!pattern) {
      return false;
    }

    if (method === "regex") {
      // Basic ReDoS protection: limit pattern and input length.
      if (pattern.length > 512 || (url && url.length > 2048)) {
        return false;
      }

      // Basic heuristic for dangerous nested quantifiers: (a+)+, (a*)*, etc.
      if (/(\([^\)]+[\*\+\?]\)[\*\+\?])/.test(pattern)) {
        return false;
      }

      try {
        return new RegExp(pattern).test(url);
      } catch (error) {
        return false;
      }
    }

    return wildcardToRegExp(pattern).test(url);
  }

  function normalizeRule(rule) {
    return {
      active: rule.active !== false,
      disableIds: uniqueIds(rule.disableIds),
      enableIds: uniqueIds(rule.enableIds),
      id: rule.id || storage.makeId("rule"),
      matchMethod: rule.matchMethod === "regex" ? "regex" : "wildcard",
      name: (rule.name || "").trim() || "Untitled Rule",
      timeout: typeof rule.timeout === "number" && isFinite(rule.timeout) ? Math.max(0, Math.floor(rule.timeout)) : 0,
      urlPattern: (rule.urlPattern || "").trim()
    };
  }

  function normalizeRules(rules) {
    return (Array.isArray(rules) ? rules : []).map(normalizeRule);
  }

  function analyzeUrl(url, rules) {
    var desired = {};
    var matchedRules = [];
    var perExtension = {};

    if (!isSupportedUrl(url)) {
      return {
        finalChanges: desired,
        matchedRules: matchedRules,
        perExtension: perExtension,
        result: "unsupported_url",
        url: url
      };
    }

    normalizeRules(rules).forEach(function(rule) {
      if (!rule.active || !matchUrl(url, rule.urlPattern, rule.matchMethod)) {
        return;
      }

      matchedRules.push({
        disableIds: rule.disableIds.slice(),
        enableIds: rule.enableIds.slice(),
        id: rule.id,
        matchMethod: rule.matchMethod,
        name: rule.name,
        urlPattern: rule.urlPattern
      });

      rule.enableIds.forEach(function(extensionId) {
        if (!perExtension[extensionId]) {
          perExtension[extensionId] = [];
        }
        perExtension[extensionId].push({
          enabled: true,
          ruleId: rule.id,
          ruleName: rule.name,
          urlPattern: rule.urlPattern
        });
        desired[extensionId] = { enabled: true, ruleId: rule.id, ruleName: rule.name, urlPattern: rule.urlPattern };
      });

      rule.disableIds.forEach(function(extensionId) {
        if (!perExtension[extensionId]) {
          perExtension[extensionId] = [];
        }
        perExtension[extensionId].push({
          enabled: false,
          ruleId: rule.id,
          ruleName: rule.name,
          urlPattern: rule.urlPattern
        });
        desired[extensionId] = { enabled: false, ruleId: rule.id, ruleName: rule.name, urlPattern: rule.urlPattern };
      });
    });

    return {
      finalChanges: desired,
      matchedRules: matchedRules,
      perExtension: perExtension,
      result: matchedRules.length ? "matched" : "no_match",
      url: url
    };
  }

  function resolveChanges(url, rules) {
    return analyzeUrl(url, rules).finalChanges;
  }

  root.ExtensityUrlRules = {
    analyzeUrl: analyzeUrl,
    isSupportedUrl: isSupportedUrl,
    matchUrl: matchUrl,
    normalizeRule: normalizeRule,
    normalizeRules: normalizeRules,
    resolveChanges: resolveChanges
  };
})(typeof window !== "undefined" ? window : self);
