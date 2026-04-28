/**
 * Main BonusVarsler initialization
 * Shared logic for both extension and userscript
 */

import type { StorageAdapter, SessionStorageAdapter } from "./storage/types.js";
import type { FetchAdapter } from "./network/types.js";
import type { I18nAdapter } from "./i18n/types.js";
import { MESSAGE_SHOWN_KEY_PREFIX, PAGE_VISIT_COUNT_PREFIX, CONFIG, STORAGE_KEYS } from "./config/constants.js";
import { DOMAIN_ALIASES } from "./config/domain-aliases.js";
import { Settings } from "./core/settings.js";
import { FeedManager } from "./core/feed.js";
import { findBestOffer } from "./core/merchant-matching.js";

/**
 * Platform adapters interface
 */
export interface PlatformAdapters {
  storage: StorageAdapter;
  sessionStorage: SessionStorageAdapter;
  fetcher: FetchAdapter;
  i18n: I18nAdapter;
}

/**
 * Early bailout checks (before any async work)
 * Returns true if we should skip the notification
 */
export function shouldBailOutEarly(
  sessionStorage: SessionStorageAdapter,
  currentHost: string
): boolean {
  // Skip iframes entirely
  if (window.top !== window.self) return true;

  // Track page visits per host
  const pageVisitKey = `${PAGE_VISIT_COUNT_PREFIX}${currentHost}`;
  const currentVisits = parseInt(sessionStorage.get(pageVisitKey) ?? "0", 10);
  const newVisitCount = currentVisits + 1;
  sessionStorage.set(pageVisitKey, newVisitCount.toString());

  // Only apply cooldown after enough page visits
  if (newVisitCount <= CONFIG.pageVisitsBeforeCooldown) {
    return false; // Show notification for first N visits
  }

  // Check cooldown after N visits
  const messageShownKey = `${MESSAGE_SHOWN_KEY_PREFIX}${currentHost}`;
  const messageShownTime = sessionStorage.get(messageShownKey);
  if (messageShownTime) {
    const elapsed = Date.now() - parseInt(messageShownTime, 10);
    if (elapsed < CONFIG.messageDuration) return true; // 10 minute cooldown
  }

  return false;
}

/**
 * Mark message as shown for this host
 */
export function markMessageShown(
  sessionStorage: SessionStorageAdapter,
  currentHost: string
): void {
  const messageShownKey = `${MESSAGE_SHOWN_KEY_PREFIX}${currentHost}`;
  sessionStorage.set(messageShownKey, Date.now().toString());
}

export type InitializeResult =
  | { status: "blocked" }
  | { status: "no-match"; settings: Settings }
  | { status: "match"; settings: Settings; feedManager: FeedManager; match: NonNullable<ReturnType<typeof findBestOffer>> };

/**
 * Initialize BonusVarsler
 * This is the main entry point called by platform-specific code
 */
export async function initialize(
  adapters: PlatformAdapters,
  currentHost: string,
  currentPathname = "/"
): Promise<InitializeResult> {
  const { storage, fetcher, i18n } = adapters;

  // Initialize settings first so we can bail out early
  const settings = new Settings(storage, currentHost);
  await settings.load();

  // Check if site is hidden or blacklisted
  if (settings.isSiteHidden(currentHost) || settings.isSiteBlacklisted(currentHost)) {
    return { status: "blocked" };
  }

  // Initialize feed manager
  const feedManager = new FeedManager(storage, fetcher);

  // Quick host check (if index is cached)
  const isKnown = await feedManager.isKnownMerchantHost(currentHost, DOMAIN_ALIASES);
  if (isKnown === false) {
    return { status: "no-match", settings }; // Definitely not a merchant
  }

  // Get full feed and find merchant
  const feed = await feedManager.getFeed();
  if (!feed) {
    return { status: "no-match", settings };
  }

  // Find best offer for this merchant
  const enabledServices = settings.getEnabledServices();
  const services = feedManager.getServices();
  const match = findBestOffer(feed, currentHost, enabledServices, services, currentPathname);

  if (!match) {
    return { status: "no-match", settings };
  }

  // Load language and messages only when we have a match and will show UI
  const lang = await storage.get<string>(STORAGE_KEYS.language, "no");
  await i18n.loadMessages(lang);

  return { status: "match", settings, feedManager, match };
}

// Default cashback path patterns if service doesn't specify its own
const DEFAULT_CASHBACK_PATHS = ["/cashback/", "/shop/", "/reward/"];

/**
 * Check if we're on a cashback portal page for any enabled service
 */
export function isOnCashbackPage(
  currentHost: string,
  pathname: string,
  enabledServices: string[],
  services: ReturnType<FeedManager["getServices"]>
): { isOnPage: boolean; service: typeof services[string] | null } {
  for (const serviceId of enabledServices) {
    const service = services[serviceId];
    if (!service?.reminderDomain) continue;

    const isServiceDomain =
      currentHost === service.reminderDomain ||
      currentHost === "www." + service.reminderDomain;

    // Check for cashback path patterns (service-specific or defaults)
    const patterns = service.cashbackPathPatterns ?? DEFAULT_CASHBACK_PATHS;
    const isCashbackPath = patterns.some((pattern) => pathname.startsWith(pattern));

    if (isServiceDomain && isCashbackPath) {
      return { isOnPage: true, service };
    }
  }

  return { isOnPage: false, service: null };
}
