/* global chrome, WEBSOCKET_URL, WS_READY_STATE, apiKey, websocket, reconnectAttempts, reconnectTimeout, performanceMonitor, wsStateMonitor, debugLogger, sessionCache, refreshPushes, fetchDevices, ensureConfigLoaded, stopPollingMode, checkPollingMode, showPushNotification, clearErrorBadge, showPermanentWebSocketError, updatePopupConnectionState */

function connectWebSocket() {
  try {
    if (!apiKey) {
      debugLogger.websocket('WARN', 'connectWebSocket called without apiKey');
      return;
    }

    // If already open, do nothing
    if (websocket && websocket.readyState === WS_READY_STATE.OPEN) {
      debugLogger.websocket('DEBUG', 'WebSocket already open');
      return;
    }

    const url = WEBSOCKET_URL + apiKey;
    debugLogger.websocket('INFO', 'Connecting to WebSocket', { url: WEBSOCKET_URL + '***' });
    reconnectAttempts = 0;

    websocket = new WebSocket(url);

    websocket.onopen = () => {
      debugLogger.websocket('INFO', 'WebSocket connection established', { timestamp: new Date().toISOString() });
      performanceMonitor.recordWebSocketConnection(true);
      wsStateMonitor.startMonitoring();
      stopPollingMode();
      try { clearErrorBadge(); } catch (_) { /* noop */ }
      chrome.alarms.clear('websocketReconnect', () => {});
      if (reconnectTimeout) { clearTimeout(reconnectTimeout); reconnectTimeout = null; }
      updatePopupConnectionState('connected');
    };

    websocket.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        debugLogger.websocket('DEBUG', 'WebSocket message received', { type: data.type, subtype: data.subtype, hasPush: !!data.push });

        switch (data.type) {
          case 'tickle':
            if (data.subtype === 'push') {
              await refreshPushes();
            } else if (data.subtype === 'device') {
              const devices = await fetchDevices();
              sessionCache.devices = devices;
              sessionCache.lastUpdated = Date.now();
              chrome.runtime.sendMessage({ action: 'sessionDataUpdated', devices: devices, userInfo: sessionCache.userInfo, recentPushes: sessionCache.recentPushes, autoOpenLinks: sessionCache.autoOpenLinks, deviceNickname: sessionCache.deviceNickname }).catch(() => {});
            }
            break;
          case 'push':
            if (data.push) {
              // Update cache (prepend)
              if (sessionCache.recentPushes) {
                sessionCache.recentPushes.unshift(data.push);
                sessionCache.lastUpdated = Date.now();
                chrome.runtime.sendMessage({ action: 'pushesUpdated', pushes: sessionCache.recentPushes }).catch(() => {});
              }
              showPushNotification(data.push);
            } else {
              debugLogger.websocket('WARN', 'Push message received without push payload');
            }
            break;
          case 'nop':
            debugLogger.websocket('DEBUG', 'Received nop (keep-alive) message', { timestamp: new Date().toISOString() });
            break;
          default:
            debugLogger.websocket('WARN', 'Unknown WebSocket message type received', { type: data.type, subtype: data.subtype, hasPayload: !!data.push });
            break;
        }
      } catch (error) {
        debugLogger.websocket('ERROR', 'Failed to process WebSocket message', null, error);
      }
    };

    websocket.onerror = (error) => {
      debugLogger.websocket('ERROR', 'WebSocket error occurred', { error: error.message || 'Unknown error', readyState: websocket ? websocket.readyState : 'null' }, error);
    };

    websocket.onclose = (event) => {
      const closeInfo = { code: event.code, reason: event.reason || 'No reason provided', wasClean: event.wasClean, timestamp: new Date().toISOString(), reconnectAttempts };
      debugLogger.websocket('WARN', 'WebSocket connection closed', closeInfo);
      performanceMonitor.recordConnectionEnd && performanceMonitor.recordConnectionEnd();
      updatePopupConnectionState('disconnected');

      // Permanent error: stop and notify
      if (event.code === 1008 || event.code === 4001 || (event.code >= 4000 && event.code < 5000)) {
        const closeInfoPermanent = { code: event.code, reason: event.reason || 'No reason provided', wasClean: event.wasClean, timestamp: new Date().toISOString() };
        debugLogger.websocket('ERROR', 'Permanent WebSocket error - stopping reconnection attempts', closeInfoPermanent);
        try { showPermanentWebSocketError(closeInfoPermanent); } catch (_) { /* noop */ }
        return;
      }

      // Transient: schedule next reconnect in ~30s (one-shot)
      reconnectAttempts++;
      performanceMonitor.recordWebSocketReconnection();
      checkPollingMode();
      debugLogger.websocket('INFO', 'Scheduling WebSocket reconnection (30s one-shot)', { attempt: reconnectAttempts, nextAttemptAt: new Date(Date.now() + 30000).toISOString() });
      chrome.alarms.create('websocketReconnect', { when: Date.now() + 30000 });
    };
  } catch (error) {
    debugLogger.websocket('ERROR', 'Failed to create WebSocket connection', { url: WEBSOCKET_URL + '***', hasApiKey: !!apiKey }, error);
  }
}

