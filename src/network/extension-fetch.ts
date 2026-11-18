/**
 * Extension fetch adapter using background messaging
 */

import type { FetchAdapter } from "./types.js";

// Use browser API (Firefox) or chrome API (Chrome/Edge)
const browserAPI = (typeof browser !== "undefined" ? browser : chrome);

export class ExtensionFetch implements FetchAdapter {
  async fetchJSON<T>(url: string): Promise<T | null> {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        return null;
      }
      return (await response.json()) as T;
    } catch {
      return null;
    }
  }

  // URL params are intentionally unused here because the background script manages
  // feed URLs and handles CORS/fallback logic internally via its own configuration.
  async fetchFeed<T>(_primaryUrl: string, _fallbackUrl?: string): Promise<T | null> {
    try {
      // Request feed from background script (handles CORS and fallback)
      const response = (await browserAPI.runtime.sendMessage({ type: "fetchFeed" })) as {
        feed?: T;
      } | null;
      return response?.feed || null;
    } catch {
      return null;
    }
  }

  async checkUrlBlocked(url: string): Promise<boolean> {
    try {
      // no-referrer: the ad network must not learn which shop the user is on
      await fetch(url, { mode: "no-cors", referrerPolicy: "no-referrer" });
      // With no-cors, we can't read the response, but if we get here, it wasn't blocked
      return false;
    } catch {
      return true;
    }
  }
}

// Singleton instance
let instance: ExtensionFetch | null = null;

export function getExtensionFetch(): ExtensionFetch {
  if (!instance) {
    instance = new ExtensionFetch();
  }
  return instance;
}
