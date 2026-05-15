(function(root) {
  root.ExtensityDriveConfig = Object.assign({
    drivePreferWebAuth: false,
    driveWebClientId: "REPLACE_WITH_DRIVE_WEB_CLIENT_ID.apps.googleusercontent.com"
  }, root.ExtensityDriveConfig || {});
})(typeof window !== "undefined" ? window : self);
