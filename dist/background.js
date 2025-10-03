"use strict";
(() => {
  // src/lib/logging/index.ts
  var STORAGE_KEY = "persistentDebugLogs";
  var MAX_PERSISTENT_LOGS = 5e3;
  var DEBUG_CONFIG = {
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
  var DebugLogger = class {
    logs = [];
    startTime = Date.now();
    performanceMarkers = /* @__PURE__ */ new Map();
    /**
     * Rehydrate logs from persistent storage on startup
     * This method loads logs from the previous session
     */
    async rehydrate() {
      try {
        const result = await chrome.storage.local.get(STORAGE_KEY);
        if (result[STORAGE_KEY] && Array.isArray(result[STORAGE_KEY])) {
          this.logs = result[STORAGE_KEY];
          console.log(
            `[Logger] Rehydrated ${this.logs.length} logs from persistent storage.`
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
    sanitize(data) {
      if (!DEBUG_CONFIG.sanitizeData) return data;
      if (typeof data === "string") {
        if (data.length > 20 && /^[a-zA-Z0-9_-]+$/.test(data)) {
          return data.substring(0, 4) + "***" + data.substring(data.length - 4);
        }
        return data;
      }
      if (data && typeof data === "object") {
        const sanitized = Array.isArray(data) ? [] : {};
        for (const key in data) {
          if (key.toLowerCase().includes("token") || key.toLowerCase().includes("key") || key.toLowerCase().includes("password")) {
            sanitized[key] = this.sanitize(data[key]);
          } else {
            sanitized[key] = data[key];
          }
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
            console.error("  Data:", sanitized);
            console.error("  Error:", error);
          } else if (sanitized) {
            console.error(full);
            console.error("  Data:", sanitized);
          } else if (error) {
            console.error(full);
            console.error("  Error:", error);
          } else {
            console.error(full);
          }
          break;
        case "WARN":
          if (sanitized) {
            console.warn(full);
            console.warn("  Data:", sanitized);
          } else {
            console.warn(full);
          }
          break;
        case "INFO":
          if (sanitized) {
            console.info(full);
            console.info("  Data:", sanitized);
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
        const result = await new Promise((resolve) => {
          chrome.storage.local.get(["debugConfig"], (items) => resolve(items));
        });
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
        await new Promise((resolve) => {
          chrome.storage.local.set(
            { debugConfig: DEBUG_CONFIG },
            () => resolve(null)
          );
        });
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
    updateConfig(updates) {
      Object.assign(DEBUG_CONFIG, updates);
      void this.saveConfig();
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
  void debugConfigManager.loadConfig();
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
      const count = (this.errorCounts.get(category) || 0) + 1;
      this.errorCounts.set(category, count);
      if (count >= 5) this.criticalErrors.push(entry);
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
  } catch (_) {
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
  } catch (_) {
  }

  // src/lib/perf/index.ts
  var PerformanceMonitor = class {
    metrics = /* @__PURE__ */ new Map();
    notificationTimeline = [];
    websocketMetrics = { connectionAttempts: 0, successfulConnections: 0, messagesReceived: 0, messagesProcessed: 0, reconnectionAttempts: 0, lastConnectionTime: null, totalDowntime: 0 };
    notificationMetrics = { pushesReceived: 0, notificationsCreated: 0, notificationsFailed: 0, unknownTypes: 0 };
    healthChecks = { success: 0, failure: 0, lastCheck: null };
    quality = { disconnections: 0, permanentErrors: 0, consecutiveFailures: 0 };
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
    getPerformanceSummary() {
      return { websocket: this.websocketMetrics, health: this.healthChecks, quality: this.quality, notifications: this.notificationMetrics, metrics: Object.fromEntries(this.metrics) };
    }
    getQualityMetrics() {
      return this.quality;
    }
    exportPerformanceData() {
      return { summary: this.getPerformanceSummary(), timeline: this.notificationTimeline.slice(-200) };
    }
  };
  var performanceMonitor = new PerformanceMonitor();

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
  var WebSocketStateMonitor = class {
    stateHistory = [];
    lastStateCheck = Date.now();
    monitoringInterval = null;
    alertThresholds = { slowReceive: 15e3 };
    recordStateChange(newState) {
      const now = Date.now();
      const prev = this.stateHistory[this.stateHistory.length - 1];
      const duration = prev ? now - prev.timestamp : 0;
      this.stateHistory.push({ timestamp: now, state: newState, duration });
      if (this.stateHistory.length > 200) this.stateHistory.shift();
    }
    getStateReport() {
      const currentState = globalThis.websocket && typeof globalThis.websocket.readyState === "number" ? ["CONNECTING", "OPEN", "CLOSING", "CLOSED"][globalThis.websocket.readyState] : "NULL";
      return { currentState, lastCheck: new Date(this.lastStateCheck).toISOString(), historyLength: this.stateHistory.length };
    }
    startMonitoring() {
      if (this.monitoringInterval) return;
      this.monitoringInterval = setInterval(() => {
        this.lastStateCheck = Date.now();
        const state = globalThis.websocket ? globalThis.websocket.readyState : null;
        try {
          globalThis.debugLogger?.websocket("DEBUG", "WebSocket state check", { state });
        } catch (_) {
        }
      }, 3e4);
    }
    stopMonitoring() {
      if (this.monitoringInterval) {
        clearInterval(this.monitoringInterval);
        this.monitoringInterval = null;
      }
    }
  };
  var wsStateMonitor = new WebSocketStateMonitor();

  // src/app/notifications/index.ts
  function createNotificationWithTimeout(notificationId, options, callback, timeoutMs) {
    const iconUrl = chrome.runtime.getURL("icons/icon128.png");
    const safeOptions = {
      type: "basic",
      iconUrl,
      // Use absolute URL
      title: options.title || "Pushbullet",
      message: options.message || "",
      priority: options.priority || 1
    };
    debugLogger.notifications("DEBUG", "Creating notification with safe options", {
      notificationId,
      iconUrl,
      title: safeOptions.title,
      messageLength: safeOptions.message?.length || 0
    });
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
        debugLogger.notifications("ERROR", "Failed to set notification timeout", {
          error: error.message
        }, error);
      }
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
    } catch (_) {
    }
  }
  function clearErrorBadge() {
    try {
      chrome.action.setBadgeText({ text: "" });
    } catch (_) {
    }
  }

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

  // src/app/ws/client.ts
  var WebSocketClient = class {
    constructor(websocketUrl, getApiKey2) {
      this.websocketUrl = websocketUrl;
      this.getApiKey = getApiKey2;
    }
    socket = null;
    reconnectAttempts = 0;
    reconnectTimeout = null;
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
      return this.socket ? this.socket.readyState : null;
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
        debugLogger.websocket("INFO", "Connecting to WebSocket", { url: this.websocketUrl + "***" });
        this.reconnectAttempts = 0;
        this.socket = new WebSocket(url);
        this.socket.onopen = () => {
          debugLogger.websocket("INFO", "WebSocket connection established", { timestamp: (/* @__PURE__ */ new Date()).toISOString() });
          performanceMonitor.recordWebSocketConnection(true);
          wsStateMonitor.startMonitoring();
          globalEventBus.emit("websocket:polling:stop");
          try {
            clearErrorBadge();
          } catch (_) {
          }
          chrome.alarms.clear("websocketReconnect", () => {
          });
          if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
          }
          globalEventBus.emit("websocket:connected");
          globalEventBus.emit("websocket:state", "connected");
        };
        this.socket.onmessage = async (event) => {
          try {
            const data = JSON.parse(event.data);
            debugLogger.websocket("DEBUG", "WebSocket message received", {
              type: data.type,
              subtype: "subtype" in data ? data.subtype : void 0,
              hasPush: "push" in data ? !!data.push : false
            });
            switch (data.type) {
              case "tickle":
                if (data.subtype === "push") {
                  globalEventBus.emit("websocket:tickle:push");
                } else if (data.subtype === "device") {
                  globalEventBus.emit("websocket:tickle:device");
                }
                break;
              case "push":
                if ("push" in data && data.push) {
                  globalEventBus.emit("websocket:push", data.push);
                } else {
                  debugLogger.websocket("WARN", "Push message received without push payload");
                }
                break;
              case "nop":
                debugLogger.websocket("DEBUG", "Received nop (keep-alive) message", {
                  timestamp: (/* @__PURE__ */ new Date()).toISOString()
                });
                break;
              case "ping":
                debugLogger.websocket("DEBUG", "Received ping (keep-alive) message", {
                  timestamp: (/* @__PURE__ */ new Date()).toISOString()
                });
                break;
              case "pong":
                debugLogger.websocket("DEBUG", "Received pong (keep-alive) message", {
                  timestamp: (/* @__PURE__ */ new Date()).toISOString()
                });
                break;
              default:
                debugLogger.websocket("WARN", "Unknown WebSocket message type received", {
                  type: data.type
                });
                break;
            }
          } catch (error) {
            debugLogger.websocket("ERROR", "Failed to process WebSocket message", null, error);
          }
        };
        this.socket.onerror = (error) => {
          debugLogger.websocket("ERROR", "WebSocket error occurred", {
            error: error.message || "Unknown error",
            readyState: this.socket ? this.socket.readyState : "null"
          }, error);
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
          globalEventBus.emit("websocket:disconnected", {
            code: event.code,
            reason: event.reason,
            wasClean: event.wasClean
          });
          globalEventBus.emit("websocket:state", "disconnected");
          if (event.code === 1008 || event.code === 4001 || event.code >= 4e3 && event.code < 5e3) {
            debugLogger.websocket("ERROR", "Permanent WebSocket error - stopping reconnection attempts", closeInfo);
            try {
              showPermanentWebSocketError(closeInfo);
            } catch (_) {
            }
            return;
          }
          this.reconnectAttempts++;
          performanceMonitor.recordWebSocketReconnection();
          debugLogger.websocket("INFO", "Scheduling WebSocket reconnection (30s one-shot)", {
            attempt: this.reconnectAttempts,
            nextAttemptAt: new Date(Date.now() + 3e4).toISOString()
          });
          chrome.alarms.create("websocketReconnect", { when: Date.now() + 3e4 });
        };
      } catch (error) {
        debugLogger.websocket("ERROR", "Failed to create WebSocket connection", {
          url: this.websocketUrl + "***",
          hasApiKey: !!this.getApiKey()
        }, error);
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
          debugLogger.websocket("ERROR", "Error disconnecting WebSocket", null, error);
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
  };

  // src/app/api/client.ts
  var API_BASE_URL = "https://api.pushbullet.com/v2";
  var PUSHES_URL = `${API_BASE_URL}/pushes`;
  var DEVICES_URL = `${API_BASE_URL}/devices`;
  var USER_INFO_URL = `${API_BASE_URL}/users/me`;
  function authHeaders(apiKey2) {
    return { "Access-Token": apiKey2 };
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
      const response = await fetch(DEVICES_URL, { headers: authHeaders(apiKey2) });
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
      const activeDevices = data.devices.filter((device) => device.active);
      debugLogger.api("INFO", "Devices fetched successfully", {
        url: DEVICES_URL,
        status: response.status,
        duration: `${duration}ms`,
        totalDevices: data.devices.length,
        activeDevices: activeDevices.length
      });
      return activeDevices;
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
  async function fetchRecentPushes(apiKey2) {
    const startTime = Date.now();
    const url = `${PUSHES_URL}?limit=20`;
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
        const hasContent = "title" in push && push.title || "body" in push && push.body || "url" in push && push.url;
        return hasContent && !push.dismissed;
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
  async function registerDevice(apiKey2, deviceIden2, deviceNickname2) {
    debugLogger.general("INFO", "Starting device registration process", {
      hasApiKey: !!apiKey2,
      currentDeviceIden: deviceIden2,
      deviceNickname: deviceNickname2,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
    const result = await new Promise((resolve) => {
      chrome.storage.local.get(["deviceRegistrationInProgress"], (items) => resolve(items));
    });
    if (result.deviceRegistrationInProgress) {
      debugLogger.general("INFO", "Device registration already in progress - waiting for completion");
      return new Promise((resolve) => {
        const listener = (changes) => {
          if (changes.deviceRegistrationInProgress && !changes.deviceRegistrationInProgress.newValue) {
            chrome.storage.onChanged.removeListener(listener);
            debugLogger.general("INFO", "Device registration completed by another process");
            resolve({ deviceIden: deviceIden2 || "", needsUpdate: false });
          }
        };
        chrome.storage.onChanged.addListener(listener);
      });
    }
    try {
      await chrome.storage.local.set({ deviceRegistrationInProgress: true });
      const storageResult = await new Promise((resolve) => {
        chrome.storage.local.get(["deviceIden"], (items) => resolve(items));
      });
      if (storageResult.deviceIden) {
        const existingIden = storageResult.deviceIden;
        debugLogger.general("INFO", "Device already registered", { deviceIden: existingIden, deviceNickname: deviceNickname2 });
        try {
          await updateDeviceNickname(apiKey2, existingIden, deviceNickname2);
          await chrome.storage.local.set({ deviceRegistrationInProgress: false });
          return { deviceIden: existingIden, needsUpdate: false };
        } catch (error) {
          debugLogger.general("WARN", "Failed to update existing device, will re-register", {
            error: error.message,
            deviceIden: existingIden
          });
          await chrome.storage.local.remove(["deviceIden"]);
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
        await chrome.storage.local.set({ deviceRegistrationInProgress: false });
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
      await chrome.storage.local.set({ deviceIden: newDeviceIden });
      await chrome.storage.local.set({ deviceRegistrationInProgress: false });
      debugLogger.general("INFO", "Device registration completed", {
        deviceIden: newDeviceIden,
        deviceNickname: device.nickname
      });
      return { deviceIden: newDeviceIden, needsUpdate: false };
    } catch (error) {
      await chrome.storage.local.set({ deviceRegistrationInProgress: false });
      debugLogger.general("ERROR", "Error in registerDevice function", {
        errorMessage: error.message,
        errorStack: error.stack
      });
      throw error;
    }
  }
  async function updateDeviceNickname(apiKey2, deviceIden2, newNickname) {
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

  // src/infrastructure/storage/storage.repository.ts
  var ChromeStorageRepository = class {
    /**
     * Get API Key from local storage
     * Security: API keys are stored in local storage (not synced) to prevent
     * exposure through Chrome's sync infrastructure
     */
    async getApiKey() {
      const result = await chrome.storage.local.get(["apiKey"]);
      return result.apiKey || null;
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
      return result.deviceIden || null;
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
     * Get Device Nickname from sync storage
     */
    async getDeviceNickname() {
      const result = await chrome.storage.sync.get(["deviceNickname"]);
      return result.deviceNickname || null;
    }
    /**
     * Set Device Nickname in sync storage
     */
    async setDeviceNickname(nickname) {
      await chrome.storage.sync.set({ deviceNickname: nickname });
    }
    /**
     * Get Auto Open Links setting from sync storage
     */
    async getAutoOpenLinks() {
      const result = await chrome.storage.sync.get(["autoOpenLinks"]);
      return result.autoOpenLinks !== void 0 ? result.autoOpenLinks : false;
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
      return result.notificationTimeout !== void 0 ? result.notificationTimeout : 5e3;
    }
    /**
     * Set Notification Timeout in sync storage
     */
    async setNotificationTimeout(timeout) {
      await chrome.storage.sync.set({ notificationTimeout: timeout });
    }
    /**
     * Get Encryption Password from local storage
     */
    async getEncryptionPassword() {
      const result = await chrome.storage.local.get(["encryptionPassword"]);
      return result.encryptionPassword || null;
    }
    /**
     * Set Encryption Password in local storage
     */
    async setEncryptionPassword(password) {
      if (password === null) {
        await chrome.storage.local.remove(["encryptionPassword"]);
      } else {
        await chrome.storage.local.set({ encryptionPassword: password });
      }
    }
    /**
     * Get Scroll to Recent Pushes flag from local storage
     */
    async getScrollToRecentPushes() {
      const result = await chrome.storage.local.get(["scrollToRecentPushes"]);
      return result.scrollToRecentPushes || false;
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
     * Clear all storage (both sync and local)
     */
    async clear() {
      await Promise.all([
        chrome.storage.sync.clear(),
        chrome.storage.local.clear()
      ]);
    }
    /**
     * Remove specific keys from storage
     * Removes from both sync and local storage
     */
    async remove(keys) {
      await Promise.all([
        chrome.storage.sync.remove(keys),
        chrome.storage.local.remove(keys)
      ]);
    }
  };
  var storageRepository = new ChromeStorageRepository();

  // src/app/session/index.ts
  var sessionCache = {
    userInfo: null,
    devices: [],
    recentPushes: [],
    isAuthenticated: false,
    lastUpdated: 0,
    autoOpenLinks: true,
    deviceNickname: "Chrome"
  };
  var initializationState = {
    inProgress: false,
    completed: false,
    error: null,
    timestamp: null
  };
  var initPromise = null;
  function getInitPromise() {
    return initPromise;
  }
  async function initializeSessionCache(source = "unknown", connectWebSocketFn, stateSetters) {
    if (initializationState.inProgress && initPromise) {
      debugLogger.general("INFO", "Initialization already in progress, returning existing promise", {
        source,
        existingInitialization: true
      });
      return initPromise;
    }
    if (initializationState.completed) {
      debugLogger.general("WARN", "Already initialized, skipping", {
        source,
        previousTimestamp: initializationState.timestamp
      });
      return null;
    }
    initializationState.inProgress = true;
    initPromise = (async () => {
      try {
        debugLogger.general("INFO", "Initializing session cache", {
          source,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        });
        debugLogger.storage("DEBUG", "Loading initial configuration from storage repository");
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
        debugLogger.storage("INFO", "Loaded configuration from storage repository", {
          hasApiKey: !!apiKeyValue,
          hasDeviceIden: !!deviceIdenValue,
          autoOpenLinks: autoOpenLinksValue,
          deviceNickname: deviceNicknameValue,
          notificationTimeout: notificationTimeoutValue
        });
        debugLogger.general("DEBUG", "API key status", {
          hasApiKey: !!apiKeyValue,
          apiKeyLength: apiKeyValue ? apiKeyValue.length : 0
        });
        if (apiKeyValue) {
          debugLogger.general("INFO", "API key available - initializing session data");
          const userInfo = await fetchUserInfo(apiKeyValue);
          sessionCache.userInfo = userInfo;
          const devices = await fetchDevices(apiKeyValue);
          sessionCache.devices = devices;
          const pushes = await fetchRecentPushes(apiKeyValue);
          sessionCache.recentPushes = pushes;
          sessionCache.isAuthenticated = true;
          sessionCache.lastUpdated = Date.now();
          debugLogger.general("INFO", "Session cache populated successfully", {
            hasUserInfo: !!sessionCache.userInfo,
            deviceCount: sessionCache.devices.length,
            pushCount: sessionCache.recentPushes.length,
            lastUpdated: new Date(sessionCache.lastUpdated).toISOString()
          });
          await registerDevice(apiKeyValue, deviceIdenValue, deviceNicknameValue);
          chrome.alarms.create("websocketHealthCheck", { periodInMinutes: 5 });
          debugLogger.general("DEBUG", "WebSocket health check alarm created", { interval: "5 minutes" });
        } else {
          debugLogger.general("WARN", "No API key available - session cache not initialized");
        }
        initializationState.completed = true;
        initializationState.timestamp = Date.now();
        debugLogger.general("INFO", "Initialization completed successfully", {
          source,
          timestamp: new Date(initializationState.timestamp).toISOString()
        });
        return apiKeyValue;
      } catch (error) {
        initializationState.error = error;
        debugLogger.general("ERROR", "Error initializing session cache", {
          error: error.message || error.name || "Unknown error"
        }, error);
        sessionCache.isAuthenticated = false;
        throw error;
      } finally {
        initializationState.inProgress = false;
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
        debugLogger.general("DEBUG", "API key available - refreshing session data");
        debugLogger.general("DEBUG", "Refreshing user info");
        const userInfo = await fetchUserInfo(apiKeyParam);
        sessionCache.userInfo = userInfo;
        debugLogger.general("DEBUG", "Refreshing devices");
        const devices = await fetchDevices(apiKeyParam);
        sessionCache.devices = devices;
        debugLogger.general("DEBUG", "Refreshing recent pushes");
        const pushes = await fetchRecentPushes(apiKeyParam);
        sessionCache.recentPushes = pushes;
        sessionCache.isAuthenticated = true;
        sessionCache.lastUpdated = Date.now();
        debugLogger.general("INFO", "Session cache refreshed successfully", {
          hasUserInfo: !!sessionCache.userInfo,
          deviceCount: sessionCache.devices.length,
          pushCount: sessionCache.recentPushes.length,
          lastUpdated: new Date(sessionCache.lastUpdated).toISOString()
        });
      } else {
        debugLogger.general("WARN", "No API key available - cannot refresh session cache");
        sessionCache.isAuthenticated = false;
      }
    } catch (error) {
      debugLogger.general("ERROR", "Error refreshing session cache", {
        error: error.message
      }, error);
      throw error;
    }
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
        } catch (err) {
        }
      }
      if (needsDeviceIden) {
        try {
          const deviceIden2 = await storageRepository.getDeviceIden();
          if (deviceIden2) {
            stateSetters.setDeviceIden(deviceIden2);
          }
        } catch (err) {
        }
      }
      if (needsNickname) {
        try {
          const deviceNickname2 = await storageRepository.getDeviceNickname();
          if (deviceNickname2 !== null && deviceNickname2 !== void 0) {
            stateSetters.setDeviceNickname(deviceNickname2);
          }
        } catch (err) {
        }
      }
      if (needsAutoOpen) {
        try {
          const autoOpenLinks2 = await storageRepository.getAutoOpenLinks();
          if (autoOpenLinks2 !== null && autoOpenLinks2 !== void 0) {
            stateSetters.setAutoOpenLinks(autoOpenLinks2);
          }
        } catch (err) {
        }
      }
      if (needsTimeout) {
        try {
          const notificationTimeout2 = await storageRepository.getNotificationTimeout();
          if (notificationTimeout2 !== null && notificationTimeout2 !== void 0) {
            stateSetters.setNotificationTimeout(notificationTimeout2);
          }
        } catch (err) {
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
      } catch (err) {
      }
    } catch (e) {
      try {
        debugLogger.storage("WARN", "ensureConfigLoaded encountered an error", {
          error: e && e.message
        });
      } catch (err) {
      }
    }
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
      } catch (error) {
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

  // src/background/utils.ts
  var notificationCounter = 0;
  var isSettingUpContextMenu = false;
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
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return "";
      }
      return parsed.href;
    } catch {
      return "";
    }
  }
  function updateExtensionTooltip(stateDescription) {
    try {
      chrome.action.setTitle({ title: stateDescription });
      debugLogger.general("DEBUG", "Updated extension tooltip", { stateDescription });
    } catch (error) {
      debugLogger.general("ERROR", "Exception setting tooltip", {
        stateDescription,
        error: error.message
      }, error);
    }
  }
  function updateConnectionIcon(status) {
    try {
      const badgeText = status === "connected" ? "\u25CF" : status === "connecting" ? "\u25D0" : "\u25CB";
      const badgeColor = status === "connected" ? "#4CAF50" : (
        // Green
        status === "connecting" ? "#FFC107" : (
          // Yellow
          "#F44336"
        )
      );
      chrome.action.setBadgeText({ text: badgeText });
      chrome.action.setBadgeBackgroundColor({ color: badgeColor });
      debugLogger.general("DEBUG", "Updated connection status badge", { status, badgeText, badgeColor });
    } catch (error) {
      debugLogger.general("ERROR", "Exception setting badge", {
        status,
        error: error.message
      }, error);
    }
  }
  async function refreshPushes(notificationDataStore2) {
    const apiKey2 = getApiKey();
    if (!apiKey2) {
      debugLogger.general("WARN", "Cannot refresh pushes - no API key");
      return;
    }
    try {
      debugLogger.general("DEBUG", "Refreshing pushes from API");
      const oldPushIdens = new Set(sessionCache.recentPushes.map((p) => p.iden));
      const pushes = await fetchRecentPushes(apiKey2);
      const newPushes = pushes.filter((p) => !oldPushIdens.has(p.iden));
      debugLogger.general("INFO", "Pushes refreshed successfully", {
        totalPushes: pushes.length,
        newPushes: newPushes.length
      });
      sessionCache.recentPushes = pushes;
      sessionCache.lastUpdated = Date.now();
      for (const push of newPushes) {
        debugLogger.general("INFO", "Showing notification for new push from tickle", {
          pushIden: push.iden,
          pushType: push.type
        });
        showPushNotification(push, notificationDataStore2).catch((error) => {
          debugLogger.general("ERROR", "Failed to show notification", { pushIden: push.iden }, error);
        });
      }
      chrome.runtime.sendMessage({
        action: "pushesUpdated",
        pushes
      }).catch(() => {
      });
    } catch (error) {
      debugLogger.general("ERROR", "Failed to refresh pushes", null, error);
    }
  }
  async function showPushNotification(push, notificationDataStore2) {
    try {
      debugLogger.notifications("INFO", "Showing push notification", {
        pushType: push.type,
        hasTitle: !!("title" in push && push.title),
        pushKeys: Object.keys(push),
        pushJson: JSON.stringify(push)
      });
      let title = "Pushbullet";
      let message = "";
      const iconUrl = "icons/icon128.png";
      const pushType = push.type;
      if (pushType === "mirror" && push.application_name?.toLowerCase().includes("messaging")) {
        title = `SMS: ${push.title}`;
        message = push.body || "";
      } else if (pushType === "note") {
        title = push.title || "Note";
        message = push.body || "";
      } else if (pushType === "link") {
        title = push.title || "Link";
        message = push.url || "";
      } else if (pushType === "file") {
        title = push.file_name || "File";
        message = push.body || push.file_url || "";
      } else if (pushType === "mirror") {
        title = push.title || push.application_name || "Notification";
        message = push.body || "";
      } else if (pushType === "sms_changed") {
        const smsData = push;
        if (smsData.notifications && smsData.notifications.length > 0) {
          const sms = smsData.notifications[0];
          title = sms.title || "SMS";
          message = sms.body || "";
        } else {
          title = "SMS";
          message = "New SMS received";
        }
      } else if (pushType === "dismissal") {
        debugLogger.notifications("DEBUG", "Skipping dismissal push notification");
        return;
      } else if (pushType === "ping" || pushType === "pong") {
        debugLogger.notifications("DEBUG", "Ignoring internal push type", { pushType });
        return;
      } else {
        title = "Push";
        message = JSON.stringify(push).substring(0, 200);
        debugLogger.notifications("WARN", "Unknown push type", { pushType, push });
        performanceMonitor.recordUnknownPushType();
      }
      const notificationId = `pushbullet-push-${++notificationCounter}-${Date.now()}`;
      if (notificationDataStore2) {
        notificationDataStore2.set(notificationId, push);
      }
      createNotificationWithTimeout(
        notificationId,
        {
          type: "basic",
          iconUrl,
          // Always use local icon, never external URLs
          title: title.substring(0, 100),
          // Limit title length
          message: message.substring(0, 200),
          // Limit message length
          priority: 1
        },
        (createdId) => {
          debugLogger.notifications("INFO", "Push notification created", {
            notificationId: createdId,
            pushType: push.type
          });
          performanceMonitor.recordNotification("push_notification_created");
          performanceMonitor.recordNotificationCreated();
        }
      );
    } catch (error) {
      debugLogger.notifications("ERROR", "Failed to show push notification", {
        error: error.message,
        pushType: push.type
      }, error);
      performanceMonitor.recordNotificationFailed();
    }
  }
  function checkPollingMode() {
    const qualityMetrics = performanceMonitor.getQualityMetrics();
    if (qualityMetrics.consecutiveFailures >= 3 && !isPollingMode()) {
      debugLogger.general("WARN", "Entering polling mode due to consecutive failures", {
        consecutiveFailures: qualityMetrics.consecutiveFailures
      });
      setPollingMode(true);
      chrome.alarms.create("pollingFallback", { periodInMinutes: 1 });
      debugLogger.general("INFO", "Polling mode activated", { interval: "1 minute" });
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
    const apiKey2 = getApiKey();
    if (!apiKey2) {
      debugLogger.general("WARN", "Cannot perform polling fetch - no API key");
      return;
    }
    debugLogger.general("DEBUG", "Performing polling fetch", {
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
    try {
      const pushes = await fetchRecentPushes(apiKey2);
      const latestPush = pushes[0];
      if (latestPush && sessionCache.recentPushes[0]?.iden !== latestPush.iden) {
        debugLogger.general("INFO", "New push detected via polling", {
          pushId: latestPush.iden,
          pushType: latestPush.type
        });
        sessionCache.recentPushes = pushes;
        chrome.runtime.sendMessage({
          action: "pushesUpdated",
          pushes
        }).catch(() => {
        });
      }
    } catch (error) {
      debugLogger.general("ERROR", "Polling fetch failed", null, error);
    }
  }
  function performWebSocketHealthCheck(wsClient, connectFn) {
    const apiKey2 = getApiKey();
    if (apiKey2 && (!wsClient || !wsClient.isConnected())) {
      debugLogger.websocket("WARN", "Health check failed - WebSocket not connected", {
        hasWebSocket: !!wsClient,
        isConnected: wsClient ? wsClient.isConnected() : false
      });
      performanceMonitor.recordHealthCheckFailure();
      connectFn();
    } else if (wsClient && wsClient.isConnected()) {
      debugLogger.websocket("DEBUG", "Health check passed - WebSocket connected");
      performanceMonitor.recordHealthCheckSuccess();
    } else {
      debugLogger.websocket("DEBUG", "Health check skipped - no API key");
    }
  }
  function updatePopupConnectionState(state) {
    chrome.runtime.sendMessage({
      action: "connectionStateChanged",
      state
    }).catch(() => {
    });
  }
  function setupContextMenu() {
    if (isSettingUpContextMenu) {
      debugLogger.general("INFO", "Context menu setup already in progress, skipping");
      return;
    }
    isSettingUpContextMenu = true;
    try {
      chrome.contextMenus.removeAll(() => {
        if (chrome.runtime.lastError) {
          debugLogger.general("ERROR", "Failed to remove existing context menus", {
            error: chrome.runtime.lastError.message
          });
          isSettingUpContextMenu = false;
          return;
        }
        try {
          chrome.contextMenus.create({
            id: "push-link",
            title: "Push this link",
            contexts: ["link"]
          });
          if (chrome.runtime.lastError) {
            debugLogger.general("ERROR", "Failed to create push-link menu", {
              error: chrome.runtime.lastError.message
            });
          }
          chrome.contextMenus.create({
            id: "push-page",
            title: "Push this page",
            contexts: ["page"]
          });
          if (chrome.runtime.lastError) {
            debugLogger.general("ERROR", "Failed to create push-page menu", {
              error: chrome.runtime.lastError.message
            });
          }
          chrome.contextMenus.create({
            id: "push-selection",
            title: "Push selected text",
            contexts: ["selection"]
          });
          if (chrome.runtime.lastError) {
            debugLogger.general("ERROR", "Failed to create push-selection menu", {
              error: chrome.runtime.lastError.message
            });
          }
          chrome.contextMenus.create({
            id: "push-image",
            title: "Push this image",
            contexts: ["image"]
          });
          if (chrome.runtime.lastError) {
            debugLogger.general("ERROR", "Failed to create push-image menu", {
              error: chrome.runtime.lastError.message
            });
          }
          debugLogger.general("INFO", "Context menu created successfully");
        } finally {
          isSettingUpContextMenu = false;
        }
      });
    } catch (error) {
      debugLogger.general("ERROR", "Failed to create context menu", null, error);
      isSettingUpContextMenu = false;
    }
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
      const response = await fetch("https://api.pushbullet.com/v2/pushes", {
        method: "POST",
        headers: {
          "Access-Token": apiKey2,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          type: "link",
          title: sanitizedTitle,
          url: sanitizedUrl
        })
      });
      if (!response.ok) {
        throw new Error(`Failed to push link: ${response.status}`);
      }
      debugLogger.general("INFO", "Link pushed successfully", { url, title });
      createNotificationWithTimeout(
        "pushbullet-link-sent",
        {
          type: "basic",
          iconUrl: "icons/icon128.png",
          title: "Link Sent",
          message: title || url
        }
      );
    } catch (error) {
      debugLogger.general("ERROR", "Failed to push link", { url, title }, error);
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
      const response = await fetch("https://api.pushbullet.com/v2/pushes", {
        method: "POST",
        headers: {
          "Access-Token": apiKey2,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          type: "note",
          title: sanitizedTitle,
          body: sanitizedBody
        })
      });
      if (!response.ok) {
        throw new Error(`Failed to push note: ${response.status}`);
      }
      debugLogger.general("INFO", "Note pushed successfully", { title });
      createNotificationWithTimeout(
        "pushbullet-note-sent",
        {
          type: "basic",
          iconUrl: "icons/icon128.png",
          title: "Note Sent",
          message: title
        }
      );
    } catch (error) {
      debugLogger.general("ERROR", "Failed to push note", { title }, error);
    }
  }

  // src/background/state-machine.ts
  var ServiceWorkerStateMachine = class {
    currentState = "idle" /* IDLE */;
    callbacks;
    constructor(callbacks) {
      this.callbacks = callbacks;
      debugLogger.general("INFO", "[StateMachine] Initialized", { initialState: this.currentState });
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
      switch (this.currentState) {
        case "idle" /* IDLE */:
          if (event === "STARTUP") {
            return data?.hasApiKey ? "initializing" /* INITIALIZING */ : "idle" /* IDLE */;
          }
          if (event === "API_KEY_SET") {
            return "initializing" /* INITIALIZING */;
          }
          break;
        case "initializing" /* INITIALIZING */:
          if (event === "INIT_SUCCESS") {
            return "ready" /* READY */;
          }
          if (event === "INIT_FAILURE") {
            return "error" /* ERROR */;
          }
          break;
        case "ready" /* READY */:
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
          break;
        case "error" /* ERROR */:
          if (event === "API_KEY_SET") {
            return "initializing" /* INITIALIZING */;
          }
          break;
      }
      return this.currentState;
    }
    /**
     * Handle entering a new state
     * 
     * This is where side effects happen (calling callbacks).
     */
    async onStateEnter(state, previousState, data) {
      debugLogger.general("DEBUG", `[StateMachine] Entering state`, { state, previousState });
      updateExtensionTooltip(this.getStateDescription());
      switch (state) {
        case "idle" /* IDLE */:
          if (this.callbacks.onClearData) {
            await this.callbacks.onClearData();
          }
          if (this.callbacks.onDisconnectWebSocket) {
            this.callbacks.onDisconnectWebSocket();
          }
          break;
        case "initializing" /* INITIALIZING */:
          if (this.callbacks.onInitialize) {
            try {
              await this.callbacks.onInitialize(data);
              await this.transition("INIT_SUCCESS");
            } catch (error) {
              debugLogger.general("ERROR", "[StateMachine] Initialization failed", null, error);
              await this.transition("INIT_FAILURE");
            }
          }
          break;
        case "ready" /* READY */:
          if (previousState === "degraded" /* DEGRADED */ && this.callbacks.onStopPolling) {
            this.callbacks.onStopPolling();
          }
          if (previousState === "initializing" /* INITIALIZING */ && this.callbacks.onConnectWebSocket) {
            this.callbacks.onConnectWebSocket();
          }
          break;
        case "degraded" /* DEGRADED */:
          debugLogger.general("WARN", "Entering DEGRADED state. Starting polling fallback.");
          chrome.alarms.create("pollingFallback", { periodInMinutes: 1 });
          if (this.callbacks.onStartPolling) {
            this.callbacks.onStartPolling();
          }
          break;
        case "error" /* ERROR */:
          if (this.callbacks.onShowError) {
            this.callbacks.onShowError("Service worker encountered an error");
          }
          break;
      }
    }
    /**
     * Handle exiting a state
     * 
     * Optional cleanup logic when leaving a state.
     */
    async onStateExit(state, nextState) {
      debugLogger.general("DEBUG", `[StateMachine] Exiting state`, { state, nextState });
      if (state === "degraded" /* DEGRADED */) {
        debugLogger.general("INFO", "Exiting DEGRADED state. Stopping polling fallback.");
        chrome.alarms.clear("pollingFallback");
        if (this.callbacks.onStopPolling) {
          this.callbacks.onStopPolling();
        }
      }
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
        case "error" /* ERROR */:
          return "Error - Unrecoverable error occurred";
        default:
          return "Unknown state";
      }
    }
  };

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
    "apiKeyChanged",
    "logout",
    "settingsChanged",
    "deviceNicknameChanged",
    "autoOpenLinksChanged",
    "encryptionPasswordChanged",
    "debugModeChanged",
    "pushNote",
    "pushLink",
    "pushFile"
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

  // src/background/index.ts
  debugConfigManager.loadConfig();
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
  var stateMachine = new ServiceWorkerStateMachine({
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
      updateConnectionIcon("disconnected");
    },
    onClearData: async () => {
      sessionCache.userInfo = null;
      sessionCache.devices = [];
      sessionCache.recentPushes = [];
      sessionCache.lastUpdated = null;
    },
    onDisconnectWebSocket: () => {
      disconnectWebSocket();
    }
  });
  function connectWebSocket() {
    updateConnectionIcon("connecting");
    if (websocketClient2) {
      debugLogger.websocket("INFO", "Disposing existing WebSocket before reconnecting");
      websocketClient2.disconnect();
      websocketClient2 = null;
    }
    websocketClient2 = new WebSocketClient(WEBSOCKET_URL, getApiKey);
    setWebSocketClient(websocketClient2);
    globalEventBus.on("websocket:tickle:push", async () => {
      await refreshPushes(notificationDataStore);
    });
    globalEventBus.on("websocket:tickle:device", async () => {
      const apiKey2 = getApiKey();
      if (apiKey2) {
        const devices = await fetchDevices(apiKey2);
        sessionCache.devices = devices;
        sessionCache.lastUpdated = Date.now();
        chrome.runtime.sendMessage({
          action: "sessionDataUpdated",
          devices,
          userInfo: sessionCache.userInfo,
          recentPushes: sessionCache.recentPushes,
          autoOpenLinks: sessionCache.autoOpenLinks,
          deviceNickname: sessionCache.deviceNickname
        }).catch(() => {
        });
      }
    });
    globalEventBus.on("websocket:push", async (push) => {
      performanceMonitor.recordPushReceived();
      let decryptedPush = push;
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
          } else {
            debugLogger.general("WARN", "Cannot decrypt push - no encryption password set");
          }
        } catch (error) {
          debugLogger.general("ERROR", "Failed to decrypt push", {
            error: error.message
          }, error);
        }
      }
      if (sessionCache.recentPushes) {
        sessionCache.recentPushes.unshift(decryptedPush);
        sessionCache.lastUpdated = Date.now();
        chrome.runtime.sendMessage({
          action: "pushesUpdated",
          pushes: sessionCache.recentPushes
        }).catch(() => {
        });
      }
      showPushNotification(decryptedPush, notificationDataStore).catch((error) => {
        debugLogger.general("ERROR", "Failed to show notification", null, error);
        performanceMonitor.recordNotificationFailed();
      });
    });
    globalEventBus.on("websocket:connected", () => {
      stateMachine.transition("WS_CONNECTED");
      updateConnectionIcon("connected");
    });
    globalEventBus.on("websocket:disconnected", () => {
      stateMachine.transition("WS_DISCONNECTED");
      updateConnectionIcon("disconnected");
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
    websocketClient2.connect();
  }
  function disconnectWebSocket() {
    if (websocketClient2) {
      websocketClient2.disconnect();
    }
  }
  chrome.runtime.onInstalled.addListener(async () => {
    debugLogger.general("INFO", "Pushbullet extension installed/updated", {
      reason: "onInstalled",
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
    setTimeout(() => updateConnectionIcon("disconnected"), 100);
    initTracker.recordInitialization("onInstalled");
    setupContextMenu();
    chrome.alarms.create("logFlush", { periodInMinutes: 1 });
    await ensureConfigLoaded(
      { setApiKey, setDeviceIden, setAutoOpenLinks, setDeviceNickname, setNotificationTimeout },
      { getApiKey, getDeviceIden, getAutoOpenLinks, getDeviceNickname, getNotificationTimeout }
    );
    const apiKey2 = getApiKey();
    await stateMachine.transition("STARTUP", { hasApiKey: !!apiKey2 });
  });
  chrome.runtime.onStartup.addListener(async () => {
    debugLogger.general("INFO", "Browser started - reinitializing Pushbullet extension", {
      reason: "onStartup",
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
    setTimeout(() => updateConnectionIcon("disconnected"), 100);
    initTracker.recordInitialization("onStartup");
    setupContextMenu();
    chrome.alarms.create("logFlush", { periodInMinutes: 1 });
    await ensureConfigLoaded(
      { setApiKey, setDeviceIden, setAutoOpenLinks, setDeviceNickname, setNotificationTimeout },
      { getApiKey, getDeviceIden, getAutoOpenLinks, getDeviceNickname, getNotificationTimeout }
    );
    const apiKey2 = getApiKey();
    await stateMachine.transition("STARTUP", { hasApiKey: !!apiKey2 });
  });
  chrome.notifications.onClicked.addListener((notificationId) => {
    debugLogger.notifications("INFO", "Notification clicked", { notificationId });
    const pushData = notificationDataStore.get(notificationId);
    if (pushData) {
      chrome.windows.create({
        url: `notification-detail.html?id=${encodeURIComponent(notificationId)}`,
        type: "popup",
        width: 600,
        height: 500,
        focused: true
      });
    }
    chrome.notifications.clear(notificationId);
  });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "logFlush") {
      debugLogger.flush().then(() => {
        console.log("[Logger] Log buffer flushed to persistent storage.");
      });
    } else if (alarm.name === "websocketReconnect" && getApiKey()) {
      debugLogger.websocket("INFO", "Reconnection alarm triggered", {
        alarmName: alarm.name,
        hasApiKey: !!getApiKey(),
        scheduledTime: alarm.scheduledTime ? new Date(alarm.scheduledTime).toISOString() : "unknown"
      });
      connectWebSocket();
    } else if (alarm.name === "websocketReconnect") {
      debugLogger.websocket("WARN", "Reconnection alarm triggered but no API key available");
    } else if (alarm.name === "websocketHealthCheck") {
      performWebSocketHealthCheck(websocketClient2, connectWebSocket);
    } else if (alarm.name === "pollingFallback") {
      performPollingFetch();
    }
  });
  chrome.contextMenus.onClicked.addListener((info, tab) => {
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
    debugLogger.general("DEBUG", "Message received from popup", {
      action: message.action,
      hasApiKey: !!message.apiKey,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
    if (!validatePrivilegedMessage(message.action, sender)) {
      debugLogger.general("ERROR", "Rejected privileged message from untrusted sender", {
        action: message.action,
        senderId: sender?.id,
        senderUrl: sender?.url
      });
      sendResponse({ success: false, error: "Unauthorized" });
      return false;
    }
    if (message.action === "getSessionData") {
      const apiKey2 = getApiKey();
      if (apiKey2 && !sessionCache.isAuthenticated && sessionCache.lastUpdated === 0) {
        if (initializationState.inProgress) {
          debugLogger.general("DEBUG", "Initialization already in progress - waiting for completion");
          const initPromise2 = getInitPromise();
          if (initPromise2) {
            initPromise2.then(() => {
              sendResponse({
                isAuthenticated: sessionCache.isAuthenticated,
                userInfo: sessionCache.userInfo,
                devices: sessionCache.devices,
                recentPushes: sessionCache.recentPushes,
                autoOpenLinks: sessionCache.autoOpenLinks,
                deviceNickname: sessionCache.deviceNickname,
                websocketConnected: websocketClient2 ? websocketClient2.isConnected() : false
              });
            }).catch((error) => {
              debugLogger.general("ERROR", "Initialization failed while waiting", null, error);
              sendResponse({ isAuthenticated: false });
            });
            return true;
          }
        }
        debugLogger.general("WARN", "Service worker wake-up detected - session cache not initialized", {
          hasApiKey: !!apiKey2,
          isAuthenticated: sessionCache.isAuthenticated,
          lastUpdated: sessionCache.lastUpdated
        });
        ensureConfigLoaded(
          { setApiKey, setDeviceIden, setAutoOpenLinks, setDeviceNickname, setNotificationTimeout },
          { getApiKey, getDeviceIden, getAutoOpenLinks, getDeviceNickname, getNotificationTimeout }
        ).then(() => {
          initializeSessionCache("onMessage", connectWebSocket, {
            setApiKey,
            setDeviceIden,
            setAutoOpenLinks,
            setDeviceNickname,
            setNotificationTimeout
          }).then(() => {
            sendResponse({
              isAuthenticated: true,
              userInfo: sessionCache.userInfo,
              devices: sessionCache.devices,
              recentPushes: sessionCache.recentPushes,
              autoOpenLinks: sessionCache.autoOpenLinks,
              deviceNickname: sessionCache.deviceNickname,
              websocketConnected: websocketClient2 ? websocketClient2.isConnected() : false
            });
          }).catch((error) => {
            debugLogger.general("ERROR", "Error re-initializing session cache", null, error);
            sendResponse({ isAuthenticated: false });
          });
        });
        return true;
      }
      const isStale = sessionCache.lastUpdated > 0 && Date.now() - sessionCache.lastUpdated > 3e5;
      if (sessionCache.isAuthenticated && !isStale) {
        sendResponse({
          isAuthenticated: true,
          userInfo: sessionCache.userInfo,
          devices: sessionCache.devices,
          recentPushes: sessionCache.recentPushes,
          autoOpenLinks: sessionCache.autoOpenLinks,
          deviceNickname: sessionCache.deviceNickname,
          websocketConnected: websocketClient2 ? websocketClient2.isConnected() : false
        });
      } else if (sessionCache.isAuthenticated && isStale) {
        const apiKey3 = getApiKey();
        if (apiKey3) {
          refreshSessionCache(apiKey3).then(() => {
            sendResponse({
              isAuthenticated: true,
              userInfo: sessionCache.userInfo,
              devices: sessionCache.devices,
              recentPushes: sessionCache.recentPushes,
              autoOpenLinks: sessionCache.autoOpenLinks,
              deviceNickname: sessionCache.deviceNickname,
              websocketConnected: websocketClient2 ? websocketClient2.isConnected() : false
            });
          }).catch((error) => {
            debugLogger.general("ERROR", "Error refreshing session cache", null, error);
            sendResponse({ isAuthenticated: false });
          });
          return true;
        }
      } else {
        sendResponse({ isAuthenticated: false });
      }
    } else if (message.action === "apiKeyChanged") {
      setApiKey(message.apiKey);
      let savePromise = storageRepository.setApiKey(message.apiKey);
      if (message.deviceNickname) {
        savePromise = savePromise.then(() => {
          setDeviceNickname(message.deviceNickname);
          sessionCache.deviceNickname = message.deviceNickname;
          return storageRepository.setDeviceNickname(message.deviceNickname);
        });
      }
      savePromise.then(() => {
        return stateMachine.transition("API_KEY_SET", { apiKey: message.apiKey });
      }).then(() => {
        sendResponse({
          success: true,
          isAuthenticated: stateMachine.isInState("ready" /* READY */) || stateMachine.isInState("degraded" /* DEGRADED */),
          userInfo: sessionCache.userInfo,
          devices: sessionCache.devices,
          recentPushes: sessionCache.recentPushes,
          autoOpenLinks: sessionCache.autoOpenLinks,
          deviceNickname: sessionCache.deviceNickname,
          websocketConnected: websocketClient2 ? websocketClient2.isConnected() : false
        });
      }).catch((error) => {
        debugLogger.general("ERROR", "Error saving API key", null, error);
        sendResponse({ success: false, error: error.message });
      });
      return true;
    } else if (message.action === "logout") {
      stateMachine.transition("LOGOUT").then(() => {
        return storageRepository.setApiKey(null);
      }).then(() => {
        return storageRepository.setDeviceIden(null);
      }).then(() => {
        sendResponse({ success: true });
      }).catch((error) => {
        debugLogger.general("ERROR", "Error during logout", null, error);
        sendResponse({ success: false, error: error.message });
      });
      return true;
    } else if (message.action === "refreshSession") {
      const apiKey2 = getApiKey();
      if (apiKey2) {
        refreshSessionCache(apiKey2).then(() => {
          sendResponse({
            isAuthenticated: true,
            userInfo: sessionCache.userInfo,
            devices: sessionCache.devices,
            recentPushes: sessionCache.recentPushes,
            autoOpenLinks: sessionCache.autoOpenLinks,
            deviceNickname: sessionCache.deviceNickname
          });
        }).catch((error) => {
          debugLogger.general("ERROR", "Error refreshing session", null, error);
          sendResponse({ isAuthenticated: false });
        });
        return true;
      } else {
        sendResponse({ isAuthenticated: false });
      }
    } else if (message.action === "settingsChanged") {
      const promises = [];
      if (message.autoOpenLinks !== void 0) {
        setAutoOpenLinks(message.autoOpenLinks);
        sessionCache.autoOpenLinks = message.autoOpenLinks;
        promises.push(storageRepository.setAutoOpenLinks(message.autoOpenLinks));
      }
      if (message.notificationTimeout !== void 0) {
        setNotificationTimeout(message.notificationTimeout);
        promises.push(storageRepository.setNotificationTimeout(message.notificationTimeout));
      }
      Promise.all(promises).then(() => {
        sendResponse({ success: true });
      }).catch((error) => {
        debugLogger.general("ERROR", "Error saving settings", null, error);
        sendResponse({ success: false, error: error.message });
      });
      return true;
    } else if (message.action === "updateDeviceNickname") {
      const apiKey2 = getApiKey();
      const deviceIden2 = getDeviceIden();
      if (apiKey2 && deviceIden2 && message.nickname) {
        updateDeviceNickname(apiKey2, deviceIden2, message.nickname).then(async () => {
          setDeviceNickname(message.nickname);
          sessionCache.deviceNickname = message.nickname;
          await storageRepository.setDeviceNickname(message.nickname);
          sendResponse({ success: true });
        }).catch((error) => {
          debugLogger.general("ERROR", "Error updating device nickname", null, error);
          sendResponse({ success: false, error: error.message });
        });
        return true;
      } else {
        sendResponse({ success: false, error: "Missing required parameters" });
      }
    } else if (message.action === "getDebugSummary") {
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
      const summary = {
        config: debugConfigManager.getConfig(),
        logs: logData.logs,
        // Array of log entries
        totalLogs: logData.summary.totalLogs,
        performance: performanceForDashboard,
        websocketState,
        initializationStats: initTracker.exportData(),
        errors: {
          total: logData.summary.errors,
          last24h: logData.summary.errors,
          // Add last24h for dashboard
          critical: []
        }
      };
      debugLogger.general("DEBUG", "Sending debug summary", {
        totalLogs: summary.totalLogs,
        hasConfig: !!summary.config,
        hasPerformance: !!summary.performance,
        websocketStateText: websocketState.current.stateText,
        stateMachineState: stateMachine.getCurrentState()
      });
      sendResponse({ success: true, summary });
      return false;
    } else if (message.action === "exportDebugData") {
      debugLogger.general("INFO", "Exporting full debug data");
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
      return false;
    } else if (message.action === "getNotificationData") {
      const pushData = notificationDataStore.get(message.notificationId);
      if (pushData) {
        sendResponse({ success: true, push: pushData });
      } else {
        sendResponse({ success: false, error: "Notification not found" });
      }
      return false;
    } else if (message.action === "sendPush") {
      const apiKey2 = getApiKey();
      if (!apiKey2) {
        sendResponse({ success: false, error: "No API key" });
        return false;
      }
      const pushData = message.pushData;
      if (!pushData || !pushData.type) {
        sendResponse({ success: false, error: "Invalid push data" });
        return false;
      }
      fetch("https://api.pushbullet.com/v2/pushes", {
        method: "POST",
        headers: {
          "Access-Token": apiKey2,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(pushData)
      }).then(async (response) => {
        if (!response.ok) {
          const errorText = await response.text();
          let errorMessage = "Failed to send push";
          try {
            const errorData = JSON.parse(errorText);
            if (errorData.error?.message) {
              errorMessage = errorData.error.message;
            }
          } catch {
          }
          throw new Error(errorMessage);
        }
        await refreshPushes(notificationDataStore);
        sendResponse({ success: true });
      }).catch((error) => {
        debugLogger.general("ERROR", "Failed to send push", { pushType: pushData.type }, error);
        sendResponse({ success: false, error: error.message });
      });
      return true;
    }
    return false;
  });
  globalThis.exportDebugInfo = function() {
    return {
      debugLogs: debugLogger.exportLogs(),
      performanceData: performanceMonitor.exportPerformanceData(),
      websocketState: wsStateMonitor.getStateReport(),
      initializationData: initTracker.exportData(),
      sessionCache: {
        isAuthenticated: sessionCache.isAuthenticated,
        lastUpdated: sessionCache.lastUpdated ? new Date(sessionCache.lastUpdated).toISOString() : "never",
        userInfo: sessionCache.userInfo ? { email: sessionCache.userInfo.email?.substring(0, 3) + "***" } : null,
        deviceCount: sessionCache.devices?.length || 0,
        pushCount: sessionCache.recentPushes?.length || 0
      },
      websocketConnected: websocketClient2 ? websocketClient2.isConnected() : false,
      initializationState: {
        inProgress: initializationState.inProgress,
        completed: initializationState.completed,
        timestamp: initializationState.timestamp ? new Date(initializationState.timestamp).toISOString() : null,
        hasError: !!initializationState.error
      }
    };
  };
  debugLogger.general("INFO", "Background service worker initialized", {
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  });
})();
//# sourceMappingURL=background.js.map
