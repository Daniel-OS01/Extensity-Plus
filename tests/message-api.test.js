function createChromeStub() {
    return {
        management: {},
        permissions: {
          contains(permissionObject, callback) {
            callback(false);
          }
        },
        runtime: {}
    };
}