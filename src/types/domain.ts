/************************************
 * Domain types for TypeScript plan *
 ************************************/

export type ISO8601 = string;

// ============================================================================
// User and Device Types
// ============================================================================

export interface User {
  iden: string;
  email?: string;
  name?: string;
  image_url?: string;
  max_upload_size?: number;
}

export interface Device {
  iden: string;
  nickname?: string;
  manufacturer?: string;
  model?: string;
  active?: boolean;
  created?: number;
  modified?: number;
  push_token?: string;
  app_version?: number;
  type?: string;
  kind?: string;
  icon?: string;
  has_sms?: boolean;
}

// ============================================================================
// Push Types
// ============================================================================

export interface PushBase {
  iden?: string;
  active?: boolean;
  created?: number;
  modified?: number;
  dismissed?: boolean;
  direction?: 'self' | 'incoming' | 'outgoing';
  sender_iden?: string;
  sender_email?: string;
  sender_name?: string;
  receiver_iden?: string;
  receiver_email?: string;
  target_device_iden?: string;
  source_device_iden?: string;
  encrypted?: boolean;
  ciphertext?: string;
}

export interface LinkPush extends PushBase {
  type: 'link';
  title?: string;
  body?: string;
  url: string;
}

export interface NotePush extends PushBase {
  type: 'note';
  title?: string;
  body?: string;
}

export interface FilePush extends PushBase {
  type: 'file';
  file_name?: string;
  file_type?: string;
  file_url?: string;
  body?: string;
  image_url?: string;
  image_width?: number;
  image_height?: number;
}

export interface MirrorPush extends PushBase {
  type: 'mirror';
  title?: string;
  body?: string;
  icon?: string;
  application_name?: string;
  package_name?: string;
  notification_id?: string;
  notification_tag?: string;
  source_user_iden?: string;
}

export interface DismissalPush extends PushBase {
  type: 'dismissal';
  package_name?: string;
  notification_id?: string;
  notification_tag?: string;
  source_user_iden?: string;
}

export interface SmsChangedPush extends PushBase {
  type: 'sms_changed';
  notifications?: Array<{
    title?: string;
    body?: string;
    timestamp?: number;
    image_url?: string;
  }>;
}

export type Push = LinkPush | NotePush | FilePush | MirrorPush | DismissalPush | SmsChangedPush;

// ============================================================================
// Chat Types
// ============================================================================

/**
 * Represents a chat/conversation with a contact
 * From /v2/chats API endpoint
 */
export interface Chat {
  iden: string;
  active: boolean;
  created: number;
  modified: number;
  muted?: boolean;
  with: {
    email: string;
    email_normalized: string;
    iden?: string;
    image_url?: string;
    name?: string;
    type: "user" | "email";
  };
}

// ============================================================================
// Session and State Types
// ============================================================================

export interface SessionCache {
  userInfo: User | null;
  devices: Device[];
  recentPushes: Push[];
  chats: Chat[]; // ← ADD THIS LINE
  isAuthenticated: boolean;
  lastUpdated: number;
  autoOpenLinks: boolean;
  deviceNickname: string;
  onlyThisDevice: boolean;
  lastModifiedCutoff: number; // ← Tracks last timestamp for incremental fetches
  cachedAt: number; // Timestamp when cache was saved to IndexedDB
}

export interface InitializationState {
  inProgress: boolean;
  completed: boolean;
  error: Error | null;
  timestamp: number | null;
}

// ============================================================================
// WebSocket Types
// ============================================================================

export enum WS_READY_STATE {
  CONNECTING = 0,
  OPEN = 1,
  CLOSING = 2,
  CLOSED = 3
}

export interface WebSocketTickleMessage {
  type: 'tickle';
  subtype: 'push' | 'device';
}

export interface WebSocketPushMessage {
  type: 'push';
  push: Push;
}

export interface WebSocketNopMessage {
  type: 'nop';
}

export type WebSocketMessage = WebSocketTickleMessage | WebSocketPushMessage | WebSocketNopMessage;

// ============================================================================
// API Response Types
// ============================================================================

export interface APIResponse<T> {
  data?: T;
  error?: {
    type: string;
    message: string;
    cat?: string;
  };
}

export interface DevicesResponse {
  devices: Device[];
}

export interface PushesResponse {
  pushes: Push[];
  cursor?: string;
}

export type UserResponse = User;

// ============================================================================
// Configuration Types
// ============================================================================

export interface DebugConfig {
  enabled: boolean;
  categories: Record<string, boolean>;
  logLevel: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  maxLogEntries: number;
  sanitizeData: boolean;
}

export interface StorageConfig {
  apiKey?: string;
  deviceIden?: string;
  deviceNickname?: string;
  autoOpenLinks?: boolean;
  notificationTimeout?: number;
  onlyThisDevice?: boolean;
  debugConfig?: DebugConfig;
}

// ============================================================================
// Chrome Message Types
// ============================================================================

export enum MessageAction {
  GET_SESSION_DATA = 'getSessionData',
  API_KEY_CHANGED = 'apiKeyChanged',
  SESSION_DATA_UPDATED = 'sessionDataUpdated',
  PUSHES_UPDATED = 'pushesUpdated',
  SETTINGS_CHANGED = 'settingsChanged',
  LOGOUT = 'logout',
  REFRESH_SESSION = 'refreshSession',
  UPDATE_DEVICE_NICKNAME = 'updateDeviceNickname',
  LOG = 'log',
  SEND_PUSH = 'sendPush',
  GET_NOTIFICATION_DATA = 'getNotificationData',
  CLEAR_ALL_LOGS = 'clearAllLogs',
  UPDATE_DEBUG_CONFIG = 'updateDebugConfig',
  EXPORT_DEBUG_DATA = 'exportDebugData',
  GET_DEBUG_SUMMARY = 'getDebugSummary',
  CONNECTION_STATE_CHANGED = 'connectionStateChanged',
  AUTO_OPEN_LINKS_CHANGED = 'autoOpenLinksChanged',
  ENCRYPTION_PASSWORD_CHANGED = 'encryptionPasswordChanged',
  DEBUG_MODE_CHANGED = 'debugModeChanged',
}

export interface GetSessionDataMessage {
  action: MessageAction.GET_SESSION_DATA;
}

export interface SessionDataResponse {
  isAuthenticated: boolean;
  userInfo: User | null;
  devices: Device[];
  recentPushes: Push[];
  chats: Chat[]; // ← ADD THIS
  autoOpenLinks: boolean;
  deviceNickname: string;
  websocketConnected?: boolean;
  onlyThisDevice?: boolean;
  deviceIden?: string;
}

export interface ApiKeyChangedMessage {
  action: MessageAction.API_KEY_CHANGED;
  apiKey: string;
  deviceNickname?: string;
}

export interface SessionDataUpdatedMessage {
  action: MessageAction.SESSION_DATA_UPDATED;
  isAuthenticated: boolean;
  userInfo?: User | null;
  devices?: Device[];
  recentPushes?: Push[];
  autoOpenLinks?: boolean;
  deviceNickname?: string;
}

export interface PushesUpdatedMessage {
  action: MessageAction.PUSHES_UPDATED;
  pushes: Push[];
}

export interface SettingsChangedMessage {
  action: MessageAction.SETTINGS_CHANGED;
  autoOpenLinks?: boolean;
  notificationTimeout?: number;
  onlyThisDevice?: boolean;
}

export interface LogoutMessage {
  action: MessageAction.LOGOUT;
}

export interface RefreshSessionMessage {
  action: MessageAction.REFRESH_SESSION;
}

export interface UpdateDeviceNicknameMessage {
  action: MessageAction.UPDATE_DEVICE_NICKNAME;
  nickname: string;
}

export type ChromeMessage =
  | GetSessionDataMessage
  | ApiKeyChangedMessage
  | SessionDataUpdatedMessage
  | PushesUpdatedMessage
  | SettingsChangedMessage
  | LogoutMessage
  | RefreshSessionMessage
  | UpdateDeviceNicknameMessage;

// ============================================================================
// Type Guards
// ============================================================================

export function isLinkPush(push: Push): push is LinkPush {
  return push.type === 'link';
}

export function isNotePush(push: Push): push is NotePush {
  return push.type === 'note';
}

export function isFilePush(push: Push): push is FilePush {
  return push.type === 'file';
}

export function isMirrorPush(push: Push): push is MirrorPush {
  return push.type === 'mirror';
}

export function isDismissalPush(push: Push): push is DismissalPush {
  return push.type === 'dismissal';
}

export function isTickleMessage(msg: WebSocketMessage): msg is WebSocketTickleMessage {
  return msg.type === 'tickle';
}

export function isPushMessage(msg: WebSocketMessage): msg is WebSocketPushMessage {
  return msg.type === 'push';
}

export function isNopMessage(msg: WebSocketMessage): msg is WebSocketNopMessage {
  return msg.type === 'nop';
}

// ============================================================================
// Validation Helpers
// ============================================================================

export function isValidPush(push: unknown): push is Push {
  if (!push || typeof push !== 'object') return false;
  const p = push as Partial<Push>;
  return typeof p.type === 'string' && ['link', 'note', 'file', 'mirror', 'dismissal'].includes(p.type);
}

export function isValidDevice(device: unknown): device is Device {
  if (!device || typeof device !== 'object') return false;
  const d = device as Partial<Device>;
  return typeof d.iden === 'string' && d.iden.length > 0;
}

export function isValidUser(user: unknown): user is User {
  if (!user || typeof user !== 'object') return false;
  const u = user as Partial<User>;
  return typeof u.iden === 'string' && u.iden.length > 0;
}

