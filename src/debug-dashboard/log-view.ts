export interface LogViewEntry {
  timestamp: string;
  category: string;
  level: string;
  message: string;
  data?: unknown;
  error?: { name: string; message: string; stack?: string } | null;
}

export interface LogFilters {
  category: string;
  level: string;
  search: string;
}

export type LogDensity = 'comfortable' | 'compact';

export interface LogViewPrefs extends LogFilters {
  wrap: boolean;
  density: LogDensity;
}

export const MAX_RENDERED_LOGS = 1000;
export const LOG_PREFS_KEY = 'pushbullet-debug-log-prefs';
export const DEFAULT_PREFS: LogViewPrefs = { category: '', level: '', search: '', wrap: true, density: 'comfortable' };

const HIERARCHY: Record<string, string[]> = {
  DEBUG: ['DEBUG', 'INFO', 'WARN', 'ERROR'],
  INFO: ['INFO', 'WARN', 'ERROR'],
  WARN: ['WARN', 'ERROR'],
  ERROR: ['ERROR'],
};

export function shouldShowLogByLevel(logLevel: string, filterLevel: string): boolean {
  if (!filterLevel) return true;
  const allowed = HIERARCHY[filterLevel];
  return allowed ? allowed.includes(logLevel) : true;
}

export function filterLogs<T extends LogViewEntry>(logs: readonly T[], filters: LogFilters): T[] {
  let out = logs.filter((l) => (!filters.category || l.category === filters.category) && shouldShowLogByLevel(l.level, filters.level));
  const q = filters.search.trim();
  if (q) {
    let re: RegExp | null = null;
    try { re = new RegExp(q, 'i'); } catch { re = null; }
    out = out.filter((l) => {
      const hay = `${l.category} ${l.level} ${l.message}`;
      return re ? re.test(hay) : hay.toLowerCase().includes(q.toLowerCase());
    });
  }
  return out;
}

export function capLogs<T>(logs: readonly T[], cap: number = MAX_RENDERED_LOGS): T[] {
  return cap > 0 && logs.length > cap ? logs.slice(logs.length - cap) : [...logs];
}

export function parseLogTimestamp(ts: string): number | null {
  const iso = ts.split(' (')[0]?.trim() ?? ts;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

export function formatRelativeTime(ts: string, now: number = Date.now()): string {
  const t = parseLogTimestamp(ts);
  if (t === null) return ts;
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function isNearBottom(m: { scrollTop: number; clientHeight: number; scrollHeight: number }, threshold = 48): boolean {
  return m.scrollHeight - m.scrollTop - m.clientHeight <= threshold;
}

export function formatLogLine(log: LogViewEntry): string {
  let line = `[${log.timestamp}] [${log.category}:${log.level}] ${log.message}`;
  if (log.data !== undefined && log.data !== null) {
    try { line += `\n  Data: ${JSON.stringify(log.data)}`; } catch { line += '\n  Data: [unserializable]'; }
  }
  if (log.error) line += `\n  Error: ${log.error.name}: ${log.error.message}`;
  return line;
}

export function logsToText(logs: readonly LogViewEntry[]): string {
  return logs.map(formatLogLine).join('\n');
}

export function parsePrefs(raw: string | null): LogViewPrefs {
  if (!raw) return { ...DEFAULT_PREFS };
  try {
    const p = JSON.parse(raw) as Partial<LogViewPrefs>;
    return {
      category: typeof p.category === 'string' ? p.category : '',
      level: typeof p.level === 'string' && HIERARCHY[p.level] ? p.level : '',
      search: typeof p.search === 'string' ? p.search : '',
      wrap: p.wrap !== false,
      density: p.density === 'compact' ? 'compact' : 'comfortable',
    };
  } catch { return { ...DEFAULT_PREFS }; }
}
