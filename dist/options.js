"use strict";
(() => {
  // src/lib/ui/dom.ts
  function getElementById(id) {
    const element = document.getElementById(id);
    if (!element) {
      throw new Error(`Element with id "${id}" not found`);
    }
    return element;
  }
  function show(element) {
    element.style.display = "";
  }
  function hide(element) {
    element.style.display = "none";
  }
  function showStatus(element, message, type = "info") {
    element.textContent = message;
    element.className = `status-message status-${type}`;
    show(element);
    setTimeout(() => {
      hide(element);
    }, 3e3);
  }

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
    getSessionStorage() {
      return chrome.storage.session;
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
    async getJevApiKey() {
      const result = await chrome.storage.local.get(["jevApiKey"]);
      const v = getStringOrNull(result.jevApiKey);
      return v && v.trim().length > 0 ? v : null;
    }
    async setJevApiKey(key) {
      if (key === null || key.trim().length === 0) {
        await chrome.storage.local.remove(["jevApiKey"]);
      } else {
        await chrome.storage.local.set({ jevApiKey: key });
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
     * Get Encryption Password from local storage.
     * Security: PSKs are stored locally and never synced.
     */
    async getEncryptionPassword() {
      const localResult = await chrome.storage.local.get([ENCRYPTION_PASSWORD_KEY]);
      const localPassword = getStringOrNull(localResult[ENCRYPTION_PASSWORD_KEY]);
      if (localPassword !== null) {
        return localPassword;
      }
      const sessionStorage = this.getSessionStorage();
      if (!sessionStorage) {
        return null;
      }
      const sessionResult = await sessionStorage.get([ENCRYPTION_PASSWORD_KEY]);
      const sessionPassword = getStringOrNull(sessionResult[ENCRYPTION_PASSWORD_KEY]);
      if (sessionPassword === null) {
        return null;
      }
      await chrome.storage.local.set({ [ENCRYPTION_PASSWORD_KEY]: sessionPassword });
      await sessionStorage.remove([ENCRYPTION_PASSWORD_KEY]);
      return sessionPassword;
    }
    /**
     * Set Encryption Password in local storage.
     * Security: PSKs are stored locally and never synced.
     */
    async setEncryptionPassword(password) {
      const sessionStorage = this.getSessionStorage();
      if (password === null) {
        await Promise.all([
          sessionStorage?.remove([ENCRYPTION_PASSWORD_KEY]) ?? Promise.resolve(),
          chrome.storage.local.remove([ENCRYPTION_PASSWORD_KEY])
        ]);
      } else {
        await Promise.all([
          chrome.storage.local.set({ [ENCRYPTION_PASSWORD_KEY]: password }),
          sessionStorage?.remove([ENCRYPTION_PASSWORD_KEY]) ?? Promise.resolve()
        ]);
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

  // src/app/api/jev.ts
  var JEV_TIMEOUT_MS = 8e3;
  var JEV_MODELS_ENDPOINT = "https://api.typesafe.ai/v1/models";
  async function verifyJevApiKey(apiKey, options = {}) {
    const candidate = apiKey.trim();
    if (candidate.length === 0) {
      return { kind: "invalid", status: 0 };
    }
    const fetchFn = options.fetchFn ?? fetch;
    const timeoutMs = options.timeoutMs ?? JEV_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchFn(JEV_MODELS_ENDPOINT, {
        method: "GET",
        headers: { Authorization: `Bearer ${candidate}` },
        signal: controller.signal
      });
      if (response.ok) {
        return { kind: "valid" };
      }
      if (response.status === 401 || response.status === 403) {
        debugLogger.api("WARN", "Jev API key verification rejected", { status: response.status });
        return { kind: "invalid", status: response.status };
      }
      debugLogger.api("WARN", "Jev API key verification failed", { status: response.status });
      return { kind: "network-error" };
    } catch (error) {
      if (controller.signal.aborted || typeof error === "object" && error !== null && "name" in error && error.name === "AbortError") {
        return { kind: "timeout" };
      }
      debugLogger.api("WARN", "Jev API key verification request failed", {});
      return { kind: "network-error" };
    } finally {
      clearTimeout(timer);
    }
  }

  // src/options/index.ts
  var deviceNicknameInput = getElementById("device-nickname");
  var updateNicknameButton = getElementById("update-nickname");
  var notificationTimeoutInput = getElementById("notification-timeout");
  var autoOpenLinksCheckbox = getElementById("auto-open-links");
  var autoOpenLinksOnReconnectCheckbox = getElementById("auto-open-links-on-reconnect");
  var encryptionPasswordInput = getElementById("encryption-password");
  var debugModeCheckbox = getElementById("debug-mode");
  var jevApiKeyInput = getElementById("jev-api-key");
  var jevApiKeyStatus = getElementById("jev-api-key-status");
  var jevApiKeyDot = getElementById("jev-api-key-dot");
  var saveSettingsButton = getElementById("save-settings");
  var resetSettingsButton = getElementById("reset-settings");
  var forceWakeBtn = getElementById("force-wake");
  var onlyThisDeviceCheckbox = getElementById("only-this-device");
  var statusMessage = getElementById("status-message");
  var versionSpan = getElementById("version");
  var DEFAULT_SETTINGS = {
    deviceNickname: "Chrome",
    notificationTimeout: 1e4,
    // 10 seconds in milliseconds
    autoOpenLinks: true,
    autoOpenLinksOnReconnect: false,
    // Off by default for safety
    encryptionPassword: "",
    // E2EE password (stored in session storage when supported)
    debugMode: true
  };
  function showStatus2(message, type) {
    showStatus(statusMessage, message, type);
  }
  async function loadSettings() {
    try {
      const deviceNickname = await storageRepository.getDeviceNickname();
      const notificationTimeout = await storageRepository.getNotificationTimeout();
      const autoOpenLinks = await storageRepository.getAutoOpenLinks();
      const autoOpenLinksOnReconnect = await storageRepository.getAutoOpenLinksOnReconnect();
      const onlyThisDevice = await storageRepository.getOnlyThisDevice();
      const encryptionPassword = await storageRepository.getEncryptionPassword();
      const jevApiKey = await storageRepository.getJevApiKey();
      deviceNicknameInput.value = deviceNickname || DEFAULT_SETTINGS.deviceNickname;
      notificationTimeoutInput.value = Math.round(notificationTimeout / 1e3).toString();
      autoOpenLinksCheckbox.checked = autoOpenLinks;
      autoOpenLinksOnReconnectCheckbox.checked = autoOpenLinksOnReconnect;
      onlyThisDeviceCheckbox.checked = onlyThisDevice;
      encryptionPasswordInput.value = encryptionPassword || DEFAULT_SETTINGS.encryptionPassword;
      jevApiKeyInput.value = jevApiKey || "";
      storedJevApiKey = jevApiKey && jevApiKey.trim().length > 0 ? jevApiKey : null;
      if (storedJevApiKey) {
        setJevKeyStatus("neutral", "Saved Jev API key \u2014 verifying\u2026");
        void verifyAndStoreJevApiKey(storedJevApiKey);
      } else {
        setJevKeyStatus("neutral", "");
      }
      debugModeCheckbox.checked = DEFAULT_SETTINGS.debugMode;
      const manifest = chrome.runtime.getManifest();
      versionSpan.textContent = manifest.version;
      console.log("Settings loaded successfully");
    } catch (error) {
      console.error("Error loading settings:", error);
      showStatus2("Error loading settings", "error");
    }
  }
  async function updateNickname() {
    const nickname = deviceNicknameInput.value.trim();
    if (!nickname) {
      showStatus2("Please enter a device nickname", "error");
      return;
    }
    try {
      await storageRepository.setDeviceNickname(nickname);
      chrome.runtime.sendMessage({
        action: "updateDeviceNickname" /* UPDATE_DEVICE_NICKNAME */,
        nickname
      });
      showStatus2("Device nickname updated successfully", "success");
    } catch (error) {
      console.error("Error updating nickname:", error);
      showStatus2("Error updating device nickname", "error");
    }
  }
  async function saveNotificationTimeout() {
    const seconds = parseInt(notificationTimeoutInput.value, 10);
    if (isNaN(seconds) || seconds < 0 || seconds > 60) {
      showStatus2("Timeout must be between 0 and 60 seconds", "error");
      return;
    }
    const milliseconds = seconds * 1e3;
    try {
      await storageRepository.setNotificationTimeout(milliseconds);
      showStatus2("Notification timeout updated", "success");
    } catch (error) {
      console.error("Error saving notification timeout:", error);
      showStatus2("Error saving notification timeout", "error");
    }
  }
  async function saveAutoOpenLinks() {
    const enabled = autoOpenLinksCheckbox.checked;
    try {
      await storageRepository.setAutoOpenLinks(enabled);
      chrome.runtime.sendMessage({
        action: "settingsChanged" /* SETTINGS_CHANGED */,
        settings: {
          autoOpenLinks: enabled
        }
      });
      showStatus2("Auto-open links setting updated", "success");
    } catch (error) {
      console.error("Error saving auto-open links:", error);
      showStatus2("Error saving auto-open links setting", "error");
    }
  }
  async function saveAutoOpenLinksOnReconnect() {
    const enabled = autoOpenLinksOnReconnectCheckbox.checked;
    try {
      await storageRepository.setAutoOpenLinksOnReconnect(enabled);
      showStatus2("Auto-open links on reconnect setting updated", "success");
    } catch (error) {
      console.error("Error saving auto-open links on reconnect:", error);
      showStatus2("Error saving auto-open links on reconnect setting", "error");
    }
  }
  async function saveOnlyThisDevice() {
    const enabled = onlyThisDeviceCheckbox.checked;
    try {
      await storageRepository.setOnlyThisDevice(enabled);
      chrome.runtime.sendMessage({
        action: "settingsChanged" /* SETTINGS_CHANGED */,
        onlyThisDevice: enabled
      });
      showStatus2("Only this device filter updated", "success");
    } catch (error) {
      console.error("Error saving only this device filter:", error);
      showStatus2("Error saving filter setting", "error");
    }
  }
  async function saveEncryptionPassword() {
    const password = encryptionPasswordInput.value.trim();
    try {
      await storageRepository.setEncryptionPassword(password);
      if (password.length > 0) {
        showStatus2("Encryption password saved locally", "success");
      } else {
        showStatus2("Encryption password cleared", "success");
      }
    } catch (error) {
      console.error("Error saving encryption password:", error);
      showStatus2("Error saving encryption password", "error");
    }
  }
  var JEV_VERIFY_DEBOUNCE_MS = 500;
  var jevVerifyTimer = null;
  var jevVerifySeq = 0;
  var storedJevApiKey = null;
  var lastVerifiedJevApiKey = null;
  function setJevKeyStatus(state, message) {
    jevApiKeyStatus.textContent = message;
    const dotState = state === "valid" ? "valid" : state === "invalid" || state === "error" ? "invalid" : state === "verifying" ? "pending" : "neutral";
    jevApiKeyDot.className = `jev-key-dot jev-key-dot--${dotState}`;
    const label = state === "valid" ? "Jev API key status: verified valid" : state === "invalid" ? "Jev API key status: invalid" : state === "error" ? "Jev API key status: verification failed" : state === "verifying" ? "Jev API key status: verifying" : "Jev API key status: not verified";
    jevApiKeyDot.title = label;
    jevApiKeyDot.setAttribute("aria-label", label);
  }
  async function verifyAndStoreJevApiKey(candidate) {
    const seq = ++jevVerifySeq;
    setJevKeyStatus("verifying", "Verifying Jev API key\u2026");
    const result = await verifyJevApiKey(candidate);
    if (seq !== jevVerifySeq) {
      return false;
    }
    if (result.kind === "valid") {
      try {
        await storageRepository.setJevApiKey(candidate);
      } catch {
        setJevKeyStatus("error", "Jev API key verified but could not be saved locally.");
        return false;
      }
      storedJevApiKey = candidate;
      lastVerifiedJevApiKey = candidate;
      setJevKeyStatus("valid", "Jev API key verified and saved locally.");
      return true;
    }
    const unchanged = storedJevApiKey ? " Previously saved key unchanged." : " Key not saved.";
    if (result.kind === "invalid") {
      setJevKeyStatus("invalid", `Invalid Jev API key (HTTP ${result.status}).${unchanged}`);
    } else if (result.kind === "timeout") {
      setJevKeyStatus("error", `Jev API key verification timed out.${unchanged}`);
    } else {
      setJevKeyStatus("error", `Jev API key verification failed (network error).${unchanged}`);
    }
    return false;
  }
  function scheduleJevApiKeyVerification(delayMs) {
    if (jevVerifyTimer !== null) {
      clearTimeout(jevVerifyTimer);
      jevVerifyTimer = null;
    }
    const current = jevApiKeyInput.value.trim();
    if (current.length > 0 && current !== lastVerifiedJevApiKey) {
      setJevKeyStatus("verifying", "Verifying Jev API key\u2026");
    }
    jevVerifyTimer = setTimeout(() => {
      jevVerifyTimer = null;
      const candidate = jevApiKeyInput.value.trim();
      if (candidate.length === 0) {
        jevVerifySeq += 1;
        void (async () => {
          try {
            await storageRepository.setJevApiKey(null);
            storedJevApiKey = null;
            lastVerifiedJevApiKey = null;
            setJevKeyStatus("neutral", "Jev API key cleared.");
          } catch {
            setJevKeyStatus("error", "Error clearing Jev API key.");
          }
        })();
        return;
      }
      if (candidate === lastVerifiedJevApiKey && candidate === storedJevApiKey) {
        setJevKeyStatus("valid", "Jev API key verified and saved locally.");
        return;
      }
      void verifyAndStoreJevApiKey(candidate);
    }, delayMs);
  }
  async function saveDebugMode() {
    const enabled = debugModeCheckbox.checked;
    try {
      const response = await chrome.runtime.sendMessage({
        action: "updateDebugConfig" /* UPDATE_DEBUG_CONFIG */,
        config: { enabled }
      });
      if (response?.success === false) {
        throw new Error(response.error || "Failed to update debug config");
      }
      showStatus2("Debug mode updated", "success");
    } catch (error) {
      console.error("Error saving debug mode:", error);
      showStatus2("Error saving debug mode", "error");
    }
  }
  async function saveAllSettings() {
    try {
      const nickname = deviceNicknameInput.value.trim();
      const seconds = parseInt(notificationTimeoutInput.value, 10);
      const autoOpen = autoOpenLinksCheckbox.checked;
      const autoOpenOnReconnect = autoOpenLinksOnReconnectCheckbox.checked;
      const debug = debugModeCheckbox.checked;
      if (!nickname) {
        showStatus2("Please enter a device nickname", "error");
        return;
      }
      if (isNaN(seconds) || seconds < 0 || seconds > 60) {
        showStatus2("Timeout must be between 0 and 60 seconds", "error");
        return;
      }
      await storageRepository.setDeviceNickname(nickname);
      await storageRepository.setNotificationTimeout(seconds * 1e3);
      await storageRepository.setAutoOpenLinks(autoOpen);
      await storageRepository.setAutoOpenLinksOnReconnect(autoOpenOnReconnect);
      const jevKey = jevApiKeyInput.value.trim();
      let jevOk = true;
      if (jevKey.length === 0) {
        await storageRepository.setJevApiKey(null);
        storedJevApiKey = null;
        lastVerifiedJevApiKey = null;
        setJevKeyStatus("neutral", "Jev API key cleared.");
      } else if (jevKey === storedJevApiKey && jevKey === lastVerifiedJevApiKey) {
        setJevKeyStatus("valid", "Jev API key verified and saved locally.");
      } else {
        jevOk = await verifyAndStoreJevApiKey(jevKey);
      }
      chrome.runtime.sendMessage({
        action: "settingsChanged" /* SETTINGS_CHANGED */,
        settings: {
          deviceNickname: nickname,
          notificationTimeout: seconds * 1e3,
          autoOpenLinks: autoOpen
        }
      });
      const debugResponse = await chrome.runtime.sendMessage({
        action: "updateDebugConfig" /* UPDATE_DEBUG_CONFIG */,
        config: { enabled: debug }
      });
      if (debugResponse?.success === false) {
        throw new Error(debugResponse.error || "Failed to update debug config");
      }
      if (!jevOk) {
        showStatus2("Settings saved, but Jev API key was not verified and not saved", "error");
        return;
      }
      showStatus2("All settings saved successfully!", "success");
    } catch (error) {
      console.error("Error saving settings:", error);
      showStatus2("Error saving settings", "error");
    }
  }
  async function resetToDefaults() {
    if (!confirm("Are you sure you want to reset all settings to defaults?")) {
      return;
    }
    try {
      await storageRepository.setDeviceNickname(DEFAULT_SETTINGS.deviceNickname);
      await storageRepository.setNotificationTimeout(DEFAULT_SETTINGS.notificationTimeout);
      await storageRepository.setAutoOpenLinks(DEFAULT_SETTINGS.autoOpenLinks);
      await storageRepository.setAutoOpenLinksOnReconnect(DEFAULT_SETTINGS.autoOpenLinksOnReconnect);
      await loadSettings();
      showStatus2("Settings reset to defaults", "success");
    } catch (error) {
      console.error("Error resetting settings:", error);
      showStatus2("Error resetting settings", "error");
    }
  }
  function init() {
    updateNicknameButton.addEventListener("click", updateNickname);
    saveSettingsButton.addEventListener("click", saveAllSettings);
    resetSettingsButton.addEventListener("click", resetToDefaults);
    forceWakeBtn.addEventListener("click", () => {
      chrome.runtime.sendMessage({ action: "attemptReconnect" /* ATTEMPT_RECONNECT */ }).then(() => {
        showStatus2("Force wake sent, check extension popup for status", "success");
      }).catch(() => {
        showStatus2("Failed to send force wake", "error");
      });
    });
    notificationTimeoutInput.addEventListener("change", () => {
      const seconds = parseInt(notificationTimeoutInput.value, 10);
      if (!isNaN(seconds) && seconds >= 0 && seconds <= 60) {
        saveNotificationTimeout();
      }
    });
    autoOpenLinksCheckbox.addEventListener("change", saveAutoOpenLinks);
    autoOpenLinksOnReconnectCheckbox.addEventListener("change", saveAutoOpenLinksOnReconnect);
    onlyThisDeviceCheckbox.addEventListener("change", saveOnlyThisDevice);
    encryptionPasswordInput.addEventListener("change", saveEncryptionPassword);
    jevApiKeyInput.addEventListener("paste", () => scheduleJevApiKeyVerification(0));
    jevApiKeyInput.addEventListener(
      "input",
      () => scheduleJevApiKeyVerification(JEV_VERIFY_DEBOUNCE_MS)
    );
    jevApiKeyInput.addEventListener("change", () => scheduleJevApiKeyVerification(0));
    debugModeCheckbox.addEventListener("change", saveDebugMode);
    loadSettings();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
//# sourceMappingURL=options.js.map
