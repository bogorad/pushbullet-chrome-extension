/* Logging and debug configuration (TypeScript)
   Mirrors js/logging.js without changing behavior. */

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";
export type LogCategory =
  | "WEBSOCKET"
  | "NOTIFICATIONS"
  | "API"
  | "STORAGE"
  | "GENERAL"
  | "PERFORMANCE"
  | "ERROR";

// Persistent logging constants
const STORAGE_KEY = "persistentDebugLogs";
const MAX_PERSISTENT_LOGS = 5000; // Store the last 5000 log entries

export interface DebugConfig {
  enabled: boolean;
  categories: Record<LogCategory, boolean>;
  logLevel: LogLevel;
  maxLogEntries: number;
  sanitizeData: boolean;
}

// DEBUG TOGGLE: Default to disabled to prevent unnecessary log accumulation
export const DEBUG_CONFIG: DebugConfig = {
  enabled: false,
  categories: {
    WEBSOCKET: true,
    NOTIFICATIONS: true,
    API: true,
    STORAGE: true,
    GENERAL: true,
    PERFORMANCE: true,
    ERROR: true,
  },
  logLevel: "DEBUG",
  maxLogEntries: 1000,
  sanitizeData: true,
};

export interface LogEntry {
  timestamp: string;
  category: LogCategory;
  level: LogLevel;
  message: string;
  data: unknown | null;
  error: { name: string; message: string; stack?: string } | null;
}

export class DebugLogger {
  private logs: LogEntry[] = [];
  private startTime = Date.now();
  private performanceMarkers = new Map<string, number>();

  /**
   * Rehydrate logs from persistent storage on startup
   * This method loads logs from the previous session
   */
  async rehydrate(): Promise<void> {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      if (result[STORAGE_KEY] && Array.isArray(result[STORAGE_KEY])) {
        this.logs = result[STORAGE_KEY];
        console.log(
          `[Logger] Rehydrated ${this.logs.length} logs from persistent storage.`,
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
  async flush(): Promise<void> {
    try {
      // Circular buffer: trim to MAX_PERSISTENT_LOGS before saving
      if (this.logs.length > MAX_PERSISTENT_LOGS) {
        this.logs = this.logs.slice(this.logs.length - MAX_PERSISTENT_LOGS);
      }
      await chrome.storage.local.set({ [STORAGE_KEY]: this.logs });
    } catch (error) {
      // Don't use debugLogger here to avoid potential infinite loop
      console.error("[Logger] Failed to flush logs to storage:", error);
    }
  }

  /**
   * Clear all logs from memory and persistent storage
   * This method is called when the user clicks "Clear All Logs" in the debug dashboard
   */
  async clearLogs(): Promise<void> {
    this.logs = [];
    await this.flush();
    this.log('GENERAL', 'INFO', 'Log buffer has been cleared by the user.');
  }

  private sanitize(data: unknown): unknown {
    if (!DEBUG_CONFIG.sanitizeData) return data;
    if (typeof data === "string") {
      if (data.length > 20 && /^[a-zA-Z0-9_-]+$/.test(data)) {
        return data.substring(0, 4) + "***" + data.substring(data.length - 4);
      }
      return data;
    }
    if (data && typeof data === "object") {
      const sanitized: Record<string, unknown> | unknown[] = Array.isArray(data)
        ? []
        : {};
      for (const key in data as Record<string, unknown>) {
        if (
          key.toLowerCase().includes("token") ||
          key.toLowerCase().includes("key") ||
          key.toLowerCase().includes("password")
        ) {
          (sanitized as any)[key] = this.sanitize((data as any)[key]);
        } else {
          (sanitized as any)[key] = (data as any)[key];
        }
      }
      return sanitized;
    }
    return data;
  }

  private getTimestamp(): string {
    const now = new Date();
    const elapsed = Date.now() - this.startTime;
    return `${now.toISOString()} (+${elapsed}ms)`;
  }

  /**
   * Format data for console output to avoid [object Object]
   */
  private formatDataForConsole(data: unknown): string {
    if (typeof data === 'object' && data !== null) {
      try {
        return JSON.stringify(data, null, 2);
      } catch {
        return String(data);
      }
    }
    return String(data ?? 'null');
  }

  /**
   * Format error for console output
   */
  private formatErrorForConsole(error: Error | null): string {
    if (!error) return 'null';
    
    if (error instanceof Error) {
      return `${error.name}: ${error.message}`;
    }
    
    // Handle non-Error objects (like WebSocket Event objects)
    try {
      return JSON.stringify(error, null, 2);
    } catch {
      return String(error);
    }
  }

  log(
    category: LogCategory,
    level: LogLevel,
    message: string,
    data: unknown = null,
    error: Error | null = null,
  ) {
    if (!DEBUG_CONFIG.enabled || !DEBUG_CONFIG.categories[category]) return;
    const timestamp = this.getTimestamp();
    const entry: LogEntry = {
      timestamp,
      category,
      level,
      message,
      data: data ? this.sanitize(data) : null,
      error: error
        ? {
          name: error.name,
          message: error.message,
          stack: (error as any).stack,
        }
        : null,
    };
    if (error && level === "ERROR") {
      globalErrorTracker.trackError(
        error,
        { category, message, data: data ? this.sanitize(data) : null },
        category,
      );
    }
    this.logs.push(entry);
    // Trimming is now handled by the periodic flush() method to avoid performance overhead

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

  websocket(level: LogLevel, message: string, data?: unknown, error?: Error) {
    this.log("WEBSOCKET", level, message, data, error || null);
  }
  notifications(
    level: LogLevel,
    message: string,
    data?: unknown,
    error?: Error,
  ) {
    this.log("NOTIFICATIONS", level, message, data, error || null);
  }
  api(level: LogLevel, message: string, data?: unknown, error?: Error) {
    this.log("API", level, message, data, error || null);
  }
  storage(level: LogLevel, message: string, data?: unknown, error?: Error) {
    this.log("STORAGE", level, message, data, error || null);
  }
  general(level: LogLevel, message: string, data?: unknown, error?: Error) {
    this.log("GENERAL", level, message, data, error || null);
  }
  performance(level: LogLevel, message: string, data?: unknown, error?: Error) {
    this.log("PERFORMANCE", level, message, data, error || null);
  }
  error(message: string, data?: unknown, error?: Error) {
    this.log("ERROR", "ERROR", message, data, error || null);
  }

  startTimer(name: string) {
    this.performanceMarkers.set(name, Date.now());
    this.performance("DEBUG", `Timer started: ${name}`);
  }
  endTimer(name: string): number | null {
    const start = this.performanceMarkers.get(name);
    if (start) {
      const duration = Date.now() - start;
      this.performanceMarkers.delete(name);
      this.performance("INFO", `Timer ended: ${name}`, {
        duration: `${duration}ms`,
      });
      return duration;
    }
    this.performance("WARN", `Timer not found: ${name}`);
    return null;
  }
  getRecentLogs(count = 50, category: LogCategory | null = null) {
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
        categories: (
          Object.keys(DEBUG_CONFIG.categories) as LogCategory[]
        ).reduce((acc: Record<string, number>, cat) => {
          acc[cat] = this.logs.filter((l) => l.category === cat).length;
          return acc;
        }, {}),
        errors: this.logs.filter((l) => l.level === "ERROR").length,
      },
    };
  }
}

export const debugLogger = new DebugLogger();

// Rehydrate logs from persistent storage on startup
// We don't await this because we can't have a top-level await in a module
debugLogger.rehydrate();

export class DebugConfigManager {
  async loadConfig() {
    try {
      debugLogger.storage("DEBUG", "Loading debug configuration from storage");
      const result = await new Promise<any>((resolve) => {
        chrome.storage.local.get(["debugConfig"], (items) => resolve(items));
      });
      if (result.debugConfig) {
        Object.assign(DEBUG_CONFIG, result.debugConfig as Partial<DebugConfig>);
        debugLogger.storage(
          "INFO",
          "Debug configuration loaded from storage",
          DEBUG_CONFIG,
        );
      } else {
        debugLogger.storage(
          "INFO",
          "No stored debug configuration found - using defaults",
          DEBUG_CONFIG,
        );
      }
    } catch (error: any) {
      debugLogger.storage(
        "ERROR",
        "Failed to load debug configuration",
        null,
        error,
      );
    }
  }
  async saveConfig() {
    try {
      debugLogger.storage("DEBUG", "Saving debug configuration to storage");
      await new Promise((resolve) => {
        chrome.storage.local.set({ debugConfig: DEBUG_CONFIG }, () =>
          resolve(null),
        );
      });
      debugLogger.storage("INFO", "Debug configuration saved to storage");
    } catch (error: any) {
      debugLogger.storage(
        "ERROR",
        "Failed to save debug configuration",
        null,
        error,
      );
    }
  }
  updateConfig(updates: Partial<DebugConfig>) {
    Object.assign(DEBUG_CONFIG, updates);
    void this.saveConfig();
    debugLogger.general("INFO", "Debug configuration updated", updates);
  }
  toggleCategory(category: LogCategory) {
    if (
      Object.prototype.hasOwnProperty.call(DEBUG_CONFIG.categories, category)
    ) {
      DEBUG_CONFIG.categories[category] = !DEBUG_CONFIG.categories[category];
      void this.saveConfig();
      debugLogger.general("INFO", `Debug category ${category} toggled`, {
        category,
        enabled: DEBUG_CONFIG.categories[category],
      });
    }
  }
  setLogLevel(level: LogLevel) {
    const valid: LogLevel[] = ["DEBUG", "INFO", "WARN", "ERROR"];
    if (valid.includes(level)) {
      DEBUG_CONFIG.logLevel = level;
      void this.saveConfig();
      debugLogger.general("INFO", `Debug log level set to ${level}`);
    }
  }
  getConfig(): DebugConfig {
    return { ...DEBUG_CONFIG };
  }
  resetConfig() {
    const def: DebugConfig = {
      enabled: true,
      categories: {
        WEBSOCKET: true,
        NOTIFICATIONS: true,
        API: true,
        STORAGE: true,
        GENERAL: true,
        PERFORMANCE: true,
        ERROR: true,
      },
      logLevel: "DEBUG",
      maxLogEntries: 1000,
      sanitizeData: true,
    };
    Object.assign(DEBUG_CONFIG, def);
    void this.saveConfig();
    debugLogger.general("INFO", "Debug configuration reset to defaults");
  }
}

export const debugConfigManager = new DebugConfigManager();
void debugConfigManager.loadConfig();

export class GlobalErrorTracker {
  private errors: Array<{
    timestamp: string;
    category: string;
    message: string;
    name: string;
    stack?: string;
    context: any;
  }> = [];
  private errorCounts = new Map<string, number>();
  private criticalErrors: any[] = [];

  trackError(error: Error, context: any = {}, category = "GENERAL") {
    const entry = {
      timestamp: new Date().toISOString(),
      category,
      message: error.message,
      name: error.name,
      stack: (error as any).stack,
      context,
    };
    this.errors.push(entry);
    const count = (this.errorCounts.get(category) || 0) + 1;
    this.errorCounts.set(category, count);
    if (count >= 5) this.criticalErrors.push(entry);
  }
  getErrorSummary() {
    const byCat: Record<string, number> = {};
    this.errorCounts.forEach((v, k) => (byCat[k] = v));
    return {
      total: this.errors.length,
      byCategory: byCat,
      critical: this.criticalErrors.length,
    };
  }
  exportErrorData() {
    return { errors: this.errors.slice(-200), summary: this.getErrorSummary() };
  }
}

export const globalErrorTracker = new GlobalErrorTracker();

// Attach listeners in SW environment; swallow if not available
try {
  self.addEventListener("error", (event: ErrorEvent) => {
    globalErrorTracker.trackError(
      (event as any).error || new Error(event.message),
      {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        type: "unhandled",
      },
      "GLOBAL",
    );
  });
} catch {
  /* noop */
}
try {
  self.addEventListener(
    "unhandledrejection",
    (event: PromiseRejectionEvent) => {
      globalErrorTracker.trackError(
        (event as any).reason || new Error("Unhandled promise rejection"),
        { type: "unhandled_promise" },
        "GLOBAL",
      );
    },
  );
} catch {
  /* noop */
}
