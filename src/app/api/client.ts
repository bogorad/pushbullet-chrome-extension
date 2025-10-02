import type { User, Device, Push, SessionCache } from "../../types/domain";

const API_BASE = "https://api.pushbullet.com";

type HeadersInit = Record<string, string>;

function authHeaders(apiKey: string): HeadersInit {
  return { Authorization: `Bearer ${apiKey}` };
}

export async function fetchUserInfo(apiKey: string): Promise<User> {
  const res = await fetch(`${API_BASE}/v2/users/me`, { headers: authHeaders(apiKey) });
  if (!res.ok) throw new Error(`User info request failed: ${res.status}`);
  return res.json();
}

export async function fetchDevices(apiKey: string): Promise<Device[]> {
  const res = await fetch(`${API_BASE}/v2/devices`, { headers: authHeaders(apiKey) });
  if (!res.ok) throw new Error(`Devices request failed: ${res.status}`);
  const data = await res.json();
  return Array.isArray(data.devices) ? data.devices : [];
}

export async function fetchRecentPushes(apiKey: string): Promise<Push[]> {
  const res = await fetch(`${API_BASE}/v2/pushes?active=true&limit=50`, { headers: authHeaders(apiKey) });
  if (!res.ok) throw new Error(`Recent pushes request failed: ${res.status}`);
  const data = await res.json();
  return Array.isArray(data.pushes) ? data.pushes : [];
}

export async function registerDevice(apiKey: string, body: Record<string, unknown>) {
  const res = await fetch(`${API_BASE}/v2/devices`, { method: "POST", headers: { ...authHeaders(apiKey), "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Register device failed: ${res.status}`);
  return res.json();
}

