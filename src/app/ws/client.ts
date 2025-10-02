import { performanceMonitor } from "../../lib/perf";
import { debugLogger } from "../../lib/logging";
import type { WS_READY_STATE } from "../../types/domain";

export interface CloseInfo { code: number; reason?: string; wasClean?: boolean; }

type ConnectionState = 'idle' | 'connecting' | 'connected' | 'disconnected';

export class WSClient {
  private socket: WebSocket | null = null;
  private state: ConnectionState = 'idle';
  private reconnectAttempts = 0;

  constructor(private urlBase: string, private apiKeyProvider: () => string | null) {}

  connect() {
    const apiKey = this.apiKeyProvider();
    if (!apiKey) { debugLogger.websocket('WARN', 'WS connect called without apiKey'); return; }
    if (this.socket && this.socket.readyState === WebSocket.OPEN) { debugLogger.websocket('DEBUG', 'WS already open'); return; }

    const url = this.urlBase + apiKey;
    debugLogger.websocket('INFO', 'Connecting to WebSocket', { url: this.urlBase + '***' });
    this.reconnectAttempts = 0;
    this.state = 'connecting';

    this.socket = new WebSocket(url);

    this.socket.onopen = () => {
      this.state = 'connected';
      debugLogger.websocket('INFO', 'WebSocket connection established', { ts: new Date().toISOString() });
      performanceMonitor.recordWebSocketConnection(true);
      // additional wiring happens in composition root
    };

    this.socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        debugLogger.websocket('DEBUG', 'WS message', { type: data.type, subtype: data.subtype, hasPush: !!data.push });
        // handlers wired in composition root
      } catch (err: any) {
        debugLogger.websocket('ERROR', 'Failed to process WS message', null, err);
      }
    };

    this.socket.onerror = (err: Event) => {
      debugLogger.websocket('ERROR', 'WebSocket error', { message: (err as any).message || 'Unknown' }, err as any);
    };

    this.socket.onclose = (event: CloseEvent) => {
      this.state = 'disconnected';
      const info: CloseInfo = { code: event.code, reason: event.reason || 'No reason', wasClean: event.wasClean };
      debugLogger.websocket('WARN', 'WebSocket closed', info);
      performanceMonitor.recordWebSocketReconnection();
      this.reconnectAttempts++;
    };
  }
}

export const createWSClient = (urlBase: string, provider: () => string | null) => new WSClient(urlBase, provider);

