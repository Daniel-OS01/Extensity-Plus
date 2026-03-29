import re

with open("index.html", "r") as f:
    content = f.read()

# Profile bindings
content = content.replace("click: $root.setProfile", "click: selectProfile")
content = content.replace("visible: $root.showProfilePillCheck($data)", "visible: showPillCheck")
content = content.replace("visible: $root.showProfilePillReservedIcon($data, '__always_on')", "visible: showAlwaysOnIcon")
content = content.replace("visible: $root.showProfilePillReservedIcon($data, '__favorites')", "visible: showFavoritesIcon")
content = content.replace("visible: $root.showProfilePillCustomIcon($data)", "visible: showCustomIcon")
content = content.replace("visible: $root.showProfilePillText()", "visible: showPillText")

# Extension row bindings
content = content.replace("if: !$parent.isCompactPopupList() && !$parent.isTablePopupList()", "if: showDefaultRow")
content = content.replace("if: $parent.isTablePopupList()", "if: showTableRow")
content = content.replace("if: $parent.isCompactPopupList()", "if: showCompactRow")

content = content.replace("click: $parent.toggleExtension", "click: rowClick")
content = content.replace("event:{keydown: $parent.handleRowKeydown}", "event:{keydown: rowKeydown}")
content = content.replace("event:{keydown: $parent.handleCompactRowKeydown}", "event:{keydown: compactRowKeydown}")
content = content.replace("event:{keydown: $parent.handleTableRowKeydown}", "event:{keydown: tableRowKeydown}")

content = content.replace("expanded: $parent.expandedExtensionId() == id()", "expanded: rowExpanded")
content = content.replace("click: $parent.toggleCompactExtension", "click: toggleCompactAction")
content = content.replace("click: $parent.toggleTableRow", "click: toggleTableRowAction")
content = content.replace("click: $parent.toggleCompactRow", "click: toggleCompactRowAction")
content = content.replace("click: $parent.openManagePage", "click: openManageAction")
content = content.replace("click: $parent.openPermissionsPage", "click: openPermissionsAction")
content = content.replace("click: $parent.copyExtensionLink", "click: copyLinkAction")
content = content.replace("click: $parent.openChromeWebStore", "click: openStoreAction")
content = content.replace("click: $parent.removeExtension", "click: removeAction")
content = content.replace("click: $parent.launchOptions", "click: launchOptionsAction")
content = content.replace("click: $parent.launchApp", "click: launchAppAction")

content = content.replace("visible: $parent.opts.showPopupVersionChips() && versionCategoryLine", "visible: showVersionCategoryLine")
content = content.replace("visible: $parent.opts.showPopupVersionChips() && version()", "visible: showVersionChip")
content = content.replace("visible: $parent.opts.showPopupVersionChips() && category", "visible: showCategorySubtitle")

content = content.replace("visible: $parent.opts.showOptions() && optionsUrl()", "visible: showOptions() && optionsUrl()")

content = content.replace("visible: $parent.expandedExtensionId() == id()", "visible: rowExpanded")

content = content.replace("event:{change: $root.onProfileMembershipChange}", "event:{change: onProfileMembershipChange}")
content = content.replace("foreach: $root.profileDropdownOptions", "foreach: profileDropdownOptions")

content = content.replace("'zebra-odd': $index() % 2 === 0, 'zebra-even': $index() % 2 === 1", "'zebra-odd': zebraOdd, 'zebra-even': zebraEven")


with open("index.html", "w") as f:
    f.write(content)
