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

  // src/debug-dashboard/index.ts
  var refreshBtn = getElementById("refresh-btn");
  var exportJsonBtn = getElementById("export-json-btn");
  var exportTextBtn = getElementById("export-text-btn");
  var clearLogsBtn = getElementById("clear-logs-btn");
  var closeBtn = getElementById("close-btn");
  var autoRefreshToggle = getElementById("auto-refresh-toggle");
  var debugToggle = getElementById("debug-toggle");
  var debugStatusText = getElementById("debug-status-text");
  var lastUpdatedSpan = getElementById("last-updated");
  var totalLogsEl = getElementById("total-logs");
  var errorCountEl = getElementById("error-count");
  var websocketStatusEl = getElementById("websocket-status");
  var tabBtns = document.querySelectorAll(".tab-btn");
  var tabPanes = document.querySelectorAll(".tab-pane");
  var logCategoryFilter = getElementById("log-category-filter");
  var logLevelFilter = getElementById("log-level-filter");
  var logCountSelect = getElementById("log-count-select");
  var logsContainer = getElementById("logs-container");
  var websocketMetricsEl = getElementById("websocket-metrics");
  var qualityMetricsEl = getElementById("quality-metrics");
  var notificationMetricsEl = getElementById("notification-metrics");
  var initializationStatsEl = getElementById("initialization-stats");
  var mv3LifecycleMetricsEl = getElementById("mv3-lifecycle-metrics");
  var errorSummaryEl = getElementById("error-summary");
  var criticalErrorsEl = getElementById("critical-errors");
  var debugConfigEl = getElementById("debug-config");
  var systemInfoEl = getElementById("system-info");
  var autoRefreshInterval = null;
  var currentData = null;
  function setupEventListeners() {
    refreshBtn.addEventListener("click", () => {
      loadDashboardData();
    });
    exportJsonBtn.addEventListener("click", () => {
      exportData("json");
    });
    exportTextBtn.addEventListener("click", () => {
      exportData("text");
    });
    clearLogsBtn.addEventListener("click", () => {
      if (confirm("Are you sure you want to permanently delete all logs?")) {
        chrome.runtime.sendMessage({ action: "clearAllLogs" }, (response) => {
          if (response && response.success) {
            loadDashboardData();
          } else {
            showError("Failed to clear logs.");
          }
        });
      }
    });
    debugToggle.addEventListener("change", () => {
      const enabled = debugToggle.checked;
      debugStatusText.textContent = enabled ? "Enabled" : "Disabled";
      chrome.runtime.sendMessage({
        action: "updateDebugConfig",
        config: { enabled }
      }, (response) => {
        if (response && response.success) {
          loadDashboardData();
        } else {
          showError("Failed to update debug config.");
          debugToggle.checked = !enabled;
          debugStatusText.textContent = !enabled ? "Enabled" : "Disabled";
        }
      });
    });
    closeBtn.addEventListener("click", () => {
      window.close();
    });
    autoRefreshToggle.addEventListener("change", () => {
      if (autoRefreshToggle.checked) {
        startAutoRefresh();
      } else {
        stopAutoRefresh();
      }
    });
    tabBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        const tabName = btn.dataset.tab;
        if (tabName) {
          switchTab(tabName);
        }
      });
    });
    logCategoryFilter.addEventListener("change", () => {
      renderLogs();
    });
    logLevelFilter.addEventListener("change", () => {
      renderLogs();
    });
    logCountSelect.addEventListener("change", () => {
      loadDashboardData();
    });
  }
  function switchTab(tabName) {
    tabBtns.forEach((btn) => {
      if (btn.dataset.tab === tabName) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });
    tabPanes.forEach((pane) => {
      if (pane.id === `${tabName}-tab`) {
        pane.classList.add("active");
      } else {
        pane.classList.remove("active");
      }
    });
  }
  async function loadDashboardData() {
    try {
      const response = await chrome.runtime.sendMessage({
        action: "getDebugSummary"
      });
      if (response && response.success) {
        currentData = response.summary;
        updateDashboard(currentData);
        updateLastUpdated();
      } else {
        console.error("Failed to load debug data");
        showError("Failed to load debug data");
      }
    } catch (error) {
      console.error("Error loading dashboard data:", error);
      showError("Error loading dashboard data: " + error.message);
    }
  }
  function updateDashboard(data) {
    updateSummary(data);
    renderLogs();
    renderPerformanceMetrics(data.performance);
    renderInitializationStats(data.initializationStats);
    renderMv3LifecycleMetrics(data.mv3LifecycleStats);
    renderErrors(data.errors);
    renderConfig(data.config, data.websocketState);
  }
  function updateSummary(data) {
    if (data.config && data.config.enabled) {
      debugToggle.checked = true;
      debugStatusText.textContent = "Enabled";
    } else {
      debugToggle.checked = false;
      debugStatusText.textContent = "Disabled";
    }
    if (data.totalLogs !== void 0) {
      totalLogsEl.textContent = data.totalLogs.toString();
    } else if (data.logs && data.logs.length) {
      totalLogsEl.textContent = data.logs.length.toString();
    } else {
      totalLogsEl.textContent = "0";
    }
    if (data.errors && data.errors.last24h !== void 0) {
      errorCountEl.textContent = data.errors.last24h.toString();
    } else {
      errorCountEl.textContent = "0";
    }
    if (data.websocketState && data.websocketState.current) {
      const stateMachineState = data.websocketState.current.stateMachineState || "unknown";
      const stateDescription = data.websocketState.current.stateMachineDescription || data.websocketState.current.stateText || "Unknown";
      websocketStatusEl.textContent = stateDescription;
      websocketStatusEl.title = `State: ${stateMachineState}`;
    } else {
      websocketStatusEl.textContent = "Unknown";
    }
  }
  function renderLogs() {
    if (!currentData || !currentData.logs) {
      logsContainer.innerHTML = '<p class="loading">No logs available</p>';
      return;
    }
    const categoryFilter = logCategoryFilter.value;
    const levelFilter = logLevelFilter.value;
    let filteredLogs = currentData.logs;
    if (categoryFilter) {
      filteredLogs = filteredLogs.filter((log) => log.category === categoryFilter);
    }
    if (levelFilter) {
      filteredLogs = filteredLogs.filter((log) => log.level === levelFilter);
    }
    if (filteredLogs.length === 0) {
      logsContainer.innerHTML = '<p class="loading">No logs match the current filters</p>';
      return;
    }
    logsContainer.innerHTML = [...filteredLogs].reverse().map((log) => {
      const dataStr = log.data ? JSON.stringify(log.data, null, 2) : "";
      const errorStr = log.error ? `${log.error.name}: ${log.error.message}` : "";
      return `
      <div class="log-entry ${log.level}">
        <div class="log-header">
          <span class="log-category">[${log.category}]</span>
          <span class="log-level ${log.level}">${log.level}</span>
        </div>
        <div class="log-timestamp">${log.timestamp}</div>
        <div class="log-message">${log.message}</div>
        ${dataStr ? `<div class="log-data">${dataStr}</div>` : ""}
        ${errorStr ? `<div class="log-data error">${errorStr}</div>` : ""}
      </div>
    `;
    }).join("");
  }
  function formatDuration(ms) {
    if (!ms || ms === 0) return "0s";
    const seconds = Math.floor(ms / 1e3);
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
  function renderPerformanceMetrics(performance) {
    if (!performance) {
      websocketMetricsEl.innerHTML = '<p class="loading">No data available</p>';
      qualityMetricsEl.innerHTML = '<p class="loading">No data available</p>';
      notificationMetricsEl.innerHTML = '<p class="loading">No data available</p>';
      return;
    }
    if (performance.websocket) {
      const ws = performance.websocket;
      websocketMetricsEl.innerHTML = `
      <p><strong>Connection Attempts:</strong> <span>${ws.connectionAttempts || 0}</span></p>
      <p><strong>Successful Connections:</strong> <span>${ws.successfulConnections || 0}</span></p>
      <p><strong>Messages Received:</strong> <span>${ws.messagesReceived || 0}</span></p>
      <p><strong>Reconnection Attempts:</strong> <span>${ws.reconnectionAttempts || 0}</span></p>
      <p><strong>Last Connection:</strong> <span>${ws.lastConnectionTime ? new Date(ws.lastConnectionTime).toLocaleString() : "Never"}</span></p>
    `;
    } else {
      websocketMetricsEl.innerHTML = '<p class="loading">No websocket data available</p>';
    }
    if (performance.qualityMetrics) {
      const quality = performance.qualityMetrics;
      qualityMetricsEl.innerHTML = `
      <p><strong>Average Latency:</strong> <span>${quality.averageLatency ? quality.averageLatency.toFixed(0) + "ms" : "N/A"}</span></p>
      <p><strong>Min/Max Latency:</strong> <span>${quality.minLatency ? quality.minLatency.toFixed(0) : "N/A"} / ${quality.maxLatency ? quality.maxLatency.toFixed(0) : "N/A"} ms</span></p>
      <p><strong>Total Uptime:</strong> <span>${formatDuration(quality.connectionUptime)}</span></p>
      <p><strong>Current Uptime:</strong> <span>${formatDuration(quality.currentUptime)}</span></p>
      <p><strong>Disconnections:</strong> <span>${quality.disconnectionCount || 0}</span></p>
      <p><strong>Health Checks:</strong> <span class="success">${quality.healthChecksPassed || 0} passed</span> / <span class="error">${quality.healthChecksFailed || 0} failed</span></p>
      <p><strong>Consecutive Failures:</strong> <span class="${quality.consecutiveFailures > 3 ? "error" : ""}">${quality.consecutiveFailures || 0}</span></p>
    `;
    } else {
      qualityMetricsEl.innerHTML = '<p class="loading">No quality metrics available</p>';
    }
    if (performance.notifications) {
      const notif = performance.notifications;
      notificationMetricsEl.innerHTML = `
      <p><strong>Pushes Received:</strong> <span>${notif.pushesReceived || 0}</span></p>
      <p><strong>Notifications Created:</strong> <span>${notif.notificationsCreated || 0}</span></p>
      <p><strong>Notifications Failed:</strong> <span>${notif.notificationsFailed || 0}</span></p>
      <p><strong>Avg Processing Time:</strong> <span>${notif.averageProcessingTime ? notif.averageProcessingTime.toFixed(2) + "ms" : "N/A"}</span></p>
    `;
    } else {
      notificationMetricsEl.innerHTML = '<p class="loading">No notification metrics available</p>';
    }
  }
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
    <p><strong>Last Initialization:</strong> <span>${stats.lastInitialization ? new Date(stats.lastInitialization).toLocaleString() : "Never"}</span></p>
  `;
    if (stats.recentInitializations && stats.recentInitializations.length > 0) {
      const recentHtml = stats.recentInitializations.map(
        (init2) => `<p style="font-size: 12px; margin: 5px 0;"><strong>${init2.source}:</strong> ${new Date(init2.timestamp).toLocaleTimeString()}</p>`
      ).join("");
      initializationStatsEl.innerHTML += '<hr style="margin: 10px 0; border-color: #444;"><p style="font-size: 11px; color: #888; margin-bottom: 5px;">Recent (last 10):</p>' + recentHtml;
    }
  }
  function renderMv3LifecycleMetrics(stats) {
    if (!stats) {
      mv3LifecycleMetricsEl.innerHTML = '<p class="loading">No MV3 stats available</p>';
      return;
    }
    mv3LifecycleMetricsEl.innerHTML = `
    <p><strong>Service Worker Restarts:</strong> <span>${stats.restarts || 0}</span></p>
    <p><strong>Avg. Recovery Time:</strong> <span>${stats.avgRecoveryTime || "N/A"}</span></p>
    <hr style="margin: 10px 0; border-color: #444;">
    <p style="font-size: 11px; color: #888; margin-bottom: 5px;">Wake-up Triggers:</p>
    <p><strong>On Startup/Install:</strong> <span>${(stats.wakeUpTriggers.onInstalled || 0) + (stats.wakeUpTriggers.onStartup || 0)}</span></p>
    <p><strong>By Alarm:</strong> <span>${stats.wakeUpTriggers.onAlarm || 0}</span></p>
    <p><strong>By User Action:</strong> <span>${stats.wakeUpTriggers.onMessage || 0}</span></p>
  `;
  }
  function renderErrors(errors) {
    if (!errors) {
      errorSummaryEl.innerHTML = '<p class="loading">No data available</p>';
      criticalErrorsEl.innerHTML = '<p class="loading">No data available</p>';
      return;
    }
    errorSummaryEl.innerHTML = `
    <p><strong>Total Errors:</strong> <span>${errors.total || 0}</span></p>
    <p><strong>Critical Errors:</strong> <span>${errors.critical || 0}</span></p>
    <p><strong>Last 24 Hours:</strong> <span>${errors.last24h || 0}</span></p>
    <p><strong>Last Hour:</strong> <span>${errors.lastHour || 0}</span></p>
  `;
    if (errors.topErrors && errors.topErrors.length > 0) {
      const topErrorsHtml = errors.topErrors.map(
        (err) => `<p><strong>${err.error}:</strong> <span>${err.count} occurrences</span></p>`
      ).join("");
      errorSummaryEl.innerHTML += '<hr style="margin: 15px 0; border-color: #444;">' + topErrorsHtml;
    }
    if (errors.recentCritical && errors.recentCritical.length > 0) {
      criticalErrorsEl.innerHTML = errors.recentCritical.map((err) => `
      <div class="error-item">
        <h5>${err.name || "Error"}: ${err.message}</h5>
        <p><strong>Category:</strong> ${err.category}</p>
        <p><strong>Time:</strong> ${new Date(err.timestamp).toLocaleString()}</p>
        ${err.stack ? `<pre>${err.stack}</pre>` : ""}
      </div>
    `).join("");
    } else {
      criticalErrorsEl.innerHTML = '<p class="loading">No critical errors</p>';
    }
  }
  function renderConfig(config, websocketState) {
    if (!config) {
      debugConfigEl.innerHTML = '<p class="loading">No data available</p>';
      return;
    }
    debugConfigEl.innerHTML = `<pre>${JSON.stringify(config, null, 2)}</pre>`;
    if (websocketState) {
      systemInfoEl.innerHTML = `<pre>${JSON.stringify(websocketState, null, 2)}</pre>`;
    } else {
      systemInfoEl.innerHTML = '<p class="loading">No data available</p>';
    }
  }
  async function exportData(format) {
    try {
      const response = await chrome.runtime.sendMessage({
        action: "exportDebugData"
      });
      if (!response || !response.success) {
        showError("Failed to export debug data");
        return;
      }
      const data = response.data;
      let content;
      let filename;
      let mimeType;
      if (format === "json") {
        content = JSON.stringify(data, null, 2);
        filename = `pushbullet-debug-${Date.now()}.json`;
        mimeType = "application/json";
      } else {
        content = formatDebugDataAsText(data);
        filename = `pushbullet-debug-${Date.now()}.txt`;
        mimeType = "text/plain";
      }
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      console.log("Debug data exported:", filename);
    } catch (error) {
      console.error("Error exporting data:", error);
      showError("Error exporting data: " + error.message);
    }
  }
  function formatDebugDataAsText(data) {
    let text = "=".repeat(80) + "\n";
    text += "PUSHBULLET DEBUG REPORT\n";
    text += "=".repeat(80) + "\n\n";
    text += `Generated: ${data.timestamp || (/* @__PURE__ */ new Date()).toISOString()}
`;
    text += `Version: ${data.version || "Unknown"}

`;
    text += "-".repeat(80) + "\n";
    text += "DEBUG CONFIGURATION\n";
    text += "-".repeat(80) + "\n";
    const debugLogs = data.debugLogs;
    text += JSON.stringify(debugLogs?.config, null, 2) + "\n\n";
    text += "-".repeat(80) + "\n";
    text += "SYSTEM INFORMATION\n";
    text += "-".repeat(80) + "\n";
    text += JSON.stringify(data.systemInfo, null, 2) + "\n\n";
    text += "-".repeat(80) + "\n";
    text += "ERROR SUMMARY\n";
    text += "-".repeat(80) + "\n";
    const errorData = data.errorData;
    text += JSON.stringify(errorData?.summary, null, 2) + "\n\n";
    text += "-".repeat(80) + "\n";
    text += "PERFORMANCE METRICS\n";
    text += "-".repeat(80) + "\n";
    const performanceData = data.performanceData;
    text += JSON.stringify(performanceData?.summary, null, 2) + "\n\n";
    text += "-".repeat(80) + "\n";
    text += "RECENT LOGS (Last 50)\n";
    text += "-".repeat(80) + "\n";
    const logs = debugLogs?.logs || [];
    const recentLogs = logs.slice(-50);
    recentLogs.forEach((log) => {
      text += `[${log.timestamp}] [${log.category}:${log.level}] ${log.message}
`;
      if (log.data) {
        text += `  Data: ${JSON.stringify(log.data)}
`;
      }
      if (log.error) {
        text += `  Error: ${log.error.message}
`;
      }
      text += "\n";
    });
    return text;
  }
  function startAutoRefresh() {
    if (autoRefreshInterval) {
      clearInterval(autoRefreshInterval);
    }
    autoRefreshInterval = window.setInterval(() => {
      loadDashboardData();
    }, 2e3);
  }
  function stopAutoRefresh() {
    if (autoRefreshInterval) {
      clearInterval(autoRefreshInterval);
      autoRefreshInterval = null;
    }
  }
  function updateLastUpdated() {
    lastUpdatedSpan.textContent = (/* @__PURE__ */ new Date()).toLocaleTimeString();
  }
  function showError(message) {
    console.error(message);
  }
  function init() {
    console.log("Debug Dashboard loaded");
    setupEventListeners();
    loadDashboardData();
    if (autoRefreshToggle.checked) {
      startAutoRefresh();
    }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
//# sourceMappingURL=debug-dashboard.js.map
