"use strict";
(() => {
  // src/lib/logging/index.ts
  var DEBUG_CONFIG = {
    enabled: true,
    categories: { WEBSOCKET: true, NOTIFICATIONS: true, API: true, STORAGE: true, GENERAL: true, PERFORMANCE: true, ERROR: true },
    logLevel: "DEBUG",
    maxLogEntries: 1e3,
    sanitizeData: true
  };
  var DebugLogger = class {
    logs = [];
    startTime = Date.now();
    performanceMarkers = /* @__PURE__ */ new Map();
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
        error: error ? { name: error.name, message: error.message, stack: error.stack } : null
      };
      if (error && level === "ERROR") {
        globalErrorTracker.trackError(error, { category, message, data: data ? this.sanitize(data) : null }, category);
      }
      this.logs.push(entry);
      if (this.logs.length > DEBUG_CONFIG.maxLogEntries) this.logs.shift();
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
        this.performance("INFO", `Timer ended: ${name}`, { duration: `${duration}ms` });
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
  var DebugConfigManager = class {
    async loadConfig() {
      try {
        debugLogger.storage("DEBUG", "Loading debug configuration from storage");
        const result = await new Promise((resolve) => {
          chrome.storage.local.get(["debugConfig"], (items) => resolve(items));
        });
        if (result.debugConfig) {
          Object.assign(DEBUG_CONFIG, result.debugConfig);
          debugLogger.storage("INFO", "Debug configuration loaded from storage", DEBUG_CONFIG);
        } else {
          debugLogger.storage("INFO", "No stored debug configuration found - using defaults", DEBUG_CONFIG);
        }
      } catch (error) {
        debugLogger.storage("ERROR", "Failed to load debug configuration", null, error);
      }
    }
    async saveConfig() {
      try {
        debugLogger.storage("DEBUG", "Saving debug configuration to storage");
        await new Promise((resolve) => {
          chrome.storage.local.set({ debugConfig: DEBUG_CONFIG }, () => resolve(null));
        });
        debugLogger.storage("INFO", "Debug configuration saved to storage");
      } catch (error) {
        debugLogger.storage("ERROR", "Failed to save debug configuration", null, error);
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
        debugLogger.general("INFO", `Debug category ${category} toggled`, { category, enabled: DEBUG_CONFIG.categories[category] });
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
      const def = { enabled: true, categories: { WEBSOCKET: true, NOTIFICATIONS: true, API: true, STORAGE: true, GENERAL: true, PERFORMANCE: true, ERROR: true }, logLevel: "DEBUG", maxLogEntries: 1e3, sanitizeData: true };
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
      const entry = { timestamp: (/* @__PURE__ */ new Date()).toISOString(), category, message: error.message, name: error.name, stack: error.stack, context };
      this.errors.push(entry);
      const count = (this.errorCounts.get(category) || 0) + 1;
      this.errorCounts.set(category, count);
      if (count >= 5) this.criticalErrors.push(entry);
    }
    getErrorSummary() {
      const byCat = {};
      this.errorCounts.forEach((v, k) => byCat[k] = v);
      return { total: this.errors.length, byCategory: byCat, critical: this.criticalErrors.length };
    }
    exportErrorData() {
      return { errors: this.errors.slice(-200), summary: this.getErrorSummary() };
    }
  };
  var globalErrorTracker = new GlobalErrorTracker();
  try {
    self.addEventListener("error", (event) => {
      globalErrorTracker.trackError(event.error || new Error(event.message), { filename: event.filename, lineno: event.lineno, colno: event.colno, type: "unhandled" }, "GLOBAL");
    });
  } catch (_) {
  }
  try {
    self.addEventListener("unhandledrejection", (event) => {
      globalErrorTracker.trackError(event.reason || new Error("Unhandled promise rejection"), { type: "unhandled_promise" }, "GLOBAL");
    });
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
    getPerformanceSummary() {
      return { websocket: this.websocketMetrics, health: this.healthChecks, quality: this.quality, metrics: Object.fromEntries(this.metrics) };
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

  // src/app/ws/client.ts
  var WebSocketClient = class {
    constructor(websocketUrl, getApiKey2) {
      this.websocketUrl = websocketUrl;
      this.getApiKey = getApiKey2;
    }
    socket = null;
    reconnectAttempts = 0;
    reconnectTimeout = null;
    handlers = {};
    /**
     * Set event handlers
     */
    setHandlers(handlers) {
      this.handlers = handlers;
    }
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
          if (this.handlers.stopPollingMode) {
            this.handlers.stopPollingMode();
          }
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
          if (this.handlers.onConnected) {
            this.handlers.onConnected();
          }
          if (this.handlers.updatePopupConnectionState) {
            this.handlers.updatePopupConnectionState("connected");
          }
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
                if (data.subtype === "push" && this.handlers.onTicklePush) {
                  await this.handlers.onTicklePush();
                } else if (data.subtype === "device" && this.handlers.onTickleDevice) {
                  await this.handlers.onTickleDevice();
                }
                break;
              case "push":
                if ("push" in data && data.push && this.handlers.onPush) {
                  await this.handlers.onPush(data.push);
                } else {
                  debugLogger.websocket("WARN", "Push message received without push payload");
                }
                break;
              case "nop":
                debugLogger.websocket("DEBUG", "Received nop (keep-alive) message", {
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
          if (this.handlers.onDisconnected) {
            this.handlers.onDisconnected();
          }
          if (this.handlers.updatePopupConnectionState) {
            this.handlers.updatePopupConnectionState("disconnected");
          }
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
          if (this.handlers.checkPollingMode) {
            this.handlers.checkPollingMode();
          }
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
  async function initializeSessionCache(source = "unknown", connectWebSocketFn, stateSetters) {
    if (initializationState.inProgress) {
      throw new Error("Initialization already in progress");
    }
    if (initializationState.completed) {
      debugLogger.general("WARN", "Already initialized, skipping", {
        source,
        previousTimestamp: initializationState.timestamp
      });
      return null;
    }
    initializationState.inProgress = true;
    try {
      debugLogger.general("INFO", "Initializing session cache", {
        source,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
      debugLogger.storage("DEBUG", "Loading initial configuration from sync storage");
      const result = await new Promise((resolve) => {
        chrome.storage.sync.get(
          ["apiKey", "deviceIden", "autoOpenLinks", "deviceNickname", "notificationTimeout"],
          (items) => resolve(items)
        );
      });
      const apiKeyValue = result.apiKey || null;
      const deviceIdenValue = result.deviceIden || null;
      if (stateSetters) {
        stateSetters.setApiKey(apiKeyValue);
        stateSetters.setDeviceIden(deviceIdenValue);
      }
      let autoOpenLinksValue = true;
      let notificationTimeoutValue = 1e4;
      let deviceNicknameValue = "Chrome";
      if (result.autoOpenLinks === void 0) {
        await chrome.storage.sync.set({ autoOpenLinks: true });
      } else {
        autoOpenLinksValue = result.autoOpenLinks;
      }
      if (result.notificationTimeout === void 0) {
        await chrome.storage.sync.set({ notificationTimeout: 1e4 });
      } else {
        notificationTimeoutValue = result.notificationTimeout;
      }
      if (result.deviceNickname === void 0 || result.deviceNickname === null) {
        await chrome.storage.sync.set({ deviceNickname: "Chrome" });
      } else {
        deviceNicknameValue = result.deviceNickname;
      }
      if (stateSetters) {
        stateSetters.setAutoOpenLinks(autoOpenLinksValue);
        stateSetters.setNotificationTimeout(notificationTimeoutValue);
        stateSetters.setDeviceNickname(deviceNicknameValue);
      }
      sessionCache.autoOpenLinks = autoOpenLinksValue;
      sessionCache.deviceNickname = deviceNicknameValue;
      debugLogger.storage("INFO", "Loaded configuration from sync storage", {
        hasApiKey: !!result.apiKey,
        hasDeviceIden: !!result.deviceIden,
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
        if (connectWebSocketFn) {
          connectWebSocketFn();
        }
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
    }
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
  function ensureConfigLoaded(stateSetters, stateGetters) {
    return new Promise((resolve) => {
      try {
        if (!stateSetters || !stateGetters) {
          resolve();
          return;
        }
        const needsApiKey = !stateGetters.getApiKey();
        const needsNickname = stateGetters.getDeviceNickname() === null || stateGetters.getDeviceNickname() === void 0;
        const needsAutoOpen = stateGetters.getAutoOpenLinks() === null || stateGetters.getAutoOpenLinks() === void 0;
        const needsTimeout = stateGetters.getNotificationTimeout() === null || stateGetters.getNotificationTimeout() === void 0;
        const needsSync = needsApiKey || needsNickname || needsAutoOpen || needsTimeout;
        const finish = () => {
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
          resolve();
        };
        const loadLocal = () => {
          chrome.storage.local.get(["deviceIden"], (lres) => {
            try {
              if (!stateGetters.getDeviceIden() && lres && lres.deviceIden) {
                stateSetters.setDeviceIden(lres.deviceIden);
              }
            } catch (err) {
            }
            finish();
          });
        };
        if (needsSync) {
          chrome.storage.sync.get(
            ["apiKey", "deviceNickname", "autoOpenLinks", "notificationTimeout"],
            (res) => {
              try {
                if (!stateGetters.getApiKey() && res && res.apiKey) {
                  stateSetters.setApiKey(res.apiKey);
                }
                if (needsNickname && res && res.deviceNickname !== void 0) {
                  stateSetters.setDeviceNickname(res.deviceNickname);
                }
                if (needsAutoOpen && res && res.autoOpenLinks !== void 0) {
                  stateSetters.setAutoOpenLinks(res.autoOpenLinks);
                }
                if (needsTimeout && res && res.notificationTimeout !== void 0) {
                  stateSetters.setNotificationTimeout(res.notificationTimeout);
                }
              } catch (err) {
              }
              loadLocal();
            }
          );
        } else {
          loadLocal();
        }
      } catch (e) {
        try {
          debugLogger.storage("WARN", "ensureConfigLoaded encountered an error", {
            error: e && e.message
          });
        } catch (err) {
        }
        resolve();
      }
    });
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
        console.error("Decryption error:", error);
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
        await showPushNotification(push, notificationDataStore2);
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
      if (pushType === "note") {
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
      } else {
        title = "Push";
        message = JSON.stringify(push).substring(0, 200);
        debugLogger.notifications("WARN", "Unknown push type", { pushType, push });
      }
      const notificationId = `pushbullet-push-${push.iden || Date.now()}`;
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
        }
      );
    } catch (error) {
      debugLogger.notifications("ERROR", "Failed to show push notification", {
        error: error.message,
        pushType: push.type
      }, error);
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
    try {
      chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({
          id: "push-link",
          title: "Push this link",
          contexts: ["link"]
        });
        chrome.contextMenus.create({
          id: "push-page",
          title: "Push this page",
          contexts: ["page"]
        });
        chrome.contextMenus.create({
          id: "push-selection",
          title: "Push selected text",
          contexts: ["selection"]
        });
        chrome.contextMenus.create({
          id: "push-image",
          title: "Push this image",
          contexts: ["image"]
        });
        debugLogger.general("INFO", "Context menu created");
      });
    } catch (error) {
      debugLogger.general("ERROR", "Failed to create context menu", null, error);
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

  // src/background/index.ts
  debugConfigManager.loadConfig();
  var notificationDataStore = /* @__PURE__ */ new Map();
  var websocketClient2 = null;
  function connectWebSocket() {
    updateConnectionIcon("connecting");
    if (!websocketClient2) {
      websocketClient2 = new WebSocketClient(WEBSOCKET_URL, getApiKey);
      setWebSocketClient(websocketClient2);
      websocketClient2.setHandlers({
        onTicklePush: async () => {
          await refreshPushes(notificationDataStore);
        },
        onTickleDevice: async () => {
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
        },
        onPush: async (push) => {
          let decryptedPush = push;
          if ("encrypted" in push && push.encrypted && "ciphertext" in push) {
            try {
              const result = await chrome.storage.local.get(["encryptionPassword"]);
              const password = result.encryptionPassword;
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
          await showPushNotification(decryptedPush, notificationDataStore);
        },
        onConnected: () => {
          stopPollingMode();
          updateConnectionIcon("connected");
        },
        onDisconnected: () => {
          updateConnectionIcon("disconnected");
        },
        checkPollingMode: () => {
          checkPollingMode();
        },
        stopPollingMode: () => {
          stopPollingMode();
        },
        updatePopupConnectionState: (state) => {
          updatePopupConnectionState(state);
        }
      });
    }
    websocketClient2.connect();
  }
  function disconnectWebSocket() {
    if (websocketClient2) {
      websocketClient2.disconnect();
    }
  }
  chrome.runtime.onInstalled.addListener(() => {
    debugLogger.general("INFO", "Pushbullet extension installed/updated", {
      reason: "onInstalled",
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
    setTimeout(() => updateConnectionIcon("disconnected"), 100);
    initTracker.recordInitialization("onInstalled");
    setupContextMenu();
    initializeSessionCache("onInstalled", connectWebSocket, {
      setApiKey,
      setDeviceIden,
      setAutoOpenLinks,
      setDeviceNickname,
      setNotificationTimeout
    });
  });
  chrome.runtime.onStartup.addListener(() => {
    debugLogger.general("INFO", "Browser started - reinitializing Pushbullet extension", {
      reason: "onStartup",
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
    setTimeout(() => updateConnectionIcon("disconnected"), 100);
    initTracker.recordInitialization("onStartup");
    setupContextMenu();
    initializeSessionCache("onStartup", connectWebSocket, {
      setApiKey,
      setDeviceIden,
      setAutoOpenLinks,
      setDeviceNickname,
      setNotificationTimeout
    });
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
    if (alarm.name === "websocketReconnect" && getApiKey()) {
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
    if (message.action === "getSessionData") {
      const apiKey2 = getApiKey();
      if (apiKey2 && !sessionCache.isAuthenticated && sessionCache.lastUpdated === 0) {
        if (initializationState.inProgress) {
          debugLogger.general("DEBUG", "Initialization already in progress - waiting for completion");
          const maxWait = 1e4;
          const startTime = Date.now();
          const checkInterval = setInterval(() => {
            if (initializationState.completed || Date.now() - startTime > maxWait) {
              clearInterval(checkInterval);
              sendResponse({
                isAuthenticated: sessionCache.isAuthenticated,
                userInfo: sessionCache.userInfo,
                devices: sessionCache.devices,
                recentPushes: sessionCache.recentPushes,
                autoOpenLinks: sessionCache.autoOpenLinks,
                deviceNickname: sessionCache.deviceNickname,
                websocketConnected: websocketClient2 ? websocketClient2.isConnected() : false
              });
            }
          }, 100);
          return true;
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
      chrome.storage.sync.set({ apiKey: message.apiKey });
      if (message.deviceNickname) {
        setDeviceNickname(message.deviceNickname);
        sessionCache.deviceNickname = message.deviceNickname;
        chrome.storage.local.set({ deviceNickname: message.deviceNickname });
      }
      refreshSessionCache(message.apiKey).then(() => {
        chrome.runtime.sendMessage({
          action: "sessionDataUpdated",
          isAuthenticated: true,
          userInfo: sessionCache.userInfo,
          devices: sessionCache.devices,
          recentPushes: sessionCache.recentPushes,
          autoOpenLinks: sessionCache.autoOpenLinks,
          deviceNickname: sessionCache.deviceNickname
        });
      }).catch((error) => {
        debugLogger.general("ERROR", "Error refreshing session cache after API key change", null, error);
      });
      connectWebSocket();
      sendResponse({ success: true });
    } else if (message.action === "logout") {
      setApiKey(null);
      setDeviceIden(null);
      sessionCache.isAuthenticated = false;
      sessionCache.userInfo = null;
      sessionCache.devices = [];
      sessionCache.recentPushes = [];
      chrome.storage.sync.remove(["apiKey"]);
      chrome.storage.local.remove(["deviceIden"]);
      disconnectWebSocket();
      sendResponse({ success: true });
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
      if (message.autoOpenLinks !== void 0) {
        setAutoOpenLinks(message.autoOpenLinks);
        sessionCache.autoOpenLinks = message.autoOpenLinks;
        chrome.storage.sync.set({ autoOpenLinks: message.autoOpenLinks });
      }
      if (message.notificationTimeout !== void 0) {
        setNotificationTimeout(message.notificationTimeout);
        chrome.storage.sync.set({ notificationTimeout: message.notificationTimeout });
      }
      sendResponse({ success: true });
    } else if (message.action === "updateDeviceNickname") {
      const apiKey2 = getApiKey();
      const deviceIden2 = getDeviceIden();
      if (apiKey2 && deviceIden2 && message.nickname) {
        updateDeviceNickname(apiKey2, deviceIden2, message.nickname).then(() => {
          setDeviceNickname(message.nickname);
          sessionCache.deviceNickname = message.nickname;
          chrome.storage.sync.set({ deviceNickname: message.nickname });
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
      const websocketState = {
        current: {
          stateText: websocketClient2 ? websocketClient2.isConnected() ? "Connected" : "Disconnected" : "Not initialized",
          readyState: wsState.currentState
        },
        lastCheck: wsState.lastCheck,
        historyLength: wsState.historyLength
      };
      const summary = {
        config: debugConfigManager.getConfig(),
        logs: logData.logs,
        // Array of log entries
        totalLogs: logData.summary.totalLogs,
        performance: performanceMonitor.exportPerformanceData(),
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
        websocketStateText: websocketState.current.stateText
      });
      sendResponse({ success: true, summary });
      return false;
    } else if (message.action === "getNotificationData") {
      const pushData = notificationDataStore.get(message.notificationId);
      if (pushData) {
        sendResponse({ success: true, push: pushData });
      } else {
        sendResponse({ success: false, error: "Notification not found" });
      }
      return false;
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
