import type { Chat, User, Device, Push, DevicesResponse, PushesResponse } from "../../types/domain";
import { debugLogger } from "../../lib/logging";
import { storageRepository } from "../../infrastructure/storage/storage.repository";
import { fetchWithTimeout, retry } from "./http";

const API_BASE_URL = 'https://api.pushbullet.com/v2';
const PUSHES_URL = `${API_BASE_URL}/pushes`;
const DEVICES_URL = `${API_BASE_URL}/devices`;
const USER_INFO_URL = `${API_BASE_URL}/users/me`;

type HeadersInit = Record<string, string>;

// Promise singleton for device registration to prevent race conditions
let registrationPromise: Promise<{ deviceIden: string; needsUpdate: boolean }> | null = null;

function authHeaders(apiKey: string): HeadersInit {
  return { 'Access-Token': apiKey };
}

export async function fetchUserInfo(apiKey: string): Promise<User> {
  const startTime = Date.now();
  debugLogger.api('INFO', 'Fetching user info', { url: USER_INFO_URL, hasApiKey: !!apiKey, timestamp: new Date().toISOString() });

  try {
    const response = await fetch(USER_INFO_URL, { headers: authHeaders(apiKey) });
    const duration = Date.now() - startTime;

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      const error = new Error(`Failed to fetch user info: ${response.status} ${response.statusText} - ${errorText}`);
      debugLogger.api('ERROR', 'User info fetch failed', {
        url: USER_INFO_URL,
        status: response.status,
        statusText: response.statusText,
        duration: `${duration}ms`,
        errorText
      }, error);
      throw error;
    }

    const data = await response.json();
    debugLogger.api('INFO', 'User info fetched successfully', {
      url: USER_INFO_URL,
      status: response.status,
      duration: `${duration}ms`,
      userEmail: data.email ? data.email.substring(0, 3) + '***' : 'unknown',
      userName: data.name || 'unknown'
    });
    return data;
  } catch (error) {
    const duration = Date.now() - startTime;
    debugLogger.api('ERROR', 'User info fetch error', {
      url: USER_INFO_URL,
      duration: `${duration}ms`,
      error: (error as Error).message
    }, error as Error);
    throw error;
  }
}

export async function fetchUserInfoWithTimeout(apiKey: string): Promise<User> {
  const response = await fetchWithTimeout(USER_INFO_URL, { headers: authHeaders(apiKey) }, 5000);
  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`Failed to fetch user info: ${response.status} ${response.statusText} - ${errorText}`);
  }
  return response.json();
}

export async function getUserInfoWithTimeoutRetry(apiKey: string): Promise<User> {
  return retry(() => fetchUserInfoWithTimeout(apiKey), 1, 500); // 1 retry with 500ms backoff
}

export async function fetchDevices(apiKey: string): Promise<Device[]> {
  const startTime = Date.now();
  debugLogger.api('INFO', 'Fetching devices', { url: DEVICES_URL, hasApiKey: !!apiKey, timestamp: new Date().toISOString() });

  try {
    const response = await fetch(DEVICES_URL, { headers: authHeaders(apiKey) });
    const duration = Date.now() - startTime;

    if (!response.ok) {
      const error = new Error(`Failed to fetch devices: ${response.status} ${response.statusText}`);
      debugLogger.api('ERROR', 'Devices fetch failed', {
        url: DEVICES_URL,
        status: response.status,
        statusText: response.statusText,
        duration: `${duration}ms`
      }, error);
      throw error;
    }

    const data: DevicesResponse = await response.json();
    const activeDevices = data.devices.filter(device => device.active);
    debugLogger.api('INFO', 'Devices fetched successfully', {
      url: DEVICES_URL,
      status: response.status,
      duration: `${duration}ms`,
      totalDevices: data.devices.length,
      activeDevices: activeDevices.length
    });
    return activeDevices;
  } catch (error) {
    const duration = Date.now() - startTime;
    debugLogger.api('ERROR', 'Devices fetch error', {
      url: DEVICES_URL,
      duration: `${duration}ms`,
      error: (error as Error).message
    }, error as Error);
    throw error;
  }
}

export async function fetchRecentPushes(apiKey: string): Promise<Push[]> {
  const startTime = Date.now();
  const url = `${PUSHES_URL}?limit=20`;
  debugLogger.api('INFO', 'Fetching recent pushes', { url, hasApiKey: !!apiKey, timestamp: new Date().toISOString() });

  try {
    const response = await fetch(url, { headers: authHeaders(apiKey) });
    const duration = Date.now() - startTime;

    if (!response.ok) {
      const error = new Error(`Failed to fetch pushes: ${response.status} ${response.statusText}`);
      debugLogger.api('ERROR', 'Pushes fetch failed', {
        url,
        status: response.status,
        statusText: response.statusText,
        duration: `${duration}ms`
      }, error);
      throw error;
    }

    const data: PushesResponse = await response.json();
    const filteredPushes = data.pushes.filter(push => {
      const hasContent =
        ('title' in push && push.title) ||
        ('body' in push && push.body) ||
        ('url' in push && push.url) ||
        ('file_name' in push && push.file_name) ||
        ('file_url' in push && push.file_url);
      return hasContent && !push.dismissed;
    });
    debugLogger.api('INFO', 'Pushes fetched successfully', {
      url,
      status: response.status,
      duration: `${duration}ms`,
      totalPushes: data.pushes.length,
      filteredPushes: filteredPushes.length,
      pushTypes: filteredPushes.map(p => p.type).join(', ')
    });
    return filteredPushes;
  } catch (error) {
    const duration = Date.now() - startTime;
    debugLogger.api('ERROR', 'Pushes fetch error', {
      url,
      duration: `${duration}ms`,
      error: (error as Error).message
    }, error as Error);
    throw error;
  }
}

// NEW: Incremental fetch with modified_after + active=true + pagination
export async function fetchIncrementalPushes(
  apiKey: string,
  modifiedAfter: number | null,
  pageLimit = 100
): Promise<Push[]> {
  const all: Push[] = [];
  let cursor: string | undefined = undefined;
  let page = 0;

  do {
    const params = new URLSearchParams();
    params.set('active', 'true'); // exclude deletions from "latest" list
    params.set('limit', String(pageLimit));
    if (modifiedAfter && modifiedAfter > 0) {
      params.set('modified_after', String(modifiedAfter));
    }
    if (cursor) params.set('cursor', cursor);

    const url = `${PUSHES_URL}?${params.toString()}`;
    const startTime = Date.now();
    const response = await fetch(url, { headers: authHeaders(apiKey) });
    const duration = Date.now() - startTime;

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      const error = new Error(
        `Failed to fetch pushes ${response.status} ${response.statusText} - ${errorText}`
      );
      debugLogger.api('ERROR', 'Incremental pushes fetch failed', { url, status: response.status, duration: `${duration}ms`, errorText });
      throw error;
    }

    const data = (await response.json()) as PushesResponse;
    const pagePushes = Array.isArray(data.pushes) ? data.pushes : [];
    all.push(...pagePushes);
    cursor = data.cursor;

    debugLogger.api('INFO', 'Incremental pushes page fetched', {
      url,
      status: response.status,
      duration: `${duration}ms`,
      page,
      pageCount: pagePushes.length,
      totalSoFar: all.length,
      hasMore: !!cursor,
    });

    page += 1;
    // guard: avoid huge loops on first sync
    if (page > 10) break;
  } while (cursor);

  // Optional: filter to only displayable types to match background flow
  const displayableTypes = new Set(['mirror', 'note', 'link', 'sms_changed', 'file']);
  const filtered = all.filter(p => displayableTypes.has(p.type) && !p.dismissed);

  return filtered;
}

export async function ensureDeviceExists(apiKey: string, deviceIden: string): Promise<boolean> {
  const response = await fetch(
    `https://api.pushbullet.com/v2/devices/${deviceIden}`,
    { method: 'GET', headers: { 'Access-Token': apiKey } }
  );
  return response.status !== 404;
}

export async function registerDevice(
  apiKey: string,
  deviceIden: string | null,
  deviceNickname: string
): Promise<{ deviceIden: string; needsUpdate: boolean }> {
  // If registration is already in progress, return the existing promise
  if (registrationPromise) {
    debugLogger.general('INFO', 'Device registration already in progress, reusing promise', {
      source: 'registerDevice',
      existingRegistration: true
    });
    return registrationPromise;
  }

  // Create and store the registration promise
  registrationPromise = (async () => {
    try {
      debugLogger.general('INFO', 'Starting device registration process', {
        hasApiKey: !!apiKey,
        currentDeviceIden: deviceIden,
        deviceNickname,
        timestamp: new Date().toISOString()
      });

      // Check if device is already registered
      const existingDeviceIden = await storageRepository.getDeviceIden();

      if (existingDeviceIden) {
        debugLogger.general('INFO', 'Device already registered', { deviceIden: existingDeviceIden, deviceNickname });

        // Check if nickname needs updating
        try {
          const devices = await fetchDevices(apiKey);
          const currentDevice = devices.find(d => d.iden === existingDeviceIden);
          const currentNickname = currentDevice?.nickname;

          if (currentNickname !== deviceNickname) {
            await updateDeviceNickname(apiKey, existingDeviceIden, deviceNickname);
            debugLogger.general('INFO', 'Device nickname updated', { old: currentNickname, new: deviceNickname });
          } else {
            debugLogger.general('DEBUG', 'Device nickname unchanged, skipping update');
          }
          return { deviceIden: existingDeviceIden, needsUpdate: false };
        } catch (error) {
          debugLogger.general('WARN', 'Failed to update existing device, will re-register', {
            error: (error as Error).message,
            deviceIden: existingDeviceIden
          });
          await storageRepository.setDeviceIden(null);
        }
      }

      // Register new device
      debugLogger.general('INFO', 'Registering new device with Pushbullet API', { deviceNickname, url: DEVICES_URL });

      const registrationData = {
        nickname: deviceNickname,
        model: 'Chrome',
        manufacturer: 'Google',
        push_token: '',
        app_version: 8623,
        icon: 'browser',
        has_sms: false,
        type: 'chrome'
      };

      debugLogger.api('INFO', 'Sending device registration request', {
        url: DEVICES_URL,
        method: 'POST',
        deviceData: registrationData
      });

      const startTime = Date.now();
      const response = await fetch(DEVICES_URL, {
        method: 'POST',
        headers: {
          ...authHeaders(apiKey),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(registrationData)
      });

      const duration = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        const error = new Error(`Failed to register device: ${response.status} ${response.statusText} - ${errorText}`);
        debugLogger.api('ERROR', 'Device registration failed', {
          url: DEVICES_URL,
          status: response.status,
          statusText: response.statusText,
          duration: `${duration}ms`,
          errorText
        }, error);
        throw error;
      }

      const device: Device = await response.json();
      const newDeviceIden = device.iden;

      debugLogger.api('INFO', 'Device registered successfully', {
        url: DEVICES_URL,
        status: response.status,
        duration: `${duration}ms`,
        deviceIden: newDeviceIden,
        deviceNickname: device.nickname
      });

      // Save device iden to storage
      await storageRepository.setDeviceIden(newDeviceIden);

      debugLogger.general('INFO', 'Device registration completed', {
        deviceIden: newDeviceIden,
        deviceNickname: device.nickname
      });

      return { deviceIden: newDeviceIden, needsUpdate: false };
    } catch (error) {
      debugLogger.general('ERROR', 'Error in registerDevice function', {
        errorMessage: (error as Error).message,
        errorStack: (error as Error).stack
      });
      throw error;
    } finally {
      // Clear the promise reference to allow retry on failure
      registrationPromise = null;
    }
  })();

  return registrationPromise;
}

export async function updateDeviceNickname(
  apiKey: string,
  deviceIden: string,
  newNickname: string
): Promise<void> {
  const deviceExists = await ensureDeviceExists(apiKey, deviceIden);
  if (!deviceExists) {
    throw new Error(`Device with iden ${deviceIden} not found on server.`);
  }

  debugLogger.general('INFO', 'Updating device nickname', {
    deviceIden,
    newNickname,
    timestamp: new Date().toISOString()
  });

  try {
    const url = `${DEVICES_URL}/${deviceIden}`;
    const startTime = Date.now();

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        ...authHeaders(apiKey),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ nickname: newNickname })
    });

    const duration = Date.now() - startTime;

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      const error = new Error(`Failed to update device nickname: ${response.status} ${response.statusText} - ${errorText}`);
      debugLogger.api('ERROR', 'Device nickname update failed', {
        url,
        status: response.status,
        statusText: response.statusText,
        duration: `${duration}ms`,
        errorText
      }, error);
      throw error;
    }

    const device: Device = await response.json();
    debugLogger.api('INFO', 'Device nickname updated successfully', {
      url,
      status: response.status,
      duration: `${duration}ms`,
      deviceIden,
      newNickname: device.nickname
    });
  } catch (error) {
    debugLogger.general('ERROR', 'Error in updateDeviceNickname function', {
      errorMessage: (error as Error).message,
      errorStack: (error as Error).stack
    });
    throw error;
  }
}

/**
 * Fetch chats (contacts/friends) from Pushbullet
 * Returns list of active chats only
 */
export async function fetchChats(apiKey: string): Promise<Chat[]> {
  try {
    debugLogger.api("INFO", "Fetching chats from Pushbullet API");

    const response = await fetch('https://api.pushbullet.com/v2/chats', {
      method: 'GET',
      headers: {
        'Access-Token': apiKey,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch chats: ${response.status} ${response.statusText}`
      );
    }

    const data = await response.json();
    const chats = data.chats || [];

    // Filter to only active chats (not deleted)
    const activeChats = chats.filter((chat: Chat) => chat.active);

    debugLogger.api("INFO", "Chats fetched successfully", {
      totalChats: chats.length,
      activeChats: activeChats.length,
    });

    return activeChats;

  } catch (error) {
    debugLogger.api("ERROR", "Error fetching chats", {
      error: (error as Error).message,
    });
    throw error;
  }
}


