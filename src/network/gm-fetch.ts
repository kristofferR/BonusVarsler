/**
 * Greasemonkey/Tampermonkey fetch adapter using GM.xmlHttpRequest
 */

import type { FetchAdapter, FetchResponse } from "./types.js";

// GM API declarations
interface GMXMLHttpRequestDetails {
  method: string;
  url: string;
  onload?: (response: GMXMLHttpResponse) => void;
  onerror?: () => void;
  ontimeout?: () => void;
  timeout?: number;
}

interface GMXMLHttpResponse {
  status: number;
  responseText: string;
}

declare const GM: {
  xmlHttpRequest(details: GMXMLHttpRequestDetails): void;
};

declare function GM_xmlhttpRequest(details: GMXMLHttpRequestDetails): void;

/**
 * Wrapper around GM.xmlHttpRequest that returns a Promise
 */
function gmFetch(url: string, timeout = 10000): Promise<FetchResponse> {
  return new Promise((resolve, reject) => {
    const details: GMXMLHttpRequestDetails = {
      method: "GET",
      url,
      timeout,
      onload: (response) => {
        resolve({
          ok: response.status >= 200 && response.status < 300,
          status: response.status,
          data: response.responseText,
        });
      },
      onerror: () => reject(new Error("Network error")),
      ontimeout: () => reject(new Error("Timeout")),
    };

    // Try GM.xmlHttpRequest first (Greasemonkey 4+), fall back to GM_xmlhttpRequest
    if (typeof GM !== "undefined" && GM.xmlHttpRequest) {
      GM.xmlHttpRequest(details);
    } else if (typeof GM_xmlhttpRequest === "function") {
      GM_xmlhttpRequest(details);
    } else {
      reject(new Error("GM.xmlHttpRequest not available"));
    }
  });
}

export class GMFetch implements FetchAdapter {
  async fetchJSON<T>(url: string): Promise<T | null> {
    try {
      const response = await gmFetch(url);
      if (!response.ok) {
        return null;
      }
      return JSON.parse(response.data) as T;
    } catch {
      return null;
    }
  }

  async fetchFeed<T>(primaryUrl: string, fallbackUrl?: string): Promise<T | null> {
    // Try primary URL first
    const primary = await this.fetchJSON<T>(primaryUrl);
    if (primary) {
      return primary;
    }

    // Try fallback URL if provided
    if (fallbackUrl) {
      const fallback = await this.fetchJSON<T>(fallbackUrl);
      if (fallback) {
        return fallback;
      }
    }

    // Retry primary once after brief delay (handles transient network issues)
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return this.fetchJSON<T>(primaryUrl);
  }

  async checkUrlBlocked(url: string): Promise<boolean> {
    try {
      // For userscript, use regular fetch with no-cors mode
      await fetch(url, { mode: "no-cors" });
      return false;
    } catch {
      return true;
    }
  }
}

// Singleton instance
let instance: GMFetch | null = null;

export function getGMFetch(): GMFetch {
  if (!instance) {
    instance = new GMFetch();
  }
  return instance;
}
