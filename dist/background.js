"use strict";
(() => {
  // src/lib/logging/index.ts
  var STORAGE_KEY = "persistentDebugLogs";
  var MAX_PERSISTENT_LOGS = 5e3;
  var MAX_TRACKED_ERRORS = 500;
  var REDACTED_VALUE = "[redacted]";
  var SENSITIVE_KEY_PATTERN = /token|key|password|secret|authorization|body|title|url|email|phone|address|street|postal|zipcode|zip_code/i;
  var URL_VALUE_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;
  var EMAIL_VALUE_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var PHONE_VALUE_PATTERN = /^\+?[0-9][0-9 .().-]{6,}[0-9]$/;
  var DEBUG_CONFIG = {
    enabled: false,
    categories: {
      WEBSOCKET: true,
      NOTIFICATIONS: true,
      API: true,
      STORAGE: true,
      GENERAL: true,
      PERFORMANCE: true,
      ERROR: true
    },
    logLevel: "DEBUG",
    maxLogEntries: 1e3,
    sanitizeData: true
  };
  var DebugLogger = class {
    logs = [];
    startTime = Date.now();
    performanceMarkers = /* @__PURE__ */ new Map();
    rehydratePromise = null;
    /**
     * Rehydrate logs from persistent storage on startup
     * This method loads logs from the previous session
     */
    async rehydrate() {
      if (!this.rehydratePromise) {
        this.rehydratePromise = this.rehydrateFromStorage();
      }
      await this.rehydratePromise;
    }
    async rehydrateFromStorage() {
      try {
        const result = await chrome.storage.local.get(STORAGE_KEY);
        if (result[STORAGE_KEY] && Array.isArray(result[STORAGE_KEY])) {
          const storedLogs = result[STORAGE_KEY];
          this.logs = [...storedLogs, ...this.logs].slice(-MAX_PERSISTENT_LOGS);
          console.log(
            `[Logger] Rehydrated ${storedLogs.length} logs from persistent storage.`
          );
        }
      } catch (error) {
        console.error("[Logger] Failed to rehydrate logs:", error);
      }
    }
    /**
     * Flush logs to persistent storage
     * This method saves the current in-memory logs with circular buffer logic
     */
    async flush() {
      try {
        if (this.logs.length > MAX_PERSISTENT_LOGS) {
          this.logs = this.logs.slice(this.logs.length - MAX_PERSISTENT_LOGS);
        }
        await chrome.storage.local.set({ [STORAGE_KEY]: this.logs });
      } catch (error) {
        console.error("[Logger] Failed to flush logs to storage:", error);
      }
    }
    /**
     * Clear all logs from memory and persistent storage
     * This method is called when the user clicks "Clear All Logs" in the debug dashboard
     */
    async clearLogs() {
      this.logs = [];
      await this.flush();
      this.log("GENERAL", "INFO", "Log buffer has been cleared by the user.");
    }
    sanitize(data, seen = /* @__PURE__ */ new WeakSet()) {
      if (!DEBUG_CONFIG.sanitizeData) return data;
      if (typeof data === "string") {
        if (URL_VALUE_PATTERN.test(data) || EMAIL_VALUE_PATTERN.test(data) || PHONE_VALUE_PATTERN.test(data)) {
          return REDACTED_VALUE;
        }
        if (data.length > 20 && /^[a-zA-Z0-9_-]+$/.test(data)) {
          return data.substring(0, 4) + "***" + data.substring(data.length - 4);
        }
        return data;
      }
      if (data && typeof data === "object") {
        if (seen.has(data)) return "[circular]";
        seen.add(data);
        if (Array.isArray(data)) {
          return data.map((item) => this.sanitize(item, seen));
        }
        const sanitized = {};
        for (const [key, value] of Object.entries(data)) {
          sanitized[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED_VALUE : this.sanitize(value, seen);
        }
        return sanitized;
      }
      return data;
    }
    getTimestamp() {
      const now = /* @__PURE__ */ new Date();
      const elapsed = Date.now() - this.startTime;
      return `${now.toISOString()} (+${elapsed}ms)`;
    }
    /**
     * Format data for console output to avoid [object Object]
     */
    formatDataForConsole(data) {
      if (typeof data === "object" && data !== null) {
        try {
          return JSON.stringify(data, null, 2);
        } catch {
          return String(data);
        }
      }
      return String(data ?? "null");
    }
    /**
     * Format error for console output
     */
    formatErrorForConsole(error) {
      if (!error) return "null";
      if (error instanceof Error) {
        return `${error.name}: ${error.message}`;
      }
      try {
        return JSON.stringify(error, null, 2);
      } catch {
        return String(error);
      }
    }
    log(category, level, message, data = null, error = null) {
      if (!DEBUG_CONFIG.enabled || !DEBUG_CONFIG.categories[category]) return;
      const timestamp = this.getTimestamp();
      const entry = {
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
      if (error && level === "ERROR") {
        globalErrorTracker.trackError(
          error,
          { category, message, data: data ? this.sanitize(data) : null },
          category
        );
      }
      this.logs.push(entry);
      const prefix = `[${category}:${level}] ${timestamp}`;
      const full = `${prefix} ${message}`;
      const sanitized = data ? this.sanitize(data) : null;
      switch (level) {
        case "ERROR":
          if (sanitized && error) {
            console.error(full);
            console.error("  Data:", this.formatDataForConsole(sanitized));
            console.error("  Error:", this.formatErrorForConsole(error));
          } else if (sanitized) {
            console.error(full);
            console.error("  Data:", this.formatDataForConsole(sanitized));
          } else if (error) {
            console.error(full);
            console.error("  Error:", this.formatErrorForConsole(error));
          } else {
            console.error(full);
          }
          break;
        case "WARN":
          if (sanitized) {
            console.warn(full);
            console.warn("  Data:", this.formatDataForConsole(sanitized));
          } else {
            console.warn(full);
          }
          break;
        case "INFO":
          if (sanitized) {
            console.info(full);
            console.info("  Data:", this.formatDataForConsole(sanitized));
          } else {
            console.info(full);
          }
          break;
        default:
          if (sanitized) {
            console.log(full);
            console.log("  Data:", sanitized);
          } else {
            console.log(full);
          }
      }
    }
    websocket(level, message, data, error) {
      this.log("WEBSOCKET", level, message, data, error || null);
    }
    notifications(level, message, data, error) {
      this.log("NOTIFICATIONS", level, message, data, error || null);
    }
    api(level, message, data, error) {
      this.log("API", level, message, data, error || null);
    }
    storage(level, message, data, error) {
      this.log("STORAGE", level, message, data, error || null);
    }
    general(level, message, data, error) {
      this.log("GENERAL", level, message, data, error || null);
    }
    performance(level, message, data, error) {
      this.log("PERFORMANCE", level, message, data, error || null);
    }
    error(message, data, error) {
      this.log("ERROR", "ERROR", message, data, error || null);
    }
    startTimer(name) {
      this.performanceMarkers.set(name, Date.now());
      this.performance("DEBUG", `Timer started: ${name}`);
    }
    endTimer(name) {
      const start = this.performanceMarkers.get(name);
      if (start) {
        const duration = Date.now() - start;
        this.performanceMarkers.delete(name);
        this.performance("INFO", `Timer ended: ${name}`, {
          duration: `${duration}ms`
        });
        return duration;
      }
      this.performance("WARN", `Timer not found: ${name}`);
      return null;
    }
    getRecentLogs(count = 50, category = null) {
      let logs = this.logs;
      if (category) logs = logs.filter((l) => l.category === category);
      return logs.slice(-count);
    }
    exportLogs() {
      return {
        config: DEBUG_CONFIG,
        logs: this.logs,
        summary: {
          totalLogs: this.logs.length,
          categories: Object.keys(DEBUG_CONFIG.categories).reduce((acc, cat) => {
            acc[cat] = this.logs.filter((l) => l.category === cat).length;
            return acc;
          }, {}),
          errors: this.logs.filter((l) => l.level === "ERROR").length
        }
      };
    }
  };
  var debugLogger = new DebugLogger();
  debugLogger.rehydrate();
  var DebugConfigManager = class {
    async loadConfig() {
      try {
        debugLogger.storage("DEBUG", "Loading debug configuration from storage");
        const result = await chrome.storage.local.get(["debugConfig"]);
        if (result.debugConfig) {
          Object.assign(DEBUG_CONFIG, result.debugConfig);
          debugLogger.storage(
            "INFO",
            "Debug configuration loaded from storage",
            DEBUG_CONFIG
          );
        } else {
          debugLogger.storage(
            "INFO",
            "No stored debug configuration found - using defaults",
            DEBUG_CONFIG
          );
        }
      } catch (error) {
        debugLogger.storage(
          "ERROR",
          "Failed to load debug configuration",
          null,
          error
        );
      }
    }
    async saveConfig() {
      try {
        debugLogger.storage("DEBUG", "Saving debug configuration to storage");
        await chrome.storage.local.set({ debugConfig: DEBUG_CONFIG });
        debugLogger.storage("INFO", "Debug configuration saved to storage");
      } catch (error) {
        debugLogger.storage(
          "ERROR",
          "Failed to save debug configuration",
          null,
          error
        );
      }
    }
    async updateConfig(updates) {
      Object.assign(DEBUG_CONFIG, updates);
      await this.saveConfig();
      debugLogger.general("INFO", "Debug configuration updated", updates);
    }
    toggleCategory(category) {
      if (Object.prototype.hasOwnProperty.call(DEBUG_CONFIG.categories, category)) {
        DEBUG_CONFIG.categories[category] = !DEBUG_CONFIG.categories[category];
        void this.saveConfig();
        debugLogger.general("INFO", `Debug category ${category} toggled`, {
          category,
          enabled: DEBUG_CONFIG.categories[category]
        });
      }
    }
    setLogLevel(level) {
      const valid = ["DEBUG", "INFO", "WARN", "ERROR"];
      if (valid.includes(level)) {
        DEBUG_CONFIG.logLevel = level;
        void this.saveConfig();
        debugLogger.general("INFO", `Debug log level set to ${level}`);
      }
    }
    getConfig() {
      return { ...DEBUG_CONFIG };
    }
    resetConfig() {
      const def = {
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
        logLevel: "DEBUG",
        maxLogEntries: 1e3,
        sanitizeData: true
      };
      Object.assign(DEBUG_CONFIG, def);
      void this.saveConfig();
      debugLogger.general("INFO", "Debug configuration reset to defaults");
    }
  };
  var debugConfigManager = new DebugConfigManager();
  var GlobalErrorTracker = class {
    errors = [];
    errorCounts = /* @__PURE__ */ new Map();
    criticalErrors = [];
    trackError(error, context = {}, category = "GENERAL") {
      const entry = {
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        category,
        message: error.message,
        name: error.name,
        stack: error.stack,
        context
      };
      this.errors.push(entry);
      if (this.errors.length > MAX_TRACKED_ERRORS) {
        this.errors = this.errors.slice(-MAX_TRACKED_ERRORS);
      }
      const count = (this.errorCounts.get(category) || 0) + 1;
      this.errorCounts.set(category, count);
      if (count >= 5) {
        this.criticalErrors.push(entry);
        if (this.criticalErrors.length > MAX_TRACKED_ERRORS) {
          this.criticalErrors = this.criticalErrors.slice(-MAX_TRACKED_ERRORS);
        }
      }
    }
    getErrorSummary() {
      const byCat = {};
      this.errorCounts.forEach((v, k) => byCat[k] = v);
      return {
        total: this.errors.length,
        byCategory: byCat,
        critical: this.criticalErrors.length
      };
    }
    exportErrorData() {
      return { errors: this.errors.slice(-200), summary: this.getErrorSummary() };
    }
  };
  var globalErrorTracker = new GlobalErrorTracker();
  try {
    self.addEventListener("error", (event) => {
      globalErrorTracker.trackError(
        event.error || new Error(event.message),
        {
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
          type: "unhandled"
        },
        "GLOBAL"
      );
    });
  } catch (error) {
    console.warn("Failed to set up global unhandled rejection handler:", error);
  }
  try {
    self.addEventListener(
      "unhandledrejection",
      (event) => {
        globalErrorTracker.trackError(
          event.reason || new Error("Unhandled promise rejection"),
          { type: "unhandled_promise" },
          "GLOBAL"
        );
      }
    );
  } catch {
  }

  // src/lib/perf/index.ts
  var PerformanceMonitor = class {
    metrics = /* @__PURE__ */ new Map();
    notificationTimeline = [];
    websocketMetrics = { connectionAttempts: 0, successfulConnections: 0, messagesReceived: 0, messagesProcessed: 0, reconnectionAttempts: 0, lastConnectionTime: null, totalDowntime: 0 };
    notificationMetrics = { pushesReceived: 0, notificationsCreated: 0, notificationsFailed: 0, unknownTypes: 0 };
    healthChecks = { success: 0, failure: 0, lastCheck: null };
    quality = { disconnections: 0, permanentErrors: 0, consecutiveFailures: 0 };
    recoveryMetrics = { invalidCursorRecoveries: 0, lastRecoveryTime: null };
    timers = {};
    record(metric, value = 1) {
      const cur = this.metrics.get(metric) || 0;
      this.metrics.set(metric, cur + value);
    }
    start(name) {
      this.timers[name] = Date.now();
    }
    end(name) {
      if (this.timers[name]) {
        const d = Date.now() - this.timers[name];
        delete this.timers[name];
        this.record(`timer:${name}`, d);
        return d;
      }
      return null;
    }
    recordWebSocketConnection(success) {
      this.websocketMetrics.connectionAttempts++;
      if (success) {
        this.websocketMetrics.successfulConnections++;
        this.websocketMetrics.lastConnectionTime = Date.now();
        this.quality.consecutiveFailures = 0;
      }
    }
    recordWebSocketMessage(received = true, processed = false) {
      if (received) this.websocketMetrics.messagesReceived++;
      if (processed) this.websocketMetrics.messagesProcessed++;
    }
    recordWebSocketReconnection() {
      this.websocketMetrics.reconnectionAttempts++;
      this.quality.consecutiveFailures++;
    }
    recordHealthCheckSuccess() {
      this.healthChecks.success++;
      this.healthChecks.lastCheck = Date.now();
      this.quality.consecutiveFailures = 0;
    }
    recordHealthCheckFailure() {
      this.healthChecks.failure++;
      this.healthChecks.lastCheck = Date.now();
      this.quality.consecutiveFailures++;
    }
    recordDisconnection() {
      this.quality.disconnections++;
    }
    recordPermanentError() {
      this.quality.permanentErrors++;
    }
    recordNotification(event) {
      this.notificationTimeline.push({ ts: Date.now(), event });
      if (this.notificationTimeline.length > 200) this.notificationTimeline.shift();
    }
    recordPushReceived() {
      this.notificationMetrics.pushesReceived++;
    }
    recordNotificationCreated() {
      this.notificationMetrics.notificationsCreated++;
    }
    recordNotificationFailed() {
      this.notificationMetrics.notificationsFailed++;
    }
    recordUnknownPushType() {
      this.notificationMetrics.unknownTypes++;
    }
    recordInvalidCursorRecovery() {
      this.recoveryMetrics.invalidCursorRecoveries++;
      this.recoveryMetrics.lastRecoveryTime = Date.now();
    }
    getPerformanceSummary() {
      return { websocket: this.websocketMetrics, health: this.healthChecks, quality: this.quality, notifications: this.notificationMetrics, recovery: this.recoveryMetrics, metrics: Object.fromEntries(this.metrics) };
    }
    getQualityMetrics() {
      return this.quality;
    }
    exportPerformanceData() {
      return { summary: this.getPerformanceSummary(), timeline: this.notificationTimeline.slice(-200) };
    }
    reset() {
      this.metrics = /* @__PURE__ */ new Map();
      this.notificationTimeline = [];
      this.websocketMetrics = { connectionAttempts: 0, successfulConnections: 0, messagesReceived: 0, messagesProcessed: 0, reconnectionAttempts: 0, lastConnectionTime: null, totalDowntime: 0 };
      this.notificationMetrics = { pushesReceived: 0, notificationsCreated: 0, notificationsFailed: 0, unknownTypes: 0 };
      this.healthChecks = { success: 0, failure: 0, lastCheck: null };
      this.quality = { disconnections: 0, permanentErrors: 0, consecutiveFailures: 0 };
      this.recoveryMetrics = { invalidCursorRecoveries: 0, lastRecoveryTime: null };
      this.timers = {};
    }
  };
  var performanceMonitor = new PerformanceMonitor();

  // src/lib/events/event-bus.ts
  var EventBus = class {
    /**
     * Map of event names to sets of listener functions
     * Using Set ensures each listener is only registered once
     */
    listeners = /* @__PURE__ */ new Map();
    /**
     * Register a listener for an event
     * 
     * @param event - Event name (e.g., 'websocket:connected')
     * @param listener - Function to call when event is emitted
     * 
     * @example
     * ```typescript
     * globalEventBus.on('websocket:connected', () => {
     *   console.log('WebSocket connected!');
     * });
     * ```
     */
    on(event, listener) {
      if (!this.listeners.has(event)) {
        this.listeners.set(event, /* @__PURE__ */ new Set());
      }
      this.listeners.get(event).add(listener);
    }
    /**
     * Remove a listener for an event
     * 
     * @param event - Event name
     * @param listener - Listener function to remove
     * 
     * @example
     * ```typescript
     * const handler = () => console.log('Connected');
     * globalEventBus.on('websocket:connected', handler);
     * globalEventBus.off('websocket:connected', handler);
     * ```
     */
    off(event, listener) {
      const eventListeners = this.listeners.get(event);
      if (eventListeners) {
        eventListeners.delete(listener);
        if (eventListeners.size === 0) {
          this.listeners.delete(event);
        }
      }
    }
    /**
     * Emit an event to all registered listeners
     * 
     * @param event - Event name
     * @param data - Optional data to pass to listeners
     * 
     * @example
     * ```typescript
     * globalEventBus.emit('websocket:message', { 
     *   type: 'push', 
     *   data: { title: 'Hello' } 
     * });
     * ```
     */
    emit(event, data) {
      const eventListeners = this.listeners.get(event);
      if (eventListeners) {
        eventListeners.forEach((listener) => {
          try {
            listener(data);
          } catch (error) {
            console.error(`Error in event listener for '${event}':`, error);
          }
        });
      }
    }
    /**
     * Register a one-time listener for an event
     * The listener will be automatically removed after being called once
     * 
     * @param event - Event name
     * @param listener - Function to call when event is emitted
     * 
     * @example
     * ```typescript
     * globalEventBus.once('websocket:connected', () => {
     *   console.log('Connected for the first time!');
     * });
     * ```
     */
    once(event, listener) {
      const onceWrapper = (data) => {
        listener(data);
        this.off(event, onceWrapper);
      };
      this.on(event, onceWrapper);
    }
    /**
     * Remove all listeners for an event
     * If no event is specified, removes all listeners for all events
     * 
     * @param event - Optional event name. If not provided, clears all listeners
     * 
     * @example
     * ```typescript
     * // Remove all listeners for a specific event
     * globalEventBus.removeAllListeners('websocket:connected');
     * 
     * // Remove all listeners for all events
     * globalEventBus.removeAllListeners();
     * ```
     */
    removeAllListeners(event) {
      if (event) {
        this.listeners.delete(event);
      } else {
        this.listeners.clear();
      }
    }
    /**
     * Get the number of listeners for an event
     * 
     * @param event - Event name
     * @returns Number of listeners registered for the event
     * 
     * @example
     * ```typescript
     * const count = globalEventBus.listenerCount('websocket:connected');
     * console.log(`${count} listeners registered`);
     * ```
     */
    listenerCount(event) {
      const eventListeners = this.listeners.get(event);
      return eventListeners ? eventListeners.size : 0;
    }
    /**
     * Get all event names that have listeners
     * 
     * @returns Array of event names
     * 
     * @example
     * ```typescript
     * const events = globalEventBus.eventNames();
     * console.log('Events with listeners:', events);
     * ```
     */
    eventNames() {
      return Array.from(this.listeners.keys());
    }
  };
  var globalEventBus = new EventBus();

  // src/lib/monitoring/index.ts
  var InitializationTracker = class {
    initializations = [];
    stats = { onInstalled: 0, onStartup: 0, onAlarm: 0, onMessage: 0, manual: 0 };
    recordInitialization(source) {
      this.initializations.push({ source, timestamp: (/* @__PURE__ */ new Date()).toISOString() });
      if (this.stats[source] !== void 0) this.stats[source]++;
    }
    exportData() {
      return { initializations: this.initializations.slice(-100), stats: { ...this.stats } };
    }
  };
  var initTracker = new InitializationTracker();
  var READY_STATE_NAMES = ["CONNECTING", "OPEN", "CLOSING", "CLOSED"];
  var EVENT_STATE_NAMES = {
    connected: "OPEN",
    disconnected: "CLOSED",
    "permanent-error": "CLOSED"
  };
  var WebSocketStateMonitor = class {
    constructor(stateSource) {
      this.stateSource = stateSource;
    }
    stateHistory = [];
    lastStateCheck = Date.now();
    monitoringInterval = null;
    alertThresholds = { slowReceive: 15e3 };
    currentState = null;
    recordStateChange(newState) {
      const now = Date.now();
      const prev = this.stateHistory[this.stateHistory.length - 1];
      const duration = prev ? now - prev.timestamp : 0;
      const state = this.normalizeState(newState);
      this.currentState = state;
      this.stateHistory.push({ timestamp: now, state, duration });
      if (this.stateHistory.length > 200) this.stateHistory.shift();
    }
    setCurrentState(newState) {
      this.recordStateChange(newState);
    }
    getStateReport() {
      const currentState = this.getCurrentState();
      return { currentState, lastCheck: new Date(this.lastStateCheck).toISOString(), historyLength: this.stateHistory.length };
    }
    startMonitoring() {
      if (this.monitoringInterval) return;
      this.monitoringInterval = setInterval(() => {
        this.lastStateCheck = Date.now();
        const state = this.getCurrentState();
        try {
          debugLogger.websocket("DEBUG", "WebSocket state check", { state });
        } catch (error) {
          debugLogger.general("WARN", "Failed to log WebSocket state check", null, error);
        }
      }, 3e4);
    }
    stopMonitoring() {
      if (this.monitoringInterval) {
        clearInterval(this.monitoringInterval);
        this.monitoringInterval = null;
      }
    }
    getCurrentState() {
      if (this.stateSource) return this.normalizeState(this.stateSource()) ?? "NULL";
      return this.currentState ?? "NULL";
    }
    normalizeState(state) {
      if (state === null) return null;
      if (typeof state === "number") return READY_STATE_NAMES[state] ?? "NULL";
      return EVENT_STATE_NAMES[state] ?? state;
    }
  };
  var wsStateMonitor = new WebSocketStateMonitor();
  globalEventBus.on("websocket:state", (state) => {
    wsStateMonitor.recordStateChange(state);
  });

  // src/types/domain.ts
  function isLinkPush(push) {
    return push.type === "link";
  }

  // src/app/notifications/index.ts
  function createNotificationWithTimeout(notificationId, options, callback, timeoutMs) {
    const iconUrl = chrome.runtime.getURL("icons/icon128.png");
    const safeOptions = {
      type: options.type || "basic",
      iconUrl: options.iconUrl || iconUrl,
      // Use absolute URL
      title: options.title || "Pushbullet",
      message: options.message || "",
      priority: options.priority || 1
    };
    if (options.imageUrl) {
      safeOptions.imageUrl = options.imageUrl;
    }
    debugLogger.notifications(
      "DEBUG",
      "Creating notification with safe options",
      {
        notificationId,
        iconUrl,
        title: safeOptions.title,
        messageLength: safeOptions.message?.length || 0
      }
    );
    return new Promise((resolve) => {
      chrome.notifications.create(notificationId, safeOptions, (createdId) => {
        if (chrome.runtime.lastError) {
          debugLogger.notifications("ERROR", "Notification creation error", {
            error: chrome.runtime.lastError.message,
            notificationId
          });
        }
        if (callback) callback(createdId);
        try {
          const timeout = timeoutMs !== void 0 ? timeoutMs : 1e4;
          if (typeof timeout === "number" && timeout > 0) {
            setTimeout(() => {
              chrome.notifications.clear(createdId || notificationId, () => {
              });
            }, timeout);
          }
        } catch (error) {
          debugLogger.notifications(
            "ERROR",
            "Failed to set notification timeout",
            {
              error: error.message
            },
            error
          );
        }
        resolve();
      });
    });
  }
  function showPermanentWebSocketError(closeInfo) {
    const title = "Pushbullet requires attention";
    const message = `Real-time connection stopped (code ${closeInfo.code}). ${closeInfo.reason || ""}`.trim();
    createNotificationWithTimeout(
      "pushbullet-permanent-error",
      {
        type: "basic",
        iconUrl: "icons/icon128.png",
        title,
        message,
        priority: 2
      },
      () => {
      }
    );
    try {
      chrome.action.setBadgeBackgroundColor({ color: "#d93025" });
      chrome.action.setBadgeText({ text: "ERR" });
    } catch (error) {
      debugLogger.general(
        "WARN",
        "Failed to set error badge",
        null,
        error
      );
    }
  }
  function clearErrorBadge() {
    try {
      chrome.action.setBadgeText({ text: " " });
    } catch (error) {
      debugLogger.general(
        "WARN",
        "Failed to clear error badge",
        null,
        error
      );
    }
  }

  // src/app/ws/client.ts
  var WebSocketClient = class {
    constructor(websocketUrl, getApiKey2) {
      this.websocketUrl = websocketUrl;
      this.getApiKey = getApiKey2;
    }
    static NOP_TIMEOUT = 6e4;
    // 60 seconds
    socket = null;
    reconnectAttempts = 0;
    reconnectTimeout = null;
    lastNopAt = 0;
    /**
     * Get current WebSocket instance
     */
    getSocket() {
      return this.socket;
    }
    /**
     * Get current ready state
     */
    getReadyState() {
      return this.socket?.readyState ?? WebSocket.CLOSED;
    }
    /**
     * Check if WebSocket is connected
     */
    isConnected() {
      return this.socket !== null && this.socket.readyState === 1 /* OPEN */;
    }
    /**
     * Connect to WebSocket
     */
    connect() {
      try {
        const apiKey2 = this.getApiKey();
        if (!apiKey2) {
          debugLogger.websocket("WARN", "connectWebSocket called without apiKey");
          return;
        }
        if (this.socket && this.socket.readyState === 1 /* OPEN */) {
          debugLogger.websocket("DEBUG", "WebSocket already open");
          return;
        }
        const url = this.websocketUrl + apiKey2;
        debugLogger.websocket("INFO", "WebSocket URL construction debug", {
          baseUrl: this.websocketUrl,
          hasApiKey: apiKey2.length > 0,
          apiKeyLength: apiKey2.length,
          finalUrlLength: url.length,
          urlPattern: this.websocketUrl + "***"
        });
        debugLogger.websocket("INFO", "Connecting to WebSocket", {
          url: this.websocketUrl + "***",
          reconnectAttempts: this.reconnectAttempts,
          currentSocketState: this.socket ? this.socket.readyState : "no_existing_socket",
          apiKeyPresent: !!apiKey2
        });
        this.reconnectAttempts = 0;
        debugLogger.websocket("DEBUG", "About to create WebSocket object", {
          url: this.websocketUrl + "***",
          currentSocketExists: !!this.socket,
          currentSocketState: this.socket ? this.socket.readyState : "null"
        });
        try {
          this.socket = new WebSocket(url);
          debugLogger.websocket(
            "DEBUG",
            "WebSocket object created successfully",
            {
              url: this.websocketUrl + "***",
              readyState: this.socket.readyState,
              urlLength: url.length
            }
          );
        } catch (createError) {
          debugLogger.websocket("ERROR", "Failed to create WebSocket object", {
            url: this.websocketUrl + "***",
            error: createError instanceof Error ? createError.message : String(createError),
            errorType: createError?.constructor?.name,
            timestamp: (/* @__PURE__ */ new Date()).toISOString()
          });
          this.socket = null;
          throw createError;
        }
        debugLogger.websocket("DEBUG", "Setting up WebSocket event handlers", {
          url: this.websocketUrl + "***",
          readyState: this.socket.readyState,
          socketExists: !!this.socket
        });
        this.socket.onopen = () => {
          debugLogger.websocket("INFO", "WebSocket connection established", {
            timestamp: (/* @__PURE__ */ new Date()).toISOString()
          });
          this.lastNopAt = Date.now();
          performanceMonitor.recordWebSocketConnection(true);
          wsStateMonitor.startMonitoring();
          globalEventBus.emit("websocket:polling:stop");
          try {
            clearErrorBadge();
          } catch {
          }
          globalEventBus.emit("websocket:connected");
          globalEventBus.emit("websocket:state", "connected");
        };
        this.socket.onmessage = (ev) => {
          let parsedMessage;
          try {
            parsedMessage = JSON.parse(ev.data);
          } catch (error) {
            debugLogger.websocket("WARN", "Malformed WebSocket frame ignored", {
              dataType: typeof ev.data,
              errorType: error instanceof Error ? error.name : typeof error,
              timestamp: (/* @__PURE__ */ new Date()).toISOString()
            });
            return;
          }
          const msg = parsedMessage;
          globalEventBus.emit("websocket:message", msg);
          if (msg.type === "nop") {
            this.lastNopAt = Date.now();
            debugLogger.websocket("DEBUG", "Server nop received", { timestamp: new Date(this.lastNopAt).toISOString() });
          }
          if (msg.type === "tickle") {
            if (msg.subtype === "push") {
              globalEventBus.emit("websocket:tickle:push");
            } else if (msg.subtype === "device") {
              globalEventBus.emit("websocket:tickle:device");
            }
          }
          if (msg.type === "push") {
            if ("push" in msg && msg.push) {
              globalEventBus.emit("websocket:push", msg.push);
            } else {
              debugLogger.websocket(
                "WARN",
                "Push message received without push payload"
              );
            }
          }
        };
        this.socket.onerror = (error) => {
          const currentSocket = this.socket;
          const socketExists = !!currentSocket;
          const socketState = socketExists ? currentSocket.readyState : "no_socket";
          const isConnecting = socketExists ? currentSocket.readyState === 0 /* CONNECTING */ : false;
          const isConnected = socketExists ? currentSocket.readyState === 1 /* OPEN */ : false;
          const errorInfo = {
            type: error.type || "unknown",
            target: error.target ? "WebSocket" : "unknown",
            readyState: socketState,
            socketExists,
            url: this.websocketUrl,
            timestamp: (/* @__PURE__ */ new Date()).toISOString(),
            reconnectAttempts: this.reconnectAttempts,
            // Additional debugging info
            isConnecting,
            isConnected,
            errorEventDetails: {
              timeStamp: error.timeStamp,
              bubbles: error.bubbles,
              cancelable: error.cancelable,
              currentTarget: error.currentTarget ? "WebSocket" : "unknown"
            }
          };
          debugLogger.websocket("ERROR", "WebSocket error occurred", errorInfo);
          const websocketError = new Error(
            `WebSocket connection error: ${errorInfo.type} (socket: ${socketExists ? "exists" : "null"}, state: ${socketState})`
          );
          websocketError.name = "WebSocketError";
          globalErrorTracker.trackError(
            websocketError,
            {
              category: "WEBSOCKET",
              message: "WebSocket error occurred",
              data: errorInfo
            },
            "WEBSOCKET"
          );
        };
        this.socket.onclose = (event) => {
          const closeInfo = {
            code: event.code,
            reason: event.reason || "No reason provided",
            wasClean: event.wasClean
          };
          debugLogger.websocket("WARN", "WebSocket connection closed", {
            ...closeInfo,
            timestamp: (/* @__PURE__ */ new Date()).toISOString(),
            reconnectAttempts: this.reconnectAttempts
          });
          const isPermanentClose = event.code === 1008 || event.code === 4001 || event.code >= 4e3 && event.code < 5e3;
          if (isPermanentClose) {
            debugLogger.websocket(
              "ERROR",
              "Permanent WebSocket error - stopping reconnection attempts",
              closeInfo
            );
            globalEventBus.emit("websocket:permanent-error", closeInfo);
            globalEventBus.emit("websocket:state", "permanent-error");
            try {
              showPermanentWebSocketError(closeInfo);
            } catch {
            }
            return;
          }
          globalEventBus.emit("websocket:disconnected", closeInfo);
          globalEventBus.emit("websocket:state", "disconnected");
        };
      } catch (error) {
        debugLogger.websocket(
          "ERROR",
          "Failed to create WebSocket connection",
          {
            url: this.websocketUrl + "***",
            hasApiKey: !!this.getApiKey()
          },
          error
        );
      }
    }
    /**
     * Disconnect WebSocket
     */
    disconnect() {
      if (this.socket) {
        try {
          debugLogger.websocket("INFO", "Disconnecting WebSocket", {
            readyState: this.socket.readyState
          });
          this.socket.close();
          this.socket = null;
          wsStateMonitor.stopMonitoring();
        } catch (error) {
          debugLogger.websocket(
            "ERROR",
            "Error disconnecting WebSocket",
            null,
            error
          );
        }
      }
    }
    /**
     * Get reconnect attempts count
     */
    getReconnectAttempts() {
      return this.reconnectAttempts;
    }
    /**
     * Reset reconnect attempts
     */
    resetReconnectAttempts() {
      this.reconnectAttempts = 0;
    }
    isConnectionHealthy() {
      const NOP_TIMEOUT_MS = 6e4;
      if (this.socket?.readyState !== 1 /* OPEN */) return false;
      const age = Date.now() - this.lastNopAt;
      return age >= 0 && age <= NOP_TIMEOUT_MS;
    }
  };

  // src/infrastructure/storage/storage.repository.ts
  var getStringOrNull = (value) => typeof value === "string" ? value : null;
  var getBooleanOrDefault = (value, fallback) => typeof value === "boolean" ? value : fallback;
  var getNumberOrDefault = (value, fallback) => typeof value === "number" ? value : fallback;
  var ENCRYPTION_PASSWORD_KEY = "encryptionPassword";
  var PROCESSED_PUSHES_KEY = "processedPushes";
  var MAX_PROCESSED_PUSH_MARKERS = 500;
  var getProcessedPushMarkers = (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {};
    }
    const markers = {};
    for (const [iden, modified] of Object.entries(value)) {
      if (typeof modified === "number" && Number.isFinite(modified)) {
        markers[iden] = modified;
      }
    }
    return markers;
  };
  var pruneProcessedPushMarkers = (markers) => Object.fromEntries(
    Object.entries(markers).sort(([, leftModified], [, rightModified]) => rightModified - leftModified).slice(0, MAX_PROCESSED_PUSH_MARKERS)
  );
  var ChromeStorageRepository = class {
    fallbackEncryptionPassword = null;
    getSessionStorage() {
      return chrome.storage.session;
    }
    async removeLegacyEncryptionPassword() {
      try {
        await chrome.storage.local.remove([ENCRYPTION_PASSWORD_KEY]);
        const result = await chrome.storage.local.get([ENCRYPTION_PASSWORD_KEY]);
        if (getStringOrNull(result[ENCRYPTION_PASSWORD_KEY]) !== null) {
          console.warn("Storage: Failed to remove legacy encryption password from local storage");
        }
      } catch (error) {
        console.warn("Storage: Failed to clean up legacy encryption password from local storage", {
          errorType: error instanceof Error ? error.name : typeof error
        });
      }
    }
    /**
     * Get API Key from local storage
     * Security: API keys are stored in local storage (not synced) to prevent
     * exposure through Chrome's sync infrastructure
     */
    async getApiKey() {
      const result = await chrome.storage.local.get(["apiKey"]);
      return getStringOrNull(result.apiKey);
    }
    /**
     * Set API Key in local storage
     * Security: API keys are stored in local storage (not synced) to prevent
     * exposure through Chrome's sync infrastructure
     */
    async setApiKey(key) {
      if (key === null) {
        await chrome.storage.local.remove(["apiKey"]);
      } else {
        await chrome.storage.local.set({ apiKey: key });
      }
    }
    /**
     * Get Device Identifier from local storage
     */
    async getDeviceIden() {
      const result = await chrome.storage.local.get(["deviceIden"]);
      return getStringOrNull(result.deviceIden);
    }
    /**
     * Set Device Identifier in local storage
     */
    async setDeviceIden(iden) {
      if (iden === null) {
        await chrome.storage.local.remove(["deviceIden"]);
      } else {
        await chrome.storage.local.set({ deviceIden: iden });
      }
    }
    /**
      * Get Device Nickname from local storage
      */
    async getDeviceNickname() {
      const result = await chrome.storage.local.get(["deviceNickname"]);
      return getStringOrNull(result.deviceNickname);
    }
    /**
      * Set Device Nickname in local storage
      */
    async setDeviceNickname(nickname) {
      await chrome.storage.local.set({ deviceNickname: nickname });
    }
    /**
     * Get Auto Open Links setting from sync storage
     */
    async getAutoOpenLinks() {
      const result = await chrome.storage.sync.get(["autoOpenLinks"]);
      return getBooleanOrDefault(result.autoOpenLinks, false);
    }
    /**
     * Set Auto Open Links setting in sync storage
     */
    async setAutoOpenLinks(enabled) {
      await chrome.storage.sync.set({ autoOpenLinks: enabled });
    }
    /**
     * Get Notification Timeout from sync storage
     */
    async getNotificationTimeout() {
      const result = await chrome.storage.sync.get(["notificationTimeout"]);
      return getNumberOrDefault(result.notificationTimeout, 5e3);
    }
    /**
     * Set Notification Timeout in sync storage
     */
    async setNotificationTimeout(timeout) {
      await chrome.storage.sync.set({ notificationTimeout: timeout });
    }
    /**
     * Get Only This Device setting from sync storage
     */
    async getOnlyThisDevice() {
      const result = await chrome.storage.sync.get(["onlyThisDevice"]);
      return getBooleanOrDefault(result.onlyThisDevice, false);
    }
    /**
     * Set Only This Device setting in sync storage
     */
    async setOnlyThisDevice(value) {
      await chrome.storage.sync.set({ onlyThisDevice: value });
    }
    /**
     * Get Encryption Password from session storage when available.
     * Existing local plaintext values are migrated once, then removed.
     */
    async getEncryptionPassword() {
      const sessionStorage = this.getSessionStorage();
      if (sessionStorage) {
        const sessionResult = await sessionStorage.get([ENCRYPTION_PASSWORD_KEY]);
        const sessionPassword = getStringOrNull(sessionResult[ENCRYPTION_PASSWORD_KEY]);
        if (sessionPassword) {
          return sessionPassword;
        }
      }
      const localResult = await chrome.storage.local.get([ENCRYPTION_PASSWORD_KEY]);
      const localPassword = getStringOrNull(localResult[ENCRYPTION_PASSWORD_KEY]);
      if (localPassword && sessionStorage) {
        await sessionStorage.set({ [ENCRYPTION_PASSWORD_KEY]: localPassword });
        await this.removeLegacyEncryptionPassword();
      }
      if (!sessionStorage) {
        return localPassword ?? this.fallbackEncryptionPassword;
      }
      return localPassword;
    }
    /**
     * Set Encryption Password in session storage when available.
     * Falls back to memory only on browsers without storage.session.
     */
    async setEncryptionPassword(password) {
      const sessionStorage = this.getSessionStorage();
      if (password === null) {
        this.fallbackEncryptionPassword = null;
        await Promise.all([
          sessionStorage?.remove([ENCRYPTION_PASSWORD_KEY]) ?? Promise.resolve(),
          chrome.storage.local.remove([ENCRYPTION_PASSWORD_KEY])
        ]);
      } else if (sessionStorage) {
        this.fallbackEncryptionPassword = null;
        await sessionStorage.set({ [ENCRYPTION_PASSWORD_KEY]: password });
        await this.removeLegacyEncryptionPassword();
      } else {
        this.fallbackEncryptionPassword = password;
        await chrome.storage.local.remove([ENCRYPTION_PASSWORD_KEY]);
      }
    }
    /**
     * Get Scroll to Recent Pushes flag from local storage
     */
    async getScrollToRecentPushes() {
      const result = await chrome.storage.local.get(["scrollToRecentPushes"]);
      return getBooleanOrDefault(result.scrollToRecentPushes, false);
    }
    /**
     * Set Scroll to Recent Pushes flag in local storage
     */
    async setScrollToRecentPushes(scroll) {
      await chrome.storage.local.set({ scrollToRecentPushes: scroll });
    }
    /**
     * Remove Scroll to Recent Pushes flag from local storage
     */
    async removeScrollToRecentPushes() {
      await chrome.storage.local.remove(["scrollToRecentPushes"]);
    }
    /**
     * Get Device Registration In Progress flag from local storage
     */
    async getDeviceRegistrationInProgress() {
      const result = await chrome.storage.local.get(["deviceRegistrationInProgress"]);
      return getBooleanOrDefault(result.deviceRegistrationInProgress, false);
    }
    /**
     * Set Device Registration In Progress flag in local storage
     */
    async setDeviceRegistrationInProgress(inProgress) {
      await chrome.storage.local.set({ deviceRegistrationInProgress: inProgress });
    }
    /**
     * Get Last Modified Cutoff from local storage
     */
    async getLastModifiedCutoff() {
      const result = await chrome.storage.local.get(["lastModifiedCutoff"]);
      const cutoff = result.lastModifiedCutoff;
      return typeof cutoff === "number" ? cutoff : null;
    }
    /**
     * Set Last Modified Cutoff in local storage
     */
    async setLastModifiedCutoff(value) {
      if (value === 0) {
        console.warn("Storage: Setting lastModifiedCutoff to 0 - ensure this is via unsafe setter");
      }
      await chrome.storage.local.set({ lastModifiedCutoff: value });
    }
    /**
     * Remove Last Modified Cutoff from local storage
     * Used during invalid cursor recovery
     */
    async removeLastModifiedCutoff() {
      await chrome.storage.local.remove("lastModifiedCutoff");
    }
    /**
     * Check whether a push version has already completed side effects.
     */
    async wasPushProcessed(iden, modified) {
      if (!iden || !Number.isFinite(modified)) {
        return false;
      }
      const result = await chrome.storage.local.get([PROCESSED_PUSHES_KEY]);
      const markers = getProcessedPushMarkers(result[PROCESSED_PUSHES_KEY]);
      return (markers[iden] ?? 0) >= modified;
    }
    /**
     * Mark a push version as completed after notification and auto-open work.
     */
    async markPushProcessed(iden, modified) {
      if (!iden || !Number.isFinite(modified)) {
        return;
      }
      const result = await chrome.storage.local.get([PROCESSED_PUSHES_KEY]);
      const markers = getProcessedPushMarkers(result[PROCESSED_PUSHES_KEY]);
      markers[iden] = Math.max(markers[iden] ?? 0, modified);
      await chrome.storage.local.set({
        [PROCESSED_PUSHES_KEY]: pruneProcessedPushMarkers(markers)
      });
    }
    /**
     * Get Last Auto Open Cutoff from local storage
     */
    async getLastAutoOpenCutoff() {
      const result = await chrome.storage.local.get(["lastAutoOpenCutoff"]);
      const v = result.lastAutoOpenCutoff;
      return typeof v === "number" ? v : null;
    }
    /**
     * Set Last Auto Open Cutoff in local storage
     */
    async setLastAutoOpenCutoff(value) {
      await chrome.storage.local.set({ lastAutoOpenCutoff: value });
    }
    /**
     * Get Auto Open Links on Reconnect setting from local storage
     */
    async getAutoOpenLinksOnReconnect() {
      const result = await chrome.storage.local.get(["autoOpenLinksOnReconnect"]);
      const v = result.autoOpenLinksOnReconnect;
      return typeof v === "boolean" ? v : false;
    }
    /**
     * Set Auto Open Links on Reconnect setting in local storage
     */
    async setAutoOpenLinksOnReconnect(value) {
      await chrome.storage.local.set({ autoOpenLinksOnReconnect: value });
    }
    /**
     * Get Max Auto Open Per Reconnect from local storage
     */
    async getMaxAutoOpenPerReconnect() {
      const result = await chrome.storage.local.get(["maxAutoOpenPerReconnect"]);
      const v = result.maxAutoOpenPerReconnect;
      return typeof v === "number" && v > 0 ? v : 5;
    }
    /**
     * Set Max Auto Open Per Reconnect in local storage
     */
    async setMaxAutoOpenPerReconnect(value) {
      await chrome.storage.local.set({ maxAutoOpenPerReconnect: value });
    }
    /**
     * Get Dismiss After Auto Open setting from local storage
     */
    async getDismissAfterAutoOpen() {
      const result = await chrome.storage.local.get(["dismissAfterAutoOpen"]);
      return Boolean(result.dismissAfterAutoOpen);
    }
    /**
     * Set Dismiss After Auto Open setting in local storage
     */
    async setDismissAfterAutoOpen(value) {
      await chrome.storage.local.set({ dismissAfterAutoOpen: value });
    }
    /**
     * Get User Info Cache from local storage
     */
    async getUserInfoCache() {
      const result = await chrome.storage.local.get(["userInfoCache"]);
      return result.userInfoCache || null;
    }
    /**
     * Set User Info Cache in local storage
     */
    async setUserInfoCache(value) {
      await chrome.storage.local.set({ userInfoCache: value });
    }
    /**
     * Clear all storage (both sync and local)
     */
    async clear() {
      await Promise.all([
        chrome.storage.sync.clear(),
        chrome.storage.local.clear(),
        this.getSessionStorage()?.clear() ?? Promise.resolve()
      ]);
    }
    /**
     * Remove specific keys from storage
     * Removes from both sync and local storage
     */
    async remove(keys) {
      await Promise.all([
        chrome.storage.sync.remove(keys),
        chrome.storage.local.remove(keys),
        this.getSessionStorage()?.remove(keys) ?? Promise.resolve()
      ]);
    }
    /**
     * Get Auto Open Debug Snapshot for diagnostics
     */
    async getAutoOpenDebugSnapshot() {
      const { lastAutoOpenCutoff = 0 } = await chrome.storage.local.get("lastAutoOpenCutoff");
      const { lastModifiedCutoff = 0 } = await chrome.storage.local.get("lastModifiedCutoff");
      const raw = await chrome.storage.local.get("openedPushMRU");
      const mru = raw.openedPushMRU;
      return {
        lastAutoOpenCutoff: typeof lastAutoOpenCutoff === "number" ? lastAutoOpenCutoff : 0,
        lastModifiedCutoff: typeof lastModifiedCutoff === "number" ? lastModifiedCutoff : 0,
        mruCount: Array.isArray(mru?.idens) ? mru.idens.length : 0,
        maxOpenedCreated: typeof mru?.maxOpenedCreated === "number" ? mru.maxOpenedCreated : 0
      };
    }
  };
  var storageRepository = new ChromeStorageRepository();

  // src/app/api/http.ts
  async function fetchWithTimeout(input, init = {}, timeoutMs = 5e3) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(id);
    }
  }
  async function retry(fn, retries = 1, backoffMs = 300) {
    let lastErr;
    for (let i = 0; i <= retries; i++) {
      try {
        return await fn();
      } catch (e) {
        lastErr = e;
        if (i < retries) await new Promise((r) => setTimeout(r, backoffMs * (i + 1)));
      }
    }
    throw lastErr;
  }
  function isInvalidCursorError(response, errorData) {
    if (response.status === 400 || response.status === 410) {
      const errorMessage = errorData?.error?.message || errorData?.message || "";
      const lowerMessage = errorMessage.toLowerCase();
      return lowerMessage.includes("cursor") || lowerMessage.includes("invalid") || lowerMessage.includes("expired");
    }
    return false;
  }

  // src/app/push-summary.ts
  function hasStringValue(value) {
    return typeof value === "string" && value.length > 0;
  }
  function summarizePushForLog(push) {
    if (!push || typeof push !== "object") {
      return void 0;
    }
    const pushRecord = push;
    const notifications = Array.isArray(pushRecord.notifications) ? pushRecord.notifications : [];
    return {
      iden: pushRecord.iden,
      type: pushRecord.type,
      encrypted: !!pushRecord.encrypted,
      contentFlags: {
        heading: hasStringValue(pushRecord.title),
        message: hasStringValue(pushRecord.body),
        link: hasStringValue(pushRecord.url),
        fileLink: hasStringValue(pushRecord.file_url),
        imageLink: hasStringValue(pushRecord.image_url),
        ciphertext: hasStringValue(pushRecord.ciphertext)
      },
      notificationsCount: notifications.length,
      created: pushRecord.created,
      modified: pushRecord.modified
    };
  }

  // src/app/push-types.ts
  var SUPPORTED_PUSH_TYPES = [
    "note",
    "link",
    "mirror",
    "sms_changed",
    "file"
  ];
  var KNOWN_UNSUPPORTED_TYPES = [
    "dismissal",
    "clip",
    "ephemeral",
    "channel"
  ];
  function checkPushTypeSupport(pushType) {
    if (SUPPORTED_PUSH_TYPES.includes(pushType)) {
      return { supported: true, category: "supported" };
    }
    if (KNOWN_UNSUPPORTED_TYPES.includes(pushType)) {
      return { supported: false, category: "known-unsupported" };
    }
    return { supported: false, category: "unknown" };
  }
  function logUnsupportedPushType(pushType, pushIden, source, fullPush) {
    const typeCheck = checkPushTypeSupport(pushType);
    if (typeCheck.category === "known-unsupported") {
      debugLogger.general("WARN", "Encountered known unsupported push type", {
        pushType,
        pushIden,
        source,
        category: typeCheck.category,
        reason: "This push type is not supported by the extension",
        supportedTypes: SUPPORTED_PUSH_TYPES
      });
    } else if (typeCheck.category === "unknown") {
      debugLogger.general("WARN", "Encountered unknown push type", {
        pushType,
        pushIden,
        source,
        category: typeCheck.category,
        reason: "This is a new or unrecognized push type",
        supportedTypes: SUPPORTED_PUSH_TYPES,
        pushSummary: summarizePushForLog(fullPush)
      });
    }
  }

  // src/app/api/client.ts
  var API_BASE_URL = "https://api.pushbullet.com/v2";
  var PUSHES_URL = `${API_BASE_URL}/pushes`;
  var DEVICES_URL = `${API_BASE_URL}/devices`;
  var USER_INFO_URL = `${API_BASE_URL}/users/me`;
  var UPLOAD_REQUEST_URL = `${API_BASE_URL}/upload-request`;
  var MAX_INCREMENTAL_PUSH_PAGES = 11;
  function hasDisplayablePushContent(push) {
    if (push.type === "sms_changed") {
      return !!push.notifications?.some(
        (notification) => !!notification.title || !!notification.body || !!notification.image_url
      );
    }
    return !!("title" in push && push.title || "body" in push && push.body || "url" in push && push.url || "file_name" in push && push.file_name || "file_url" in push && push.file_url);
  }
  var PushbulletApiError = class extends Error {
    code;
    status;
    constructor(code, message, status) {
      super(message);
      this.name = "PushbulletApiError";
      this.code = code;
      this.status = status;
    }
  };
  var PushbulletUploadError = class extends Error {
    code;
    stage;
    status;
    constructor(code, stage, message, status) {
      super(message);
      this.name = "PushbulletUploadError";
      this.code = code;
      this.stage = stage;
      this.status = status;
    }
  };
  var registrationPromise = null;
  function authHeaders(apiKey2) {
    return { "Access-Token": apiKey2 };
  }
  function parseApiErrorMessage(errorText, fallback) {
    try {
      const errorData = JSON.parse(errorText);
      return errorData.error?.message || errorData.message || fallback;
    } catch {
      return fallback;
    }
  }
  async function getApiErrorMessage(response, fallback) {
    const errorText = await response.text().catch(() => "");
    if (!errorText) {
      return fallback;
    }
    return parseApiErrorMessage(errorText, fallback);
  }
  async function fetchUserInfoWithTimeout(apiKey2) {
    const response = await fetchWithTimeout(USER_INFO_URL, { headers: authHeaders(apiKey2) }, 5e3);
    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new Error(`Failed to fetch user info: ${response.status} ${response.statusText} - ${errorText}`);
    }
    return response.json();
  }
  async function getUserInfoWithTimeoutRetry(apiKey2) {
    return retry(() => fetchUserInfoWithTimeout(apiKey2), 1, 500);
  }
  async function fetchUserInfo(apiKey2) {
    const startTime = Date.now();
    debugLogger.api("INFO", "Fetching user info", { url: USER_INFO_URL, hasApiKey: !!apiKey2, timestamp: (/* @__PURE__ */ new Date()).toISOString() });
    try {
      const response = await fetch(USER_INFO_URL, { headers: authHeaders(apiKey2) });
      const duration = Date.now() - startTime;
      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        const error = new Error(`Failed to fetch user info: ${response.status} ${response.statusText} - ${errorText}`);
        debugLogger.api("ERROR", "User info fetch failed", {
          url: USER_INFO_URL,
          status: response.status,
          statusText: response.statusText,
          duration: `${duration}ms`,
          errorText
        }, error);
        throw error;
      }
      const data = await response.json();
      debugLogger.api("INFO", "User info fetched successfully", {
        url: USER_INFO_URL,
        status: response.status,
        duration: `${duration}ms`,
        userEmail: data.email ? data.email.substring(0, 3) + "***" : "unknown",
        userName: data.name || "unknown"
      });
      return data;
    } catch (error) {
      const duration = Date.now() - startTime;
      debugLogger.api("ERROR", "User info fetch error", {
        url: USER_INFO_URL,
        duration: `${duration}ms`,
        error: error.message
      }, error);
      throw error;
    }
  }
  async function fetchDevices(apiKey2) {
    const startTime = Date.now();
    debugLogger.api("INFO", "Fetching devices", { url: DEVICES_URL, hasApiKey: !!apiKey2, timestamp: (/* @__PURE__ */ new Date()).toISOString() });
    try {
      const response = await fetch(`${DEVICES_URL}?active=true`, { headers: authHeaders(apiKey2) });
      const duration = Date.now() - startTime;
      if (!response.ok) {
        const error = new Error(`Failed to fetch devices: ${response.status} ${response.statusText}`);
        debugLogger.api("ERROR", "Devices fetch failed", {
          url: DEVICES_URL,
          status: response.status,
          statusText: response.statusText,
          duration: `${duration}ms`
        }, error);
        throw error;
      }
      const data = await response.json();
      const allDevices = data.devices;
      allDevices.forEach((device, index) => {
        const displayName = device.nickname || `${device.manufacturer || ""} ${device.model || device.type || ""}`.trim() || "Unknown Device";
        debugLogger.general("INFO", `[DEVICE_NAME] #${index + 1}/${allDevices.length}: "${displayName}"`, {
          iden: device.iden,
          nickname: device.nickname || "(none)",
          model: device.model || "(none)",
          manufacturer: device.manufacturer || "(none)",
          type: device.type || "(none)",
          active: device.active
        });
      });
      const validDevices = allDevices.filter(
        (device) => device.nickname || device.model || device.manufacturer || device.type
      );
      debugLogger.api("INFO", "Devices fetched successfully", {
        url: DEVICES_URL,
        status: response.status,
        duration: `${duration}ms`,
        totalDevices: data.devices.length,
        validDevices: validDevices.length,
        ghostDevices: data.devices.length - validDevices.length,
        activeDevices: validDevices.filter((d) => d.active).length,
        inactiveDevices: validDevices.filter((d) => !d.active).length
      });
      return validDevices;
    } catch (error) {
      const duration = Date.now() - startTime;
      debugLogger.api("ERROR", "Devices fetch error", {
        url: DEVICES_URL,
        duration: `${duration}ms`,
        error: error.message
      }, error);
      throw error;
    }
  }
  async function fetchRecentPushes(apiKey2, limit = 20) {
    const startTime = Date.now();
    const url = `${PUSHES_URL}?limit=${limit}`;
    debugLogger.api("INFO", "Fetching recent pushes", { url, hasApiKey: !!apiKey2, timestamp: (/* @__PURE__ */ new Date()).toISOString() });
    try {
      const response = await fetch(url, { headers: authHeaders(apiKey2) });
      const duration = Date.now() - startTime;
      if (!response.ok) {
        const error = new Error(`Failed to fetch pushes: ${response.status} ${response.statusText}`);
        debugLogger.api("ERROR", "Pushes fetch failed", {
          url,
          status: response.status,
          statusText: response.statusText,
          duration: `${duration}ms`
        }, error);
        throw error;
      }
      const data = await response.json();
      const filteredPushes = data.pushes.filter((push) => {
        if (push.dismissed) {
          return false;
        }
        const typeCheck = checkPushTypeSupport(push.type);
        if (!typeCheck.supported) {
          logUnsupportedPushType(push.type, push.iden || "unknown", "fetchRecentPushes");
          return false;
        }
        return hasDisplayablePushContent(push);
      });
      debugLogger.api("INFO", "Pushes fetched successfully", {
        url,
        status: response.status,
        duration: `${duration}ms`,
        totalPushes: data.pushes.length,
        filteredPushes: filteredPushes.length,
        pushTypes: filteredPushes.map((p) => p.type).join(", ")
      });
      return filteredPushes;
    } catch (error) {
      const duration = Date.now() - startTime;
      debugLogger.api("ERROR", "Pushes fetch error", {
        url,
        duration: `${duration}ms`,
        error: error.message
      }, error);
      throw error;
    }
  }
  async function fetchIncrementalPushes(apiKey2, modifiedAfter, pageLimit = 100) {
    const all = [];
    let cursor = void 0;
    let page = 0;
    do {
      const params = new URLSearchParams();
      params.set("active", "true");
      params.set("limit", String(pageLimit));
      if (modifiedAfter && modifiedAfter > 0) {
        params.set("modified_after", String(modifiedAfter));
      }
      if (cursor) params.set("cursor", cursor);
      const url = `${PUSHES_URL}?${params.toString()}`;
      const startTime = Date.now();
      const response = await fetch(url, { headers: authHeaders(apiKey2) });
      const duration = Date.now() - startTime;
      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        let errorData = null;
        try {
          errorData = JSON.parse(errorText);
        } catch {
        }
        if (isInvalidCursorError(response, errorData)) {
          debugLogger.api("WARN", "Invalid cursor error detected", {
            status: response.status,
            errorText,
            modifiedAfter
          });
          const error2 = new Error("INVALID_CURSOR");
          error2.name = "InvalidCursorError";
          throw error2;
        }
        const error = new Error(
          `Failed to fetch pushes (${response.status} ${response.statusText}) - ${errorText}`
        );
        debugLogger.api("ERROR", "Incremental pushes fetch failed", {
          url,
          status: response.status,
          duration: `${duration}ms`,
          errorText
        });
        throw error;
      }
      const data = await response.json();
      const pagePushes = Array.isArray(data.pushes) ? data.pushes : [];
      all.push(...pagePushes);
      cursor = data.cursor;
      debugLogger.api("INFO", "Incremental pushes page fetched", {
        url,
        status: response.status,
        duration: `${duration}ms`,
        page,
        pageCount: pagePushes.length,
        totalSoFar: all.length,
        hasMore: !!cursor
      });
      page += 1;
      if (page >= MAX_INCREMENTAL_PUSH_PAGES) {
        if (cursor) {
          debugLogger.api("WARN", "Incremental push fetch truncated by page guard", {
            pagesFetched: page,
            maxPages: MAX_INCREMENTAL_PUSH_PAGES,
            pageLimit,
            total: all.length,
            modifiedAfter,
            hasRemainingCursor: true,
            remainingCursorLength: cursor.length,
            remainingCursorPreview: cursor.substring(0, 8)
          });
        }
        break;
      }
    } while (cursor);
    const filtered = all.filter((p) => {
      if (p.dismissed) {
        return false;
      }
      const typeCheck = checkPushTypeSupport(p.type);
      if (!typeCheck.supported) {
        logUnsupportedPushType(p.type, p.iden || "unknown", "fetchIncrementalPushes");
        return false;
      }
      return true;
    });
    return filtered;
  }
  async function fetchDisplayPushes(apiKey2, limit = 50) {
    debugLogger.api("INFO", "Fetching display pushes", {
      limit,
      hasApiKey: !!apiKey2,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
    try {
      const pushes = await fetchRecentPushes(apiKey2, limit);
      debugLogger.api("INFO", "Display pushes fetched successfully", {
        count: pushes.length,
        limit
      });
      return pushes;
    } catch (error) {
      debugLogger.api("ERROR", "Failed to fetch display pushes", {
        error: error.message
      });
      throw error;
    }
  }
  async function ensureDeviceExists(apiKey2, deviceIden2) {
    const response = await fetch(
      `https://api.pushbullet.com/v2/devices/${deviceIden2}`,
      { method: "GET", headers: { "Access-Token": apiKey2 } }
    );
    if (response.ok) {
      return true;
    }
    if (response.status === 404) {
      return false;
    }
    const message = await getApiErrorMessage(
      response,
      `Failed to check device existence: ${response.status} ${response.statusText}`
    );
    throw new PushbulletApiError("device_lookup_failed", message, response.status);
  }
  async function registerDevice(apiKey2, deviceIden2, deviceNickname2) {
    if (registrationPromise) {
      debugLogger.general("INFO", "Device registration already in progress, reusing promise", {
        source: "registerDevice",
        existingRegistration: true
      });
      return registrationPromise;
    }
    registrationPromise = (async () => {
      try {
        debugLogger.general("INFO", "Starting device registration process", {
          hasApiKey: !!apiKey2,
          currentDeviceIden: deviceIden2,
          deviceNickname: deviceNickname2,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        });
        const existingDeviceIden = await storageRepository.getDeviceIden();
        if (existingDeviceIden) {
          debugLogger.general("INFO", "Device already registered", { deviceIden: existingDeviceIden, deviceNickname: deviceNickname2 });
          try {
            const devices = await fetchDevices(apiKey2);
            debugLogger.general("INFO", "[DEVICE_DEBUG] All devices fetched from API", {
              totalDevices: devices.length,
              timestamp: (/* @__PURE__ */ new Date()).toISOString()
            });
            devices.forEach((device2, index) => {
              debugLogger.general("INFO", `[DEVICE_DEBUG] Device #${index + 1}`, {
                iden: device2.iden,
                nickname: device2.nickname || "(no nickname)",
                model: device2.model || "(no model)",
                manufacturer: device2.manufacturer || "(no manufacturer)",
                type: device2.type || "(no type)",
                active: device2.active,
                created: device2.created,
                modified: device2.modified,
                icon: device2.icon || "(no icon)",
                hasPushToken: !!device2.push_token,
                pushTokenLength: device2.push_token?.length || 0,
                appVersion: device2.app_version || "(no app version)",
                hasSms: device2.has_sms || false
              });
            });
            const currentDevice = devices.find((d) => d.iden === existingDeviceIden);
            if (!currentDevice) {
              debugLogger.general("WARN", "[DEVICE_DEBUG] Stored device ID not found in API response - device was deleted", {
                storedDeviceIden: existingDeviceIden,
                availableDeviceIdens: devices.map((d) => d.iden)
              });
              await storageRepository.setDeviceIden(null);
              debugLogger.general("INFO", "Cleared stale device ID, will register new device");
            } else {
              const currentNickname = currentDevice.nickname;
              if (currentNickname !== deviceNickname2) {
                debugLogger.general("INFO", "[DEVICE_DEBUG] Nickname mismatch, updating", {
                  currentNickname,
                  newNickname: deviceNickname2
                });
                await updateDeviceNickname(apiKey2, existingDeviceIden, deviceNickname2);
              } else {
                debugLogger.general("DEBUG", "Device nickname unchanged, skipping update");
              }
              return { deviceIden: existingDeviceIden, needsUpdate: false };
            }
          } catch (error) {
            debugLogger.general("WARN", "Failed to update existing device, will re-register", {
              error: error.message,
              deviceIden: existingDeviceIden
            });
            await storageRepository.setDeviceIden(null);
          }
        }
        debugLogger.general("INFO", "Registering new device with Pushbullet API", { deviceNickname: deviceNickname2, url: DEVICES_URL });
        const registrationData = {
          nickname: deviceNickname2,
          model: "Chrome",
          manufacturer: "Google",
          push_token: "",
          app_version: 8623,
          icon: "browser",
          has_sms: false,
          type: "chrome"
        };
        debugLogger.api("INFO", "Sending device registration request", {
          url: DEVICES_URL,
          method: "POST",
          deviceData: registrationData
        });
        const startTime = Date.now();
        const response = await fetch(DEVICES_URL, {
          method: "POST",
          headers: {
            ...authHeaders(apiKey2),
            "Content-Type": "application/json"
          },
          body: JSON.stringify(registrationData)
        });
        const duration = Date.now() - startTime;
        if (!response.ok) {
          const errorText = await response.text().catch(() => "Unknown error");
          const error = new Error(`Failed to register device: ${response.status} ${response.statusText} - ${errorText}`);
          debugLogger.api("ERROR", "Device registration failed", {
            url: DEVICES_URL,
            status: response.status,
            statusText: response.statusText,
            duration: `${duration}ms`,
            errorText
          }, error);
          throw error;
        }
        const device = await response.json();
        const newDeviceIden = device.iden;
        debugLogger.api("INFO", "Device registered successfully", {
          url: DEVICES_URL,
          status: response.status,
          duration: `${duration}ms`,
          deviceIden: newDeviceIden,
          deviceNickname: device.nickname
        });
        await storageRepository.setDeviceIden(newDeviceIden);
        debugLogger.general("INFO", "Device registration completed", {
          deviceIden: newDeviceIden,
          deviceNickname: device.nickname
        });
        return { deviceIden: newDeviceIden, needsUpdate: false };
      } catch (error) {
        debugLogger.general("ERROR", "Error in registerDevice function", {
          errorMessage: error.message,
          errorStack: error.stack
        });
        throw error;
      } finally {
        registrationPromise = null;
      }
    })();
    return registrationPromise;
  }
  async function updateDeviceNickname(apiKey2, deviceIden2, newNickname) {
    const deviceExists = await ensureDeviceExists(apiKey2, deviceIden2);
    if (!deviceExists) {
      throw new Error(`Device with iden ${deviceIden2} not found on server.`);
    }
    debugLogger.general("INFO", "Updating device nickname", {
      deviceIden: deviceIden2,
      newNickname,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
    try {
      const url = `${DEVICES_URL}/${deviceIden2}`;
      const startTime = Date.now();
      const response = await fetch(url, {
        method: "POST",
        headers: {
          ...authHeaders(apiKey2),
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ nickname: newNickname })
      });
      const duration = Date.now() - startTime;
      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        const error = new Error(`Failed to update device nickname: ${response.status} ${response.statusText} - ${errorText}`);
        debugLogger.api("ERROR", "Device nickname update failed", {
          url,
          status: response.status,
          statusText: response.statusText,
          duration: `${duration}ms`,
          errorText
        }, error);
        throw error;
      }
      const device = await response.json();
      debugLogger.api("INFO", "Device nickname updated successfully", {
        url,
        status: response.status,
        duration: `${duration}ms`,
        deviceIden: deviceIden2,
        newNickname: device.nickname
      });
    } catch (error) {
      debugLogger.general("ERROR", "Error in updateDeviceNickname function", {
        errorMessage: error.message,
        errorStack: error.stack
      });
      throw error;
    }
  }
  async function fetchChats(apiKey2) {
    try {
      debugLogger.api("INFO", "Fetching chats from Pushbullet API");
      const response = await fetch("https://api.pushbullet.com/v2/chats", {
        method: "GET",
        headers: {
          "Access-Token": apiKey2,
          "Content-Type": "application/json"
        }
      });
      if (!response.ok) {
        throw new Error(
          `Failed to fetch chats: ${response.status} ${response.statusText}`
        );
      }
      const data = await response.json();
      const chats = data.chats || [];
      const activeChats = chats.filter((chat) => chat.active);
      debugLogger.api("INFO", "Chats fetched successfully", {
        totalChats: chats.length,
        activeChats: activeChats.length
      });
      return activeChats;
    } catch (error) {
      debugLogger.api("ERROR", "Error fetching chats", {
        error: error.message
      });
      throw error;
    }
  }
  async function requestFileUpload(apiKey2, fileName, fileType) {
    const response = await fetch(UPLOAD_REQUEST_URL, {
      method: "POST",
      headers: {
        ...authHeaders(apiKey2),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        file_name: fileName,
        file_type: fileType
      })
    });
    if (!response.ok) {
      const message = await getApiErrorMessage(
        response,
        "Failed to request file upload authorization"
      );
      throw new PushbulletUploadError(
        "upload_request_failed",
        "upload-request",
        message,
        response.status
      );
    }
    return response.json();
  }
  async function uploadFileToServer(uploadData, file) {
    const formData = new FormData();
    Object.entries(uploadData.data).forEach(([key, value]) => {
      formData.append(key, value);
    });
    formData.append("file", file, uploadData.file_name);
    const response = await fetch(uploadData.upload_url, {
      method: "POST",
      body: formData
    });
    if (!response.ok) {
      throw new PushbulletUploadError(
        "file_upload_failed",
        "file-upload",
        "Failed to upload file to server",
        response.status
      );
    }
  }
  async function sendFilePush(apiKey2, filePush) {
    const response = await fetch(PUSHES_URL, {
      method: "POST",
      headers: {
        ...authHeaders(apiKey2),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        type: "file",
        ...filePush
      })
    });
    if (!response.ok) {
      const message = await getApiErrorMessage(response, "Failed to send file push");
      throw new PushbulletUploadError(
        "file_push_failed",
        "file-push",
        message,
        response.status
      );
    }
  }
  async function createPush(apiKey2, push) {
    const response = await fetch(PUSHES_URL, {
      method: "POST",
      headers: {
        ...authHeaders(apiKey2),
        "Content-Type": "application/json"
      },
      body: JSON.stringify(push)
    });
    if (!response.ok) {
      const message = await getApiErrorMessage(response, "Failed to send push");
      throw new PushbulletApiError("push_send_failed", message, response.status);
    }
    return response.json();
  }
  async function sendPush(apiKey2, push) {
    return createPush(apiKey2, push);
  }
  async function dismissPush(iden, apiKey2) {
    const url = `https://api.pushbullet.com/v2/pushes/${encodeURIComponent(iden)}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        ...authHeaders(apiKey2),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ dismissed: true })
    });
    if (!response.ok) throw new Error(`Dismiss failed: ${response.status}`);
  }

  // src/infrastructure/storage/indexed-db.ts
  var DB_NAME = "PushbulletState";
  var DB_VERSION = 1;
  var STORE_NAME = "session";
  var CACHE_KEY = "main";
  var dbPromise = null;
  function openDb() {
    if (dbPromise) {
      return dbPromise;
    }
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => {
        debugLogger.storage("ERROR", "IndexedDB error", { error: request.error });
        reject(request.error);
      };
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
          debugLogger.storage("INFO", "IndexedDB object store created");
        }
      };
    });
    return dbPromise;
  }
  async function saveSessionCache(session) {
    try {
      const db = await openDb();
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const timestampedSession = { ...session, cachedAt: Date.now() };
      store.put(timestampedSession, CACHE_KEY);
      await new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
      debugLogger.storage("DEBUG", "Session cache saved to IndexedDB");
    } catch (error) {
      debugLogger.storage(
        "ERROR",
        "Failed to save session to IndexedDB",
        null,
        error
      );
      throw error;
    }
  }
  async function loadSessionCache() {
    try {
      const db = await openDb();
      const transaction = db.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(CACHE_KEY);
      return new Promise((resolve) => {
        request.onsuccess = () => {
          debugLogger.storage("DEBUG", "Session cache loaded from IndexedDB", {
            found: !!request.result
          });
          resolve(request.result || null);
        };
        request.onerror = () => {
          debugLogger.storage("ERROR", "Failed to load session from IndexedDB", {
            error: request.error
          });
          resolve(null);
        };
      });
    } catch (error) {
      debugLogger.storage(
        "ERROR",
        "Failed to open IndexedDB for loading",
        null,
        error
      );
      return null;
    }
  }
  async function clearSessionCache() {
    try {
      const db = await openDb();
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      store.clear();
      await new Promise((resolve) => transaction.oncomplete = resolve);
      debugLogger.storage("INFO", "IndexedDB session cache cleared");
    } catch (error) {
      debugLogger.storage(
        "ERROR",
        "Failed to clear IndexedDB session",
        null,
        error
      );
    }
  }

  // src/background/keepalive.ts
  var KEEPALIVE_ALARM = "criticalKeepalive";
  var KEEPALIVE_INTERVAL_SECONDS = 20;
  var activeCount = 0;
  function startCriticalKeepalive() {
    activeCount++;
    if (activeCount === 1) {
      chrome.alarms.create(KEEPALIVE_ALARM, {
        delayInMinutes: KEEPALIVE_INTERVAL_SECONDS / 60,
        periodInMinutes: KEEPALIVE_INTERVAL_SECONDS / 60
      });
      debugLogger.general("INFO", "Critical keepalive started", {
        interval: `${KEEPALIVE_INTERVAL_SECONDS}s`,
        activeCount
      });
    } else {
      debugLogger.general("DEBUG", "Critical keepalive already active", { activeCount });
    }
  }
  function stopCriticalKeepalive() {
    if (activeCount > 0) {
      activeCount--;
    }
    if (activeCount === 0) {
      chrome.alarms.clear(KEEPALIVE_ALARM, (wasCleared) => {
        debugLogger.general("INFO", "Critical keepalive stopped", { wasCleared });
      });
    } else {
      debugLogger.general("DEBUG", "Critical keepalive still needed", { activeCount });
    }
  }
  function handleKeepaliveAlarm(alarm) {
    if (alarm.name === KEEPALIVE_ALARM) {
      debugLogger.general("DEBUG", "Critical keepalive heartbeat", {
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        activeCount
      });
      return true;
    }
    return false;
  }

  // src/app/session/pipeline.ts
  async function computeMaxModified(pushes) {
    let maxModified = 0;
    for (const p of pushes) {
      const m = typeof p.modified === "number" ? p.modified : 0;
      if (m > maxModified) maxModified = m;
    }
    return maxModified;
  }
  async function refreshPushesIncremental(apiKey2) {
    const storedCutoff = await storageRepository.getLastModifiedCutoff();
    const isSeedRun = !storedCutoff || storedCutoff === 0;
    if (isSeedRun) {
      debugLogger.general("INFO", "Pipeline 1 First run cutoff missing/0. Seeding cutoff only; skipping side effects.");
      const pushes2 = await fetchIncrementalPushes(apiKey2, null, 100);
      const newCutoff = await computeMaxModified(pushes2);
      if (newCutoff > 0) {
        await setLastModifiedCutoffSafe(newCutoff);
        debugLogger.general(
          "INFO",
          "Pipeline 1 Seed complete. Updated lastModifiedCutoff via safe setter.",
          { newCutoff }
        );
      } else {
        debugLogger.general("WARN", "Pipeline 1 Seed returned no items; leaving cutoff unchanged.");
      }
      return { pushes: [], isSeedRun: true };
    }
    const pushes = await fetchIncrementalPushes(apiKey2, storedCutoff, 100);
    const maxModified = await computeMaxModified(pushes);
    if (maxModified > storedCutoff) {
      debugLogger.general("DEBUG", "Pipeline 1 fetched pushes awaiting processing", {
        old: storedCutoff,
        candidate: maxModified
      });
    }
    return { pushes, isSeedRun: false };
  }

  // src/app/session/index.ts
  var sessionCache = {
    userInfo: null,
    devices: [],
    recentPushes: [],
    chats: [],
    isAuthenticated: false,
    lastUpdated: 0,
    autoOpenLinks: true,
    deviceNickname: "Chrome",
    onlyThisDevice: false,
    lastModifiedCutoff: 0,
    cachedAt: 0
  };
  var CACHE_TTL_MS = 5 * 60 * 1e3;
  function isCacheFresh(cachedSession) {
    if (!cachedSession) {
      return false;
    }
    if (!cachedSession.isAuthenticated) {
      return false;
    }
    if (!cachedSession.cachedAt) {
      return false;
    }
    const cacheAge = Date.now() - cachedSession.cachedAt;
    const isFresh = cacheAge < CACHE_TTL_MS;
    debugLogger.general("DEBUG", "Cache freshness check", {
      cacheAge: `${Math.round(cacheAge / 1e3)}s`,
      ttl: `${CACHE_TTL_MS / 1e3}s`,
      isFresh
    });
    return isFresh;
  }
  function resetSessionCache() {
    sessionCache.userInfo = null;
    sessionCache.devices = [];
    sessionCache.recentPushes = [];
    sessionCache.chats = [];
    sessionCache.isAuthenticated = false;
    sessionCache.lastUpdated = 0;
    sessionCache.autoOpenLinks = true;
    sessionCache.deviceNickname = "Chrome";
    sessionCache.lastModifiedCutoff = 0;
    sessionCache.cachedAt = 0;
  }
  async function persistSessionCache() {
    sessionCache.cachedAt = Date.now();
    await saveSessionCache(sessionCache);
  }
  async function getPopupRecentPushes(pushes) {
    const onlyThisDevice = await storageRepository.getOnlyThisDevice() || false;
    const deviceIden2 = await storageRepository.getDeviceIden();
    if (!onlyThisDevice || !deviceIden2) {
      return pushes;
    }
    return pushes.filter((push) => push.target_device_iden === deviceIden2);
  }
  async function refreshSessionInBackground(apiKey2) {
    debugLogger.general("INFO", "Starting background cache refresh");
    try {
      let didRefreshUser = true;
      let didRefreshDevices = true;
      let didRefreshPushes = true;
      let didRefreshChats = true;
      const [userInfo, devices, displayPushes, chats] = await Promise.all([
        fetchUserInfo(apiKey2).catch((e) => {
          didRefreshUser = false;
          debugLogger.api("WARN", "Background user fetch failed", { error: String(e) });
          return sessionCache.userInfo;
        }),
        fetchDevices(apiKey2).catch((e) => {
          didRefreshDevices = false;
          debugLogger.api("WARN", "Background devices fetch failed", { error: String(e) });
          return sessionCache.devices;
        }),
        fetchDisplayPushes(apiKey2, 50).catch((e) => {
          didRefreshPushes = false;
          debugLogger.api("WARN", "Background pushes fetch failed", { error: String(e) });
          return sessionCache.recentPushes;
        }),
        fetchChats(apiKey2).catch((e) => {
          didRefreshChats = false;
          debugLogger.api("WARN", "Background chats fetch failed", { error: String(e) });
          return sessionCache.chats;
        })
      ]);
      sessionCache.userInfo = userInfo;
      sessionCache.devices = devices;
      sessionCache.recentPushes = displayPushes;
      sessionCache.chats = chats;
      sessionCache.lastUpdated = Date.now();
      const popupPushes = await getPopupRecentPushes(displayPushes);
      if (didRefreshUser && didRefreshDevices && didRefreshPushes && didRefreshChats) {
        try {
          await persistSessionCache();
        } catch (error) {
          debugLogger.general(
            "WARN",
            "Failed to persist session cache after background refresh",
            null,
            error
          );
        }
      } else {
        debugLogger.general("WARN", "Skipping session cache persistence after partial background refresh", {
          didRefreshUser,
          didRefreshDevices,
          didRefreshPushes,
          didRefreshChats
        });
      }
      debugLogger.general("INFO", "Background cache refresh completed", {
        deviceCount: devices.length,
        pushCount: displayPushes.length,
        chatCount: chats.length
      });
      chrome.runtime.sendMessage({
        action: "sessionDataUpdated" /* SESSION_DATA_UPDATED */,
        isAuthenticated: sessionCache.isAuthenticated,
        userInfo,
        devices,
        recentPushes: popupPushes,
        chats,
        autoOpenLinks: sessionCache.autoOpenLinks,
        deviceNickname: sessionCache.deviceNickname
      }).catch(() => {
        debugLogger.general("DEBUG", "Popup not available for background update notification");
      });
    } catch (error) {
      debugLogger.general(
        "ERROR",
        "Background cache refresh failed",
        null,
        error
      );
    }
  }
  async function handleInvalidCursorRecovery(apiKey2, connectWebSocketFn) {
    debugLogger.general("WARN", "Invalid cursor detected - starting recovery process");
    try {
      debugLogger.general("INFO", "Clearing invalid cursor from storage");
      await handleInvalidCursorRecoveryReset();
      debugLogger.general("INFO", "Resetting session cache");
      sessionCache.lastModifiedCutoff = 0;
      sessionCache.recentPushes = [];
      performanceMonitor.recordInvalidCursorRecovery();
      debugLogger.general("INFO", "Re-bootstrapping session after invalid cursor");
      await initializeSessionCache("invalid-cursor-recovery", connectWebSocketFn);
      debugLogger.general("INFO", "Invalid cursor recovery completed successfully");
    } catch (error) {
      debugLogger.general("ERROR", "Failed to recover from invalid cursor", null, error);
      throw error;
    }
  }
  async function hydrateCutoff() {
    const cutoff = await storageRepository.getLastModifiedCutoff();
    sessionCache.lastModifiedCutoff = typeof cutoff === "number" ? cutoff : 0;
    debugLogger.general("DEBUG", `Session: Hydrated lastModifiedCutoff=${sessionCache.lastModifiedCutoff}`);
  }
  async function setLastModifiedCutoffSafe(next) {
    const current = await storageRepository.getLastModifiedCutoff();
    if (!Number.isFinite(next) || next <= 0) {
      debugLogger.general("WARN", "CutoffSafe: refusing non-positive or invalid value", { next });
      return;
    }
    if (current && next <= current) {
      debugLogger.general("DEBUG", "CutoffSafe: unchanged or non-increasing", { current, next });
      return;
    }
    await storageRepository.setLastModifiedCutoff(next);
    sessionCache.lastModifiedCutoff = next;
    debugLogger.general("INFO", "Pipeline 1 Updated cutoff via safe setter", { old: current ?? null, new: next });
  }
  async function setLastModifiedCutoffUnsafeForRecovery(next) {
    await storageRepository.setLastModifiedCutoff(next);
    sessionCache.lastModifiedCutoff = next;
    debugLogger.general("INFO", "Cutoff set UNSAFE due to explicit recovery/logout", { new: next });
  }
  async function handleInvalidCursorRecoveryReset() {
    await setLastModifiedCutoffUnsafeForRecovery(0);
    debugLogger.general("INFO", "Cutoff: set to 0 due to invalid-cursor recovery.");
  }
  var initPromise = null;
  function getInitPromise() {
    return initPromise;
  }
  function setInitPromise(promise) {
    initPromise = promise;
    debugLogger.general("DEBUG", "Global init promise updated", {
      isSet: !!promise,
      previouslySet: initPromise !== promise && initPromise !== null
    });
  }
  function clearInitPromise() {
    const wasSet = initPromise !== null;
    initPromise = null;
    if (wasSet) {
      debugLogger.general("DEBUG", "Global init promise cleared", {
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
    }
  }
  async function initializeSessionCache(source = "unknown", connectWebSocketFn, stateSetters) {
    if (initPromise) {
      debugLogger.general(
        "INFO",
        "Initialization already in progress, returning existing promise",
        {
          source,
          existingInitialization: true
        }
      );
      return initPromise;
    }
    if (sessionCache.isAuthenticated) {
      const hasData = sessionCache.userInfo !== null && (sessionCache.devices?.length ?? 0) > 0;
      if (!hasData) {
        debugLogger.general(
          "WARN",
          "Authenticated flag set but session data missing \u2014 forcing re-initialization"
        );
        sessionCache.isAuthenticated = false;
      } else {
        debugLogger.general(
          "INFO",
          "Session already loaded with data, skipping network initialization."
        );
        if (connectWebSocketFn) connectWebSocketFn();
        return null;
      }
    }
    initPromise = (async () => {
      startCriticalKeepalive();
      try {
        debugLogger.general("INFO", "Initializing session cache", {
          source,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        });
        debugLogger.storage(
          "DEBUG",
          "Loading initial configuration from storage repository"
        );
        const apiKeyValue = await storageRepository.getApiKey();
        const deviceIdenValue = await storageRepository.getDeviceIden();
        if (stateSetters) {
          stateSetters.setApiKey(apiKeyValue);
          stateSetters.setDeviceIden(deviceIdenValue);
        }
        const autoOpenLinksValue = await storageRepository.getAutoOpenLinks();
        const notificationTimeoutValue = await storageRepository.getNotificationTimeout();
        const deviceNicknameValue = await storageRepository.getDeviceNickname() || "Chrome";
        if (stateSetters) {
          stateSetters.setAutoOpenLinks(autoOpenLinksValue);
          stateSetters.setNotificationTimeout(notificationTimeoutValue);
          stateSetters.setDeviceNickname(deviceNicknameValue);
        }
        sessionCache.autoOpenLinks = autoOpenLinksValue;
        sessionCache.deviceNickname = deviceNicknameValue;
        debugLogger.storage(
          "INFO",
          "Loaded configuration from storage repository",
          {
            hasApiKey: !!apiKeyValue,
            hasDeviceIden: !!deviceIdenValue,
            autoOpenLinks: autoOpenLinksValue,
            deviceNickname: deviceNicknameValue,
            notificationTimeout: notificationTimeoutValue
          }
        );
        debugLogger.general("DEBUG", "API key status", {
          hasApiKey: !!apiKeyValue,
          apiKeyLength: apiKeyValue ? apiKeyValue.length : 0
        });
        if (apiKeyValue) {
          debugLogger.general(
            "INFO",
            "API key available - initializing session data"
          );
          const userInfo = await fetchUserInfo(apiKeyValue);
          sessionCache.userInfo = userInfo;
          const devices = await fetchDevices(apiKeyValue);
          sessionCache.devices = devices;
          debugLogger.general("INFO", "Pipeline 1: Fetching incremental pushes for auto-open");
          const { isSeedRun } = await refreshPushesIncremental(apiKeyValue);
          if (isSeedRun) {
            debugLogger.general("INFO", "Seed run: cutoff initialized; skipping processing and auto-open.");
            const updatedCutoff2 = await storageRepository.getLastModifiedCutoff();
            sessionCache.lastModifiedCutoff = updatedCutoff2 ?? 0;
          }
          const updatedCutoff = await storageRepository.getLastModifiedCutoff();
          sessionCache.lastModifiedCutoff = updatedCutoff ?? 0;
          debugLogger.general("INFO", "Pipeline 2: Fetching display pushes for UI");
          const displayPushes = await fetchDisplayPushes(apiKeyValue, 50);
          debugLogger.general("INFO", "Pipeline 2: Display fetch complete", {
            count: displayPushes.length
          });
          sessionCache.recentPushes = displayPushes;
          try {
            const chats = await fetchChats(apiKeyValue);
            sessionCache.chats = chats;
            debugLogger.general("INFO", "Chats loaded successfully", {
              chatCount: chats.length
            });
          } catch (error) {
            debugLogger.general("WARN", "Failed to load chats, continuing anyway", {
              error: error.message
            });
            sessionCache.chats = [];
          }
          sessionCache.isAuthenticated = true;
          sessionCache.lastUpdated = Date.now();
          debugLogger.general("INFO", "Session cache populated successfully", {
            hasUserInfo: !!sessionCache.userInfo,
            deviceCount: sessionCache.devices.length,
            pushCount: sessionCache.recentPushes.length,
            lastUpdated: new Date(sessionCache.lastUpdated).toISOString()
          });
          await registerDevice(apiKeyValue, deviceIdenValue, deviceNicknameValue);
          if (connectWebSocketFn) {
            debugLogger.general("INFO", "Session initialized, connecting WebSocket.");
            connectWebSocketFn();
          }
          chrome.alarms.create("websocketHealthCheck", { periodInMinutes: 1 });
          debugLogger.general("DEBUG", "WebSocket health check alarm created", {
            interval: "1 minutes"
          });
        } else {
          debugLogger.general(
            "WARN",
            "No API key available - session cache not initialized"
          );
        }
        await persistSessionCache();
        debugLogger.general("INFO", "Initialization completed successfully", {
          source,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        });
        return apiKeyValue;
      } catch (error) {
        debugLogger.general(
          "ERROR",
          "Error initializing session cache",
          {
            error: error.message || error.name || "Unknown error"
          },
          error
        );
        sessionCache.isAuthenticated = false;
        throw error;
      } finally {
        stopCriticalKeepalive();
        initPromise = null;
      }
    })();
    return initPromise;
  }
  async function refreshSessionCache(apiKeyParam) {
    debugLogger.general("INFO", "Refreshing session cache", {
      hasApiKey: !!apiKeyParam,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
    try {
      if (apiKeyParam) {
        debugLogger.general(
          "DEBUG",
          "API key available - refreshing session data"
        );
        debugLogger.general("DEBUG", "Refreshing user info");
        const userInfo = await fetchUserInfo(apiKeyParam);
        sessionCache.userInfo = userInfo;
        debugLogger.general("DEBUG", "Refreshing devices");
        const devices = await fetchDevices(apiKeyParam);
        sessionCache.devices = devices;
        debugLogger.general("DEBUG", "Pipeline 1: Refreshing incremental pushes");
        const { pushes: incrementalPushes, isSeedRun } = await refreshPushesIncremental(apiKeyParam);
        if (isSeedRun) {
          debugLogger.general("INFO", "Seed run: cutoff initialized; skipping processing and auto-open.");
          const updatedCutoff2 = await storageRepository.getLastModifiedCutoff();
          sessionCache.lastModifiedCutoff = updatedCutoff2 ?? 0;
        }
        const updatedCutoff = await storageRepository.getLastModifiedCutoff();
        sessionCache.lastModifiedCutoff = updatedCutoff ?? 0;
        debugLogger.general("DEBUG", "Pipeline 2: Refreshing display pushes");
        const displayPushes = await fetchDisplayPushes(apiKeyParam, 50);
        sessionCache.recentPushes = displayPushes;
        debugLogger.general("INFO", "Session refresh complete", {
          incrementalCount: incrementalPushes.length,
          displayCount: displayPushes.length
        });
        let didRefreshChats = true;
        try {
          const chats = await fetchChats(apiKeyParam);
          sessionCache.chats = chats;
        } catch (error) {
          didRefreshChats = false;
          debugLogger.general("WARN", "Failed to refresh chats", {
            error: error.message
          });
        }
        sessionCache.isAuthenticated = true;
        sessionCache.lastUpdated = Date.now();
        if (didRefreshChats) {
          try {
            await persistSessionCache();
          } catch (error) {
            debugLogger.general(
              "WARN",
              "Failed to persist session cache after refresh",
              null,
              error
            );
          }
        } else {
          debugLogger.general("WARN", "Skipping session cache persistence after partial refresh", {
            didRefreshChats
          });
        }
        debugLogger.general("INFO", "Session cache refreshed successfully", {
          hasUserInfo: !!sessionCache.userInfo,
          deviceCount: sessionCache.devices.length,
          pushCount: sessionCache.recentPushes.length,
          lastUpdated: new Date(sessionCache.lastUpdated).toISOString()
        });
      } else {
        debugLogger.general(
          "WARN",
          "No API key available - cannot refresh session cache"
        );
        sessionCache.isAuthenticated = false;
      }
    } catch (error) {
      debugLogger.general(
        "ERROR",
        "Error refreshing session cache",
        {
          error: error.message
        },
        error
      );
      throw error;
    }
  }

  // src/infrastructure/storage/opened-mru.repository.ts
  var OPENED_MRU_KEY = "openedPushMRU";
  var MRU_CAP = 500;
  var openedMRUWriteQueue = Promise.resolve();
  async function loadMRU() {
    const raw = await chrome.storage.local.get(OPENED_MRU_KEY);
    const mru = raw[OPENED_MRU_KEY];
    return mru ?? { idens: [], maxOpenedCreated: 0 };
  }
  async function saveMRU(mru) {
    await chrome.storage.local.set({ [OPENED_MRU_KEY]: mru });
  }
  async function enqueueMRUWrite(operation) {
    const queued = openedMRUWriteQueue.then(operation, operation);
    openedMRUWriteQueue = queued.catch(() => void 0);
    return queued;
  }
  async function hasOpenedIden(iden) {
    const mru = await loadMRU();
    return mru.idens.includes(iden);
  }
  async function markOpened(iden, created) {
    await enqueueMRUWrite(async () => {
      const mru = await loadMRU();
      if (!mru.idens.includes(iden)) {
        mru.idens.unshift(iden);
        if (mru.idens.length > MRU_CAP) mru.idens.length = MRU_CAP;
      }
      if (Number.isFinite(created) && created > mru.maxOpenedCreated) {
        mru.maxOpenedCreated = created;
      }
      await saveMRU(mru);
      debugLogger.general("DEBUG", `MRU: marked opened iden=${iden}, maxOpenedCreated=${mru.maxOpenedCreated}`);
    });
  }
  async function getMaxOpenedCreated() {
    const mru = await loadMRU();
    return mru.maxOpenedCreated || 0;
  }
  async function clearOpenedMRU() {
    await chrome.storage.local.set({
      [OPENED_MRU_KEY]: { idens: [], maxOpenedCreated: 0 }
    });
  }

  // src/lib/security/message-validation.ts
  function isValidSender(sender) {
    if (!sender) {
      debugLogger.general("WARN", "Message received with no sender");
      return false;
    }
    if (sender.id !== chrome.runtime.id) {
      debugLogger.general("WARN", "Message received from external extension", {
        senderId: sender.id,
        expectedId: chrome.runtime.id
      });
      return false;
    }
    if (sender.url) {
      const extensionUrl = chrome.runtime.getURL("");
      if (!sender.url.startsWith(extensionUrl)) {
        debugLogger.general("WARN", "Message received from non-extension URL", {
          senderUrl: sender.url,
          expectedPrefix: extensionUrl
        });
        return false;
      }
    }
    return true;
  }
  var PRIVILEGED_ACTIONS = /* @__PURE__ */ new Set([
    "apiKeyChanged" /* API_KEY_CHANGED */,
    "logout" /* LOGOUT */,
    "settingsChanged" /* SETTINGS_CHANGED */,
    "updateDeviceNickname" /* UPDATE_DEVICE_NICKNAME */,
    "sendPush" /* SEND_PUSH */,
    "uploadAndSendFile" /* UPLOAD_AND_SEND_FILE */,
    "GET_PUSH_DATA" /* GET_PUSH_DATA */,
    "getNotificationData" /* GET_NOTIFICATION_DATA */,
    "attemptReconnect" /* ATTEMPT_RECONNECT */,
    "updateDebugConfig" /* UPDATE_DEBUG_CONFIG */,
    "clearAllLogs" /* CLEAR_ALL_LOGS */,
    "exportDebugData" /* EXPORT_DEBUG_DATA */,
    "getDebugSummary" /* GET_DEBUG_SUMMARY */
  ]);
  function isPrivilegedAction(action) {
    return PRIVILEGED_ACTIONS.has(action);
  }
  function validatePrivilegedMessage(action, sender) {
    if (!isPrivilegedAction(action)) {
      return true;
    }
    if (!isValidSender(sender)) {
      debugLogger.general("ERROR", "Rejected privileged action from invalid sender", {
        action,
        senderId: sender?.id,
        senderUrl: sender?.url
      });
      return false;
    }
    return true;
  }

  // src/background/diagnostics.ts
  function isDiagnosticsMessage(msg) {
    if (!msg || typeof msg !== "object") {
      return false;
    }
    const { type } = msg;
    return type === "diag:dump-autoopen" || type === "diag:clear-mru";
  }
  function areDiagnosticsEnabled() {
    return debugConfigManager.getConfig().enabled;
  }
  function installDiagnosticsMessageHandler() {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!isDiagnosticsMessage(msg)) {
        return false;
      }
      if (!isValidSender(sender)) {
        sendResponse({ ok: false, error: "unauthorized" });
        return false;
      }
      if (!areDiagnosticsEnabled()) {
        sendResponse({ ok: false, error: "diagnostics_disabled" });
        return false;
      }
      void (async () => {
        if (msg.type === "diag:dump-autoopen") {
          const snap = await storageRepository.getAutoOpenDebugSnapshot();
          debugLogger.general("INFO", "DIAG auto-open snapshot", snap);
          sendResponse({ ok: true, snap });
        } else if (msg.type === "diag:clear-mru") {
          await clearOpenedMRU();
          debugLogger.general("WARN", "DIAG MRU cleared by developer action");
          const snap = await storageRepository.getAutoOpenDebugSnapshot();
          debugLogger.general("INFO", "DIAG auto-open snapshot (post-clear)", snap);
          sendResponse({ ok: true, snap });
        }
      })().catch((error) => {
        debugLogger.general("ERROR", "DIAG command failed", { type: msg.type }, error);
        sendResponse({ ok: false, error: "diagnostics_failed" });
      });
      return true;
    });
  }

  // src/app/reconnect/index.ts
  async function ensureConfigLoaded(stateSetters, stateGetters) {
    try {
      if (!stateSetters || !stateGetters) {
        return;
      }
      const needsApiKey = !stateGetters.getApiKey();
      const needsDeviceIden = !stateGetters.getDeviceIden();
      const needsNickname = stateGetters.getDeviceNickname() === null || stateGetters.getDeviceNickname() === void 0;
      const needsAutoOpen = stateGetters.getAutoOpenLinks() === null || stateGetters.getAutoOpenLinks() === void 0;
      const needsTimeout = stateGetters.getNotificationTimeout() === null || stateGetters.getNotificationTimeout() === void 0;
      if (needsApiKey) {
        try {
          const apiKey2 = await storageRepository.getApiKey();
          if (apiKey2) {
            stateSetters.setApiKey(apiKey2);
          }
        } catch (error) {
          debugLogger.general("WARN", "Failed to load API key from storage", null, error);
        }
      }
      if (needsDeviceIden) {
        try {
          const deviceIden2 = await storageRepository.getDeviceIden();
          if (deviceIden2) {
            stateSetters.setDeviceIden(deviceIden2);
          }
        } catch (error) {
          debugLogger.general("WARN", "Failed to load device identifier from storage", null, error);
        }
      }
      if (needsNickname) {
        try {
          const deviceNickname2 = await storageRepository.getDeviceNickname();
          if (deviceNickname2 !== null && deviceNickname2 !== void 0) {
            stateSetters.setDeviceNickname(deviceNickname2);
          }
        } catch (error) {
          debugLogger.general("WARN", "Failed to load device nickname from storage", null, error);
        }
      }
      if (needsAutoOpen) {
        try {
          const autoOpenLinks2 = await storageRepository.getAutoOpenLinks();
          if (autoOpenLinks2 !== null && autoOpenLinks2 !== void 0) {
            stateSetters.setAutoOpenLinks(autoOpenLinks2);
          }
        } catch (error) {
          debugLogger.general("WARN", "Failed to load auto-open links setting from storage", null, error);
        }
      }
      if (needsTimeout) {
        try {
          const notificationTimeout2 = await storageRepository.getNotificationTimeout();
          if (notificationTimeout2 !== null && notificationTimeout2 !== void 0) {
            stateSetters.setNotificationTimeout(notificationTimeout2);
          }
        } catch (error) {
          debugLogger.general("WARN", "Failed to load notification timeout from storage", null, error);
        }
      }
      try {
        debugLogger.storage("DEBUG", "ensureConfigLoaded completed", {
          hasApiKey: !!stateGetters.getApiKey(),
          hasDeviceIden: !!stateGetters.getDeviceIden(),
          autoOpenLinks: stateGetters.getAutoOpenLinks(),
          notificationTimeout: stateGetters.getNotificationTimeout(),
          deviceNickname: stateGetters.getDeviceNickname()
        });
      } catch (error) {
        console.warn("Failed to log ensureConfigLoaded completion:", error);
      }
    } catch (e) {
      try {
        debugLogger.storage("WARN", "ensureConfigLoaded encountered an error", {
          error: e && e.message
        });
      } catch (error) {
        console.warn("Failed to log ensureConfigLoaded error:", error);
      }
    }
  }

  // src/background/state.ts
  var API_BASE_URL2 = "https://api.pushbullet.com/v2";
  var PUSHES_URL2 = `${API_BASE_URL2}/pushes`;
  var DEVICES_URL2 = `${API_BASE_URL2}/devices`;
  var USER_INFO_URL2 = `${API_BASE_URL2}/users/me`;
  var WEBSOCKET_URL = "wss://stream.pushbullet.com/websocket/";
  var apiKey = null;
  var deviceIden = null;
  var deviceNickname = "Chrome";
  var autoOpenLinks = true;
  var notificationTimeout = 1e4;
  var websocketClient = null;
  var pollingMode = false;
  function getApiKey() {
    return apiKey;
  }
  function setApiKey(key) {
    apiKey = key;
  }
  function getDeviceIden() {
    return deviceIden;
  }
  function setDeviceIden(iden) {
    deviceIden = iden;
  }
  function getDeviceNickname() {
    return deviceNickname;
  }
  function setDeviceNickname(nickname) {
    deviceNickname = nickname;
  }
  function getAutoOpenLinks() {
    return autoOpenLinks;
  }
  function setAutoOpenLinks(value) {
    autoOpenLinks = value;
  }
  function getNotificationTimeout() {
    return notificationTimeout;
  }
  function setNotificationTimeout(timeout) {
    notificationTimeout = timeout;
  }
  function setWebSocketClient(client) {
    websocketClient = client;
  }
  function isPollingMode() {
    return pollingMode;
  }
  function setPollingMode(mode) {
    pollingMode = mode;
  }

  // src/background/config.ts
  async function hydrateBackgroundConfig() {
    await ensureConfigLoaded(
      {
        setApiKey,
        setDeviceIden,
        setAutoOpenLinks,
        setDeviceNickname,
        setNotificationTimeout
      },
      {
        getApiKey,
        getDeviceIden,
        getAutoOpenLinks,
        getDeviceNickname,
        getNotificationTimeout
      }
    );
  }
  var loadDebugConfigOnce = null;
  function getDebugConfigLoadErrorMetadata(error) {
    if (error instanceof Error) {
      return {
        errorName: error.name,
        errorType: error.constructor.name
      };
    }
    return {
      errorName: typeof error,
      errorType: typeof error
    };
  }
  function ensureDebugConfigLoadedOnce() {
    if (!loadDebugConfigOnce) {
      loadDebugConfigOnce = (async () => {
        try {
          await debugConfigManager.loadConfig();
          debugLogger.general(
            "INFO",
            "Debug configuration loaded (single-flight)"
          );
        } catch (e) {
          debugLogger.general(
            "WARN",
            "Failed to load debug configuration (single-flight)",
            getDebugConfigLoadErrorMetadata(e)
          );
          loadDebugConfigOnce = null;
        }
      })();
    }
    return loadDebugConfigOnce;
  }

  // src/background/lifecycle.ts
  function createLifecycleCoordinator(deps) {
    async function reconcileWake2(reason) {
      await deps.hydrateConfig();
      await deps.stateMachineReady;
      const apiKey2 = deps.getApiKey();
      const socketHealthy = deps.isSocketHealthy();
      const stateMachine2 = deps.getStateMachine();
      debugLogger.general("DEBUG", "[Wake] Reconcile wake state", {
        reason,
        hasApiKey: !!apiKey2,
        socketHealthy,
        currentState: stateMachine2.getCurrentState()
      });
      if (apiKey2 && !socketHealthy) {
        await stateMachine2.transition("ATTEMPT_RECONNECT", {
          hasApiKey: true,
          socketHealthy: false,
          reason
        });
      }
    }
    async function bootstrap2(trigger) {
      debugLogger.general("INFO", "Bootstrap start", { trigger });
      await deps.hydrateConfig().catch((error) => {
        debugLogger.general(
          "ERROR",
          "Failed to load config before STARTUP",
          null,
          error
        );
      });
      debugLogger.general("DEBUG", "Configuration loaded before STARTUP event");
      const apiKey2 = deps.getApiKey();
      const deviceIden2 = deps.getDeviceIden();
      const autoOpenLinks2 = deps.getAutoOpenLinks();
      debugLogger.general(
        "INFO",
        "[BOOTSTRAP_DEBUG] Config state after ensureConfigLoaded",
        {
          hasApiKey: !!apiKey2,
          apiKeyLength: apiKey2?.length || 0,
          hasDeviceIden: !!deviceIden2,
          autoOpenLinks: autoOpenLinks2
        }
      );
      await deps.stateMachineReady;
      const stateMachine2 = deps.getStateMachine();
      debugLogger.general("INFO", "[BOOTSTRAP_DEBUG] Triggering STARTUP event", {
        hasApiKey: !!apiKey2,
        apiKeyLength: apiKey2?.length || 0,
        trigger
      });
      await stateMachine2.transition("STARTUP", { hasApiKey: !!apiKey2 });
      debugLogger.general(
        "INFO",
        "[BOOTSTRAP_DEBUG] STARTUP transition completed",
        {
          newState: stateMachine2.getCurrentState()
        }
      );
      if (apiKey2 && stateMachine2.getCurrentState() === "idle") {
        debugLogger.general(
          "WARN",
          "[Bootstrap] Detected orphaned session: have API key but state is IDLE. Triggering recovery."
        );
        try {
          await stateMachine2.transition("ATTEMPT_RECONNECT", {
            hasApiKey: true
          });
        } catch (error) {
          debugLogger.general(
            "ERROR",
            "[Bootstrap] Failed to recover orphaned session",
            null,
            error
          );
        }
      }
      debugLogger.general(
        "INFO",
        "Bootstrap completed",
        {
          finalState: stateMachine2.getCurrentState(),
          trigger
        }
      );
    }
    return {
      bootstrap: bootstrap2,
      reconcileWake: reconcileWake2
    };
  }

  // src/lib/crypto/index.ts
  var PushbulletCrypto = class {
    /**
     * Generate encryption/decryption key from password
     * @param password - User's encryption password
     * @param userIden - User's iden (used as salt)
     * @returns Derived key for AES-GCM
     */
    static async deriveKey(password, userIden) {
      if (!globalThis.crypto || !crypto.subtle) {
        throw new Error("Web Crypto API unavailable - requires HTTPS or localhost");
      }
      const encoder = new TextEncoder();
      const passwordBytes = encoder.encode(password);
      const keyMaterial = await crypto.subtle.importKey(
        "raw",
        passwordBytes,
        { name: "PBKDF2" },
        false,
        ["deriveBits", "deriveKey"]
      );
      const salt = encoder.encode(userIden);
      const key = await crypto.subtle.deriveKey(
        {
          name: "PBKDF2",
          salt,
          iterations: 3e4,
          hash: "SHA-256"
        },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        false,
        ["decrypt"]
      );
      return key;
    }
    /**
     * Decrypt an encrypted message
     * @param encodedMessage - Base64 encoded encrypted message
     * @param key - Decryption key
     * @returns Decrypted message object
     */
    static async decryptMessage(encodedMessage, key) {
      try {
        const encryptedData = this.base64ToBytes(encodedMessage);
        const version = encryptedData[0];
        if (version !== 49) {
          throw new Error(`Unsupported encryption version: ${version}`);
        }
        const tag = encryptedData.slice(1, 17);
        const iv = encryptedData.slice(17, 29);
        const ciphertext = encryptedData.slice(29);
        const combined = new Uint8Array(ciphertext.length + tag.length);
        combined.set(ciphertext);
        combined.set(tag, ciphertext.length);
        const decrypted = await crypto.subtle.decrypt(
          {
            name: "AES-GCM",
            iv,
            tagLength: 128
            // 16 bytes = 128 bits
          },
          key,
          combined
        );
        const decoder = new TextDecoder();
        const decryptedText = decoder.decode(decrypted);
        return JSON.parse(decryptedText);
      } catch {
        console.error("Decryption error - check encryption password");
        throw new Error("Failed to decrypt message. Check your encryption password.");
      }
    }
    /**
     * Convert base64 string to Uint8Array
     * @param base64 - Base64 encoded string
     * @returns Decoded bytes
     */
    static base64ToBytes(base64) {
      const binaryString = atob(base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return bytes;
    }
    /**
     * Decrypt a Pushbullet encrypted push
     * @param encryptedPush - Push object with 'encrypted' and 'ciphertext' fields
     * @param password - User's encryption password
     * @param userIden - User's iden
     * @returns Decrypted push data
     */
    static async decryptPush(encryptedPush, password, userIden) {
      if (!encryptedPush.encrypted || !encryptedPush.ciphertext) {
        throw new Error("Push is not encrypted");
      }
      const key = await this.deriveKey(password, userIden);
      const decryptedData = await this.decryptMessage(encryptedPush.ciphertext, key);
      return {
        ...encryptedPush,
        ...decryptedData,
        encrypted: false
        // Mark as decrypted
      };
    }
  };

  // src/lib/security/trusted-image-url.ts
  function isTrustedPushbulletHost(hostname) {
    return hostname === "pushbullet.com" || hostname.endsWith(".pushbullet.com") || hostname === "pushbulletusercontent.com" || hostname.endsWith(".pushbulletusercontent.com");
  }
  function isTrustedGoogleUserContentHost(hostname) {
    return /^lh[0-9]\.googleusercontent\.com$/.test(hostname);
  }
  function isTrustedImageUrl(urlString) {
    if (!urlString) {
      return false;
    }
    try {
      const url = new URL(urlString);
      if (url.protocol !== "https:") {
        return false;
      }
      return isTrustedPushbulletHost(url.hostname) || isTrustedGoogleUserContentHost(url.hostname);
    } catch {
      return false;
    }
  }

  // src/background/links.ts
  function isLinkPush2(p) {
    return p.type === "link" && typeof p.url === "string" && p.url.length > 0 && typeof p.iden === "string";
  }
  async function openTab(url) {
    if (!url || typeof url !== "string") {
      debugLogger.general("WARN", "Invalid URL (empty or non-string)", { url });
      throw new Error("Invalid URL");
    }
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      debugLogger.general("WARN", "Invalid URL (parse failed)", { url });
      throw new Error("Invalid URL");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      debugLogger.general("WARN", "Invalid URL (protocol rejected)", {
        url,
        protocol: parsed.protocol
      });
      throw new Error("Invalid protocol");
    }
    try {
      await chrome.tabs.create({ url, active: false });
      debugLogger.general("DEBUG", "Tab created successfully", { url });
    } catch {
      debugLogger.general("WARN", "Tab creation failed, trying window fallback", {
        url
      });
      await chrome.windows.create({ url, focused: false });
      debugLogger.general("INFO", "Window created as fallback", { url });
    }
  }
  async function autoOpenOfflineLinks(apiKey2, sessionCutoff) {
    const enabled = await storageRepository.getAutoOpenLinksOnReconnect();
    if (!enabled) {
      debugLogger.websocket("DEBUG", "Auto-open offline links disabled");
      return;
    }
    const safetyCap = await storageRepository.getMaxAutoOpenPerReconnect();
    const lastAuto = await storageRepository.getLastAutoOpenCutoff() || 0;
    const modifiedAfter = Math.max(lastAuto, sessionCutoff || 0);
    debugLogger.websocket(
      "INFO",
      "Auto-open links: fetching incremental changes",
      { modifiedAfter }
    );
    const changes = await fetchIncrementalPushes(apiKey2, modifiedAfter, 100);
    const maxOpenedCreated = await getMaxOpenedCreated();
    const candidates = changes.filter(isLinkPush2).filter((p) => {
      const created = typeof p.created === "number" ? p.created : 0;
      return created > lastAuto && created > maxOpenedCreated;
    }).sort((a, b) => (a.created ?? 0) - (b.created ?? 0));
    if (candidates.length === 0) {
      debugLogger.websocket("INFO", "Auto-open links: no new link pushes to open");
      return;
    }
    debugLogger.websocket("INFO", "Auto-opening link pushes", {
      count: candidates.length,
      total: candidates.length
    });
    const openedCreated = [];
    let openedThisRun = 0;
    const shouldDismiss = await storageRepository.getDismissAfterAutoOpen();
    for (const p of candidates) {
      if (openedThisRun >= safetyCap) {
        debugLogger.websocket("WARN", "Auto-open links capped", {
          opened: openedThisRun,
          total: candidates.length,
          cap: safetyCap
        });
        break;
      }
      if (await hasOpenedIden(p.iden)) {
        debugLogger.websocket("DEBUG", "Auto-open skip (MRU)", { iden: p.iden });
        continue;
      }
      try {
        await openTab(p.url);
        await markOpened(p.iden, p.created ?? 0);
        debugLogger.websocket("DEBUG", "MRU marked opened", {
          iden: p.iden,
          created: p.created ?? 0
        });
        if (shouldDismiss && p.iden) {
          try {
            const dismissApiKey = getApiKey();
            if (!dismissApiKey) {
              debugLogger.websocket(
                "WARN",
                `Offline AutoOpen: dismiss skipped for iden=${p.iden}; API key unavailable`
              );
            } else {
              await dismissPush(p.iden, dismissApiKey);
              debugLogger.websocket(
                "INFO",
                `Offline AutoOpen: dismissed iden=${p.iden} after auto-open`
              );
            }
          } catch (e) {
            debugLogger.websocket(
              "WARN",
              `Offline AutoOpen: dismiss failed for iden=${p.iden}: ${e.message}`
            );
          }
        }
        openedThisRun += 1;
        openedCreated.push(p.created ?? 0);
      } catch {
        debugLogger.websocket("WARN", "Auto-open failed", { iden: p.iden, url: p.url });
      }
    }
    const maxCreated = Math.max(lastAuto, ...openedCreated, 0);
    if (maxCreated > lastAuto) {
      await storageRepository.setLastAutoOpenCutoff(maxCreated);
      debugLogger.websocket("INFO", "Advanced lastAutoOpenCutoff", { old: lastAuto, new: maxCreated });
    }
  }

  // src/background/processing.ts
  async function maybeAutoOpenLink(push) {
    if (!push.iden || push.type !== "link" || !push.url) return false;
    const created = typeof push.created === "number" ? push.created : 0;
    const lastAuto = await storageRepository.getLastAutoOpenCutoff() ?? 0;
    const maxOpenedCreated = await getMaxOpenedCreated();
    if (await hasOpenedIden(push.iden)) {
      debugLogger.general("DEBUG", "Auto-open skip (MRU)", { iden: push.iden });
      return false;
    }
    if (!(created > lastAuto && created > maxOpenedCreated)) {
      debugLogger.general("DEBUG", "Auto-open skip (created guard)", {
        iden: push.iden,
        created,
        lastAuto,
        maxOpenedCreated
      });
      return false;
    }
    try {
      await openTab(push.url);
      await markOpened(push.iden, created);
      debugLogger.general("DEBUG", "MRU marked opened", {
        iden: push.iden,
        created
      });
      const nextCutoff = Math.max(lastAuto, created);
      await storageRepository.setLastAutoOpenCutoff(nextCutoff);
      debugLogger.general("INFO", "Advanced lastAutoOpenCutoff", {
        old: lastAuto,
        new: nextCutoff
      });
      return true;
    } catch (e) {
      debugLogger.general("WARN", `AutoOpen: failed to open iden=${push.iden}: ${e.message}`);
      return false;
    }
  }
  async function maybeAutoOpenLinkWithDismiss(push) {
    const opened = await maybeAutoOpenLink(push);
    if (!opened || !push.iden) return false;
    if (await storageRepository.getDismissAfterAutoOpen()) {
      try {
        const apiKey2 = getApiKey();
        if (apiKey2) {
          await dismissPush(push.iden, apiKey2);
          debugLogger.general("INFO", `AutoOpen: dismissed iden=${push.iden} after auto-open`);
        }
      } catch (e) {
        debugLogger.general("WARN", `AutoOpen: dismiss failed for iden=${push.iden}: ${e.message}`);
      }
    }
    return true;
  }

  // src/background/utils.ts
  var MAX_MIRROR_ICON_DECODED_BYTES = 256 * 1024;
  var MAX_MIRROR_ICON_ENCODED_LENGTH = Math.ceil(MAX_MIRROR_ICON_DECODED_BYTES / 3) * 4;
  function sanitizeText(text) {
    if (!text) return "";
    let sanitized = text.replace(/<[^>]*>/g, "");
    sanitized = sanitized.replace(/javascript:/gi, "");
    sanitized = sanitized.replace(/on\w+\s*=/gi, "");
    sanitized = sanitized.trim().substring(0, 1e3);
    return sanitized;
  }
  function sanitizeUrl(url) {
    if (!url) return "";
    try {
      const urlObj = new URL(url);
      if (urlObj.protocol !== "http:" && urlObj.protocol !== "https:") {
        return "";
      }
      return url;
    } catch {
      debugLogger.general("WARN", "Invalid URL provided", { url });
      return "";
    }
  }
  function isSmsChangedPush(push) {
    return push.type === "sms_changed";
  }
  function isMirrorPush(push) {
    return push.type === "mirror";
  }
  function isFilePush(push) {
    return push.type === "file";
  }
  function hasSmsNotification(push) {
    return Array.isArray(push.notifications) && push.notifications.length > 0;
  }
  function getBase64DecodedLength(base64) {
    const paddingLength = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
    return Math.floor(base64.length * 3 / 4) - paddingLength;
  }
  function getMirrorIconDataUrl(iconData, title) {
    if (!iconData) {
      return null;
    }
    const normalizedIconData = iconData.replace(/\s/g, "");
    if (!normalizedIconData.startsWith("/9j/")) {
      return null;
    }
    if (normalizedIconData.length > MAX_MIRROR_ICON_ENCODED_LENGTH) {
      debugLogger.notifications("WARN", "Ignoring oversized mirror notification icon", {
        iconDataLength: normalizedIconData.length,
        maxEncodedLength: MAX_MIRROR_ICON_ENCODED_LENGTH,
        title
      });
      return null;
    }
    const decodedLength = getBase64DecodedLength(normalizedIconData);
    if (decodedLength > MAX_MIRROR_ICON_DECODED_BYTES) {
      debugLogger.notifications("WARN", "Ignoring oversized mirror notification icon", {
        decodedLength,
        maxDecodedBytes: MAX_MIRROR_ICON_DECODED_BYTES,
        title
      });
      return null;
    }
    debugLogger.notifications("DEBUG", "Processing mirror notification icon", {
      iconDataLength: normalizedIconData.length,
      decodedLength,
      title
    });
    return `data:image/jpeg;base64,${normalizedIconData}`;
  }
  function updateExtensionTooltip(stateDescription) {
    try {
      chrome.action.setTitle({ title: stateDescription });
      debugLogger.general("DEBUG", "Updated extension tooltip", {
        stateDescription
      });
    } catch (error) {
      debugLogger.general("ERROR", "Exception setting tooltip", {
        stateDescription,
        error: error.message
      });
    }
  }
  function updateConnectionIcon(status) {
    try {
      const badgeText = " ";
      const badgeColor = status === "connected" ? "#4CAF50" : status === "connecting" ? "#FFC107" : status === "degraded" ? "#00BCD4" : "#F44336";
      chrome.action.setBadgeText({ text: badgeText });
      chrome.action.setBadgeBackgroundColor({ color: badgeColor });
      debugLogger.general("DEBUG", "Updated connection status badge", {
        status,
        badgeText,
        badgeColor
      });
    } catch (error) {
      debugLogger.general(
        "ERROR",
        "Exception setting badge",
        {
          status,
          error: error.message
        },
        error
      );
    }
  }
  function upsertPushes(existing, incoming) {
    const map = new Map(existing.map((p) => [p.iden, p]));
    const newOnes = [];
    for (const p of incoming) {
      if (map.has(p.iden)) {
        map.set(p.iden, { ...map.get(p.iden), ...p });
      } else {
        newOnes.push(p);
        map.set(p.iden, p);
      }
    }
    const updated = Array.from(map.values()).sort((a, b) => (b.created || 0) - (a.created || 0)).slice(0, 200);
    return [updated, newOnes];
  }
  function getPushModified(push) {
    return typeof push.modified === "number" ? push.modified : 0;
  }
  async function refreshPushes(notificationDataStore2) {
    await hydrateBackgroundConfig();
    const apiKey2 = getApiKey();
    if (!apiKey2) {
      debugLogger.general("WARN", "Cannot refresh pushes - no API key");
      return;
    }
    try {
      debugLogger.general("DEBUG", "Pipeline 1: Checking for new pushes (incremental)");
      const cutoff = sessionCache.lastModifiedCutoff ?? await storageRepository.getLastModifiedCutoff() ?? 0;
      const incrementalPushes = await fetchIncrementalPushes(apiKey2, cutoff, 100);
      debugLogger.general("INFO", "Pipeline 1: Incremental fetch complete", {
        newPushCount: incrementalPushes.length,
        cutoff
      });
      if (incrementalPushes.length === 0) {
        debugLogger.general("INFO", "Pipeline 1: No new pushes to process");
        return;
      }
      debugLogger.general("DEBUG", "Pipeline 2: Updating display pushes");
      const [updatedDisplayPushes, newPushes] = upsertPushes(
        sessionCache.recentPushes ?? [],
        incrementalPushes
      );
      sessionCache.recentPushes = updatedDisplayPushes;
      sessionCache.lastUpdated = Date.now();
      debugLogger.general("INFO", "Pipeline 2: Display updated", {
        totalDisplayPushes: updatedDisplayPushes.length,
        newPushes: newPushes.length
      });
      let openedThisRun = 0;
      const cap = await storageRepository.getMaxAutoOpenPerReconnect();
      let processedCutoff = cutoff;
      const pushesForProcessing = [...incrementalPushes].sort(
        (left, right) => getPushModified(left) - getPushModified(right)
      );
      for (const push of pushesForProcessing) {
        const modified = getPushModified(push);
        if (modified <= 0) {
          debugLogger.general("WARN", "Skipping push with invalid modified timestamp", {
            pushIden: push.iden
          });
          continue;
        }
        if (!push.iden) {
          debugLogger.general("WARN", "Skipping push with missing iden");
          continue;
        }
        if (await storageRepository.wasPushProcessed(push.iden, modified)) {
          if (modified > processedCutoff) {
            await setLastModifiedCutoffSafe(modified);
            processedCutoff = modified;
          }
          continue;
        }
        debugLogger.general("INFO", "Processing new push", {
          pushIden: push.iden,
          pushType: push.type
        });
        await showPushNotification(push, notificationDataStore2);
        if (openedThisRun >= cap) {
          debugLogger.general("WARN", "Auto-open links capped", {
            opened: openedThisRun,
            total: pushesForProcessing.length,
            cap
          });
        } else {
          const opened = await maybeAutoOpenLinkWithDismiss(push);
          if (opened) {
            openedThisRun += 1;
            if (openedThisRun >= cap) {
              debugLogger.general("WARN", "Auto-open links capped", {
                opened: openedThisRun,
                total: pushesForProcessing.length,
                cap
              });
            }
          }
        }
        await storageRepository.markPushProcessed(push.iden, modified);
        if (modified > processedCutoff) {
          await setLastModifiedCutoffSafe(modified);
          processedCutoff = modified;
        }
      }
      chrome.runtime.sendMessage({
        action: "pushesUpdated",
        pushes: sessionCache.recentPushes
      }).catch(() => void 0);
    } catch (error) {
      debugLogger.general("ERROR", "Incremental refresh failed", {}, error);
      performanceMonitor.recordHealthCheckFailure();
    }
  }
  var counter = 0;
  async function showPushNotification(push, notificationDataStore2) {
    try {
      if (isSmsChangedPush(push) && !hasSmsNotification(push)) {
        debugLogger.notifications(
          "INFO",
          "Ignoring sms_changed push with no notification content (deletion event).",
          { pushIden: push.iden }
        );
        return;
      }
      const notificationId = `pushbullet-push-${counter++}-${Date.now()}`;
      const baseOptions = {
        iconUrl: chrome.runtime.getURL("icons/icon128.png")
      };
      let notificationOptions = {
        ...baseOptions,
        type: "basic",
        title: "Pushbullet",
        message: "New push received"
      };
      if (push.encrypted && "ciphertext" in push) {
        notificationOptions = {
          ...baseOptions,
          type: "basic",
          title: "Pushbullet",
          message: "An encrypted push was received. To view future encrypted pushes you need to add the correct end2end password in options"
        };
        debugLogger.notifications(
          "INFO",
          "Showing notification for undecrypted push"
        );
      } else if (isSmsChangedPush(push) && hasSmsNotification(push)) {
        debugLogger.notifications(
          "DEBUG",
          "SMS push summary received",
          { push: summarizePushForLog(push) }
        );
        const sms = push.notifications[0];
        const title = sms.title || "New SMS";
        const message = sms.body;
        const imageUrl = sms.image_url;
        if (imageUrl && isTrustedImageUrl(imageUrl)) {
          try {
            debugLogger.notifications(
              "DEBUG",
              "Fetching contact photo for SMS notification",
              {
                imageUrl
              }
            );
            const response = await fetch(imageUrl);
            if (!response.ok) {
              throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            const blob = await response.blob();
            const reader = new FileReader();
            const dataUrl = await new Promise((resolve, reject) => {
              reader.onloadend = () => resolve(reader.result);
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            });
            debugLogger.notifications("DEBUG", "Contact photo converted to data URL", {
              originalUrl: imageUrl,
              dataUrlLength: dataUrl.length,
              blobSize: blob.size,
              blobType: blob.type
            });
            notificationOptions = {
              ...baseOptions,
              type: "basic",
              title,
              message,
              iconUrl: dataUrl
            };
            debugLogger.notifications(
              "INFO",
              "Showing business card SMS notification with contact photo",
              {
                title,
                hasIcon: true
              }
            );
          } catch (error) {
            debugLogger.notifications(
              "WARN",
              "Failed to fetch/convert contact photo, showing SMS without image",
              {
                imageUrl,
                error: error.message
              }
            );
            notificationOptions = {
              ...baseOptions,
              type: "basic",
              title,
              message
            };
          }
        } else {
          notificationOptions = {
            ...baseOptions,
            type: "basic",
            title,
            message
          };
          debugLogger.notifications("INFO", "Showing basic notification for SMS", {
            title,
            hasImage: false
          });
        }
      } else {
        let title = "Pushbullet";
        let message = "";
        if (push.type === "note") {
          title = push.title || "New Note";
          message = push.body || "";
          notificationOptions = {
            ...baseOptions,
            type: "basic",
            title,
            message
          };
        } else if (push.type === "link") {
          title = push.title || push.url || "New Link";
          message = push.url || "";
          notificationOptions = {
            ...baseOptions,
            type: "basic",
            title,
            message
          };
        } else if (isFilePush(push)) {
          debugLogger.notifications(
            "DEBUG",
            "File push summary received",
            { push: summarizePushForLog(push) }
          );
          let fileTitle = "New File";
          let fileMessage = "";
          const filePush = push;
          if (filePush.title) {
            fileTitle = filePush.title;
            fileMessage = filePush.body || `Image (${filePush.file_type})`;
          } else {
            fileTitle = `New File: ${filePush.file_name || "unknown file"}`;
            fileMessage = filePush.body || filePush.file_type || "";
          }
          const imageUrl = filePush.image_url;
          const fileUrl = filePush.file_url;
          let previewUrl = null;
          if (imageUrl && isTrustedImageUrl(imageUrl)) {
            previewUrl = imageUrl;
          } else if (fileUrl && isTrustedImageUrl(fileUrl) && filePush.file_type?.startsWith("image/")) {
            previewUrl = fileUrl;
          }
          if (previewUrl) {
            notificationOptions = {
              ...baseOptions,
              type: "image",
              title: fileTitle,
              message: fileMessage,
              imageUrl: previewUrl
            };
            debugLogger.notifications(
              "INFO",
              "Showing image notification for trusted file push",
              {
                fileName: filePush.file_name,
                previewUrl
              }
            );
          } else {
            notificationOptions = {
              ...baseOptions,
              type: "basic",
              title: fileTitle,
              message: fileMessage
            };
            if (imageUrl && !isTrustedImageUrl(imageUrl)) {
              debugLogger.notifications(
                "WARN",
                "Ignored image from untrusted domain for file push",
                {
                  imageUrl
                }
              );
            }
          }
        } else if (isMirrorPush(push)) {
          const mirrorTitle = push.application_name && push.title ? `${push.application_name}: ${push.title}` : push.title || push.application_name || "Notification";
          const mirrorMessage = push.body || "";
          const dataUrl = getMirrorIconDataUrl(push.icon, mirrorTitle);
          if (dataUrl) {
            notificationOptions = {
              ...baseOptions,
              type: "basic",
              title: mirrorTitle,
              message: mirrorMessage,
              iconUrl: dataUrl
            };
            debugLogger.notifications("INFO", "Showing mirror notification with icon", {
              title: mirrorTitle,
              hasIcon: true,
              application: push.application_name
            });
          } else {
            const mirrorImageUrl = push.image_url;
            if (mirrorImageUrl && isTrustedImageUrl(mirrorImageUrl)) {
              notificationOptions = {
                ...baseOptions,
                type: "image",
                title: mirrorTitle,
                message: mirrorMessage,
                imageUrl: mirrorImageUrl
              };
              debugLogger.notifications(
                "INFO",
                "Showing image notification for trusted mirrored push",
                { pushType: push.type }
              );
            } else {
              notificationOptions = {
                ...baseOptions,
                type: "basic",
                title: mirrorTitle,
                message: mirrorMessage
              };
              debugLogger.notifications("INFO", "Showing mirror notification without icon", {
                title: mirrorTitle,
                hasIcon: false,
                application: push.application_name
              });
            }
          }
        } else {
          const defaultTitle = "Pushbullet";
          const defaultMessage = `New ${push.type}`;
          notificationOptions = {
            ...baseOptions,
            type: "basic",
            title: defaultTitle,
            message: defaultMessage
          };
          debugLogger.notifications("INFO", "Showing basic notification", {
            pushType: push.type
          });
        }
      }
      const finalNotificationOptions = {
        type: notificationOptions.type || "basic",
        title: notificationOptions.title || "Pushbullet",
        message: notificationOptions.message || "New push received",
        iconUrl: notificationOptions.iconUrl || chrome.runtime.getURL("icons/icon128.png")
      };
      if (notificationOptions.imageUrl) {
        finalNotificationOptions.imageUrl = notificationOptions.imageUrl;
      }
      await createNotificationWithTimeout(
        notificationId,
        finalNotificationOptions,
        void 0,
        getNotificationTimeout()
      );
      if (notificationDataStore2) {
        notificationDataStore2.set(notificationId, push);
      }
      performanceMonitor.recordNotificationCreated();
      debugLogger.notifications("INFO", "Push notification created", {
        notificationId,
        pushType: push.type
      });
    } catch (error) {
      performanceMonitor.recordNotificationFailed();
      debugLogger.notifications(
        "ERROR",
        "Failed to show push notification",
        { pushIden: push.iden },
        error
      );
      throw error;
    }
  }
  function checkPollingMode() {
    const qualityMetrics = performanceMonitor.getQualityMetrics();
    if (qualityMetrics.consecutiveFailures >= 3 && !isPollingMode()) {
      debugLogger.general(
        "WARN",
        "Entering polling mode due to consecutive failures",
        {
          consecutiveFailures: qualityMetrics.consecutiveFailures
        }
      );
      setPollingMode(true);
      chrome.alarms.create("pollingFallback", { periodInMinutes: 1 });
      debugLogger.general("INFO", "Polling mode activated", {
        interval: "1 minute"
      });
    }
  }
  function stopPollingMode() {
    if (isPollingMode()) {
      debugLogger.general("INFO", "Stopping polling mode - WebSocket reconnected");
      setPollingMode(false);
      chrome.alarms.clear("pollingFallback");
    }
  }
  async function performPollingFetch() {
    await hydrateCutoff();
    const apiKey2 = getApiKey();
    if (!apiKey2) {
      debugLogger.general("WARN", "Cannot perform polling fetch - no API key");
      return;
    }
    debugLogger.general("DEBUG", "Performing polling fetch (incremental)");
    await refreshPushes();
  }
  function performWebSocketHealthCheck(websocketClient3, connectFn, recoveryController) {
    const apiKey2 = getApiKey();
    debugLogger.websocket(
      "DEBUG",
      "[HealthCheck] Running WebSocket health check",
      {
        hasClient: !!websocketClient3,
        hasApiKey: !!apiKey2,
        isConnected: websocketClient3?.isConnected() ?? false,
        readyState: websocketClient3?.ws?.readyState ?? "N/A"
      }
    );
    if (!websocketClient3 || !websocketClient3.isConnected()) {
      debugLogger.websocket(
        "WARN",
        "[HealthCheck] WebSocket is null or disconnected",
        {
          hasApiKey: !!apiKey2,
          currentState: recoveryController?.getCurrentState() ?? "unknown"
        }
      );
      if (apiKey2) {
        const currentState = recoveryController?.getCurrentState();
        const shouldRecoverViaStateMachine = recoveryController && (currentState === "idle" /* IDLE */ || currentState === "ready" /* READY */);
        const shouldReconnectDirectly = !recoveryController || currentState === "degraded" /* DEGRADED */ || currentState === "reconnecting" /* RECONNECTING */;
        if (shouldRecoverViaStateMachine) {
          debugLogger.websocket(
            "WARN",
            "[HealthCheck] Detected stale state with API key - triggering recovery",
            {
              currentState
            }
          );
          recoveryController.transition(
            "ATTEMPT_RECONNECT",
            {
              hasApiKey: true,
              socketHealthy: false
            }
          ).catch(
            (error) => {
              debugLogger.websocket(
                "ERROR",
                "[HealthCheck] Failed to trigger recovery",
                null,
                error
              );
              connectFn();
            }
          );
        } else if (shouldReconnectDirectly) {
          connectFn();
        } else {
          debugLogger.websocket(
            "DEBUG",
            "[HealthCheck] Skipping reconnect - unexpected state",
            {
              currentState
            }
          );
        }
      } else {
        debugLogger.websocket(
          "DEBUG",
          "[HealthCheck] No API key - cannot reconnect"
        );
      }
      return;
    }
    if (!websocketClient3.isConnectionHealthy()) {
      const currentState = recoveryController?.getCurrentState() ?? "unknown";
      debugLogger.websocket(
        "WARN",
        "[HealthCheck] Connection unhealthy - triggering recovery",
        {
          currentState,
          hasApiKey: !!apiKey2
        }
      );
      if (apiKey2 && recoveryController) {
        recoveryController.transition(
          "ATTEMPT_RECONNECT",
          {
            hasApiKey: true,
            socketHealthy: false
          }
        ).catch(
          (error) => {
            debugLogger.websocket(
              "ERROR",
              "[HealthCheck] Failed to trigger recovery for unhealthy connection",
              null,
              error
            );
            connectFn();
          }
        );
        return;
      }
      globalEventBus.emit(
        "websocket:disconnected"
      );
    }
  }
  function updatePopupConnectionState(state) {
    chrome.runtime.sendMessage({
      action: "connectionStateChanged",
      state
    }).catch(() => {
    });
  }
  async function pushLink(url, title) {
    const apiKey2 = getApiKey();
    if (!apiKey2) {
      debugLogger.general("WARN", "Cannot push link - no API key");
      return;
    }
    const sanitizedUrl = sanitizeUrl(url);
    const sanitizedTitle = sanitizeText(title || "Link");
    if (!sanitizedUrl) {
      debugLogger.general("ERROR", "Invalid URL provided", { url });
      return;
    }
    try {
      await sendPush(apiKey2, {
        type: "link",
        title: sanitizedTitle,
        url: sanitizedUrl
      });
      debugLogger.general("INFO", "Link pushed successfully", { url, title });
      createNotificationWithTimeout("pushbullet-link-sent", {
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: "Link Sent",
        message: title || url
      });
    } catch (error) {
      debugLogger.general(
        "ERROR",
        "Failed to push link",
        { url, title },
        error
      );
    }
  }
  async function pushNote(title, body) {
    const apiKey2 = getApiKey();
    if (!apiKey2) {
      debugLogger.general("WARN", "Cannot push note - no API key");
      return;
    }
    const sanitizedTitle = sanitizeText(title);
    const sanitizedBody = sanitizeText(body);
    try {
      await sendPush(apiKey2, {
        type: "note",
        title: sanitizedTitle,
        body: sanitizedBody
      });
      debugLogger.general("INFO", "Note pushed successfully", { title });
      createNotificationWithTimeout("pushbullet-note-sent", {
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: "Note Sent",
        message: title
      });
    } catch (error) {
      debugLogger.general(
        "ERROR",
        "Failed to push note",
        { title },
        error
      );
    }
  }

  // src/background/state-machine.ts
  var ServiceWorkerState = /* @__PURE__ */ ((ServiceWorkerState2) => {
    ServiceWorkerState2["IDLE"] = "idle";
    ServiceWorkerState2["INITIALIZING"] = "initializing";
    ServiceWorkerState2["READY"] = "ready";
    ServiceWorkerState2["DEGRADED"] = "degraded";
    ServiceWorkerState2["RECONNECTING"] = "reconnecting";
    ServiceWorkerState2["ERROR"] = "error";
    return ServiceWorkerState2;
  })(ServiceWorkerState || {});
  var ServiceWorkerStateMachine = class _ServiceWorkerStateMachine {
    currentState = "idle" /* IDLE */;
    callbacks;
    constructor(callbacks) {
      this.callbacks = callbacks;
      debugLogger.general("INFO", "[StateMachine] Initialized", { initialState: this.currentState });
    }
    /**
     * Create a new state machine instance with hydrated state from storage
     *
     * This static factory method is the only way to create a ServiceWorkerStateMachine.
     * It reads the last known state from chrome.storage.local and initializes the
     * state machine with that state, ensuring continuity across service worker restarts.
     *
     * @param callbacks - The callbacks to use for state transitions
     * @returns A promise that resolves to a fully initialized state machine
     */
    static async create(callbacks) {
      const instance = new _ServiceWorkerStateMachine(callbacks);
      try {
        const { lastKnownState } = await chrome.storage.local.get("lastKnownState");
        const restoredState = typeof lastKnownState === "string" && Object.values(ServiceWorkerState).includes(lastKnownState) ? lastKnownState : null;
        if (restoredState === "error" /* ERROR */) {
          debugLogger.general(
            "WARN",
            "[StateMachine] Hydrated to ERROR state. Reverting to IDLE to force re-initialization."
          );
          instance.currentState = "idle" /* IDLE */;
        } else if (restoredState === "reconnecting" /* RECONNECTING */ || restoredState === "degraded" /* DEGRADED */) {
          debugLogger.general(
            "INFO",
            "[StateMachine] Hydrated to transient state. Resetting to IDLE to re-establish connection.",
            {
              staleState: lastKnownState
            }
          );
          instance.currentState = "idle" /* IDLE */;
        } else if (restoredState) {
          instance.currentState = restoredState;
          debugLogger.general("INFO", "[StateMachine] Hydrated state from storage", {
            restoredState: instance.currentState
          });
        } else {
          debugLogger.general("INFO", "[StateMachine] No valid state in storage, using default", {
            initialState: instance.currentState
          });
        }
      } catch (error) {
        debugLogger.storage("ERROR", "[StateMachine] Failed to hydrate state, defaulting to IDLE", null, error);
        instance.currentState = "idle" /* IDLE */;
      }
      updateExtensionTooltip(instance.getStateDescription());
      switch (instance.currentState) {
        case "ready" /* READY */:
          updateConnectionIcon("connected");
          break;
        case "initializing" /* INITIALIZING */:
        case "reconnecting" /* RECONNECTING */:
          updateConnectionIcon("connecting");
          break;
        case "degraded" /* DEGRADED */:
          updateConnectionIcon("degraded");
          break;
        case "error" /* ERROR */:
        case "idle" /* IDLE */:
          updateConnectionIcon("disconnected");
          break;
      }
      return instance;
    }
    /**
     * Get the current state
     */
    getCurrentState() {
      return this.currentState;
    }
    /**
     * Check if in a specific state
     */
    isInState(state) {
      return this.currentState === state;
    }
    /**
     * Transition to a new state based on an event
     * 
     * @param event - The event that triggers the transition
     * @param data - Optional data to pass to the state entry handler
     */
    async transition(event, data) {
      const nextState = this.getNextState(event, data);
      if (nextState !== this.currentState) {
        debugLogger.general("INFO", `[StateMachine] Transition`, {
          from: this.currentState,
          event,
          to: nextState
        });
        await this.onStateExit(this.currentState, nextState);
        const previousState = this.currentState;
        this.currentState = nextState;
        await this.onStateEnter(this.currentState, previousState, data);
        try {
          await chrome.storage.local.set({
            lastKnownState: this.currentState,
            lastKnownStateDescription: this.getStateDescription()
          });
          debugLogger.storage("DEBUG", "[StateMachine] Persisted new state to storage", { state: this.currentState });
        } catch (error) {
          debugLogger.storage("ERROR", "[StateMachine] Failed to persist state", null, error);
        }
      } else {
        debugLogger.general("DEBUG", `[StateMachine] No transition`, {
          state: this.currentState,
          event
        });
      }
    }
    /**
     * Determine the next state based on current state and event
     *
     * This implements the state transition table from ADR 0005.
     */
    getNextState(event, data) {
      if (event === "LOGOUT") {
        return "idle" /* IDLE */;
      }
      if (event === "STARTUP") {
        if (data?.hasApiKey) {
          if (this.currentState === "initializing" /* INITIALIZING */) {
            return "initializing" /* INITIALIZING */;
          }
          return "initializing" /* INITIALIZING */;
        } else {
          return "idle" /* IDLE */;
        }
      }
      switch (this.currentState) {
        case "idle" /* IDLE */:
          if (event === "API_KEY_SET") {
            return "initializing" /* INITIALIZING */;
          }
          if (event === "ATTEMPT_RECONNECT") {
            const hasApiKey = data?.hasApiKey === true;
            if (hasApiKey) {
              debugLogger.general("INFO", "[StateMachine] Attempting recovery from IDLE with existing API key");
              return "initializing" /* INITIALIZING */;
            }
          }
          return "idle" /* IDLE */;
        case "initializing" /* INITIALIZING */:
          if (event === "INIT_SUCCESS") {
            return "reconnecting" /* RECONNECTING */;
          }
          if (event === "INIT_FAILURE") {
            return "error" /* ERROR */;
          }
          break;
        case "ready" /* READY */:
          if (event === "ATTEMPT_RECONNECT" && data?.hasApiKey === true && data?.socketHealthy === false) {
            return "reconnecting" /* RECONNECTING */;
          }
          if (event === "WS_DISCONNECTED") {
            return "degraded" /* DEGRADED */;
          }
          if (event === "WS_PERMANENT_ERROR") {
            return "error" /* ERROR */;
          }
          break;
        case "degraded" /* DEGRADED */:
          if (event === "WS_CONNECTED") {
            return "ready" /* READY */;
          }
          if (event === "WS_PERMANENT_ERROR") {
            return "error" /* ERROR */;
          }
          if (event === "ATTEMPT_RECONNECT") {
            return "reconnecting" /* RECONNECTING */;
          }
          break;
        case "reconnecting" /* RECONNECTING */:
          if (event === "WS_CONNECTED") {
            return "ready" /* READY */;
          }
          if (event === "WS_DISCONNECTED") {
            return "degraded" /* DEGRADED */;
          }
          if (event === "WS_PERMANENT_ERROR") {
            return "error" /* ERROR */;
          }
          break;
        case "error" /* ERROR */: {
          switch (event) {
            case "ATTEMPT_RECONNECT":
              return "reconnecting" /* RECONNECTING */;
            case "API_KEY_SET":
              return "initializing" /* INITIALIZING */;
            default:
              return "error" /* ERROR */;
          }
        }
      }
      return this.currentState;
    }
    /**
     * Handle entering a new state
     * 
     * This is where side effects happen (calling callbacks).
     */
    async onStateEnter(state, previousState, data) {
      debugLogger.general("DEBUG", `[StateMachine] Entering state: ${state} (from ${previousState})`, { state, previousState });
      updateExtensionTooltip(this.getStateDescription());
      switch (state) {
        case "idle" /* IDLE */:
          updateConnectionIcon("disconnected");
          if (this.callbacks.onClearData) {
            await this.callbacks.onClearData();
          }
          if (this.callbacks.onDisconnectWebSocket) {
            this.callbacks.onDisconnectWebSocket();
          }
          break;
        case "initializing" /* INITIALIZING */:
          updateConnectionIcon("connecting");
          if (this.callbacks.onInitialize) {
            try {
              await this.callbacks.onInitialize(this.getInitializationPayload(data));
              await this.transition("INIT_SUCCESS");
            } catch (error) {
              debugLogger.general("ERROR", "[StateMachine] Initialization failed", null, error);
              await this.transition("INIT_FAILURE", {
                error: error instanceof Error ? error.message : String(error)
              });
            }
          }
          break;
        case "ready" /* READY */:
          updateConnectionIcon("connected");
          try {
            await chrome.storage.local.remove("lastError");
            debugLogger.storage("DEBUG", "Cleared lastError on successful recovery");
          } catch (e) {
            debugLogger.storage("WARN", "Failed to clear lastError", null, e);
          }
          if (previousState === "degraded" /* DEGRADED */ && this.callbacks.onStopPolling) {
            this.callbacks.onStopPolling();
          }
          break;
        case "degraded" /* DEGRADED */:
          debugLogger.general("WARN", "Entering DEGRADED state. Starting polling fallback.");
          updateConnectionIcon("degraded");
          if (this.callbacks.onStartPolling) {
            this.callbacks.onStartPolling();
          }
          break;
        case "reconnecting" /* RECONNECTING */:
          updateConnectionIcon("connecting");
          if (this.callbacks.onConnectWebSocket) {
            this.callbacks.onConnectWebSocket();
          }
          break;
        case "error" /* ERROR */: {
          updateConnectionIcon("disconnected");
          try {
            await chrome.storage.local.set({
              lastError: {
                timestamp: Date.now(),
                message: data?.error || "Unknown error",
                previousState
              }
            });
          } catch (e) {
            debugLogger.storage("ERROR", "Failed to store error context", null, e);
          }
          if (this.callbacks.onShowError) {
            this.callbacks.onShowError("Service worker encountered an error");
          }
          const RECOVERY_DELAY_MS = 3e4;
          chrome.alarms.create("auto-recovery-from-error", {
            delayInMinutes: RECOVERY_DELAY_MS / 6e4
          });
          debugLogger.general("INFO", "[StateMachine] Scheduled automatic recovery", {
            delayMs: RECOVERY_DELAY_MS,
            currentState: this.currentState
          });
          break;
        }
      }
    }
    /**
     * Handle exiting a state
     * 
     * Optional cleanup logic when leaving a state.
     */
    async onStateExit(state, nextState) {
      debugLogger.general("DEBUG", `[StateMachine] Exiting state: ${state} -> ${nextState}`, { state, nextState });
      if (state === "degraded" /* DEGRADED */) {
        debugLogger.general("INFO", "Exiting DEGRADED state. Stopping polling fallback.");
        if (this.callbacks.onStopPolling) {
          this.callbacks.onStopPolling();
        }
      }
    }
    getInitializationPayload(data) {
      if (!data) {
        return void 0;
      }
      const { hasApiKey, apiKey: apiKey2, socketHealthy, reason } = data;
      if (hasApiKey === void 0 && apiKey2 === void 0 && socketHealthy === void 0 && reason === void 0) {
        return void 0;
      }
      return {
        hasApiKey,
        apiKey: apiKey2,
        socketHealthy,
        reason
      };
    }
    /**
     * Get a human-readable description of the current state
     */
    getStateDescription() {
      switch (this.currentState) {
        case "idle" /* IDLE */:
          return "Idle - No API key configured";
        case "initializing" /* INITIALIZING */:
          return "Initializing - Fetching session data";
        case "ready" /* READY */:
          return "Ready - Connected via WebSocket";
        case "degraded" /* DEGRADED */:
          return "Degraded - Using polling fallback";
        case "reconnecting" /* RECONNECTING */:
          return "Reconnecting - Attempting to restore real-time connection";
        case "error" /* ERROR */:
          return "Error - Unrecoverable error occurred";
        default:
          return "Unknown state";
      }
    }
  };

  // src/background/startup.ts
  async function orchestrateInitialization(trigger, connectWs) {
    const existingInit = getInitPromise();
    if (existingInit) {
      debugLogger.general(
        "INFO",
        "Initialization already in progress, awaiting existing promise",
        { trigger, source: "orchestrateInitialization" }
      );
      try {
        await existingInit;
        debugLogger.general(
          "INFO",
          "Existing initialization completed successfully",
          { trigger }
        );
        return;
      } catch (error) {
        debugLogger.general(
          "WARN",
          "Existing initialization failed, will create new attempt",
          { trigger, error: error.message }
        );
      }
    }
    const initializationPromise = (async () => {
      startCriticalKeepalive();
      try {
        await ensureDebugConfigLoadedOnce();
        const apiKey2 = await storageRepository.getApiKey();
        if (!apiKey2) {
          debugLogger.general(
            "WARN",
            "No API key available, skipping initialization"
          );
          return null;
        }
        setApiKey(apiKey2);
        await hydrateCutoff();
        debugLogger.general("INFO", "Starting orchestrated initialization", {
          trigger
        });
        const cachedSession = await loadSessionCache();
        const DOWNTIME_THRESHOLD = 36e5;
        const isLongDowntime = cachedSession && Date.now() - cachedSession.cachedAt > DOWNTIME_THRESHOLD;
        if (isLongDowntime) {
          debugLogger.general("WARN", "Long downtime (>1h) detected, forcing full network reinit");
        }
        if (cachedSession && !isLongDowntime && isCacheFresh(cachedSession)) {
          debugLogger.general("INFO", "Hydrating session from IndexedDB cache", {
            cacheAge: `${Math.round((Date.now() - cachedSession.cachedAt) / 1e3)}s`,
            deviceCount: cachedSession.devices.length,
            pushCount: cachedSession.recentPushes.length
          });
          Object.assign(sessionCache, cachedSession);
          connectWs();
          void refreshSessionInBackground(apiKey2);
          debugLogger.general(
            "INFO",
            "Initialization completed using cache (background refresh queued)",
            { trigger }
          );
          return apiKey2;
        }
        debugLogger.general(
          "INFO",
          "Cache stale or missing, performing full network init",
          {
            hasCachedSession: !!cachedSession,
            cacheAge: cachedSession?.cachedAt ? `${Math.round((Date.now() - cachedSession.cachedAt) / 1e3)}s` : "N/A"
          }
        );
        const cachedUser = await storageRepository.getUserInfoCache();
        if (cachedUser) {
          sessionCache.userInfo = cachedUser;
          debugLogger.general("INFO", "Loaded stale user info from legacy cache");
        }
        const userP = getUserInfoWithTimeoutRetry(apiKey2).then(async (u) => {
          sessionCache.userInfo = u;
          await storageRepository.setUserInfoCache(u);
          debugLogger.general("INFO", "User info fetched and cached");
        }).catch((e) => {
          debugLogger.api(
            "WARN",
            "users/me timed out or failed; using cache if present",
            { error: String(e) }
          );
        });
        const devicesP = fetchDevices(apiKey2).then((d) => {
          sessionCache.devices = d;
          debugLogger.general("INFO", "Devices fetched", { count: d.length });
        });
        const displayPushesP = fetchDisplayPushes(apiKey2, 50).catch((e) => {
          debugLogger.api("WARN", "Display pushes fetch failed during startup", {
            error: String(e)
          });
          return sessionCache.recentPushes;
        }).then((pushes) => {
          sessionCache.recentPushes = pushes;
          debugLogger.general("INFO", "Display pushes fetched", {
            count: pushes.length
          });
        });
        const chatsP = fetchChats(apiKey2).catch((e) => {
          debugLogger.api("WARN", "Chats fetch failed during startup", {
            error: String(e)
          });
          return sessionCache.chats;
        }).then((chats) => {
          sessionCache.chats = chats;
          debugLogger.general("INFO", "Chats fetched", { count: chats.length });
        });
        const wsP = Promise.resolve().then(() => connectWs());
        const results = await Promise.allSettled([
          devicesP,
          displayPushesP,
          chatsP,
          wsP
        ]);
        debugLogger.general("INFO", "Functional ready: popup session data + ws initialized", {
          trigger,
          results: results.map((r, i) => ({ index: i, status: r.status }))
        });
        try {
          sessionCache.isAuthenticated = true;
          sessionCache.lastUpdated = Date.now();
          await saveSessionCache(sessionCache);
          sessionCache.cachedAt = Date.now();
          debugLogger.general(
            "INFO",
            "Session cache saved to IndexedDB after network init",
            {
              deviceCount: sessionCache.devices.length,
              pushCount: sessionCache.recentPushes.length,
              chatCount: sessionCache.chats.length,
              cachedAt: sessionCache.cachedAt
            }
          );
        } catch (error) {
          debugLogger.general(
            "WARN",
            "Failed to save session cache to IndexedDB",
            null,
            error
          );
        }
        debugLogger.general("INFO", "Background service worker initialized", {
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        });
        await userP.catch(() => {
        });
        return apiKey2;
      } catch (error) {
        debugLogger.general("ERROR", "Orchestrated initialization failed", {
          trigger,
          error: error.message
        });
        throw error;
      } finally {
        stopCriticalKeepalive();
      }
    })();
    setInitPromise(initializationPromise);
    try {
      await initializationPromise;
      debugLogger.general(
        "INFO",
        "orchestrateInitialization completed successfully",
        {
          trigger,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        }
      );
    } catch (error) {
      debugLogger.general(
        "ERROR",
        "orchestrateInitialization failed",
        { trigger },
        error
      );
      throw error;
    } finally {
      clearInitPromise();
    }
  }

  // src/realtime/postConnectQueue.ts
  var queue = [];
  async function runPostConnect() {
    while (queue.length) {
      const t = queue.shift();
      try {
        await t();
      } catch {
      }
    }
  }

  // src/background/index.ts
  var DEFAULT_FILE_TYPE = "application/octet-stream";
  var MAX_FILE_NAME_LENGTH = 255;
  var MAX_FILE_TYPE_LENGTH = 255;
  var LONG_SLEEP_RECOVERY_ALARM = "longSleepRecovery";
  var LONG_SLEEP_RECOVERY_PERIOD_MINUTES = 5;
  function buildUploadError(code, stage, message, status) {
    return {
      code,
      stage,
      message,
      ...status === void 0 ? {} : { status }
    };
  }
  function validateUploadMetadata(message, maxUploadSize) {
    const fileName = typeof message.fileName === "string" ? message.fileName.trim() : "";
    const fileType = typeof message.fileType === "string" && message.fileType.trim() ? message.fileType.trim() : DEFAULT_FILE_TYPE;
    const fileSize = typeof message.fileSize === "number" ? message.fileSize : 0;
    if (!fileName) {
      throw buildUploadError(
        "invalid_file_name",
        "metadata",
        "File name is required."
      );
    }
    if (fileName.length > MAX_FILE_NAME_LENGTH) {
      throw buildUploadError(
        "invalid_file_name",
        "metadata",
        "File name is too long."
      );
    }
    if (fileType.length > MAX_FILE_TYPE_LENGTH) {
      throw buildUploadError(
        "invalid_file_type",
        "metadata",
        "File type is too long."
      );
    }
    if (fileSize <= 0) {
      throw buildUploadError(
        "invalid_file",
        "metadata",
        "File data is required."
      );
    }
    if (typeof maxUploadSize === "number" && maxUploadSize > 0 && fileSize > maxUploadSize) {
      throw buildUploadError(
        "file_too_large",
        "metadata",
        "File exceeds the account upload limit."
      );
    }
    if (typeof message.fileBase64 !== "string" || !message.fileBase64) {
      throw buildUploadError(
        "invalid_file",
        "metadata",
        "File data is required."
      );
    }
    const fileBytes = decodeBase64File(message.fileBase64);
    if (fileBytes.byteLength !== fileSize) {
      throw buildUploadError(
        "invalid_file",
        "metadata",
        "File data did not match the declared size."
      );
    }
    return {
      fileName,
      fileType,
      fileBytes
    };
  }
  function decodeBase64File(fileBase64) {
    try {
      const binary = atob(fileBase64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      return bytes;
    } catch {
      throw buildUploadError(
        "invalid_file",
        "metadata",
        "File data is not valid base64."
      );
    }
  }
  function toArrayBuffer(bytes) {
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    return buffer;
  }
  function getAlarm(name) {
    return new Promise((resolve) => {
      chrome.alarms.get(name, (alarm) => {
        resolve(alarm);
      });
    });
  }
  async function ensureLongSleepRecoveryAlarm() {
    const alarm = await getAlarm(LONG_SLEEP_RECOVERY_ALARM);
    if (alarm) {
      return;
    }
    chrome.alarms.create(LONG_SLEEP_RECOVERY_ALARM, {
      periodInMinutes: LONG_SLEEP_RECOVERY_PERIOD_MINUTES
    });
  }
  function isStructuredUploadError(error) {
    return typeof error === "object" && error !== null && "code" in error && "stage" in error && "message" in error;
  }
  function toStructuredUploadError(error) {
    if (isStructuredUploadError(error)) {
      return error;
    }
    if (error instanceof PushbulletUploadError) {
      return buildUploadError(
        error.code,
        error.stage,
        error.message,
        error.status
      );
    }
    return buildUploadError(
      "upload_failed",
      "unknown",
      error instanceof Error ? error.message : "File upload failed."
    );
  }
  var notificationDataStore = /* @__PURE__ */ new Map();
  var MAX_NOTIFICATION_STORE_SIZE = 100;
  function addToNotificationStore(id, push) {
    if (notificationDataStore.size >= MAX_NOTIFICATION_STORE_SIZE) {
      const firstKey = notificationDataStore.keys().next().value;
      if (firstKey) {
        notificationDataStore.delete(firstKey);
      }
    }
    notificationDataStore.set(id, push);
  }
  function getNotificationStore() {
    return notificationDataStore;
  }
  var websocketClient2 = null;
  var ranReconnectAutoOpen = false;
  async function promoteToReadyIfConnected() {
    if (!websocketClient2?.isConnectionHealthy?.()) return;
    await stateMachineReady;
    const inRecovery = stateMachine.isInState("reconnecting" /* RECONNECTING */) || stateMachine.isInState("degraded" /* DEGRADED */);
    if (inRecovery) {
      stateMachine.transition("WS_CONNECTED");
      void runPostConnect();
      void maybeRunReconnectAutoOpen();
    }
  }
  async function maybeRunReconnectAutoOpen() {
    if (ranReconnectAutoOpen) return;
    ranReconnectAutoOpen = true;
    const apiKey2 = getApiKey();
    if (!apiKey2) return;
    const storedCutoff = await storageRepository.getLastModifiedCutoff() ?? 0;
    const sessionCutoff = sessionCache.lastModifiedCutoff ?? storedCutoff;
    try {
      await autoOpenOfflineLinks(apiKey2, sessionCutoff);
    } catch (e) {
      debugLogger.general("ERROR", "Auto-open on reconnect failed", {
        error: String(e)
      });
    }
  }
  globalEventBus.on("websocket:tickle:push", async () => {
    try {
      await refreshPushes(notificationDataStore);
    } finally {
      await promoteToReadyIfConnected();
    }
  });
  globalEventBus.on("websocket:tickle:device", async () => {
    const apiKey2 = getApiKey();
    if (apiKey2) {
      const devices = await fetchDevices(apiKey2);
      sessionCache.devices = devices;
      sessionCache.lastUpdated = Date.now();
      chrome.runtime.sendMessage({
        action: "sessionDataUpdated" /* SESSION_DATA_UPDATED */,
        isAuthenticated: sessionCache.isAuthenticated,
        devices,
        chats: sessionCache.chats,
        userInfo: sessionCache.userInfo,
        autoOpenLinks: sessionCache.autoOpenLinks,
        deviceNickname: sessionCache.deviceNickname
      }).catch(() => {
      });
    }
  });
  globalEventBus.on("websocket:push", async (push) => {
    await hydrateBackgroundConfig();
    performanceMonitor.recordPushReceived();
    let decryptedPush = push;
    let decryptionFailed = false;
    if ("encrypted" in push && push.encrypted && "ciphertext" in push) {
      try {
        const password = await storageRepository.getEncryptionPassword();
        if (password && sessionCache.userInfo) {
          debugLogger.general("INFO", "Decrypting encrypted push", {
            pushIden: push.iden
          });
          const decrypted = await PushbulletCrypto.decryptPush(
            push,
            password,
            sessionCache.userInfo.iden
          );
          decryptedPush = decrypted;
          debugLogger.general("INFO", "Push decrypted successfully", {
            pushType: decryptedPush.type
          });
          debugLogger.general("DEBUG", "Decrypted push summary", {
            push: summarizePushForLog(decryptedPush)
          });
        } else {
          debugLogger.general(
            "WARN",
            "Cannot decrypt push - no encryption password set"
          );
          decryptionFailed = true;
        }
      } catch (error) {
        debugLogger.general(
          "ERROR",
          "Failed to decrypt push",
          { error: error.message },
          error
        );
        decryptionFailed = true;
      }
    }
    if (decryptionFailed) {
      debugLogger.general(
        "WARN",
        "Skipping encrypted push due to decryption failure",
        {
          pushIden: push.iden,
          hasEncryptionPassword: !!await storageRepository.getEncryptionPassword()
        }
      );
      return;
    }
    const pushWithOptionalType = decryptedPush;
    if (!pushWithOptionalType.type) {
      debugLogger.general("ERROR", "Push has no type field after decryption", {
        pushIden: pushWithOptionalType.iden,
        pushSummary: summarizePushForLog(decryptedPush)
      });
      return;
    }
    const typeCheck = checkPushTypeSupport(decryptedPush.type);
    if (!typeCheck.supported) {
      if (typeCheck.category === "known-unsupported") {
        debugLogger.general("WARN", "Received known unsupported push type", {
          pushType: decryptedPush.type,
          pushIden: decryptedPush.iden,
          category: typeCheck.category,
          reason: "This push type is not supported by the extension",
          supportedTypes: SUPPORTED_PUSH_TYPES
        });
      } else if (typeCheck.category === "unknown") {
        debugLogger.general("WARN", "Received unknown push type", {
          pushType: decryptedPush.type,
          pushIden: decryptedPush.iden,
          category: typeCheck.category,
          reason: "This is a new or unrecognized push type",
          supportedTypes: SUPPORTED_PUSH_TYPES,
          pushSummary: summarizePushForLog(decryptedPush)
        });
      }
      return;
    }
    debugLogger.general("INFO", "Processing supported push type", {
      pushType: decryptedPush.type,
      pushIden: decryptedPush.iden
    });
    if (decryptedPush.type === "mirror") {
      debugLogger.general("DEBUG", "Mirror push summary", {
        push: summarizePushForLog(decryptedPush)
      });
    }
    if (sessionCache.recentPushes) {
      sessionCache.recentPushes.unshift(decryptedPush);
      saveSessionCache(sessionCache);
      sessionCache.lastUpdated = Date.now();
      chrome.runtime.sendMessage({
        action: "pushesUpdated" /* PUSHES_UPDATED */,
        pushes: sessionCache.recentPushes
      }).catch(() => {
      });
    }
    showPushNotification(decryptedPush, notificationDataStore).catch((error) => {
      debugLogger.general("ERROR", "Failed to show notification", null, error);
      performanceMonitor.recordNotificationFailed();
    });
    const autoOpenLinks2 = getAutoOpenLinks();
    if (autoOpenLinks2 && isLinkPush(decryptedPush)) {
      await maybeAutoOpenLinkWithDismiss({
        iden: decryptedPush.iden,
        type: decryptedPush.type,
        url: decryptedPush.url,
        created: decryptedPush.created
      });
    }
    await promoteToReadyIfConnected();
  });
  globalEventBus.on("websocket:message", async () => {
    await promoteToReadyIfConnected();
  });
  globalEventBus.on("websocket:connected", async () => {
    debugLogger.websocket(
      "INFO",
      "WebSocket connected - post-connect tasks starting"
    );
    await stateMachineReady;
    stateMachine.transition("WS_CONNECTED");
    void runPostConnect();
    void maybeRunReconnectAutoOpen();
  });
  globalEventBus.on("websocket:disconnected", async () => {
    await stateMachineReady;
    stateMachine.transition("WS_DISCONNECTED");
  });
  globalEventBus.on("websocket:permanent-error", async () => {
    await stateMachineReady;
    stateMachine.transition("WS_PERMANENT_ERROR");
  });
  globalEventBus.on("websocket:polling:check", () => {
    checkPollingMode();
  });
  globalEventBus.on("websocket:polling:stop", () => {
    stopPollingMode();
  });
  globalEventBus.on("websocket:state", (state) => {
    updatePopupConnectionState(state);
  });
  globalEventBus.on("state:enter:reconnecting", () => {
    ranReconnectAutoOpen = false;
  });
  var stateMachine;
  var stateMachineCallbacks = {
    onInitialize: async (data) => {
      const apiKey2 = data?.apiKey || getApiKey();
      if (apiKey2) {
        await initializeSessionCache("state-machine", connectWebSocket, {
          setApiKey,
          setDeviceIden,
          setAutoOpenLinks,
          setNotificationTimeout,
          setDeviceNickname
        });
      }
    },
    onConnectWebSocket: () => {
      connectWebSocket();
    },
    onStartPolling: () => {
      checkPollingMode();
    },
    onStopPolling: () => {
      stopPollingMode();
    },
    onShowError: (error) => {
      debugLogger.general("ERROR", "[StateMachine] Error state", { error });
    },
    onClearData: async () => {
      resetSessionCache();
    },
    onDisconnectWebSocket: () => {
      disconnectWebSocket();
    }
  };
  var stateMachineReady = ServiceWorkerStateMachine.create(
    stateMachineCallbacks
  ).then((sm) => {
    stateMachine = sm;
    debugLogger.general(
      "INFO",
      "[Background] State machine initialized and ready",
      {
        currentState: stateMachine.getCurrentState()
      }
    );
  });
  var { bootstrap, reconcileWake } = createLifecycleCoordinator({
    hydrateConfig: hydrateBackgroundConfig,
    stateMachineReady,
    getStateMachine: () => stateMachine,
    getApiKey,
    getDeviceIden,
    getAutoOpenLinks,
    getDeviceNickname,
    isSocketHealthy: () => !!websocketClient2?.isConnected?.() && !!websocketClient2?.isConnectionHealthy?.()
  });
  async function getPopupRecentPushes2() {
    const onlyThisDevice = await storageRepository.getOnlyThisDevice() || false;
    const deviceIden2 = await storageRepository.getDeviceIden();
    if (!onlyThisDevice || !deviceIden2) {
      return sessionCache.recentPushes ?? [];
    }
    return (sessionCache.recentPushes ?? []).filter(
      (push) => push.target_device_iden === deviceIden2
    );
  }
  async function buildSessionDataResponse(apiKey2) {
    const filteredPushes = await getPopupRecentPushes2();
    debugLogger.general("INFO", "Recent pushes filtered for display", {
      total: sessionCache.recentPushes?.length ?? 0,
      filtered: filteredPushes.length
    });
    return {
      isAuthenticated: !!apiKey2,
      userInfo: sessionCache.userInfo,
      devices: sessionCache.devices,
      recentPushes: filteredPushes,
      chats: sessionCache.chats,
      autoOpenLinks: getAutoOpenLinks(),
      deviceNickname: getDeviceNickname(),
      websocketConnected: websocketClient2 ? websocketClient2.isConnected() : false,
      state: stateMachine.getCurrentState()
    };
  }
  async function refreshPopupTargetsInBackground(apiKey2) {
    debugLogger.general("INFO", "Refreshing popup targets in background");
    const [devicesResult, chatsResult] = await Promise.allSettled([
      fetchDevices(apiKey2),
      fetchChats(apiKey2)
    ]);
    let refreshed = false;
    if (devicesResult.status === "fulfilled") {
      sessionCache.devices = devicesResult.value;
      refreshed = true;
    } else {
      debugLogger.general("WARN", "Failed to refresh devices for popup", {
        error: devicesResult.reason.message
      });
    }
    if (chatsResult.status === "fulfilled") {
      sessionCache.chats = chatsResult.value;
      refreshed = true;
    } else {
      debugLogger.general("WARN", "Failed to refresh chats for popup", {
        error: chatsResult.reason.message
      });
    }
    if (!refreshed) {
      return;
    }
    sessionCache.lastUpdated = Date.now();
    chrome.runtime.sendMessage({
      action: "sessionDataUpdated" /* SESSION_DATA_UPDATED */,
      ...await buildSessionDataResponse(apiKey2)
    }).catch(() => {
      debugLogger.general(
        "DEBUG",
        "Popup not available for background target refresh"
      );
    });
  }
  installDiagnosticsMessageHandler();
  function connectWebSocket() {
    if (websocketClient2) {
      const isConnected = websocketClient2.isConnected();
      const isConnecting = websocketClient2.getReadyState() === WebSocket.CONNECTING;
      if (isConnected || isConnecting) {
        debugLogger.websocket(
          "DEBUG",
          "WebSocket already connected/connecting, skipping duplicate call",
          {
            isConnected,
            isConnecting,
            readyState: websocketClient2.getReadyState()
          }
        );
        return;
      }
    }
    if (websocketClient2) {
      debugLogger.websocket(
        "INFO",
        "Disposing existing WebSocket before reconnecting"
      );
      websocketClient2.disconnect();
      websocketClient2 = null;
    }
    websocketClient2 = new WebSocketClient(WEBSOCKET_URL, getApiKey);
    setWebSocketClient(websocketClient2);
    websocketClient2.connect();
  }
  function disconnectWebSocket() {
    if (websocketClient2) {
      websocketClient2.disconnect();
    }
  }
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (handleKeepaliveAlarm(alarm)) {
      return;
    }
    if (alarm.name === "keepalive") {
      debugLogger.general("DEBUG", "Keepalive heartbeat");
      if (websocketClient2?.isConnectionHealthy?.()) {
        await stateMachineReady;
        const notReady = !stateMachine.isInState("ready" /* READY */);
        if (notReady) {
          stateMachine.transition("WS_CONNECTED");
          void runPostConnect();
          void maybeRunReconnectAutoOpen();
        }
      }
      const apiKey2 = getApiKey();
      if (!apiKey2) {
        debugLogger.general("WARN", "Keepalive: API key missing, reloading");
        await hydrateBackgroundConfig();
      }
      return;
    }
    if (alarm.name === "logFlush") {
      await debugLogger.flush();
      return;
    }
    if (alarm.name === "auto-recovery-from-error") {
      debugLogger.general(
        "INFO",
        "[Alarm] Auto-recovery timer fired, attempting to reconnect"
      );
      await reconcileWake("auto-recovery-from-error");
    }
    await stateMachineReady;
    if (alarm.name === LONG_SLEEP_RECOVERY_ALARM) {
      debugLogger.general("INFO", "[Alarm] Long sleep recovery triggered");
      await reconcileWake(LONG_SLEEP_RECOVERY_ALARM);
      return;
    }
    if (alarm.name === "websocketHealthCheck") {
      await reconcileWake("websocketHealthCheck");
      const currentState = stateMachine.getCurrentState();
      debugLogger.general(
        "DEBUG",
        "[Alarm] Health check alarm fired",
        {
          currentState,
          hasWebSocketClient: !!websocketClient2
        }
      );
      if (stateMachine.isInState("degraded" /* DEGRADED */)) {
        await performPollingFetch();
        const consecutiveFailures = performanceMonitor.getQualityMetrics().consecutiveFailures;
        if (consecutiveFailures >= 3) {
          debugLogger.general(
            "WARN",
            "[Degraded] Too many failures, escalating to ERROR"
          );
          await stateMachine.transition("WS_PERMANENT_ERROR");
        } else {
          await stateMachine.transition("ATTEMPT_RECONNECT");
        }
      } else if (stateMachine.isInState("idle" /* IDLE */)) {
        const apiKey2 = getApiKey();
        if (apiKey2) {
          debugLogger.general(
            "WARN",
            "[Alarm] Health check found IDLE state with API key - attempting recovery"
          );
          await stateMachine.transition("ATTEMPT_RECONNECT", {
            hasApiKey: true
          });
        } else {
          debugLogger.general(
            "DEBUG",
            "[Alarm] IDLE state without API key - nothing to do"
          );
        }
      } else {
        performWebSocketHealthCheck(websocketClient2, connectWebSocket, stateMachine);
      }
    }
  });
  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    await hydrateBackgroundConfig();
    if (!getApiKey()) {
      chrome.notifications.create("pushbullet-no-api-key", {
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: "Pushbullet",
        message: "Please set your API key in the extension popup"
      });
      return;
    }
    switch (info.menuItemId) {
      case "push-link":
        if (info.linkUrl && tab) {
          pushLink(info.linkUrl, tab.title);
        }
        break;
      case "push-page":
        if (tab && tab.url) {
          pushLink(tab.url, tab.title);
        }
        break;
      case "push-selection":
        if (info.selectionText && tab) {
          pushNote("Selection from " + (tab.title || "page"), info.selectionText);
        }
        break;
      case "push-image":
        if (info.srcUrl && tab) {
          pushLink(info.srcUrl, "Image from " + (tab.title || "page"));
        }
        break;
    }
  });
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!validatePrivilegedMessage(message.action, sender)) {
      debugLogger.general(
        "ERROR",
        "Rejected privileged message from untrusted sender",
        {
          action: message.action,
          senderId: sender?.id,
          senderUrl: sender?.url
        }
      );
      sendResponse({ success: false, error: "Unauthorized" });
      return false;
    } else if (message.action === "log" /* LOG */) {
      if (message.payload) {
        const { level, message: logMessage, data } = message.payload;
        const prefix = "[POPUP]";
        switch (level) {
          case "ERROR":
            debugLogger.general("ERROR", `${prefix} ${logMessage}`, data);
            break;
          case "WARN":
            debugLogger.general("WARN", `${prefix} ${logMessage}`, data);
            break;
          case "INFO":
          default:
            debugLogger.general("INFO", `${prefix} ${logMessage}`, data);
            break;
        }
      }
      return false;
    }
    if (message.action !== "getDebugSummary" /* GET_DEBUG_SUMMARY */) {
      debugLogger.general("DEBUG", "Message received", {
        type: message.type,
        action: message.action,
        sender: sender.id
      });
    }
    if (message.action === "GET_PUSH_DATA" /* GET_PUSH_DATA */) {
      debugLogger.general("DEBUG", "GET_PUSH_DATA request received", {
        notificationId: message.notificationId
      });
      const push = notificationDataStore.get(message.notificationId);
      if (push) {
        debugLogger.general("DEBUG", "Push data found", {
          notificationId: message.notificationId,
          pushType: push.type
        });
        sendResponse({ success: true, push });
      } else {
        debugLogger.general("WARN", "Push data not found", {
          notificationId: message.notificationId,
          storeSize: notificationDataStore.size
        });
        sendResponse({ success: false, error: "Push data not found" });
      }
      return true;
    }
    if (message.action === "getSessionData" /* GET_SESSION_DATA */) {
      (async () => {
        try {
          await ensureDebugConfigLoadedOnce();
          await reconcileWake("popup-open");
          const apiKey2 = getApiKey();
          const isWakeUp = apiKey2 && !sessionCache.isAuthenticated;
          if (isWakeUp) {
            debugLogger.general(
              "INFO",
              "Service worker wake-up detected - checking for cached data",
              { timestamp: (/* @__PURE__ */ new Date()).toISOString() }
            );
            const existingInit = getInitPromise();
            if (existingInit) {
              debugLogger.general(
                "INFO",
                "Initialization already in progress (likely from startup), awaiting completion",
                { source: "getSessionData" }
              );
              try {
                await existingInit;
                debugLogger.general(
                  "INFO",
                  "Awaited startup initialization successfully"
                );
              } catch (error) {
                debugLogger.general(
                  "ERROR",
                  "Startup initialization failed, popup will retry",
                  null,
                  error
                );
              }
            }
            if (!sessionCache.isAuthenticated) {
              await orchestrateInitialization("popup-open", connectWebSocket);
            }
          }
          const shouldFetchPushes = !isWakeUp && apiKey2 && (!sessionCache.recentPushes || sessionCache.recentPushes.length === 0);
          if (shouldFetchPushes) {
            debugLogger.general(
              "INFO",
              "Popup opened - fetching recent pushes on-demand"
            );
            const pushes = await fetchRecentPushes(apiKey2);
            sessionCache.recentPushes = pushes;
            sessionCache.lastUpdated = Date.now();
            debugLogger.general("INFO", "Recent pushes fetched on-demand", {
              count: pushes.length
            });
          } else if (!isWakeUp) {
            debugLogger.general("DEBUG", "Popup opened - using cached pushes", {
              count: sessionCache.recentPushes?.length ?? 0
            });
          }
          sendResponse(await buildSessionDataResponse(apiKey2));
          if (apiKey2) {
            void refreshPopupTargetsInBackground(apiKey2);
          }
        } catch (error) {
          debugLogger.general("ERROR", "Failed to handle GETSESSIONDATA", {
            error: error.message
          });
          sendResponse({
            isAuthenticated: false,
            userInfo: null,
            devices: [],
            recentPushes: [],
            chats: [],
            autoOpenLinks: false,
            deviceNickname: "",
            websocketConnected: false,
            state: stateMachine.getCurrentState()
          });
        }
      })();
      return true;
    } else if (message.action === "apiKeyChanged" /* API_KEY_CHANGED */) {
      setApiKey(message.apiKey);
      let savePromise = storageRepository.setApiKey(message.apiKey);
      if (message.deviceNickname) {
        savePromise = savePromise.then(() => {
          setDeviceNickname(message.deviceNickname);
          sessionCache.deviceNickname = message.deviceNickname;
          return storageRepository.setDeviceNickname(
            message.deviceNickname
          );
        });
      }
      savePromise.then(() => stateMachineReady).then(() => {
        return stateMachine.transition("API_KEY_SET", {
          apiKey: message.apiKey
        });
      }).then(() => {
        sendResponse({
          isAuthenticated: stateMachine.isInState("ready" /* READY */) || stateMachine.isInState("degraded" /* DEGRADED */),
          userInfo: sessionCache.userInfo,
          devices: sessionCache.devices,
          recentPushes: sessionCache.recentPushes,
          chats: sessionCache.chats || [],
          autoOpenLinks: sessionCache.autoOpenLinks,
          deviceNickname: sessionCache.deviceNickname,
          websocketConnected: websocketClient2 ? websocketClient2.isConnected() : false,
          state: stateMachine.getCurrentState()
        });
      }).catch((error) => {
        debugLogger.general("ERROR", "Error saving API key", null, error);
        sendResponse({ success: false, error: error.message });
      });
      return true;
    } else if (message.action === "logout" /* LOGOUT */) {
      stateMachineReady.then(() => {
        return stateMachine.transition("LOGOUT");
      }).then(() => {
        return storageRepository.setApiKey(null);
      }).then(() => {
        return storageRepository.setDeviceIden(null);
      }).then(() => {
        return clearSessionCache();
      }).then(() => {
        performanceMonitor.reset();
      }).then(() => {
        sendResponse({ success: true });
      }).catch((error) => {
        debugLogger.general("ERROR", "Error during logout", null, error);
        sendResponse({ success: false, error: error.message });
      });
      return true;
    } else if (message.action === "refreshSession" /* REFRESH_SESSION */) {
      (async () => {
        await ensureDebugConfigLoadedOnce();
        await hydrateBackgroundConfig();
        const apiKey2 = getApiKey();
        if (apiKey2) {
          refreshSessionCache(apiKey2).then(() => {
            sendResponse({
              isAuthenticated: true,
              userInfo: sessionCache.userInfo,
              devices: sessionCache.devices,
              recentPushes: sessionCache.recentPushes,
              chats: sessionCache.chats || [],
              autoOpenLinks: sessionCache.autoOpenLinks,
              deviceNickname: sessionCache.deviceNickname,
              state: stateMachine.getCurrentState()
            });
          }).catch((error) => {
            debugLogger.general(
              "ERROR",
              "Error refreshing session",
              null,
              error
            );
            sendResponse({ isAuthenticated: false });
          });
        } else {
          sendResponse({ isAuthenticated: false });
        }
      })();
      return true;
    } else if (message.action === "settingsChanged" /* SETTINGS_CHANGED */) {
      const promises = [];
      const settings = message.settings ?? message;
      if (settings.deviceNickname) {
        const newNickname = settings.deviceNickname;
        const apiKey2 = getApiKey();
        const deviceIden2 = getDeviceIden();
        if (apiKey2 && deviceIden2) {
          promises.push(
            updateDeviceNickname(apiKey2, deviceIden2, newNickname).then(() => {
              setDeviceNickname(newNickname);
              sessionCache.deviceNickname = newNickname;
              return storageRepository.setDeviceNickname(newNickname);
            })
          );
        } else {
          setDeviceNickname(newNickname);
          sessionCache.deviceNickname = newNickname;
          promises.push(storageRepository.setDeviceNickname(newNickname));
        }
      }
      if (settings.autoOpenLinks !== void 0) {
        setAutoOpenLinks(settings.autoOpenLinks);
        sessionCache.autoOpenLinks = settings.autoOpenLinks;
        promises.push(storageRepository.setAutoOpenLinks(settings.autoOpenLinks));
      }
      if (settings.notificationTimeout !== void 0) {
        setNotificationTimeout(settings.notificationTimeout);
        promises.push(
          storageRepository.setNotificationTimeout(settings.notificationTimeout)
        );
      }
      if (settings.onlyThisDevice !== void 0) {
        sessionCache.onlyThisDevice = settings.onlyThisDevice;
        promises.push(storageRepository.setOnlyThisDevice(settings.onlyThisDevice));
      }
      Promise.all(promises).then(() => {
        sendResponse({ success: true });
      }).catch((error) => {
        debugLogger.general("ERROR", "Error saving settings", null, error);
        sendResponse({ success: false, error: error.message });
      });
      return true;
    } else if (message.action === "updateDeviceNickname" /* UPDATE_DEVICE_NICKNAME */) {
      (async () => {
        await ensureDebugConfigLoadedOnce();
        await hydrateBackgroundConfig();
        const apiKey2 = getApiKey();
        const deviceIden2 = getDeviceIden();
        if (apiKey2 && deviceIden2 && message.nickname) {
          updateDeviceNickname(apiKey2, deviceIden2, message.nickname).then(async () => {
            setDeviceNickname(message.nickname);
            sessionCache.deviceNickname = message.nickname;
            await storageRepository.setDeviceNickname(message.nickname);
            sendResponse({ success: true });
          }).catch((error) => {
            debugLogger.general(
              "ERROR",
              "Error updating device nickname",
              null,
              error
            );
            sendResponse({ success: false, error: error.message });
          });
        } else {
          sendResponse({ success: false, error: "Missing required parameters" });
        }
      })();
      return true;
    } else if (message.action === "getDebugSummary" /* GET_DEBUG_SUMMARY */) {
      (async () => {
        await stateMachineReady;
        const logData = debugLogger.exportLogs();
        const wsState = wsStateMonitor.getStateReport();
        const perfData = performanceMonitor.exportPerformanceData();
        const perfSummary = perfData.summary;
        const websocketState = {
          current: {
            stateText: websocketClient2 ? websocketClient2.isConnected() ? "Connected" : "Disconnected" : "Not initialized",
            readyState: wsState.currentState,
            stateMachineState: stateMachine.getCurrentState(),
            stateMachineDescription: stateMachine.getStateDescription()
          },
          lastCheck: wsState.lastCheck,
          historyLength: wsState.historyLength
        };
        const performanceForDashboard = {
          websocket: perfSummary.websocket,
          qualityMetrics: {
            // Map health checks
            healthChecksPassed: perfSummary.health?.success || 0,
            healthChecksFailed: perfSummary.health?.failure || 0,
            // Map quality metrics
            disconnectionCount: perfSummary.quality?.disconnections || 0,
            consecutiveFailures: perfSummary.quality?.consecutiveFailures || 0,
            // These metrics don't exist in the backend yet, so they'll be undefined
            averageLatency: void 0,
            minLatency: void 0,
            maxLatency: void 0,
            connectionUptime: 0,
            currentUptime: 0
          },
          notifications: perfSummary.notifications
        };
        const lifecycleMetrics = await chrome.storage.local.get([
          "restarts",
          "recoveryTimings"
        ]);
        const restarts = typeof lifecycleMetrics.restarts === "number" ? lifecycleMetrics.restarts : 0;
        const recoveryTimings = Array.isArray(lifecycleMetrics.recoveryTimings) ? lifecycleMetrics.recoveryTimings.filter(
          (value) => typeof value === "number"
        ) : [];
        const avgRecoveryTime = recoveryTimings.length > 0 ? recoveryTimings.reduce((a, b) => a + b, 0) / recoveryTimings.length : 0;
        const mv3LifecycleStats = {
          restarts,
          wakeUpTriggers: initTracker.exportData().stats,
          // We already track this!
          avgRecoveryTime: avgRecoveryTime.toFixed(0) + " ms"
          // Add more stats like downtime here in the future
        };
        const summary = {
          config: debugConfigManager.getConfig(),
          logs: logData.logs,
          // Array of log entries
          totalLogs: logData.summary.totalLogs,
          performance: performanceForDashboard,
          websocketState,
          initializationStats: initTracker.exportData(),
          mv3LifecycleStats,
          // Add the new data object
          errors: {
            total: logData.summary.errors,
            last24h: logData.summary.errors,
            // Add last24h for dashboard
            critical: []
          }
        };
        sendResponse({ success: true, summary });
      })();
      return true;
    } else if (message.action === "clearAllLogs" /* CLEAR_ALL_LOGS */) {
      debugLogger.clearLogs().then(() => {
        sendResponse({ success: true });
      });
      return true;
    } else if (message.action === "updateDebugConfig" /* UPDATE_DEBUG_CONFIG */) {
      if (message.config) {
        debugConfigManager.updateConfig(message.config).then(() => {
          sendResponse({ success: true });
        }).catch((error) => {
          debugLogger.general(
            "ERROR",
            "Failed to update debug config",
            null,
            error
          );
          sendResponse({ success: false, error: error.message });
        });
      } else {
        sendResponse({ success: false, error: "No config provided" });
      }
      return true;
    } else if (message.action === "exportDebugData" /* EXPORT_DEBUG_DATA */) {
      debugLogger.general("INFO", "Exporting full debug data");
      (async () => {
        await ensureDebugConfigLoadedOnce();
        await stateMachineReady;
        const logData = debugLogger.exportLogs();
        const errorSummary = globalErrorTracker.getErrorSummary();
        const dataToExport = {
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          version: chrome.runtime.getManifest().version,
          debugLogs: logData,
          performanceData: performanceMonitor.exportPerformanceData(),
          systemInfo: {
            websocketState: wsStateMonitor.getStateReport(),
            initializationData: initTracker.exportData(),
            stateMachine: {
              currentState: stateMachine.getCurrentState(),
              description: stateMachine.getStateDescription()
            }
          },
          errorData: {
            summary: errorSummary,
            recent: globalErrorTracker.exportErrorData().errors
          },
          sessionCache: {
            isAuthenticated: sessionCache.isAuthenticated,
            lastUpdated: sessionCache.lastUpdated ? new Date(sessionCache.lastUpdated).toISOString() : "never",
            userInfo: sessionCache.userInfo ? { email: sessionCache.userInfo.email?.substring(0, 3) + "***" } : null,
            deviceCount: sessionCache.devices?.length || 0,
            pushCount: sessionCache.recentPushes?.length || 0
          }
        };
        sendResponse({ success: true, data: dataToExport });
      })();
      return true;
    } else if (message.action === "getNotificationData" /* GET_NOTIFICATION_DATA */) {
      const pushData = notificationDataStore.get(message.notificationId);
      if (pushData) {
        sendResponse({ success: true, push: pushData });
      } else {
        sendResponse({ success: false, error: "Notification not found" });
      }
      return false;
    } else if (message.action === "attemptReconnect" /* ATTEMPT_RECONNECT */) {
      debugLogger.general("INFO", "Manual reconnection requested from popup");
      (async () => {
        await reconcileWake("manual-attemptReconnect");
        sendResponse({ success: true });
      })();
      return true;
    } else if (message.action === "uploadAndSendFile" /* UPLOAD_AND_SEND_FILE */) {
      (async () => {
        try {
          await ensureDebugConfigLoadedOnce();
          await hydrateBackgroundConfig();
          const apiKey2 = getApiKey();
          if (!apiKey2) {
            sendResponse({
              success: false,
              error: buildUploadError(
                "not_authenticated",
                "metadata",
                "Not logged in. Please try again."
              )
            });
            return;
          }
          const uploadMessage = message;
          const { fileName, fileType, fileBytes } = validateUploadMetadata(
            uploadMessage,
            sessionCache.userInfo?.max_upload_size
          );
          const uploadData = await requestFileUpload(apiKey2, fileName, fileType);
          await uploadFileToServer(
            uploadData,
            new Blob([toArrayBuffer(fileBytes)], { type: fileType })
          );
          await sendFilePush(apiKey2, {
            file_name: uploadData.file_name,
            file_type: uploadData.file_type,
            file_url: uploadData.file_url,
            body: uploadMessage.body?.trim() || void 0,
            device_iden: uploadMessage.device_iden,
            email: uploadMessage.email,
            source_device_iden: uploadMessage.source_device_iden
          });
          try {
            await refreshPushes(notificationDataStore);
          } catch (error) {
            if (error.name === "InvalidCursorError") {
              debugLogger.general(
                "WARN",
                "Caught invalid cursor error during file push send - triggering recovery"
              );
              await handleInvalidCursorRecovery(apiKey2, connectWebSocket);
            } else {
              debugLogger.general(
                "ERROR",
                "Error refreshing pushes after file send",
                null,
                error
              );
            }
          }
          sendResponse({ success: true });
        } catch (error) {
          const structuredError = toStructuredUploadError(error);
          debugLogger.general(
            "ERROR",
            "Failed to upload and send file",
            {
              code: structuredError.code,
              stage: structuredError.stage,
              status: structuredError.status
            },
            error instanceof Error ? error : void 0
          );
          sendResponse({ success: false, error: structuredError });
        }
      })();
      return true;
    } else if (message.action === "sendPush" /* SEND_PUSH */) {
      (async () => {
        try {
          await ensureDebugConfigLoadedOnce();
          await hydrateBackgroundConfig();
          const apiKey2 = getApiKey();
          if (!apiKey2) {
            sendResponse({
              success: false,
              error: "Not logged in. Please try again."
            });
            return;
          }
          const pushData = message.pushData;
          if (!pushData || !pushData.type) {
            sendResponse({ success: false, error: "Invalid push data" });
            return;
          }
          await sendPush(apiKey2, pushData);
          try {
            await refreshPushes(notificationDataStore);
          } catch (error) {
            if (error.name === "InvalidCursorError") {
              debugLogger.general(
                "WARN",
                "Caught invalid cursor error during push send - triggering recovery"
              );
              const apiKey3 = getApiKey();
              if (apiKey3) {
                await handleInvalidCursorRecovery(apiKey3, connectWebSocket);
              }
            } else {
              debugLogger.general(
                "ERROR",
                "Error refreshing pushes after send",
                null,
                error
              );
            }
          }
          sendResponse({ success: true });
        } catch (error) {
          debugLogger.general(
            "ERROR",
            "Failed to send push",
            { pushType: message.pushData?.type },
            error
          );
          sendResponse({ success: false, error: error.message });
        }
      })();
      return true;
    }
    return false;
  });
  chrome.notifications.onClicked.addListener((notificationId) => {
    debugLogger.notifications("INFO", "Notification clicked", {
      notificationId
    });
    const push = notificationDataStore.get(notificationId);
    if (!push) {
      debugLogger.notifications(
        "WARN",
        "No push data found for clicked notification",
        {
          notificationId
        }
      );
      return;
    }
    const detailUrl = chrome.runtime.getURL(
      `notification-detail.html?id=${encodeURIComponent(notificationId)}`
    );
    chrome.windows.create(
      {
        url: detailUrl,
        type: "popup",
        width: 500,
        height: 600,
        focused: true
      },
      (window) => {
        if (chrome.runtime.lastError) {
          debugLogger.notifications(
            "ERROR",
            "Failed to open notification detail",
            {
              notificationId,
              error: chrome.runtime.lastError.message
            }
          );
        } else {
          debugLogger.notifications(
            "INFO",
            "Notification detail opened in popup",
            {
              notificationId,
              windowId: window?.id
            }
          );
        }
      }
    );
    chrome.notifications.clear(notificationId);
  });
  debugLogger.general("INFO", "Background service worker initialized", {
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  });
  chrome.runtime.onStartup.addListener(async () => {
    await ensureDebugConfigLoadedOnce();
    await ensureLongSleepRecoveryAlarm();
    void bootstrap("startup");
    setTimeout(checkExtensionHealth, 5e3);
  });
  chrome.runtime.onInstalled.addListener(async () => {
    await ensureDebugConfigLoadedOnce();
    await ensureLongSleepRecoveryAlarm();
    void bootstrap("install");
  });
  async function checkExtensionHealth() {
    const apiKey2 = getApiKey();
    const currentState = stateMachine.getCurrentState();
    const isConnected = websocketClient2?.isConnected() ?? false;
    debugLogger.general(
      "INFO",
      "[Diagnostic] Extension health check",
      {
        hasApiKey: !!apiKey2,
        currentState,
        isConnected,
        hasWebSocketClient: !!websocketClient2,
        sessionAuthenticated: sessionCache.isAuthenticated,
        lastUpdated: sessionCache.lastUpdated ? new Date(sessionCache.lastUpdated).toISOString() : "never"
      }
    );
    if (apiKey2 && currentState === "idle" /* IDLE */ && !isConnected) {
      debugLogger.general(
        "ERROR",
        "[Diagnostic] INCONSISTENT STATE DETECTED: Have API key but in IDLE state without connection"
      );
      return;
    }
    if (!apiKey2 && currentState !== "idle" /* IDLE */) {
      debugLogger.general(
        "ERROR",
        "[Diagnostic] INCONSISTENT STATE DETECTED: No API key but not in IDLE state"
      );
      return;
    }
    debugLogger.general(
      "INFO",
      "[Diagnostic] Extension state is consistent"
    );
  }
})();
//# sourceMappingURL=background.js.map
