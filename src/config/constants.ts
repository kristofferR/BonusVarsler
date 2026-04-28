/**
 * Shared constants for BonusVarsler
 * Storage keys, timeouts, and cache durations
 */

// Feed configuration
export const CONFIG = {
  feedUrl:
    "https://raw.githubusercontent.com/kristofferR/BonusVarsler/main/sitelist.json",
  cacheDuration: 48 * 60 * 60 * 1000, // 48 hours
  messageDuration: 10 * 60 * 1000, // 10 minutes
  pageVisitsBeforeCooldown: 3, // Start cooldown after this many page visits per site
  maxRetries: 5,
  retryDelays: [100, 500, 1000, 2000, 4000], // Exponential backoff
  adblockTimeout: 3000, // 3 seconds timeout for adblock checks
} as const;

// Storage keys
export const STORAGE_KEYS = {
  feedData: "BonusVarsler_FeedData_v1",
  feedTime: "BonusVarsler_FeedTime_v1",
  hostIndex: "BonusVarsler_HostIndex_v1",
  hiddenSites: "BonusVarsler_HiddenSites",
  blacklistedSites: "BonusVarsler_BlacklistedSites",
  theme: "BonusVarsler_Theme",
  startMinimized: "BonusVarsler_StartMinimized",
  position: "BonusVarsler_Position",
  sitePositions: "BonusVarsler_SitePositions",
  reminderShown: "BonusVarsler_ReminderShown",
  language: "BonusVarsler_Language",
  enabledServices: "BonusVarsler_EnabledServices",
  setupComplete: "BonusVarsler_SetupComplete",
  setupShowCount: "BonusVarsler_SetupShowCount",
  version: "BonusVarsler_Version",
} as const;

// Legacy storage keys for migration cleanup (v3 and v4)
export const LEGACY_KEYS = {
  feedData_v3: "BonusVarsler_FeedData_v3",
  feedTime_v3: "BonusVarsler_FeedTime_v3",
  hostIndex_v3: "BonusVarsler_HostIndex_v3",
  feedData_v4: "BonusVarsler_FeedData_v4",
  feedTime_v4: "BonusVarsler_FeedTime_v4",
  hostIndex_v4: "BonusVarsler_HostIndex_v4",
} as const;

// Version tracking
export const CURRENT_VERSION = "8.0";

// Per-host session key prefixes (used with localStorage)
export const MESSAGE_SHOWN_KEY_PREFIX = "BonusVarsler_MessageShown_";
export const PAGE_VISIT_COUNT_PREFIX = "BonusVarsler_PageVisits_";

export function getMessageShownKey(currentHost: string, currentPathname = "/"): string {
  return `${MESSAGE_SHOWN_KEY_PREFIX}${currentHost}|${currentPathname || "/"}`;
}

// Position options
export type Position = "bottom-right" | "bottom-left" | "top-right" | "top-left";
export const DEFAULT_POSITION: Position = "bottom-right";

// Theme options
export type Theme = "light" | "dark" | "system";
export const DEFAULT_THEME: Theme = "light";

// Ad test URLs for adblock detection
export const AD_TEST_URLS = [
  "https://widgets.outbrain.com/outbrain.js",
  "https://adligature.com/",
  "https://secure.quantserve.com/quant.js",
  "https://srvtrck.com/assets/css/LineIcons.css",
] as const;

// Banner IDs for DOM-based adblock detection
export const AD_BANNER_IDS = [
  "AdHeader",
  "AdContainer",
  "AD_Top",
  "homead",
  "ad-lead",
] as const;

// Sites with strict CSP that blocks our test URLs (causes false positives)
export const CSP_RESTRICTED_SITES = new Set([
  "cdon.com",
  "elite.se",
  "elon.no",
  "extraoptical.no",
  "fabel.no",
  "hoie.no",
  "lux-case.no",
  "vetzoo.no",
  "www.bookbeat.no",
  "www.clickandboat.com",
  "www.ekstralys.no",
  "www.elite.se",
  "www.getyourguide.com",
  "www.klokkegiganten.no",
  "www.myprotein.no",
  "www.skyshowtime.com",
  "www.sportmann.no",
  "www.strikkia.no",
  "www.vivara.no",
]);
