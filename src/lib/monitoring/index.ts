/* Monitoring (TypeScript)
   Mirrors js/monitoring.js */

import { debugLogger } from '../logging';
import { globalEventBus } from '../events/event-bus';

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

type WebSocketStateSource = () => number | string | null;

const READY_STATE_NAMES = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'];
const EVENT_STATE_NAMES: Record<string, string> = {
  connected: 'OPEN',
  disconnected: 'CLOSED',
  'permanent-error': 'CLOSED',
};

export class WebSocketStateMonitor {
  private stateHistory: Array<{ timestamp: number; state: string | null; duration: number }>= [];
  private lastStateCheck = Date.now();
  private monitoringInterval: ReturnType<typeof setInterval> | null = null;
  private alertThresholds = { slowReceive: 15000 };
  private currentState: string | null = null;

  constructor(private readonly stateSource?: WebSocketStateSource) {}

  recordStateChange(newState: number | string | null) {
    const now = Date.now();
    const prev = this.stateHistory[this.stateHistory.length - 1];
    const duration = prev ? now - prev.timestamp : 0;
    const state = this.normalizeState(newState);
    this.currentState = state;
    this.stateHistory.push({ timestamp: now, state, duration });
    if (this.stateHistory.length > 200) this.stateHistory.shift();
  }
  setCurrentState(newState: number | string | null) { this.recordStateChange(newState); }
  getStateReport() {
    const currentState = this.getCurrentState();
    return { currentState, lastCheck: new Date(this.lastStateCheck).toISOString(), historyLength: this.stateHistory.length };
  }
  startMonitoring() {
    if (this.monitoringInterval) return;
    this.monitoringInterval = setInterval(() => {
      this.lastStateCheck = Date.now();
      const state = this.getCurrentState();
      try { debugLogger.websocket('DEBUG', 'WebSocket state check', { state }); } catch (error) {
        // Log the error with context - this is a monitoring operation that shouldn't fail the main flow
        debugLogger.general('WARN', 'Failed to log WebSocket state check', null, error as Error);
      }
    }, 30000);
  }
  stopMonitoring() { if (this.monitoringInterval) { clearInterval(this.monitoringInterval); this.monitoringInterval = null; } }

  private getCurrentState(): string {
    if (this.stateSource) return this.normalizeState(this.stateSource()) ?? 'NULL';
    return this.currentState ?? 'NULL';
  }

  private normalizeState(state: number | string | null): string | null {
    if (state === null) return null;
    if (typeof state === 'number') return READY_STATE_NAMES[state] ?? 'NULL';
    return EVENT_STATE_NAMES[state] ?? state;
  }
}

export const wsStateMonitor = new WebSocketStateMonitor();

globalEventBus.on('websocket:state', (state: string) => {
  wsStateMonitor.recordStateChange(state);
});
