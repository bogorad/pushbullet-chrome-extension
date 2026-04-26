import type { Chat, User, Device, Push, DevicesResponse, PushesResponse } from "../../types/domain";
import { debugLogger } from "../../lib/logging";
import { storageRepository } from "../../infrastructure/storage/storage.repository";
import { fetchWithTimeout, retry, isInvalidCursorError } from "./http";
import { checkPushTypeSupport, logUnsupportedPushType } from "../push-types";

const API_BASE_URL = 'https://api.pushbullet.com/v2';
const PUSHES_URL = `${API_BASE_URL}/pushes`;
const DEVICES_URL = `${API_BASE_URL}/devices`;
const USER_INFO_URL = `${API_BASE_URL}/users/me`;
const UPLOAD_REQUEST_URL = `${API_BASE_URL}/upload-request`;
const MAX_INCREMENTAL_PUSH_PAGES = 11;

type HeadersInit = Record<string, string>;

export type UploadApiStage = 'upload-request' | 'file-upload' | 'file-push';

export interface UploadRequestResponse {
  file_name: string;
  file_type: string;
  file_url: string;
  upload_url: string;
  data: Record<string, string>;
}

export interface SendFilePushRequest {
  file_name: string;
  file_type: string;
  file_url: string;
  body?: string;
  device_iden?: string;
  email?: string;
  source_device_iden?: string;
}

interface SendPushTarget {
  device_iden?: string;
  email?: string;
  channel_tag?: string;
  client_iden?: string;
  source_device_iden?: string;
}

function hasDisplayablePushContent(push: Push): boolean {
  if (push.type === 'sms_changed') {
    return !!push.notifications?.some(notification =>
      !!notification.title || !!notification.body || !!notification.image_url
    );
  }

  return !!(
    ('title' in push && push.title) ||
    ('body' in push && push.body) ||
    ('url' in push && push.url) ||
    ('file_name' in push && push.file_name) ||
    ('file_url' in push && push.file_url)
  );
}

export type SendPushRequest =
  | (SendPushTarget & {
      type: 'note';
      title?: string;
      body?: string;
    })
  | (SendPushTarget & {
      type: 'link';
      url: string;
      title?: string;
      body?: string;
    })
  | (SendPushTarget & {
      type: 'file';
      file_name: string;
      file_type: string;
      file_url: string;
      body?: string;
    });

export class PushbulletApiError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'PushbulletApiError';
    this.code = code;
    this.status = status;
  }
}

export class PushbulletUploadError extends Error {
  code: string;
  stage: UploadApiStage;
  status?: number;

  constructor(code: string, stage: UploadApiStage, message: string, status?: number) {
    super(message);
    this.name = 'PushbulletUploadError';
    this.code = code;
    this.stage = stage;
    this.status = status;
  }
}

// Promise singleton for device registration to prevent race conditions
let registrationPromise: Promise<{ deviceIden: string; needsUpdate: boolean }> | null = null;

function authHeaders(apiKey: string): HeadersInit {
  return { 'Access-Token': apiKey };
}

function parseApiErrorMessage(errorText: string, fallback: string): string {
  try {
    const errorData = JSON.parse(errorText) as {
      error?: { message?: string };
      message?: string;
    };
    return errorData.error?.message || errorData.message || fallback;
  } catch {
    return fallback;
  }
}

async function getApiErrorMessage(response: Response, fallback: string): Promise<string> {
  const errorText = await response.text().catch(() => '');
  if (!errorText) {
    return fallback;
  }

  return parseApiErrorMessage(errorText, fallback);
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

export async function fetchDevices(apiKey: string): Promise<Device[]> {
  const startTime = Date.now();
  debugLogger.api('INFO', 'Fetching devices', { url: DEVICES_URL, hasApiKey: !!apiKey, timestamp: new Date().toISOString() });

  try {
    const response = await fetch(`${DEVICES_URL}?active=true`, { headers: authHeaders(apiKey) });
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
    const allDevices = data.devices; // Include inactive mobiles for "Send to"
    
    // Log EVERY device name/details
    allDevices.forEach((device, index) => {
      const displayName = device.nickname || `${device.manufacturer || ''} ${device.model || device.type || ''}`.trim() || 'Unknown Device';
      debugLogger.general('INFO', `[DEVICE_NAME] #${index + 1}/${allDevices.length}: "${displayName}"`, {
        iden: device.iden,
        nickname: device.nickname || '(none)',
        model: device.model || '(none)',
        manufacturer: device.manufacturer || '(none)',
        type: device.type || '(none)',
        active: device.active
      });
    });
    
    // Filter ghosts (no truthy identifying fields)
    const validDevices = allDevices.filter(device => 
      device.nickname || device.model || device.manufacturer || device.type
    );
    
    debugLogger.api('INFO', 'Devices fetched successfully', {
      url: DEVICES_URL,
      status: response.status,
      duration: `${duration}ms`,
      totalDevices: data.devices.length,
      validDevices: validDevices.length,
      ghostDevices: data.devices.length - validDevices.length,
      activeDevices: validDevices.filter(d => d.active).length,
      inactiveDevices: validDevices.filter(d => !d.active).length
    });
    return validDevices;
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

export async function fetchRecentPushes(
  apiKey: string,
  limit: number = 20
): Promise<Push[]> {
  const startTime = Date.now();
  const url = `${PUSHES_URL}?limit=${limit}`;
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
      // Check if dismissed
      if (push.dismissed) {
        return false; // Filter out dismissed pushes
      }

      // Check if push type is supported
      const typeCheck = checkPushTypeSupport(push.type);
      if (!typeCheck.supported) {
        logUnsupportedPushType(push.type, push.iden || "unknown", "fetchRecentPushes");
        return false;
      }

      // Check if push has displayable content
      return hasDisplayablePushContent(push);
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

      // NEW: Try to parse error response
      let errorData: any = null;
      try {
        errorData = JSON.parse(errorText);
      } catch {
        // Not JSON, that's okay
      }

      // NEW: Check for invalid cursor
      if (isInvalidCursorError(response, errorData)) {
        debugLogger.api('WARN', 'Invalid cursor error detected', {
          status: response.status,
          errorText,
          modifiedAfter
        });

        // Throw special error type that can be caught by caller
        const error = new Error('INVALID_CURSOR');
        error.name = 'InvalidCursorError';
        throw error;
      }

      // Original error handling for other errors
      const error = new Error(
        `Failed to fetch pushes (${response.status} ${response.statusText}) - ${errorText}`
      );
      debugLogger.api('ERROR', 'Incremental pushes fetch failed', {
        url,
        status: response.status,
        duration: `${duration}ms`,
        errorText
      });
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
    // Guard: avoid huge loops on first sync while making truncation visible.
    if (page >= MAX_INCREMENTAL_PUSH_PAGES) {
      if (cursor) {
        debugLogger.api('WARN', 'Incremental push fetch truncated by page guard', {
          pagesFetched: page,
          maxPages: MAX_INCREMENTAL_PUSH_PAGES,
          pageLimit,
          total: all.length,
          modifiedAfter,
          hasRemainingCursor: true,
          remainingCursorLength: cursor.length,
          remainingCursorPreview: cursor.substring(0, 8),
        });
      }
      break;
    }
  } while (cursor);

  // Filter to only supported types and log unsupported ones
  const filtered = all.filter(p => {
    // Check if dismissed
    if (p.dismissed) {
      return false;
    }

    // Check push type support
    const typeCheck = checkPushTypeSupport(p.type);
    if (!typeCheck.supported) {
      logUnsupportedPushType(p.type, p.iden || "unknown", "fetchIncrementalPushes");
      return false;
    }

    // Push is supported and not dismissed
    return true;
  });

  return filtered;
}

/**
 * Fetch pushes specifically for display in the popup UI.
 * This is separate from incremental fetches used for auto-opening links.
 *
 * @param apiKey - The Pushbullet API key
 * @param limit - Number of pushes to fetch (default 50)
 * @returns Array of Push objects for display
 */
export async function fetchDisplayPushes(
  apiKey: string,
  limit: number = 50
): Promise<Push[]> {
  debugLogger.api('INFO', 'Fetching display pushes', {
    limit,
    hasApiKey: !!apiKey,
    timestamp: new Date().toISOString(),
  });

  try {
    // Use the modified fetchRecentPushes with custom limit
    const pushes = await fetchRecentPushes(apiKey, limit);

    debugLogger.api('INFO', 'Display pushes fetched successfully', {
      count: pushes.length,
      limit,
    });

    return pushes;
  } catch (error) {
    debugLogger.api('ERROR', 'Failed to fetch display pushes', {
      error: (error as Error).message,
    });
    throw error;
  }
}

export async function ensureDeviceExists(apiKey: string, deviceIden: string): Promise<boolean> {
  const response = await fetch(
    `https://api.pushbullet.com/v2/devices/${deviceIden}`,
    { method: 'GET', headers: { 'Access-Token': apiKey } }
  );

  if (response.ok) {
    return true;
  }

  if (response.status === 404) {
    return false;
  }

  const message = await getApiErrorMessage(
    response,
    `Failed to check device existence: ${response.status} ${response.statusText}`
  );
  throw new PushbulletApiError('device_lookup_failed', message, response.status);
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

          // --- START NEW CODE ---
          // Log ALL devices with ALL attributes for debugging
          debugLogger.general('INFO', '[DEVICE_DEBUG] All devices fetched from API', {
            totalDevices: devices.length,
            timestamp: new Date().toISOString()
          });

          // Log each device individually with full details
          devices.forEach((device, index) => {
            debugLogger.general('INFO', `[DEVICE_DEBUG] Device #${index + 1}`, {
              iden: device.iden,
              nickname: device.nickname || '(no nickname)',
              model: device.model || '(no model)',
              manufacturer: device.manufacturer || '(no manufacturer)',
              type: device.type || '(no type)',
              active: device.active,
              created: device.created,
              modified: device.modified,
              icon: device.icon || '(no icon)',
              hasPushToken: !!device.push_token,
              pushTokenLength: device.push_token?.length || 0,
              appVersion: device.app_version || '(no app version)',
              hasSms: device.has_sms || false
            });
          });
          // --- END NEW CODE ---

          const currentDevice = devices.find(d => d.iden === existingDeviceIden);

          // --- START FIX ---
          // Check if the stored device ID actually exists in the fetched device list
          if (!currentDevice) {
            debugLogger.general('WARN', '[DEVICE_DEBUG] Stored device ID not found in API response - device was deleted', {
              storedDeviceIden: existingDeviceIden,
              availableDeviceIdens: devices.map(d => d.iden)
            });

            // Clear stale device ID from storage
            await storageRepository.setDeviceIden(null);

            debugLogger.general('INFO', 'Cleared stale device ID, will register new device');

            // Fall through to device registration below
            // (DON'T use 'return' here - let it continue to the registration code)
          } else {
            // Device exists - check if nickname needs updating
            const currentNickname = currentDevice.nickname;

            if (currentNickname !== deviceNickname) {
              debugLogger.general('INFO', '[DEVICE_DEBUG] Nickname mismatch, updating', {
                currentNickname,
                newNickname: deviceNickname
              });

              await updateDeviceNickname(apiKey, existingDeviceIden, deviceNickname);

            } else {
              debugLogger.general('DEBUG', 'Device nickname unchanged, skipping update');
            }

            return { deviceIden: existingDeviceIden, needsUpdate: false };
          }
          // --- END FIX ---
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

export async function requestFileUpload(
  apiKey: string,
  fileName: string,
  fileType: string
): Promise<UploadRequestResponse> {
  const response = await fetch(UPLOAD_REQUEST_URL, {
    method: 'POST',
    headers: {
      ...authHeaders(apiKey),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      file_name: fileName,
      file_type: fileType,
    }),
  });

  if (!response.ok) {
    const message = await getApiErrorMessage(
      response,
      'Failed to request file upload authorization'
    );
    throw new PushbulletUploadError(
      'upload_request_failed',
      'upload-request',
      message,
      response.status
    );
  }

  return response.json();
}

export async function uploadFileToServer(
  uploadData: UploadRequestResponse,
  file: Blob
): Promise<void> {
  const formData = new FormData();
  Object.entries(uploadData.data).forEach(([key, value]) => {
    formData.append(key, value);
  });
  formData.append('file', file, uploadData.file_name);

  const response = await fetch(uploadData.upload_url, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new PushbulletUploadError(
      'file_upload_failed',
      'file-upload',
      'Failed to upload file to server',
      response.status
    );
  }
}

export async function sendFilePush(
  apiKey: string,
  filePush: SendFilePushRequest
): Promise<void> {
  const response = await fetch(PUSHES_URL, {
    method: 'POST',
    headers: {
      ...authHeaders(apiKey),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'file',
      ...filePush,
    }),
  });

  if (!response.ok) {
    const message = await getApiErrorMessage(response, 'Failed to send file push');
    throw new PushbulletUploadError(
      'file_push_failed',
      'file-push',
      message,
      response.status
    );
  }
}

export async function createPush(apiKey: string, push: SendPushRequest): Promise<Push> {
  const response = await fetch(PUSHES_URL, {
    method: 'POST',
    headers: {
      ...authHeaders(apiKey),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(push),
  });

  if (!response.ok) {
    const message = await getApiErrorMessage(response, 'Failed to send push');
    throw new PushbulletApiError('push_send_failed', message, response.status);
  }

  return response.json();
}

export async function sendPush(apiKey: string, push: SendPushRequest): Promise<Push> {
  return createPush(apiKey, push);
}

export async function dismissPush(iden: string, apiKey: string): Promise<void> {
  const url = `https://api.pushbullet.com/v2/pushes/${encodeURIComponent(iden)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      ...authHeaders(apiKey),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ dismissed: true }),
  });
  if (!response.ok) throw new Error(`Dismiss failed: ${response.status}`);
}
