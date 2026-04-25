/**
 * Debug Dashboard
 */

import { getElementById } from '../lib/ui/dom';
import { MessageAction } from '../types/domain';

// Type definitions
interface DebugSummary {
  success: boolean;
  summary: {
    totalLogs: number;
    logs: LogEntry[];
    performance: PerformanceData;
    initializationStats: InitializationStats;
    mv3LifecycleStats?: Mv3LifecycleStats;
    errors: ErrorData;
    config: DebugConfig;
    websocketState: WebSocketState;
  };
}

interface LogEntry {
  timestamp: string;
  category: string;
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  message: string;
  data?: unknown;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

interface PerformanceData {
  websocket?: {
    connectionAttempts: number;
    successfulConnections: number;
    messagesReceived: number;
    reconnectionAttempts: number;
    lastConnectionTime?: number;
  };
  qualityMetrics?: {
    averageLatency?: number;
    minLatency?: number;
    maxLatency?: number;
    connectionUptime: number;
    currentUptime: number;
    disconnectionCount: number;
    healthChecksPassed: number;
    healthChecksFailed: number;
    consecutiveFailures: number;
  };
  notifications?: {
    pushesReceived: number;
    notificationsCreated: number;
    notificationsFailed: number;
    averageProcessingTime?: number;
  };
}

interface InitializationStats {
  stats: {
    total: number;
    onInstalled: number;
    onStartup: number;
    serviceWorkerWakeup: number;
    unknown: number;
    lastInitialization?: number;
    recentInitializations?: Array<{
      source: string;
      timestamp: number;
    }>;
  };
}

interface Mv3LifecycleStats {
  restarts: number;
  wakeUpTriggers: {
    onInstalled?: number;
    onStartup?: number;
    onAlarm?: number;
    onMessage?: number;
  };
  avgRecoveryTime: string;
}

interface ErrorData {
  total: number;
  critical: number;
  last24h: number;
  lastHour: number;
  topErrors?: Array<{
    error: string;
    count: number;
  }>;
  recentCritical?: Array<{
    name: string;
    message: string;
    category: string;
    timestamp: number;
    stack?: string;
  }>;
}

interface DebugConfig {
  enabled: boolean;
  [key: string]: unknown;
}

interface WebSocketState {
  current: {
    stateText: string;
    readyState?: string;
    stateMachineState?: string;
    stateMachineDescription?: string;
  };
  lastCheck?: string;
  historyLength?: number;
  [key: string]: unknown;
}

/**
 * Log level hierarchy map.
 * Each key is a log level, and the value is an array of levels that should be visible
 * when that level is selected in the filter.
 *
 * Hierarchy (least to most severe): DEBUG < INFO < WARN < ERROR
 *
 * Examples:
 * - Selecting DEBUG shows all levels (nothing is filtered out)
 * - Selecting WARN shows WARN and ERROR only
 * - Selecting ERROR shows only ERROR
 */
const LOG_LEVEL_HIERARCHY: Record<string, string[]> = {
  DEBUG: ["DEBUG", "INFO", "WARN", "ERROR"], // Show everything
  INFO: ["INFO", "WARN", "ERROR"], // Show INFO and above
  WARN: ["WARN", "ERROR"], // Show WARN and above
  ERROR: ["ERROR"], // Show only ERROR
};

/**
 * Check if a log entry should be visible based on the selected filter level.
 * Uses hierarchical filtering where selecting a level shows that level plus all more severe levels.
 *
 * @param logLevel - The level of the log entry (DEBUG, INFO, WARN, ERROR)
 * @param filterLevel - The currently selected filter level (or empty string for "All")
 * @returns True if the log should be shown, false if it should be filtered out
 *
 * @example
 * // Filter is set to "WARN"
 * shouldShowLogByLevel('DEBUG', 'WARN')  // false (DEBUG is less severe than WARN)
 * shouldShowLogByLevel('INFO', 'WARN')   // false (INFO is less severe than WARN)
 * shouldShowLogByLevel('WARN', 'WARN')   // true (WARN matches)
 * shouldShowLogByLevel('ERROR', 'WARN')  // true (ERROR is more severe than WARN)
 */
function shouldShowLogByLevel(logLevel: string, filterLevel: string): boolean {
  // If no filter is selected (empty string or "All"), show everything
  if (!filterLevel || filterLevel === "") {
    return true;
  }

  // Get the array of levels that should be visible for this filter
  const allowedLevels = LOG_LEVEL_HIERARCHY[filterLevel];

  // If the filter level is not in our hierarchy map, show everything (fail-safe)
  if (!allowedLevels) {
    console.warn(`Unknown filter level: ${filterLevel}, showing all logs`);
    return true;
  }

  // Check if the log's level is in the allowed levels array
  return allowedLevels.includes(logLevel);
}

// DOM Elements
const refreshBtn = getElementById<HTMLButtonElement>('refresh-btn');
const exportJsonBtn = getElementById<HTMLButtonElement>('export-json-btn');
const exportTextBtn = getElementById<HTMLButtonElement>('export-text-btn');
const clearLogsBtn = getElementById<HTMLButtonElement>('clear-logs-btn');
const closeBtn = getElementById<HTMLButtonElement>('close-btn');
const autoRefreshToggle = getElementById<HTMLInputElement>('auto-refresh-toggle');
const debugToggle = getElementById<HTMLInputElement>('debug-toggle');
const debugStatusText = getElementById<HTMLSpanElement>('debug-status-text');
const lastUpdatedSpan = getElementById<HTMLSpanElement>('last-updated');


const totalLogsEl = getElementById<HTMLSpanElement>('total-logs');
const errorCountEl = getElementById<HTMLSpanElement>('error-count');
const websocketStatusEl = getElementById<HTMLSpanElement>('websocket-status'); // Now displays state machine status

// Tab elements
const tabBtns = document.querySelectorAll<HTMLButtonElement>('.tab-btn');
const tabPanes = document.querySelectorAll<HTMLDivElement>('.tab-pane');

// Logs tab elements
const logCategoryFilter = getElementById<HTMLSelectElement>('log-category-filter');
const logLevelFilter = getElementById<HTMLSelectElement>('log-level-filter');
const logCountSelect = getElementById<HTMLSelectElement>('log-count-select');
const logMessageFilter = getElementById<HTMLInputElement>('log-message-filter');
const logsContainer = getElementById<HTMLDivElement>('logs-container');

// Performance tab elements
const websocketMetricsEl = getElementById<HTMLDivElement>('websocket-metrics');
const qualityMetricsEl = getElementById<HTMLDivElement>('quality-metrics');
const notificationMetricsEl = getElementById<HTMLDivElement>('notification-metrics');
const initializationStatsEl = getElementById<HTMLDivElement>('initialization-stats');
const mv3LifecycleMetricsEl = getElementById<HTMLDivElement>('mv3-lifecycle-metrics');

// Errors tab elements
const errorSummaryEl = getElementById<HTMLDivElement>('error-summary');
const criticalErrorsEl = getElementById<HTMLDivElement>('critical-errors');

// Config tab elements
const debugConfigEl = getElementById<HTMLDivElement>('debug-config');
const systemInfoEl = getElementById<HTMLDivElement>('system-info');

// State
let autoRefreshInterval: number | null = null;
let currentData: DebugSummary['summary'] | null = null;

const VALID_LOG_LEVELS = new Set<string>(['DEBUG', 'INFO', 'WARN', 'ERROR']);

function safeLogLevel(level: string): LogEntry['level'] {
  if (VALID_LOG_LEVELS.has(level)) {
    return level as LogEntry['level'];
  }

  return 'INFO';
}

function renderLoading(element: HTMLElement, message: string): void {
  const loading = document.createElement('p');
  loading.className = 'loading';
  loading.textContent = message;
  element.replaceChildren(loading);
}

function stringifyForDisplay(value: unknown): string {
  try {
    const rendered = JSON.stringify(value, null, 2);
    return rendered ?? '';
  } catch {
    return '[Unable to render value]';
  }
}

function appendMetricRow(
  container: HTMLElement,
  label: string,
  value: string,
  valueClass?: string,
): void {
  const row = document.createElement('p');
  const strong = document.createElement('strong');
  const span = document.createElement('span');

  strong.textContent = `${label}:`;
  span.textContent = value;

  if (valueClass) {
    span.className = valueClass;
  }

  row.append(strong, document.createTextNode(' '), span);
  container.appendChild(row);
}

function appendTextRow(container: HTMLElement, label: string, value: string): void {
  const row = document.createElement('p');
  const strong = document.createElement('strong');

  strong.textContent = `${label}:`;
  row.append(strong, document.createTextNode(` ${value}`));
  container.appendChild(row);
}

function appendDivider(container: HTMLElement, margin: string): void {
  const divider = document.createElement('hr');
  divider.style.margin = margin;
  divider.style.borderColor = '#444';
  container.appendChild(divider);
}

function appendSectionLabel(container: HTMLElement, label: string): void {
  const sectionLabel = document.createElement('p');
  sectionLabel.style.fontSize = '11px';
  sectionLabel.style.color = '#888';
  sectionLabel.style.marginBottom = '5px';
  sectionLabel.textContent = label;
  container.appendChild(sectionLabel);
}

function appendPre(container: HTMLElement, text: string, className?: string): void {
  const pre = document.createElement('pre');
  if (className) {
    pre.className = className;
  }
  pre.textContent = text;
  container.appendChild(pre);
}

/**
 * Set up event listeners
 */
function setupEventListeners(): void {
  // Refresh button
  refreshBtn.addEventListener('click', () => {
    loadDashboardData();
  });

  // Export buttons
  exportJsonBtn.addEventListener('click', () => {
    exportData('json');
  });

  exportTextBtn.addEventListener('click', () => {
    exportData('text');
  });

  // Clear logs button
  clearLogsBtn.addEventListener('click', () => {
    if (confirm('Are you sure you want to permanently delete all logs?')) {
      chrome.runtime.sendMessage({ action: MessageAction.CLEAR_ALL_LOGS }, (response) => {
        if (response && response.success) {
          // Refresh the dashboard to show the empty logs
          loadDashboardData();
        } else {
          showError('Failed to clear logs.');
        }
      });
    }
  });

  // Debug toggle switch
  debugToggle.addEventListener('change', () => {
    const enabled = debugToggle.checked;
    debugStatusText.textContent = enabled ? 'Enabled' : 'Disabled';

    // Send message to background to update debug config
    chrome.runtime.sendMessage({
      action: MessageAction.UPDATE_DEBUG_CONFIG,
      config: { enabled }
    }, (response) => {
      if (response && response.success) {
        // Refresh dashboard to reflect new config
        loadDashboardData();
      } else {
        showError('Failed to update debug config.');
        // Revert toggle on failure
        debugToggle.checked = !enabled;
        debugStatusText.textContent = !enabled ? 'Enabled' : 'Disabled';
      }
    });
  });

  // Close button
  closeBtn.addEventListener('click', () => {
    window.close();
  });

  // Auto-refresh toggle
  autoRefreshToggle.addEventListener('change', () => {
    if (autoRefreshToggle.checked) {
      startAutoRefresh();
    } else {
      stopAutoRefresh();
    }
  });

  // Tab buttons
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabName = btn.dataset.tab;
      if (tabName) {
        switchTab(tabName);
      }
    });
  });

  // Log filters
  logCategoryFilter.addEventListener('change', () => {
    renderLogs();
  });

  logLevelFilter.addEventListener('change', () => {
    renderLogs();
  });

  logCountSelect.addEventListener('change', () => {
    loadDashboardData();
  });

  logMessageFilter.addEventListener('input', () => {
    renderLogs();
  });
}

/**
 * Switch tabs
 */
function switchTab(tabName: string): void {
  // Update tab buttons
  tabBtns.forEach(btn => {
    if (btn.dataset.tab === tabName) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // Update tab panes
  tabPanes.forEach(pane => {
    if (pane.id === `${tabName}-tab`) {
      pane.classList.add('active');
    } else {
      pane.classList.remove('active');
    }
  });
}

/**
 * Load dashboard data
 */
async function loadDashboardData(): Promise<void> {
  try {
    // Get debug summary from background script
    const response = await chrome.runtime.sendMessage({
      action: MessageAction.GET_DEBUG_SUMMARY
    }) as DebugSummary;

    if (response && response.success) {
      currentData = response.summary;
      updateDashboard(currentData);
      updateLastUpdated();
    } else {
      console.error('Failed to load debug data');
      showError('Failed to load debug data');
    }
  } catch (error) {
    console.error('Error loading dashboard data:', error);
    showError('Error loading dashboard data: ' + (error as Error).message);
  }
}

/**
 * Update dashboard with data
 */
function updateDashboard(data: DebugSummary['summary']): void {
  updateSummary(data);
  renderLogs();
  renderPerformanceMetrics(data.performance);
  renderInitializationStats(data.initializationStats);
  renderMv3LifecycleMetrics(data.mv3LifecycleStats);
  renderErrors(data.errors);
  renderConfig(data.config, data.websocketState);
}

/**
 * Update summary cards
 */
function updateSummary(data: DebugSummary['summary']): void {
  // Debug status - update toggle switch and text
  if (data.config && data.config.enabled) {
    debugToggle.checked = true;
    debugStatusText.textContent = 'Enabled';
  } else {
    debugToggle.checked = false;
    debugStatusText.textContent = 'Disabled';
  }

  // Total logs
  if (data.totalLogs !== undefined) {
    totalLogsEl.textContent = data.totalLogs.toString();
  } else if (data.logs && data.logs.length) {
    totalLogsEl.textContent = data.logs.length.toString();
  } else {
    totalLogsEl.textContent = '0';
  }

  // Error count
  if (data.errors && data.errors.last24h !== undefined) {
    errorCountEl.textContent = data.errors.last24h.toString();
  } else {
    errorCountEl.textContent = '0';
  }

  // State Machine status (replaces generic websocket status)
  if (data.websocketState && data.websocketState.current) {
    const stateMachineState = data.websocketState.current.stateMachineState || 'unknown';
    const stateDescription = data.websocketState.current.stateMachineDescription || data.websocketState.current.stateText || 'Unknown';
    websocketStatusEl.textContent = stateDescription;
    websocketStatusEl.title = `State: ${stateMachineState}`;
  } else {
    websocketStatusEl.textContent = 'Unknown';
  }
}

/**
 * Render logs
 */
function renderLogs(): void {
  if (!currentData || !currentData.logs) {
    renderLoading(logsContainer, 'No logs available');
    return;
  }

  // Apply filters
  const categoryFilter = logCategoryFilter.value;
  const levelFilter = logLevelFilter.value;
  const messageFilter = logMessageFilter.value.trim();

  let filteredLogs = currentData.logs;

  if (categoryFilter) {
    filteredLogs = filteredLogs.filter(log => log.category === categoryFilter);
  }

  // Filter by level (hierarchical - shows selected level + more severe levels)
  if (levelFilter) {
    filteredLogs = filteredLogs.filter((log) =>
      shouldShowLogByLevel(log.level, levelFilter),
    );
  }

  // Filter by message (supports regex)
  if (messageFilter) {
    try {
      // Try to use as regex (case-insensitive)
      const regex = new RegExp(messageFilter, "i");
      filteredLogs = filteredLogs.filter((log) => regex.test(log.message));
    } catch {
      // If regex is invalid, fall back to simple text search
      const lowerFilter = messageFilter.toLowerCase();
      filteredLogs = filteredLogs.filter((log) =>
        log.message.toLowerCase().includes(lowerFilter),
      );
    }
  }

  // Render logs
  if (filteredLogs.length === 0) {
    renderLoading(logsContainer, 'No logs match the current filters');
    return;
  }

  // By creating a copy with [...filteredLogs] and then reversing it,
  // we ensure the newest logs are processed first without changing the original data.
  const fragment = document.createDocumentFragment();

  [...filteredLogs].reverse().forEach(log => {
    const logLevel = safeLogLevel(log.level);
    const entry = document.createElement('div');
    entry.classList.add('log-entry', logLevel);

    const header = document.createElement('div');
    header.className = 'log-header';

    const category = document.createElement('span');
    category.className = 'log-category';
    category.textContent = `[${log.category}]`;

    const level = document.createElement('span');
    level.classList.add('log-level', logLevel);
    level.textContent = logLevel;

    header.append(category, level);

    const timestamp = document.createElement('div');
    timestamp.className = 'log-timestamp';
    timestamp.textContent = log.timestamp;

    const message = document.createElement('div');
    message.className = 'log-message';
    message.textContent = log.message;

    entry.append(header, timestamp, message);

    if (log.data !== undefined) {
      const data = document.createElement('div');
      data.className = 'log-data';
      data.textContent = stringifyForDisplay(log.data);
      entry.appendChild(data);
    }

    if (log.error) {
      const error = document.createElement('div');
      error.classList.add('log-data', 'error');
      error.textContent = `${log.error.name}: ${log.error.message}`;
      entry.appendChild(error);
    }

    fragment.appendChild(entry);
  });

  logsContainer.replaceChildren(fragment);
}

/**
 * Format duration in ms to human readable
 */
function formatDuration(ms: number): string {
  if (!ms || ms === 0) return '0s';
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

/**
 * Render performance metrics
 */
function renderPerformanceMetrics(performance: PerformanceData | undefined): void {
  if (!performance) {
    renderLoading(websocketMetricsEl, 'No data available');
    renderLoading(qualityMetricsEl, 'No data available');
    renderLoading(notificationMetricsEl, 'No data available');
    return;
  }

  // WebSocket metrics
  if (performance.websocket) {
    const ws = performance.websocket;
    websocketMetricsEl.replaceChildren();
    appendMetricRow(websocketMetricsEl, 'Connection Attempts', (ws.connectionAttempts || 0).toString());
    appendMetricRow(websocketMetricsEl, 'Successful Connections', (ws.successfulConnections || 0).toString());
    appendMetricRow(websocketMetricsEl, 'Messages Received', (ws.messagesReceived || 0).toString());
    appendMetricRow(websocketMetricsEl, 'Reconnection Attempts', (ws.reconnectionAttempts || 0).toString());
    appendMetricRow(
      websocketMetricsEl,
      'Last Connection',
      ws.lastConnectionTime ? new Date(ws.lastConnectionTime).toLocaleString() : 'Never',
    );
  } else {
    renderLoading(websocketMetricsEl, 'No websocket data available');
  }

  // Connection quality metrics
  if (performance.qualityMetrics) {
    const quality = performance.qualityMetrics;
    const healthChecks = document.createElement('p');
    const healthChecksLabel = document.createElement('strong');
    const passed = document.createElement('span');
    const failed = document.createElement('span');

    qualityMetricsEl.replaceChildren();
    appendMetricRow(
      qualityMetricsEl,
      'Average Latency',
      quality.averageLatency ? `${quality.averageLatency.toFixed(0)}ms` : 'N/A',
    );
    appendMetricRow(
      qualityMetricsEl,
      'Min/Max Latency',
      `${quality.minLatency ? quality.minLatency.toFixed(0) : 'N/A'} / ${quality.maxLatency ? quality.maxLatency.toFixed(0) : 'N/A'} ms`,
    );
    appendMetricRow(qualityMetricsEl, 'Total Uptime', formatDuration(quality.connectionUptime));
    appendMetricRow(qualityMetricsEl, 'Current Uptime', formatDuration(quality.currentUptime));
    appendMetricRow(qualityMetricsEl, 'Disconnections', (quality.disconnectionCount || 0).toString());

    healthChecksLabel.textContent = 'Health Checks:';
    passed.className = 'success';
    passed.textContent = `${quality.healthChecksPassed || 0} passed`;
    failed.className = 'error';
    failed.textContent = `${quality.healthChecksFailed || 0} failed`;
    healthChecks.append(healthChecksLabel, document.createTextNode(' '), passed, document.createTextNode(' / '), failed);
    qualityMetricsEl.appendChild(healthChecks);

    appendMetricRow(
      qualityMetricsEl,
      'Consecutive Failures',
      (quality.consecutiveFailures || 0).toString(),
      quality.consecutiveFailures > 3 ? 'error' : undefined,
    );
  } else {
    renderLoading(qualityMetricsEl, 'No quality metrics available');
  }

  // Notification metrics
  if (performance.notifications) {
    const notif = performance.notifications;
    notificationMetricsEl.replaceChildren();
    appendMetricRow(notificationMetricsEl, 'Pushes Received', (notif.pushesReceived || 0).toString());
    appendMetricRow(notificationMetricsEl, 'Notifications Created', (notif.notificationsCreated || 0).toString());
    appendMetricRow(notificationMetricsEl, 'Notifications Failed', (notif.notificationsFailed || 0).toString());
    appendMetricRow(
      notificationMetricsEl,
      'Avg Processing Time',
      notif.averageProcessingTime ? `${notif.averageProcessingTime.toFixed(2)}ms` : 'N/A',
    );
  } else {
    renderLoading(notificationMetricsEl, 'No notification metrics available');
  }
}

/**
 * Render initialization statistics
 */
function renderInitializationStats(initStats: InitializationStats | undefined): void {
  if (!initStats || !initStats.stats) {
    renderLoading(initializationStatsEl, 'No data available');
    return;
  }

  const stats = initStats.stats;
  initializationStatsEl.replaceChildren();
  appendMetricRow(initializationStatsEl, 'Total Initializations', (stats.total || 0).toString());
  appendMetricRow(initializationStatsEl, 'On Install/Update', (stats.onInstalled || 0).toString());
  appendMetricRow(initializationStatsEl, 'On Browser Startup', (stats.onStartup || 0).toString());
  appendMetricRow(initializationStatsEl, 'Service Worker Wakeup', (stats.serviceWorkerWakeup || 0).toString());
  appendMetricRow(initializationStatsEl, 'Unknown Source', (stats.unknown || 0).toString());
  appendMetricRow(
    initializationStatsEl,
    'Last Initialization',
    stats.lastInitialization ? new Date(stats.lastInitialization).toLocaleString() : 'Never',
  );

  // Show recent initializations
  if (stats.recentInitializations && stats.recentInitializations.length > 0) {
    appendDivider(initializationStatsEl, '10px 0');
    appendSectionLabel(initializationStatsEl, 'Recent (last 10):');

    stats.recentInitializations.forEach(init => {
      const row = document.createElement('p');
      const source = document.createElement('strong');

      row.style.fontSize = '12px';
      row.style.margin = '5px 0';
      source.textContent = `${init.source}:`;
      row.append(source, document.createTextNode(` ${new Date(init.timestamp).toLocaleTimeString()}`));
      initializationStatsEl.appendChild(row);
    });
  }
}

/**
 * Render MV3 lifecycle metrics
 */
function renderMv3LifecycleMetrics(stats: Mv3LifecycleStats | undefined): void {
  if (!stats) {
    renderLoading(mv3LifecycleMetricsEl, 'No MV3 stats available');
    return;
  }

  mv3LifecycleMetricsEl.replaceChildren();
  appendMetricRow(mv3LifecycleMetricsEl, 'Service Worker Restarts', (stats.restarts || 0).toString());
  appendMetricRow(mv3LifecycleMetricsEl, 'Avg. Recovery Time', stats.avgRecoveryTime || 'N/A');
  appendDivider(mv3LifecycleMetricsEl, '10px 0');
  appendSectionLabel(mv3LifecycleMetricsEl, 'Wake-up Triggers:');
  appendMetricRow(
    mv3LifecycleMetricsEl,
    'On Startup/Install',
    ((stats.wakeUpTriggers.onInstalled || 0) + (stats.wakeUpTriggers.onStartup || 0)).toString(),
  );
  appendMetricRow(mv3LifecycleMetricsEl, 'By Alarm', (stats.wakeUpTriggers.onAlarm || 0).toString());
  appendMetricRow(mv3LifecycleMetricsEl, 'By User Action', (stats.wakeUpTriggers.onMessage || 0).toString());
}

/**
 * Render errors
 */
function renderErrors(errors: ErrorData | undefined): void {
  if (!errors) {
    renderLoading(errorSummaryEl, 'No data available');
    renderLoading(criticalErrorsEl, 'No data available');
    return;
  }

  // Error summary
  errorSummaryEl.replaceChildren();
  appendMetricRow(errorSummaryEl, 'Total Errors', (errors.total || 0).toString());
  appendMetricRow(errorSummaryEl, 'Critical Errors', (errors.critical || 0).toString());
  appendMetricRow(errorSummaryEl, 'Last 24 Hours', (errors.last24h || 0).toString());
  appendMetricRow(errorSummaryEl, 'Last Hour', (errors.lastHour || 0).toString());

  // Top errors
  if (errors.topErrors && errors.topErrors.length > 0) {
    appendDivider(errorSummaryEl, '15px 0');
    errors.topErrors.forEach(err => {
      appendMetricRow(errorSummaryEl, err.error, `${err.count} occurrences`);
    });
  }

  // Critical errors
  if (errors.recentCritical && errors.recentCritical.length > 0) {
    const fragment = document.createDocumentFragment();

    errors.recentCritical.forEach(err => {
      const item = document.createElement('div');
      const title = document.createElement('h5');

      item.className = 'error-item';
      title.textContent = `${err.name || 'Error'}: ${err.message}`;
      item.appendChild(title);
      appendTextRow(item, 'Category', err.category);
      appendTextRow(item, 'Time', new Date(err.timestamp).toLocaleString());

      if (err.stack) {
        appendPre(item, err.stack);
      }

      fragment.appendChild(item);
    });

    criticalErrorsEl.replaceChildren(fragment);
  } else {
    renderLoading(criticalErrorsEl, 'No critical errors');
  }
}

/**
 * Render configuration
 */
function renderConfig(config: DebugConfig | undefined, websocketState: WebSocketState | undefined): void {
  if (!config) {
    renderLoading(debugConfigEl, 'No data available');
    return;
  }

  debugConfigEl.replaceChildren();
  appendPre(debugConfigEl, stringifyForDisplay(config));

  // System info
  if (websocketState) {
    systemInfoEl.replaceChildren();
    appendPre(systemInfoEl, stringifyForDisplay(websocketState));
  } else {
    renderLoading(systemInfoEl, 'No data available');
  }
}

/**
 * Export data
 */
async function exportData(format: 'json' | 'text'): Promise<void> {
  try {
    // Get full debug data from background
    const response = await chrome.runtime.sendMessage({
      action: MessageAction.EXPORT_DEBUG_DATA
    }) as { success: boolean; data?: unknown };

    if (!response || !response.success) {
      showError('Failed to export debug data');
      return;
    }

    const data = response.data;
    let content: string;
    let filename: string;
    let mimeType: string;

    if (format === 'json') {
      content = JSON.stringify(data, null, 2);
      filename = `pushbullet-debug-${Date.now()}.json`;
      mimeType = 'application/json';
    } else {
      // Text format
      content = formatDebugDataAsText(data as Record<string, unknown>);
      filename = `pushbullet-debug-${Date.now()}.txt`;
      mimeType = 'text/plain';
    }

    // Create download
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    console.log('Debug data exported:', filename);
  } catch (error) {
    console.error('Error exporting data:', error);
    showError('Error exporting data: ' + (error as Error).message);
  }
}

/**
 * Format debug data as text
 */
function formatDebugDataAsText(data: Record<string, unknown>): string {
  let text = '='.repeat(80) + '\n';
  text += 'PUSHBULLET DEBUG REPORT\n';
  text += '='.repeat(80) + '\n\n';
  text += `Generated: ${(data.timestamp as string) || new Date().toISOString()}\n`;
  text += `Version: ${(data.version as string) || 'Unknown'}\n\n`;

  // Debug configuration
  text += '-'.repeat(80) + '\n';
  text += 'DEBUG CONFIGURATION\n';
  text += '-'.repeat(80) + '\n';
  const debugLogs = data.debugLogs as Record<string, unknown>;
  text += JSON.stringify(debugLogs?.config, null, 2) + '\n\n';

  // System info
  text += '-'.repeat(80) + '\n';
  text += 'SYSTEM INFORMATION\n';
  text += '-'.repeat(80) + '\n';
  text += JSON.stringify(data.systemInfo, null, 2) + '\n\n';

  // Error summary
  text += '-'.repeat(80) + '\n';
  text += 'ERROR SUMMARY\n';
  text += '-'.repeat(80) + '\n';
  const errorData = data.errorData as Record<string, unknown>;
  text += JSON.stringify(errorData?.summary, null, 2) + '\n\n';

  // Performance summary
  text += '-'.repeat(80) + '\n';
  text += 'PERFORMANCE METRICS\n';
  text += '-'.repeat(80) + '\n';
  const performanceData = data.performanceData as Record<string, unknown>;
  text += JSON.stringify(performanceData?.summary, null, 2) + '\n\n';

  // Recent logs
  text += '-'.repeat(80) + '\n';
  text += 'RECENT LOGS (Last 50)\n';
  text += '-'.repeat(80) + '\n';
  const logs = (debugLogs?.logs as LogEntry[]) || [];
  const recentLogs = logs.slice(-50);
  recentLogs.forEach(log => {
    text += `[${log.timestamp}] [${log.category}:${log.level}] ${log.message}\n`;
    if (log.data) {
      text += `  Data: ${JSON.stringify(log.data)}\n`;
    }
    if (log.error) {
      text += `  Error: ${log.error.message}\n`;
    }
    text += '\n';
  });

  return text;
}

/**
 * Auto-refresh functions
 */
function startAutoRefresh(): void {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
  }
  autoRefreshInterval = window.setInterval(() => {
    loadDashboardData();
  }, 2000); // Refresh every 2 seconds
}

function stopAutoRefresh(): void {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
  }
}

/**
 * Update last updated timestamp
 */
function updateLastUpdated(): void {
  lastUpdatedSpan.textContent = new Date().toLocaleTimeString();
}

/**
 * Show error message
 */
function showError(message: string): void {
  console.error(message);
  // Could add a toast notification here
}

/**
 * Initialize dashboard
 */
function init(): void {
  console.log('Debug Dashboard loaded');

  // Set up event listeners
  setupEventListeners();

  // Load initial data
  loadDashboardData();

  // Start auto-refresh if enabled
  if (autoRefreshToggle.checked) {
    startAutoRefresh();
  }
}

// Initialize on DOM load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
