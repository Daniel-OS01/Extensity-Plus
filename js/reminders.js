(function(root) {
  var storage = root.ExtensityStorage;
  var prefix = "extensity-reminder-";

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

  function alarmNameFor(extensionId) {
    return prefix + extensionId;
  }

  function isReminderAlarm(name) {
    return name.indexOf(prefix) === 0;
  }

  function removeEntry(queue, extensionId) {
    return (Array.isArray(queue) ? queue : []).filter(function(entry) {
      return entry.extensionId !== extensionId;
    });
  }

  async function syncReminderQueue(queue, changes, options, context) {
    var source = context && context.source ? context.source : "manual";
    var nextQueue = Array.isArray(queue) ? queue.slice() : [];
    var delay = Number(options.reminderDelayMinutes || 60);

    if (!options.enableReminders) {
      await Promise.all(nextQueue.map(function(entry) {
        return chromeCall(chrome.alarms, "clear", [entry.alarmName]);
      }));
      return [];
    }

    await Promise.all(changes.map(function(change) {
      var alarmName = alarmNameFor(change.id);
      nextQueue = removeEntry(nextQueue, change.id);
      var clearPromise = chromeCall(chrome.alarms, "clear", [alarmName]);

      if (change.enabled && source === "manual") {
        chrome.alarms.create(alarmName, { delayInMinutes: delay });
        nextQueue.push({
          alarmName: alarmName,
          dismissed: false,
          enabledAt: Date.now(),
          extensionId: change.id
        });
      }

      return clearPromise;
    }));

    return nextQueue;
  }

  async function handleAlarm(alarmName) {
    var localState = await storage.loadLocalState();
    var queue = Array.isArray(localState.reminderQueue) ? localState.reminderQueue.slice() : [];
    var entry = queue.find(function(item) { return item.alarmName === alarmName; });

    if (!entry) {
      return queue;
    }

    var nextQueue = queue.map(function(item) {
      if (item.alarmName !== alarmName) {
        return item;
      }
      return {
        alarmName: item.alarmName,
        dismissed: true,
        enabledAt: item.enabledAt,
        extensionId: item.extensionId
      };
    });

    await chromeCall(chrome.notifications, "create", [
      storage.makeId("notification"),
      {
        iconUrl: "images/icon128.png",
        message: "This extension is still enabled. Review whether you still need it active.",
        title: "Extensity reminder",
        type: "basic"
      }
    ]);

    await storage.saveLocalState({ reminderQueue: nextQueue });
    return nextQueue;
  }

  root.ExtensityReminders = {
    alarmNameFor: alarmNameFor,
    handleAlarm: handleAlarm,
    isReminderAlarm: isReminderAlarm,
    syncReminderQueue: syncReminderQueue
  };
})(typeof window !== "undefined" ? window : self);
