"use strict";
(() => {
  // src/lib/logging/index.ts
  var STORAGE_KEY = "persistentDebugLogs";
  var MAX_PERSISTENT_LOGS = 5e3;
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
    /**
     * Clear all logs from memory and persistent storage
     * This method is called when the user clicks "Clear All Logs" in the debug dashboard
     */
    async clearLogs() {
      this.logs = [];
      await this.flush();
      this.log("GENERAL", "INFO", "Log buffer has been cleared by the user.");
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
  };
  var wsStateMonitor = new WebSocketStateMonitor();

  // src/types/domain.ts
  function isLinkPush(push) {
    return push.type === "link";
  }

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
      * Get Device Nickname from local storage
      */
    async getDeviceNickname() {
      const result = await chrome.storage.local.get(["deviceNickname"]);
      return result.deviceNickname || null;
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
     * Get Device Registration In Progress flag from local storage
     */
    async getDeviceRegistrationInProgress() {
      const result = await chrome.storage.local.get(["deviceRegistrationInProgress"]);
      return result.deviceRegistrationInProgress || false;
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

  // src/app/push-types.ts
  var SUPPORTED_PUSH_TYPES = [
    "note",
    "link",
    "mirror",
    "smschanged",
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
        // Include full push data for unknown types
        fullPushData: fullPush
      });
    }
  }

  // src/app/api/client.ts
  var API_BASE_URL = "https://api.pushbullet.com/v2";
  var PUSHES_URL = `${API_BASE_URL}/pushes`;
  var DEVICES_URL = `${API_BASE_URL}/devices`;
  var USER_INFO_URL = `${API_BASE_URL}/users/me`;
  var registrationPromise = null;
  function authHeaders(apiKey2) {
    return { "Access-Token": apiKey2 };
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
        const hasContent = "title" in push && push.title || "body" in push && push.body || "url" in push && push.url || "file_name" in push && push.file_name || "file_url" in push && push.file_url;
        return hasContent;
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
      if (page > 10) break;
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
    return response.status !== 404;
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
            const currentDevice = devices.find((d) => d.iden === existingDeviceIden);
            const currentNickname = currentDevice?.nickname;
            if (currentNickname !== deviceNickname2) {
              await updateDeviceNickname(apiKey2, existingDeviceIden, deviceNickname2);
              debugLogger.general("INFO", "Device nickname updated", { old: currentNickname, new: deviceNickname2 });
            } else {
              debugLogger.general("DEBUG", "Device nickname unchanged, skipping update");
            }
            return { deviceIden: existingDeviceIden, needsUpdate: false };
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
      store.put(session, CACHE_KEY);
      await new Promise((resolve) => transaction.oncomplete = resolve);
      debugLogger.storage("DEBUG", "Session cache saved to IndexedDB");
    } catch (error) {
      debugLogger.storage(
        "ERROR",
        "Failed to save session to IndexedDB",
        null,
        error
      );
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

  // src/app/session/index.ts
  var sessionCache = {
    userInfo: null,
    devices: [],
    recentPushes: [],
    chats: [],
    // ← ADD THIS LINE
    isAuthenticated: false,
    lastUpdated: 0,
    autoOpenLinks: true,
    deviceNickname: "Chrome",
    lastModifiedCutoff: 0
    // ← ADD: Initialize to 0
  };
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
  }
  async function handleInvalidCursorRecovery(apiKey2, connectWebSocketFn) {
    debugLogger.general("WARN", "Invalid cursor detected - starting recovery process");
    try {
      debugLogger.general("INFO", "Clearing invalid cursor from storage");
      await storageRepository.removeLastModifiedCutoff();
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
  var initPromise = null;
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
      debugLogger.general("INFO", "Session already loaded, skipping network initialization.");
      if (connectWebSocketFn) {
        connectWebSocketFn();
      }
      return null;
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
          const storedCutoff = await storageRepository.getLastModifiedCutoff();
          sessionCache.lastModifiedCutoff = storedCutoff ?? 0;
          let incrementalPushes = [];
          if (storedCutoff && storedCutoff > 0) {
            incrementalPushes = await fetchIncrementalPushes(apiKeyValue, storedCutoff, 100);
            debugLogger.general("INFO", "Pipeline 1: Incremental fetch complete", {
              count: incrementalPushes.length,
              cutoff: storedCutoff
            });
          } else {
            incrementalPushes = await fetchRecentPushes(apiKeyValue, 20);
            debugLogger.general("INFO", "Pipeline 1: First run, seeding cutoff", {
              count: incrementalPushes.length
            });
          }
          const maxModified = incrementalPushes.reduce((m, p) => Math.max(m, p.modified ?? 0), 0);
          if (maxModified > sessionCache.lastModifiedCutoff) {
            sessionCache.lastModifiedCutoff = maxModified;
            await storageRepository.setLastModifiedCutoff(maxModified);
            debugLogger.general("DEBUG", "Pipeline 1: Updated cutoff", {
              old: storedCutoff ?? 0,
              new: maxModified
            });
          }
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
            interval: "5 minutes"
          });
        } else {
          debugLogger.general(
            "WARN",
            "No API key available - session cache not initialized"
          );
        }
        saveSessionCache(sessionCache);
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
        const storedCutoff = await storageRepository.getLastModifiedCutoff();
        let incrementalPushes = [];
        if (storedCutoff && storedCutoff > 0) {
          incrementalPushes = await fetchIncrementalPushes(apiKeyParam, storedCutoff, 100);
        } else {
          incrementalPushes = await fetchRecentPushes(apiKeyParam, 20);
        }
        const maxModified = incrementalPushes.reduce((m, p) => Math.max(m, p.modified ?? 0), 0);
        if (maxModified > (sessionCache.lastModifiedCutoff ?? 0)) {
          sessionCache.lastModifiedCutoff = maxModified;
          await storageRepository.setLastModifiedCutoff(maxModified);
        }
        debugLogger.general("DEBUG", "Pipeline 2: Refreshing display pushes");
        const displayPushes = await fetchDisplayPushes(apiKeyParam, 50);
        sessionCache.recentPushes = displayPushes;
        debugLogger.general("INFO", "Session refresh complete", {
          incrementalCount: incrementalPushes.length,
          displayCount: displayPushes.length
        });
        try {
          const chats = await fetchChats(apiKeyParam);
          sessionCache.chats = chats;
        } catch (error) {
          debugLogger.general("WARN", "Failed to refresh chats", {
            error: error.message
          });
        }
        sessionCache.isAuthenticated = true;
        sessionCache.lastUpdated = Date.now();
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

  // src/background/utils.ts
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
  function isTrustedImageUrl(urlString) {
    if (!urlString) {
      return false;
    }
    try {
      const url = new URL(urlString);
      return url.hostname.endsWith(".pushbullet.com") || url.hostname.endsWith(".pushbulletusercontent.com") || /^lh[0-9]\.googleusercontent\.com$/.test(url.hostname);
    } catch {
      debugLogger.general("WARN", "Could not parse URL for domain check", {
        url: urlString
      });
      return false;
    }
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
  async function refreshPushes(notificationDataStore2) {
    await ensureConfigLoaded();
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
      const maxModified = Math.max(
        cutoff,
        ...incrementalPushes.map((p) => typeof p.modified === "number" ? p.modified : 0)
      );
      if (maxModified > cutoff) {
        sessionCache.lastModifiedCutoff = maxModified;
        await storageRepository.setLastModifiedCutoff(maxModified);
        debugLogger.general("DEBUG", "Pipeline 1: Updated cutoff", {
          old: cutoff,
          new: maxModified
        });
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
      for (const push of newPushes) {
        debugLogger.general("INFO", "Processing new push", {
          pushIden: push.iden,
          pushType: push.type
        });
        void showPushNotification(push, notificationDataStore2).catch((error) => {
          debugLogger.general("ERROR", "Failed to show notification", {
            pushIden: push.iden
          }, error);
        });
        const autoOpenLinks2 = getAutoOpenLinks();
        if (autoOpenLinks2 && isLinkPush(push)) {
          debugLogger.general("INFO", "Auto-opening link push", {
            pushIden: push.iden,
            url: push.url
          });
          chrome.tabs.create({ url: push.url, active: false }).catch((error) => {
            debugLogger.general("ERROR", "Failed to auto-open link", {
              url: push.url
            }, error);
          });
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
      if (push.type === "sms_changed" && (!push.notifications || push.notifications.length === 0)) {
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
      } else if (push.type === "sms_changed") {
        debugLogger.notifications(
          "DEBUG",
          "Complete sms_changed push object received",
          { push }
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
        } else if (push.type === "file") {
          debugLogger.notifications(
            "DEBUG",
            "Complete file push object received",
            { push }
          );
          let fileTitle = "New File";
          let fileMessage = "";
          if (push.title) {
            fileTitle = push.title;
            fileMessage = push.body || `Image (${push.file_type})`;
          } else {
            fileTitle = `New File: ${push.file_name || "unknown file"}`;
            fileMessage = push.body || push.file_type || "";
          }
          const imageUrl = push.image_url;
          const fileUrl = push.file_url;
          let previewUrl = null;
          if (imageUrl && isTrustedImageUrl(imageUrl)) {
            previewUrl = imageUrl;
          } else if (fileUrl && isTrustedImageUrl(fileUrl) && push.file_type?.startsWith("image/")) {
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
                fileName: push.file_name,
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
        } else if (push.type === "mirror") {
          const mirrorTitle = push.application_name && push.title ? `${push.application_name}: ${push.title}` : push.title || push.application_name || "Notification";
          const mirrorMessage = push.body || "";
          const iconData = push.icon;
          if (iconData && typeof iconData === "string" && iconData.startsWith("/9j/")) {
            debugLogger.notifications("DEBUG", "Processing mirror notification icon", {
              iconDataLength: iconData.length,
              title: mirrorTitle
            });
            const dataUrl = `data:image/jpeg;base64,${iconData}`;
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
      await chrome.notifications.create(notificationId, finalNotificationOptions);
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
      debugLogger.general(
        "INFO",
        "Stopping polling mode - WebSocket reconnected"
      );
      setPollingMode(false);
      chrome.alarms.clear("pollingFallback");
      updateConnectionIcon("connected");
    }
  }
  async function performPollingFetch() {
    const apiKey2 = getApiKey();
    if (!apiKey2) {
      debugLogger.general("WARN", "Cannot perform polling fetch - no API key");
      return;
    }
    debugLogger.general("DEBUG", "Performing polling fetch (incremental)");
    await refreshPushes();
  }
  function performWebSocketHealthCheck(wsClient, connectFn) {
    const apiKey2 = getApiKey();
    if (apiKey2 && (!wsClient || !wsClient.isConnected())) {
      debugLogger.websocket(
        "WARN",
        "Health check failed - WebSocket is disconnected. Triggering reconnect."
      );
      performanceMonitor.recordHealthCheckFailure();
      connectFn();
    } else if (wsClient && wsClient.isConnected()) {
      if (wsClient.isConnectionHealthy()) {
        debugLogger.websocket("DEBUG", "WebSocket connection is healthy.");
        performanceMonitor.recordHealthCheckSuccess();
      } else {
        debugLogger.websocket(
          "WARN",
          "WebSocket connection is unhealthy. Triggering reconnect."
        );
        performanceMonitor.recordHealthCheckFailure();
        globalEventBus.emit("websocket:disconnected");
      }
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

  // src/app/ws/client.ts
  var WebSocketClient = class _WebSocketClient {
    constructor(websocketUrl, getApiKey2) {
      this.websocketUrl = websocketUrl;
      this.getApiKey = getApiKey2;
    }
    static NOP_TIMEOUT = 6e4;
    // 60 seconds
    socket = null;
    reconnectAttempts = 0;
    reconnectTimeout = null;
    lastNopReceived = 0;
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
          apiKeyLength: apiKey2.length,
          apiKeyPrefix: apiKey2.substring(0, 8) + "...",
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
          updateConnectionIcon("connected");
          this.lastNopReceived = Date.now();
          performanceMonitor.recordWebSocketConnection(true);
          wsStateMonitor.startMonitoring();
          globalEventBus.emit("websocket:polling:stop");
          try {
            clearErrorBadge();
          } catch {
          }
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
                  debugLogger.websocket(
                    "WARN",
                    "Push message received without push payload"
                  );
                }
                break;
              case "nop":
                this.lastNopReceived = Date.now();
                debugLogger.websocket("DEBUG", "Server nop received", {
                  timestamp: (/* @__PURE__ */ new Date()).toISOString()
                });
                break;
              // Note: 'ping' and 'pong' are WebSocket frame types, not message types
              // They should not appear in the message data, but we handle them defensively
              default:
                debugLogger.websocket(
                  "WARN",
                  "Unknown WebSocket message type received",
                  {
                    type: data.type
                  }
                );
                break;
            }
          } catch (error) {
            debugLogger.websocket(
              "ERROR",
              "Failed to process WebSocket message",
              null,
              error
            );
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
          globalEventBus.emit("websocket:disconnected", {
            code: event.code,
            reason: event.reason,
            wasClean: event.wasClean
          });
          globalEventBus.emit("websocket:state", "disconnected");
          if (event.code === 1008 || event.code === 4001 || event.code >= 4e3 && event.code < 5e3) {
            debugLogger.websocket(
              "ERROR",
              "Permanent WebSocket error - stopping reconnection attempts",
              closeInfo
            );
            try {
              showPermanentWebSocketError(closeInfo);
            } catch {
            }
            return;
          }
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
      if (!this.isConnected()) return false;
      const timeSinceLastNop = Date.now() - this.lastNopReceived;
      return timeSinceLastNop < _WebSocketClient.NOP_TIMEOUT;
    }
  };

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
        if (lastKnownState && Object.values(ServiceWorkerState).includes(lastKnownState)) {
          instance.currentState = lastKnownState;
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
              await this.callbacks.onInitialize(data);
              await this.transition("INIT_SUCCESS");
            } catch (error) {
              debugLogger.general("ERROR", "[StateMachine] Initialization failed", null, error);
              await this.transition("INIT_FAILURE");
            }
          }
          break;
        case "ready" /* READY */:
          updateConnectionIcon("connected");
          if (previousState === "degraded" /* DEGRADED */ && this.callbacks.onStopPolling) {
            this.callbacks.onStopPolling();
          }
          if (previousState === "initializing" /* INITIALIZING */ && this.callbacks.onConnectWebSocket) {
            this.callbacks.onConnectWebSocket();
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
        case "error" /* ERROR */:
          updateConnectionIcon("disconnected");
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
        case "reconnecting" /* RECONNECTING */:
          return "Reconnecting - Attempting to restore real-time connection";
        case "error" /* ERROR */:
          return "Error - Unrecoverable error occurred";
        default:
          return "Unknown state";
      }
    }
  };

  // src/background/links.ts
  function isLinkPush2(p) {
    return p.type === "link" && typeof p.url === "string" && p.url.length > 0;
  }
  async function openTab(url) {
    if (!url || typeof url !== "string") {
      debugLogger.general("ERROR", "Cannot open tab: invalid URL provided", {
        url
      });
      throw new Error("Invalid URL provided to openTab");
    }
    try {
      await chrome.tabs.create({ url, active: false });
      debugLogger.general("DEBUG", "Tab created successfully", { url });
      return;
    } catch (primaryError) {
      debugLogger.general(
        "WARN",
        "Failed to create tab, attempting window fallback",
        {
          url,
          error: primaryError.message,
          errorType: primaryError.name
        },
        primaryError
      );
      try {
        await chrome.windows.create({ url, focused: false });
        debugLogger.general("INFO", "Window created as fallback", { url });
        return;
      } catch (fallbackError) {
        const error = new Error(
          `Failed to open URL in tab or window: ${fallbackError.message}`
        );
        debugLogger.general(
          "ERROR",
          "Both tab and window creation failed",
          {
            url,
            primaryError: primaryError.message,
            fallbackError: fallbackError.message
          },
          error
        );
        throw error;
      }
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
    const candidates = changes.filter(isLinkPush2).filter((p) => (typeof p.created === "number" ? p.created : 0) > lastAuto).sort((a, b) => (a.created || 0) - (b.created || 0));
    if (candidates.length === 0) {
      debugLogger.websocket(
        "INFO",
        "Auto-open links: no new link pushes to open"
      );
      return;
    }
    const toOpen = candidates.slice(0, safetyCap);
    debugLogger.websocket("INFO", "Auto-opening link pushes", {
      count: toOpen.length,
      total: candidates.length
    });
    for (const p of toOpen) {
      await openTab(p.url);
    }
    const maxCreated = Math.max(lastAuto, ...toOpen.map((p) => p.created || 0));
    if (maxCreated > lastAuto) {
      await storageRepository.setLastAutoOpenCutoff(maxCreated);
      debugLogger.websocket("INFO", "Advanced lastAutoOpenCutoff", {
        old: lastAuto,
        new: maxCreated
      });
    }
    if (candidates.length > safetyCap) {
      debugLogger.websocket("WARN", "Auto-open links capped", {
        total: candidates.length,
        opened: toOpen.length
      });
    }
  }

  // src/realtime/postConnectQueue.ts
  var queue = [];
  function enqueuePostConnect(task) {
    queue.push(task);
  }
  async function runPostConnect() {
    while (queue.length) {
      const t = queue.shift();
      try {
        await t();
      } catch {
      }
    }
  }

  // src/background/startup.ts
  async function orchestrateInitialization({
    trigger,
    connectWs
  }) {
    startCriticalKeepalive();
    try {
      const apiKey2 = await storageRepository.getApiKey();
      if (!apiKey2) {
        debugLogger.general("WARN", "No API key available, skipping initialization");
        return;
      }
      debugLogger.general("INFO", "Starting orchestrated initialization", { trigger });
      const cachedUser = await storageRepository.getUserInfoCache();
      if (cachedUser) {
        sessionCache.userInfo = cachedUser;
        debugLogger.general("INFO", "Loaded user info from cache");
      }
      const userP = getUserInfoWithTimeoutRetry(apiKey2).then(async (u) => {
        sessionCache.userInfo = u;
        await storageRepository.setUserInfoCache(u);
        debugLogger.general("INFO", "User info fetched and cached");
      }).catch((e) => {
        debugLogger.api("WARN", "users/me timed out or failed; using cache if present", { error: String(e) });
      });
      const devicesP = fetchDevices(apiKey2).then((d) => {
        sessionCache.devices = d;
        debugLogger.general("INFO", "Devices fetched", { count: d.length });
      });
      const pushesP = fetchRecentPushes(apiKey2).then((p) => {
        sessionCache.recentPushes = p;
        debugLogger.general("INFO", "Recent pushes fetched", { count: p.length });
      });
      const wsP = Promise.resolve().then(() => connectWs());
      const results = await Promise.allSettled([devicesP, pushesP, wsP]);
      debugLogger.general("INFO", "Functional ready: devices, pushes, ws initialized", {
        trigger,
        results: results.map((r, i) => ({ index: i, status: r.status }))
      });
      await userP.catch(() => {
      });
      enqueuePostConnect(async () => {
        debugLogger.general("INFO", "Running post-connect task: device registration and chats");
      });
      debugLogger.general("INFO", "Orchestrated initialization complete", { trigger });
    } catch (error) {
      debugLogger.general("ERROR", "Orchestrated initialization failed", {
        trigger,
        error: error.message
      });
      throw error;
    } finally {
      stopCriticalKeepalive();
    }
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
  globalEventBus.on("websocket:tickle:push", async () => {
    try {
      await refreshPushes(notificationDataStore);
    } catch (error) {
      if (error.name === "InvalidCursorError") {
        debugLogger.general(
          "WARN",
          "Caught invalid cursor error - triggering recovery"
        );
        const apiKey2 = getApiKey();
        if (apiKey2) {
          await handleInvalidCursorRecovery(apiKey2, connectWebSocket);
        }
      } else {
        debugLogger.general(
          "ERROR",
          "Error refreshing pushes",
          null,
          error
        );
      }
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
    await ensureConfigLoaded();
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
          debugLogger.general("DEBUG", "FULL DECRYPTED PUSH DATA", {
            completeData: decryptedPush
          });
        } else {
          debugLogger.general("WARN", "Cannot decrypt push - no encryption password set");
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
      debugLogger.general("WARN", "Skipping encrypted push due to decryption failure", {
        pushIden: push.iden,
        hasEncryptionPassword: !!await storageRepository.getEncryptionPassword()
      });
      return;
    }
    if (!decryptedPush.type) {
      debugLogger.general("ERROR", "Push has no type field after decryption", {
        pushIden: decryptedPush.iden,
        pushData: decryptedPush
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
          // Include full push data for investigation
          fullPushData: decryptedPush
        });
      }
      return;
    }
    debugLogger.general("INFO", "Processing supported push type", {
      pushType: decryptedPush.type,
      pushIden: decryptedPush.iden
    });
    if (decryptedPush.type === "mirror") {
      debugLogger.general("DEBUG", "FULL MIRROR MESSAGE DATA", {
        completeMirrorData: decryptedPush
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
      debugLogger.general("INFO", "Auto-opening link push", {
        pushIden: decryptedPush.iden,
        url: decryptedPush.url
      });
      chrome.tabs.create({
        url: decryptedPush.url,
        active: false
        // Open in background to avoid disrupting user
      }).catch((error) => {
        debugLogger.general(
          "ERROR",
          "Failed to auto-open link",
          {
            url: decryptedPush.url
          },
          error
        );
      });
    }
  });
  globalEventBus.on("websocket:connected", async () => {
    debugLogger.websocket(
      "INFO",
      "WebSocket connected - checking for offline links to open"
    );
    const recoveryTime = Date.now() - recoveryTimerStart;
    debugLogger.performance("INFO", "WebSocket recovery time", {
      duration: recoveryTime
    });
    const { recoveryTimings = [] } = await chrome.storage.local.get("recoveryTimings");
    recoveryTimings.push(recoveryTime);
    await chrome.storage.local.set({
      recoveryTimings: recoveryTimings.slice(-20)
    });
    stateMachine.transition("WS_CONNECTED");
    void runPostConnect();
    try {
      const apiKey2 = getApiKey();
      if (!apiKey2) {
        debugLogger.general("WARN", "No API key for auto-open links");
        return;
      }
      const sessionCutoff = sessionCache.lastModifiedCutoff || await storageRepository.getLastModifiedCutoff() || 0;
      await autoOpenOfflineLinks(apiKey2, sessionCutoff);
    } catch (e) {
      debugLogger.general("ERROR", "Auto-open on reconnect failed", {
        error: e.message
      });
    }
  });
  globalEventBus.on("websocket:disconnected", () => {
    stateMachine.transition("WS_DISCONNECTED");
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
  var recoveryTimerStart = 0;
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
    recoveryTimerStart = Date.now();
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
      const apiKey2 = getApiKey();
      if (!apiKey2) {
        debugLogger.general("WARN", "Keepalive: API key missing, reloading");
        await ensureConfigLoaded();
      }
      return;
    }
    if (alarm.name === "logFlush") {
      await debugLogger.flush();
      return;
    }
    await stateMachineReady;
    if (alarm.name === "websocketHealthCheck") {
      if (stateMachine.isInState("error" /* ERROR */)) {
        debugLogger.general("INFO", "In ERROR state, ignoring health check.");
        return;
      }
      await ensureConfigLoaded();
      if (stateMachine.isInState("degraded" /* DEGRADED */)) {
        await performPollingFetch();
        const failures = performanceMonitor.getQualityMetrics().consecutiveFailures;
        const FAILURE_THRESHOLD = 5;
        if (failures >= FAILURE_THRESHOLD) {
          debugLogger.general(
            "ERROR",
            `Exceeded failure threshold (${failures} consecutive failures). Escalating to ERROR state.`
          );
          await stateMachine.transition("WS_PERMANENT_ERROR");
        } else {
          debugLogger.general(
            "INFO",
            "Health check found us in DEGRADED state. Attempting to reconnect."
          );
          await stateMachine.transition("ATTEMPT_RECONNECT");
        }
      } else {
        performWebSocketHealthCheck(websocketClient2, connectWebSocket);
      }
    }
  });
  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    await ensureConfigLoaded();
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
    if (message.type === "GET_PUSH_DATA") {
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
          await ensureConfigLoaded();
          const storedApiKey = await storageRepository.getApiKey();
          if (storedApiKey && !sessionCache.isAuthenticated) {
            debugLogger.general(
              "WARN",
              "Service worker wake-up detected - reloading session from storage."
            );
            await initializeSessionCache("onMessageWakeup", connectWebSocket, {
              setApiKey,
              setDeviceIden,
              setAutoOpenLinks,
              setNotificationTimeout,
              setDeviceNickname
            });
          }
          sendResponse({
            isAuthenticated: sessionCache.isAuthenticated,
            userInfo: sessionCache.userInfo,
            devices: sessionCache.devices,
            recentPushes: sessionCache.recentPushes,
            chats: sessionCache.chats || [],
            // ← ADD THIS
            autoOpenLinks: getAutoOpenLinks(),
            deviceNickname: getDeviceNickname(),
            websocketConnected: websocketClient2 ? websocketClient2.isConnected() : false
          });
        } catch (error) {
          debugLogger.general(
            "ERROR",
            "Error handling getSessionData after wake-up",
            null,
            error
          );
          sendResponse({
            isAuthenticated: false,
            error: error.message
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
          // ← ADD THIS
          autoOpenLinks: sessionCache.autoOpenLinks,
          deviceNickname: sessionCache.deviceNickname,
          websocketConnected: websocketClient2 ? websocketClient2.isConnected() : false
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
        sendResponse({ success: true });
      }).catch((error) => {
        debugLogger.general("ERROR", "Error during logout", null, error);
        sendResponse({ success: false, error: error.message });
      });
      return true;
    } else if (message.action === "refreshSession" /* REFRESH_SESSION */) {
      (async () => {
        await ensureConfigLoaded();
        const apiKey2 = getApiKey();
        if (apiKey2) {
          refreshSessionCache(apiKey2).then(() => {
            sendResponse({
              isAuthenticated: true,
              userInfo: sessionCache.userInfo,
              devices: sessionCache.devices,
              recentPushes: sessionCache.recentPushes,
              chats: sessionCache.chats || [],
              // ← ADD THIS
              autoOpenLinks: sessionCache.autoOpenLinks,
              deviceNickname: sessionCache.deviceNickname
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
      if (message.settings?.deviceNickname) {
        const newNickname = message.settings.deviceNickname;
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
      if (message.autoOpenLinks !== void 0) {
        setAutoOpenLinks(message.autoOpenLinks);
        sessionCache.autoOpenLinks = message.autoOpenLinks;
        promises.push(storageRepository.setAutoOpenLinks(message.autoOpenLinks));
      }
      if (message.notificationTimeout !== void 0) {
        setNotificationTimeout(message.notificationTimeout);
        promises.push(
          storageRepository.setNotificationTimeout(message.notificationTimeout)
        );
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
        await ensureConfigLoaded();
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
        const { restarts = 0, recoveryTimings = [] } = await chrome.storage.local.get(["restarts", "recoveryTimings"]);
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
    } else if (message.action === "sendPush" /* SEND_PUSH */) {
      (async () => {
        try {
          await ensureConfigLoaded();
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
          const response = await fetch("https://api.pushbullet.com/v2/pushes", {
            method: "POST",
            headers: {
              "Access-Token": apiKey2,
              "Content-Type": "application/json"
            },
            body: JSON.stringify(pushData)
          });
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
      websocketConnected: websocketClient2 ? websocketClient2.isConnected() : false
    };
  };
  debugLogger.general("INFO", "Background service worker initialized", {
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  });
  async function bootstrap(trigger) {
    debugLogger.general("INFO", "Bootstrap start", { trigger });
    void orchestrateInitialization({ trigger, connectWs: connectWebSocket });
  }
  chrome.runtime.onStartup.addListener(() => {
    void bootstrap("startup");
  });
  chrome.runtime.onInstalled.addListener(() => {
    void bootstrap("install");
  });
})();
//# sourceMappingURL=background.js.map
