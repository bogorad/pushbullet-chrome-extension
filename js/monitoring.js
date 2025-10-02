// Monitoring module
// Provides: InitializationTracker + initTracker, WebSocketStateMonitor + wsStateMonitor

class InitializationTracker {
  constructor() {
    this.initializations = [];
    this.stats = { onInstalled: 0, onStartup: 0, onAlarm: 0, onMessage: 0, manual: 0 };
  }
  recordInitialization(source) {
    this.initializations.push({ source, timestamp: new Date().toISOString() });
    if (this.stats[source] !== undefined) this.stats[source]++;
  }
  exportData() { return { initializations: this.initializations.slice(-100), stats: { ...this.stats } }; }
}

const initTracker = new InitializationTracker();

class WebSocketStateMonitor {
  constructor() {
    this.stateHistory = [];
    this.lastStateCheck = Date.now();
    this.monitoringInterval = null;
    this.alertThresholds = { slowReceive: 15000 };
  }
  recordStateChange(newState) {
    const now = Date.now();
    const duration = this.stateHistory.length > 0 ? now - this.stateHistory[this.stateHistory.length - 1].timestamp : 0;
    this.stateHistory.push({ timestamp: now, state: newState, duration });
    if (this.stateHistory.length > 200) this.stateHistory.shift();
  }
  getStateReport() {
    const currentState = (self.websocket && typeof self.websocket.readyState === 'number') ? ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][self.websocket.readyState] : 'NULL';
    return { currentState, lastCheck: new Date(this.lastStateCheck).toISOString(), historyLength: this.stateHistory.length };
  }
  startMonitoring() {
    if (this.monitoringInterval) return;
    this.monitoringInterval = setInterval(() => {
      this.lastStateCheck = Date.now();
      const state = self.websocket ? self.websocket.readyState : null;
      try { debugLogger.websocket('DEBUG', 'WebSocket state check', { state }); } catch (_) { /* noop: debug logger unavailable */ }
    }, 30000);
  }
  stopMonitoring() { if (this.monitoringInterval) { clearInterval(this.monitoringInterval); this.monitoringInterval = null; } }
}

const wsStateMonitor = new WebSocketStateMonitor();

