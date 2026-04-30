(function(root) {
  async function syncDrive() {
    var manifest = chrome.runtime.getManifest();
    if (!manifest.oauth2 || !manifest.oauth2.client_id) {
      throw new Error("Drive sync is not configured for this build.");
    }

    throw new Error("Drive sync requires OAuth credentials and is not enabled in this build.");
  }

  root.ExtensityDriveSync = {
    syncDrive: syncDrive
  };
})(typeof window !== "undefined" ? window : self);
