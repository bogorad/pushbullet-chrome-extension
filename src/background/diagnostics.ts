import { storageRepository } from '../infrastructure/storage/storage.repository';
import { clearOpenedMRU } from '../infrastructure/storage/opened-mru.repository';
import { debugConfigManager, debugLogger } from '../lib/logging';
import { isValidSender } from '../lib/security/message-validation';

type DiagnosticsMessage = {
  type: 'diag:dump-autoopen' | 'diag:clear-mru';
};

function isDiagnosticsMessage(msg: unknown): msg is DiagnosticsMessage {
  if (!msg || typeof msg !== 'object') {
    return false;
  }

  const { type } = msg as { type?: unknown };
  return type === 'diag:dump-autoopen' || type === 'diag:clear-mru';
}

function areDiagnosticsEnabled(): boolean {
  // Documented source: Options/debug dashboard update DEBUG_CONFIG.enabled via debugConfigManager.
  return debugConfigManager.getConfig().enabled;
}

export function installDiagnosticsMessageHandler(): void {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!isDiagnosticsMessage(msg)) {
      return false;
    }

    if (!isValidSender(sender)) {
      sendResponse({ ok: false, error: 'unauthorized' });
      return false;
    }

    if (!areDiagnosticsEnabled()) {
      sendResponse({ ok: false, error: 'diagnostics_disabled' });
      return false;
    }

    void (async () => {
      if (msg.type === 'diag:dump-autoopen') {
        const snap = await storageRepository.getAutoOpenDebugSnapshot();
        debugLogger.general('INFO', 'DIAG auto-open snapshot', snap);
        sendResponse({ ok: true, snap });
      } else if (msg.type === 'diag:clear-mru') {
        await clearOpenedMRU();
        debugLogger.general('WARN', 'DIAG MRU cleared by developer action');
        const snap = await storageRepository.getAutoOpenDebugSnapshot();
        debugLogger.general('INFO', 'DIAG auto-open snapshot (post-clear)', snap);
        sendResponse({ ok: true, snap });
      }
    })().catch((error: unknown) => {
      debugLogger.general('ERROR', 'DIAG command failed', { type: msg.type }, error as Error);
      sendResponse({ ok: false, error: 'diagnostics_failed' });
    });
    return true; // async
  });
}
