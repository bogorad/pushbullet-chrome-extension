import { storageRepository } from '../infrastructure/storage/storage.repository';
import { getUserInfoWithTimeoutRetry, fetchDevices } from '../app/api/client';
import { sessionCache, hydrateCutoff } from '../app/session';
import { debugLogger } from '../lib/logging';
import { startCriticalKeepalive, stopCriticalKeepalive } from './keepalive';
import { setApiKey } from './state';
import { ensureDebugConfigLoadedOnce } from './index';
import type { User } from '../types/domain';

// *** ADD THESE 3 IMPORTS ***
import {
  loadSessionCache,
  saveSessionCache,
} from "../infrastructure/storage/indexed-db";
import {
  isCacheFresh,
  refreshSessionInBackground,
  getInitPromise,
  setInitPromise,
  clearInitPromise,
} from "../app/session";



export async function orchestrateInitialization(
  trigger: string,
  connectWs: () => void,
): Promise<void> {
  // *** SINGLETON CHECK: Prevent duplicate initialization ***
  const existingInit = getInitPromise();
  if (existingInit) {
    debugLogger.general('INFO',
      'Initialization already in progress, awaiting existing promise',
      { trigger, source: 'orchestrateInitialization' },
    );

    try {
      await existingInit;
      debugLogger.general('INFO',
        'Existing initialization completed successfully',
        { trigger },
      );
      return; // Exit early - work is done
    } catch (error) {
      debugLogger.general('WARN',
        'Existing initialization failed, will create new attempt',
        { trigger, error: (error as Error).message },
      );
      // Fall through to create new initialization
    }
  }

  // *** CREATE WRAPPED INITIALIZATION PROMISE ***
  const initializationPromise = (async (): Promise<string | null> => {
    // START keepalive BEFORE any async work
    startCriticalKeepalive();

    try {
      await ensureDebugConfigLoadedOnce();
      const apiKey = await storageRepository.getApiKey();

      if (!apiKey) {
        debugLogger.general('WARN',
          'No API key available, skipping initialization',
        );
        return null;
      }

      // CRITICAL: hydrate in-memory state before anything uses getApiKey()
      setApiKey(apiKey);
      await hydrateCutoff();

      debugLogger.general('INFO', 'Starting orchestrated initialization', {
        trigger,
      });

      // *** STEP 1: Try to load session from IndexedDB ***
      const cachedSession = await loadSessionCache();

      if (cachedSession && isCacheFresh(cachedSession)) {
        // Cache is fresh! Use it immediately
        debugLogger.general('INFO', 'Hydrating session from IndexedDB cache', {
          cacheAge: `${Math.round((Date.now() - cachedSession.cachedAt) / 1000)}s`,
          deviceCount: cachedSession.devices.length,
          pushCount: cachedSession.recentPushes.length,
        });

        // Copy all cached fields into sessionCache
        Object.assign(sessionCache, cachedSession);

        // Connect WebSocket immediately (non-blocking)
        connectWs();

        // Start background refresh (non-blocking)
        void refreshSessionInBackground(apiKey);

        debugLogger.general('INFO',
          'Initialization completed using cache (background refresh queued)',
          { trigger },
        );

        return apiKey; // Success with cached data
      }

      // *** Cache is stale or missing - proceed with full network initialization ***
      debugLogger.general('INFO',
        'Cache stale or missing, performing full network init',
        {
          hasCachedSession: !!cachedSession,
          cacheAge: cachedSession?.cachedAt
            ? `${Math.round((Date.now() - cachedSession.cachedAt) / 1000)}s`
            : 'N/A',
        },
      );

      // *** STEP 2: Prime UI with old cached user info if available ***
      const cachedUser = await storageRepository.getUserInfoCache();
      if (cachedUser) {
        sessionCache.userInfo = cachedUser;
        debugLogger.general('INFO', 'Loaded stale user info from legacy cache');
      }

      // *** STEP 3: Fire critical network calls in parallel ***
      const userP = getUserInfoWithTimeoutRetry(apiKey)
        .then(async (u: User) => {
          sessionCache.userInfo = u;
          await storageRepository.setUserInfoCache(u);
          debugLogger.general('INFO', 'User info fetched and cached');
        })
        .catch((e: unknown) => {
          debugLogger.api('WARN',
            'users/me timed out or failed; using cache if present',
            { error: String(e) },
          );
        });

      const devicesP = fetchDevices(apiKey).then((d) => {
        sessionCache.devices = d;
        debugLogger.general('INFO', 'Devices fetched', { count: d.length });
      });

      // *** STEP 4: Start WebSocket immediately ***
      const wsP = Promise.resolve().then(() => connectWs());

      // *** STEP 5: Await devices + ws for functional readiness ***
      const results = await Promise.allSettled([devicesP, wsP]);

      debugLogger.general('INFO', 'Functional ready: devices + ws initialized', {
        trigger: trigger,
        results: results.map((r, i) => ({ index: i, status: r.status })),
      });

      // *** STEP 6: Save session to IndexedDB for next wake-up ***
      try {
        // Ensure session cache is marked as authenticated
        sessionCache.isAuthenticated = true;
        sessionCache.lastUpdated = Date.now();

        await saveSessionCache(sessionCache);

        // *** UPDATE IN-MEMORY TIMESTAMP ***
        sessionCache.cachedAt = Date.now();

        debugLogger.general('INFO',
          'Session cache saved to IndexedDB after network init',
          {
            deviceCount: sessionCache.devices.length,
            pushCount: sessionCache.recentPushes.length,
            chatCount: sessionCache.chats.length,
            cachedAt: sessionCache.cachedAt, // ← Shows correct value
          },
        );
      } catch (error) {
        // Non-fatal: Cache save failure shouldn't block initialization
        debugLogger.general('WARN',
          'Failed to save session cache to IndexedDB',
          null,
          error as Error,
        );
      }

      debugLogger.general('INFO', 'Background service worker initialized', {
        timestamp: new Date().toISOString(),
      });

      // *** STEP 7: User info can resolve later (non-blocking) ***
      await userP.catch(() => {
        /* Ignore errors here as we already logged */
      });

      return apiKey; // Success with network data
    } catch (error) {
      debugLogger.general('ERROR', 'Orchestrated initialization failed', {
        trigger,
        error: (error as Error).message,
      });
      throw error; // Re-throw to mark promise as rejected
    } finally {
      // ALWAYS stop keepalive, even if initialization fails
      stopCriticalKeepalive();
    }
  })();

  // *** REGISTER THIS PROMISE AS THE GLOBAL SINGLETON ***
  setInitPromise(initializationPromise);

  // *** AWAIT THE PROMISE AND CLEANUP ***
  try {
    await initializationPromise;

    debugLogger.general('INFO',
      'orchestrateInitialization completed successfully',
      {
        trigger,
        timestamp: new Date().toISOString(),
      },
    );
  } catch (error) {
    debugLogger.general('ERROR',
      'orchestrateInitialization failed',
      { trigger },
      error as Error,
    );
    throw error; // Re-throw for caller
  } finally {
    // *** ALWAYS CLEAR THE SINGLETON PROMISE ***
    clearInitPromise();
  }
}