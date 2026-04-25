import { afterEach, describe, expect, it, vi } from 'vitest';
import { PerformanceMonitor } from '../../src/lib/perf';

describe('PerformanceMonitor', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resets counters while preserving debug export shape', () => {
    const monitor = new PerformanceMonitor();
    const now = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);

    monitor.record('custom.metric', 3);
    monitor.recordWebSocketConnection(true);
    monitor.recordWebSocketMessage(true, true);
    monitor.recordWebSocketReconnection();
    monitor.recordHealthCheckFailure();
    monitor.recordDisconnection();
    monitor.recordPermanentError();
    monitor.recordNotification('push-received');
    monitor.recordPushReceived();
    monitor.recordNotificationCreated();
    monitor.recordNotificationFailed();
    monitor.recordUnknownPushType();
    monitor.recordInvalidCursorRecovery();

    expect(monitor.exportPerformanceData()).toMatchObject({
      summary: {
        websocket: {
          connectionAttempts: 1,
          successfulConnections: 1,
          messagesReceived: 1,
          messagesProcessed: 1,
          reconnectionAttempts: 1,
          lastConnectionTime: now,
          totalDowntime: 0,
        },
        health: {
          success: 0,
          failure: 1,
          lastCheck: now,
        },
        quality: {
          disconnections: 1,
          permanentErrors: 1,
          consecutiveFailures: 2,
        },
        notifications: {
          pushesReceived: 1,
          notificationsCreated: 1,
          notificationsFailed: 1,
          unknownTypes: 1,
        },
        recovery: {
          invalidCursorRecoveries: 1,
          lastRecoveryTime: now,
        },
        metrics: {
          'custom.metric': 3,
        },
      },
      timeline: [{ ts: now, event: 'push-received' }],
    });

    monitor.reset();

    expect(monitor.exportPerformanceData()).toEqual({
      summary: {
        websocket: {
          connectionAttempts: 0,
          successfulConnections: 0,
          messagesReceived: 0,
          messagesProcessed: 0,
          reconnectionAttempts: 0,
          lastConnectionTime: null,
          totalDowntime: 0,
        },
        health: {
          success: 0,
          failure: 0,
          lastCheck: null,
        },
        quality: {
          disconnections: 0,
          permanentErrors: 0,
          consecutiveFailures: 0,
        },
        notifications: {
          pushesReceived: 0,
          notificationsCreated: 0,
          notificationsFailed: 0,
          unknownTypes: 0,
        },
        recovery: {
          invalidCursorRecoveries: 0,
          lastRecoveryTime: null,
        },
        metrics: {},
      },
      timeline: [],
    });
  });
});
