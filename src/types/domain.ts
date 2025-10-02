/************************************
 * Domain types for TypeScript plan *
 ************************************/

export type ISO8601 = string;

export interface User {
  iden: string;
  email?: string;
  name?: string;
}

export interface Device {
  iden: string;
  nickname?: string;
  manufacturer?: string;
  model?: string;
  active?: boolean;
}

export interface PushBase {
  active?: boolean;
  created?: number;
  modified?: number;
  dismissed?: boolean;
  direction?: 'self' | 'incoming' | 'outgoing';
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
}

export type Push = LinkPush | NotePush | FilePush;

export interface SessionCache {
  userInfo?: User | null;
  devices?: Device[];
  recentPushes?: Push[];
  autoOpenLinks?: boolean;
  deviceNickname?: string;
  lastUpdated?: number; // epoch ms
}

export enum WS_READY_STATE {
  CONNECTING = 0,
  OPEN = 1,
  CLOSING = 2,
  CLOSED = 3
}

