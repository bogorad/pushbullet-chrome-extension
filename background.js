// API URL constants
const API_BASE_URL = 'https://api.pushbullet.com/v2';
const PUSHES_URL = `${API_BASE_URL}/pushes`;
const DEVICES_URL = `${API_BASE_URL}/devices`;
const USER_INFO_URL = `${API_BASE_URL}/users/me`;
const WEBSOCKET_URL = 'wss://stream.pushbullet.com/websocket/';

// Debug configuration
const DEBUG_CONFIG = {
  enabled: true,
  categories: {
    WEBSOCKET: true,
    NOTIFICATIONS: true,
    API: true,
    STORAGE: true,
    GENERAL: true,
    PERFORMANCE: true,
    ERROR: true
  },
  logLevel: 'DEBUG', // DEBUG, INFO, WARN, ERROR
  maxLogEntries: 1000,
  sanitizeData: true
};

// Debug logging utility
class DebugLogger {
  constructor() {
    this.logs = [];
    this.startTime = Date.now();
    this.performanceMarkers = new Map();
  }

  // Sanitize sensitive data
  sanitize(data) {
    if (!DEBUG_CONFIG.sanitizeData) return data;

    if (typeof data === 'string') {
      // Mask API keys (keep first 4 and last 4 characters)
      if (data.length > 20 && /^[a-zA-Z0-9_-]+$/.test(data)) {
        return data.substring(0, 4) + '***' + data.substring(data.length - 4);
      }
      return data;
    }

    if (typeof data === 'object' && data !== null) {
      const sanitized = Array.isArray(data) ? [] : {};
      for (const key in data) {
        if (key.toLowerCase().includes('token') || key.toLowerCase().includes('key') || key.toLowerCase().includes('password')) {
          sanitized[key] = this.sanitize(data[key]);
        } else {
          sanitized[key] = data[key];
        }
      }
      return sanitized;
    }

    return data;
  }

  // Get timestamp with milliseconds
  getTimestamp() {
    const now = new Date();
    const elapsed = Date.now() - this.startTime;
    return `${now.toISOString()} (+${elapsed}ms)`;
  }

  // Core logging function
  log(category, level, message, data = null, error = null) {
    if (!DEBUG_CONFIG.enabled || !DEBUG_CONFIG.categories[category]) return;

    const timestamp = this.getTimestamp();
    const logEntry = {
      timestamp,
      category,
      level,
      message,
      data: data ? this.sanitize(data) : null,
      error: error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : null
    };

    // Track errors globally
    if (error && level === 'ERROR') {
      globalErrorTracker.trackError(error, {
        category,
        message,
        data: data ? this.sanitize(data) : null
      }, category);
    }

    // Add to internal log storage
    this.logs.push(logEntry);
    if (this.logs.length > DEBUG_CONFIG.maxLogEntries) {
      this.logs.shift();
    }

    // Console output with color coding
    const colors = {
      DEBUG: '\x1b[36m', // Cyan
      INFO: '\x1b[32m',  // Green
      WARN: '\x1b[33m',  // Yellow
      ERROR: '\x1b[31m'  // Red
    };
    const reset = '\x1b[0m';
    const color = colors[level] || '';

    const prefix = `${color}[${category}:${level}]${reset} ${timestamp}`;
    const fullMessage = `${prefix} ${message}`;

    // Output to appropriate console method
    switch (level) {
    case 'ERROR':
      console.error(fullMessage, data ? this.sanitize(data) : '', error || '');
      break;
    case 'WARN':
      console.warn(fullMessage, data ? this.sanitize(data) : '');
      break;
    case 'INFO':
      console.info(fullMessage, data ? this.sanitize(data) : '');
      break;
    default:
      console.log(fullMessage, data ? this.sanitize(data) : '');
    }
  }

  // Convenience methods for different categories
  websocket(level, message, data, error) { this.log('WEBSOCKET', level, message, data, error); }
  notifications(level, message, data, error) { this.log('NOTIFICATIONS', level, message, data, error); }
  api(level, message, data, error) { this.log('API', level, message, data, error); }
  storage(level, message, data, error) { this.log('STORAGE', level, message, data, error); }
  general(level, message, data, error) { this.log('GENERAL', level, message, data, error); }
  performance(level, message, data, error) { this.log('PERFORMANCE', level, message, data, error); }
  error(message, data, error) { this.log('ERROR', 'ERROR', message, data, error); }

  // Performance tracking
  startTimer(name) {
    this.performanceMarkers.set(name, Date.now());
    this.performance('DEBUG', `Timer started: ${name}`);
  }

  endTimer(name) {
    const startTime = this.performanceMarkers.get(name);
    if (startTime) {
      const duration = Date.now() - startTime;
      this.performanceMarkers.delete(name);
      this.performance('INFO', `Timer ended: ${name}`, { duration: `${duration}ms` });
      return duration;
    }
    this.performance('WARN', `Timer not found: ${name}`);
    return null;
  }

  // Get recent logs
  getRecentLogs(count = 50, category = null) {
    let logs = this.logs;
    if (category) {
      logs = logs.filter(log => log.category === category);
    }
    return logs.slice(-count);
  }

  // Export logs for debugging
  exportLogs() {
    return {
      config: DEBUG_CONFIG,
      logs: this.logs,
      summary: {
        totalLogs: this.logs.length,
        categories: Object.keys(DEBUG_CONFIG.categories).reduce((acc, cat) => {
          acc[cat] = this.logs.filter(log => log.category === cat).length;
          return acc;
        }, {}),
        errors: this.logs.filter(log => log.level === 'ERROR').length
      }
    };
  }
}

// Global debug logger instance
const debugLogger = new DebugLogger();

// Debug configuration management
class DebugConfigManager {
  constructor() {
    this.loadConfig();
  }

  async loadConfig() {
    try {
      debugLogger.storage('DEBUG', 'Loading debug configuration from storage');
      const result = await new Promise(resolve => {
        chrome.storage.local.get(['debugConfig'], resolve);
      });

      if (result.debugConfig) {
        Object.assign(DEBUG_CONFIG, result.debugConfig);
        debugLogger.storage('INFO', 'Debug configuration loaded from storage', DEBUG_CONFIG);
      } else {
        debugLogger.storage('INFO', 'No stored debug configuration found - using defaults', DEBUG_CONFIG);
      }
    } catch (error) {
      debugLogger.storage('ERROR', 'Failed to load debug configuration', null, error);
    }
  }

  async saveConfig() {
    try {
      debugLogger.storage('DEBUG', 'Saving debug configuration to storage');
      await new Promise(resolve => {
        chrome.storage.local.set({ debugConfig: DEBUG_CONFIG }, resolve);
      });
      debugLogger.storage('INFO', 'Debug configuration saved to storage');
    } catch (error) {
      debugLogger.storage('ERROR', 'Failed to save debug configuration', null, error);
    }
  }

  updateConfig(updates) {
    Object.assign(DEBUG_CONFIG, updates);
    this.saveConfig();
    debugLogger.general('INFO', 'Debug configuration updated', updates);
  }

  toggleCategory(category) {
    if (Object.prototype.hasOwnProperty.call(DEBUG_CONFIG.categories, category)) {
      DEBUG_CONFIG.categories[category] = !DEBUG_CONFIG.categories[category];
      this.saveConfig();
      debugLogger.general('INFO', `Debug category ${category} toggled`, {
        category,
        enabled: DEBUG_CONFIG.categories[category]
      });
    }
  }

  setLogLevel(level) {
    const validLevels = ['DEBUG', 'INFO', 'WARN', 'ERROR'];
    if (validLevels.includes(level)) {
      DEBUG_CONFIG.logLevel = level;
      this.saveConfig();
      debugLogger.general('INFO', `Debug log level set to ${level}`);
    }
  }

  getConfig() {
    return { ...DEBUG_CONFIG };
  }

  resetConfig() {
    const defaultConfig = {
      enabled: true,
      categories: {
        WEBSOCKET: true,
        NOTIFICATIONS: true,
        API: true,
        STORAGE: true,
        GENERAL: true,
        PERFORMANCE: true,
        ERROR: true
      },
      logLevel: 'DEBUG',
      maxLogEntries: 1000,
      sanitizeData: true
    };

    Object.assign(DEBUG_CONFIG, defaultConfig);
    this.saveConfig();
    debugLogger.general('INFO', 'Debug configuration reset to defaults');
  }
}

// Global debug config manager
const debugConfigManager = new DebugConfigManager();

// Performance monitoring system
class PerformanceMonitor {
  constructor() {
    this.metrics = new Map();
    this.notificationTimeline = [];
    this.websocketMetrics = {
      connectionAttempts: 0,
      successfulConnections: 0,
      messagesReceived: 0,
      messagesProcessed: 0,
      reconnectionAttempts: 0,
      lastConnectionTime: null,
      totalDowntime: 0
    };
    this.notificationMetrics = {
      pushesReceived: 0,
      notificationsCreated: 0,
      notificationsFailed: 0,
      averageProcessingTime: 0,
      processingTimes: []
    };
  }

  // Track notification processing pipeline
  startNotificationProcessing(pushId, source = 'unknown') {
    const timestamp = Date.now();
    const trackingId = `notification_${pushId}_${timestamp}`;

    this.metrics.set(trackingId, {
      pushId,
      source,
      startTime: timestamp,
      stages: {
        received: timestamp,
        parsed: null,
        validated: null,
        created: null,
        displayed: null,
        failed: null
      },
      totalTime: null,
      success: null
    });

    this.notificationTimeline.push({
      trackingId,
      pushId,
      timestamp,
      stage: 'received',
      source
    });

    debugLogger.performance('DEBUG', 'Started tracking notification processing', {
      trackingId,
      pushId,
      source
    });

    return trackingId;
  }

  // Mark notification processing stage
  markNotificationStage(trackingId, stage, data = null) {
    const metric = this.metrics.get(trackingId);
    if (!metric) {
      debugLogger.performance('WARN', `Tracking ID not found: ${trackingId}`, { stage });
      return;
    }

    const timestamp = Date.now();
    metric.stages[stage] = timestamp;

    this.notificationTimeline.push({
      trackingId,
      pushId: metric.pushId,
      timestamp,
      stage,
      data
    });

    const stageTime = timestamp - (metric.stages.received || metric.startTime);
    debugLogger.performance('DEBUG', `Notification stage: ${stage}`, {
      trackingId,
      pushId: metric.pushId,
      stageTime: `${stageTime}ms`,
      data
    });
  }

  // Complete notification processing
  completeNotificationProcessing(trackingId, success = true, error = null) {
    const metric = this.metrics.get(trackingId);
    if (!metric) {
      debugLogger.performance('WARN', `Tracking ID not found: ${trackingId}`);
      return;
    }

    const timestamp = Date.now();
    metric.totalTime = timestamp - metric.startTime;
    metric.success = success;

    if (success) {
      metric.stages.displayed = timestamp;
      this.notificationMetrics.notificationsCreated++;
    } else {
      metric.stages.failed = timestamp;
      this.notificationMetrics.notificationsFailed++;
    }

    // Update processing time metrics
    this.notificationMetrics.processingTimes.push(metric.totalTime);
    if (this.notificationMetrics.processingTimes.length > 100) {
      this.notificationMetrics.processingTimes.shift();
    }

    this.notificationMetrics.averageProcessingTime =
      this.notificationMetrics.processingTimes.reduce((a, b) => a + b, 0) /
      this.notificationMetrics.processingTimes.length;

    this.notificationTimeline.push({
      trackingId,
      pushId: metric.pushId,
      timestamp,
      stage: success ? 'completed' : 'failed',
      error: error ? error.message : null
    });

    debugLogger.performance('INFO', `Notification processing ${success ? 'completed' : 'failed'}`, {
      trackingId,
      pushId: metric.pushId,
      totalTime: `${metric.totalTime}ms`,
      success,
      error: error ? error.message : null
    });

    // Clean up old metrics (keep last 50)
    if (this.metrics.size > 50) {
      const oldestKey = this.metrics.keys().next().value;
      this.metrics.delete(oldestKey);
    }
  }

  // WebSocket performance tracking
  recordWebSocketConnection(success = true) {
    this.websocketMetrics.connectionAttempts++;
    if (success) {
      this.websocketMetrics.successfulConnections++;
      this.websocketMetrics.lastConnectionTime = Date.now();
    }

    debugLogger.performance('INFO', 'WebSocket connection attempt recorded', {
      success,
      totalAttempts: this.websocketMetrics.connectionAttempts,
      successfulConnections: this.websocketMetrics.successfulConnections
    });
  }

  recordWebSocketMessage() {
    this.websocketMetrics.messagesReceived++;
    debugLogger.performance('DEBUG', 'WebSocket message received', {
      totalMessages: this.websocketMetrics.messagesReceived
    });
  }

  recordWebSocketReconnection() {
    this.websocketMetrics.reconnectionAttempts++;
    debugLogger.performance('WARN', 'WebSocket reconnection attempt', {
      totalReconnections: this.websocketMetrics.reconnectionAttempts
    });
  }

  // Get performance summary
  getPerformanceSummary() {
    return {
      websocket: { ...this.websocketMetrics },
      notifications: { ...this.notificationMetrics },
      activeTracking: this.metrics.size,
      recentTimeline: this.notificationTimeline.slice(-20)
    };
  }

  // Export detailed performance data
  exportPerformanceData() {
    return {
      websocketMetrics: this.websocketMetrics,
      notificationMetrics: this.notificationMetrics,
      activeMetrics: Array.from(this.metrics.entries()),
      fullTimeline: this.notificationTimeline,
      summary: this.getPerformanceSummary()
    };
  }
}

// Global performance monitor
const performanceMonitor = new PerformanceMonitor();

// Global error tracking and reporting
class GlobalErrorTracker {
  constructor() {
    this.errors = [];
    this.errorCounts = new Map();
    this.criticalErrors = [];
    this.lastErrorReport = Date.now();
    this.reportInterval = 5 * 60 * 1000; // 5 minutes
  }

  trackError(error, context = {}, category = 'UNKNOWN') {
    const errorInfo = {
      timestamp: Date.now(),
      message: error.message || 'Unknown error',
      stack: error.stack,
      name: error.name || 'Error',
      category,
      context: { ...context },
      id: `${category}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    };

    this.errors.push(errorInfo);
    if (this.errors.length > 200) {
      this.errors.shift();
    }

    // Count error types
    const errorKey = `${category}:${error.name}:${error.message}`;
    this.errorCounts.set(errorKey, (this.errorCounts.get(errorKey) || 0) + 1);

    // Track critical errors
    if (this.isCriticalError(error, category)) {
      this.criticalErrors.push(errorInfo);
      if (this.criticalErrors.length > 50) {
        this.criticalErrors.shift();
      }

      debugLogger.error('CRITICAL ERROR DETECTED', {
        errorId: errorInfo.id,
        category,
        message: error.message,
        context
      }, error);
    }

    debugLogger.error('Error tracked globally', {
      errorId: errorInfo.id,
      category,
      message: error.message,
      totalErrors: this.errors.length,
      errorCount: this.errorCounts.get(errorKey)
    }, error);

    // Generate periodic error reports
    this.maybeGenerateReport();

    return errorInfo.id;
  }

  isCriticalError(error, category) {
    // Define what constitutes a critical error
    const criticalPatterns = [
      /websocket.*connection.*failed/i,
      /api.*authentication.*failed/i,
      /notification.*creation.*failed/i,
      /device.*registration.*failed/i,
      /storage.*access.*denied/i
    ];

    const criticalCategories = ['WEBSOCKET', 'API', 'NOTIFICATIONS'];

    return criticalCategories.includes(category) ||
           criticalPatterns.some(pattern => pattern.test(error.message));
  }

  maybeGenerateReport() {
    const now = Date.now();
    if (now - this.lastErrorReport >= this.reportInterval) {
      this.generateErrorReport();
      this.lastErrorReport = now;
    }
  }

  generateErrorReport() {
    const now = Date.now();
    const recentErrors = this.errors.filter(e => now - e.timestamp < this.reportInterval);

    if (recentErrors.length === 0) return;

    const errorsByCategory = recentErrors.reduce((acc, error) => {
      acc[error.category] = (acc[error.category] || 0) + 1;
      return acc;
    }, {});

    const topErrors = Array.from(this.errorCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    debugLogger.error('PERIODIC ERROR REPORT', {
      reportPeriod: `${this.reportInterval / 1000}s`,
      recentErrorCount: recentErrors.length,
      totalErrorCount: this.errors.length,
      criticalErrorCount: this.criticalErrors.length,
      errorsByCategory,
      topErrors: topErrors.map(([key, count]) => ({ error: key, count })),
      timestamp: new Date().toISOString()
    });
  }

  getErrorSummary() {
    const now = Date.now();
    const last24h = this.errors.filter(e => now - e.timestamp < 24 * 60 * 60 * 1000);
    const lastHour = this.errors.filter(e => now - e.timestamp < 60 * 60 * 1000);

    return {
      total: this.errors.length,
      critical: this.criticalErrors.length,
      last24h: last24h.length,
      lastHour: lastHour.length,
      topErrors: Array.from(this.errorCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([key, count]) => ({ error: key, count })),
      recentCritical: this.criticalErrors.slice(-5)
    };
  }

  exportErrorData() {
    return {
      errors: this.errors,
      errorCounts: Array.from(this.errorCounts.entries()),
      criticalErrors: this.criticalErrors,
      summary: this.getErrorSummary()
    };
  }
}

// Global error tracker instance
const globalErrorTracker = new GlobalErrorTracker();

// Global error handler for unhandled errors
self.addEventListener('error', (event) => {
  globalErrorTracker.trackError(event.error || new Error(event.message), {
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    type: 'unhandled'
  }, 'GLOBAL');
});

// Global handler for unhandled promise rejections
self.addEventListener('unhandledrejection', (event) => {
  globalErrorTracker.trackError(event.reason || new Error('Unhandled promise rejection'), {
    type: 'unhandled_promise'
  }, 'GLOBAL');
});

// Debug information export function (accessible from console)
// Note: In Manifest V3 service workers, use globalThis instead of window
globalThis.exportDebugInfo = function() {
  return {
    debugLogs: debugLogger.exportLogs(),
    performanceData: performanceMonitor.exportPerformanceData(),
    errorData: globalErrorTracker.exportErrorData(),
    websocketState: wsStateMonitor.getStateReport(),
    notificationStats: notificationTracker.getStats(),
    sessionCache: {
      isAuthenticated: sessionCache.isAuthenticated,
      lastUpdated: sessionCache.lastUpdated ? new Date(sessionCache.lastUpdated).toISOString() : 'never',
      userInfo: sessionCache.userInfo ? { email: sessionCache.userInfo.email?.substring(0, 3) + '***' } : null,
      deviceCount: sessionCache.devices?.length || 0,
      pushCount: sessionCache.recentPushes?.length || 0,
      autoOpenLinks: sessionCache.autoOpenLinks,
      deviceNickname: sessionCache.deviceNickname
    },
    systemInfo: {
      hasApiKey: !!apiKey,
      deviceIden,
      websocketConnected: websocket ? websocket.readyState === WebSocket.OPEN : false,
      reconnectAttempts,
      timestamp: new Date().toISOString()
    }
  };
};

// Initialize debug system
debugLogger.general('INFO', 'Debug system initialized', {
  version: '1.0.0',
  startTime: new Date().toISOString(),
  config: DEBUG_CONFIG,
  exportFunction: 'globalThis.exportDebugInfo() available for debugging'
});

// Global variables
let apiKey = null;
let deviceIden = null;
let deviceNickname = 'Chrome'; // Default nickname
let websocket = null;
let reconnectAttempts = 0;
let reconnectTimeout = null;
let autoOpenLinks = true; // Default to true for auto opening links

// Session cache for quick popup loading
let sessionCache = {
  userInfo: null,
  devices: [],
  recentPushes: [],
  isAuthenticated: false,
  lastUpdated: 0,
  autoOpenLinks: true,
  deviceNickname: 'Chrome' // Default nickname
};

// WebSocket state monitoring
class WebSocketStateMonitor {
  constructor() {
    this.stateHistory = [];
    this.lastStateCheck = Date.now();
    this.monitoringInterval = null;
    this.alertThresholds = {
      maxReconnectAttempts: 10,
      maxDowntimeMinutes: 5,
      stateCheckIntervalMs: 30000 // 30 seconds
    };
  }

  startMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }

    this.monitoringInterval = setInterval(() => {
      this.checkWebSocketState();
    }, this.alertThresholds.stateCheckIntervalMs);

    debugLogger.websocket('INFO', 'WebSocket state monitoring started', {
      checkInterval: `${this.alertThresholds.stateCheckIntervalMs}ms`
    });
  }

  stopMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
      debugLogger.websocket('INFO', 'WebSocket state monitoring stopped');
    }
  }

  checkWebSocketState() {
    const now = Date.now();
    const state = {
      timestamp: now,
      readyState: websocket ? websocket.readyState : null,
      stateText: websocket ? ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][websocket.readyState] : 'NULL',
      hasApiKey: !!apiKey,
      reconnectAttempts,
      timeSinceLastCheck: now - this.lastStateCheck
    };

    this.stateHistory.push(state);
    if (this.stateHistory.length > 100) {
      this.stateHistory.shift();
    }

    // Check for concerning patterns
    this.analyzeStatePatterns(state);

    this.lastStateCheck = now;

    debugLogger.websocket('DEBUG', 'WebSocket state check', state);
  }

  analyzeStatePatterns(currentState) {
    // Check for excessive reconnection attempts
    if (reconnectAttempts >= this.alertThresholds.maxReconnectAttempts) {
      debugLogger.websocket('ERROR', 'Excessive WebSocket reconnection attempts detected', {
        attempts: reconnectAttempts,
        threshold: this.alertThresholds.maxReconnectAttempts,
        recommendation: 'Consider checking network connectivity or API key validity'
      });
    }

    // Check for prolonged disconnection
    const recentStates = this.stateHistory.slice(-10);
    const allDisconnected = recentStates.every(state =>
      state.readyState === null || state.readyState === WebSocket.CLOSED
    );

    if (allDisconnected && recentStates.length >= 10) {
      const disconnectedDuration = Date.now() - recentStates[0].timestamp;
      const disconnectedMinutes = disconnectedDuration / (1000 * 60);

      if (disconnectedMinutes >= this.alertThresholds.maxDowntimeMinutes) {
        debugLogger.websocket('ERROR', 'Prolonged WebSocket disconnection detected', {
          disconnectedMinutes: Math.round(disconnectedMinutes * 100) / 100,
          threshold: this.alertThresholds.maxDowntimeMinutes,
          recommendation: 'Manual intervention may be required'
        });
      }
    }

    // Check for rapid state changes (connection instability)
    const rapidChanges = this.stateHistory.slice(-5).reduce((changes, state, index, array) => {
      if (index > 0 && state.readyState !== array[index - 1].readyState) {
        changes++;
      }
      return changes;
    }, 0);

    if (rapidChanges >= 4) {
      debugLogger.websocket('WARN', 'WebSocket connection instability detected', {
        stateChanges: rapidChanges,
        timeWindow: '5 checks',
        recommendation: 'Network or server issues may be causing instability'
      });
    }
  }

  getStateReport() {
    return {
      current: {
        readyState: websocket ? websocket.readyState : null,
        stateText: websocket ? ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][websocket.readyState] : 'NULL',
        hasApiKey: !!apiKey,
        reconnectAttempts
      },
      monitoring: {
        isActive: !!this.monitoringInterval,
        checkInterval: this.alertThresholds.stateCheckIntervalMs,
        historyLength: this.stateHistory.length
      },
      recentHistory: this.stateHistory.slice(-10),
      thresholds: this.alertThresholds
    };
  }
}

// Global WebSocket state monitor
const wsStateMonitor = new WebSocketStateMonitor();

// WebSocket alarm listener for persistent reconnection
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'websocketReconnect' && apiKey) {
    debugLogger.websocket('INFO', 'Reconnection alarm triggered', {
      alarmName: alarm.name,
      hasApiKey: !!apiKey,
      scheduledTime: alarm.scheduledTime ? new Date(alarm.scheduledTime).toISOString() : 'unknown'
    });
    connectWebSocket();
  } else if (alarm.name === 'websocketReconnect') {
    debugLogger.websocket('WARN', 'Reconnection alarm triggered but no API key available');
  }
});

// TODO: Implement proper API key encryption
// For now, store plain text to avoid decryption issues
function encryptKey(key) {
  return key; // No encryption
}

function decryptKey(encryptedKey) {
  return encryptedKey; // No decryption
}

// Pushbullet service class for better state management
class PushbulletService {
  constructor() {
    this.state = {
      apiKey: null,
      deviceIden: null,
      deviceNickname: 'Chrome',
      websocket: null,
      reconnectAttempts: 0,
      reconnectTimeout: null,
      autoOpenLinks: true,
      sessionCache: {
        userInfo: null,
        devices: [],
        recentPushes: [],
        isAuthenticated: false,
        lastUpdated: 0,
        autoOpenLinks: true,
        deviceNickname: 'Chrome'
      }
    };
  }

  async initialize() {
    const result = await new Promise(resolve => {
      chrome.storage.local.get(['apiKey', 'deviceIden', 'autoOpenLinks', 'deviceNickname'], resolve);
    });

    this.state.apiKey = decryptKey(result.apiKey);
    this.state.deviceIden = result.deviceIden;
    this.state.autoOpenLinks = result.autoOpenLinks !== undefined ? result.autoOpenLinks : true;
    this.state.deviceNickname = result.deviceNickname || 'Chrome';
    this.state.sessionCache.autoOpenLinks = this.state.autoOpenLinks;
    this.state.sessionCache.deviceNickname = this.state.deviceNickname;

    if (this.state.apiKey) {
      // Fetch and set session data
      await this.refreshSessionCache();
      await this.registerDevice();
      this.connectWebSocket();
    }
  }

  // Add methods for other operations...
  async refreshSessionCache() {
    // Implementation similar to the original function
    // This would be a big refactor, so for now, keep it simple
    console.log('Refresh session cache called');
  }

  async registerDevice() {
    // Implementation
    console.log('Register device called');
  }

  connectWebSocket() {
    // Implementation
    console.log('Connect WebSocket called');
  }
}

// Instantiate service
const pbService = new PushbulletService();

// Initialize extension
chrome.runtime.onInstalled.addListener(() => {
  debugLogger.general('INFO', 'Pushbullet extension installed/updated', {
    reason: 'onInstalled',
    timestamp: new Date().toISOString()
  });

  // Set up context menu
  setupContextMenu();

  // Initialize session cache
  initializeSessionCache();
});

// Initialize session cache
async function initializeSessionCache() {
  debugLogger.general('INFO', 'Initializing session cache', {
    timestamp: new Date().toISOString()
  });

  try {
    // Get API key from storage
    debugLogger.storage('DEBUG', 'Loading initial configuration from sync storage');
    const result = await new Promise(resolve => {
      chrome.storage.sync.get(['apiKey', 'deviceIden', 'autoOpenLinks', 'deviceNickname'], resolve);
    });

    apiKey = decryptKey(result.apiKey);
    deviceIden = result.deviceIden;

    debugLogger.storage('INFO', 'Loaded configuration from sync storage', {
      hasApiKey: !!result.apiKey,
      apiKeyLength: result.apiKey ? result.apiKey.length : 0,
      hasDeviceIden: !!result.deviceIden,
      autoOpenLinks: result.autoOpenLinks,
      deviceNickname: result.deviceNickname
    });

    debugLogger.general('DEBUG', 'Decrypted API key status', {
      hasDecryptedKey: !!apiKey,
      decryptedKeyLength: apiKey ? apiKey.length : 0
    });

    if (result.autoOpenLinks !== undefined) {
      autoOpenLinks = result.autoOpenLinks;
      sessionCache.autoOpenLinks = autoOpenLinks;
      debugLogger.general('DEBUG', 'Auto-open links setting loaded', { autoOpenLinks });
    }

    if (result.deviceNickname) {
      deviceNickname = result.deviceNickname;
      sessionCache.deviceNickname = deviceNickname;
      debugLogger.general('DEBUG', 'Device nickname loaded', { deviceNickname });
    }

    if (apiKey) {
      debugLogger.general('INFO', 'API key available - initializing session data');

      // Fetch user info
      debugLogger.general('DEBUG', 'Fetching user info for session cache');
      const userInfo = await fetchUserInfo();
      sessionCache.userInfo = userInfo;
      debugLogger.general('DEBUG', 'User info cached', {
        email: userInfo.email ? userInfo.email.substring(0, 3) + '***' : 'unknown'
      });

      // Fetch devices
      debugLogger.general('DEBUG', 'Fetching devices for session cache');
      const devices = await fetchDevices();
      sessionCache.devices = devices;
      debugLogger.general('DEBUG', 'Devices cached', {
        deviceCount: devices.length,
        deviceTypes: devices.map(d => d.type).join(', ')
      });

      // Fetch recent pushes
      debugLogger.general('DEBUG', 'Fetching recent pushes for session cache');
      const pushes = await fetchRecentPushes();
      sessionCache.recentPushes = pushes;
      debugLogger.general('DEBUG', 'Recent pushes cached', {
        pushCount: pushes.length,
        pushTypes: pushes.map(p => p.type).join(', ')
      });

      // Update session cache
      sessionCache.isAuthenticated = true;
      sessionCache.lastUpdated = Date.now();

      debugLogger.general('INFO', 'Session cache populated successfully', {
        hasUserInfo: !!sessionCache.userInfo,
        deviceCount: sessionCache.devices.length,
        pushCount: sessionCache.recentPushes.length,
        lastUpdated: new Date(sessionCache.lastUpdated).toISOString()
      });

      // Register device if needed
      debugLogger.general('DEBUG', 'Registering device');
      await registerDevice();

      // Connect to WebSocket
      debugLogger.general('DEBUG', 'Connecting to WebSocket');
      connectWebSocket();

      debugLogger.general('INFO', 'Session cache initialization completed', {
        autoOpenLinks,
        deviceNickname,
        isAuthenticated: sessionCache.isAuthenticated
      });
    } else {
      debugLogger.general('WARN', 'No API key available - session cache not initialized');
    }
  } catch (error) {
    debugLogger.general('ERROR', 'Error initializing session cache', {
      error: error.message || error.name || 'Unknown error'
    }, error);
    sessionCache.isAuthenticated = false;
  }
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  debugLogger.general('DEBUG', 'Message received from popup', {
    action: message.action,
    hasApiKey: !!message.apiKey,
    timestamp: new Date().toISOString()
  });
  
  if (message.action === 'getSessionData') {
    // Check if session cache is stale (older than 30 seconds)
    const isStale = Date.now() - sessionCache.lastUpdated > 30000;
    
    if (sessionCache.isAuthenticated && !isStale) {
      // Return cached session data
      console.log('Returning cached session data');
      sendResponse({
        isAuthenticated: true,
        userInfo: sessionCache.userInfo,
        devices: sessionCache.devices,
        recentPushes: sessionCache.recentPushes,
        autoOpenLinks: sessionCache.autoOpenLinks,
        deviceNickname: sessionCache.deviceNickname
      });
    } else if (sessionCache.isAuthenticated && isStale) {
      // Refresh session cache in the background
      console.log('Session cache is stale, refreshing');
      refreshSessionCache().then(() => {
        // Send updated session data
        sendResponse({
          isAuthenticated: true,
          userInfo: sessionCache.userInfo,
          devices: sessionCache.devices,
          recentPushes: sessionCache.recentPushes,
          autoOpenLinks: sessionCache.autoOpenLinks,
          deviceNickname: sessionCache.deviceNickname
        });
      }).catch(error => {
        console.error('Error refreshing session cache:', error);
        sendResponse({ isAuthenticated: false });
      });
      
      // Return true to indicate we'll respond asynchronously
      return true;
    } else {
      // Not authenticated
      sendResponse({ isAuthenticated: false });
    }
  } else if (message.action === 'apiKeyChanged') {
    // Update API key
    apiKey = message.apiKey;

    // Save encrypted API key to storage
    chrome.storage.sync.set({ apiKey: encryptKey(message.apiKey) });

    // Update device nickname if provided
    if (message.deviceNickname) {
      deviceNickname = message.deviceNickname;
      sessionCache.deviceNickname = deviceNickname;
      chrome.storage.local.set({ deviceNickname: deviceNickname });
    }

    // Refresh session cache
    refreshSessionCache().then(() => {
      // Notify popup that session data has been updated
      chrome.runtime.sendMessage({
        action: 'sessionDataUpdated',
        isAuthenticated: true,
        userInfo: sessionCache.userInfo,
        devices: sessionCache.devices,
        recentPushes: sessionCache.recentPushes,
        autoOpenLinks: sessionCache.autoOpenLinks,
        deviceNickname: sessionCache.deviceNickname
      });
    }).catch(error => {
      console.error('Error refreshing session cache after API key change:', error);
    });
  } else if (message.action === 'autoOpenLinksChanged') {
    // Update auto open links setting
    autoOpenLinks = message.autoOpenLinks;
    sessionCache.autoOpenLinks = autoOpenLinks;
    console.log('Auto-open links setting updated:', autoOpenLinks);
    
    // Save to storage
    chrome.storage.local.set({ autoOpenLinks: autoOpenLinks });
  } else if (message.action === 'deviceNicknameChanged') {
    // Update device nickname
    deviceNickname = message.deviceNickname;
    sessionCache.deviceNickname = deviceNickname;
    console.log('Device nickname updated:', deviceNickname);

    // Save to storage
    chrome.storage.local.set({ deviceNickname: deviceNickname });

    // Update device registration
    updateDeviceNickname();
  } else if (message.action === 'toggleDebugMode') {
    // Toggle debug mode
    DEBUG_CONFIG.enabled = message.enabled;
    debugConfigManager.saveConfig();
    debugLogger.general('INFO', 'Debug mode toggled by user', {
      enabled: DEBUG_CONFIG.enabled,
      timestamp: new Date().toISOString()
    });
    sendResponse({ success: true, enabled: DEBUG_CONFIG.enabled });
  } else if (message.action === 'getDebugConfig') {
    // Get current debug configuration
    sendResponse({
      success: true,
      config: debugConfigManager.getConfig()
    });
  } else if (message.action === 'getDebugLogs') {
    // Get debug logs
    const count = message.count || 100;
    const category = message.category || null;
    sendResponse({
      success: true,
      logs: debugLogger.getRecentLogs(count, category)
    });
  } else if (message.action === 'getPerformanceMetrics') {
    // Get performance metrics
    sendResponse({
      success: true,
      metrics: performanceMonitor.getPerformanceSummary()
    });
  } else if (message.action === 'getErrorData') {
    // Get error data
    sendResponse({
      success: true,
      errors: globalErrorTracker.getErrorSummary()
    });
  } else if (message.action === 'getDebugSummary') {
    // Get combined debug data
    sendResponse({
      success: true,
      summary: {
        config: debugConfigManager.getConfig(),
        logs: debugLogger.getRecentLogs(50),
        performance: performanceMonitor.getPerformanceSummary(),
        errors: globalErrorTracker.getErrorSummary(),
        websocketState: wsStateMonitor.getStateReport()
      }
    });
  } else if (message.action === 'exportDebugData') {
    // Export all debug data
    sendResponse({
      success: true,
      data: {
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        debugLogs: debugLogger.exportLogs(),
        performanceData: performanceMonitor.exportPerformanceData(),
        errorData: globalErrorTracker.exportErrorData(),
        websocketState: wsStateMonitor.getStateReport(),
        sessionInfo: {
          isAuthenticated: sessionCache.isAuthenticated,
          lastUpdated: sessionCache.lastUpdated ? new Date(sessionCache.lastUpdated).toISOString() : 'never',
          deviceCount: sessionCache.devices?.length || 0,
          pushCount: sessionCache.recentPushes?.length || 0,
          autoOpenLinks: sessionCache.autoOpenLinks,
          deviceNickname: sessionCache.deviceNickname
        },
        systemInfo: {
          hasApiKey: !!apiKey,
          deviceIden,
          websocketConnected: websocket ? websocket.readyState === WebSocket.OPEN : false,
          reconnectAttempts,
          timestamp: new Date().toISOString()
        }
      }
    });
  }

  // Return true to indicate we'll respond asynchronously
  return true;
});

// Refresh session cache
async function refreshSessionCache() {
  debugLogger.general('INFO', 'Refreshing session cache', {
    currentlyAuthenticated: sessionCache.isAuthenticated,
    lastUpdated: sessionCache.lastUpdated ? new Date(sessionCache.lastUpdated).toISOString() : 'never',
    timestamp: new Date().toISOString()
  });

  try {
    if (apiKey) {
      debugLogger.general('DEBUG', 'API key available - refreshing session data');

      // Fetch user info
      debugLogger.general('DEBUG', 'Refreshing user info');
      const userInfo = await fetchUserInfo();
      sessionCache.userInfo = userInfo;

      // Fetch devices
      debugLogger.general('DEBUG', 'Refreshing devices');
      const devices = await fetchDevices();
      sessionCache.devices = devices;

      // Fetch recent pushes
      debugLogger.general('DEBUG', 'Refreshing recent pushes');
      const pushes = await fetchRecentPushes();
      sessionCache.recentPushes = pushes;

      // Update session cache
      sessionCache.isAuthenticated = true;
      sessionCache.lastUpdated = Date.now();

      debugLogger.general('INFO', 'Session cache refreshed successfully', {
        hasUserInfo: !!sessionCache.userInfo,
        deviceCount: sessionCache.devices.length,
        pushCount: sessionCache.recentPushes.length,
        lastUpdated: new Date(sessionCache.lastUpdated).toISOString()
      });

      // Connect to WebSocket if not connected
      if (!websocket || websocket.readyState !== WebSocket.OPEN) {
        debugLogger.general('DEBUG', 'WebSocket not connected - establishing connection');
        connectWebSocket();
      } else {
        debugLogger.general('DEBUG', 'WebSocket already connected', {
          readyState: websocket.readyState,
          stateText: ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][websocket.readyState]
        });
      }

      return true;
    } else {
      debugLogger.general('WARN', 'No API key available - cannot refresh session cache');
      sessionCache.isAuthenticated = false;
      return false;
    }
  } catch (error) {
    debugLogger.general('ERROR', 'Error refreshing session cache', {
      error: error.message || 'Unknown error'
    }, error);
    sessionCache.isAuthenticated = false;
    throw error;
  }
}

// Set up context menu
function setupContextMenu() {
  chrome.contextMenus.removeAll(() => {
    // Create parent menu item
    chrome.contextMenus.create({
      id: 'pushbullet',
      title: 'Pushbullet',
      contexts: ['page', 'selection', 'link', 'image']
    });
    
    // Push link
    chrome.contextMenus.create({
      id: 'push-link',
      parentId: 'pushbullet',
      title: 'Push this link',
      contexts: ['link']
    });
    
    // Push page
    chrome.contextMenus.create({
      id: 'push-page',
      parentId: 'pushbullet',
      title: 'Push this page',
      contexts: ['page']
    });
    
    // Push selection
    chrome.contextMenus.create({
      id: 'push-selection',
      parentId: 'pushbullet',
      title: 'Push this selection',
      contexts: ['selection']
    });
    
    // Push image
    chrome.contextMenus.create({
      id: 'push-image',
      parentId: 'pushbullet',
      title: 'Push this image',
      contexts: ['image']
    });
  });
}

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!apiKey) {
    // Show notification to set API key
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Pushbullet',
      message: 'Please set your API key in the extension popup'
    });
    return;
  }
  
  switch (info.menuItemId) {
  case 'push-link':
    pushLink(info.linkUrl, tab.title);
    break;
  case 'push-page':
    pushLink(tab.url, tab.title);
    break;
  case 'push-selection':
    pushNote('Selection from ' + tab.title, info.selectionText);
    break;
  case 'push-image':
    pushLink(info.srcUrl, 'Image from ' + tab.title);
    break;
  }
});

// Push a link
async function pushLink(url, title) {
  try {
    const response = await fetch(PUSHES_URL, {
      method: 'POST',
      headers: {
        'Access-Token': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        type: 'link',
        title: title || url,
        url: url,
        source_device_iden: deviceIden
      })
    });
    
    if (!response.ok) {
      throw new Error('Failed to push link');
    }
    
    // Show success notification
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Pushbullet',
      message: 'Link pushed successfully!'
    });
    
    // Refresh pushes in session cache
    refreshPushes();
  } catch (error) {
    console.error('Error pushing link:', error);
    
    // Show error notification
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Pushbullet',
      message: 'Error pushing link: ' + error.message
    });
  }
}

// Push a note
async function pushNote(title, body) {
  try {
    const response = await fetch(PUSHES_URL, {
      method: 'POST',
      headers: {
        'Access-Token': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        type: 'note',
        title: title,
        body: body,
        source_device_iden: deviceIden
      })
    });
    
    if (!response.ok) {
      throw new Error('Failed to push note');
    }
    
    // Show success notification
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Pushbullet',
      message: 'Note pushed successfully!'
    });
    
    // Refresh pushes in session cache
    refreshPushes();
  } catch (error) {
    console.error('Error pushing note:', error);
    
    // Show error notification
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Pushbullet',
      message: 'Error pushing note: ' + error.message
    });
  }
}

// Register device
async function registerDevice() {
  debugLogger.general('INFO', 'Starting device registration process', {
    hasApiKey: !!apiKey,
    currentDeviceIden: deviceIden,
    deviceNickname,
    timestamp: new Date().toISOString()
  });

  // Check registration status atomically
  debugLogger.storage('DEBUG', 'Checking device registration status');
  const result = await new Promise(resolve => {
    chrome.storage.local.get(['deviceRegistrationInProgress'], resolve);
  });

  if (result.deviceRegistrationInProgress) {
    debugLogger.general('INFO', 'Device registration already in progress - waiting for completion');
    return new Promise(resolve => {
      const listener = (changes) => {
        if (changes.deviceRegistrationInProgress && !changes.deviceRegistrationInProgress.newValue) {
          chrome.storage.onChanged.removeListener(listener);
          debugLogger.general('INFO', 'Device registration completed by another process');
          resolve();
        }
      };
      chrome.storage.onChanged.addListener(listener);
    });
  }

  try {
    debugLogger.storage('DEBUG', 'Setting device registration in progress flag');
    await chrome.storage.local.set({ deviceRegistrationInProgress: true });

    // Check if device is already registered
    debugLogger.storage('DEBUG', 'Checking for existing device registration');
    const storageResult = await new Promise(resolve => {
      chrome.storage.local.get(['deviceIden'], resolve);
    });

    if (storageResult.deviceIden) {
      deviceIden = storageResult.deviceIden;
      debugLogger.general('INFO', 'Device already registered', {
        deviceIden,
        deviceNickname
      });

      // Update device nickname if needed
      debugLogger.general('DEBUG', 'Updating device nickname for existing registration');
      await updateDeviceNickname();
      return;
    }

    // Register device
    debugLogger.general('INFO', 'Registering new device with Pushbullet API', {
      deviceNickname,
      url: DEVICES_URL
    });

    const registrationData = {
      nickname: deviceNickname,
      model: 'Chrome',
      manufacturer: 'Google',
      push_token: '',
      app_version: 8623,
      icon: 'browser',
      has_sms: false,
      type: 'chrome'
    };

    debugLogger.api('INFO', 'Sending device registration request', {
      url: DEVICES_URL,
      method: 'POST',
      deviceData: registrationData
    });

    const startTime = Date.now();
    const response = await fetch(DEVICES_URL, {
      method: 'POST',
      headers: {
        'Access-Token': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(registrationData)
    });

    const duration = Date.now() - startTime;

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      const errorMessage = errorData?.error?.message || response.statusText;
      const error = new Error(`Failed to register device: ${errorMessage} (${response.status})`);

      debugLogger.api('ERROR', 'Device registration failed', {
        url: DEVICES_URL,
        status: response.status,
        statusText: response.statusText,
        duration: `${duration}ms`,
        errorMessage,
        errorData
      }, error);

      throw error;
    }

    const data = await response.json();
    deviceIden = data.iden;

    debugLogger.api('INFO', 'Device registration successful', {
      url: DEVICES_URL,
      status: response.status,
      duration: `${duration}ms`,
      deviceIden,
      deviceNickname: data.nickname
    });

    // Save device iden to storage
    debugLogger.storage('DEBUG', 'Saving device iden to storage', { deviceIden });
    chrome.storage.local.set({ deviceIden: deviceIden });

    debugLogger.general('INFO', 'Device registration completed successfully', {
      deviceIden,
      deviceNickname
    });
  } catch (error) {
    debugLogger.general('ERROR', 'Error during device registration', {
      error: error.message,
      deviceNickname
    }, error);

    // If we fail to register, clear any existing deviceIden to force a retry next time
    debugLogger.storage('DEBUG', 'Clearing device iden due to registration failure');
    chrome.storage.local.remove(['deviceIden']);
    deviceIden = null;
    throw error;
  } finally {
    debugLogger.storage('DEBUG', 'Clearing device registration in progress flag');
    await chrome.storage.local.set({ deviceRegistrationInProgress: false });
  }
}

// Update device nickname
async function updateDeviceNickname() {
  if (!deviceIden || !apiKey) {
    console.log('Cannot update device nickname: missing deviceIden or apiKey');
    return;
  }
  
  try {
    console.log('Updating device nickname to:', deviceNickname);
    
    // Update device
    const response = await fetch(`${DEVICES_URL}/${deviceIden}`, {
      method: 'POST',
      headers: {
        'Access-Token': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        nickname: deviceNickname
      })
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      const errorMessage = errorData?.error?.message || response.statusText;
      throw new Error(`Failed to update device nickname: ${errorMessage} (${response.status})`);
    }
    
    console.log('Device nickname updated successfully');
    
    // Refresh devices in session cache
    const devices = await fetchDevices();
    sessionCache.devices = devices;
    sessionCache.lastUpdated = Date.now();
    
    // Notify popup of updated devices
    chrome.runtime.sendMessage({
      action: 'sessionDataUpdated',
      isAuthenticated: true,
      userInfo: sessionCache.userInfo,
      devices: sessionCache.devices,
      recentPushes: sessionCache.recentPushes,
      autoOpenLinks: sessionCache.autoOpenLinks,
      deviceNickname: sessionCache.deviceNickname
    }).catch(err => {
      // This is expected to fail if no popup is open
      console.log('No popup open to receive device updates');
    });
  } catch (error) {
    console.error('Error updating device nickname:', error);
  }
}

// Connect to WebSocket
function connectWebSocket() {
  debugLogger.websocket('INFO', 'Attempting WebSocket connection', {
    hasApiKey: !!apiKey,
    currentState: websocket ? websocket.readyState : 'null',
    reconnectAttempts
  });

  // Disconnect existing WebSocket if any
  disconnectWebSocket();

  if (!apiKey) {
    debugLogger.websocket('ERROR', 'Cannot connect WebSocket: API key not available');
    return;
  }

  try {
    const wsUrl = WEBSOCKET_URL + apiKey;
    debugLogger.websocket('DEBUG', 'Creating WebSocket connection', {
      url: WEBSOCKET_URL + '***',
      timestamp: new Date().toISOString()
    });

    websocket = new WebSocket(wsUrl);
    performanceMonitor.recordWebSocketConnection(false); // Will update to true on successful connection

    websocket.onopen = (event) => {
      debugLogger.websocket('INFO', 'WebSocket connection established successfully', {
        readyState: websocket.readyState,
        protocol: websocket.protocol,
        url: websocket.url ? websocket.url.replace(apiKey, '***') : 'unknown',
        timestamp: new Date().toISOString(),
        reconnectAttempts: reconnectAttempts
      });

      performanceMonitor.recordWebSocketConnection(true);
      reconnectAttempts = 0;

      // Start state monitoring
      wsStateMonitor.startMonitoring();

      // Clear any pending reconnect timeout
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
        debugLogger.websocket('DEBUG', 'Cleared pending reconnect timeout');
      }
    };
    
    websocket.onmessage = async (event) => {
      const messageReceiveTime = Date.now();
      performanceMonitor.recordWebSocketMessage();

      debugLogger.websocket('DEBUG', 'Raw WebSocket message received', {
        dataLength: event.data ? event.data.length : 0,
        timestamp: new Date(messageReceiveTime).toISOString(),
        messageType: typeof event.data
      });

      let data;
      try {
        data = JSON.parse(event.data);
        debugLogger.websocket('DEBUG', 'WebSocket message parsed successfully', {
          messageType: data.type,
          subtype: data.subtype,
          hasPayload: !!data.push,
          timestamp: new Date().toISOString(),
          parseTime: `${Date.now() - messageReceiveTime}ms`
        });
      } catch (parseError) {
        debugLogger.websocket('ERROR', 'Failed to parse WebSocket message', {
          rawData: event.data,
          timestamp: new Date().toISOString()
        }, parseError);
        return;
      }

      debugLogger.websocket('INFO', 'Processing WebSocket message', {
        type: data.type,
        subtype: data.subtype,
        pushId: data.push ? data.push.iden : null,
        timestamp: new Date().toISOString()
      });

      // Handle different message types
      switch (data.type) {
      case 'tickle':
        debugLogger.websocket('INFO', 'Tickle message received', {
          subtype: data.subtype,
          timestamp: new Date().toISOString()
        });

        if (data.subtype === 'push') {
          debugLogger.websocket('INFO', 'Push tickle received - fetching latest pushes');
          debugLogger.startTimer('tickle_push_processing');

          try {
            // Fetch latest pushes
            const pushes = await fetchRecentPushes();

            debugLogger.websocket('DEBUG', 'Fetched pushes after tickle', {
              pushCount: pushes.length,
              latestPushId: pushes.length > 0 ? pushes[0].iden : null
            });

            // Update session cache
            sessionCache.recentPushes = pushes;
            sessionCache.lastUpdated = Date.now();

            // Notify popup of updated pushes
            chrome.runtime.sendMessage({
              action: 'pushesUpdated',
              pushes: pushes
            }).catch(err => {
              debugLogger.websocket('DEBUG', 'No popup open to receive push updates', { error: err.message });
            });

            // Check if there's a new push
            if (pushes.length > 0) {
              const latestPush = pushes[0];
              const trackingId = performanceMonitor.startNotificationProcessing(latestPush.iden, 'tickle');

              debugLogger.websocket('INFO', 'Processing latest push from tickle', {
                pushId: latestPush.iden,
                pushType: latestPush.type,
                trackingId
              });

              // Show notification for the new push
              performanceMonitor.markNotificationStage(trackingId, 'validated');
              showPushNotification(latestPush, trackingId);

              // Auto-open link if enabled and the push is a link
              // Skip if the push is from this device
              if (autoOpenLinks &&
                    latestPush.type === 'link' &&
                    latestPush.url &&
                    latestPush.source_device_iden !== deviceIden) {
                debugLogger.websocket('INFO', 'Auto-opening link from tickle', {
                  url: latestPush.url,
                  pushId: latestPush.iden
                });
                chrome.tabs.create({ url: latestPush.url });
              }
            } else {
              debugLogger.websocket('WARN', 'No pushes found after tickle');
            }

            debugLogger.endTimer('tickle_push_processing');
          } catch (error) {
            debugLogger.websocket('ERROR', 'Error processing push tickle', null, error);
            debugLogger.endTimer('tickle_push_processing');
          }
        } else {
          debugLogger.websocket('DEBUG', 'Non-push tickle received', { subtype: data.subtype });
        }
        break;
      case 'push':
        // Handle push message directly
        if (data.push) {
          const trackingId = performanceMonitor.startNotificationProcessing(data.push.iden, 'direct_push');

          debugLogger.websocket('INFO', 'Direct push message received', {
            pushId: data.push.iden,
            pushType: data.push.type,
            sourceDevice: data.push.source_device_iden,
            targetDevice: data.push.target_device_iden,
            trackingId,
            timestamp: new Date().toISOString()
          });

          performanceMonitor.markNotificationStage(trackingId, 'parsed', {
            type: data.push.type,
            hasTitle: !!data.push.title,
            hasBody: !!data.push.body,
            hasUrl: !!data.push.url
          });

          // Add the new push to the session cache
          if (sessionCache.recentPushes) {
            sessionCache.recentPushes.unshift(data.push);
            sessionCache.lastUpdated = Date.now();

            debugLogger.websocket('DEBUG', 'Added push to session cache', {
              pushId: data.push.iden,
              cacheSize: sessionCache.recentPushes.length
            });

            // Notify popup of updated pushes
            chrome.runtime.sendMessage({
              action: 'pushesUpdated',
              pushes: sessionCache.recentPushes
            }).catch(err => {
              debugLogger.websocket('DEBUG', 'No popup open to receive push updates', { error: err.message });
            });
          } else {
            debugLogger.websocket('WARN', 'Session cache not available for push storage');
          }

          // Show notification for the new push
          performanceMonitor.markNotificationStage(trackingId, 'validated');
          showPushNotification(data.push, trackingId);

          // Auto-open link if enabled and the push is a link
          // Skip if the push is from this device
          if (autoOpenLinks &&
                data.push.type === 'link' &&
                data.push.url &&
                data.push.source_device_iden !== deviceIden) {
            debugLogger.websocket('INFO', 'Auto-opening link from direct push', {
              url: data.push.url,
              pushId: data.push.iden,
              sourceDevice: data.push.source_device_iden
            });
            chrome.tabs.create({ url: data.push.url });
          } else {
            debugLogger.websocket('DEBUG', 'Link auto-open skipped', {
              autoOpenEnabled: autoOpenLinks,
              isLink: data.push.type === 'link',
              hasUrl: !!data.push.url,
              isFromThisDevice: data.push.source_device_iden === deviceIden,
              sourceDevice: data.push.source_device_iden,
              thisDevice: deviceIden
            });
          }
        } else {
          debugLogger.websocket('WARN', 'Push message received without push data');
        }
        break;
      case 'nop':
        // No operation, just to keep the connection alive
        debugLogger.websocket('DEBUG', 'Received nop (keep-alive) message', {
          timestamp: new Date().toISOString()
        });
        break;
      default:
        debugLogger.websocket('WARN', 'Unknown WebSocket message type received', {
          type: data.type,
          subtype: data.subtype,
          hasPayload: !!data.push,
          timestamp: new Date().toISOString()
        });
        break;
      }
    };
    
    websocket.onerror = (error) => {
      debugLogger.websocket('ERROR', 'WebSocket error occurred', {
        error: error.message || 'Unknown error',
        readyState: websocket ? websocket.readyState : 'null',
        timestamp: new Date().toISOString(),
        reconnectAttempts
      }, error);
    };

    websocket.onclose = (event) => {
      const closeInfo = {
        code: event.code,
        reason: event.reason || 'No reason provided',
        wasClean: event.wasClean,
        timestamp: new Date().toISOString(),
        reconnectAttempts
      };

      debugLogger.websocket('WARN', 'WebSocket connection closed', closeInfo);

      // Permanent failures - don't retry
      if (event.code === 1008 || event.code === 4001 || (event.code >= 4000 && event.code < 5000)) {
        debugLogger.websocket('ERROR', 'Permanent WebSocket error - stopping reconnection attempts', {
          code: event.code,
          reason: event.reason,
          isPermanent: true
        });
        return;
      }

      // Transient failures - exponential backoff with alarms
      const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
      reconnectAttempts++;
      performanceMonitor.recordWebSocketReconnection();

      debugLogger.websocket('INFO', 'Scheduling WebSocket reconnection', {
        delay: `${delay}ms`,
        attempt: reconnectAttempts,
        maxDelay: '30000ms',
        scheduledTime: new Date(Date.now() + delay).toISOString()
      });

      chrome.alarms.create('websocketReconnect', { when: Date.now() + delay });
    };
  } catch (error) {
    debugLogger.websocket('ERROR', 'Failed to create WebSocket connection', {
      url: WEBSOCKET_URL + '***',
      hasApiKey: !!apiKey,
      timestamp: new Date().toISOString()
    }, error);
  }
}

// Disconnect WebSocket
function disconnectWebSocket() {
  if (websocket) {
    const currentState = websocket.readyState;
    debugLogger.websocket('INFO', 'Disconnecting WebSocket', {
      currentState,
      stateText: ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][currentState] || 'UNKNOWN',
      timestamp: new Date().toISOString()
    });

    websocket.close();
    websocket = null;

    debugLogger.websocket('DEBUG', 'WebSocket reference cleared');
  } else {
    debugLogger.websocket('DEBUG', 'No WebSocket to disconnect');
  }

  // Stop state monitoring
  wsStateMonitor.stopMonitoring();

  // Clear any pending reconnect alarm
  chrome.alarms.clear('websocketReconnect', (wasCleared) => {
    if (wasCleared) {
      debugLogger.websocket('DEBUG', 'Cleared pending reconnect alarm');
    }
  });

  // Clear any pending reconnect timeout (legacy)
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
    debugLogger.websocket('DEBUG', 'Cleared legacy reconnect timeout');
  }
}

// Refresh pushes
async function refreshPushes() {
  try {
    const pushes = await fetchRecentPushes();
    sessionCache.recentPushes = pushes;
    sessionCache.lastUpdated = Date.now();
    
    // Notify popup of updated pushes
    chrome.runtime.sendMessage({
      action: 'pushesUpdated',
      pushes: pushes
    }).catch(err => {
      // This is expected to fail if no popup is open
      console.log('No popup open to receive push updates');
    });
    
    return pushes;
  } catch (error) {
    console.error('Error refreshing pushes:', error);
    throw error;
  }
}

// Show notification for a push
function showPushNotification(push, trackingId = null) {
  debugLogger.notifications('INFO', 'Processing push notification request', {
    pushId: push ? push.iden : null,
    pushType: push ? push.type : null,
    sourceDevice: push ? push.source_device_iden : null,
    thisDevice: deviceIden,
    trackingId,
    timestamp: new Date().toISOString()
  });

  // Skip if push is empty or from this device
  if (!push) {
    debugLogger.notifications('WARN', 'Skipping notification - push is empty/null', { trackingId });
    if (trackingId) {
      performanceMonitor.completeNotificationProcessing(trackingId, false, new Error('Push is empty'));
    }
    return;
  }

  if (push.source_device_iden === deviceIden) {
    debugLogger.notifications('INFO', 'Skipping notification - push from this device', {
      pushId: push.iden,
      sourceDevice: push.source_device_iden,
      thisDevice: deviceIden,
      trackingId
    });
    if (trackingId) {
      performanceMonitor.completeNotificationProcessing(trackingId, false, new Error('Push from same device'));
    }
    return;
  }

  debugLogger.notifications('INFO', 'Creating notification for push', {
    pushId: push.iden,
    pushType: push.type,
    hasTitle: !!push.title,
    hasBody: !!push.body,
    hasUrl: !!push.url,
    trackingId
  });
  
  if (trackingId) {
    performanceMonitor.markNotificationStage(trackingId, 'created');
  }

  // Create notification based on push type
  let notificationOptions = {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'Pushbullet',
    message: '',
    requireInteraction: true // Keep notification visible until user interacts with it
  };

  debugLogger.notifications('DEBUG', 'Building notification options', {
    pushType: push.type,
    pushId: push.iden,
    trackingId
  });

  switch (push.type) {
  case 'note':
    notificationOptions.title = push.title || 'Note';
    notificationOptions.message = push.body || '';
    debugLogger.notifications('DEBUG', 'Note notification configured', {
      title: notificationOptions.title,
      hasMessage: !!notificationOptions.message,
      trackingId
    });
    break;
  case 'link':
    notificationOptions.title = push.title || 'Link';
    notificationOptions.message = push.url || '';
    if (push.body) {
      notificationOptions.message += '\n' + push.body;
    }
    debugLogger.notifications('DEBUG', 'Link notification configured', {
      title: notificationOptions.title,
      url: push.url,
      hasBody: !!push.body,
      trackingId
    });
    break;
  case 'file':
    notificationOptions.title = push.file_name || 'File';
    notificationOptions.message = push.file_type || '';
    debugLogger.notifications('DEBUG', 'File notification configured', {
      fileName: push.file_name,
      fileType: push.file_type,
      trackingId
    });
    break;
  default:
    debugLogger.notifications('WARN', 'Unknown push type - skipping notification', {
      pushType: push.type,
      pushId: push.iden,
      trackingId
    });
    if (trackingId) {
      performanceMonitor.completeNotificationProcessing(trackingId, false, new Error(`Unknown push type: ${push.type}`));
    }
    return; // Skip unknown push types
  }
  
  // Create notification
  const notificationId = `push_${push.iden}`;
  const createStartTime = Date.now();

  debugLogger.notifications('INFO', 'Calling Chrome notifications API', {
    notificationId,
    pushId: push.iden,
    options: {
      type: notificationOptions.type,
      title: notificationOptions.title,
      hasMessage: !!notificationOptions.message,
      requireInteraction: notificationOptions.requireInteraction
    },
    trackingId,
    timestamp: new Date().toISOString()
  });

  chrome.notifications.create(notificationId, notificationOptions, (createdId) => {
    const createDuration = Date.now() - createStartTime;

    if (chrome.runtime.lastError) {
      debugLogger.notifications('ERROR', 'Chrome notification API error', {
        notificationId,
        pushId: push.iden,
        error: chrome.runtime.lastError.message,
        duration: `${createDuration}ms`,
        trackingId
      }, chrome.runtime.lastError);

      // Record notification failure
      notificationTracker.recordFailure(notificationId, chrome.runtime.lastError);

      if (trackingId) {
        performanceMonitor.completeNotificationProcessing(trackingId, false, chrome.runtime.lastError);
      }
    } else {
      debugLogger.notifications('INFO', 'Chrome notification created successfully', {
        notificationId,
        createdId,
        pushId: push.iden,
        duration: `${createDuration}ms`,
        trackingId,
        timestamp: new Date().toISOString()
      });

      if (trackingId) {
        performanceMonitor.markNotificationStage(trackingId, 'displayed');
        performanceMonitor.completeNotificationProcessing(trackingId, true);
      }

      // Store push data for notification click handling
      // Record successful notification creation
      notificationTracker.recordCreation(createdId, push.iden);

      debugLogger.storage('DEBUG', 'Storing push data for notification click handling', {
        notificationId: createdId,
        pushId: push.iden
      });

      chrome.storage.local.set({ [createdId]: push }, () => {
        if (chrome.runtime.lastError) {
          debugLogger.storage('ERROR', 'Failed to store push data for notification', {
            notificationId: createdId,
            pushId: push.iden,
            error: chrome.runtime.lastError.message
          }, chrome.runtime.lastError);
        } else {
          debugLogger.storage('DEBUG', 'Push data stored successfully for notification', {
            notificationId: createdId,
            pushId: push.iden
          });
        }
      });
    }
  });
}

// Notification interaction tracking
class NotificationTracker {
  constructor() {
    this.interactions = new Map();
    this.stats = {
      created: 0,
      clicked: 0,
      dismissed: 0,
      failed: 0,
      clickRate: 0
    };
  }

  recordCreation(notificationId, pushId) {
    this.interactions.set(notificationId, {
      pushId,
      created: Date.now(),
      clicked: null,
      dismissed: null,
      action: null
    });
    this.stats.created++;
    this.updateClickRate();

    debugLogger.notifications('DEBUG', 'Notification creation recorded', {
      notificationId,
      pushId,
      totalCreated: this.stats.created
    });
  }

  recordClick(notificationId) {
    const interaction = this.interactions.get(notificationId);
    if (interaction) {
      interaction.clicked = Date.now();
      interaction.action = 'clicked';
      this.stats.clicked++;
      this.updateClickRate();

      const responseTime = interaction.clicked - interaction.created;
      debugLogger.notifications('INFO', 'Notification click recorded', {
        notificationId,
        pushId: interaction.pushId,
        responseTime: `${responseTime}ms`,
        totalClicked: this.stats.clicked,
        clickRate: `${this.stats.clickRate}%`
      });
    }
  }

  recordDismissal(notificationId) {
    const interaction = this.interactions.get(notificationId);
    if (interaction && !interaction.clicked) {
      interaction.dismissed = Date.now();
      interaction.action = 'dismissed';
      this.stats.dismissed++;
      this.updateClickRate();

      debugLogger.notifications('INFO', 'Notification dismissal recorded', {
        notificationId,
        pushId: interaction.pushId,
        totalDismissed: this.stats.dismissed,
        clickRate: `${this.stats.clickRate}%`
      });
    }
  }

  recordFailure(notificationId, error) {
    this.stats.failed++;
    debugLogger.notifications('ERROR', 'Notification failure recorded', {
      notificationId,
      error: error.message,
      totalFailed: this.stats.failed
    }, error);
  }

  updateClickRate() {
    const total = this.stats.clicked + this.stats.dismissed;
    this.stats.clickRate = total > 0 ? Math.round((this.stats.clicked / total) * 100) : 0;
  }

  getStats() {
    return { ...this.stats };
  }

  cleanup() {
    // Remove old interactions (keep last 100)
    if (this.interactions.size > 100) {
      const entries = Array.from(this.interactions.entries());
      entries.sort((a, b) => a[1].created - b[1].created);
      const toRemove = entries.slice(0, entries.length - 100);
      toRemove.forEach(([id]) => this.interactions.delete(id));
    }
  }
}

// Global notification tracker
const notificationTracker = new NotificationTracker();

// Handle notification clicks
chrome.notifications.onClicked.addListener((notificationId) => {
  debugLogger.notifications('INFO', 'Notification clicked', {
    notificationId,
    timestamp: new Date().toISOString()
  });

  notificationTracker.recordClick(notificationId);

  // Check if this is a push notification
  if (notificationId.startsWith('push_')) {
    // Get push data
    chrome.storage.local.get([notificationId], (result) => {
      const push = result[notificationId];

      if (push) {
        debugLogger.notifications('INFO', 'Processing notification click', {
          notificationId,
          pushId: push.iden,
          pushType: push.type,
          hasUrl: !!push.url
        });

        // Set a flag in storage to indicate the popup should scroll to recent pushes
        chrome.storage.local.set({ scrollToRecentPushes: true }, () => {
          // Open the extension popup
          chrome.action.openPopup();

          // If it's a link, also open it in a new tab
          if (push.type === 'link' && push.url) {
            debugLogger.notifications('INFO', 'Opening link from notification click', {
              url: push.url,
              pushId: push.iden
            });
            chrome.tabs.create({ url: push.url });
          }
        });

        // Clear notification
        chrome.notifications.clear(notificationId, (wasCleared) => {
          debugLogger.notifications('DEBUG', 'Notification cleared after click', {
            notificationId,
            wasCleared,
            pushId: push.iden
          });
        });

        // Remove stored push data
        chrome.storage.local.remove([notificationId], () => {
          debugLogger.storage('DEBUG', 'Removed push data after notification click', {
            notificationId,
            pushId: push.iden
          });
        });
      } else {
        debugLogger.notifications('WARN', 'No push data found for clicked notification', {
          notificationId
        });
        // Still open the popup even if we can't find the push data
        chrome.storage.local.set({ scrollToRecentPushes: true }, () => {
          chrome.action.openPopup();
        });
      }
    });
  }
});

// Handle notification dismissals (closed by user)
chrome.notifications.onClosed.addListener((notificationId, byUser) => {
  debugLogger.notifications('INFO', 'Notification closed', {
    notificationId,
    byUser,
    timestamp: new Date().toISOString()
  });

  if (byUser) {
    notificationTracker.recordDismissal(notificationId);
  }

  // Clean up stored data
  if (notificationId.startsWith('push_')) {
    chrome.storage.local.remove([notificationId], () => {
      debugLogger.storage('DEBUG', 'Cleaned up push data for closed notification', {
        notificationId
      });
    });
  }
});

// Fetch user info
async function fetchUserInfo() {
  const startTime = Date.now();
  debugLogger.api('INFO', 'Fetching user info', {
    url: USER_INFO_URL,
    hasApiKey: !!apiKey,
    timestamp: new Date().toISOString()
  });

  try {
    const response = await fetch(USER_INFO_URL, {
      headers: {
        'Access-Token': apiKey
      }
    });

    const duration = Date.now() - startTime;

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      const error = new Error(`Failed to fetch user info: ${response.status} ${response.statusText} - ${errorText}`);

      debugLogger.api('ERROR', 'User info fetch failed', {
        url: USER_INFO_URL,
        status: response.status,
        statusText: response.statusText,
        duration: `${duration}ms`,
        errorText
      }, error);

      throw error;
    }

    const data = await response.json();
    debugLogger.api('INFO', 'User info fetched successfully', {
      url: USER_INFO_URL,
      status: response.status,
      duration: `${duration}ms`,
      userEmail: data.email ? data.email.substring(0, 3) + '***' : 'unknown',
      userName: data.name || 'unknown'
    });

    return data;
  } catch (error) {
    const duration = Date.now() - startTime;
    debugLogger.api('ERROR', 'User info fetch error', {
      url: USER_INFO_URL,
      duration: `${duration}ms`,
      error: error.message
    }, error);
    throw error;
  }
}

// Fetch devices
async function fetchDevices() {
  const startTime = Date.now();
  debugLogger.api('INFO', 'Fetching devices', {
    url: DEVICES_URL,
    hasApiKey: !!apiKey,
    timestamp: new Date().toISOString()
  });

  try {
    const response = await fetch(DEVICES_URL, {
      headers: {
        'Access-Token': apiKey
      }
    });

    const duration = Date.now() - startTime;

    if (!response.ok) {
      const error = new Error(`Failed to fetch devices: ${response.status} ${response.statusText}`);
      debugLogger.api('ERROR', 'Devices fetch failed', {
        url: DEVICES_URL,
        status: response.status,
        statusText: response.statusText,
        duration: `${duration}ms`
      }, error);
      throw error;
    }

    const data = await response.json();
    const activeDevices = data.devices.filter(device => device.active);

    debugLogger.api('INFO', 'Devices fetched successfully', {
      url: DEVICES_URL,
      status: response.status,
      duration: `${duration}ms`,
      totalDevices: data.devices.length,
      activeDevices: activeDevices.length,
      deviceTypes: activeDevices.map(d => d.type).join(', ')
    });

    return activeDevices;
  } catch (error) {
    const duration = Date.now() - startTime;
    debugLogger.api('ERROR', 'Devices fetch error', {
      url: DEVICES_URL,
      duration: `${duration}ms`,
      error: error.message
    }, error);
    throw error;
  }
}

// Fetch recent pushes
async function fetchRecentPushes() {
  const startTime = Date.now();
  const url = `${PUSHES_URL}?limit=20`;

  debugLogger.api('INFO', 'Fetching recent pushes', {
    url,
    hasApiKey: !!apiKey,
    timestamp: new Date().toISOString()
  });

  try {
    // Get up to 20 recent pushes to ensure we have enough to display
    const response = await fetch(url, {
      headers: {
        'Access-Token': apiKey
      }
    });

    const duration = Date.now() - startTime;

    if (!response.ok) {
      const error = new Error(`Failed to fetch pushes: ${response.status} ${response.statusText}`);
      debugLogger.api('ERROR', 'Pushes fetch failed', {
        url,
        status: response.status,
        statusText: response.statusText,
        duration: `${duration}ms`
      }, error);
      throw error;
    }

    const data = await response.json();

    // Filter pushes that aren't empty
    const filteredPushes = data.pushes.filter(push => {
      // Make sure we have something to display
      const hasContent = push.title || push.body || push.url;
      // Include pushes not dismissed
      return hasContent && !push.dismissed;
    });

    debugLogger.api('INFO', 'Pushes fetched successfully', {
      url,
      status: response.status,
      duration: `${duration}ms`,
      totalPushes: data.pushes.length,
      filteredPushes: filteredPushes.length,
      pushTypes: filteredPushes.map(p => p.type).join(', ')
    });

    return filteredPushes;
  } catch (error) {
    const duration = Date.now() - startTime;
    debugLogger.api('ERROR', 'Pushes fetch error', {
      url,
      duration: `${duration}ms`,
      error: error.message
    }, error);
    throw error;
  }
}

// Listen for storage changes
chrome.storage.onChanged.addListener((changes, namespace) => {
  debugLogger.storage('INFO', 'Storage changes detected', {
    namespace,
    changedKeys: Object.keys(changes),
    timestamp: new Date().toISOString()
  });

  if (namespace === 'local') {
    // Handle API key change
    if (changes.apiKey) {
      const oldValue = changes.apiKey.oldValue;
      const newValue = changes.apiKey.newValue;

      debugLogger.storage('INFO', 'API key changed in storage', {
        hadOldValue: !!oldValue,
        hasNewValue: !!newValue,
        oldValueLength: oldValue ? oldValue.length : 0,
        newValueLength: newValue ? newValue.length : 0
      });

      apiKey = decryptKey(newValue);

      if (apiKey) {
        debugLogger.storage('INFO', 'API key updated - refreshing session cache');
        // Refresh session cache
        refreshSessionCache();
      } else {
        debugLogger.storage('WARN', 'API key cleared - disconnecting WebSocket and clearing cache');
        // Disconnect WebSocket
        disconnectWebSocket();

        // Clear session cache
        sessionCache = {
          userInfo: null,
          devices: [],
          recentPushes: [],
          isAuthenticated: false,
          lastUpdated: 0,
          autoOpenLinks: true,
          deviceNickname: 'Chrome' // Default nickname
        };
      }
    }

    // Handle auto open links change
    if (changes.autoOpenLinks) {
      const oldValue = changes.autoOpenLinks.oldValue;
      const newValue = changes.autoOpenLinks.newValue;

      debugLogger.storage('INFO', 'Auto-open links setting changed', {
        oldValue,
        newValue
      });

      autoOpenLinks = newValue;
      sessionCache.autoOpenLinks = autoOpenLinks;
    }

    // Handle device nickname change
    if (changes.deviceNickname) {
      const oldValue = changes.deviceNickname.oldValue;
      const newValue = changes.deviceNickname.newValue;

      debugLogger.storage('INFO', 'Device nickname changed', {
        oldValue,
        newValue
      });

      deviceNickname = newValue;
      sessionCache.deviceNickname = deviceNickname;
    }
  } else if (namespace === 'sync') {
    debugLogger.storage('INFO', 'Sync storage changes detected', {
      changedKeys: Object.keys(changes)
    });
  }
});