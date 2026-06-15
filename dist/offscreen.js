"use strict";
(() => {
  // src/offscreen/index.ts
  var OFFSCREEN_TARGET = "offscreen";
  var COPY_TEXT_MESSAGE = "copy-text-to-clipboard";
  function isClipboardCopyMessage(message) {
    if (!message || typeof message !== "object") {
      return false;
    }
    const candidate = message;
    return candidate.target === OFFSCREEN_TARGET && candidate.type === COPY_TEXT_MESSAGE && typeof candidate.text === "string";
  }
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isClipboardCopyMessage(message)) {
      return false;
    }
    void (async () => {
      const response = { success: false };
      try {
        await navigator.clipboard.writeText(message.text);
        response.success = true;
      } catch (error) {
        response.error = error.message;
      }
      sendResponse(response);
    })();
    return true;
  });
})();
//# sourceMappingURL=offscreen.js.map
