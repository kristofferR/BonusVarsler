/**
 * Multi-Service Merchant Scraper
 *
 * Uses Playwright to scrape all merchants from:
 * - trumfnetthandel.no/kategori (Trumf - tracking-based cashback)
 * - onlineshopping.loyaltykey.com (SAS EuroBonus - API-based points)
 * - dnb.no/kundeprogram/fordeler/faste-rabatter (DNB - code-based rebates)
 *
 * Strategy:
 * 1. Fetch the official CDN feed to get hostname -> urlName mappings for Trumf
 * 2. Use Playwright to load pages and scroll until all merchants are loaded
 * 3. Use manual hostname mappings for merchants not in CDN feed
 * 4. Merge all services into unified sitelist.json format
 */

import { chromium, type Page, type Browser } from "playwright";
import { lookup } from "dns/promises";
import { readFile, writeFile } from "fs/promises";
import { isIP } from "net";
import { join } from "path";

// ===================
// Configuration
// ===================

const TRUMF_BASE_URL = "https://trumfnetthandel.no";
const TRUMF_CDN_FEED_URL = "https://wlp.tcb-cdn.com/trumf/notifierfeed.json";
const DNB_URL = "https://www.dnb.no/kundeprogram/fordeler/faste-rabatter";
const OBOS_BENEFITS_URL = "https://www.obos.no/medlem/medlemsfordeler";
const NAF_BENEFITS_URL = "https://www.naf.no/medlemskap/medlemsfordeler";
const LOFAVOR_BASE_URL = "https://www.lofavor.no";
const SAS_API_BASE_URL = "https://onlineshopping.loyaltykey.com";
const SAS_CHANNEL = "sas/nb-NO";
const SAS_LIST_TIMEOUT_MS = 15_000;
const SAS_DETAIL_TIMEOUT_MS = 10_000;
const LOGBUY_API_BASE_URL = "https://restapi.mylogbuy.com";

const LOGBUY_SEARCH_PAGE_SIZE = 250;
const LOGBUY_MAX_SEARCH_PAGES = 100;
const LOGBUY_API_TIMEOUT_MS = 15000;
const LOGBUY_REDIRECT_TIMEOUT_MS = 8000;
const LOGBUY_MAX_REDIRECTS = 5;
const LOGBUY_DEAL_CONCURRENCY = 8;
const LOGBUY_FALLBACK_DESCRIPTION = "Rabatt";
const LOGBUY_REDIRECT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const publicHostLookupCache = new Map<string, Promise<boolean>>();

const LOGBUY_INTERNAL_DOMAINS = [
  "mylogbuy.com",
  "restapi.mylogbuy.com",
  "files.mylogbuy.com",
];

const LOGBUY_TRACKING_DOMAINS = [
  "awin1.com",
  "go.adt242.com",
  "go.adt267.com",
  "tidd.ly",
  "bit.ly",
  "evyy.net",
  "pxf.io",
  "sjv.io",
  "kqzyfj.com",
];

// LOfavør categories to scrape (skip forsikring, bank, juridisk, ungdom — all internal)
const LOFAVOR_SCRAPE_CATEGORIES = [
  "/ferie-og-opplevelser",
  "/hus-og-hjem",
];

// Internal domains — skip benefits linking to these
const LOFAVOR_INTERNAL_DOMAINS = [
  "lofavor.no",
  "fremtind.no",
  "sparebank1.no",
  "sb1b.no",
  "help.no",
  "helpforsikring.no",
  "legalis.no",
  "advokatchatten.no",
  "norsktannhelseforsikring.no",
  "folkehjelp.no",
  "symbolskgaver.no",
  "lo.no",
  // Tracking/cookie/analytics domains that sometimes appear as false positive CTAs
  "cookieinformation.com",
  "link.hertz.com",
  "eloqua.com",
  "demio.com",
];

// Names to exclude even if they have external URLs
const LOFAVOR_EXCLUDED_NAMES = [
  "lofavør",
  "reiseforsikring",
  "norsk folkehjelp",
  // Internal banking/insurance products that appear in hus-og-hjem
  "boliglån",
  "boliglan",
  "førstehjemslån",
  "forstehjemslan",
  "flexilån",
  "flexilan",
  "depositumslån",
  "depositumslan",
  "husforsikring",
  "bsu",
  "sparekonto",
  "mastercard",
];

// Cache configuration
const CACHE_FILE = join(import.meta.dir, "..", ".scraper-cache.json");
const CACHE_MAX_AGE = 5 * 60 * 60 * 1000; // 5 hours in ms
const FEED_HEALTH_FILE = join(import.meta.dir, "..", ".feed-health.json");
const FAILURE_RATIO_THRESHOLD = 0.5;
const MIN_DEGRADED_BASELINE = 10;
const ALERT_FAILURE_THRESHOLD = 2;

// Internal domains — skip benefits linking to these (NAF)
const NAF_INTERNAL_DOMAINS = [
  "naf.no",
  "gjensidige.no",
  "fremtind.no",
  "sos.eu", // NAF veihjelp/roadside assistance (appears in footer/header on all pages)
  // Tracking/redirect domains that appear as false positive CTAs
  "safelinks.protection.outlook.com",
  "support.garmin.com",
];

// Override scraped cashback descriptions that are known to be wrong
const NAF_DESCRIPTION_OVERRIDES: Record<string, string> = {
  "zaptec-hjemmelader": "", // scraped "50 %" is promotional, not actual discount
  "drivstoff": "", // "50 % rabatt" is misleading (conditional fuel discount)
};

// Names to exclude from NAF scraping (internal NAF products, not partner discounts)
const NAF_EXCLUDED_NAMES = [
  "eu-kontroll",
  "veihjelp",
  "nøkkelforsikring",
  "nokkelforsikring",
  "egenandelsforsikring",
  "kjøpekontrakt",
  "kjopekontrakt",
  "internasjonalt førerkort",
  "internasjonalt forerkort",
  "naf veibok",
  "øvingsbane",
  "ovingsbane",
  "magasinet motor",
  "juridisk",
  "bilteknisk",
  "naf-kontroll",
  // NAF-branded financial/insurance products
  "naf forsikring",
  "naf billån",
  "naf billan",
  "naf grønt billån",
  "naf lease",
  "naf re-lease",
  "naf mc-lån",
  "naf mc-lan",
  "naf caravanlån",
  "naf caravanlan",
  "naf sykkel",
  "naf xtra",
  // Generic insurance products (via Gjensidige)
  "bilforsikring",
  "mc-forsikring",
  "reiseforsikring",
  "ulykkesforsikring",
  "husforsikring",
  "bobil- og caravanforsikring",
  "forsikring for elbil",
  "forsikring for elsparkesykkel",
  // Internal NAF services
  "bilverksted og tester",
  "dekkhotell",
  "hjulskift og dekkhotell",
  "førerutvikling",
  "forerkurs",
  "kurs: sikker på mc",
  "reiseplanlegger mc",
];

const MONITORED_SERVICE_IDS = [
  "trumf",
  "sas",
  "remember",
  "dnb",
  "obos",
  "naf",
  "lofavor",
  "logbuy",
] as const;

type ServiceId = (typeof MONITORED_SERVICE_IDS)[number];

interface ScraperCache {
  timestamp: number;
  trumfMerchants: ScrapedMerchant[];
  sasMerchants: ScrapedMerchant[];
  rememberMerchants: ScrapedMerchant[];
  dnbMerchants: ScrapedMerchant[];
  obosMerchants: ScrapedMerchant[];
  nafMerchants: ScrapedMerchant[];
  lofavorMerchants: ScrapedMerchant[];
  logbuyMerchants: ScrapedMerchant[];
  urlNameToHostname: Record<string, string>;
}

interface ServiceHealthEntry {
  consecutiveFailureDays: number;
  lastFailureDate: string | null;
  lastFailureReason: string | null;
  lastSuccessfulCount: number;
}

interface FeedHealthState {
  schemaVersion: 1;
  services: Record<ServiceId, ServiceHealthEntry>;
}

interface ServiceRunResult {
  serviceId: ServiceId;
  serviceName: string;
  merchants: ScrapedMerchant[];
  success: boolean;
  failureReason: string | null;
  baselineCount: number;
  currentCount: number;
  consecutiveFailureDays: number;
}

/**
 * Loads and validates the scraper cache file, returning it when current and well-formed.
 *
 * Validations performed: cache file exists and parses as JSON, contains array entries for all monitored services
 * (`trumfMerchants`, `rememberMerchants`, `dnbMerchants`, `obosMerchants`, `nafMerchants`, `lofavorMerchants`, `logbuyMerchants`),
 * has a well-formed `urlNameToHostname` map, every LogBuy merchant has a numeric `slug`, and the cache timestamp is newer than `CACHE_MAX_AGE`.
 *
 * @returns The parsed `ScraperCache` when present and valid; `null` otherwise.
 */
async function loadCache(): Promise<ScraperCache | null> {
  try {
    const content = await readFile(CACHE_FILE, "utf-8");
    const cache: ScraperCache = JSON.parse(content);
    if (!Array.isArray(cache.sasMerchants)) {
      return null;
    }
    const age = Date.now() - cache.timestamp;
    const hasAllServiceData =
      Array.isArray(cache.trumfMerchants) &&
      Array.isArray(cache.rememberMerchants) &&
      Array.isArray(cache.dnbMerchants) &&
      Array.isArray(cache.obosMerchants) &&
      Array.isArray(cache.nafMerchants) &&
      Array.isArray(cache.lofavorMerchants) &&
      Array.isArray(cache.logbuyMerchants);
    const hasUrlNameToHostname =
      typeof cache.urlNameToHostname === "object" &&
      cache.urlNameToHostname !== null &&
      !Array.isArray(cache.urlNameToHostname) &&
      Object.values(cache.urlNameToHostname).every(
        (hostname) => typeof hostname === "string" && hostname.length > 0
      );
    const hasCurrentLogbuyShape =
      hasAllServiceData &&
      cache.logbuyMerchants.every((merchant) => /^\d+$/.test(merchant.slug));
    if (
      age < CACHE_MAX_AGE &&
      hasAllServiceData &&
      hasUrlNameToHostname &&
      hasCurrentLogbuyShape
    ) {
      return cache;
    }
  } catch {
    // No cache or invalid
  }
  return null;
}

async function saveCache(data: Omit<ScraperCache, "timestamp">): Promise<void> {
  const cache: ScraperCache = {
    ...data,
    timestamp: Date.now(),
  };
  await writeFile(CACHE_FILE, JSON.stringify(cache, null, 2));
}

// Manual hostname mappings for Trumf merchants not in CDN feed
const TRUMF_MANUAL_HOSTNAME_MAPPINGS: Record<string, string> = {
  // Travel
  "trumfhotels-no": "www.hotels.com",
  "expedia-trumf": "www.expedia.no",
  "vrbo-trumf": "www.vrbo.com",
  // Electronics
  "apple-trumf": "www.apple.com",
  // Opticians
  "brilleland-trumf": "www.brilleland.no",
  "interoptik-trumf": "www.interoptik.no",
  // Health
  "blivakker-trumf": "www.blivakker.no",
  "dentway-trumfs": "www.dentway.no",
};

// Hostname aliases (alternative domains that should map to same merchant)
const HOSTNAME_ALIASES: Record<string, string> = {
  "no.hotels.com": "www.hotels.com",
  "hotels.com": "www.hotels.com",
  "expedia.com": "www.expedia.no",
  "expedia.no": "www.expedia.no",
  "vrbo.no": "www.vrbo.com",
  "apple.com": "www.apple.com",
  "blivakker.no": "www.blivakker.no",
  "addresshotels.com": "www.addresshotels.com",
  "bravofly.com": "www.bravofly.com",
  "storytel.com": "www.storytel.no",
  "www.storytel.com": "www.storytel.no",
  "bookbeat.com": "www.bookbeat.no",
  "www.bookbeat.com": "www.bookbeat.no",
  "outnorth.com": "outnorth.no",
  "www.outnorth.com": "outnorth.no",
  "no-pin.loccitane.com": "no.loccitane.com",
  "bilglass.no": "booking.bilglass.no",
  "www.bilglass.no": "booking.bilglass.no",
  "booking.fyriresort.com": "fyriresort.com",
  "computersalg.no": "csmegastore.no",
  "www.computersalg.no": "csmegastore.no",
  "www.csmegastore.no": "csmegastore.no",
  "www.houdinisportswear.com": "houdinisportswear.com",
  "ralphlauren.global": "www.ralphlauren.global",
};

// ===================
// Types
// ===================

interface ServiceOffer {
  serviceId: string;
  urlName: string;
  cashbackDescription: string;
  clickthroughUrl?: string;
  matchPathPrefix?: string;
  matchPathCaseSensitive?: boolean;
  code?: string; // For code-based services like DNB
  cashbackDetails?: Array<{
    value: number;
    type: "PERCENTAGE" | "NOK";
    description: string;
  }>;
}

interface MerchantEntry {
  hostName: string;
  name: string;
  offers: ServiceOffer[];
}

interface ServiceDefinition {
  name: string;
  clickthroughUrl: string;
  reminderDomain?: string;
  cashbackPathPatterns?: string[];
  color: string;
  defaultEnabled: boolean;
  type?: "code" | "info";
}

interface SiteList {
  services: Record<string, ServiceDefinition>;
  merchants: Record<string, MerchantEntry>;
}

interface CDNFeed {
  settings: Record<string, unknown>;
  merchants: Record<
    string,
    {
      hostName: string;
      urlName: string;
      name: string;
      cashbackDescription: string;
      basicRate?: string;
      headerId?: number;
      programId?: number;
    }
  >;
}

interface ScrapedMerchant {
  name: string;
  cashbackDescription: string;
  slug: string;
  code?: string; // For code-based services
  storeUrl?: string;
  clickthroughUrl?: string;
  matchPathPrefix?: string;
  matchPathCaseSensitive?: boolean;
}

// ===================
// Utility Functions
/**
 * Maps an array of items through an asynchronous mapper with a limit on concurrent executions while preserving input order.
 *
 * @param items - The array of input items to map
 * @param concurrency - Maximum number of mapper functions to run concurrently (clamped to at least 1 and at most `items.length`)
 * @param mapper - Async function that transforms an item; receives the item and its index
 * @returns An array of mapper results in the same order as the input `items`
 */

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  /**
   * Consumes remaining items by repeatedly taking the next available index and applying the mapper, writing each mapped value back into the corresponding position of the results array.
   *
   * Processes items until all have been handled; each iteration awaits the mapper for the current item and preserves original ordering by storing the result at the item's index.
   */
  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex++;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  const workerCount = Math.min(Math.max(concurrency, 1), items.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

/**
 * Infers a canonical hostname from a merchant or store name.
 *
 * Attempts to produce a normalized `www.` hostname when the input contains a recognizable domain or matches a small set of known brand names.
 *
 * @returns The inferred hostname prefixed with `www.` (for example, `www.example.com`) if a mapping can be determined, `null` otherwise.
 */
function inferHostname(name: string): string | null {
  const cleanName = name.toLowerCase().trim();

  // If name looks like a domain already
  if (
    cleanName.includes(".com") ||
    cleanName.includes(".no") ||
    cleanName.includes(".se")
  ) {
    const domainMatch = cleanName.match(/([a-z0-9-]+\.[a-z]{2,})/);
    if (domainMatch) {
      return `www.${domainMatch[1]}`;
    }
  }

  // Check well-known brands
  const normalized = cleanName.replace(/[^a-z0-9]/g, "").toLowerCase();
  const wellKnownBrands: Record<string, string> = {
    hotelscom: "www.hotels.com",
    expedia: "www.expedia.no",
    vrbo: "www.vrbo.com",
    apple: "www.apple.com",
    ebay: "www.ebay.com",
  };

  return wellKnownBrands[normalized] || null;
}

function normalizeHostname(hostname: string): string {
  return HOSTNAME_ALIASES[hostname] || hostname;
}

function parseShopKey(shopKey: string): { hostname: string; matchPathPrefix?: string } | null {
  const trimmed = shopKey.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(`https://${trimmed}`);
    const pathPrefix = url.pathname === "/" ? undefined : url.pathname.replace(/\/+$/, "");
    return {
      hostname: normalizeHostname(url.hostname),
      ...(pathPrefix && { matchPathPrefix: pathPrefix }),
    };
  } catch {
    return null;
  }
}

function formatSasPoints(points: number): string {
  return String(points).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/**
 * Normalize a store name for matching across services
 */
function normalizeStoreName(name: string): string {
  return name
    .toLowerCase()
    // Remove "Direct Deals" suffix (re:member specific)
    .replace(/\s*direct deals$/i, "")
    // Remove common domain suffixes (requires literal dot before TLD)
    .replace(/\.(no|com|se|dk|eu|net|org)$/i, "")
    // Remove punctuation
    .replace(/[.,-]/g, "")
    // Normalize whitespace
    .replace(/\s+/g, " ")
    .trim();
}

function formatOsloDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Oslo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    throw new Error("Failed to format Oslo date");
  }

  return `${year}-${month}-${day}`;
}

function getPreviousDateString(dateString: string): string {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - 1);
  return formatOsloDate(date);
}

function countOffersByService(sitelist: SiteList): Record<ServiceId, number> {
  const counts = Object.fromEntries(
    MONITORED_SERVICE_IDS.map((serviceId) => [serviceId, 0])
  ) as Record<ServiceId, number>;

  for (const merchant of Object.values(sitelist.merchants)) {
    for (const offer of merchant.offers) {
      if (offer.serviceId in counts) {
        counts[offer.serviceId as ServiceId]++;
      }
    }
  }

  return counts;
}

function createDefaultFeedHealth(
  baselineCounts: Record<ServiceId, number>
): FeedHealthState {
  return {
    schemaVersion: 1,
    services: Object.fromEntries(
      MONITORED_SERVICE_IDS.map((serviceId) => [
        serviceId,
        {
          consecutiveFailureDays: 0,
          lastFailureDate: null,
          lastFailureReason: null,
          lastSuccessfulCount: baselineCounts[serviceId],
        },
      ])
    ) as Record<ServiceId, ServiceHealthEntry>,
  };
}

async function loadFeedHealth(
  baselineCounts: Record<ServiceId, number>
): Promise<FeedHealthState> {
  const defaultState = createDefaultFeedHealth(baselineCounts);

  try {
    const content = await readFile(FEED_HEALTH_FILE, "utf-8");
    const parsed = JSON.parse(content) as Partial<FeedHealthState>;
    const parsedServices = (parsed.services || {}) as Record<
      string,
      Partial<ServiceHealthEntry>
    >;

    return {
      schemaVersion: 1,
      services: Object.fromEntries(
        MONITORED_SERVICE_IDS.map((serviceId) => {
          const existing = parsedServices[serviceId] || {};
          return [
            serviceId,
            {
              consecutiveFailureDays: existing.consecutiveFailureDays ?? 0,
              lastFailureDate: existing.lastFailureDate ?? null,
              lastFailureReason: existing.lastFailureReason ?? null,
              lastSuccessfulCount:
                existing.lastSuccessfulCount ?? baselineCounts[serviceId],
            },
          ];
        })
      ) as Record<ServiceId, ServiceHealthEntry>,
    };
  } catch {
    return defaultState;
  }
}

async function saveFeedHealth(feedHealth: FeedHealthState): Promise<void> {
  await writeFile(FEED_HEALTH_FILE, JSON.stringify(feedHealth, null, 2) + "\n");
}

function cloneOffer(offer: ServiceOffer): ServiceOffer {
  return {
    ...offer,
    ...(offer.cashbackDetails && {
      cashbackDetails: offer.cashbackDetails.map((detail) => ({ ...detail })),
    }),
  };
}

function isSameServiceOffer(
  existingOffer: ServiceOffer,
  restoredOffer: ServiceOffer,
  serviceId: ServiceId
): boolean {
  return (
    existingOffer.serviceId === serviceId &&
    existingOffer.urlName === restoredOffer.urlName &&
    (existingOffer.matchPathPrefix ?? null) ===
      (restoredOffer.matchPathPrefix ?? null) &&
    (existingOffer.matchPathCaseSensitive ?? false) ===
      (restoredOffer.matchPathCaseSensitive ?? false)
  );
}

function restoreServiceOffersFromExisting(
  merchants: Record<string, MerchantEntry>,
  existingSitelist: SiteList,
  serviceId: ServiceId
): number {
  let restored = 0;

  for (const existingMerchant of Object.values(existingSitelist.merchants)) {
    const serviceOffers = existingMerchant.offers.filter(
      (offer) => offer.serviceId === serviceId
    );

    if (serviceOffers.length === 0) {
      continue;
    }

    if (!merchants[existingMerchant.hostName]) {
      merchants[existingMerchant.hostName] = {
        hostName: existingMerchant.hostName,
        name: existingMerchant.name,
        offers: [],
      };
    }

    for (const offer of serviceOffers) {
      const hasOffer = merchants[existingMerchant.hostName].offers.some(
        (existingOffer) => isSameServiceOffer(existingOffer, offer, serviceId)
      );

      if (!hasOffer) {
        merchants[existingMerchant.hostName].offers.push(cloneOffer(offer));
        restored++;
      }
    }
  }

  return restored;
}

function evaluateServiceFailure(
  currentCount: number,
  baselineCount: number
): string | null {
  if (baselineCount === 0 && currentCount === 0) {
    return "returned 0 merchants on initial scrape";
  }

  if (baselineCount > 0 && currentCount === 0) {
    return `returned 0 merchants (last successful count ${baselineCount})`;
  }

  if (
    baselineCount >= MIN_DEGRADED_BASELINE &&
    currentCount > 0 &&
    currentCount < Math.ceil(baselineCount * FAILURE_RATIO_THRESHOLD)
  ) {
    return `returned only ${currentCount} merchants (last successful count ${baselineCount})`;
  }

  return null;
}

function recordServiceSuccess(
  entry: ServiceHealthEntry,
  count: number
): ServiceHealthEntry {
  return {
    ...entry,
    consecutiveFailureDays: 0,
    lastFailureDate: null,
    lastFailureReason: null,
    lastSuccessfulCount: count,
  };
}

function recordServiceFailure(
  entry: ServiceHealthEntry,
  reason: string,
  today: string
): ServiceHealthEntry {
  const yesterday = getPreviousDateString(today);

  let consecutiveFailureDays = 1;
  if (entry.lastFailureDate === today) {
    consecutiveFailureDays = Math.max(entry.consecutiveFailureDays, 1);
  } else if (entry.lastFailureDate === yesterday) {
    consecutiveFailureDays = entry.consecutiveFailureDays + 1;
  }

  return {
    ...entry,
    consecutiveFailureDays,
    lastFailureDate: today,
    lastFailureReason: reason,
  };
}

function summarizeError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return String(error);
}

async function runServiceScrape({
  serviceId,
  serviceName,
  baselineCount,
  today,
  feedHealth,
  scrape,
}: {
  serviceId: ServiceId;
  serviceName: string;
  baselineCount: number;
  today: string;
  feedHealth: FeedHealthState;
  scrape: () => Promise<ScrapedMerchant[]>;
}): Promise<ServiceRunResult> {
  let merchants: ScrapedMerchant[] = [];
  let failureReason: string | null = null;

  try {
    merchants = await scrape();
  } catch (error) {
    failureReason = summarizeError(error);
  }

  if (!failureReason) {
    failureReason = evaluateServiceFailure(merchants.length, baselineCount);
  }

  if (failureReason) {
    const updatedEntry = recordServiceFailure(
      feedHealth.services[serviceId],
      failureReason,
      today
    );
    feedHealth.services[serviceId] = updatedEntry;
    console.log(
      `  ${serviceName}: scrape failed, reusing previous data (${updatedEntry.consecutiveFailureDays} day streak)`
    );
    console.log(`    Reason: ${failureReason}`);

    return {
      serviceId,
      serviceName,
      merchants: [],
      success: false,
      failureReason,
      baselineCount,
      currentCount: merchants.length,
      consecutiveFailureDays: updatedEntry.consecutiveFailureDays,
    };
  }

  const updatedEntry = recordServiceSuccess(
    feedHealth.services[serviceId],
    merchants.length
  );
  feedHealth.services[serviceId] = updatedEntry;
  console.log(`  ${serviceName}: OK (${merchants.length} merchants)`);

  return {
    serviceId,
    serviceName,
    merchants,
    success: true,
    failureReason: null,
    baselineCount,
    currentCount: merchants.length,
    consecutiveFailureDays: 0,
  };
}

// ===================
// Trumf Scraping
// ===================

async function fetchTrumfCDNFeed(): Promise<{
  feed: CDNFeed;
  urlNameToHostname: Map<string, string>;
}> {
  const response = await fetch(TRUMF_CDN_FEED_URL);
  const feed: CDNFeed = await response.json();

  const urlNameToHostname = new Map<string, string>();
  for (const [hostname, merchant] of Object.entries(feed.merchants)) {
    urlNameToHostname.set(merchant.urlName, hostname);
  }

  return { feed, urlNameToHostname };
}

async function scrapeTrumf(page: Page): Promise<ScrapedMerchant[]> {
  console.log("\n=== Scraping Trumf ===");
  console.log("Loading /kategori page...");
  await page.goto(`${TRUMF_BASE_URL}/kategori`, {
    waitUntil: "domcontentloaded",
  });

  // Wait for initial content
  await page.waitForSelector('a[href^="/cashback/"]', { timeout: 10000 });

  // Scroll to load all lazy-loaded content
  console.log("Scrolling to load all merchants...");
  let previousCount = 0;
  let currentCount = 0;
  let stableCount = 0;
  let scrollAttempts = 0;
  const maxScrollAttempts = 100;

  do {
    previousCount = currentCount;

    // Scroll down incrementally
    await page.evaluate(() => {
      window.scrollBy(0, window.innerHeight);
    });

    // Wait for potential new content to load
    await page.waitForTimeout(300);

    // Also try waiting for network to settle
    try {
      await page.waitForLoadState("networkidle", { timeout: 1000 });
    } catch {
      // Timeout is fine, continue scrolling
    }

    // Count current merchants
    currentCount = await page.locator('a[href^="/cashback/"]').count();

    // Track how many times count has been stable
    if (currentCount === previousCount) {
      stableCount++;
    } else {
      stableCount = 0;
    }

    scrollAttempts++;
    process.stdout.write(
      `\r  Found ${currentCount} merchants (scroll ${scrollAttempts}, stable: ${stableCount})...`
    );

    // Stop if count has been stable for 5 scrolls at the bottom
  } while (stableCount < 5 && scrollAttempts < maxScrollAttempts);

  console.log(`\n  Finished scrolling. Total: ${currentCount} merchants`);

  // Extract merchant data
  console.log("Extracting merchant data...");
  const merchants = await page.evaluate(() => {
    const results: { name: string; cashbackDescription: string; slug: string }[] =
      [];
    const seen = new Set<string>();

    document.querySelectorAll('a[href^="/cashback/"]').forEach((link) => {
      const href = link.getAttribute("href") || "";
      const slug = decodeURIComponent(href.replace("/cashback/", "").split("?")[0]);

      if (!slug || seen.has(slug)) return;
      seen.add(slug);

      // Get merchant name - look for heading or image alt
      const name =
        link.querySelector("h3, h4, h5")?.textContent?.trim() ||
        link.querySelector("img")?.getAttribute("alt")?.trim() ||
        "";

      // Get cashback rate - look for text containing %
      const allText = link.textContent || "";
      const cashbackMatch = allText.match(
        /(\d+[,.]?\d*\s*%|Opptil\s+\d+[,.]?\d*\s*%|\d+\s*kr)/i
      );
      const cashbackDescription = cashbackMatch ? cashbackMatch[0].trim() : "";

      if (name) {
        results.push({ name, cashbackDescription, slug });
      }
    });

    return results;
  });

  return merchants;
}

// ===================
// SAS EuroBonus Scraping
// ===================

interface SasShopDetail {
  uuid: string;
  name: string;
  commission_type: "fixed" | "variable";
  points: number;
  currency: string;
  url: string;
}

interface SasShopDetailResponse {
  data?: SasShopDetail;
}

async function scrapeSAS(): Promise<ScrapedMerchant[]> {
  console.log("\n=== Scraping SAS EuroBonus ===");

  const listUrl = `${SAS_API_BASE_URL}/api/browser-extension/${SAS_CHANNEL}/shops`;
  const response = await fetch(listUrl, {
    signal: AbortSignal.timeout(SAS_LIST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`SAS shop list returned HTTP ${response.status}`);
  }

  const shopMap = (await response.json()) as Record<string, string>;
  const shopEntries = Object.entries(shopMap);
  console.log(`  Found ${shopEntries.length} SAS shop IDs`);

  const merchants: ScrapedMerchant[] = [];
  const batchSize = 20;
  let failedDetails = 0;

  for (let offset = 0; offset < shopEntries.length; offset += batchSize) {
    const batch = shopEntries.slice(offset, offset + batchSize);
    const batchMerchants = await Promise.all(
      batch.map(async ([shopKey, shopId]) => {
        const parsedShopKey = parseShopKey(shopKey);
        if (!parsedShopKey) {
          return null;
        }

        const detailUrl = `${SAS_API_BASE_URL}/api/browser-extension/${SAS_CHANNEL}/shops/${encodeURIComponent(shopId)}`;
        try {
          const detailResponse = await fetch(detailUrl, {
            signal: AbortSignal.timeout(SAS_DETAIL_TIMEOUT_MS),
          });
          if (!detailResponse.ok) {
            throw new Error(`HTTP ${detailResponse.status}`);
          }

          const detailJson = (await detailResponse.json()) as SasShopDetailResponse;
          const detail = detailJson.data;
          if (!detail?.name || !detail.url) {
            return null;
          }

          const points = Number(detail.points) || 0;
          const cashbackDescription =
            detail.commission_type === "fixed"
              ? `${formatSasPoints(points)} poeng som ny kunde`
              : `${formatSasPoints(points)} poeng / 100 kr`;

          return {
            name: detail.name,
            cashbackDescription,
            slug: detail.uuid || shopId,
            storeUrl: `https://${parsedShopKey.hostname}${parsedShopKey.matchPathPrefix || ""}`,
            clickthroughUrl: detail.url,
            ...(parsedShopKey.matchPathPrefix && {
              matchPathPrefix: parsedShopKey.matchPathPrefix,
            }),
          } satisfies ScrapedMerchant;
        } catch (error) {
          failedDetails++;
          console.warn(
            `\n  Warning: SAS shop detail ${shopId} (${shopKey}) failed: ${summarizeError(error)}`
          );
          return null;
        }
      })
    );

    merchants.push(
      ...batchMerchants.filter((merchant): merchant is ScrapedMerchant => merchant !== null)
    );
    process.stdout.write(
      `\r  Loaded ${Math.min(offset + batchSize, shopEntries.length)} / ${shopEntries.length} SAS shop details`
    );
  }

  if (failedDetails > 0) {
    console.log(`\n  Warning: skipped ${failedDetails} failed SAS shop detail requests`);
  }

  console.log(`\n  Extracted ${merchants.length} SAS merchants`);
  return merchants;
}

// ===================
// re:member Scraping
// ===================

const REMEMBER_URL = "https://www.remember.no/reward/rabatt";

interface RememberStore {
  slug: string;
  name: string;
  enabled: boolean;
  maxPercentageValue?: number;
  maxFixedValue?: number;
  commission?: Array<{
    value: number;
    type: "PERCENTAGE" | "NOK";
    description: string;
  }>;
}

interface RememberMerchant extends ScrapedMerchant {
  cashbackDetails?: Array<{
    value: number;
    type: "PERCENTAGE" | "NOK";
    description: string;
  }>;
}

async function scrapeRemember(): Promise<RememberMerchant[]> {
  console.log("\n=== Scraping re:member ===");
  console.log("Fetching re:member stores page...");

  try {
    const response = await fetch(REMEMBER_URL);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();

    // Find the stores JSON in the page - it's in a __NEXT_DATA__ script tag
    const nextDataMatch = html.match(
      /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/
    );
    if (!nextDataMatch) {
      throw new Error("Could not find __NEXT_DATA__ script tag");
    }

    const nextData = JSON.parse(nextDataMatch[1]);
    const stores: RememberStore[] = nextData?.props?.pageProps?.stores;

    if (!stores || !Array.isArray(stores)) {
      throw new Error("Could not find stores array in page data");
    }

    const merchants: RememberMerchant[] = [];

    for (const store of stores) {
      if (!store.enabled || !store.name) continue;

      // Skip "Direct Deals" stores - they offer discounts on specific products only
      if (store.name.toLowerCase().includes("direct deals")) continue;

      const slug = store.slug;
      if (!slug) continue;

      // Build cashback description
      let cashbackDescription = "";
      let cashbackDetails: RememberMerchant["cashbackDetails"] = undefined;

      // Check for multiple commission rates
      if (store.commission && store.commission.length > 1) {
        const percentageRates = store.commission.filter(
          (c) => c.type === "PERCENTAGE"
        );
        if (percentageRates.length > 1) {
          const values = percentageRates.map((c) => c.value);
          const min = Math.min(...values);
          const max = Math.max(...values);
          // Only show range if min != max
          if (min !== max) {
            cashbackDescription = `${min}-${max}%*`;
            cashbackDetails = store.commission.map((c) => ({
              value: c.value,
              type: c.type,
              description: c.description,
            }));
          } else {
            cashbackDescription = `${max}%`;
          }
        }
      }

      // Fallback to simple description
      if (!cashbackDescription) {
        if (store.maxPercentageValue && store.maxPercentageValue > 0) {
          cashbackDescription = `${store.maxPercentageValue}%`;
        } else if (store.maxFixedValue && store.maxFixedValue > 0) {
          cashbackDescription = `${store.maxFixedValue} kr`;
        }
      }

      // Skip stores with no cashback
      if (!cashbackDescription) continue;

      merchants.push({
        name: store.name,
        slug,
        cashbackDescription,
        ...(cashbackDetails && { cashbackDetails }),
      });
    }

    console.log(`  Found ${merchants.length} re:member merchants`);
    return merchants;
  } catch (error) {
    throw new Error(`re:member scrape failed: ${summarizeError(error)}`);
  }
}

// ===================
// DNB Scraping
// ===================

async function scrapeDNB(page: Page): Promise<ScrapedMerchant[]> {
  console.log("\n=== Scraping DNB ===");
  console.log("Loading DNB rebates page...");

  try {
    await page.goto(DNB_URL, { waitUntil: "domcontentloaded", timeout: 60000 });

    // Wait for content to load (DNB uses Gatsby/React)
    await page.waitForTimeout(8000);

    // Scroll to load all lazy content
    console.log("Scrolling to load all content...");
    for (let i = 0; i < 30; i++) {
      await page.evaluate(() => window.scrollBy(0, 500));
      await page.waitForTimeout(200);
    }
    await page.waitForTimeout(3000);

    // Extract merchant data
    console.log("Extracting DNB merchant data...");
    const data = await page.evaluate(() => {
      const results: Array<{
        name: string;
        cashbackDescription: string;
        slug: string;
        code?: string;
        storeUrl?: string;
      }> = [];
      const seen = new Set<string>();

      // Find the universal rebate code (format: "rabattkode: XXXX")
      const bodyText = document.body.textContent || "";
      const codeMatch = bodyText.match(/rabattkode[:\s]+([A-Z0-9]+)/i);
      const universalCode = codeMatch ? codeMatch[1] : undefined;

      // Strategy: Find text nodes containing exact "XX %" pattern (discount badges)
      // Then walk up to find the card container (an anchor with store URL)
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node: Node | null;

      while ((node = walker.nextNode())) {
        const text = node.textContent?.trim();
        // Match exact discount badge pattern like "10 %" or "10%"
        if (!text || !text.match(/^\d+\s*%$/)) continue;

        // Walk up the DOM to find the card container
        let el = node.parentElement;
        let card: HTMLAnchorElement | null = null;

        for (let i = 0; i < 10 && el; i++) {
          // Look for an anchor element that links to an external store
          if (el.tagName === "A") {
            const href = el.getAttribute("href") || "";
            if (href.startsWith("http") && !href.includes("dnb.no")) {
              card = el as HTMLAnchorElement;
              break;
            }
          }
          el = el.parentElement;
        }

        if (!card) continue;

        // Extract store name from heading inside the card
        const heading = card.querySelector("h2, h3, h4");
        const name = heading?.textContent?.trim() || "";
        if (!name || seen.has(name)) continue;
        seen.add(name);

        // Get store URL and clean it up
        const storeUrl = (card.getAttribute("href") || "").trim().replace(/[.\s]+$/, "");

        // Clean up discount text
        const cashbackDescription = text.replace(/\s+/g, "");

        results.push({
          name,
          cashbackDescription,
          slug: "", // DNB doesn't use slugs
          code: universalCode,
          storeUrl,
        });
      }

      return { merchants: results, universalCode };
    });

    if (data.universalCode) {
      console.log(`  Found universal code: ${data.universalCode}`);
    }
    console.log(`  Found ${data.merchants.length} DNB merchants`);
    return data.merchants;
  } catch (error) {
    throw new Error(`DNB scrape failed: ${summarizeError(error)}`);
  }
}

// ===================
// OBOS Scraping
// ===================

// OBOS internal products and promotional content to exclude
const OBOS_EXCLUDED_NAMES = [
  "obos bostart",
  "obos-banken",
  "oslobolig",
  "forkjøpsrett",
  "obos deleie",
  "obos eiendomsmeglere",
  "obos-ligaen",
  "nordlys",
  "barnas holmenkolldag",
];

async function scrapeOBOS(page: Page): Promise<ScrapedMerchant[]> {
  console.log("\n=== Scraping OBOS ===");
  console.log("Loading OBOS benefits page...");

  try {
    // Use ?view=list to get the full alphabetical list (default page only shows ~5 per category)
    await page.goto(OBOS_BENEFITS_URL + "?view=list", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(3000);

    // Scroll to load all lazy content
    console.log("Scrolling to load all benefits...");
    let previousCount = 0;
    let currentCount = 0;
    let stableCount = 0;
    let scrollAttempts = 0;
    const maxScrollAttempts = 100;

    do {
      previousCount = currentCount;
      await page.evaluate(() => window.scrollBy(0, window.innerHeight));
      await page.waitForTimeout(500);

      try {
        await page.waitForLoadState("networkidle", { timeout: 2000 });
      } catch {
        // Timeout is fine
      }

      currentCount = await page.locator('a[href*="/medlem/medlemsfordeler/"]').count();

      if (currentCount === previousCount) {
        stableCount++;
      } else {
        stableCount = 0;
      }

      scrollAttempts++;
      process.stdout.write(
        `\r  Found ${currentCount} benefit links (scroll ${scrollAttempts}, stable: ${stableCount})...`
      );
    } while (stableCount < 5 && scrollAttempts < maxScrollAttempts);

    console.log(`\n  Finished scrolling. Total links: ${currentCount}`);

    // Step 1: Extract benefit cards from list page
    console.log("Extracting benefit data from list page...");
    const benefits = await page.evaluate((excludedNames: string[]) => {
      const results: Array<{
        name: string;
        slug: string;
        cashbackDescription: string;
      }> = [];
      const seen = new Set<string>();

      document.querySelectorAll('a[href*="/medlem/medlemsfordeler/"]').forEach((link) => {
        const href = link.getAttribute("href") || "";
        // Extract slug from URL path
        const slugMatch = href.match(/\/medlem\/medlemsfordeler\/([^/?#]+)/);
        if (!slugMatch) return;

        const slug = decodeURIComponent(slugMatch[1]);
        if (!slug || seen.has(slug)) return;

        // Skip the main overview page
        if (slug === "medlemsfordeler" || slug === "") return;

        seen.add(slug);

        // Get benefit name
        const name =
          link.querySelector("h2, h3, h4, h5")?.textContent?.trim() ||
          link.querySelector("img")?.getAttribute("alt")?.trim() ||
          link.textContent?.trim().split("\n")[0]?.trim() ||
          "";

        if (!name) return;

        // Check exclusion list
        const nameLower = name.toLowerCase();
        if (excludedNames.some((exc) => nameLower.includes(exc))) return;

        // Get cashback description - look for percentage or discount text
        // Use innerText (not textContent) to preserve visual spacing between elements
        const allText = link.innerText || link.textContent || "";
        const discountMatch = allText.match(
          /(?:^|\s)(\d{1,3}(?:[,.]\d+)?\s*%|Opptil\s+\d{1,3}(?:[,.]\d+)?\s*%|\d+\s*kr\s+rabatt)/i
        );
        const cashbackDescription = discountMatch ? discountMatch[0].trim() : "";

        results.push({ name, slug, cashbackDescription });
      });

      return results;
    }, OBOS_EXCLUDED_NAMES);

    // Filter out promotional/tagged content and category pages
    const filtered = benefits.filter((b) => {
      const nameLower = b.name.toLowerCase();
      const slugLower = b.slug.toLowerCase();
      // Skip promotional content
      if (nameLower.includes("kampanje") || nameLower.includes("utsolgt")) return false;
      if (nameLower.includes("snart er obos") || nameLower.includes("reiselivsdager")) return false;
      // Skip category/overview pages
      if (slugLower === "kategori" || slugLower === "aktuelle-fordeler") return false;
      if (nameLower.startsWith("se alle fordeler") || nameLower.startsWith("flere aktuelle")) return false;
      // Skip promotional offers (names starting with discounts, not vendor names)
      if (/^\d+\s*%\s+rabatt/i.test(nameLower)) return false;
      if (/^eksklusiv\s+rabatt/i.test(nameLower)) return false;
      if (/^\d+\s*kr\s+/i.test(nameLower)) return false;
      // Skip calendar/internal features
      if (slugLower === "kalender" || nameLower.includes("planlegg med")) return false;
      return true;
    });

    console.log(`  Found ${filtered.length} OBOS benefits (from ${benefits.length} total)`);

    // Step 2: Visit detail pages to extract vendor URLs
    console.log("Visiting detail pages for vendor URLs...");
    const merchants: ScrapedMerchant[] = [];

    for (let i = 0; i < filtered.length; i++) {
      const benefit = filtered[i];
      process.stdout.write(`\r  Processing ${i + 1}/${filtered.length}: ${benefit.name.slice(0, 40)}...`);

      try {
        await page.goto(`${OBOS_BENEFITS_URL}/${benefit.slug}`, {
          waitUntil: "domcontentloaded",
          timeout: 15000,
        });
        await page.waitForTimeout(1500);

        // Extract CTA URL and description from detail page
        const detailData = await page.evaluate(() => {
          let storeUrl: string | undefined;
          let description = "";

          // Look for external links (CTA buttons, "Gå til" links)
          const links = document.querySelectorAll('a[href^="http"]');
          for (const link of links) {
            const href = link.getAttribute("href") || "";
            const text = link.textContent?.trim().toLowerCase() || "";
            // Skip internal OBOS links and common false positives
            if (href.includes("obos.no")) continue;
            if (href.includes("google.com")) continue;
            if (href.includes("youtube.com")) continue;
            if (href.includes("facebook.com")) continue;
            if (href.includes("instagram.com")) continue;
            if (href.includes("twitter.com")) continue;
            if (href.includes("aka.ms")) continue;
            if (href.includes("apps.apple.com")) continue;
            if (href.includes("play.google.com")) continue;
            if (href.includes("clarity.microsoft.com")) continue;
            if (href.includes("microsoft.com/privacy")) continue;
            // Prefer CTA-like links
            if (
              text.includes("gå til") ||
              text.includes("bestill") ||
              text.includes("kjøp") ||
              text.includes("handle") ||
              text.includes("book") ||
              link.classList.contains("btn") ||
              link.classList.contains("button") ||
              link.closest('[class*="cta"]') ||
              link.closest('[class*="action"]')
            ) {
              storeUrl = href;
              break;
            }
            // Fall back to first external link
            if (!storeUrl) {
              storeUrl = href;
            }
          }

          // Get description from the page
          const descEl = document.querySelector(
            '[class*="description"], [class*="intro"], [class*="lead"], article p'
          );
          if (descEl) {
            description = descEl.textContent?.trim() || "";
          }

          return { storeUrl, description };
        });

        merchants.push({
          name: benefit.name,
          slug: benefit.slug,
          cashbackDescription: benefit.cashbackDescription || "",
          ...(detailData.storeUrl && { storeUrl: detailData.storeUrl }),
        });
      } catch {
        // If detail page fails, still include with data from list page
        merchants.push({
          name: benefit.name,
          slug: benefit.slug,
          cashbackDescription: benefit.cashbackDescription || "",
        });
      }
    }

    console.log(`\n  Extracted ${merchants.length} OBOS merchants`);
    return merchants;
  } catch (error) {
    throw new Error(`OBOS scrape failed: ${summarizeError(error)}`);
  }
}

// ===================
// NAF Scraping
// ===================

/**
 * Check if a hostname belongs to an internal NAF domain.
 */
function isNAFInternalDomain(hostname: string): boolean {
  return NAF_INTERNAL_DOMAINS.some(
    (d) => hostname === d || hostname.endsWith(`.${d}`) || hostname === `www.${d}`
  );
}

async function scrapeNAF(page: Page): Promise<ScrapedMerchant[]> {
  console.log("\n=== Scraping NAF ===");
  console.log("Loading NAF benefits page (rabatter tab)...");

  try {
    await page.goto(NAF_BENEFITS_URL + "?tabView=rabatter&query=", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForTimeout(5000);

    // Click the "Rabatter" tab if not already active
    try {
      const rabattTab = page.locator('button:has-text("Rabatter"), [role="tab"]:has-text("Rabatter"), a:has-text("Rabatter")').first();
      if (await rabattTab.isVisible({ timeout: 3000 })) {
        await rabattTab.click();
        await page.waitForTimeout(3000);
      }
    } catch {
      // Tab might already be active or tab system works differently
    }

    // Scroll to load all content
    console.log("Scrolling to load all benefits...");
    let previousHeight = 0;
    let stableCount = 0;
    let scrollAttempts = 0;
    const maxScrollAttempts = 50;

    do {
      previousHeight = await page.evaluate(() => document.body.scrollHeight);
      await page.evaluate(() => window.scrollBy(0, window.innerHeight));
      await page.waitForTimeout(500);

      try {
        await page.waitForLoadState("networkidle", { timeout: 2000 });
      } catch {
        // Timeout is fine
      }

      const currentHeight = await page.evaluate(() => document.body.scrollHeight);
      if (currentHeight === previousHeight) {
        stableCount++;
      } else {
        stableCount = 0;
      }

      scrollAttempts++;
    } while (stableCount < 5 && scrollAttempts < maxScrollAttempts);

    console.log("  Finished scrolling.");

    // Extract benefit cards from the page
    console.log("Extracting NAF benefit data...");
    const benefits = await page.evaluate((excludedNames: string[]) => {
      const results: Array<{
        name: string;
        slug: string;
        cashbackDescription: string;
        storeUrl?: string;
      }> = [];
      const seen = new Set<string>();

      // Strategy: Find all links to benefit detail pages
      document.querySelectorAll('a[href*="/medlemskap/medlemsfordeler/"]').forEach((link) => {
        const href = link.getAttribute("href") || "";
        const slugMatch = href.match(/\/medlemskap\/medlemsfordeler\/([^/?#]+)/);
        if (!slugMatch) return;

        const slug = decodeURIComponent(slugMatch[1]);
        if (!slug || seen.has(slug)) return;

        // Skip the overview page and tab parameters
        if (slug === "medlemsfordeler" || slug === "") return;

        seen.add(slug);

        // Get benefit name from heading or text
        const name =
          link.querySelector("h2, h3, h4, h5")?.textContent?.trim() ||
          link.querySelector("img")?.getAttribute("alt")?.trim() ||
          link.textContent?.trim().split("\n")[0]?.trim() ||
          "";

        if (!name) return;

        // Check exclusion list
        const nameLower = name.toLowerCase();
        if (excludedNames.some((exc) => nameLower.includes(exc))) return;

        // Get discount description
        const allText = link.innerText || link.textContent || "";
        const discountMatch = allText.match(
          /(?:^|\s)(\d{1,3}(?:[,.]\d+)?\s*%|Opptil\s+\d{1,3}(?:[,.]\d+)?\s*%|\d+\s*(?:kr|kroner)\s*(?:i\s*)?rabatt)/i
        );
        const cashbackDescription = discountMatch ? discountMatch[0].trim() : "";

        results.push({ name, slug, cashbackDescription });
      });

      // Also try finding cards that aren't links to detail pages
      // Some card layouts use divs with nested links
      document.querySelectorAll('[class*="card"], [class*="benefit"], [class*="partner"]').forEach((card) => {
        const heading = card.querySelector("h2, h3, h4, h5");
        const name = heading?.textContent?.trim() || "";
        if (!name) return;

        const nameLower = name.toLowerCase();
        if (excludedNames.some((exc) => nameLower.includes(exc))) return;

        // Generate slug from name
        const slug = nameLower
          .replace(/[æ]/g, "ae").replace(/[ø]/g, "o").replace(/[å]/g, "a")
          .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

        if (seen.has(slug)) return;

        // Check for external link
        const externalLink = card.querySelector('a[href^="http"]');
        let storeUrl: string | undefined;
        if (externalLink) {
          const href = externalLink.getAttribute("href") || "";
          try {
            const hostname = new URL(href).hostname;
            if (!hostname.includes("naf.no")) {
              storeUrl = href;
            }
          } catch {
            // Invalid URL
          }
        }

        // Get discount text
        const allText = card.innerText || card.textContent || "";
        const discountMatch = allText.match(
          /(\d{1,3}(?:[,.]\d+)?\s*%|Opptil\s+\d{1,3}(?:[,.]\d+)?\s*%|\d+\s*(?:kr|kroner)\s*(?:i\s*)?rabatt)/i
        );
        const cashbackDescription = discountMatch ? discountMatch[1].trim() : "";

        seen.add(slug);
        results.push({ name, slug, cashbackDescription, ...(storeUrl && { storeUrl }) });
      });

      return results;
    }, NAF_EXCLUDED_NAMES);

    // Filter out time-limited campaigns and internal NAF products
    const filtered = benefits.filter((b) => {
      const nameLower = b.name.toLowerCase();
      const slugLower = b.slug.toLowerCase();
      // Skip time-limited campaigns
      if (nameLower.includes("kampanje") || nameLower.includes("tidsbegrenset")) return false;
      // Skip category/overview pages
      if (slugLower === "rabatter" || slugLower === "tjenester") return false;
      // Skip promotional content
      if (/^\d+\s*%\s+rabatt/i.test(nameLower)) return false;
      return true;
    });

    console.log(`  Found ${filtered.length} NAF benefits (from ${benefits.length} total)`);

    // Visit detail pages to extract vendor URLs
    console.log("Visiting detail pages for vendor URLs...");
    const merchants: ScrapedMerchant[] = [];

    for (let i = 0; i < filtered.length; i++) {
      const benefit = filtered[i];
      process.stdout.write(`\r  Processing ${i + 1}/${filtered.length}: ${benefit.name.slice(0, 40)}...`);

      // If we already have a storeUrl from the card, use it
      if (benefit.storeUrl) {
        merchants.push({
          name: benefit.name,
          slug: benefit.slug,
          cashbackDescription: benefit.cashbackDescription,
          storeUrl: benefit.storeUrl,
        });
        continue;
      }

      try {
        await page.goto(`${NAF_BENEFITS_URL}/${benefit.slug}`, {
          waitUntil: "domcontentloaded",
          timeout: 15000,
        });
        await page.waitForTimeout(2000);

        // Extract CTA URL and description from detail page
        const detailData = await page.evaluate((internalDomains: string[]) => {
          let storeUrl: string | undefined;
          let cashbackDescription = "";

          // Look for external links (CTA buttons, partner links)
          const links = document.querySelectorAll('a[href^="http"]');
          for (const link of links) {
            const href = link.getAttribute("href") || "";
            const text = link.textContent?.trim().toLowerCase() || "";
            let hostname: string;
            try {
              hostname = new URL(href).hostname;
            } catch {
              continue;
            }

            // Skip internal domains
            const isInternal = internalDomains.some(
              (d) => hostname === d || hostname.endsWith(`.${d}`) || hostname === `www.${d}`
            );
            if (isInternal) continue;

            // Skip social media, app stores, analytics
            if (
              hostname.includes("google.com") ||
              hostname.includes("youtube.com") ||
              hostname.includes("facebook.com") ||
              hostname.includes("instagram.com") ||
              hostname.includes("twitter.com") ||
              hostname.includes("linkedin.com") ||
              hostname.includes("apps.apple.com") ||
              hostname.includes("play.google.com") ||
              hostname.includes("clarity.microsoft.com") ||
              hostname.includes("cloudinary.com") ||
              hostname.includes("varify.io")
            ) continue;

            // Prefer CTA-like links
            if (
              text.includes("gå til") ||
              text.includes("bestill") ||
              text.includes("kjøp") ||
              text.includes("handle") ||
              text.includes("book") ||
              text.includes("les mer") ||
              text.includes("se tilbud") ||
              text.includes("se betingelser") ||
              link.classList.contains("btn") ||
              link.classList.contains("button") ||
              link.closest('[class*="cta"]') ||
              link.closest('[class*="button"]') ||
              link.closest('[class*="action"]')
            ) {
              storeUrl = href;
              break;
            }
            // Fall back to first external link
            if (!storeUrl) {
              storeUrl = href;
            }
          }

          // Get discount description from page content
          const bodyText = document.body.innerText || "";
          const discountPatterns = [
            /(\d{1,3}(?:[,.]\d+)?\s*(?:%|prosent)\s*rabatt)/i,
            /(\d+\s*(?:kr|kroner)\s*(?:i\s*)?rabatt)/i,
          ];
          for (const pattern of discountPatterns) {
            const match = bodyText.match(pattern);
            if (match) {
              cashbackDescription = match[1].trim();
              break;
            }
          }

          return { storeUrl, cashbackDescription };
        }, NAF_INTERNAL_DOMAINS);

        merchants.push({
          name: benefit.name,
          slug: benefit.slug,
          cashbackDescription: benefit.cashbackDescription || detailData.cashbackDescription,
          ...(detailData.storeUrl && { storeUrl: detailData.storeUrl }),
        });
      } catch {
        // If detail page fails, still include with data from list page
        merchants.push({
          name: benefit.name,
          slug: benefit.slug,
          cashbackDescription: benefit.cashbackDescription || "",
        });
      }
    }

    // Filter out merchants whose storeUrl points to internal domains
    const finalMerchants = merchants.filter((m) => {
      if (!m.storeUrl) return true;
      try {
        const hostname = new URL(m.storeUrl).hostname;
        return !isNAFInternalDomain(hostname);
      } catch {
        return true;
      }
    });

    console.log(`\n  Extracted ${finalMerchants.length} NAF merchants`);
    return finalMerchants;
  } catch (error) {
    throw new Error(`NAF scrape failed: ${summarizeError(error)}`);
  }
}

// ===================
// LOfavør Scraping
// ===================

/**
 * Extract partnerMap from LOfavør website HTML.
 * Returns domain → partner name mappings (e.g., "apollo.no" → "Apollo").
 */
async function fetchLOfavorPartnerMap(): Promise<Record<string, string>> {
  try {
    const response = await fetch(`${LOFAVOR_BASE_URL}/ferie-og-opplevelser`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();

    // Extract var partnerMap = { ... }
    const mapMatch = html.match(/var\s+partnerMap\s*=\s*(\{[^}]+\})/);
    if (!mapMatch) {
      console.log("  Could not find partnerMap in page source");
      return {};
    }

    // Parse the JS object (keys/values may use single or double quotes)
    const normalized = mapMatch[1]
      .replace(/'/g, '"')
      .replace(/,\s*}/, "}"); // trailing comma
    return JSON.parse(normalized);
  } catch (error) {
    console.log("  Could not fetch partnerMap:", error);
    return {};
  }
}

/**
 * Check if a hostname belongs to an internal LOfavør/LO domain.
 */
function isLOfavorInternalDomain(hostname: string): boolean {
  return LOFAVOR_INTERNAL_DOMAINS.some(
    (d) => hostname === d || hostname.endsWith(`.${d}`) || hostname === `www.${d}`
  );
}

/**
 * Scrapes LOfavør category and detail pages to collect partner merchants with optional store URLs and discounts.
 *
 * Visits configured LOfavør categories, extracts unique benefit slugs and names, visits detail pages to find external partner links
 * and discount descriptions, and enriches missing store URLs using a fetched partner map.
 *
 * @returns An array of scraped merchants; each entry contains `name`, `slug`, `cashbackDescription`, and optionally `storeUrl`.
 * @throws Error if the overall LOfavør scraping process fails
 */
async function scrapeLOfavor(page: Page): Promise<ScrapedMerchant[]> {
  console.log("\n=== Scraping LOfavør ===");

  try {
    // Step 1: Fetch partnerMap for domain enrichment
    console.log("Fetching partnerMap from website...");
    const partnerMap = await fetchLOfavorPartnerMap();
    const partnerCount = Object.keys(partnerMap).length;
    console.log(`  Found ${partnerCount} partner domain mappings`);

    // Build reverse map: partner name (lowercase) → domain
    const partnerNameToDomain = new Map<string, string>();
    for (const [domain, name] of Object.entries(partnerMap)) {
      if (!isLOfavorInternalDomain(domain)) {
        // Prefer .no domains over others for the same partner
        const existing = partnerNameToDomain.get((name as string).toLowerCase());
        if (!existing || domain.endsWith(".no")) {
          partnerNameToDomain.set((name as string).toLowerCase(), domain);
        }
      }
    }

    // Step 2: Scrape category pages
    console.log("Scraping category pages...");
    const allBenefits: Array<{ name: string; slug: string; categoryPath: string }> = [];

    for (const category of LOFAVOR_SCRAPE_CATEGORIES) {
      const categoryUrl = `${LOFAVOR_BASE_URL}${category}`;
      console.log(`  Loading ${category}...`);

      await page.goto(categoryUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(3000);

      // Scroll to load all content
      for (let i = 0; i < 10; i++) {
        await page.evaluate(() => window.scrollBy(0, 500));
        await page.waitForTimeout(300);
      }

      // Extract product links from both card grids and list sections
      const benefits = await page.evaluate((cat: string) => {
        const results: Array<{ name: string; slug: string; categoryPath: string }> = [];
        const seen = new Set<string>();

        // Strategy 1: a.cat1-link elements (visual cards with h3)
        document.querySelectorAll("a.cat1-link, a[class*='cat1']").forEach((link) => {
          const href = link.getAttribute("href") || "";
          const name = link.querySelector("h3")?.textContent?.trim() ||
            link.querySelector("h4")?.textContent?.trim() || "";
          if (name && href && !seen.has(href)) {
            seen.add(href);
            // Extract the path after the domain
            const pathMatch = href.match(/lofavor\.no(\/[^?#]+)/);
            const path = pathMatch ? pathMatch[1] : href.startsWith("/") ? href : "";
            if (path) {
              results.push({ name, slug: path.replace(/^\//, ""), categoryPath: cat });
            }
          }
        });

        // Strategy 2: .product-list-minors li a (text-only link lists)
        document.querySelectorAll(".product-list-minors li a").forEach((link) => {
          const href = link.getAttribute("href") || "";
          const name = link.textContent?.trim() || "";
          if (name && href && !seen.has(href)) {
            seen.add(href);
            const pathMatch = href.match(/lofavor\.no(\/[^?#]+)/);
            const path = pathMatch ? pathMatch[1] : href.startsWith("/") ? href : "";
            if (path) {
              results.push({ name, slug: path.replace(/^\//, ""), categoryPath: cat });
            }
          }
        });

        // Strategy 3: Generic anchor links matching category patterns
        document.querySelectorAll(`a[href*="${cat}/"], a[href*="${cat.replace("opplevelser", "fritid")}/"]`).forEach((link) => {
          const href = link.getAttribute("href") || "";
          const name = link.querySelector("h3, h4, h5")?.textContent?.trim() ||
            link.textContent?.trim().split("\n")[0]?.trim() || "";
          if (name && href && !seen.has(href) && name.length < 80) {
            seen.add(href);
            const pathMatch = href.match(/lofavor\.no(\/[^?#]+)/);
            const path = pathMatch ? pathMatch[1] : href.startsWith("/") ? href : "";
            if (path) {
              results.push({ name, slug: path.replace(/^\//, ""), categoryPath: cat });
            }
          }
        });

        return results;
      }, category);

      console.log(`  Found ${benefits.length} benefits in ${category}`);
      allBenefits.push(...benefits);
    }

    // Deduplicate by slug
    const uniqueBenefits = new Map<string, (typeof allBenefits)[0]>();
    for (const b of allBenefits) {
      if (!uniqueBenefits.has(b.slug)) {
        uniqueBenefits.set(b.slug, b);
      }
    }

    // Apply name exclusions
    const filtered = [...uniqueBenefits.values()].filter((b) => {
      const nameLower = b.name.toLowerCase();
      return !LOFAVOR_EXCLUDED_NAMES.some((exc) => nameLower.includes(exc));
    });

    console.log(`  ${filtered.length} benefits after dedup and name filtering (from ${allBenefits.length} total)`);

    // Step 3: Visit detail pages to extract store URLs and discount info
    console.log("Visiting detail pages for store URLs...");
    const merchants: ScrapedMerchant[] = [];

    for (let i = 0; i < filtered.length; i++) {
      const benefit = filtered[i];
      process.stdout.write(`\r  Processing ${i + 1}/${filtered.length}: ${benefit.name.slice(0, 40)}...`);

      let storeUrl: string | undefined;
      let cashbackDescription = "";

      try {
        // Try the slug as-is first, then try ferie-og-fritid variant
        let loaded = false;
        const urlVariants = [
          `${LOFAVOR_BASE_URL}/${benefit.slug}`,
        ];
        // Add ferie-og-fritid variant if slug uses ferie-og-opplevelser
        if (benefit.slug.includes("ferie-og-opplevelser")) {
          urlVariants.push(`${LOFAVOR_BASE_URL}/${benefit.slug.replace("ferie-og-opplevelser", "ferie-og-fritid")}`);
        }

        for (const url of urlVariants) {
          try {
            const response = await page.goto(url, {
              waitUntil: "domcontentloaded",
              timeout: 15000,
            });
            if (response && response.status() < 400) {
              loaded = true;
              break;
            }
          } catch {
            continue;
          }
        }

        if (!loaded) {
          // Couldn't load detail page, still include with name-based domain lookup
          merchants.push({
            name: benefit.name,
            slug: benefit.slug,
            cashbackDescription: "",
          });
          continue;
        }

        await page.waitForTimeout(2000);

        // Extract external links and discount info from detail page
        const detailData = await page.evaluate((internalDomains: string[]) => {
          let storeUrl: string | undefined;
          let cashbackDescription = "";

          // Find external links (CTA buttons, partner links)
          const links = document.querySelectorAll('a[href^="http"]');
          for (const link of links) {
            const href = link.getAttribute("href") || "";
            const text = link.textContent?.trim().toLowerCase() || "";
            let hostname: string;
            try {
              hostname = new URL(href).hostname;
            } catch {
              continue;
            }

            // Skip internal domains
            const isInternal = internalDomains.some(
              (d) => hostname === d || hostname.endsWith(`.${d}`) || hostname === `www.${d}`
            );
            if (isInternal) continue;

            // Skip social media, app stores, analytics
            if (
              hostname.includes("google.com") ||
              hostname.includes("youtube.com") ||
              hostname.includes("facebook.com") ||
              hostname.includes("instagram.com") ||
              hostname.includes("twitter.com") ||
              hostname.includes("linkedin.com") ||
              hostname.includes("apps.apple.com") ||
              hostname.includes("play.google.com") ||
              hostname.includes("clarity.microsoft.com") ||
              hostname.includes("piwik.pro") ||
              hostname.includes("weglot.com") ||
              hostname.includes("eloqua.com")
            ) continue;

            // Prefer CTA-like links
            if (
              text.includes("se tilbud") ||
              text.includes("bestill") ||
              text.includes("gå til") ||
              text.includes("kjøp") ||
              text.includes("book") ||
              text.includes("les mer") ||
              link.classList.contains("btn") ||
              link.classList.contains("button") ||
              link.closest('[class*="cta"]') ||
              link.closest('[class*="button"]')
            ) {
              storeUrl = href;
              break;
            }
            // Fall back to first external link
            if (!storeUrl) {
              storeUrl = href;
            }
          }

          // Extract discount description from page content
          const bodyText = document.body.innerText || "";
          // Look for common discount patterns
          const discountPatterns = [
            /(\d{1,3}(?:[,.]\d+)?\s*(?:%|prosent)\s*rabatt)/i,
            /(\d+\s*(?:kr|kroner)\s*(?:i\s*)?rabatt)/i,
            /(rabattkode[:\s]+[A-Z0-9]+)/i,
          ];
          for (const pattern of discountPatterns) {
            const match = bodyText.match(pattern);
            if (match) {
              cashbackDescription = match[1].trim();
              break;
            }
          }

          return { storeUrl, cashbackDescription };
        }, LOFAVOR_INTERNAL_DOMAINS);

        storeUrl = detailData.storeUrl;
        cashbackDescription = detailData.cashbackDescription;
      } catch {
        // Detail page failed, still include benefit
      }

      merchants.push({
        name: benefit.name,
        slug: benefit.slug,
        cashbackDescription,
        ...(storeUrl && { storeUrl }),
      });
    }

    // Step 4: Enrich merchants with partnerMap domain data
    // For merchants without a storeUrl, try matching by name against partnerMap
    for (const merchant of merchants) {
      if (!merchant.storeUrl) {
        const nameLower = merchant.name.toLowerCase();
        const domain = partnerNameToDomain.get(nameLower);
        if (domain) {
          merchant.storeUrl = `https://${domain}`;
        }
      }
    }

    // Filter out merchants whose storeUrl points to internal domains
    const finalMerchants = merchants.filter((m) => {
      if (!m.storeUrl) return true; // keep unmapped for manual mapping later
      try {
        const hostname = new URL(m.storeUrl).hostname;
        return !isLOfavorInternalDomain(hostname);
      } catch {
        return true;
      }
    });

    console.log(`\n  Extracted ${finalMerchants.length} LOfavør merchants`);
    return finalMerchants;
  } catch (error) {
    throw new Error(`LOfavør scrape failed: ${summarizeError(error)}`);
  }
}

// ===================
// Visma LogBuy Scraping
// ===================

interface LogbuyTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface LogbuyAuthConfig {
  username: string;
  password: string;
  accesskey: string;
}

interface LogbuyApiResponse<T> {
  statusCode: number;
  result?: T;
  error?: string | { message?: string; messageDetail?: string };
  error_description?: string;
}

interface LogbuyDeal {
  website: string;
  detailurl: string;
}

interface LogbuyDiscountInfo {
  info?: string | null;
  minPercent?: number | null;
  maxPercent?: number | null;
  minAmount?: number | null;
  maxAmount?: number | null;
  text?: string | null;
  currency?: {
    currencySymbol?: string | null;
    isPrefix?: boolean | null;
  } | null;
}

interface LogbuySpecialOfferInfo {
  info?: string | null;
  discountInfo?: LogbuyDiscountInfo | null;
  dealTitle?: string | null;
}

interface LogbuySearchItem {
  supplierId: number;
  name: string;
  discountInfo?: LogbuyDiscountInfo | null;
  specialOfferInfo?: LogbuySpecialOfferInfo | null;
}

interface LogbuySearchResult {
  searchItems: LogbuySearchItem[];
  totalResults: number;
}

/**
 * Produce a concise, human-readable error message extracted from a LogBuy API response.
 *
 * @param response - The parsed LogBuy API response object
 * @returns The first available error text from `error` (string), `error_description`, `error.messageDetail`, or `error.message`; if none are present, returns `statusCode <n>` using `response.statusCode`
 */
function getLogbuyErrorMessage(response: LogbuyApiResponse<unknown>): string {
  if (typeof response.error === "string") {
    return response.error;
  }
  return (
    response.error_description ||
    response.error?.messageDetail ||
    response.error?.message ||
    `statusCode ${response.statusCode}`
  );
}

/**
 * Retrieves and validates a required environment variable.
 *
 * @param name - The environment variable name to read
 * @returns The trimmed value of the environment variable
 * @throws Error if the variable is missing or empty; the thrown message will be `Missing ${name}; set LogBuy API credentials in environment`
 */
function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name}; set LogBuy API credentials in environment`);
  }
  return value;
}

/**
 * Constructs LogBuy API authentication configuration from required environment variables.
 *
 * @returns An object with `username`, `password`, and `accesskey` populated from `LOGBUY_USERNAME`, `LOGBUY_PASSWORD`, and `LOGBUY_ACCESSKEY` environment variables
 */
function getLogbuyAuthConfig(): LogbuyAuthConfig {
  return {
    username: getRequiredEnv("LOGBUY_USERNAME"),
    password: getRequiredEnv("LOGBUY_PASSWORD"),
    accesskey: getRequiredEnv("LOGBUY_ACCESSKEY"),
  };
}

/**
 * Determine whether a hostname belongs to LogBuy's internal or tracking domains.
 *
 * @param hostname - Hostname to check; may include a leading `www.`.
 * @returns `true` if `hostname` exactly matches or is a subdomain of any configured LogBuy internal domain, `false` otherwise.
 */
function isLogbuyInternalDomain(hostname: string): boolean {
  const normalized = hostname.replace(/^www\./, "");
  return LOGBUY_INTERNAL_DOMAINS.some(
    (domain) => normalized === domain || normalized.endsWith(`.${domain}`)
  );
}

/**
 * Determine whether a hostname belongs to LogBuy's tracking/redirect domains.
 *
 * @param hostname - Hostname to test; a leading `www.` is ignored
 * @returns `true` if the hostname equals or is a subdomain of a known LogBuy tracking domain, `false` otherwise
 */
function isLogbuyTrackingDomain(hostname: string): boolean {
  const normalized = hostname.replace(/^www\./, "");
  return LOGBUY_TRACKING_DOMAINS.some(
    (domain) => normalized === domain || normalized.endsWith(`.${domain}`)
  );
}

/**
 * Return the normalized hostname extracted from a URL string.
 *
 * @param url - The input string to parse as a URL.
 * @returns The hostname normalized via `normalizeHostname`, or `null` if `url` is not a valid URL.
 */
function getLogbuyHostname(url: string): string | null {
  try {
    return normalizeHostname(new URL(url).hostname);
  } catch {
    return null;
  }
}

/**
 * Determines whether a LogBuy-derived URL points to a usable external store domain.
 *
 * @param url - The URL to evaluate
 * @returns `true` if the URL has a resolvable hostname that is not a LogBuy internal domain and not a known tracking domain, `false` otherwise.
 */
function isUsableLogbuyStoreUrl(url: string): boolean {
  const hostname = getLogbuyHostname(url);
  if (!hostname) {
    return false;
  }
  return !isLogbuyInternalDomain(hostname) && !isLogbuyTrackingDomain(hostname);
}

function parseIpv4Octets(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) {
    return null;
  }

  const octets = parts.map((part) => Number.parseInt(part, 10));
  if (
    octets.some(
      (octet, index) =>
        !Number.isInteger(octet) ||
        octet < 0 ||
        octet > 255 ||
        String(octet) !== parts[index]
    )
  ) {
    return null;
  }

  return octets;
}

function isNonPublicIpv4Address(address: string): boolean {
  const octets = parseIpv4Octets(address);
  if (!octets) {
    return true;
  }

  const [a, b, c] = octets;
  if (a === undefined || b === undefined || c === undefined) {
    return true;
  }

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function isNonPublicIpv6Address(address: string): boolean {
  const normalized = address.toLowerCase();
  const ipv4Mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (ipv4Mapped?.[1]) {
    return isNonPublicIpv4Address(ipv4Mapped[1]);
  }

  const firstHextet = Number.parseInt(normalized.split(":")[0] || "0", 16);
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    (firstHextet >= 0xfe80 && firstHextet <= 0xfebf) ||
    normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8:")
  );
}

function isPublicIpAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    return !isNonPublicIpv4Address(address);
  }

  if (family === 6) {
    return !isNonPublicIpv6Address(address);
  }

  return false;
}

function isLocalHostname(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".lan") ||
    normalized.endsWith(".internal") ||
    normalized.endsWith(".home.arpa")
  );
}

async function isPublicFetchTarget(rawUrl: string): Promise<boolean> {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return false;
    }

    const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (isLocalHostname(hostname)) {
      return false;
    }

    if (isIP(hostname)) {
      return isPublicIpAddress(hostname);
    }

    let lookupResult = publicHostLookupCache.get(hostname);
    if (!lookupResult) {
      lookupResult = lookup(hostname, { all: true })
        .then(
          (addresses) =>
            addresses.length > 0 &&
            addresses.every((address) => isPublicIpAddress(address.address))
        )
        .catch(() => false);
      publicHostLookupCache.set(hostname, lookupResult);
    }

    return lookupResult;
  } catch {
    return false;
  }
}

async function isSafeLogbuyStoreUrl(url: string): Promise<boolean> {
  return isUsableLogbuyStoreUrl(url) && (await isPublicFetchTarget(url));
}

/**
 * Extracts all HTTP(S) URLs from the input string.
 *
 * @param value - The text to scan for URLs
 * @returns An array of trimmed `http`/`https` URLs found in `value`, preserving commas inside URLs, or an empty array if none are present
 */
function extractLogbuyUrls(value: string): string[] {
  return value
    .split(/\s+|,(?=\s*https?:\/\/)/)
    .map((url) => url.trim())
    .filter((url) => /^https?:\/\//.test(url));
}

/**
 * Extracts the LogBuy supplier ID from a detail URL's `SupplierInfoId` query parameter.
 *
 * @param detailUrl - A URL string expected to contain a `SupplierInfoId` query parameter
 * @returns The parsed supplier ID as a number, or `null` if the parameter is missing, not an integer, or the URL is invalid
 */
function extractLogbuySupplierId(detailUrl: string): number | null {
  try {
    const rawId = new URL(detailUrl).searchParams.get("SupplierInfoId");
    if (!rawId) {
      return null;
    }
    const id = Number.parseInt(rawId, 10);
    return Number.isNaN(id) ? null : id;
  } catch {
    return null;
  }
}

/**
 * Produce a best-effort decoded URL by unescaping common HTML/JSON-escaped sequences and applying URI decoding.
 *
 * @param value - The input string containing an escaped or encoded URL fragment
 * @returns The decoded URL string with common escape sequences (e.g., `\/`, `\u0026`, `&amp;`) replaced and percent-encoded parts decoded when possible
 */
function decodeLogbuyUrl(value: string): string {
  let decoded = value
    .replace(/\\\//g, "/")
    .replace(/\\u0026/g, "&")
    .replace(/&amp;/g, "&");

  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // Keep the best-effort decoded value.
  }

  return decoded;
}

/**
 * Extracts a nested target HTTP(S) URL from query parameters commonly used in redirect links.
 *
 * Searches the provided URL's query string for known redirect parameter names (for example `ued`, `url`, `u`, `redirect`, `redirectUrl`, `returnUrl`) and returns the decoded target URL if one is found and begins with `http`. If the input is not a valid URL or no usable redirect parameter is present, returns `null`.
 *
 * @param rawUrl - The raw URL string that may contain a redirect/target URL as a query parameter.
 * @returns The decoded nested target URL if found, `null` otherwise.
 */
function extractNestedTargetUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    for (const key of ["ued", "url", "u", "redirect", "redirectUrl", "returnUrl"]) {
      const value = url.searchParams.get(key);
      if (value?.startsWith("http")) {
        return decodeLogbuyUrl(value);
      }
    }
  } catch {
    // Invalid URL.
  }

  return null;
}

/**
 * Extracts the first external redirect or CTA URL from a chunk of HTML.
 *
 * Scans for common redirect patterns (meta refresh, inline JS assignments/calls) and for CTA-like anchor elements, decodes any LogBuy-encoded targets, and returns the first absolute HTTP(S) URL found.
 *
 * @param html - The raw HTML to scan for redirect targets.
 * @returns The decoded absolute redirect/CTA URL if found, `null` otherwise.
 */
function extractRedirectUrlFromHtml(html: string): string | null {
  const patterns = [
    /http-equiv=["']refresh["'][^>]*content=["'][^"']*url=([^"']+)/i,
    /redirectUrl\s*=\s*["']([^"']+)["']/i,
    /location\.replace\(["']([^"']+)["']\)/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      const decoded = decodeLogbuyUrl(match[1]);
      if (decoded.startsWith("http")) {
        return decoded;
      }
    }
  }

  const ctaAnchorPattern = /<a\b[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const ctaTextPattern =
    /\b(continue|go to store|visit store|shop now|fortsett|gå til|ga til|gå videre|ga videre|besøk|besok|til butikk)\b/i;
  for (const match of html.matchAll(ctaAnchorPattern)) {
    const anchorText = match[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!ctaTextPattern.test(anchorText)) {
      continue;
    }

    const decoded = decodeLogbuyUrl(match[1]);
    if (decoded.startsWith("http")) {
      return decoded;
    }
  }

  return null;
}

/**
 * Format a numeric amount with the LogBuy currency symbol and placement rules.
 *
 * @param value - The numeric amount to format (whole units).
 * @param discount - LogBuy discount metadata; its `currency.currencySymbol` is used if present and `currency.isPrefix` controls whether the symbol appears before or after the value.
 * @returns The formatted amount with a currency symbol (falls back to `kr` when no symbol is provided), e.g. `kr100` or `100 kr`.
 */
function formatLogbuyAmount(value: number, discount: LogbuyDiscountInfo): string {
  const currency = discount.currency?.currencySymbol || "kr";
  return discount.currency?.isPrefix ? `${currency}${value}` : `${value} ${currency}`;
}

/**
 * Formats a LogBuy discount object into a human-readable cashback description.
 *
 * Prefers explicit `info` or `text` fields when present; otherwise formats
 * percentage values as `10%` or ranges as `10 - 20%`, and monetary amounts
 * using `formatLogbuyAmount` (single value or range). Returns an empty string
 * when no usable discount data is available.
 *
 * @param discount - The LogBuy discount information object, or `null`/`undefined`
 * @returns A formatted discount string (e.g., `10%`, `10 - 20%`, `kr 50`, `kr 50 - kr 100`), or an empty string if none
 */
function formatLogbuyDiscountInfo(discount: LogbuyDiscountInfo | null | undefined): string {
  if (!discount) {
    return "";
  }

  const info = discount.info?.trim() || discount.text?.trim();
  if (info) {
    return info;
  }

  if (typeof discount.minPercent === "number" && typeof discount.maxPercent === "number") {
    if (discount.minPercent === discount.maxPercent) {
      return `${discount.maxPercent}%`;
    }
    return `${discount.minPercent} - ${discount.maxPercent}%`;
  }

  if (typeof discount.maxPercent === "number") {
    return `${discount.maxPercent}%`;
  }

  if (typeof discount.minAmount === "number" && typeof discount.maxAmount === "number") {
    if (discount.minAmount === discount.maxAmount) {
      return formatLogbuyAmount(discount.maxAmount, discount);
    }
    return `${formatLogbuyAmount(discount.minAmount, discount)} - ${formatLogbuyAmount(discount.maxAmount, discount)}`;
  }

  if (typeof discount.maxAmount === "number") {
    return formatLogbuyAmount(discount.maxAmount, discount);
  }

  return "";
}

/**
 * Selects a user-facing cashback description for a LogBuy supplier.
 *
 * @param supplier - LogBuy supplier record; fields read: `specialOfferInfo.discountInfo`, `specialOfferInfo.dealTitle`, `specialOfferInfo.info`, and `discountInfo`
 * @returns The description string chosen in preference order: formatted `specialOfferInfo.discountInfo`, trimmed `specialOfferInfo.dealTitle`, trimmed `specialOfferInfo.info`, formatted `discountInfo`, or the configured fallback description
 */
function getLogbuyCashbackDescription(supplier: LogbuySearchItem): string {
  return (
    formatLogbuyDiscountInfo(supplier.specialOfferInfo?.discountInfo) ||
    supplier.specialOfferInfo?.dealTitle?.trim() ||
    supplier.specialOfferInfo?.info?.trim() ||
    formatLogbuyDiscountInfo(supplier.discountInfo) ||
    LOGBUY_FALLBACK_DESCRIPTION
  );
}

/**
 * Parse an HTTP Response as JSON after validating its status and provide a concise body preview on error.
 *
 * @param response - The fetch `Response` to validate and parse
 * @returns The parsed JSON body as type `T`
 * @throws Error - If `response.ok` is false or the body is not valid JSON; the error message includes the HTTP status and a truncated (up to 500 chars) preview of the response body
 */
async function readLogbuyJsonResponse<T>(response: Response): Promise<T> {
  const body = await response.text();
  const bodySummary = body.slice(0, 500) || response.statusText;

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${bodySummary}`);
  }

  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error(`HTTP ${response.status}: invalid JSON response: ${bodySummary}`);
  }
}

/**
 * Fetches a URL using the global fetch while aborting the request after the configured LogBuy API timeout.
 *
 * @param url - The request URL to fetch
 * @param init - Optional fetch init options (headers, method, body, etc.)
 * @returns The fetch `Response` object from the request
 * @throws Error - If the request is aborted due to exceeding `LOGBUY_API_TIMEOUT_MS`, an `Error` is thrown with a message containing the timeout and URL; other errors from `fetch` are rethrown.
 */
async function fetchLogbuyWithTimeout(
  url: string,
  init: RequestInit = {}
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), LOGBUY_API_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`LogBuy request timed out after ${LOGBUY_API_TIMEOUT_MS}ms: ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Obtain an OAuth access token from the LogBuy API using configured credentials.
 *
 * @returns The LogBuy API access token string.
 * @throws `Error` if the response does not include an access token (the API error message or "Missing access token").
 */
async function fetchLogbuyAccessToken(): Promise<string> {
  const auth = getLogbuyAuthConfig();
  const body = new URLSearchParams();
  body.append("username", auth.username);
  body.append("password", auth.password);
  body.append("accesskey", auth.accesskey);
  body.append("grant_type", "userpassword");

  const response = await fetchLogbuyWithTimeout(`${LOGBUY_API_BASE_URL}/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body,
  });
  const data = await readLogbuyJsonResponse<LogbuyTokenResponse>(response);

  if (!data.access_token) {
    throw new Error(data.error_description || data.error || "Missing access token");
  }

  return data.access_token;
}

/**
 * Call a LogBuy REST API path and return the typed `result` payload from its JSON response.
 *
 * @param token - Bearer access token used for the Authorization header
 * @param path - API path relative to the LogBuy base URL (appended to `LOGBUY_API_BASE_URL`)
 * @param init - Optional fetch init overrides; if `body` is provided, `Content-Type: application/json` is set
 * @returns The `result` field from the LogBuy API response, typed as `T`
 * @throws Error if the API response has a non-200 status code or the `result` field is missing/null
 */
async function fetchLogbuyApi<T>(
  token: string,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const response = await fetchLogbuyWithTimeout(`${LOGBUY_API_BASE_URL}/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const data = await readLogbuyJsonResponse<LogbuyApiResponse<T>>(response);

  if (data.statusCode !== 200 || data.result == null) {
    throw new Error(getLogbuyErrorMessage(data));
  }

  return data.result;
}

/**
 * Fetches active LogBuy deals using the provided API token.
 *
 * @param token - Access token used to authenticate requests to the LogBuy API
 * @returns The array of active `LogbuyDeal` objects returned by the LogBuy API
 */
async function fetchLogbuyDeals(token: string): Promise<LogbuyDeal[]> {
  const result = await fetchLogbuyApi<{ deals: LogbuyDeal[] }>(
    token,
    "api/browserExtension/activeDeals"
  );
  return result.deals;
}

/**
 * Fetches all supplier search items from the LogBuy suppliers search API by requesting pages until the full result set is retrieved.
 *
 * @param token - Authentication token used for LogBuy API requests
 * @returns An array of `LogbuySearchItem` objects representing the suppliers returned by the search API
 * @throws Error if pagination exceeds `LOGBUY_MAX_SEARCH_PAGES` without reaching the API-reported total
 */
async function fetchLogbuySuppliers(token: string): Promise<LogbuySearchItem[]> {
  const items: LogbuySearchItem[] = [];
  let pageNumber = 0;

  while (pageNumber < LOGBUY_MAX_SEARCH_PAGES) {
    const result = await fetchLogbuyApi<LogbuySearchResult>(
      token,
      "api/suppliers/search",
      {
        method: "POST",
        body: JSON.stringify({
          searchString: "",
          pageNumber,
          pageSize: LOGBUY_SEARCH_PAGE_SIZE,
          sortDirection: 0,
          calculateFacets: false,
          facetsShouldOccur: false,
          onContentSet: true,
        }),
      }
    );

    items.push(...result.searchItems);
    if (result.searchItems.length === 0 || items.length >= result.totalResults) {
      return items;
    }
    pageNumber++;
  }

  throw new Error(
    `LogBuy supplier pagination exceeded ${LOGBUY_MAX_SEARCH_PAGES} pages without reaching totalResults`
  );
}

/**
 * Load optional LogBuy supplierId→domain mappings from data/logbuy-domains.json.
 *
 * If the file exists and contains valid JSON, returns the parsed mapping; otherwise logs a brief note and returns an empty object.
 *
 * @returns A record mapping supplierId strings to domain strings, or an empty object if the file is missing or invalid.
 */
async function loadLogbuyDomainMappings(): Promise<Record<string, string>> {
  try {
    const mappingContent = await readFile(
      join(import.meta.dir, "..", "data", "logbuy-domains.json"),
      "utf-8"
    );
    return JSON.parse(mappingContent);
  } catch {
    console.log("  Note: Could not load data/logbuy-domains.json");
    return {};
  }
}

/**
 * Resolve a LogBuy deal or tracking URL to a final usable merchant storefront URL.
 *
 * Attempts to extract a nested target URL or validate the input as a direct usable store URL. If the URL appears to be a LogBuy tracking/redirect link, the function follows redirects manually and validates each hop before fetching it, then inspects returned HTML for embedded redirect targets.
 *
 * @param rawUrl - Candidate LogBuy URL which may be a direct store link, a tracking/redirect URL, or contain nested redirect parameters
 * @returns The resolved merchant storefront URL if a usable target could be determined, `null` otherwise
 */
async function resolveLogbuyStoreUrl(rawUrl: string): Promise<string | null> {
  const nestedTarget = extractNestedTargetUrl(rawUrl);
  if (nestedTarget && (await isSafeLogbuyStoreUrl(nestedTarget))) {
    return nestedTarget;
  }

  const hostname = getLogbuyHostname(rawUrl);
  if (!hostname) {
    return null;
  }

  if (!isLogbuyTrackingDomain(hostname)) {
    return (await isSafeLogbuyStoreUrl(rawUrl)) ? rawUrl : null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LOGBUY_REDIRECT_TIMEOUT_MS);

  try {
    let currentUrl = rawUrl;
    for (let redirectCount = 0; redirectCount <= LOGBUY_MAX_REDIRECTS; redirectCount++) {
      if (!(await isPublicFetchTarget(currentUrl))) {
        return null;
      }

      const response = await fetch(currentUrl, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": LOGBUY_REDIRECT_USER_AGENT,
        },
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) {
          return null;
        }

        const nextUrl = new URL(location, currentUrl).toString();
        if (await isSafeLogbuyStoreUrl(nextUrl)) {
          return nextUrl;
        }

        currentUrl = nextUrl;
        continue;
      }

      const html = await response.text();
      const htmlRedirectUrl = extractRedirectUrlFromHtml(html);
      if (htmlRedirectUrl && (await isSafeLogbuyStoreUrl(htmlRedirectUrl))) {
        return htmlRedirectUrl;
      }

      return null;
    }
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }

  return null;
}

/**
 * Produce a deduplicated list of resolved store URLs derived from a LogBuy website field.
 *
 * @param website - Raw `website` value from a LogBuy deal (may contain encoded or redirecting URLs)
 * @returns An array of resolved, deduplicated store URLs (one per distinct hostname) in first-seen order; empty if none could be resolved
 */
async function collectLogbuyStoreUrls(website: string): Promise<string[]> {
  const urls = extractLogbuyUrls(website);
  const results: string[] = [];
  const seenHosts = new Set<string>();
  const resolvedUrls = await Promise.all(urls.map((url) => resolveLogbuyStoreUrl(url)));

  for (const resolvedUrl of resolvedUrls) {
    if (!resolvedUrl) {
      continue;
    }

    const hostname = getLogbuyHostname(resolvedUrl);
    if (!hostname || seenHosts.has(hostname)) {
      continue;
    }

    seenHosts.add(hostname);
    results.push(resolvedUrl);
  }

  return results;
}

/**
 * Scrapes active Visma LogBuy deals, resolves supplier domains, and produces merchant entries.
 *
 * Deduplicates results so each combination of LogBuy supplier ID and resolved store hostname appears once.
 *
 * @returns An array of scraped merchant objects; each entry contains `name`, `slug` (LogBuy supplier ID as a string), `cashbackDescription`, and `storeUrl` for a resolved store.
 * @throws An Error with a summarized failure reason if authentication, data fetching, or URL resolution fails.
 */
async function scrapeLogbuy(): Promise<ScrapedMerchant[]> {
  console.log("\n=== Scraping Visma LogBuy ===");
  console.log("Authenticating with browser-extension fallback account...");

  try {
    const token = await fetchLogbuyAccessToken();
    const manualDomainMappings = await loadLogbuyDomainMappings();
    const [deals, suppliers] = await Promise.all([
      fetchLogbuyDeals(token),
      fetchLogbuySuppliers(token),
    ]);

    const suppliersById = new Map<number, LogbuySearchItem>();
    for (const supplier of suppliers) {
      suppliersById.set(supplier.supplierId, supplier);
    }

    console.log(`  Found ${deals.length} active deal URLs`);
    console.log(`  Found ${suppliers.length} searchable suppliers`);
    console.log("Resolving store hostnames...");

    let processed = 0;
    const dealResults = await mapWithConcurrency(deals, LOGBUY_DEAL_CONCURRENCY, async (deal) => {
      const supplierId = extractLogbuySupplierId(deal.detailurl);
      const supplier = supplierId !== null ? suppliersById.get(supplierId) : undefined;
      if (!supplier) {
        processed++;
        process.stdout.write(`\r  Processing ${processed}/${deals.length}...`);
        return { merchants: [], skipped: 1 };
      }

      const manualDomain = supplierId !== null ? manualDomainMappings[String(supplierId)] : undefined;
      const storeUrls = manualDomain
        ? [`https://${manualDomain}`]
        : await collectLogbuyStoreUrls(deal.website);
      if (storeUrls.length === 0) {
        processed++;
        process.stdout.write(`\r  Processing ${processed}/${deals.length}...`);
        return { merchants: [], skipped: 1 };
      }

      const dealMerchants: ScrapedMerchant[] = [];
      const supplierName = supplier.name.trim() || `LogBuy supplier ${supplier.supplierId}`;
      let skippedUrls = 0;
      for (const storeUrl of storeUrls) {
        const hostname = getLogbuyHostname(storeUrl);
        if (!hostname) {
          skippedUrls++;
          continue;
        }

        dealMerchants.push({
          name: supplierName,
          slug: String(supplier.supplierId),
          cashbackDescription: getLogbuyCashbackDescription(supplier),
          storeUrl,
        });
      }

      processed++;
      process.stdout.write(`\r  Processing ${processed}/${deals.length}...`);
      return { merchants: dealMerchants, skipped: skippedUrls };
    });

    const merchants: ScrapedMerchant[] = [];
    const seenSupplierHosts = new Set<string>();
    let skipped = 0;
    for (const result of dealResults) {
      skipped += result.skipped;
      for (const merchant of result.merchants) {
        const hostname = merchant.storeUrl ? getLogbuyHostname(merchant.storeUrl) : null;
        if (!hostname) {
          skipped++;
          continue;
        }

        const key = `${merchant.slug}:${hostname}`;
        if (seenSupplierHosts.has(key)) {
          continue;
        }
        seenSupplierHosts.add(key);
        merchants.push(merchant);
      }
    }

    console.log(`\n  Extracted ${merchants.length} LogBuy merchant host mappings`);
    if (skipped > 0) {
      console.log(`  Skipped ${skipped} LogBuy deals without usable supplier/domain data`);
    }
    return merchants;
  } catch (error) {
    throw new Error(`LogBuy scrape failed: ${summarizeError(error)}`);
  }
}

// ===================
// Main Logic
/**
 * Orchestrates the full scraping pipeline to produce an updated data/sitelist.json.
 *
 * Runs configured service scrapers (optionally limited with `--service <id>`), aggregates and normalizes merchant offers by hostname, updates feed health and optional scraper cache, and writes the unified sitelist and summary to disk.
 *
 * Behavior notes:
 * - Supports a single-service mode via `--service <id>` which skips cache updates and restores skipped services from the existing sitelist.
 * - Reads existing data/services.json and data/sitelist.json, maintains per-service feed health, and may write `.scraper-cache.json`, `.feed-health.json`, and `data/sitelist.json`.
 * - Launches a headless browser when required by browser-based scrapers and performs network/API scrapes for others.
 * - Logs progress, unmapped merchants, and alerts for prolonged service failures; exits the process on fatal initialization errors (e.g., missing sitelist.json).
 */

async function main() {
  // Parse --service <id> argument for single-service scraping
  const serviceArg = process.argv.find((_, i) => process.argv[i - 1] === "--service");
  const onlyService = serviceArg && MONITORED_SERVICE_IDS.includes(serviceArg as ServiceId)
    ? (serviceArg as ServiceId)
    : null;

  if (serviceArg && !onlyService) {
    console.error(`Unknown service: ${serviceArg}`);
    console.error(`Available services: ${MONITORED_SERVICE_IDS.join(", ")}`);
    process.exit(1);
  }

  if (onlyService) {
    console.log(`Starting single-service scraper for: ${onlyService}\n`);
  } else {
    console.log("Starting multi-service merchant scraper...\n");
  }

  const shouldScrape = (id: ServiceId) => !onlyService || onlyService === id;

  // Read existing sitelist.json
  const sitelistPath = join(import.meta.dir, "..", "data", "sitelist.json");
  let existingSitelist: SiteList;

  try {
    const content = await readFile(sitelistPath, "utf-8");
    existingSitelist = JSON.parse(content);
  } catch (error) {
    console.error("Failed to read sitelist.json:", error);
    process.exit(1);
  }

  const existingServiceOfferCounts = countOffersByService(existingSitelist);
  const feedHealth = await loadFeedHealth(existingServiceOfferCounts);
  const today = formatOsloDate(new Date());

  // Check cache first (skip when running single-service mode)
  const cache = onlyService ? null : await loadCache();
  let trumfMerchants: ScrapedMerchant[];
  let sasMerchants: ScrapedMerchant[];
  let rememberMerchants: ScrapedMerchant[];
  let dnbMerchants: ScrapedMerchant[];
  let obosMerchants: ScrapedMerchant[];
  let nafMerchants: ScrapedMerchant[];
  let lofavorMerchants: ScrapedMerchant[];
  let logbuyMerchants: ScrapedMerchant[];
  let urlNameToHostname: Map<string, string>;
  let trumfResult: ServiceRunResult;
  let sasResult: ServiceRunResult;
  let rememberResult: ServiceRunResult;
  let dnbResult: ServiceRunResult;
  let obosResult: ServiceRunResult;
  let nafResult: ServiceRunResult;
  let lofavorResult: ServiceRunResult;
  let logbuyResult: ServiceRunResult;

  if (cache) {
    const ageHours = Math.round((Date.now() - cache.timestamp) / (60 * 60 * 1000));
    console.log(`Using cached scraper data (${ageHours}h old)\n`);
    trumfMerchants = cache.trumfMerchants;
    sasMerchants = cache.sasMerchants || [];
    rememberMerchants = cache.rememberMerchants;
    dnbMerchants = cache.dnbMerchants;
    obosMerchants = cache.obosMerchants || [];
    nafMerchants = cache.nafMerchants || [];
    lofavorMerchants = cache.lofavorMerchants || [];
    logbuyMerchants = cache.logbuyMerchants || [];
    urlNameToHostname = new Map(Object.entries(cache.urlNameToHostname));
    console.log(`  Trumf: ${trumfMerchants.length} merchants`);
    console.log(`  SAS EuroBonus: ${sasMerchants.length} merchants`);
    console.log(`  re:member: ${rememberMerchants.length} merchants`);
    console.log(`  DNB: ${dnbMerchants.length} merchants`);
    console.log(`  OBOS: ${obosMerchants.length} merchants`);
    console.log(`  NAF: ${nafMerchants.length} merchants`);
    console.log(`  LOfavør: ${lofavorMerchants.length} merchants`);
    console.log(`  LogBuy: ${logbuyMerchants.length} merchants`);

    trumfResult = {
      serviceId: "trumf",
      serviceName: "Trumf",
      merchants: trumfMerchants,
      success: true,
      failureReason: null,
      baselineCount: feedHealth.services.trumf.lastSuccessfulCount,
      currentCount: trumfMerchants.length,
      consecutiveFailureDays: 0,
    };
    sasResult = {
      serviceId: "sas",
      serviceName: "SAS EuroBonus",
      merchants: sasMerchants,
      success: true,
      failureReason: null,
      baselineCount: feedHealth.services.sas.lastSuccessfulCount,
      currentCount: sasMerchants.length,
      consecutiveFailureDays: 0,
    };
    rememberResult = {
      serviceId: "remember",
      serviceName: "re:member",
      merchants: rememberMerchants,
      success: true,
      failureReason: null,
      baselineCount: feedHealth.services.remember.lastSuccessfulCount,
      currentCount: rememberMerchants.length,
      consecutiveFailureDays: 0,
    };
    dnbResult = {
      serviceId: "dnb",
      serviceName: "DNB",
      merchants: dnbMerchants,
      success: true,
      failureReason: null,
      baselineCount: feedHealth.services.dnb.lastSuccessfulCount,
      currentCount: dnbMerchants.length,
      consecutiveFailureDays: 0,
    };
    obosResult = {
      serviceId: "obos",
      serviceName: "OBOS",
      merchants: obosMerchants,
      success: true,
      failureReason: null,
      baselineCount: feedHealth.services.obos.lastSuccessfulCount,
      currentCount: obosMerchants.length,
      consecutiveFailureDays: 0,
    };
    nafResult = {
      serviceId: "naf",
      serviceName: "NAF",
      merchants: nafMerchants,
      success: true,
      failureReason: null,
      baselineCount: feedHealth.services.naf.lastSuccessfulCount,
      currentCount: nafMerchants.length,
      consecutiveFailureDays: 0,
    };
    lofavorResult = {
      serviceId: "lofavor",
      serviceName: "LOfavør",
      merchants: lofavorMerchants,
      success: true,
      failureReason: null,
      baselineCount: feedHealth.services.lofavor.lastSuccessfulCount,
      currentCount: lofavorMerchants.length,
      consecutiveFailureDays: 0,
    };
    logbuyResult = {
      serviceId: "logbuy",
      serviceName: "Visma LogBuy",
      merchants: logbuyMerchants,
      success: true,
      failureReason: null,
      baselineCount: feedHealth.services.logbuy.lastSuccessfulCount,
      currentCount: logbuyMerchants.length,
      consecutiveFailureDays: 0,
    };

    // Don't update feed health from cache — only real scrapes should affect failure tracking
  } else {
    // Launch browser for scraping (only if needed)
    const needsBrowser = shouldScrape("trumf") || shouldScrape("dnb") || shouldScrape("obos") || shouldScrape("naf") || shouldScrape("lofavor");
    let browser: Browser | null = null;
    let page: Page | null = null;

    if (needsBrowser) {
      console.log("Launching browser...");
      browser = await chromium.launch({ headless: true });
      page = await browser.newPage();
    }

    // Helper to create a skip result that reuses existing data
    function skipResult(serviceId: ServiceId, serviceName: string): ServiceRunResult {
      return {
        serviceId,
        serviceName,
        merchants: [],
        success: true,
        failureReason: null,
        baselineCount: feedHealth.services[serviceId].lastSuccessfulCount,
        currentCount: 0,
        consecutiveFailureDays: 0,
      };
    }

    try {
      // ===================
      // Step 1: Fetch Trumf CDN feed for hostname mappings
      // ===================
      urlNameToHostname = new Map<string, string>();
      if (shouldScrape("trumf")) {
        console.log("Fetching Trumf CDN feed for hostname mappings...");
        try {
          const result = await fetchTrumfCDNFeed();
          urlNameToHostname = result.urlNameToHostname;
          console.log(
            `  Found ${urlNameToHostname.size} hostname mappings in CDN feed\n`
          );
        } catch (error) {
          console.error("  Failed to fetch CDN feed, continuing without it\n");
        }
      }

      // ===================
      // Step 2: Scrape Trumf merchants
      // ===================
      if (shouldScrape("trumf")) {
        trumfResult = await runServiceScrape({
          serviceId: "trumf",
          serviceName: "Trumf",
          baselineCount: feedHealth.services.trumf.lastSuccessfulCount,
          today,
          feedHealth,
          scrape: () => scrapeTrumf(page!),
        });
        trumfMerchants = trumfResult.merchants;
      } else {
        trumfResult = skipResult("trumf", "Trumf");
        trumfMerchants = [];
      }

      // ===================
      // Step 3: Scrape SAS EuroBonus merchants (no browser needed)
      // ===================
      if (shouldScrape("sas")) {
        sasResult = await runServiceScrape({
          serviceId: "sas",
          serviceName: "SAS EuroBonus",
          baselineCount: feedHealth.services.sas.lastSuccessfulCount,
          today,
          feedHealth,
          scrape: () => scrapeSAS(),
        });
        sasMerchants = sasResult.merchants;
      } else {
        sasResult = skipResult("sas", "SAS EuroBonus");
        sasMerchants = [];
      }

      // ===================
      // Step 4: Scrape re:member merchants (no browser needed)
      // ===================
      if (shouldScrape("remember")) {
        rememberResult = await runServiceScrape({
          serviceId: "remember",
          serviceName: "re:member",
          baselineCount: feedHealth.services.remember.lastSuccessfulCount,
          today,
          feedHealth,
          scrape: () => scrapeRemember(),
        });
        rememberMerchants = rememberResult.merchants;
      } else {
        rememberResult = skipResult("remember", "re:member");
        rememberMerchants = [];
      }

      // ===================
      // Step 5: Scrape DNB merchants
      // ===================
      if (shouldScrape("dnb")) {
        dnbResult = await runServiceScrape({
          serviceId: "dnb",
          serviceName: "DNB",
          baselineCount: feedHealth.services.dnb.lastSuccessfulCount,
          today,
          feedHealth,
          scrape: () => scrapeDNB(page!),
        });
        dnbMerchants = dnbResult.merchants;
      } else {
        dnbResult = skipResult("dnb", "DNB");
        dnbMerchants = [];
      }

      // ===================
      // Step 6: Scrape OBOS merchants
      // ===================
      if (shouldScrape("obos")) {
        obosResult = await runServiceScrape({
          serviceId: "obos",
          serviceName: "OBOS",
          baselineCount: feedHealth.services.obos.lastSuccessfulCount,
          today,
          feedHealth,
          scrape: () => scrapeOBOS(page!),
        });
        obosMerchants = obosResult.merchants;
      } else {
        obosResult = skipResult("obos", "OBOS");
        obosMerchants = [];
      }

      // ===================
      // Step 7: Scrape NAF merchants
      // ===================
      if (shouldScrape("naf")) {
        nafResult = await runServiceScrape({
          serviceId: "naf",
          serviceName: "NAF",
          baselineCount: feedHealth.services.naf.lastSuccessfulCount,
          today,
          feedHealth,
          scrape: () => scrapeNAF(page!),
        });
        nafMerchants = nafResult.merchants;
      } else {
        nafResult = skipResult("naf", "NAF");
        nafMerchants = [];
      }

      // ===================
      // Step 8: Scrape LOfavør merchants
      // ===================
      if (shouldScrape("lofavor")) {
        lofavorResult = await runServiceScrape({
          serviceId: "lofavor",
          serviceName: "LOfavør",
          baselineCount: feedHealth.services.lofavor.lastSuccessfulCount,
          today,
          feedHealth,
          scrape: () => scrapeLOfavor(page!),
        });
        lofavorMerchants = lofavorResult.merchants;
      } else {
        lofavorResult = skipResult("lofavor", "LOfavør");
        lofavorMerchants = [];
      }

      // ===================
      // Step 8: Scrape Visma LogBuy merchants (no browser needed)
      // ===================
      if (shouldScrape("logbuy")) {
        logbuyResult = await runServiceScrape({
          serviceId: "logbuy",
          serviceName: "Visma LogBuy",
          baselineCount: feedHealth.services.logbuy.lastSuccessfulCount,
          today,
          feedHealth,
          scrape: () => scrapeLogbuy(),
        });
        logbuyMerchants = logbuyResult.merchants;
      } else {
        logbuyResult = skipResult("logbuy", "Visma LogBuy");
        logbuyMerchants = [];
      }

      const scrapedResults = [
        trumfResult,
        sasResult,
        rememberResult,
        dnbResult,
        obosResult,
        nafResult,
        lofavorResult,
        logbuyResult,
      ].filter((result) => shouldScrape(result.serviceId));

      const hasServiceFailures = scrapedResults.some((result) => !result.success);

      if (!onlyService && !hasServiceFailures) {
        await saveCache({
          trumfMerchants,
          sasMerchants,
          rememberMerchants,
          dnbMerchants,
          obosMerchants,
          nafMerchants,
          lofavorMerchants,
          logbuyMerchants,
          urlNameToHostname: Object.fromEntries(urlNameToHostname),
        });
      } else if (onlyService) {
        console.log("\nSkipping cache update (single-service mode).");
      } else {
        console.log(
          "\nSkipping scraper cache update because one or more services failed."
        );
      }
    } finally {
      await browser?.close();
    }
  }

  await saveFeedHealth(feedHealth);

  const serviceRuns = [
    trumfResult,
    sasResult,
    rememberResult,
    dnbResult,
    obosResult,
    nafResult,
    lofavorResult,
    logbuyResult,
  ];
  const alertServices = serviceRuns.filter(
    (result) =>
      !result.success &&
      result.consecutiveFailureDays >= ALERT_FAILURE_THRESHOLD
  );

  if (serviceRuns.some((result) => !result.success)) {
    console.log("\n=== Scrape Health ===");
    for (const result of serviceRuns) {
      if (result.success) {
        continue;
      }

      console.log(
        `  - ${result.serviceName}: reusing previous data (${result.consecutiveFailureDays} day streak)`
      );
      if (result.failureReason) {
        console.log(`    ${result.failureReason}`);
      }
    }
  }

  if (alertServices.length > 0) {
    console.log(
      `\nAlert threshold reached: ${alertServices
        .map((result) => result.serviceName)
        .join(", ")}`
    );
  }

  // ===================
  // Step 6: Build unified merchant list
  // ===================
  console.log("\n=== Building unified merchant list ===");
  const merchants: Record<string, MerchantEntry> = {};
  const unmappedTrumf: string[] = [];
  const unmappedSas: string[] = [];
  const unmappedRemember: string[] = [];
  const unmappedDnb: string[] = [];
  const unmappedLogbuy: string[] = [];

  // In single-service mode, restore all skipped services from existing sitelist
  if (onlyService) {
    for (const serviceId of MONITORED_SERVICE_IDS) {
      if (serviceId === onlyService) continue;
      const restored = restoreServiceOffersFromExisting(merchants, existingSitelist, serviceId);
      console.log(`  ${serviceId}: restored ${restored} existing offers (skipped)`);
    }
  }

  // Build name -> hostname map for matching re:member to existing merchants
  const nameToHostMap = new Map<string, string>();

  // Process Trumf merchants
  for (const merchant of trumfMerchants) {
    const slug = merchant.slug;
    let hostname: string | null = null;

    // 1. Check CDN feed
    if (urlNameToHostname.has(slug)) {
      hostname = urlNameToHostname.get(slug)!;
    }
    // 2. Check manual mappings
    else if (TRUMF_MANUAL_HOSTNAME_MAPPINGS[slug]) {
      hostname = TRUMF_MANUAL_HOSTNAME_MAPPINGS[slug];
    }
    // 3. Try to infer from name
    else {
      hostname = inferHostname(merchant.name);
    }

    if (!hostname || hostname.length < 4) {
      unmappedTrumf.push(`${merchant.name} (slug: ${slug})`);
      continue;
    }

    hostname = normalizeHostname(hostname);

    // Add or update merchant entry
    if (!merchants[hostname]) {
      merchants[hostname] = {
        hostName: hostname,
        name: merchant.name,
        offers: [],
      };
    }

    // Add Trumf offer
    merchants[hostname].offers.push({
      serviceId: "trumf",
      urlName: slug,
      cashbackDescription: merchant.cashbackDescription,
    });
  }

  if (!trumfResult.success) {
    const restoredOffers = restoreServiceOffersFromExisting(
      merchants,
      existingSitelist,
      "trumf"
    );
    console.log(`  Trumf: restored ${restoredOffers} existing offers`);
  }

  // Build name -> hostname map for matching re:member after Trumf success/fallback
  for (const [hostname, merchant] of Object.entries(merchants)) {
    if (!merchant.offers.some((offer) => offer.serviceId === "trumf")) {
      continue;
    }

    nameToHostMap.set(normalizeStoreName(merchant.name), hostname);
  }

  // Process re:member merchants
  // Load manual domain mappings for re:member-only stores
  let rememberDomainMappings: Record<string, string> = {};
  try {
    const mappingContent = await readFile(
      join(import.meta.dir, "..", "data", "remember-domains.json"),
      "utf-8"
    );
    rememberDomainMappings = JSON.parse(mappingContent);
  } catch {
    console.log("  Note: Could not load data/remember-domains.json");
  }

  let rememberMatched = 0;
  let rememberMappedOnly = 0;

  for (const merchant of rememberMerchants as RememberMerchant[]) {
    const normalizedName = normalizeStoreName(merchant.name);
    let matchedHost = nameToHostMap.get(normalizedName);

    // If no match by name, check manual domain mapping
    if (!matchedHost && rememberDomainMappings[merchant.slug]) {
      matchedHost = rememberDomainMappings[merchant.slug];
      if (!merchants[matchedHost]) {
        // Create new merchant entry for re:member-only store
        merchants[matchedHost] = {
          hostName: matchedHost,
          name: merchant.name,
          offers: [],
        };
      }
      rememberMappedOnly++;
    }

    if (matchedHost && merchants[matchedHost]) {
      // Check if re:member offer already exists
      const hasRememberOffer = merchants[matchedHost].offers.some(
        (o) => o.serviceId === "remember"
      );
      if (!hasRememberOffer) {
        const offer: ServiceOffer = {
          serviceId: "remember",
          urlName: merchant.slug,
          cashbackDescription: merchant.cashbackDescription,
        };
        if (merchant.cashbackDetails) {
          offer.cashbackDetails = merchant.cashbackDetails;
        }
        merchants[matchedHost].offers.push(offer);
        rememberMatched++;
      }
    } else {
      unmappedRemember.push(`${merchant.name} (slug: ${merchant.slug})`);
    }
  }

  if (!rememberResult.success) {
    const restoredOffers = restoreServiceOffersFromExisting(
      merchants,
      existingSitelist,
      "remember"
    );
    console.log(`  re:member: restored ${restoredOffers} existing offers`);
  }

  console.log(`  re:member: ${rememberMatched} matched, ${rememberMappedOnly} from manual mapping`);

  // Helper to find existing merchant by hostname (checks www variants)
  function findMerchantKey(hostname: string): string | null {
    if (merchants[hostname]) return hostname;
    // Check www variant
    if (hostname.startsWith("www.")) {
      const withoutWww = hostname.slice(4);
      if (merchants[withoutWww]) return withoutWww;
    } else {
      const withWww = "www." + hostname;
      if (merchants[withWww]) return withWww;
    }
    return null;
  }

  // Process SAS EuroBonus merchants
  let sasMapped = 0;
  for (const merchant of sasMerchants) {
    let hostname: string | null = null;

    if (merchant.storeUrl) {
      try {
        const url = new URL(merchant.storeUrl);
        hostname = url.hostname;
      } catch {
        // Invalid URL
      }
    }

    if (!hostname) {
      hostname = inferHostname(merchant.name);
    }

    if (!hostname || hostname.length < 4) {
      unmappedSas.push(`${merchant.name} (slug: ${merchant.slug})`);
      continue;
    }

    hostname = normalizeHostname(hostname);
    const existingKey = findMerchantKey(hostname);
    const merchantKey = existingKey || hostname;

    if (!merchants[merchantKey]) {
      merchants[merchantKey] = {
        hostName: merchantKey,
        name: merchant.name,
        offers: [],
      };
    }

    const sasPathPrefix = merchant.matchPathPrefix ?? null;
    const sasPathCaseSensitive = merchant.matchPathCaseSensitive ?? false;
    const hasSasOffer = merchants[merchantKey].offers.some(
      (o) =>
        o.serviceId === "sas" &&
        o.urlName === merchant.slug &&
        (o.matchPathPrefix ?? null) === sasPathPrefix &&
        (o.matchPathCaseSensitive ?? false) === sasPathCaseSensitive
    );
    if (!hasSasOffer) {
      merchants[merchantKey].offers.push({
        serviceId: "sas",
        urlName: merchant.slug,
        cashbackDescription: merchant.cashbackDescription,
        ...(merchant.clickthroughUrl && { clickthroughUrl: merchant.clickthroughUrl }),
        ...(merchant.matchPathPrefix && { matchPathPrefix: merchant.matchPathPrefix }),
        ...(merchant.matchPathCaseSensitive !== undefined && {
          matchPathCaseSensitive: merchant.matchPathCaseSensitive,
        }),
      });
      sasMapped++;
    }
  }

  if (!sasResult.success) {
    const restoredOffers = restoreServiceOffersFromExisting(
      merchants,
      existingSitelist,
      "sas"
    );
    console.log(`  SAS EuroBonus: restored ${restoredOffers} existing offers`);
  }

  console.log(`  SAS EuroBonus: ${sasMapped} mapped`);

  // Process DNB merchants
  for (const merchant of dnbMerchants) {
    let hostname: string | null = null;

    // Try to extract hostname from store URL
    if (merchant.storeUrl) {
      try {
        const url = new URL(merchant.storeUrl);
        hostname = url.hostname;
      } catch {
        // Invalid URL
      }
    }

    // Try to infer from name
    if (!hostname) {
      hostname = inferHostname(merchant.name);
    }

    if (!hostname || hostname.length < 4) {
      unmappedDnb.push(`${merchant.name}`);
      continue;
    }

    hostname = normalizeHostname(hostname);

    // Find existing merchant (checking www variants) or create new
    const existingKey = findMerchantKey(hostname);
    const merchantKey = existingKey || hostname;

    if (!merchants[merchantKey]) {
      merchants[merchantKey] = {
        hostName: merchantKey,
        name: merchant.name,
        offers: [],
      };
    }

    // Add DNB offer (check for duplicates first)
    const hasDnbOffer = merchants[merchantKey].offers.some(
      (o) => o.serviceId === "dnb"
    );
    if (!hasDnbOffer) {
      merchants[merchantKey].offers.push({
        serviceId: "dnb",
        urlName: "", // DNB uses static URL
        cashbackDescription: merchant.cashbackDescription,
        ...(merchant.code && { code: merchant.code }),
      });
    }
  }

  if (!dnbResult.success) {
    const restoredOffers = restoreServiceOffersFromExisting(
      merchants,
      existingSitelist,
      "dnb"
    );
    console.log(`  DNB: restored ${restoredOffers} existing offers`);
  }

  // Process OBOS merchants
  let obosDomainMappings: Record<string, string> = {};
  try {
    const mappingContent = await readFile(
      join(import.meta.dir, "..", "data", "obos-domains.json"),
      "utf-8"
    );
    obosDomainMappings = JSON.parse(mappingContent);
  } catch {
    console.log("  Note: Could not load data/obos-domains.json");
  }

  const unmappedObos: string[] = [];
  let obosMapped = 0;

  for (const merchant of obosMerchants) {
    let hostname: string | null = null;

    // 1. Check manual domain mapping
    if (obosDomainMappings[merchant.slug]) {
      hostname = obosDomainMappings[merchant.slug];
    }
    // 2. Try to extract hostname from store URL found on detail page
    else if (merchant.storeUrl) {
      try {
        const url = new URL(merchant.storeUrl);
        // Skip internal OBOS URLs
        if (!url.hostname.includes("obos.no")) {
          hostname = url.hostname;
        }
      } catch {
        // Invalid URL
      }
    }

    if (!hostname || hostname.length < 4) {
      unmappedObos.push(`${merchant.name} (slug: ${merchant.slug})`);
      continue;
    }

    hostname = normalizeHostname(hostname);

    // Find existing merchant (checking www variants) or create new
    const existingKey = findMerchantKey(hostname);
    const merchantKey = existingKey || hostname;

    if (!merchants[merchantKey]) {
      merchants[merchantKey] = {
        hostName: merchantKey,
        name: merchant.name,
        offers: [],
      };
    }

    // Add OBOS offer (check for duplicates first)
    const hasObosOffer = merchants[merchantKey].offers.some(
      (o) => o.serviceId === "obos"
    );
    if (!hasObosOffer) {
      merchants[merchantKey].offers.push({
        serviceId: "obos",
        urlName: merchant.slug,
        cashbackDescription: merchant.cashbackDescription,
      });
      obosMapped++;
    }
  }

  if (!obosResult.success) {
    const restoredOffers = restoreServiceOffersFromExisting(
      merchants,
      existingSitelist,
      "obos"
    );
    console.log(`  OBOS: restored ${restoredOffers} existing offers`);
  }

  console.log(`  OBOS: ${obosMapped} mapped`);

  // Process NAF merchants
  let nafDomainMappings: Record<string, string> = {};
  try {
    const mappingContent = await readFile(
      join(import.meta.dir, "..", "data", "naf-domains.json"),
      "utf-8"
    );
    nafDomainMappings = JSON.parse(mappingContent);
  } catch {
    console.log("  Note: Could not load data/naf-domains.json");
  }

  const unmappedNaf: string[] = [];
  let nafMapped = 0;
  let nafNameMatched = 0;

  // Build comprehensive name -> hostname map from ALL accumulated merchants
  // This allows matching NAF benefits like "Anton Sport", "Hurtigruten" etc.
  // against merchants already known from Trumf, re:member, DNB, OBOS
  const allNameToHostMap = new Map<string, string>();
  for (const [hostname, merchant] of Object.entries(merchants)) {
    allNameToHostMap.set(normalizeStoreName(merchant.name), hostname);
  }

  for (const merchant of nafMerchants) {
    let hostname: string | null = null;

    // 1. Check manual domain mapping
    if (nafDomainMappings[merchant.slug]) {
      hostname = nafDomainMappings[merchant.slug];
    }
    // 2. Try to extract hostname from store URL found on detail page
    else if (merchant.storeUrl) {
      try {
        const url = new URL(merchant.storeUrl);
        if (!isNAFInternalDomain(url.hostname)) {
          hostname = url.hostname;
        }
      } catch {
        // Invalid URL
      }
    }

    // 3. Try name-based matching against all existing merchants
    if (!hostname) {
      const normalizedName = normalizeStoreName(merchant.name);
      const matchedHost = allNameToHostMap.get(normalizedName);
      if (matchedHost) {
        hostname = matchedHost;
        nafNameMatched++;
      }
    }

    if (!hostname || hostname.length < 4) {
      unmappedNaf.push(`${merchant.name} (slug: ${merchant.slug})`);
      continue;
    }

    hostname = normalizeHostname(hostname);

    // Find existing merchant (checking www variants) or create new
    const existingKey = findMerchantKey(hostname);
    const merchantKey = existingKey || hostname;

    if (!merchants[merchantKey]) {
      merchants[merchantKey] = {
        hostName: merchantKey,
        name: merchant.name,
        offers: [],
      };
    }

    // Add NAF offer (check for duplicates first)
    const hasNafOffer = merchants[merchantKey].offers.some(
      (o) => o.serviceId === "naf"
    );
    if (!hasNafOffer) {
      const description = merchant.slug in NAF_DESCRIPTION_OVERRIDES
        ? NAF_DESCRIPTION_OVERRIDES[merchant.slug]
        : merchant.cashbackDescription;
      merchants[merchantKey].offers.push({
        serviceId: "naf",
        urlName: merchant.slug,
        cashbackDescription: description,
      });
      nafMapped++;
    }
  }

  if (!nafResult.success) {
    const restoredOffers = restoreServiceOffersFromExisting(
      merchants,
      existingSitelist,
      "naf"
    );
    console.log(`  NAF: restored ${restoredOffers} existing offers`);
  }

  console.log(`  NAF: ${nafMapped} mapped, ${nafNameMatched} from name matching`);

  // Process LOfavør merchants
  let lofavorDomainMappings: Record<string, string> = {};
  try {
    const mappingContent = await readFile(
      join(import.meta.dir, "..", "data", "lofavor-domains.json"),
      "utf-8"
    );
    lofavorDomainMappings = JSON.parse(mappingContent);
  } catch {
    console.log("  Note: Could not load data/lofavor-domains.json");
  }

  const unmappedLofavor: string[] = [];
  let lofavorMapped = 0;

  for (const merchant of lofavorMerchants) {
    let hostname: string | null = null;

    // 1. Check manual domain mapping
    if (lofavorDomainMappings[merchant.slug]) {
      hostname = lofavorDomainMappings[merchant.slug];
    }
    // 2. Try to extract hostname from store URL found on detail page
    else if (merchant.storeUrl) {
      try {
        const url = new URL(merchant.storeUrl);
        if (!isLOfavorInternalDomain(url.hostname)) {
          hostname = url.hostname;
        }
      } catch {
        // Invalid URL
      }
    }

    if (!hostname || hostname.length < 4) {
      unmappedLofavor.push(`${merchant.name} (slug: ${merchant.slug})`);
      continue;
    }

    hostname = normalizeHostname(hostname);

    // Find existing merchant (checking www variants) or create new
    const existingKey = findMerchantKey(hostname);
    const merchantKey = existingKey || hostname;

    if (!merchants[merchantKey]) {
      merchants[merchantKey] = {
        hostName: merchantKey,
        name: merchant.name,
        offers: [],
      };
    }

    // Add LOfavør offer (check for duplicates first)
    const hasLofavorOffer = merchants[merchantKey].offers.some(
      (o) => o.serviceId === "lofavor"
    );
    if (!hasLofavorOffer) {
      merchants[merchantKey].offers.push({
        serviceId: "lofavor",
        urlName: merchant.slug,
        cashbackDescription: merchant.cashbackDescription,
      });
      lofavorMapped++;
    }
  }

  if (!lofavorResult.success) {
    const restoredOffers = restoreServiceOffersFromExisting(
      merchants,
      existingSitelist,
      "lofavor"
    );
    console.log(`  LOfavør: restored ${restoredOffers} existing offers`);
  }

  console.log(`  LOfavør: ${lofavorMapped} mapped`);

  // Process Visma LogBuy merchants
  let logbuyMapped = 0;

  for (const merchant of logbuyMerchants) {
    let hostname: string | null = null;

    if (merchant.storeUrl && isUsableLogbuyStoreUrl(merchant.storeUrl)) {
      hostname = getLogbuyHostname(merchant.storeUrl);
    }

    if (!hostname || hostname.length < 4) {
      unmappedLogbuy.push(`${merchant.name} (supplierId: ${merchant.slug})`);
      continue;
    }

    // Find existing merchant (checking www variants) or create new
    const existingKey = findMerchantKey(hostname);
    const merchantKey = existingKey || hostname;

    if (!merchants[merchantKey]) {
      merchants[merchantKey] = {
        hostName: merchantKey,
        name: merchant.name,
        offers: [],
      };
    }

    // Add LogBuy offer (check for duplicates first)
    const hasLogbuyOffer = merchants[merchantKey].offers.some(
      (o) => o.serviceId === "logbuy" && o.urlName === merchant.slug
    );
    if (!hasLogbuyOffer) {
      merchants[merchantKey].offers.push({
        serviceId: "logbuy",
        urlName: merchant.slug,
        cashbackDescription: merchant.cashbackDescription,
      });
      logbuyMapped++;
    }
  }

  if (!logbuyResult.success) {
    const restoredOffers = restoreServiceOffersFromExisting(
      merchants,
      existingSitelist,
      "logbuy"
    );
    console.log(`  Visma LogBuy: restored ${restoredOffers} existing offers`);
  }

  console.log(`  Visma LogBuy: ${logbuyMapped} mapped`);

  // ===================
  // Step 7: Write updated sitelist.json
  // ===================
  // Load services from canonical source (data/services.json)
  const servicesJsonPath = join(import.meta.dir, "..", "data", "services.json");
  const servicesJson: Record<string, ServiceDefinition> = JSON.parse(
    await readFile(servicesJsonPath, "utf-8")
  );

  // Build services section: include all non-comingSoon services with feed-relevant fields
  const services: Record<string, Partial<ServiceDefinition>> = {};
  for (const [id, svc] of Object.entries(servicesJson)) {
    if ((svc as any).comingSoon) continue;
    const entry: Partial<ServiceDefinition> = {
      name: svc.name,
      clickthroughUrl: svc.clickthroughUrl,
      color: svc.color,
      defaultEnabled: svc.defaultEnabled,
    };
    if (svc.reminderDomain) entry.reminderDomain = svc.reminderDomain;
    if (svc.cashbackPathPatterns) entry.cashbackPathPatterns = svc.cashbackPathPatterns;
    if (svc.type) entry.type = svc.type;
    services[id] = entry;
  }

  const updatedSitelist: SiteList = {
    services: services as Record<string, ServiceDefinition>,
    merchants,
  };

  await writeFile(
    sitelistPath,
    JSON.stringify(updatedSitelist, null, 2) + "\n"
  );

  // ===================
  // Step 8: Summary
  // ===================
  console.log("\n=== Summary ===");
  console.log(`Total merchants in output: ${Object.keys(merchants).length}`);

  const trumfCount = Object.values(merchants).filter((m) =>
    m.offers.some((o) => o.serviceId === "trumf")
  ).length;
  const sasCount = Object.values(merchants).filter((m) =>
    m.offers.some((o) => o.serviceId === "sas")
  ).length;
  const rememberCount = Object.values(merchants).filter((m) =>
    m.offers.some((o) => o.serviceId === "remember")
  ).length;
  const dnbCount = Object.values(merchants).filter((m) =>
    m.offers.some((o) => o.serviceId === "dnb")
  ).length;
  const obosCount = Object.values(merchants).filter((m) =>
    m.offers.some((o) => o.serviceId === "obos")
  ).length;
  const nafCount = Object.values(merchants).filter((m) =>
    m.offers.some((o) => o.serviceId === "naf")
  ).length;
  const lofavorCount = Object.values(merchants).filter((m) =>
    m.offers.some((o) => o.serviceId === "lofavor")
  ).length;
  const logbuyCount = Object.values(merchants).filter((m) =>
    m.offers.some((o) => o.serviceId === "logbuy")
  ).length;

  console.log(`  - With Trumf offers: ${trumfCount}`);
  console.log(`  - With SAS EuroBonus offers: ${sasCount}`);
  console.log(`  - With re:member offers: ${rememberCount}`);
  console.log(`  - With DNB offers: ${dnbCount}`);
  console.log(`  - With OBOS offers: ${obosCount}`);
  console.log(`  - With NAF offers: ${nafCount}`);
  console.log(`  - With LOfavør offers: ${lofavorCount}`);
  console.log(`  - With Visma LogBuy offers: ${logbuyCount}`);
  console.log(`  - Unmapped Trumf: ${unmappedTrumf.length}`);
  console.log(`  - Unmapped SAS EuroBonus: ${unmappedSas.length}`);
  console.log(`  - Unmapped re:member: ${unmappedRemember.length}`);
  console.log(`  - Unmapped DNB: ${unmappedDnb.length}`);
  console.log(`  - Unmapped OBOS: ${unmappedObos.length}`);
  console.log(`  - Unmapped NAF: ${unmappedNaf.length}`);
  console.log(`  - Unmapped LOfavør: ${unmappedLofavor.length}`);
  console.log(`  - Unmapped Visma LogBuy: ${unmappedLogbuy.length}`);

  if (unmappedTrumf.length > 0) {
    console.log("\nUnmapped Trumf merchants (need manual hostname mapping):");
    for (const m of unmappedTrumf.slice(0, 10)) {
      console.log(`  - ${m}`);
    }
    if (unmappedTrumf.length > 10) {
      console.log(`  ... and ${unmappedTrumf.length - 10} more`);
    }
  }

  if (unmappedSas.length > 0) {
    console.log("\nUnmapped SAS EuroBonus merchants:");
    for (const m of unmappedSas.slice(0, 10)) {
      console.log(`  - ${m}`);
    }
    if (unmappedSas.length > 10) {
      console.log(`  ... and ${unmappedSas.length - 10} more`);
    }
  }

  if (unmappedRemember.length > 0) {
    console.log("\nUnmapped re:member merchants (add to data/remember-domains.json):");
    for (const m of unmappedRemember.slice(0, 10)) {
      console.log(`  - ${m}`);
    }
    if (unmappedRemember.length > 10) {
      console.log(`  ... and ${unmappedRemember.length - 10} more`);
    }
  }

  if (unmappedDnb.length > 0) {
    console.log("\nUnmapped DNB merchants:");
    for (const m of unmappedDnb.slice(0, 10)) {
      console.log(`  - ${m}`);
    }
    if (unmappedDnb.length > 10) {
      console.log(`  ... and ${unmappedDnb.length - 10} more`);
    }
  }

  if (unmappedObos.length > 0) {
    console.log("\nUnmapped OBOS merchants (add to data/obos-domains.json):");
    for (const m of unmappedObos.slice(0, 10)) {
      console.log(`  - ${m}`);
    }
    if (unmappedObos.length > 10) {
      console.log(`  ... and ${unmappedObos.length - 10} more`);
    }
  }

  if (unmappedNaf.length > 0) {
    console.log("\nUnmapped NAF merchants (add to data/naf-domains.json):");
    for (const m of unmappedNaf.slice(0, 10)) {
      console.log(`  - ${m}`);
    }
    if (unmappedNaf.length > 10) {
      console.log(`  ... and ${unmappedNaf.length - 10} more`);
    }
  }

  if (unmappedLofavor.length > 0) {
    console.log("\nUnmapped LOfavør merchants (add to data/lofavor-domains.json):");
    for (const m of unmappedLofavor.slice(0, 10)) {
      console.log(`  - ${m}`);
    }
    if (unmappedLofavor.length > 10) {
      console.log(`  ... and ${unmappedLofavor.length - 10} more`);
    }
  }

  if (unmappedLogbuy.length > 0) {
    console.log("\nUnmapped Visma LogBuy merchants:");
    for (const m of unmappedLogbuy.slice(0, 10)) {
      console.log(`  - ${m}`);
    }
    if (unmappedLogbuy.length > 10) {
      console.log(`  ... and ${unmappedLogbuy.length - 10} more`);
    }
  }

  console.log("\nDone! Updated data/sitelist.json");
}

main().catch(console.error);
