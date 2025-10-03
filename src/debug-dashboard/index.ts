/**
 * Debug Dashboard
 */

import { getElementById, querySelector, clearChildren, setHTML } from '../lib/ui/dom';

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

// Summary elements
const debugStatusEl = getElementById<HTMLDivElement>('debug-status');
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
      chrome.runtime.sendMessage({ action: 'clearAllLogs' }, (response) => {
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
      action: 'updateDebugConfig',
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
      action: 'getDebugSummary'
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
    logsContainer.innerHTML = '<p class="loading">No logs available</p>';
    return;
  }

  // Apply filters
  const categoryFilter = logCategoryFilter.value;
  const levelFilter = logLevelFilter.value;

  let filteredLogs = currentData.logs;

  if (categoryFilter) {
    filteredLogs = filteredLogs.filter(log => log.category === categoryFilter);
  }

  if (levelFilter) {
    filteredLogs = filteredLogs.filter(log => log.level === levelFilter);
  }

  // Render logs
  if (filteredLogs.length === 0) {
    logsContainer.innerHTML = '<p class="loading">No logs match the current filters</p>';
    return;
  }

  // By creating a copy with [...filteredLogs] and then reversing it,
  // we ensure the newest logs are processed first without changing the original data.
  logsContainer.innerHTML = [...filteredLogs].reverse().map(log => {
    const dataStr = log.data ? JSON.stringify(log.data, null, 2) : '';
    const errorStr = log.error ? `${log.error.name}: ${log.error.message}` : '';

    return `
      <div class="log-entry ${log.level}">
        <div class="log-header">
          <span class="log-category">[${log.category}]</span>
          <span class="log-level ${log.level}">${log.level}</span>
        </div>
        <div class="log-timestamp">${log.timestamp}</div>
        <div class="log-message">${log.message}</div>
        ${dataStr ? `<div class="log-data">${dataStr}</div>` : ''}
        ${errorStr ? `<div class="log-data error">${errorStr}</div>` : ''}
      </div>
    `;
  }).join('');
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
    websocketMetricsEl.innerHTML = '<p class="loading">No data available</p>';
    qualityMetricsEl.innerHTML = '<p class="loading">No data available</p>';
    notificationMetricsEl.innerHTML = '<p class="loading">No data available</p>';
    return;
  }

  // WebSocket metrics
  if (performance.websocket) {
    const ws = performance.websocket;
    websocketMetricsEl.innerHTML = `
      <p><strong>Connection Attempts:</strong> <span>${ws.connectionAttempts || 0}</span></p>
      <p><strong>Successful Connections:</strong> <span>${ws.successfulConnections || 0}</span></p>
      <p><strong>Messages Received:</strong> <span>${ws.messagesReceived || 0}</span></p>
      <p><strong>Reconnection Attempts:</strong> <span>${ws.reconnectionAttempts || 0}</span></p>
      <p><strong>Last Connection:</strong> <span>${ws.lastConnectionTime ? new Date(ws.lastConnectionTime).toLocaleString() : 'Never'}</span></p>
    `;
  } else {
    websocketMetricsEl.innerHTML = '<p class="loading">No websocket data available</p>';
  }

  // Connection quality metrics
  if (performance.qualityMetrics) {
    const quality = performance.qualityMetrics;
    qualityMetricsEl.innerHTML = `
      <p><strong>Average Latency:</strong> <span>${quality.averageLatency ? quality.averageLatency.toFixed(0) + 'ms' : 'N/A'}</span></p>
      <p><strong>Min/Max Latency:</strong> <span>${quality.minLatency ? quality.minLatency.toFixed(0) : 'N/A'} / ${quality.maxLatency ? quality.maxLatency.toFixed(0) : 'N/A'} ms</span></p>
      <p><strong>Total Uptime:</strong> <span>${formatDuration(quality.connectionUptime)}</span></p>
      <p><strong>Current Uptime:</strong> <span>${formatDuration(quality.currentUptime)}</span></p>
      <p><strong>Disconnections:</strong> <span>${quality.disconnectionCount || 0}</span></p>
      <p><strong>Health Checks:</strong> <span class="success">${quality.healthChecksPassed || 0} passed</span> / <span class="error">${quality.healthChecksFailed || 0} failed</span></p>
      <p><strong>Consecutive Failures:</strong> <span class="${quality.consecutiveFailures > 3 ? 'error' : ''}">${quality.consecutiveFailures || 0}</span></p>
    `;
  } else {
    qualityMetricsEl.innerHTML = '<p class="loading">No quality metrics available</p>';
  }

  // Notification metrics
  if (performance.notifications) {
    const notif = performance.notifications;
    notificationMetricsEl.innerHTML = `
      <p><strong>Pushes Received:</strong> <span>${notif.pushesReceived || 0}</span></p>
      <p><strong>Notifications Created:</strong> <span>${notif.notificationsCreated || 0}</span></p>
      <p><strong>Notifications Failed:</strong> <span>${notif.notificationsFailed || 0}</span></p>
      <p><strong>Avg Processing Time:</strong> <span>${notif.averageProcessingTime ? notif.averageProcessingTime.toFixed(2) + 'ms' : 'N/A'}</span></p>
    `;
  } else {
    notificationMetricsEl.innerHTML = '<p class="loading">No notification metrics available</p>';
  }
}

/**
 * Render initialization statistics
 */
function renderInitializationStats(initStats: InitializationStats | undefined): void {
  if (!initStats || !initStats.stats) {
    initializationStatsEl.innerHTML = '<p class="loading">No data available</p>';
    return;
  }

  const stats = initStats.stats;
  initializationStatsEl.innerHTML = `
    <p><strong>Total Initializations:</strong> <span>${stats.total || 0}</span></p>
    <p><strong>On Install/Update:</strong> <span>${stats.onInstalled || 0}</span></p>
    <p><strong>On Browser Startup:</strong> <span>${stats.onStartup || 0}</span></p>
    <p><strong>Service Worker Wakeup:</strong> <span>${stats.serviceWorkerWakeup || 0}</span></p>
    <p><strong>Unknown Source:</strong> <span>${stats.unknown || 0}</span></p>
    <p><strong>Last Initialization:</strong> <span>${stats.lastInitialization ? new Date(stats.lastInitialization).toLocaleString() : 'Never'}</span></p>
  `;

  // Show recent initializations
  if (stats.recentInitializations && stats.recentInitializations.length > 0) {
    const recentHtml = stats.recentInitializations.map(init =>
      `<p style="font-size: 12px; margin: 5px 0;"><strong>${init.source}:</strong> ${new Date(init.timestamp).toLocaleTimeString()}</p>`
    ).join('');
    initializationStatsEl.innerHTML += '<hr style="margin: 10px 0; border-color: #444;"><p style="font-size: 11px; color: #888; margin-bottom: 5px;">Recent (last 10):</p>' + recentHtml;
  }
}

/**
 * Render MV3 lifecycle metrics
 */
function renderMv3LifecycleMetrics(stats: Mv3LifecycleStats | undefined): void {
  if (!stats) {
    mv3LifecycleMetricsEl.innerHTML = '<p class="loading">No MV3 stats available</p>';
    return;
  }

  mv3LifecycleMetricsEl.innerHTML = `
    <p><strong>Service Worker Restarts:</strong> <span>${stats.restarts || 0}</span></p>
    <p><strong>Avg. Recovery Time:</strong> <span>${stats.avgRecoveryTime || 'N/A'}</span></p>
    <hr style="margin: 10px 0; border-color: #444;">
    <p style="font-size: 11px; color: #888; margin-bottom: 5px;">Wake-up Triggers:</p>
    <p><strong>On Startup/Install:</strong> <span>${(stats.wakeUpTriggers.onInstalled || 0) + (stats.wakeUpTriggers.onStartup || 0)}</span></p>
    <p><strong>By Alarm:</strong> <span>${stats.wakeUpTriggers.onAlarm || 0}</span></p>
    <p><strong>By User Action:</strong> <span>${stats.wakeUpTriggers.onMessage || 0}</span></p>
  `;
}

/**
 * Render errors
 */
function renderErrors(errors: ErrorData | undefined): void {
  if (!errors) {
    errorSummaryEl.innerHTML = '<p class="loading">No data available</p>';
    criticalErrorsEl.innerHTML = '<p class="loading">No data available</p>';
    return;
  }

  // Error summary
  errorSummaryEl.innerHTML = `
    <p><strong>Total Errors:</strong> <span>${errors.total || 0}</span></p>
    <p><strong>Critical Errors:</strong> <span>${errors.critical || 0}</span></p>
    <p><strong>Last 24 Hours:</strong> <span>${errors.last24h || 0}</span></p>
    <p><strong>Last Hour:</strong> <span>${errors.lastHour || 0}</span></p>
  `;

  // Top errors
  if (errors.topErrors && errors.topErrors.length > 0) {
    const topErrorsHtml = errors.topErrors.map(err =>
      `<p><strong>${err.error}:</strong> <span>${err.count} occurrences</span></p>`
    ).join('');
    errorSummaryEl.innerHTML += '<hr style="margin: 15px 0; border-color: #444;">' + topErrorsHtml;
  }

  // Critical errors
  if (errors.recentCritical && errors.recentCritical.length > 0) {
    criticalErrorsEl.innerHTML = errors.recentCritical.map(err => `
      <div class="error-item">
        <h5>${err.name || 'Error'}: ${err.message}</h5>
        <p><strong>Category:</strong> ${err.category}</p>
        <p><strong>Time:</strong> ${new Date(err.timestamp).toLocaleString()}</p>
        ${err.stack ? `<pre>${err.stack}</pre>` : ''}
      </div>
    `).join('');
  } else {
    criticalErrorsEl.innerHTML = '<p class="loading">No critical errors</p>';
  }
}

/**
 * Render configuration
 */
function renderConfig(config: DebugConfig | undefined, websocketState: WebSocketState | undefined): void {
  if (!config) {
    debugConfigEl.innerHTML = '<p class="loading">No data available</p>';
    return;
  }

  debugConfigEl.innerHTML = `<pre>${JSON.stringify(config, null, 2)}</pre>`;

  // System info
  if (websocketState) {
    systemInfoEl.innerHTML = `<pre>${JSON.stringify(websocketState, null, 2)}</pre>`;
  } else {
    systemInfoEl.innerHTML = '<p class="loading">No data available</p>';
  }
}

/**
 * Export data
 */
async function exportData(format: 'json' | 'text'): Promise<void> {
  try {
    // Get full debug data from background
    const response = await chrome.runtime.sendMessage({
      action: 'exportDebugData'
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

