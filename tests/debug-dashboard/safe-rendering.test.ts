import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import debugDashboardHtml from '../../debug-dashboard.html?raw';
import { MessageAction } from '../../src/types/domain';

declare const chrome: any;

const hostileHtml = '<img src=x onerror=alert(1)>';
const timestamp = Date.parse('2026-04-25T21:45:00Z');

function setDocumentReadyState(value: DocumentReadyState): void {
  Object.defineProperty(document, 'readyState', {
    configurable: true,
    get: () => value,
  });
}

function createDebugSummary() {
  return {
    totalLogs: 1,
    logs: [
      {
        timestamp: hostileHtml,
        category: hostileHtml,
        level: 'ERROR',
        message: hostileHtml,
        data: {
          payload: hostileHtml,
          nested: {
            body: hostileHtml,
          },
        },
        error: {
          name: hostileHtml,
          message: hostileHtml,
          stack: hostileHtml,
        },
      },
    ],
    performance: {
      websocket: {
        connectionAttempts: 1,
        successfulConnections: 1,
        messagesReceived: 1,
        reconnectionAttempts: 1,
        lastConnectionTime: timestamp,
      },
      qualityMetrics: {
        averageLatency: 123,
        minLatency: 100,
        maxLatency: 200,
        connectionUptime: 1000,
        currentUptime: 500,
        disconnectionCount: 1,
        healthChecksPassed: 2,
        healthChecksFailed: 3,
        consecutiveFailures: 4,
      },
      notifications: {
        pushesReceived: 1,
        notificationsCreated: 1,
        notificationsFailed: 0,
        averageProcessingTime: 12.34,
      },
    },
    initializationStats: {
      stats: {
        total: 1,
        onInstalled: 0,
        onStartup: 1,
        serviceWorkerWakeup: 0,
        unknown: 0,
        lastInitialization: timestamp,
        recentInitializations: [
          {
            source: hostileHtml,
            timestamp,
          },
        ],
      },
    },
    mv3LifecycleStats: {
      restarts: 1,
      wakeUpTriggers: {
        onInstalled: 0,
        onStartup: 1,
        onAlarm: 1,
        onMessage: 1,
      },
      avgRecoveryTime: hostileHtml,
    },
    errors: {
      total: 1,
      critical: 1,
      last24h: 1,
      lastHour: 1,
      topErrors: [
        {
          error: hostileHtml,
          count: 1,
        },
      ],
      recentCritical: [
        {
          name: hostileHtml,
          message: hostileHtml,
          category: hostileHtml,
          timestamp,
          stack: hostileHtml,
        },
      ],
    },
    config: {
      enabled: true,
      unsafeValue: hostileHtml,
    },
    websocketState: {
      current: {
        stateText: hostileHtml,
        stateMachineState: hostileHtml,
        stateMachineDescription: hostileHtml,
      },
      lastCheck: hostileHtml,
      historyLength: 1,
      unsafeValue: hostileHtml,
    },
  };
}

async function loadDashboard(): Promise<void> {
  vi.resetModules();
  document.body.innerHTML = debugDashboardHtml;
  setDocumentReadyState('complete');

  const autoRefreshToggle = document.getElementById('auto-refresh-toggle') as HTMLInputElement;
  autoRefreshToggle.checked = false;

  chrome.runtime.sendMessage.mockImplementation((message: { action?: string }) => {
    if (message.action === MessageAction.GET_DEBUG_SUMMARY) {
      return Promise.resolve({
        success: true,
        summary: createDebugSummary(),
      });
    }

    return Promise.resolve({ success: true });
  });

  await import('../../src/debug-dashboard/index.ts');

  await vi.waitFor(() => {
    expect(document.querySelector('.log-entry')).not.toBeNull();
  });
}

describe('debug dashboard safe rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders hostile log fields as text without creating DOM nodes', async () => {
    await loadDashboard();

    expect(document.querySelector('#logs-container img')).toBeNull();
    expect(document.querySelector('#logs-container [onerror]')).toBeNull();
    expect(document.querySelector('.log-message')?.textContent).toBe(hostileHtml);
    expect(document.querySelector('.log-category')?.textContent).toBe(`[${hostileHtml}]`);
    expect(document.querySelector('.log-data')?.textContent).toContain(hostileHtml);
    expect(document.querySelector('.log-data.error')?.textContent).toContain(hostileHtml);
  });

  it('renders hostile errors, config, and system info as text without creating DOM nodes', async () => {
    await loadDashboard();

    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('[onerror]')).toBeNull();
    expect(document.querySelector('#error-summary')?.textContent).toContain(hostileHtml);
    expect(document.querySelector('#critical-errors')?.textContent).toContain(hostileHtml);
    expect(document.querySelector('#debug-config pre')?.textContent).toContain(hostileHtml);
    expect(document.querySelector('#system-info pre')?.textContent).toContain(hostileHtml);
  });
});
