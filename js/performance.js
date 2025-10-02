// Performance monitoring module
// Provides: PerformanceMonitor class and performanceMonitor instance

class PerformanceMonitor {
  constructor() {
    this.metrics = new Map();
    this.notificationTimeline = [];
    this.websocketMetrics = { connectionAttempts: 0, successfulConnections: 0, messagesReceived: 0, messagesProcessed: 0, reconnectionAttempts: 0, lastConnectionTime: null, totalDowntime: 0 };
    this.notificationMetrics = { pushesReceived: 0, notificationsCreated: 0, notificationsFailed: 0, unknownTypes: 0 };
    this.healthChecks = { success: 0, failure: 0, lastCheck: null };
    this.quality = { disconnections: 0, permanentErrors: 0, consecutiveFailures: 0 };
    this.timers = {};
  }
  record(metric, value = 1) { const cur = this.metrics.get(metric) || 0; this.metrics.set(metric, cur + value); }
  start(name) { this.timers[name] = Date.now(); }
  end(name) { if (this.timers[name]) { const d = Date.now() - this.timers[name]; delete this.timers[name]; this.record(`timer:${name}`, d); return d; } return null; }
  recordWebSocketConnection(success) { this.websocketMetrics.connectionAttempts++; if (success) { this.websocketMetrics.successfulConnections++; this.websocketMetrics.lastConnectionTime = Date.now(); this.quality.consecutiveFailures = 0; } }
  recordWebSocketMessage(received = true, processed = false) { if (received) this.websocketMetrics.messagesReceived++; if (processed) this.websocketMetrics.messagesProcessed++; }
  recordWebSocketReconnection() { this.websocketMetrics.reconnectionAttempts++; this.quality.consecutiveFailures++; }
  recordHealthCheckSuccess() { this.healthChecks.success++; this.healthChecks.lastCheck = Date.now(); this.quality.consecutiveFailures = 0; }
  recordHealthCheckFailure() { this.healthChecks.failure++; this.healthChecks.lastCheck = Date.now(); this.quality.consecutiveFailures++; }
  recordDisconnection() { this.quality.disconnections++; }
  recordPermanentError() { this.quality.permanentErrors++; }
  recordNotification(event) { this.notificationTimeline.push({ ts: Date.now(), event }); if (this.notificationTimeline.length > 200) this.notificationTimeline.shift(); }
  getPerformanceSummary() { return { websocket: this.websocketMetrics, health: this.healthChecks, quality: this.quality, metrics: Object.fromEntries(this.metrics) }; }
  getQualityMetrics() { return this.quality; }
  exportPerformanceData() { return { summary: this.getPerformanceSummary(), timeline: this.notificationTimeline.slice(-200) }; }
}

const performanceMonitor = new PerformanceMonitor();

