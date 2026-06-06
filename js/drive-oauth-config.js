(function(root) {
  root.ExtensityDriveConfig = Object.assign({
    drivePreferWebAuth: false,
    driveWebClientId: "123-abc.apps.googleusercontent.com"
  }, root.ExtensityDriveConfig || {});
})(typeof window !== "undefined" ? window : self);
