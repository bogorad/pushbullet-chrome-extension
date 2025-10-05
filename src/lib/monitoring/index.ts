/* Monitoring (TypeScript)
   Mirrors js/monitoring.js */

export class InitializationTracker {
  private initializations: Array<{ source: string; timestamp: string }> = [];
  private stats: Record<string, number> = { onInstalled: 0, onStartup: 0, onAlarm: 0, onMessage: 0, manual: 0 };

  recordInitialization(source: string) {
    this.initializations.push({ source, timestamp: new Date().toISOString() });
    if (this.stats[source] !== undefined) this.stats[source]++;
  }
  exportData() { return { initializations: this.initializations.slice(-100), stats: { ...this.stats } }; }
}

export const initTracker = new InitializationTracker();

export class WebSocketStateMonitor {
  private stateHistory: Array<{ timestamp: number; state: string | null; duration: number }>= [];
  private lastStateCheck = Date.now();
  private monitoringInterval: ReturnType<typeof setInterval> | null = null;
  private alertThresholds = { slowReceive: 15000 };

  recordStateChange(newState: string) {
    const now = Date.now();
    const prev = this.stateHistory[this.stateHistory.length - 1];
    const duration = prev ? now - prev.timestamp : 0;
    this.stateHistory.push({ timestamp: now, state: newState, duration });
    if (this.stateHistory.length > 200) this.stateHistory.shift();
  }
  getStateReport() {
    const currentState = (globalThis as any).websocket && typeof (globalThis as any).websocket.readyState === 'number'
      ? ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][(globalThis as any).websocket.readyState] : 'NULL';
    return { currentState, lastCheck: new Date(this.lastStateCheck).toISOString(), historyLength: this.stateHistory.length };
  }
  startMonitoring() {
    if (this.monitoringInterval) return;
    this.monitoringInterval = setInterval(() => {
      this.lastStateCheck = Date.now();
      const state = (globalThis as any).websocket ? (globalThis as any).websocket.readyState : null;
      try { (globalThis as any).debugLogger?.websocket('DEBUG', 'WebSocket state check', { state }); } catch { /* noop */ }
    }, 30000);
  }
  stopMonitoring() { if (this.monitoringInterval) { clearInterval(this.monitoringInterval); this.monitoringInterval = null; } }
}

export const wsStateMonitor = new WebSocketStateMonitor();

