import type { SessionCache, User, Device, Push } from "../../types/domain";

export class SessionManager {
  private cache: SessionCache = {};

  get(): SessionCache { return this.cache; }
  set(next: SessionCache) { this.cache = { ...next, lastUpdated: Date.now() }; }
  update(patch: Partial<SessionCache>) { this.cache = { ...this.cache, ...patch, lastUpdated: Date.now() }; }

  setUser(user: User | null) { this.update({ userInfo: user }); }
  setDevices(devices: Device[]) { this.update({ devices }); }
  setRecentPushes(pushes: Push[]) { this.update({ recentPushes: pushes }); }
}

export const sessionManager = new SessionManager();

