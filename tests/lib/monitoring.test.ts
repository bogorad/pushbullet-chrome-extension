import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WebSocketStateMonitor } from '../../src/lib/monitoring';

const mocks = vi.hoisted(() => ({
  websocketLog: vi.fn(),
}));

vi.mock('../../src/lib/logging', () => ({
  debugLogger: {
    general: vi.fn(),
    websocket: mocks.websocketLog,
  },
}));

describe('WebSocketStateMonitor', () => {
  beforeEach(() => {
    vi.useRealTimers();
    mocks.websocketLog.mockReset();
  });

  it('reports NULL before any explicit state is recorded', () => {
    const monitor = new WebSocketStateMonitor();

    expect(monitor.getStateReport()).toMatchObject({
      currentState: 'NULL',
      historyLength: 0,
    });
  });

  it('reports current state from explicit state changes', () => {
    const monitor = new WebSocketStateMonitor();

    monitor.recordStateChange(0);
    expect(monitor.getStateReport()).toMatchObject({
      currentState: 'CONNECTING',
      historyLength: 1,
    });

    monitor.recordStateChange(1);
    expect(monitor.getStateReport()).toMatchObject({
      currentState: 'OPEN',
      historyLength: 2,
    });

    monitor.recordStateChange(3);
    expect(monitor.getStateReport()).toMatchObject({
      currentState: 'CLOSED',
      historyLength: 3,
    });
  });

  it('reports current state from an injected source', () => {
    let readyState: number | null = null;
    const monitor = new WebSocketStateMonitor(() => readyState);

    expect(monitor.getStateReport().currentState).toBe('NULL');

    readyState = 0;
    expect(monitor.getStateReport().currentState).toBe('CONNECTING');

    readyState = 1;
    expect(monitor.getStateReport().currentState).toBe('OPEN');

    readyState = 3;
    expect(monitor.getStateReport().currentState).toBe('CLOSED');
  });

  it('reports current state from the setter', () => {
    const monitor = new WebSocketStateMonitor();

    monitor.setCurrentState(1);
    expect(monitor.getStateReport()).toMatchObject({
      currentState: 'OPEN',
      historyLength: 1,
    });
  });

  it('logs monitor checks without reading global websocket state', () => {
    vi.useFakeTimers();
    const monitor = new WebSocketStateMonitor();

    monitor.setCurrentState(1);
    monitor.startMonitoring();
    vi.advanceTimersByTime(30000);

    expect(mocks.websocketLog).toHaveBeenCalledWith(
      'DEBUG',
      'WebSocket state check',
      { state: 'OPEN' },
    );

    monitor.stopMonitoring();
  });
});
