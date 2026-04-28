/**
 * Feed management
 * Handles feed caching, validation, and fetching
 */

import type { StorageAdapter } from "../storage/types.js";
import type { FetchAdapter } from "../network/types.js";
import { CONFIG, STORAGE_KEYS } from "../config/constants.js";
import type { Service, ServiceRegistry } from "../config/services.js";
import { SERVICES_FALLBACK, mergeServices } from "../config/services.js";

/**
 * Merchant offer from a specific service
 */
export interface MerchantOffer {
  serviceId: string;
  urlName: string;
  cashbackDescription: string;
  cashbackDetails?: CashbackDetail[];
  code?: string; // For code-based services (e.g., DNB)
  clickthroughUrl?: string;
  matchPathPrefix?: string;
  matchPathCaseSensitive?: boolean;
}

/**
 * Detailed cashback rate information
 */
export interface CashbackDetail {
  value: number;
  type: string;
  description: string;
}

/**
 * Merchant data in the feed
 */
export interface Merchant {
  hostName: string;
  name: string;
  offers?: MerchantOffer[];
  // Legacy format fields
  urlName?: string;
  cashbackDescription?: string;
}

/**
 * Feed data structure
 */
export interface FeedData {
  services?: Record<string, Partial<Service>>;
  merchants: Record<string, Merchant>;
}

/**
 * Validate feed data structure
 */
export function isValidFeed(feed: unknown): feed is FeedData {
  return (
    feed !== null &&
    typeof feed === "object" &&
    "merchants" in feed &&
    typeof (feed as FeedData).merchants === "object" &&
    (feed as FeedData).merchants !== null
  );
}

/**
 * Check if feed is in unified format (has services and offers arrays)
 */
export function isUnifiedFeedFormat(feed: FeedData): boolean {
  return feed.services !== undefined && typeof feed.services === "object";
}

/**
 * Feed manager class
 */
export class FeedManager {
  private storage: StorageAdapter;
  private fetcher: FetchAdapter;
  private cachedFeed: FeedData | null = null;
  private services: ServiceRegistry = { ...SERVICES_FALLBACK };

  constructor(storage: StorageAdapter, fetcher: FetchAdapter) {
    this.storage = storage;
    this.fetcher = fetcher;
  }

  /**
   * Get the service registry (merged from feed and fallback)
   */
  getServices(): ServiceRegistry {
    return this.services;
  }

  /**
   * Get cached feed from storage
   */
  async getCachedFeed(): Promise<FeedData | null> {
    const storedTime = await this.storage.get<number | null>(STORAGE_KEYS.feedTime, null);
    if (!storedTime) {
      return null;
    }

    const elapsed = Date.now() - storedTime;
    if (elapsed >= CONFIG.cacheDuration) {
      return null;
    }

    const storedData = await this.storage.get<FeedData | null>(STORAGE_KEYS.feedData, null);
    if (isValidFeed(storedData)) {
      this.updateServicesFromFeed(storedData);
      return storedData;
    }
    return null;
  }

  /**
   * Cache feed data to storage
   */
  async cacheFeed(data: FeedData): Promise<void> {
    try {
      await this.storage.set(STORAGE_KEYS.feedData, data);
      await this.storage.set(STORAGE_KEYS.feedTime, Date.now());
      // Cache host index for fast lookups
      if (data.merchants) {
        await this.storage.set(STORAGE_KEYS.hostIndex, Object.keys(data.merchants));
      }
      this.updateServicesFromFeed(data);
    } catch {
      // Storage full or unavailable, continue without caching
    }
  }

  /**
   * Update service registry from feed data
   */
  private updateServicesFromFeed(feed: FeedData): void {
    if (feed.services) {
      this.services = mergeServices(feed.services, SERVICES_FALLBACK);
    }
  }

  /**
   * Get feed (from cache or fetch)
   */
  async getFeed(): Promise<FeedData | null> {
    // Return cached in-memory feed
    if (this.cachedFeed) {
      return this.cachedFeed;
    }

    // Try storage cache first
    const cached = await this.getCachedFeed();
    if (cached) {
      this.cachedFeed = cached;
      return cached;
    }

    // Fetch from network
    const feed = await this.fetcher.fetchFeed<FeedData>(CONFIG.feedUrl);
    if (feed && isValidFeed(feed)) {
      await this.cacheFeed(feed);
      this.cachedFeed = feed;
      return feed;
    }

    return null;
  }

  /**
   * Check if a host is in the cached host index (fast lookup)
   */
  async isKnownMerchantHost(currentHost: string, domainAliases: Record<string, string>): Promise<boolean | null> {
    const hostIndex = await this.storage.get<string[] | null>(STORAGE_KEYS.hostIndex, null);
    if (!hostIndex) {
      return null; // No index yet, need full check
    }

    const hostSet = new Set(hostIndex);
    const noWww = currentHost.replace(/^www\./, "");

    // Check direct matches
    if (
      hostSet.has(currentHost) ||
      hostSet.has(noWww) ||
      hostSet.has("www." + noWww)
    ) {
      return true;
    }

    // Check domain aliases
    const aliasedHost = domainAliases[currentHost];
    if (aliasedHost && hostSet.has(aliasedHost)) {
      return true;
    }

    const aliasedNoWww = domainAliases[noWww];
    if (aliasedNoWww && hostSet.has(aliasedNoWww)) {
      return true;
    }

    return false;
  }
}
