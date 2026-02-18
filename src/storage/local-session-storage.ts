/**
 * Session storage using sessionStorage
 * Shared between extension and userscript platforms
 * Historic name kept for backwards compatibility with imports
 */

import type { SessionStorageAdapter } from "./types.js";

export class LocalSessionStorage implements SessionStorageAdapter {
  get(key: string): string | null {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  }

  set(key: string, value: string): void {
    try {
      sessionStorage.setItem(key, value);
    } catch {
      // Storage blocked on this site, fail silently
    }
  }
}

// Singleton instance
let localSessionStorageInstance: LocalSessionStorage | null = null;

export function getLocalSessionStorage(): LocalSessionStorage {
  if (!localSessionStorageInstance) {
    localSessionStorageInstance = new LocalSessionStorage();
  }
  return localSessionStorageInstance;
}
