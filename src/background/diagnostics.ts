import { storageRepository } from '../infrastructure/storage/storage.repository';
import { clearOpenedMRU } from '../infrastructure/storage/opened-mru.repository';
import { debugLogger } from '../lib/logging';

const DEV_ENABLED = true; // or read from debugConfigManager

export function installDiagnosticsMessageHandler(): void {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!DEV_ENABLED) return; // ignore in production
    (async () => {
      if (msg?.type === 'diag:dump-autoopen') {
        const snap = await storageRepository.getAutoOpenDebugSnapshot();
        debugLogger.general('INFO', 'DIAG auto-open snapshot', snap);
        sendResponse({ ok: true, snap });
      } else if (msg?.type === 'diag:clear-mru') {
        await clearOpenedMRU();
        debugLogger.general('WARN', 'DIAG MRU cleared by developer action');
        const snap = await storageRepository.getAutoOpenDebugSnapshot();
        debugLogger.general('INFO', 'DIAG auto-open snapshot (post-clear)', snap);
        sendResponse({ ok: true, snap });
      }
    })();
    return true; // async
  });
}