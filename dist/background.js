"use strict";
(() => {
  // src/background/index.ts
  try {
    importScripts("background.js");
  } catch (e) {
    console.error("Failed to import legacy background.js", e);
  }
})();
//# sourceMappingURL=background.js.map
