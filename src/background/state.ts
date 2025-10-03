/**
 * Global state management for background service worker
 */

import type { InitializationState } from '../types/domain';
import { WebSocketClient } from '../app/ws/client';

// API constants
export const API_BASE_URL = 'https://api.pushbullet.com/v2';
export const PUSHES_URL = `${API_BASE_URL}/pushes`;
export const DEVICES_URL = `${API_BASE_URL}/devices`;
export const USER_INFO_URL = `${API_BASE_URL}/users/me`;
export const WEBSOCKET_URL = 'wss://stream.pushbullet.com/websocket/';

// Global state variables
let apiKey: string | null = null;
let deviceIden: string | null = null;
let deviceNickname = 'Chrome';
let autoOpenLinks = true;
let notificationTimeout = 10000;
let websocketClient: WebSocketClient | null = null;
let pollingMode = false;
let lastDisconnectionNotification = 0;

// Constants
export const DISCONNECTION_NOTIFICATION_COOLDOWN = 300000; // 5 minutes
export const DISCONNECTION_NOTIFICATION_THRESHOLD = 300000; // 5 minutes

// Initialization state
export const initializationState: InitializationState = {
  inProgress: false,
  completed: false,
  error: null,
  timestamp: null
};

// NO ENCRYPTION/DECRYPTION - API key is stored in plain text in chrome.storage.local
// Security: API keys are stored in local storage (not synced) to prevent exposure
// The crypto module is ONLY for decrypting E2EE push messages, NOT the API key!

// Getters and setters
export function getApiKey(): string | null {
  return apiKey;
}

export function setApiKey(key: string | null): void {
  apiKey = key;
}

export function getDeviceIden(): string | null {
  return deviceIden;
}

export function setDeviceIden(iden: string | null): void {
  deviceIden = iden;
}

export function getDeviceNickname(): string {
  return deviceNickname;
}

export function setDeviceNickname(nickname: string): void {
  deviceNickname = nickname;
}

export function getAutoOpenLinks(): boolean {
  return autoOpenLinks;
}

export function setAutoOpenLinks(value: boolean): void {
  autoOpenLinks = value;
}

export function getNotificationTimeout(): number {
  return notificationTimeout;
}

export function setNotificationTimeout(timeout: number): void {
  notificationTimeout = timeout;
}

export function getWebSocketClient(): WebSocketClient | null {
  return websocketClient;
}

export function setWebSocketClient(client: WebSocketClient | null): void {
  websocketClient = client;
}

export function isPollingMode(): boolean {
  return pollingMode;
}

export function setPollingMode(mode: boolean): void {
  pollingMode = mode;
}

export function getLastDisconnectionNotification(): number {
  return lastDisconnectionNotification;
}

export function setLastDisconnectionNotification(timestamp: number): void {
  lastDisconnectionNotification = timestamp;
}

