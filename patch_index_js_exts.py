import re

with open("js/index.js", "r") as f:
    content = f.read()

ext_decoration_code = """
      self.exts.items().forEach(function(ext) {
        if (!ext._popupDecorated) {
          ext.showDefaultRow = ko.pureComputed(function() { return !self.isCompactPopupList() && !self.isTablePopupList(); });
          ext.showTableRow = ko.pureComputed(self.isTablePopupList);
          ext.showCompactRow = ko.pureComputed(self.isCompactPopupList);
          ext.rowExpanded = ko.pureComputed(function() { return self.expandedExtensionId() === ext.id(); });
          ext.rowClick = function() { self.toggleExtension(ext); };
          ext.rowKeydown = function(item, event) { self.handleRowKeydown(ext, event); };
          ext.compactRowKeydown = function(item, event) { self.handleCompactRowKeydown(ext, event); };
          ext.tableRowKeydown = function(item, event) { self.handleTableRowKeydown(ext, event); };
          ext.toggleCompactAction = function() { self.toggleCompactExtension(ext); };
          ext.toggleTableRowAction = function() { self.toggleTableRow(ext); };
          ext.toggleCompactRowAction = function() { self.toggleCompactRow(ext); };
          ext.openManageAction = function() { self.openManagePage(ext); };
          ext.openPermissionsAction = function() { self.openPermissionsPage(ext); };
          ext.copyLinkAction = function() { self.copyExtensionLink(ext); };
          ext.openStoreAction = function() { self.openChromeWebStore(ext); };
          ext.removeAction = function() { self.removeExtension(ext); };
          ext.launchOptionsAction = function() { self.launchOptions(ext); };
          ext.launchAppAction = function() { self.launchApp(ext); };

          ext.showVersionCategoryLine = ko.pureComputed(function() { return self.opts.showPopupVersionChips() && ext.versionCategoryLine(); });
          ext.showVersionChip = ko.pureComputed(function() { return self.opts.showPopupVersionChips() && ext.version(); });
          ext.showCategorySubtitle = ko.pureComputed(function() { return self.opts.showPopupVersionChips() && ext.category(); });
          ext.showOptions = ko.pureComputed(self.opts.showOptions);

          ext.profileDropdownOptions = ko.pureComputed(function() {
            var memberMap = self.extensionProfileMembership()[ext.id()] || {};
            return self.profiles.items().filter(function(profile) {
              return !profile.reserved();
            }).map(function(profile) {
              var profileName = profile.name();
              var isMember = !!memberMap[profileName];
              return {
                label: (isMember ? "\\u2713 " : "\\u2003") + profile.short_name(),
                value: profileName
              };
            });
          });

          ext.onProfileMembershipChange = function(data, event) {
            var selectedName = event.target.value;
            event.target.value = "";
            if (!selectedName) { return false; }
            var memberMap = self.extensionProfileMembership()[ext.id()] || {};
            var isMember = !!memberMap[selectedName];
            self.performAction(ExtensityApi.updateExtensionProfileMembership(ext.id(), selectedName, !isMember));
            return false;
          };

          ext.zebraOdd = ko.observable(false);
          ext.zebraEven = ko.observable(false);

          ext._popupDecorated = true;
        }

        var badges = (profileMap[ext.id()] || []).slice();
"""

content = content.replace(
"""
      self.exts.items().forEach(function(ext) {
        var badges = (profileMap[ext.id()] || []).slice();""", ext_decoration_code)

def replace_zebra(match):
    prefix = match.group(1)
    func_body = match.group(2)
    suffix = match.group(3)

    replacement = """
    self.%s = ko.computed(function() {
      var arr = %s;
      arr.forEach(function(item, i) {
        if (item.zebraOdd) {
          item.zebraOdd(i %% 2 === 0);
          item.zebraEven(i %% 2 === 1);
        }
      });
      return arr;
    }).extend({ countable: null });
""" % (prefix, func_body)
    return replacement

content = re.sub(r'self\.listedExtensions = ko\.computed\(function\(\) \{\s*return (.*?);\s*\}\)\.extend\(\{ countable: null \}\);',
                 lambda m: "self.listedExtensions = ko.computed(function() { var arr = " + m.group(1) + "; arr.forEach(function(item, i) { if (item.zebraOdd) { item.zebraOdd(i % 2 === 0); item.zebraEven(i % 2 === 1); } }); return arr; }).extend({ countable: null });", content)

content = re.sub(r'self\.listedApps = ko\.computed\(function\(\) \{\s*return (.*?);\s*\}\)\.extend\(\{ countable: null \}\);',
                 lambda m: "self.listedApps = ko.computed(function() { var arr = " + m.group(1) + "; arr.forEach(function(item, i) { if (item.zebraOdd) { item.zebraOdd(i % 2 === 0); item.zebraEven(i % 2 === 1); } }); return arr; }).extend({ countable: null });", content)

content = re.sub(r'self\.listedItems = ko\.computed\(function\(\) \{\s*return (.*?);\s*\}\)\.extend\(\{ countable: null \}\);',
                 lambda m: "self.listedItems = ko.computed(function() { var arr = " + m.group(1) + "; arr.forEach(function(item, i) { if (item.zebraOdd) { item.zebraOdd(i % 2 === 0); item.zebraEven(i % 2 === 1); } }); return arr; }).extend({ countable: null });", content)

content = re.sub(r'self\.listedFavorites = ko\.computed\(function\(\) \{\s*return (.*?);\s*\}\)\.extend\(\{ countable: null \}\);',
                 lambda m: "self.listedFavorites = ko.computed(function() { var arr = " + m.group(1) + "; arr.forEach(function(item, i) { if (item.zebraOdd) { item.zebraOdd(i % 2 === 0); item.zebraEven(i % 2 === 1); } }); return arr; }).extend({ countable: null });", content)


with open("js/index.js", "w") as f:
    f.write(content)
