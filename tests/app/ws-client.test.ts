import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WebSocketClient } from '../../src/app/ws/client';

const mocks = vi.hoisted(() => ({
  clearErrorBadge: vi.fn(),
  emit: vi.fn(),
  recordWebSocketConnection: vi.fn(),
  showPermanentWebSocketError: vi.fn(),
  startMonitoring: vi.fn(),
  stopMonitoring: vi.fn(),
  trackError: vi.fn(),
  websocketLog: vi.fn(),
}));

vi.mock('../../src/lib/events/event-bus', () => ({
  globalEventBus: {
    emit: mocks.emit,
  },
}));

vi.mock('../../src/lib/logging', () => ({
  debugLogger: {
    websocket: mocks.websocketLog,
  },
  globalErrorTracker: {
    trackError: mocks.trackError,
  },
}));

vi.mock('../../src/lib/perf', () => ({
  performanceMonitor: {
    recordWebSocketConnection: mocks.recordWebSocketConnection,
  },
}));

vi.mock('../../src/lib/monitoring', () => ({
  wsStateMonitor: {
    startMonitoring: mocks.startMonitoring,
    stopMonitoring: mocks.stopMonitoring,
  },
}));

vi.mock('../../src/app/notifications', () => ({
  clearErrorBadge: mocks.clearErrorBadge,
  showPermanentWebSocketError: mocks.showPermanentWebSocketError,
}));

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  close = vi.fn((code?: number, reason?: string) => {
    this.readyState = 2;
    this.closeCode = code;
    this.closeReason = reason;
  });
  closeCode?: number;
  closeReason?: string;

  constructor(public readonly url: string) {
    MockWebSocket.instances.push(this);
  }
}

function installMockWebSocket(): void {
  (globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket =
    MockWebSocket as unknown as typeof WebSocket;
}

function createClient(): WebSocketClient {
  const client = new WebSocketClient('wss://example.test/', () => 'api-key');
  client.connect();
  return client;
}

function closeSocket(code: number, reason = 'test close'): void {
  const socket = MockWebSocket.instances[0];
  if (!socket?.onclose) {
    throw new Error('Mock WebSocket close handler was not installed');
  }

  socket.onclose({
    code,
    reason,
    wasClean: false,
  } as CloseEvent);
}

function openSocket(): MockWebSocket {
  const socket = MockWebSocket.instances[0];
  if (!socket?.onopen) {
    throw new Error('Mock WebSocket open handler was not installed');
  }

  socket.readyState = 1;
  socket.onopen();
  return socket;
}

function sendMessage(data: string): void {
  const socket = MockWebSocket.instances[0];
  if (!socket?.onmessage) {
    throw new Error('Mock WebSocket message handler was not installed');
  }

  socket.onmessage({ data } as MessageEvent);
}

describe('WebSocketClient close handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockWebSocket.instances = [];
    installMockWebSocket();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([1008, 4001, 4500])(
    'emits permanent-error before any generic disconnect for close code %s',
    (code) => {
      createClient();

      closeSocket(code);

      expect(mocks.emit).toHaveBeenCalledWith('websocket:permanent-error', {
        code,
        reason: 'test close',
        wasClean: false,
      });
      expect(mocks.emit).toHaveBeenCalledWith(
        'websocket:state',
        'permanent-error',
      );
      expect(mocks.emit).not.toHaveBeenCalledWith(
        'websocket:disconnected',
        expect.anything(),
      );
      expect(mocks.showPermanentWebSocketError).toHaveBeenCalledWith({
        code,
        reason: 'test close',
        wasClean: false,
      });
      expect(mocks.emit.mock.calls.map((call) => call[0])).toEqual([
        'websocket:permanent-error',
        'websocket:state',
      ]);
    },
  );

  it('keeps generic disconnect behavior for recoverable close codes', () => {
    createClient();

    closeSocket(1006);

    expect(mocks.emit).toHaveBeenCalledWith('websocket:disconnected', {
      code: 1006,
      reason: 'test close',
      wasClean: false,
    });
    expect(mocks.emit).toHaveBeenCalledWith('websocket:state', 'disconnected');
    expect(mocks.emit).not.toHaveBeenCalledWith(
      'websocket:permanent-error',
      expect.anything(),
    );
    expect(mocks.showPermanentWebSocketError).not.toHaveBeenCalled();
    expect(mocks.emit.mock.calls.map((call) => call[0])).toEqual([
      'websocket:disconnected',
      'websocket:state',
    ]);
  });
});

describe('WebSocketClient message handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockWebSocket.instances = [];
    installMockWebSocket();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not log API key prefixes when connecting', () => {
    const apiKey = 'test-api-key-with-visible-prefix';
    const client = new WebSocketClient('wss://example.test/', () => apiKey);

    client.connect();

    expect(mocks.websocketLog).toHaveBeenCalledWith(
      'INFO',
      'WebSocket URL construction debug',
      {
        baseUrl: 'wss://example.test/',
        hasApiKey: true,
        apiKeyLength: apiKey.length,
        finalUrlLength: 'wss://example.test/'.length + apiKey.length,
        urlPattern: 'wss://example.test/***',
      },
    );
    expect(JSON.stringify(mocks.websocketLog.mock.calls)).not.toContain(
      apiKey.substring(0, 8),
    );
  });

  it('logs malformed non-JSON frames without throwing or emitting message data', () => {
    createClient();

    expect(() => sendMessage('not-json-api-key-fragment')).not.toThrow();

    expect(mocks.emit).not.toHaveBeenCalled();
    expect(mocks.websocketLog).toHaveBeenCalledWith(
      'WARN',
      'Malformed WebSocket frame ignored',
      expect.objectContaining({
        dataType: 'string',
        errorType: 'SyntaxError',
        timestamp: expect.any(String),
      }),
    );
    expect(JSON.stringify(mocks.websocketLog.mock.calls)).not.toContain(
      'not-json-api-key-fragment',
    );
  });

  it('keeps nop handling unchanged', () => {
    createClient();

    sendMessage('{"type":"nop"}');

    expect(mocks.emit).toHaveBeenCalledWith('websocket:message', {
      type: 'nop',
    });
    expect(mocks.websocketLog).toHaveBeenCalledWith(
      'DEBUG',
      'Server nop received',
      {
        timestamp: expect.any(String),
      },
    );
  });

  it('marks an open socket unhealthy when no nop arrives within the window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const client = createClient();

    openSocket();

    expect(client.isConnected()).toBe(true);
    expect(client.isConnectionHealthy()).toBe(true);

    vi.advanceTimersByTime(60001);

    expect(client.isConnectionHealthy()).toBe(false);
  });

  it('forces a recoverable disconnect when the nop watchdog expires', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    createClient();
    const socket = openSocket();

    vi.advanceTimersByTime(65001);

    expect(socket.close).toHaveBeenCalledWith(4999, 'nop-timeout');
    expect(mocks.emit).toHaveBeenCalledWith('websocket:disconnected', {
      code: 4999,
      reason: 'nop-timeout',
      wasClean: false,
    });
    expect(mocks.emit).toHaveBeenCalledWith('websocket:state', 'disconnected');
    expect(mocks.emit).not.toHaveBeenCalledWith(
      'websocket:permanent-error',
      expect.anything(),
    );
  });

  it('keeps a healthy nop stream from triggering the watchdog', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    createClient();
    const socket = openSocket();

    vi.advanceTimersByTime(60000);
    sendMessage('{"type":"nop"}');
    vi.advanceTimersByTime(5000);

    expect(socket.close).not.toHaveBeenCalled();
    expect(mocks.emit).not.toHaveBeenCalledWith(
      'websocket:disconnected',
      expect.objectContaining({ reason: 'nop-timeout' }),
    );
  });

  it('clears the nop watchdog on explicit disconnect', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const client = createClient();
    const socket = openSocket();

    client.disconnect();
    vi.advanceTimersByTime(65001);

    expect(socket.close).toHaveBeenCalledTimes(1);
    expect(mocks.emit).not.toHaveBeenCalledWith(
      'websocket:disconnected',
      expect.objectContaining({ reason: 'nop-timeout' }),
    );
  });

  it.each([
    ['push', 'websocket:tickle:push'],
    ['device', 'websocket:tickle:device'],
  ])('keeps %s tickle handling unchanged', (subtype, eventName) => {
    createClient();

    sendMessage(JSON.stringify({ type: 'tickle', subtype }));

    expect(mocks.emit).toHaveBeenCalledWith('websocket:message', {
      type: 'tickle',
      subtype,
    });
    expect(mocks.emit).toHaveBeenCalledWith(eventName);
  });
});
