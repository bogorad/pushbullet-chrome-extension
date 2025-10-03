import { performanceMonitor } from '../../lib/perf';
import { debugLogger } from '../../lib/logging';
import { wsStateMonitor } from '../../lib/monitoring';
import type { WebSocketMessage, Push } from '../../types/domain';
import { WS_READY_STATE } from '../../types/domain';
import { clearErrorBadge, showPermanentWebSocketError } from '../notifications';
import { globalEventBus } from '../../lib/events/event-bus';

export interface CloseInfo {
  code: number;
  reason?: string;
  wasClean?: boolean;
}

/**
 * WebSocket client for Pushbullet streaming API
 *
 * ARCHITECTURAL CHANGE: Event-Driven Architecture
 * This class now uses the global event bus to emit events instead of
 * calling handler functions directly. This decouples the WebSocketClient
 * from the background script and makes it more flexible and testable.
 *
 * Events emitted:
 * - websocket:connected - When WebSocket connection is established
 * - websocket:disconnected - When WebSocket connection is closed
 * - websocket:message - When a message is received
 * - websocket:tickle:push - When a push tickle is received
 * - websocket:tickle:device - When a device tickle is received
 * - websocket:push - When a push is received
 * - websocket:polling:check - When polling mode should be checked
 * - websocket:polling:stop - When polling mode should be stopped
 * - websocket:state - When connection state changes (for popup)
 */
export class WebSocketClient {
  private socket: WebSocket | null = null;
  private reconnectAttempts = 0;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private websocketUrl: string,
    private getApiKey: () => string | null
  ) {}

  /**
   * Get current WebSocket instance
   */
  getSocket(): WebSocket | null {
    return this.socket;
  }

  /**
   * Get current ready state
   */
  getReadyState(): number | null {
    return this.socket ? this.socket.readyState : null;
  }

  /**
   * Check if WebSocket is connected
   */
  isConnected(): boolean {
    return this.socket !== null && this.socket.readyState === WS_READY_STATE.OPEN;
  }

  /**
   * Connect to WebSocket
   */
  connect(): void {
    try {
      const apiKey = this.getApiKey();
      if (!apiKey) {
        debugLogger.websocket('WARN', 'connectWebSocket called without apiKey');
        return;
      }

      // If already open, do nothing
      if (this.socket && this.socket.readyState === WS_READY_STATE.OPEN) {
        debugLogger.websocket('DEBUG', 'WebSocket already open');
        return;
      }

      const url = this.websocketUrl + apiKey;
      debugLogger.websocket('INFO', 'Connecting to WebSocket', { url: this.websocketUrl + '***' });
      this.reconnectAttempts = 0;

      this.socket = new WebSocket(url);

      this.socket.onopen = () => {
        debugLogger.websocket('INFO', 'WebSocket connection established', { timestamp: new Date().toISOString() });
        performanceMonitor.recordWebSocketConnection(true);
        wsStateMonitor.startMonitoring();

        // Emit event to stop polling mode
        globalEventBus.emit('websocket:polling:stop');

        try {
          clearErrorBadge();
        } catch (_) {
          // noop
        }

        chrome.alarms.clear('websocketReconnect', () => {});

        if (this.reconnectTimeout) {
          clearTimeout(this.reconnectTimeout);
          this.reconnectTimeout = null;
        }

        // Emit connected event
        globalEventBus.emit('websocket:connected');

        // Emit state change for popup
        globalEventBus.emit('websocket:state', 'connected');
      };

      this.socket.onmessage = async (event) => {
        try {
          const data: WebSocketMessage = JSON.parse(event.data);
          debugLogger.websocket('DEBUG', 'WebSocket message received', {
            type: data.type,
            subtype: 'subtype' in data ? data.subtype : undefined,
            hasPush: 'push' in data ? !!data.push : false
          });

          switch (data.type) {
            case 'tickle':
              if (data.subtype === 'push') {
                // Emit tickle:push event
                globalEventBus.emit('websocket:tickle:push');
              } else if (data.subtype === 'device') {
                // Emit tickle:device event
                globalEventBus.emit('websocket:tickle:device');
              }
              break;

            case 'push':
              if ('push' in data && data.push) {
                // Emit push event with push data
                globalEventBus.emit('websocket:push', data.push);
              } else {
                debugLogger.websocket('WARN', 'Push message received without push payload');
              }
              break;

            case 'nop':
              debugLogger.websocket('DEBUG', 'Received nop (keep-alive) message', {
                timestamp: new Date().toISOString()
              });
              break;

            case 'ping':
              debugLogger.websocket('DEBUG', 'Received ping (keep-alive) message', {
                timestamp: new Date().toISOString()
              });
              break;

            case 'pong':
              debugLogger.websocket('DEBUG', 'Received pong (keep-alive) message', {
                timestamp: new Date().toISOString()
              });
              break;

            default:
              debugLogger.websocket('WARN', 'Unknown WebSocket message type received', {
                type: (data as any).type
              });
              break;
          }
        } catch (error) {
          debugLogger.websocket('ERROR', 'Failed to process WebSocket message', null, error as Error);
        }
      };

      this.socket.onerror = (error) => {
        debugLogger.websocket('ERROR', 'WebSocket error occurred', {
          error: (error as any).message || 'Unknown error',
          readyState: this.socket ? this.socket.readyState : 'null'
        }, error as any);
      };

      this.socket.onclose = (event) => {
        const closeInfo: CloseInfo = {
          code: event.code,
          reason: event.reason || 'No reason provided',
          wasClean: event.wasClean
        };

        debugLogger.websocket('WARN', 'WebSocket connection closed', {
          ...closeInfo,
          timestamp: new Date().toISOString(),
          reconnectAttempts: this.reconnectAttempts
        });

        // Emit disconnected event
        globalEventBus.emit('websocket:disconnected', {
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean
        });

        // Emit state change for popup
        globalEventBus.emit('websocket:state', 'disconnected');

        // Permanent error: stop and notify
        if (event.code === 1008 || event.code === 4001 || (event.code >= 4000 && event.code < 5000)) {
          debugLogger.websocket('ERROR', 'Permanent WebSocket error - stopping reconnection attempts', closeInfo);
          try {
            showPermanentWebSocketError(closeInfo);
          } catch (_) {
            // noop
          }
          return;
        }

        // Transient: schedule next reconnect in ~30s (one-shot)
        this.reconnectAttempts++;
        performanceMonitor.recordWebSocketReconnection();

        debugLogger.websocket('INFO', 'Scheduling WebSocket reconnection (30s one-shot)', {
          attempt: this.reconnectAttempts,
          nextAttemptAt: new Date(Date.now() + 30000).toISOString()
        });

        chrome.alarms.create('websocketReconnect', { when: Date.now() + 30000 });
      };
    } catch (error) {
      debugLogger.websocket('ERROR', 'Failed to create WebSocket connection', {
        url: this.websocketUrl + '***',
        hasApiKey: !!this.getApiKey()
      }, error as Error);
    }
  }

  /**
   * Disconnect WebSocket
   */
  disconnect(): void {
    if (this.socket) {
      try {
        debugLogger.websocket('INFO', 'Disconnecting WebSocket', {
          readyState: this.socket.readyState
        });

        this.socket.close();
        this.socket = null;

        wsStateMonitor.stopMonitoring();
      } catch (error) {
        debugLogger.websocket('ERROR', 'Error disconnecting WebSocket', null, error as Error);
      }
    }
  }

  /**
   * Get reconnect attempts count
   */
  getReconnectAttempts(): number {
    return this.reconnectAttempts;
  }

  /**
   * Reset reconnect attempts
   */
  resetReconnectAttempts(): void {
    this.reconnectAttempts = 0;
  }
}

