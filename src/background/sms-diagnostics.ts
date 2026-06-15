export interface SmsEphemeralStats {
  received: number;
  shown: number;
  droppedEncrypted: number;
  droppedEmpty: number;
  droppedUnsupported: number;
  resolvedFromHistory: number;
  historyFetchFailed: number;
}

const stats: SmsEphemeralStats = {
  received: 0,
  shown: 0,
  droppedEncrypted: 0,
  droppedEmpty: 0,
  droppedUnsupported: 0,
  resolvedFromHistory: 0,
  historyFetchFailed: 0,
};

export function recordSmsEphemeralReceived(): void {
  stats.received += 1;
}

export function recordSmsShown(): void {
  stats.shown += 1;
}

export function recordSmsDroppedEncrypted(): void {
  stats.droppedEncrypted += 1;
}

export function recordSmsDroppedEmpty(): void {
  stats.droppedEmpty += 1;
}

export function recordSmsDroppedUnsupported(): void {
  stats.droppedUnsupported += 1;
}

export function recordSmsResolvedFromHistory(): void {
  stats.resolvedFromHistory += 1;
}

export function recordSmsHistoryFetchFailed(): void {
  stats.historyFetchFailed += 1;
}

export function getSmsEphemeralStats(): SmsEphemeralStats {
  return { ...stats };
}

export function resetSmsEphemeralStatsForTest(): void {
  stats.received = 0;
  stats.shown = 0;
  stats.droppedEncrypted = 0;
  stats.droppedEmpty = 0;
  stats.droppedUnsupported = 0;
  stats.resolvedFromHistory = 0;
  stats.historyFetchFailed = 0;
}
