/**
 * Multi-Service Merchant Scraper
 *
 * Uses Playwright to scrape all merchants from:
 * - trumfnetthandel.no/kategori (Trumf - tracking-based cashback)
 * - dnb.no/kundeprogram/fordeler/faste-rabatter (DNB - code-based rebates)
 *
 * Strategy:
 * 1. Fetch the official CDN feed to get hostname -> urlName mappings for Trumf
 * 2. Use Playwright to load pages and scroll until all merchants are loaded
 * 3. Use manual hostname mappings for merchants not in CDN feed
 * 4. Merge all services into unified sitelist.json format
 */

import { chromium, type Page, type Browser } from "playwright";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";

// ===================
// Configuration
// ===================

const TRUMF_BASE_URL = "https://trumfnetthandel.no";
const TRUMF_CDN_FEED_URL = "https://wlp.tcb-cdn.com/trumf/notifierfeed.json";
const DNB_URL = "https://www.dnb.no/kundeprogram/fordeler/faste-rabatter";
const OBOS_BENEFITS_URL = "https://www.obos.no/medlem/medlemsfordeler";
const LOFAVOR_BASE_URL = "https://www.lofavor.no";

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

interface ScraperCache {
  timestamp: number;
  trumfMerchants: ScrapedMerchant[];
  rememberMerchants: ScrapedMerchant[];
  dnbMerchants: ScrapedMerchant[];
  obosMerchants: ScrapedMerchant[];
  lofavorMerchants: ScrapedMerchant[];
  urlNameToHostname: Record<string, string>;
}

async function loadCache(): Promise<ScraperCache | null> {
  try {
    const content = await readFile(CACHE_FILE, "utf-8");
    const cache: ScraperCache = JSON.parse(content);
    const age = Date.now() - cache.timestamp;
    if (age < CACHE_MAX_AGE) {
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
};

// ===================
// Types
// ===================

interface ServiceOffer {
  serviceId: string;
  urlName: string;
  cashbackDescription: string;
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
  storeUrl?: string; // For DNB merchants
}

// ===================
// Utility Functions
// ===================

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
    console.error("  Error scraping re:member:", error);
    return [];
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
    console.error("  Error scraping DNB:", error);
    return [];
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
    console.error("  Error scraping OBOS:", error);
    return [];
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
    console.error("  Error scraping LOfavør:", error);
    return [];
  }
}

// ===================
// Main Logic
// ===================

async function main() {
  console.log("Starting multi-service merchant scraper...\n");

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

  // Check cache first
  const cache = await loadCache();
  let trumfMerchants: ScrapedMerchant[];
  let rememberMerchants: ScrapedMerchant[];
  let dnbMerchants: ScrapedMerchant[];
  let obosMerchants: ScrapedMerchant[];
  let lofavorMerchants: ScrapedMerchant[];
  let urlNameToHostname: Map<string, string>;

  if (cache) {
    const ageHours = Math.round((Date.now() - cache.timestamp) / (60 * 60 * 1000));
    console.log(`Using cached scraper data (${ageHours}h old)\n`);
    trumfMerchants = cache.trumfMerchants;
    rememberMerchants = cache.rememberMerchants;
    dnbMerchants = cache.dnbMerchants;
    obosMerchants = cache.obosMerchants || [];
    lofavorMerchants = cache.lofavorMerchants || [];
    urlNameToHostname = new Map(Object.entries(cache.urlNameToHostname));
    console.log(`  Trumf: ${trumfMerchants.length} merchants`);
    console.log(`  re:member: ${rememberMerchants.length} merchants`);
    console.log(`  DNB: ${dnbMerchants.length} merchants`);
    console.log(`  OBOS: ${obosMerchants.length} merchants`);
    console.log(`  LOfavør: ${lofavorMerchants.length} merchants`);
  } else {
    // Launch browser for scraping
    console.log("Launching browser...");
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    try {
      // ===================
      // Step 1: Fetch Trumf CDN feed for hostname mappings
      // ===================
      console.log("Fetching Trumf CDN feed for hostname mappings...");
      urlNameToHostname = new Map<string, string>();

      try {
        const result = await fetchTrumfCDNFeed();
        urlNameToHostname = result.urlNameToHostname;
        console.log(
          `  Found ${urlNameToHostname.size} hostname mappings in CDN feed\n`
        );
      } catch (error) {
        console.error("  Failed to fetch CDN feed, continuing without it\n");
      }

      // ===================
      // Step 2: Scrape Trumf merchants
      // ===================
      trumfMerchants = await scrapeTrumf(page);
      console.log(`Scraped ${trumfMerchants.length} Trumf merchants`);

      // ===================
      // Step 3: Scrape re:member merchants (no browser needed)
      // ===================
      rememberMerchants = await scrapeRemember();
      console.log(`Scraped ${rememberMerchants.length} re:member merchants`);

      // ===================
      // Step 4: Scrape DNB merchants
      // ===================
      dnbMerchants = await scrapeDNB(page);
      console.log(`Scraped ${dnbMerchants.length} DNB merchants`);

      // ===================
      // Step 5: Scrape OBOS merchants
      // ===================
      obosMerchants = await scrapeOBOS(page);
      console.log(`Scraped ${obosMerchants.length} OBOS merchants`);

      // ===================
      // Step 6: Scrape LOfavør merchants
      // ===================
      lofavorMerchants = await scrapeLOfavor(page);
      console.log(`Scraped ${lofavorMerchants.length} LOfavør merchants`);

      // Save to cache
      await saveCache({
        trumfMerchants,
        rememberMerchants,
        dnbMerchants,
        obosMerchants,
        lofavorMerchants,
        urlNameToHostname: Object.fromEntries(urlNameToHostname),
      });
    } finally {
      await browser.close();
    }
  }

  // ===================
  // Step 6: Build unified merchant list
  // ===================
  console.log("\n=== Building unified merchant list ===");
  const merchants: Record<string, MerchantEntry> = {};
  const unmappedTrumf: string[] = [];
  const unmappedRemember: string[] = [];
  const unmappedDnb: string[] = [];

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

    // Build name -> host mapping for matching re:member
    const normalizedName = normalizeStoreName(merchant.name);
    nameToHostMap.set(normalizedName, hostname);
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

  console.log(`  OBOS: ${obosMapped} mapped`);

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

  console.log(`  LOfavør: ${lofavorMapped} mapped`);

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
    if (svc.reminderDomain) (entry as any).reminderDomain = svc.reminderDomain;
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
  const rememberCount = Object.values(merchants).filter((m) =>
    m.offers.some((o) => o.serviceId === "remember")
  ).length;
  const dnbCount = Object.values(merchants).filter((m) =>
    m.offers.some((o) => o.serviceId === "dnb")
  ).length;
  const obosCount = Object.values(merchants).filter((m) =>
    m.offers.some((o) => o.serviceId === "obos")
  ).length;
  const lofavorCount = Object.values(merchants).filter((m) =>
    m.offers.some((o) => o.serviceId === "lofavor")
  ).length;

  console.log(`  - With Trumf offers: ${trumfCount}`);
  console.log(`  - With re:member offers: ${rememberCount}`);
  console.log(`  - With DNB offers: ${dnbCount}`);
  console.log(`  - With OBOS offers: ${obosCount}`);
  console.log(`  - With LOfavør offers: ${lofavorCount}`);
  console.log(`  - Unmapped Trumf: ${unmappedTrumf.length}`);
  console.log(`  - Unmapped re:member: ${unmappedRemember.length}`);
  console.log(`  - Unmapped DNB: ${unmappedDnb.length}`);
  console.log(`  - Unmapped OBOS: ${unmappedObos.length}`);
  console.log(`  - Unmapped LOfavør: ${unmappedLofavor.length}`);

  if (unmappedTrumf.length > 0) {
    console.log("\nUnmapped Trumf merchants (need manual hostname mapping):");
    for (const m of unmappedTrumf.slice(0, 10)) {
      console.log(`  - ${m}`);
    }
    if (unmappedTrumf.length > 10) {
      console.log(`  ... and ${unmappedTrumf.length - 10} more`);
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

  if (unmappedLofavor.length > 0) {
    console.log("\nUnmapped LOfavør merchants (add to data/lofavor-domains.json):");
    for (const m of unmappedLofavor.slice(0, 10)) {
      console.log(`  - ${m}`);
    }
    if (unmappedLofavor.length > 10) {
      console.log(`  ... and ${unmappedLofavor.length - 10} more`);
    }
  }

  console.log("\nDone! Updated data/sitelist.json");
}

main().catch(console.error);
