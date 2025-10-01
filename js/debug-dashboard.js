// Debug Dashboard JavaScript

// DOM Elements
const refreshBtn = document.getElementById('refresh-btn');
const exportJsonBtn = document.getElementById('export-json-btn');
const exportTextBtn = document.getElementById('export-text-btn');
const closeBtn = document.getElementById('close-btn');
const autoRefreshToggle = document.getElementById('auto-refresh-toggle');
const lastUpdatedSpan = document.getElementById('last-updated');

// Summary elements
const debugStatusEl = document.getElementById('debug-status');
const totalLogsEl = document.getElementById('total-logs');
const errorCountEl = document.getElementById('error-count');
const websocketStatusEl = document.getElementById('websocket-status');

// Tab elements
const tabBtns = document.querySelectorAll('.tab-btn');
const tabPanes = document.querySelectorAll('.tab-pane');

// Logs tab elements
const logCategoryFilter = document.getElementById('log-category-filter');
const logLevelFilter = document.getElementById('log-level-filter');
const logCountSelect = document.getElementById('log-count-select');
const logsContainer = document.getElementById('logs-container');

// Performance tab elements
const websocketMetricsEl = document.getElementById('websocket-metrics');
const qualityMetricsEl = document.getElementById('quality-metrics');
const notificationMetricsEl = document.getElementById('notification-metrics');
const initializationStatsEl = document.getElementById('initialization-stats');

// Errors tab elements
const errorSummaryEl = document.getElementById('error-summary');
const criticalErrorsEl = document.getElementById('critical-errors');

// Config tab elements
const debugConfigEl = document.getElementById('debug-config');
const systemInfoEl = document.getElementById('system-info');

// State
let autoRefreshInterval = null;
let currentData = null;

// Initialize dashboard
document.addEventListener('DOMContentLoaded', () => {
  console.log('Debug Dashboard loaded');
  
  // Set up event listeners
  setupEventListeners();
  
  // Load initial data
  loadDashboardData();
  
  // Start auto-refresh if enabled
  if (autoRefreshToggle.checked) {
    startAutoRefresh();
  }
});

// Set up event listeners
function setupEventListeners() {
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
      switchTab(tabName);
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

// Switch tabs
function switchTab(tabName) {
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

// Load dashboard data
async function loadDashboardData() {
  try {
    // Get debug summary from background script
    const response = await chrome.runtime.sendMessage({
      action: 'getDebugSummary'
    });
    
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
    showError('Error loading dashboard data: ' + error.message);
  }
}

// Update dashboard with data
function updateDashboard(data) {
  updateSummary(data);
  renderLogs();
  renderPerformanceMetrics(data.performance);
  renderInitializationStats(data.initializationStats);
  renderErrors(data.errors);
  renderConfig(data.config, data.websocketState);
}

// Update summary cards
function updateSummary(data) {
  // Debug status
  const statusDot = debugStatusEl.querySelector('.status-dot');
  const statusText = debugStatusEl.querySelector('.status-text');
  
  if (data.config && data.config.enabled) {
    statusDot.classList.remove('disabled');
    statusText.textContent = 'Enabled';
  } else {
    statusDot.classList.add('disabled');
    statusText.textContent = 'Disabled';
  }
  
  // Total logs
  if (data.totalLogs !== undefined) {
    totalLogsEl.textContent = data.totalLogs;
  } else if (data.logs && data.logs.length) {
    totalLogsEl.textContent = data.logs.length;
  } else {
    totalLogsEl.textContent = '0';
  }
  
  // Error count
  if (data.errors && data.errors.last24h !== undefined) {
    errorCountEl.textContent = data.errors.last24h;
  } else {
    errorCountEl.textContent = '0';
  }
  
  // WebSocket status
  if (data.websocketState && data.websocketState.current) {
    websocketStatusEl.textContent = data.websocketState.current.stateText || 'Unknown';
  } else {
    websocketStatusEl.textContent = 'Unknown';
  }
}

// Render logs
function renderLogs() {
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
  
  logsContainer.innerHTML = filteredLogs.map(log => {
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

// Render performance metrics
function renderPerformanceMetrics(performance) {
  if (!performance) {
    websocketMetricsEl.innerHTML = '<p class="loading">No data available</p>';
    qualityMetricsEl.innerHTML = '<p class="loading">No data available</p>';
    notificationMetricsEl.innerHTML = '<p class="loading">No data available</p>';
    initializationStatsEl.innerHTML = '<p class="loading">No data available</p>';
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
  }
}

// Format duration in ms to human readable
function formatDuration(ms) {
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

// Render initialization statistics
function renderInitializationStats(initStats) {
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

// Render errors
function renderErrors(errors) {
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

// Render configuration
function renderConfig(config, websocketState) {
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

// Export data
async function exportData(format) {
  try {
    // Get full debug data from background
    const response = await chrome.runtime.sendMessage({
      action: 'exportDebugData'
    });

    if (!response || !response.success) {
      showError('Failed to export debug data');
      return;
    }

    const data = response.data;
    let content, filename, mimeType;

    if (format === 'json') {
      content = JSON.stringify(data, null, 2);
      filename = `pushbullet-debug-${Date.now()}.json`;
      mimeType = 'application/json';
    } else {
      // Text format
      content = formatDebugDataAsText(data);
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
    showError('Error exporting data: ' + error.message);
  }
}

// Format debug data as text
function formatDebugDataAsText(data) {
  let text = '='.repeat(80) + '\n';
  text += 'PUSHBULLET DEBUG REPORT\n';
  text += '='.repeat(80) + '\n\n';
  text += `Generated: ${data.timestamp}\n`;
  text += `Version: ${data.version}\n\n`;

  // Debug configuration
  text += '-'.repeat(80) + '\n';
  text += 'DEBUG CONFIGURATION\n';
  text += '-'.repeat(80) + '\n';
  text += JSON.stringify(data.debugLogs.config, null, 2) + '\n\n';

  // System info
  text += '-'.repeat(80) + '\n';
  text += 'SYSTEM INFORMATION\n';
  text += '-'.repeat(80) + '\n';
  text += JSON.stringify(data.systemInfo, null, 2) + '\n\n';

  // Error summary
  text += '-'.repeat(80) + '\n';
  text += 'ERROR SUMMARY\n';
  text += '-'.repeat(80) + '\n';
  text += JSON.stringify(data.errorData.summary, null, 2) + '\n\n';

  // Performance summary
  text += '-'.repeat(80) + '\n';
  text += 'PERFORMANCE METRICS\n';
  text += '-'.repeat(80) + '\n';
  text += JSON.stringify(data.performanceData.summary, null, 2) + '\n\n';

  // Recent logs
  text += '-'.repeat(80) + '\n';
  text += 'RECENT LOGS (Last 50)\n';
  text += '-'.repeat(80) + '\n';
  const recentLogs = data.debugLogs.logs.slice(-50);
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

// Auto-refresh functions
function startAutoRefresh() {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
  }
  autoRefreshInterval = setInterval(() => {
    loadDashboardData();
  }, 2000); // Refresh every 2 seconds
}

function stopAutoRefresh() {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
  }
}

// Update last updated timestamp
function updateLastUpdated() {
  lastUpdatedSpan.textContent = new Date().toLocaleTimeString();
}

// Show error message
function showError(message) {
  console.error(message);
  // Could add a toast notification here
}


