const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { loadBrowserScript } = require("./helpers/load-browser-script.js");

test("ExtensityReminders.isReminderAlarm", () => {
  const env = loadBrowserScript(path.join(__dirname, "../js/reminders.js"), {
    ExtensityStorage: {}
  });

  const { isReminderAlarm } = env.ExtensityReminders;

  assert.strictEqual(isReminderAlarm("extensity-reminder-123"), true);
  assert.strictEqual(isReminderAlarm("extensity-reminder-abc"), true);
  assert.strictEqual(isReminderAlarm("extensity-reminder-"), true);

  assert.strictEqual(isReminderAlarm("not-extensity-reminder-123"), false);
  assert.strictEqual(isReminderAlarm("extensity-reminder"), false);
  assert.strictEqual(isReminderAlarm("something-extensity-reminder-"), false);
  assert.strictEqual(isReminderAlarm(""), false);
});
