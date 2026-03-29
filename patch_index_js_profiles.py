import re

with open("js/index.js", "r") as f:
    content = f.read()

profile_decoration_code = """
      // Compute profile membership badges for each extension
      var profileMap = {};
      var colorIndex = 0;
      var badgeMode = self.opts.popupProfileBadgeTextMode();
      var singleWordChars = self.opts.popupProfileBadgeSingleWordChars();
      self.profiles.items().forEach(function(profile) {
        if (!profile._popupDecorated) {
          profile.selectProfile = function() { self.setProfile(profile); };
          profile.showPillCheck = ko.pureComputed(function() { return self.showProfilePillCheck(profile); });
          profile.showAlwaysOnIcon = ko.pureComputed(function() { return self.showProfilePillReservedIcon(profile, '__always_on'); });
          profile.showFavoritesIcon = ko.pureComputed(function() { return self.showProfilePillReservedIcon(profile, '__favorites'); });
          profile.showCustomIcon = ko.pureComputed(function() { return self.showProfilePillCustomIcon(profile); });
          profile.showPillText = ko.pureComputed(self.showProfilePillText);
          profile.showPillCount = ko.pureComputed(self.showProfilePillText);
          profile._popupDecorated = true;
        }

        if (!profile.reserved()) {
"""

content = content.replace(
"""
      // Compute profile membership badges for each extension
      var profileMap = {};
      var colorIndex = 0;
      var badgeMode = self.opts.popupProfileBadgeTextMode();
      var singleWordChars = self.opts.popupProfileBadgeSingleWordChars();
      self.profiles.items().forEach(function(profile) {
        if (!profile.reserved()) {""", profile_decoration_code)

with open("js/index.js", "w") as f:
    f.write(content)
