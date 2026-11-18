/**
 * Network adapter interface
 * Abstracts extension background messaging and GM.xmlHttpRequest
 */

export interface FetchResponse {
  ok: boolean;
  status: number;
  data: string;
}

export interface FetchAdapter {
  /**
   * Fetch JSON data from a URL
   * @param url - URL to fetch
   * @returns Parsed JSON data or null on error
   */
  fetchJSON<T>(url: string): Promise<T | null>;

  /**
   * Fetch feed data (with fallback support)
   * @param primaryUrl - Primary URL to try first
   * @param fallbackUrl - Fallback URL if primary fails
   * @returns Feed data or null
   */
  fetchFeed<T>(primaryUrl: string, fallbackUrl?: string): Promise<T | null>;

  /**
   * Check if a URL is blocked (for adblock detection)
   * @param url - URL to check
   * @returns true if blocked, false otherwise
   */
  checkUrlBlocked(url: string): Promise<boolean>;

  /**
   * The same check from outside the page, where the page's CSP does not apply.
   * Absent on platforms without such a context.
   */
  checkUrlBlockedOutsidePage?(url: string): Promise<boolean>;
}
