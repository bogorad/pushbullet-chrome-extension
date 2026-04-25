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
  var LOG_LEVEL_HIERARCHY = {
    DEBUG: ["DEBUG", "INFO", "WARN", "ERROR"],
    // Show everything
    INFO: ["INFO", "WARN", "ERROR"],
    // Show INFO and above
    WARN: ["WARN", "ERROR"],
    // Show WARN and above
    ERROR: ["ERROR"]
    // Show only ERROR
  };
  function shouldShowLogByLevel(logLevel, filterLevel) {
    if (!filterLevel || filterLevel === "") {
      return true;
    }
    const allowedLevels = LOG_LEVEL_HIERARCHY[filterLevel];
    if (!allowedLevels) {
      console.warn(`Unknown filter level: ${filterLevel}, showing all logs`);
      return true;
    }
    return allowedLevels.includes(logLevel);
  }
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
  var logMessageFilter = getElementById("log-message-filter");
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
  var VALID_LOG_LEVELS = /* @__PURE__ */ new Set(["DEBUG", "INFO", "WARN", "ERROR"]);
  function safeLogLevel(level) {
    if (VALID_LOG_LEVELS.has(level)) {
      return level;
    }
    return "INFO";
  }
  function renderLoading(element, message) {
    const loading = document.createElement("p");
    loading.className = "loading";
    loading.textContent = message;
    element.replaceChildren(loading);
  }
  function stringifyForDisplay(value) {
    try {
      const rendered = JSON.stringify(value, null, 2);
      return rendered ?? "";
    } catch {
      return "[Unable to render value]";
    }
  }
  function appendMetricRow(container, label, value, valueClass) {
    const row = document.createElement("p");
    const strong = document.createElement("strong");
    const span = document.createElement("span");
    strong.textContent = `${label}:`;
    span.textContent = value;
    if (valueClass) {
      span.className = valueClass;
    }
    row.append(strong, document.createTextNode(" "), span);
    container.appendChild(row);
  }
  function appendTextRow(container, label, value) {
    const row = document.createElement("p");
    const strong = document.createElement("strong");
    strong.textContent = `${label}:`;
    row.append(strong, document.createTextNode(` ${value}`));
    container.appendChild(row);
  }
  function appendDivider(container, margin) {
    const divider = document.createElement("hr");
    divider.style.margin = margin;
    divider.style.borderColor = "#444";
    container.appendChild(divider);
  }
  function appendSectionLabel(container, label) {
    const sectionLabel = document.createElement("p");
    sectionLabel.style.fontSize = "11px";
    sectionLabel.style.color = "#888";
    sectionLabel.style.marginBottom = "5px";
    sectionLabel.textContent = label;
    container.appendChild(sectionLabel);
  }
  function appendPre(container, text, className) {
    const pre = document.createElement("pre");
    if (className) {
      pre.className = className;
    }
    pre.textContent = text;
    container.appendChild(pre);
  }
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
        chrome.runtime.sendMessage({ action: "clearAllLogs" /* CLEAR_ALL_LOGS */ }, (response) => {
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
        action: "updateDebugConfig" /* UPDATE_DEBUG_CONFIG */,
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
    logMessageFilter.addEventListener("input", () => {
      renderLogs();
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
        action: "getDebugSummary" /* GET_DEBUG_SUMMARY */
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
      renderLoading(logsContainer, "No logs available");
      return;
    }
    const categoryFilter = logCategoryFilter.value;
    const levelFilter = logLevelFilter.value;
    const messageFilter = logMessageFilter.value.trim();
    let filteredLogs = currentData.logs;
    if (categoryFilter) {
      filteredLogs = filteredLogs.filter((log) => log.category === categoryFilter);
    }
    if (levelFilter) {
      filteredLogs = filteredLogs.filter(
        (log) => shouldShowLogByLevel(log.level, levelFilter)
      );
    }
    if (messageFilter) {
      try {
        const regex = new RegExp(messageFilter, "i");
        filteredLogs = filteredLogs.filter((log) => regex.test(log.message));
      } catch {
        const lowerFilter = messageFilter.toLowerCase();
        filteredLogs = filteredLogs.filter(
          (log) => log.message.toLowerCase().includes(lowerFilter)
        );
      }
    }
    if (filteredLogs.length === 0) {
      renderLoading(logsContainer, "No logs match the current filters");
      return;
    }
    const fragment = document.createDocumentFragment();
    [...filteredLogs].reverse().forEach((log) => {
      const logLevel = safeLogLevel(log.level);
      const entry = document.createElement("div");
      entry.classList.add("log-entry", logLevel);
      const header = document.createElement("div");
      header.className = "log-header";
      const category = document.createElement("span");
      category.className = "log-category";
      category.textContent = `[${log.category}]`;
      const level = document.createElement("span");
      level.classList.add("log-level", logLevel);
      level.textContent = logLevel;
      header.append(category, level);
      const timestamp = document.createElement("div");
      timestamp.className = "log-timestamp";
      timestamp.textContent = log.timestamp;
      const message = document.createElement("div");
      message.className = "log-message";
      message.textContent = log.message;
      entry.append(header, timestamp, message);
      if (log.data !== void 0) {
        const data = document.createElement("div");
        data.className = "log-data";
        data.textContent = stringifyForDisplay(log.data);
        entry.appendChild(data);
      }
      if (log.error) {
        const error = document.createElement("div");
        error.classList.add("log-data", "error");
        error.textContent = `${log.error.name}: ${log.error.message}`;
        entry.appendChild(error);
      }
      fragment.appendChild(entry);
    });
    logsContainer.replaceChildren(fragment);
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
      renderLoading(websocketMetricsEl, "No data available");
      renderLoading(qualityMetricsEl, "No data available");
      renderLoading(notificationMetricsEl, "No data available");
      return;
    }
    if (performance.websocket) {
      const ws = performance.websocket;
      websocketMetricsEl.replaceChildren();
      appendMetricRow(websocketMetricsEl, "Connection Attempts", (ws.connectionAttempts || 0).toString());
      appendMetricRow(websocketMetricsEl, "Successful Connections", (ws.successfulConnections || 0).toString());
      appendMetricRow(websocketMetricsEl, "Messages Received", (ws.messagesReceived || 0).toString());
      appendMetricRow(websocketMetricsEl, "Reconnection Attempts", (ws.reconnectionAttempts || 0).toString());
      appendMetricRow(
        websocketMetricsEl,
        "Last Connection",
        ws.lastConnectionTime ? new Date(ws.lastConnectionTime).toLocaleString() : "Never"
      );
    } else {
      renderLoading(websocketMetricsEl, "No websocket data available");
    }
    if (performance.qualityMetrics) {
      const quality = performance.qualityMetrics;
      const healthChecks = document.createElement("p");
      const healthChecksLabel = document.createElement("strong");
      const passed = document.createElement("span");
      const failed = document.createElement("span");
      qualityMetricsEl.replaceChildren();
      appendMetricRow(
        qualityMetricsEl,
        "Average Latency",
        quality.averageLatency ? `${quality.averageLatency.toFixed(0)}ms` : "N/A"
      );
      appendMetricRow(
        qualityMetricsEl,
        "Min/Max Latency",
        `${quality.minLatency ? quality.minLatency.toFixed(0) : "N/A"} / ${quality.maxLatency ? quality.maxLatency.toFixed(0) : "N/A"} ms`
      );
      appendMetricRow(qualityMetricsEl, "Total Uptime", formatDuration(quality.connectionUptime));
      appendMetricRow(qualityMetricsEl, "Current Uptime", formatDuration(quality.currentUptime));
      appendMetricRow(qualityMetricsEl, "Disconnections", (quality.disconnectionCount || 0).toString());
      healthChecksLabel.textContent = "Health Checks:";
      passed.className = "success";
      passed.textContent = `${quality.healthChecksPassed || 0} passed`;
      failed.className = "error";
      failed.textContent = `${quality.healthChecksFailed || 0} failed`;
      healthChecks.append(healthChecksLabel, document.createTextNode(" "), passed, document.createTextNode(" / "), failed);
      qualityMetricsEl.appendChild(healthChecks);
      appendMetricRow(
        qualityMetricsEl,
        "Consecutive Failures",
        (quality.consecutiveFailures || 0).toString(),
        quality.consecutiveFailures > 3 ? "error" : void 0
      );
    } else {
      renderLoading(qualityMetricsEl, "No quality metrics available");
    }
    if (performance.notifications) {
      const notif = performance.notifications;
      notificationMetricsEl.replaceChildren();
      appendMetricRow(notificationMetricsEl, "Pushes Received", (notif.pushesReceived || 0).toString());
      appendMetricRow(notificationMetricsEl, "Notifications Created", (notif.notificationsCreated || 0).toString());
      appendMetricRow(notificationMetricsEl, "Notifications Failed", (notif.notificationsFailed || 0).toString());
      appendMetricRow(
        notificationMetricsEl,
        "Avg Processing Time",
        notif.averageProcessingTime ? `${notif.averageProcessingTime.toFixed(2)}ms` : "N/A"
      );
    } else {
      renderLoading(notificationMetricsEl, "No notification metrics available");
    }
  }
  function renderInitializationStats(initStats) {
    if (!initStats || !initStats.stats) {
      renderLoading(initializationStatsEl, "No data available");
      return;
    }
    const stats = initStats.stats;
    initializationStatsEl.replaceChildren();
    appendMetricRow(initializationStatsEl, "Total Initializations", (stats.total || 0).toString());
    appendMetricRow(initializationStatsEl, "On Install/Update", (stats.onInstalled || 0).toString());
    appendMetricRow(initializationStatsEl, "On Browser Startup", (stats.onStartup || 0).toString());
    appendMetricRow(initializationStatsEl, "Service Worker Wakeup", (stats.serviceWorkerWakeup || 0).toString());
    appendMetricRow(initializationStatsEl, "Unknown Source", (stats.unknown || 0).toString());
    appendMetricRow(
      initializationStatsEl,
      "Last Initialization",
      stats.lastInitialization ? new Date(stats.lastInitialization).toLocaleString() : "Never"
    );
    if (stats.recentInitializations && stats.recentInitializations.length > 0) {
      appendDivider(initializationStatsEl, "10px 0");
      appendSectionLabel(initializationStatsEl, "Recent (last 10):");
      stats.recentInitializations.forEach((init2) => {
        const row = document.createElement("p");
        const source = document.createElement("strong");
        row.style.fontSize = "12px";
        row.style.margin = "5px 0";
        source.textContent = `${init2.source}:`;
        row.append(source, document.createTextNode(` ${new Date(init2.timestamp).toLocaleTimeString()}`));
        initializationStatsEl.appendChild(row);
      });
    }
  }
  function renderMv3LifecycleMetrics(stats) {
    if (!stats) {
      renderLoading(mv3LifecycleMetricsEl, "No MV3 stats available");
      return;
    }
    mv3LifecycleMetricsEl.replaceChildren();
    appendMetricRow(mv3LifecycleMetricsEl, "Service Worker Restarts", (stats.restarts || 0).toString());
    appendMetricRow(mv3LifecycleMetricsEl, "Avg. Recovery Time", stats.avgRecoveryTime || "N/A");
    appendDivider(mv3LifecycleMetricsEl, "10px 0");
    appendSectionLabel(mv3LifecycleMetricsEl, "Wake-up Triggers:");
    appendMetricRow(
      mv3LifecycleMetricsEl,
      "On Startup/Install",
      ((stats.wakeUpTriggers.onInstalled || 0) + (stats.wakeUpTriggers.onStartup || 0)).toString()
    );
    appendMetricRow(mv3LifecycleMetricsEl, "By Alarm", (stats.wakeUpTriggers.onAlarm || 0).toString());
    appendMetricRow(mv3LifecycleMetricsEl, "By User Action", (stats.wakeUpTriggers.onMessage || 0).toString());
  }
  function renderErrors(errors) {
    if (!errors) {
      renderLoading(errorSummaryEl, "No data available");
      renderLoading(criticalErrorsEl, "No data available");
      return;
    }
    errorSummaryEl.replaceChildren();
    appendMetricRow(errorSummaryEl, "Total Errors", (errors.total || 0).toString());
    appendMetricRow(errorSummaryEl, "Critical Errors", (errors.critical || 0).toString());
    appendMetricRow(errorSummaryEl, "Last 24 Hours", (errors.last24h || 0).toString());
    appendMetricRow(errorSummaryEl, "Last Hour", (errors.lastHour || 0).toString());
    if (errors.topErrors && errors.topErrors.length > 0) {
      appendDivider(errorSummaryEl, "15px 0");
      errors.topErrors.forEach((err) => {
        appendMetricRow(errorSummaryEl, err.error, `${err.count} occurrences`);
      });
    }
    if (errors.recentCritical && errors.recentCritical.length > 0) {
      const fragment = document.createDocumentFragment();
      errors.recentCritical.forEach((err) => {
        const item = document.createElement("div");
        const title = document.createElement("h5");
        item.className = "error-item";
        title.textContent = `${err.name || "Error"}: ${err.message}`;
        item.appendChild(title);
        appendTextRow(item, "Category", err.category);
        appendTextRow(item, "Time", new Date(err.timestamp).toLocaleString());
        if (err.stack) {
          appendPre(item, err.stack);
        }
        fragment.appendChild(item);
      });
      criticalErrorsEl.replaceChildren(fragment);
    } else {
      renderLoading(criticalErrorsEl, "No critical errors");
    }
  }
  function renderConfig(config, websocketState) {
    if (!config) {
      renderLoading(debugConfigEl, "No data available");
      return;
    }
    debugConfigEl.replaceChildren();
    appendPre(debugConfigEl, stringifyForDisplay(config));
    if (websocketState) {
      systemInfoEl.replaceChildren();
      appendPre(systemInfoEl, stringifyForDisplay(websocketState));
    } else {
      renderLoading(systemInfoEl, "No data available");
    }
  }
  async function exportData(format) {
    try {
      const response = await chrome.runtime.sendMessage({
        action: "exportDebugData" /* EXPORT_DEBUG_DATA */
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
