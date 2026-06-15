const OFFSCREEN_TARGET = "offscreen";
const COPY_TEXT_MESSAGE = "copy-text-to-clipboard";

interface ClipboardCopyMessage {
  target?: string;
  type?: string;
  text?: unknown;
}

interface ClipboardCopyResponse {
  success: boolean;
  error?: string;
}

function isClipboardCopyMessage(
  message: unknown,
): message is ClipboardCopyMessage & { text: string } {
  if (!message || typeof message !== "object") {
    return false;
  }

  const candidate = message as ClipboardCopyMessage;
  return (
    candidate.target === OFFSCREEN_TARGET &&
    candidate.type === COPY_TEXT_MESSAGE &&
    typeof candidate.text === "string"
  );
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isClipboardCopyMessage(message)) {
    return false;
  }

  void (async () => {
    const response: ClipboardCopyResponse = { success: false };
    try {
      await navigator.clipboard.writeText(message.text);
      response.success = true;
    } catch (error) {
      response.error = (error as Error).message;
    }

    sendResponse(response);
  })();

  return true;
});
