import type { User, Device, Push, DevicesResponse, PushesResponse } from "../../types/domain";
import { debugLogger } from "../../lib/logging";
import { storageRepository } from "../../infrastructure/storage/storage.repository";

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

        try {
          await updateDeviceNickname(apiKey, existingDeviceIden, deviceNickname);
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

