import { performanceMonitor } from "../../lib/perf";
import { debugLogger, globalErrorTracker } from "../../lib/logging";
import { wsStateMonitor } from "../../lib/monitoring";
import type { WebSocketMessage } from "../../types/domain";
import { WS_READY_STATE } from "../../types/domain";
import { clearErrorBadge, showPermanentWebSocketError } from "../notifications";
import { globalEventBus } from "../../lib/events/event-bus";

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
  private static readonly PING_TIMEOUT = 10000;

  private socket: WebSocket | null = null;
  private reconnectAttempts = 0;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private pongTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private websocketUrl: string,
    private getApiKey: () => string | null,
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
    return (
      this.socket !== null && this.socket.readyState === WS_READY_STATE.OPEN
    );
  }

  /**
   * Connect to WebSocket
   */
  connect(): void {
    try {
      const apiKey = this.getApiKey();
      if (!apiKey) {
        debugLogger.websocket("WARN", "connectWebSocket called without apiKey");
        return;
      }

      // If already open, do nothing
      if (this.socket && this.socket.readyState === WS_READY_STATE.OPEN) {
        debugLogger.websocket("DEBUG", "WebSocket already open");
        return;
      }

      // Fix WebSocket URL construction - Pushbullet uses simple concatenation
      const url = this.websocketUrl + apiKey;

      // CRITICAL: Log the exact URL being constructed (without exposing full API key)
      debugLogger.websocket("INFO", "WebSocket URL construction debug", {
        baseUrl: this.websocketUrl,
        apiKeyLength: apiKey.length,
        apiKeyPrefix: apiKey.substring(0, 8) + "...",
        finalUrlLength: url.length,
        urlPattern: this.websocketUrl + "***",
      });
      debugLogger.websocket("INFO", "Connecting to WebSocket", {
        url: this.websocketUrl + "***",
        reconnectAttempts: this.reconnectAttempts,
        currentSocketState: this.socket
          ? this.socket.readyState
          : "no_existing_socket",
        apiKeyPresent: !!apiKey,
      });
      this.reconnectAttempts = 0;

      // Log pre-creation state
      debugLogger.websocket("DEBUG", "About to create WebSocket object", {
        url: this.websocketUrl + "***",
        currentSocketExists: !!this.socket,
        currentSocketState: this.socket ? this.socket.readyState : "null",
      });

      try {
        this.socket = new WebSocket(url);
        debugLogger.websocket(
          "DEBUG",
          "WebSocket object created successfully",
          {
            url: this.websocketUrl + "***",
            readyState: this.socket.readyState,
            urlLength: url.length,
          },
        );
      } catch (createError) {
        debugLogger.websocket("ERROR", "Failed to create WebSocket object", {
          url: this.websocketUrl + "***",
          error:
            createError instanceof Error
              ? createError.message
              : String(createError),
          errorType: createError?.constructor?.name,
          timestamp: new Date().toISOString(),
        });
        // Reset socket to null on creation failure
        this.socket = null;
        throw createError;
      }

      debugLogger.websocket("DEBUG", "Setting up WebSocket event handlers", {
        url: this.websocketUrl + "***",
        readyState: this.socket.readyState,
        socketExists: !!this.socket,
      });

      this.socket.onopen = () => {
        debugLogger.websocket("INFO", "WebSocket connection established", {
          timestamp: new Date().toISOString(),
        });
        performanceMonitor.recordWebSocketConnection(true);
        wsStateMonitor.startMonitoring();

        // Emit event to stop polling mode
        globalEventBus.emit("websocket:polling:stop");

        try {
          clearErrorBadge();
        } catch {
          // noop
        }

        if (this.reconnectTimeout) {
          clearTimeout(this.reconnectTimeout);
          this.reconnectTimeout = null;
        }

        // Emit connected event
        globalEventBus.emit("websocket:connected");

        // Emit state change for popup
        globalEventBus.emit("websocket:state", "connected");
      };

      this.socket.onmessage = async (event) => {
        try {
          const data: WebSocketMessage = JSON.parse(event.data);
          debugLogger.websocket("DEBUG", "WebSocket message received", {
            type: data.type,
            subtype: "subtype" in data ? data.subtype : undefined,
            hasPush: "push" in data ? !!data.push : false,
          });

          switch (data.type) {
            case "tickle":
              if (data.subtype === "push") {
                // Emit tickle:push event
                globalEventBus.emit("websocket:tickle:push");
              } else if (data.subtype === "device") {
                // Emit tickle:device event
                globalEventBus.emit("websocket:tickle:device");
              }
              break;

            case "push":
              if ("push" in data && data.push) {
                // Emit push event with push data
                globalEventBus.emit("websocket:push", data.push);
              } else {
                debugLogger.websocket(
                  "WARN",
                  "Push message received without push payload",
                );
              }
              break;

            case "nop":
              // This is a "pong" from the server. It proves the connection is alive.
              // Clear the timeout we are about to set in the ping() method.
              if (this.pongTimeout !== null) {
                clearTimeout(this.pongTimeout);
                this.pongTimeout = null;
              }
              debugLogger.websocket("DEBUG", "Pong received (via nop)", {
                timestamp: new Date().toISOString(),
              });
              break;

            // Note: 'ping' and 'pong' are WebSocket frame types, not message types
            // They should not appear in the message data, but we handle them defensively

            default:
              debugLogger.websocket(
                "WARN",
                "Unknown WebSocket message type received",
                {
                  type: (data as any).type,
                },
              );
              break;
          }
        } catch (error) {
          debugLogger.websocket(
            "ERROR",
            "Failed to process WebSocket message",
            null,
            error as Error,
          );
        }
      };

      this.socket.onerror = (error) => {
        // WebSocket error events are generic Event objects, not Error instances
        // This can occur during connection attempt, socket creation, or network issues
        // CRITICAL: This error handler might be called when this.socket is null or undefined

        const currentSocket = this.socket; // Local reference to avoid race conditions
        const socketExists = !!currentSocket;
        const socketState = socketExists
          ? currentSocket.readyState
          : "no_socket";
        const isConnecting = socketExists
          ? currentSocket.readyState === WS_READY_STATE.CONNECTING
          : false;
        const isConnected = socketExists
          ? currentSocket.readyState === WS_READY_STATE.OPEN
          : false;

        const errorInfo = {
          type: (error as any).type || "unknown",
          target: (error as any).target ? "WebSocket" : "unknown",
          readyState: socketState,
          socketExists: socketExists,
          url: this.websocketUrl,
          timestamp: new Date().toISOString(),
          reconnectAttempts: this.reconnectAttempts,
          // Additional debugging info
          isConnecting: isConnecting,
          isConnected: isConnected,
          errorEventDetails: {
            timeStamp: (error as any).timeStamp,
            bubbles: (error as any).bubbles,
            cancelable: (error as any).cancelable,
            currentTarget: (error as any).currentTarget
              ? "WebSocket"
              : "unknown",
          },
        };

        debugLogger.websocket("ERROR", "WebSocket error occurred", errorInfo);

        // Create a proper Error object for tracking
        const websocketError = new Error(
          `WebSocket connection error: ${errorInfo.type} (socket: ${socketExists ? "exists" : "null"}, state: ${socketState})`,
        );
        websocketError.name = "WebSocketError";
        globalErrorTracker.trackError(
          websocketError,
          {
            category: "WEBSOCKET",
            message: "WebSocket error occurred",
            data: errorInfo,
          },
          "WEBSOCKET",
        );
      };

      this.socket.onclose = (event) => {
        const closeInfo: CloseInfo = {
          code: event.code,
          reason: event.reason || "No reason provided",
          wasClean: event.wasClean,
        };

        debugLogger.websocket("WARN", "WebSocket connection closed", {
          ...closeInfo,
          timestamp: new Date().toISOString(),
          reconnectAttempts: this.reconnectAttempts,
        });

        // Emit disconnected event
        globalEventBus.emit("websocket:disconnected", {
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean,
        });

        // Emit state change for popup
        globalEventBus.emit("websocket:state", "disconnected");

        // Permanent error: stop and notify
        if (
          event.code === 1008 ||
          event.code === 4001 ||
          (event.code >= 4000 && event.code < 5000)
        ) {
          debugLogger.websocket(
            "ERROR",
            "Permanent WebSocket error - stopping reconnection attempts",
            closeInfo,
          );
          try {
            showPermanentWebSocketError(closeInfo);
          } catch {
            // noop
          }
          return;
        }
      };
    } catch (error) {
      debugLogger.websocket(
        "ERROR",
        "Failed to create WebSocket connection",
        {
          url: this.websocketUrl + "***",
          hasApiKey: !!this.getApiKey(),
        },
        error as Error,
      );
    }
  }

  /**
   * Disconnect WebSocket
   */
  disconnect(): void {
    if (this.socket) {
      try {
        debugLogger.websocket("INFO", "Disconnecting WebSocket", {
          readyState: this.socket.readyState,
        });

        this.socket.close();
        this.socket = null;

        wsStateMonitor.stopMonitoring();
      } catch (error) {
        debugLogger.websocket(
          "ERROR",
          "Error disconnecting WebSocket",
          null,
          error as Error,
        );
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

  /**
   * Send a ping to test connection health
   */
  ping(): void {
    // If a ping is already in progress, don't send another one.
    if (this.pongTimeout !== null) {
      return;
    }

    // If the socket isn't open, we can't send anything.
    if (
      this.socket === null ||
      this.socket.readyState !== WS_READY_STATE.OPEN
    ) {
      return;
    }

    try {
      // 1. Send a "ping" to the server by sending a nop message.
      this.socket.send(JSON.stringify({ type: "nop" }));
      debugLogger.websocket("DEBUG", "Ping sent (as nop)", {
        timestamp: new Date().toISOString(),
      });

      // 2. Set a timeout. If we don't get a pong back in 30 seconds,
      //    we will assume the connection is dead.
      this.pongTimeout = setTimeout(() => {
        debugLogger.websocket(
          "WARN",
          "Pong not received in 30 seconds. Assuming connection is dead.",
        );

        // Directly emit the disconnected event. This immediately informs the state machine.
        globalEventBus.emit("websocket:disconnected");

        // Forcefully close the socket for cleanup.
        this.socket?.close();
      }, WebSocketClient.PING_TIMEOUT); // 30-second timeout
    } catch (error) {
      debugLogger.websocket(
        "ERROR",
        "Failed to send ping",
        {
          timestamp: new Date().toISOString(),
        },
        error as Error,
      );
    }
  }
}
