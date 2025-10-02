// Logging and debug configuration module
// Provides: DEBUG_CONFIG, DebugLogger, debugLogger, DebugConfigManager, debugConfigManager,
// GlobalErrorTracker, globalErrorTracker, and global error handlers

// Debug configuration
const DEBUG_CONFIG = {
  enabled: true,
  categories: { WEBSOCKET: true, NOTIFICATIONS: true, API: true, STORAGE: true, GENERAL: true, PERFORMANCE: true, ERROR: true },
  logLevel: 'DEBUG',
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
  sanitize(data) {
    if (!DEBUG_CONFIG.sanitizeData) return data;
    if (typeof data === 'string') {
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
  getTimestamp() {
    const now = new Date();
    const elapsed = Date.now() - this.startTime;
    return `${now.toISOString()} (+${elapsed}ms)`;
  }
  log(category, level, message, data = null, error = null) {
    if (!DEBUG_CONFIG.enabled || !DEBUG_CONFIG.categories[category]) return;
    const timestamp = this.getTimestamp();
    const logEntry = { timestamp, category, level, message, data: data ? this.sanitize(data) : null, error: error ? { name: error.name, message: error.message, stack: error.stack } : null };
    if (error && level === 'ERROR') {
      globalErrorTracker.trackError(error, { category, message, data: data ? this.sanitize(data) : null }, category);
    }
    this.logs.push(logEntry);
    if (this.logs.length > DEBUG_CONFIG.maxLogEntries) this.logs.shift();
    const prefix = `[${category}:${level}] ${timestamp}`;
    const fullMessage = `${prefix} ${message}`;
    const sanitizedData = data ? this.sanitize(data) : null;
    switch (level) {
      case 'ERROR':
        if (sanitizedData && error) { console.error(fullMessage); console.error('  Data:', sanitizedData); console.error('  Error:', error); }
        else if (sanitizedData) { console.error(fullMessage); console.error('  Data:', sanitizedData); }
        else if (error) { console.error(fullMessage); console.error('  Error:', error); }
        else { console.error(fullMessage); }
        break;
      case 'WARN':
        if (sanitizedData) { console.warn(fullMessage); console.warn('  Data:', sanitizedData); }
        else { console.warn(fullMessage); }
        break;
      case 'INFO':
        if (sanitizedData) { console.info(fullMessage); console.info('  Data:', sanitizedData); }
        else { console.info(fullMessage); }
        break;
      default:
        if (sanitizedData) { console.log(fullMessage); console.log('  Data:', sanitizedData); }
        else { console.log(fullMessage); }
    }
  }
  websocket(level, message, data, error) { this.log('WEBSOCKET', level, message, data, error); }
  notifications(level, message, data, error) { this.log('NOTIFICATIONS', level, message, data, error); }
  api(level, message, data, error) { this.log('API', level, message, data, error); }
  storage(level, message, data, error) { this.log('STORAGE', level, message, data, error); }
  general(level, message, data, error) { this.log('GENERAL', level, message, data, error); }
  performance(level, message, data, error) { this.log('PERFORMANCE', level, message, data, error); }
  error(message, data, error) { this.log('ERROR', 'ERROR', message, data, error); }
  startTimer(name) { this.performanceMarkers.set(name, Date.now()); this.performance('DEBUG', `Timer started: ${name}`); }
  endTimer(name) {
    const startTime = this.performanceMarkers.get(name);
    if (startTime) { const duration = Date.now() - startTime; this.performanceMarkers.delete(name); this.performance('INFO', `Timer ended: ${name}`, { duration: `${duration}ms` }); return duration; }
    this.performance('WARN', `Timer not found: ${name}`); return null;
  }
  getRecentLogs(count = 50, category = null) {
    let logs = this.logs; if (category) logs = logs.filter(log => log.category === category); return logs.slice(-count);
  }
  exportLogs() {
    return { config: DEBUG_CONFIG, logs: this.logs, summary: { totalLogs: this.logs.length, categories: Object.keys(DEBUG_CONFIG.categories).reduce((acc, cat) => { acc[cat] = this.logs.filter(log => log.category === cat).length; return acc; }, {}), errors: this.logs.filter(log => log.level === 'ERROR').length } };
  }
}

const debugLogger = new DebugLogger();

class DebugConfigManager {
  async loadConfig() {
    try {
      debugLogger.storage('DEBUG', 'Loading debug configuration from storage');
      const result = await new Promise(resolve => { chrome.storage.local.get(['debugConfig'], resolve); });
      if (result.debugConfig) { Object.assign(DEBUG_CONFIG, result.debugConfig); debugLogger.storage('INFO', 'Debug configuration loaded from storage', DEBUG_CONFIG); }
      else { debugLogger.storage('INFO', 'No stored debug configuration found - using defaults', DEBUG_CONFIG); }
    } catch (error) { debugLogger.storage('ERROR', 'Failed to load debug configuration', null, error); }
  }
  async saveConfig() {
    try { debugLogger.storage('DEBUG', 'Saving debug configuration to storage'); await new Promise(resolve => { chrome.storage.local.set({ debugConfig: DEBUG_CONFIG }, resolve); }); debugLogger.storage('INFO', 'Debug configuration saved to storage'); }
    catch (error) { debugLogger.storage('ERROR', 'Failed to save debug configuration', null, error); }
  }
  updateConfig(updates) { Object.assign(DEBUG_CONFIG, updates); this.saveConfig(); debugLogger.general('INFO', 'Debug configuration updated', updates); }
  toggleCategory(category) { if (Object.prototype.hasOwnProperty.call(DEBUG_CONFIG.categories, category)) { DEBUG_CONFIG.categories[category] = !DEBUG_CONFIG.categories[category]; this.saveConfig(); debugLogger.general('INFO', `Debug category ${category} toggled`, { category, enabled: DEBUG_CONFIG.categories[category] }); } }
  setLogLevel(level) { const valid = ['DEBUG','INFO','WARN','ERROR']; if (valid.includes(level)) { DEBUG_CONFIG.logLevel = level; this.saveConfig(); debugLogger.general('INFO', `Debug log level set to ${level}`); } }
  getConfig() { return { ...DEBUG_CONFIG }; }
  resetConfig() { const def = { enabled: true, categories: { WEBSOCKET: true, NOTIFICATIONS: true, API: true, STORAGE: true, GENERAL: true, PERFORMANCE: true, ERROR: true }, logLevel: 'DEBUG', maxLogEntries: 1000, sanitizeData: true }; Object.assign(DEBUG_CONFIG, def); this.saveConfig(); debugLogger.general('INFO', 'Debug configuration reset to defaults'); }
}

const debugConfigManager = new DebugConfigManager();

debugConfigManager.loadConfig();

// Global error tracking and reporting
class GlobalErrorTracker {
  constructor() { this.errors = []; this.errorCounts = new Map(); this.criticalErrors = []; this.lastErrorReport = Date.now(); }
  trackError(error, context = {}, category = 'GENERAL') {
    const entry = { timestamp: new Date().toISOString(), category, message: error.message, name: error.name, stack: error.stack, context };
    this.errors.push(entry);
    const count = (this.errorCounts.get(category) || 0) + 1; this.errorCounts.set(category, count);
    if (count >= 5) this.criticalErrors.push(entry);
  }
  getErrorSummary() { const byCat = {}; this.errorCounts.forEach((v, k) => byCat[k] = v); return { total: this.errors.length, byCategory: byCat, critical: this.criticalErrors.length }; }
  exportErrorData() { return { errors: this.errors.slice(-200), summary: this.getErrorSummary() }; }
}

const globalErrorTracker = new GlobalErrorTracker();

self.addEventListener('error', (event) => { globalErrorTracker.trackError(event.error || new Error(event.message), { filename: event.filename, lineno: event.lineno, colno: event.colno, type: 'unhandled' }, 'GLOBAL'); });
self.addEventListener('unhandledrejection', (event) => { globalErrorTracker.trackError(event.reason || new Error('Unhandled promise rejection'), { type: 'unhandled_promise' }, 'GLOBAL'); });

