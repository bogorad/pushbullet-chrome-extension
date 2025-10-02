// Reconnect helpers for MV3 service worker
// Provides ensureConfigLoaded() to rehydrate critical state after SW wakeups.

function ensureConfigLoaded() {
  return new Promise((resolve) => {
    try {
      const needsApiKey = !apiKey;
      const needsNickname = (deviceNickname === null || deviceNickname === undefined);
      const needsAutoOpen = (autoOpenLinks === null || autoOpenLinks === undefined);
      const needsTimeout = (notificationTimeout === null || notificationTimeout === undefined);
      const needsSync = needsApiKey || needsNickname || needsAutoOpen || needsTimeout;

      const finish = () => {
        try {
          debugLogger.storage('DEBUG', 'ensureConfigLoaded completed', {
            hasApiKey: !!apiKey,
            hasDeviceIden: !!deviceIden,
            autoOpenLinks,
            notificationTimeout,
            deviceNickname
          });
        } catch (err) { /* swallow logging/storage errors in ensureConfigLoaded */ }
        resolve();
      };

      const loadLocal = () => {
        chrome.storage.local.get(['deviceIden'], (lres) => {
          try {
            if (!deviceIden && lres && lres.deviceIden) {
              deviceIden = lres.deviceIden;
            }
          } catch (err) { /* swallow logging/storage errors in ensureConfigLoaded */ }
          finish();
        });
      };

      if (needsSync) {
        chrome.storage.sync.get(['apiKey','deviceNickname','autoOpenLinks','notificationTimeout'], (res) => {
          try {
            if (!apiKey && res && res.apiKey) {
              apiKey = decryptKey(res.apiKey);
            }
            if (needsNickname && res && res.deviceNickname !== undefined) {
              deviceNickname = res.deviceNickname;
              if (sessionCache) sessionCache.deviceNickname = deviceNickname;
            }
            if (needsAutoOpen && res && res.autoOpenLinks !== undefined) {
              autoOpenLinks = res.autoOpenLinks;
              if (sessionCache) sessionCache.autoOpenLinks = autoOpenLinks;
            }
            if (needsTimeout && res && res.notificationTimeout !== undefined) {
              notificationTimeout = res.notificationTimeout;
            }
          } catch (err) { /* swallow logging/storage errors in ensureConfigLoaded */ }
          loadLocal();
        });
      } else {
        loadLocal();
      }
    } catch (e) {
      try {
        debugLogger.storage('WARN', 'ensureConfigLoaded encountered an error', { error: e && e.message });
      } catch (err) { /* ignore */ }
      resolve();
    }
  });
}

