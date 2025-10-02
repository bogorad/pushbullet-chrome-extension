/* Performance monitoring (TypeScript)
   Mirrors js/performance.js */

export class PerformanceMonitor {
  private metrics = new Map<string, number>();
  private notificationTimeline: Array<{ ts: number; event: string }>= [];
  private websocketMetrics = { connectionAttempts: 0, successfulConnections: 0, messagesReceived: 0, messagesProcessed: 0, reconnectionAttempts: 0, lastConnectionTime: null as number | null, totalDowntime: 0 };
  private notificationMetrics = { pushesReceived: 0, notificationsCreated: 0, notificationsFailed: 0, unknownTypes: 0 };
  private healthChecks = { success: 0, failure: 0, lastCheck: null as number | null };
  private quality = { disconnections: 0, permanentErrors: 0, consecutiveFailures: 0 };
  private timers: Record<string, number> = {};

  record(metric: string, value = 1) { const cur = this.metrics.get(metric) || 0; this.metrics.set(metric, cur + value); }
  start(name: string) { this.timers[name] = Date.now(); }
  end(name: string) { if (this.timers[name]) { const d = Date.now() - this.timers[name]; delete this.timers[name]; this.record(`timer:${name}`, d); return d; } return null; }
  recordWebSocketConnection(success: boolean) { this.websocketMetrics.connectionAttempts++; if (success) { this.websocketMetrics.successfulConnections++; this.websocketMetrics.lastConnectionTime = Date.now(); this.quality.consecutiveFailures = 0; } }
  recordWebSocketMessage(received = true, processed = false) { if (received) this.websocketMetrics.messagesReceived++; if (processed) this.websocketMetrics.messagesProcessed++; }
  recordWebSocketReconnection() { this.websocketMetrics.reconnectionAttempts++; this.quality.consecutiveFailures++; }
  recordHealthCheckSuccess() { this.healthChecks.success++; this.healthChecks.lastCheck = Date.now(); this.quality.consecutiveFailures = 0; }
  recordHealthCheckFailure() { this.healthChecks.failure++; this.healthChecks.lastCheck = Date.now(); this.quality.consecutiveFailures++; }
  recordDisconnection() { this.quality.disconnections++; }
  recordPermanentError() { this.quality.permanentErrors++; }
  recordNotification(event: string) { this.notificationTimeline.push({ ts: Date.now(), event }); if (this.notificationTimeline.length > 200) this.notificationTimeline.shift(); }
  getPerformanceSummary() { return { websocket: this.websocketMetrics, health: this.healthChecks, quality: this.quality, metrics: Object.fromEntries(this.metrics) as Record<string, number> }; }
  getQualityMetrics() { return this.quality; }
  exportPerformanceData() { return { summary: this.getPerformanceSummary(), timeline: this.notificationTimeline.slice(-200) }; }
}

export const performanceMonitor = new PerformanceMonitor();

