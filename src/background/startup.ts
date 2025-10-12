import { storageRepository } from '../infrastructure/storage/storage.repository';
import { getUserInfoWithTimeoutRetry, fetchDevices, fetchRecentPushes } from '../app/api/client';
import { sessionCache } from '../app/session';
import { debugLogger } from '../lib/logging';
import { enqueuePostConnect } from '../realtime/postConnectQueue';
import { startCriticalKeepalive, stopCriticalKeepalive } from './keepalive';
import type { User } from '../types/domain';



export async function orchestrateInitialization({
  trigger,
  connectWs,
}: {
  trigger: string;
  connectWs: () => void;
}): Promise<void> {
  // START keepalive BEFORE any async work
  startCriticalKeepalive();

  try {
    const apiKey = await storageRepository.getApiKey();
    if (!apiKey) {
      debugLogger.general('WARN', 'No API key available, skipping initialization');
      return;
    }

    debugLogger.general('INFO', 'Starting orchestrated initialization', { trigger });

    // 1) Prime UI with cached user info if available
    const cachedUser = await storageRepository.getUserInfoCache();
    if (cachedUser) {
      sessionCache.userInfo = cachedUser;
      debugLogger.general('INFO', 'Loaded user info from cache');
    }

    // 2) Fire critical network calls in parallel
    const userP = getUserInfoWithTimeoutRetry(apiKey).then(async (u: User) => {
      sessionCache.userInfo = u;
      await storageRepository.setUserInfoCache(u);
      debugLogger.general('INFO', 'User info fetched and cached');
    }).catch((e: unknown) => {
      debugLogger.api('WARN', 'users/me timed out or failed; using cache if present', { error: String(e) });
    });

    const devicesP = fetchDevices(apiKey).then(d => {
      sessionCache.devices = d;
      debugLogger.general('INFO', 'Devices fetched', { count: d.length });
    });

    const pushesP = fetchRecentPushes(apiKey).then(p => {
      sessionCache.recentPushes = p;
      debugLogger.general('INFO', 'Recent pushes fetched', { count: p.length });
    });

  // 3) Start WebSocket immediately
  const wsP = Promise.resolve().then(() => connectWs());

    // 4) Await devices/pushes + ws for functional readiness; user info may still be pending
    const results = await Promise.allSettled([devicesP, pushesP, wsP]);

    debugLogger.general('INFO', 'Functional ready: devices, pushes, ws initialized', {
      trigger: trigger,
      results: results.map((r, i) => ({ index: i, status: r.status }))
    });

    // User info can resolve later
    await userP.catch(() => {}); // Ignore errors here as we already logged

    // Enqueue non-critical tasks to run after WS is fully connected
    enqueuePostConnect(async () => {
      // Device registration and chats fetching
      debugLogger.general('INFO', 'Running post-connect task: device registration and chats');
      // TODO: Add device registration and chats fetching here
    });

    debugLogger.general('INFO', 'Orchestrated initialization complete', { trigger });
  } catch (error) {
    debugLogger.general('ERROR', 'Orchestrated initialization failed', {
      trigger,
      error: (error as Error).message
    });
    throw error;
  } finally {
    // ALWAYS stop keepalive, even if initialization fails
    stopCriticalKeepalive();
  }
}