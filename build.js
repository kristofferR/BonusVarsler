#!/usr/bin/env node

/**
 * Build script for BonusVarsler
 * - Downloads fresh sitelist from CDN
 * - Checks CSP on all sites to find those that block adblock detection URLs (cached for 24h)
 * - Updates CSP_RESTRICTED_SITES in content.js and userscript
 * - Creates Firefox XPI and Chrome ZIP packages with platform-specific manifests
 */

import fs from "fs";
import path from "path";
import https from "https";
import http from "http";
import { execSync } from "child_process";

// ===================
// Configuration
// ===================

// Load service definitions from canonical source (data/services.json)
// Build-specific properties (feedUrl, scrapeUrl) are added here
const SERVICES_BASE = JSON.parse(fs.readFileSync("data/services.json", "utf8"));
const SERVICES = {
  trumf: {
    ...SERVICES_BASE.trumf,
    feedUrl: "https://wlp.tcb-cdn.com/trumf/notifierfeed.json",
  },
  remember: {
    ...SERVICES_BASE.remember,
    scrapeUrl: "https://www.remember.no/reward/rabatt",
  },
  dnb: {
    ...SERVICES_BASE.dnb,
    // DNB merchants are scraped by scripts/scrape-feeds.ts, not build.js
  },
};

const FEED_URL = "https://wlp.tcb-cdn.com/trumf/notifierfeed.json";
const AD_TEST_URLS = [
  "https://widgets.outbrain.com/outbrain.js",
  "https://adligature.com/",
  "https://secure.quantserve.com/quant.js",
  "https://srvtrck.com/assets/css/LineIcons.css",
];

const BUILD_DIR = "dist";
const CSP_CACHE_FILE = ".csp-cache.json";
const CSP_CACHE_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours in ms

const EXTENSION_FILES = [
  "content.js",
  "background.js",
  "options.html",
  "options.js",
  "options.css",
  "icon.png",
  "icons/icon-16.png",
  "icons/icon-32.png",
  "icons/icon-48.png",
  "icons/icon-128.png",
  "icons/icon-256.png",
  "_locales",
  "data",
];

const SUPPORTED_LOCALES = ["no", "en", "sv", "da", "fr", "es"];

// Extension metadata
const EXTENSION_CONFIG = {
  name: "BonusVarsler",
  shortName: "BonusVarsler",
  firefoxId: "trumf-bonusvarsler-lite@kristofferR",
};

// ===================
// Utility Functions
// ===================

function fetch(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { timeout: 10000 }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return fetch(res.headers.location).then(resolve).catch(reject);
        }
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve({ statusCode: res.statusCode, data, headers: res.headers }));
      })
      .on("error", reject)
      .on("timeout", () => reject(new Error("Timeout")));
  });
}

function fetchHeaders(url, timeout = 5000) {
  return new Promise((resolve) => {
    const protocol = url.startsWith("https") ? https : http;
    const req = protocol.get(
      url,
      { timeout, headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" } },
      (res) => {
        resolve({ statusCode: res.statusCode, headers: res.headers, location: res.headers.location });
        res.destroy();
      }
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
  });
}

function parseCSP(cspHeader) {
  if (!cspHeader) return null;
  const directives = {};
  const parts = cspHeader.split(";").map((p) => p.trim());
  for (const part of parts) {
    const [directive, ...values] = part.split(/\s+/);
    if (directive) directives[directive.toLowerCase()] = values;
  }
  return directives;
}

function wouldBlockUrl(csp, testUrl) {
  if (!csp) return false;
  const testHostname = new URL(testUrl).hostname;
  const connectSrc = csp["connect-src"];
  if (!connectSrc) return false;
  if (connectSrc.length === 0) return true;

  for (const source of connectSrc) {
    if (source === "*") return false;
    if (source === "'self'") continue;
    if (source.includes("*")) {
      const pattern = source.replace(/\./g, "\\.").replace(/\*/g, ".*").replace(/^https?:\/\//, "");
      try {
        if (new RegExp(`^${pattern}$`).test(testHostname)) return false;
      } catch {}
    }
    try {
      const sourceUrl = source.startsWith("http") ? source : `https://${source}`;
      const sourceHostname = new URL(sourceUrl).hostname;
      if (sourceHostname === testHostname || testHostname.endsWith(`.${sourceHostname}`)) return false;
    } catch {}
  }
  return true;
}

async function checkSiteCSP(hostname) {
  const url = `https://${hostname}`;
  let result = await fetchHeaders(url);

  let redirects = 0;
  while (result?.location && redirects < 3) {
    const redirectUrl = result.location.startsWith("http") ? result.location : new URL(result.location, url).href;
    result = await fetchHeaders(redirectUrl);
    redirects++;
  }

  if (!result) return { hostname, error: true, blocked: [] };

  const cspHeader = result.headers["content-security-policy"] || result.headers["content-security-policy-report-only"];
  if (!cspHeader) return { hostname, blocked: [] };

  const csp = parseCSP(cspHeader);
  const blocked = AD_TEST_URLS.filter((testUrl) => wouldBlockUrl(csp, testUrl));

  return { hostname, blocked, allBlocked: blocked.length === AD_TEST_URLS.length };
}

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const child of fs.readdirSync(src)) {
      copyRecursive(path.join(src, child), path.join(dest, child));
    }
  } else {
    // Ensure parent directory exists for nested files
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

// ===================
// Main Build Steps
// ===================

/**
 * Scrape re:member store data from their website
 * The stores are embedded as JSON in a script tag
 */
async function scrapeRememberStores(url) {
  const response = await fetch(url);
  if (response.statusCode !== 200) {
    throw new Error(`HTTP ${response.statusCode}`);
  }

  const html = response.data;

  // Find the stores JSON in the page - it's in a __NEXT_DATA__ script tag
  const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!nextDataMatch) {
    throw new Error("Could not find __NEXT_DATA__ script tag");
  }

  const nextData = JSON.parse(nextDataMatch[1]);
  const stores = nextData?.props?.pageProps?.stores;

  if (!stores || !Array.isArray(stores)) {
    throw new Error("Could not find stores array in page data");
  }

  // Convert to our feed format
  const merchants = {};
  for (const store of stores) {
    if (!store.enabled || !store.name) continue;

    // Skip "Direct Deals" stores - they offer discounts on specific products only,
    // not store-wide cashback, so they won't work with our integration
    if (store.name.toLowerCase().includes("direct deals")) continue;

    const slug = store.slug;
    if (!slug) continue;

    // Build cashback description
    let cashbackDescription = "";
    let cashbackDetails = null;

    // Check for multiple commission rates
    if (store.commission && store.commission.length > 1) {
      const percentageRates = store.commission.filter((c) => c.type === "PERCENTAGE");
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
      if (store.maxPercentageValue > 0) {
        cashbackDescription = `${store.maxPercentageValue}%`;
      } else if (store.maxFixedValue > 0) {
        cashbackDescription = `${store.maxFixedValue} kr`;
      }
    }

    // Skip stores with no cashback
    if (!cashbackDescription) continue;

    // Store by slug since we don't have domain info
    // We'll need to map these to actual domains separately
    const merchantData = {
      name: store.name,
      urlName: slug,
      cashbackDescription,
      _slug: slug,
    };
    if (cashbackDetails) {
      merchantData.cashbackDetails = cashbackDetails;
    }
    merchants[`_remember_${slug}`] = merchantData;
  }

  return { merchants };
}

async function downloadServiceFeed(service) {
  console.log(`   Fetching ${service.name} feed...`);
  try {
    let feed;

    if (service.scrapeUrl) {
      // Scrape HTML page (re:member)
      feed = await scrapeRememberStores(service.scrapeUrl);
    } else if (service.feedUrl) {
      // Fetch JSON feed (Trumf)
      const response = await fetch(service.feedUrl);
      if (response.statusCode !== 200) {
        console.log(`   ⚠ Failed to download ${service.name} feed: ${response.statusCode}`);
        return null;
      }
      feed = JSON.parse(response.data);
    } else {
      console.log(`   ⚠ No feed URL or scrape URL for ${service.name}`);
      return null;
    }

    const merchantCount = Object.keys(feed.merchants || {}).length;
    console.log(`   ✓ ${service.name}: ${merchantCount} merchants`);
    return feed;
  } catch (error) {
    console.log(`   ⚠ Error fetching ${service.name} feed: ${error.message}`);
    return null;
  }
}

/**
 * Normalize a store name for matching across services
 */
function normalizeStoreName(name) {
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

async function downloadSitelist() {
  console.log("📥 Downloading service feeds...");

  // Download all service feeds in parallel
  const feedPromises = Object.values(SERVICES).map(async (service) => ({
    service,
    feed: await downloadServiceFeed(service),
  }));
  const results = await Promise.all(feedPromises);

  // Create unified feed structure
  const unifiedFeed = {
    services: {},
    merchants: {},
  };

  // Add service metadata
  for (const service of Object.values(SERVICES)) {
    unifiedFeed.services[service.id] = {
      name: service.name,
      clickthroughUrl: service.clickthroughUrl,
      reminderDomain: service.reminderDomain,
      color: service.color,
      defaultEnabled: service.defaultEnabled,
    };
  }

  // First pass: Add Trumf merchants (they have domain info)
  const trumfResult = results.find((r) => r.service.id === "trumf");
  const nameToHostMap = new Map(); // Map normalized name -> host

  if (trumfResult?.feed?.merchants) {
    for (const [host, merchant] of Object.entries(trumfResult.feed.merchants)) {
      unifiedFeed.merchants[host] = {
        hostName: merchant.hostName || host,
        name: merchant.name,
        offers: [
          {
            serviceId: "trumf",
            urlName: merchant.urlName,
            cashbackDescription: merchant.cashbackDescription,
          },
        ],
      };

      // Build name -> host mapping for matching other services
      const normalizedName = normalizeStoreName(merchant.name);
      nameToHostMap.set(normalizedName, host);
    }
  }

  // Second pass: Add re:member offers to matching merchants
  const rememberResult = results.find((r) => r.service.id === "remember");
  let rememberMatched = 0;
  let rememberUnmatched = 0;

  if (rememberResult?.feed?.merchants) {
    for (const [key, merchant] of Object.entries(rememberResult.feed.merchants)) {
      // Skip internal keys (prefixed with _remember_)
      if (!key.startsWith("_remember_")) continue;

      const normalizedName = normalizeStoreName(merchant.name);
      const matchedHost = nameToHostMap.get(normalizedName);

      if (matchedHost && unifiedFeed.merchants[matchedHost]) {
        // Check if re:member offer already exists for this merchant (avoid duplicates)
        const existingOffers = unifiedFeed.merchants[matchedHost].offers;
        const hasRememberOffer = existingOffers.some(
          (offer) => offer.serviceId === "remember"
        );
        if (hasRememberOffer) {
          continue; // Skip duplicate re:member offer
        }
        // Add re:member offer to existing merchant
        const offer = {
          serviceId: "remember",
          urlName: merchant.urlName,
          cashbackDescription: merchant.cashbackDescription,
        };
        if (merchant.cashbackDetails) {
          offer.cashbackDetails = merchant.cashbackDetails;
        }
        existingOffers.push(offer);
        rememberMatched++;
      } else {
        // No matching Trumf merchant - we can't add without domain info
        rememberUnmatched++;
      }
    }
  }

  if (rememberResult?.feed) {
    console.log(`   ✓ re:member: ${rememberMatched} matched to Trumf stores`);
  }

  // Third pass: Add re:member-only merchants from manual domain mapping
  let rememberOnlyAdded = 0;
  const unmappedSlugs = [];

  if (rememberResult?.feed?.merchants) {
    // Load manual domain mappings
    let domainMappings = {};
    try {
      domainMappings = JSON.parse(fs.readFileSync("data/remember-domains.json", "utf8"));
    } catch (e) {
      console.log("   ⚠ Could not load data/remember-domains.json");
    }

    for (const [key, merchant] of Object.entries(rememberResult.feed.merchants)) {
      if (!key.startsWith("_remember_")) continue;

      const slug = merchant._slug;
      const normalizedName = normalizeStoreName(merchant.name);

      // Skip if already matched to a Trumf merchant
      if (nameToHostMap.has(normalizedName)) continue;

      // Look up domain in manual mapping
      const domain = domainMappings[slug];
      if (!domain) {
        unmappedSlugs.push(slug);
        continue;
      }

      const rememberOffer = {
        serviceId: "remember",
        urlName: merchant.urlName,
        cashbackDescription: merchant.cashbackDescription,
      };
      if (merchant.cashbackDetails) {
        rememberOffer.cashbackDetails = merchant.cashbackDetails;
      }

      if (unifiedFeed.merchants[domain]) {
        // Domain exists - add re:member offer if not already present
        const existingOffers = unifiedFeed.merchants[domain].offers;
        const hasRememberOffer = existingOffers.some((o) => o.serviceId === "remember");
        if (!hasRememberOffer) {
          existingOffers.push(rememberOffer);
          rememberOnlyAdded++;
        }
      } else {
        // Add as new re:member-only merchant
        unifiedFeed.merchants[domain] = {
          hostName: domain,
          name: merchant.name,
          offers: [rememberOffer],
        };
        rememberOnlyAdded++;
      }
    }

    if (rememberOnlyAdded > 0) {
      console.log(`   ✓ re:member-only: ${rememberOnlyAdded} added from manual mapping`);
    }
    if (unmappedSlugs.length > 0) {
      console.log(`   ⚠ re:member unmapped (${unmappedSlugs.length}): ${unmappedSlugs.sort().join(", ")}`);
    }
  }

  // Save to both locations
  fs.writeFileSync("sitelist.json", JSON.stringify(unifiedFeed));
  fs.writeFileSync("data/sitelist.json", JSON.stringify(unifiedFeed));

  const merchantCount = Object.keys(unifiedFeed.merchants).length;
  const multiServiceCount = Object.values(unifiedFeed.merchants).filter(
    (m) => m.offers.length > 1
  ).length;
  console.log(`   ✓ Combined feed: ${merchantCount} merchants (${multiServiceCount} with multiple services)`);

  return unifiedFeed;
}

function loadCSPCache() {
  try {
    if (fs.existsSync(CSP_CACHE_FILE)) {
      const cache = JSON.parse(fs.readFileSync(CSP_CACHE_FILE, "utf8"));
      const age = Date.now() - cache.timestamp;
      if (age < CSP_CACHE_MAX_AGE) {
        return cache;
      }
    }
  } catch {}
  return null;
}

function saveCSPCache(restrictedSites) {
  const cache = {
    timestamp: Date.now(),
    restrictedSites,
  };
  fs.writeFileSync(CSP_CACHE_FILE, JSON.stringify(cache, null, 2));
}

async function checkAllSitesCSP(sitelist) {
  // Check cache first
  const cache = loadCSPCache();
  if (cache) {
    const ageHours = Math.round((Date.now() - cache.timestamp) / (60 * 60 * 1000));
    console.log(`\n🔍 Using cached CSP results (${ageHours}h old, ${cache.restrictedSites.length} restricted sites)`);
    return cache.restrictedSites;
  }

  // Get merchants that have at least one tracking-based service (non-code, non-info)
  // Code-based (DNB) and info-based (OBOS) services skip adblock detection, so CSP doesn't matter
  const merchants = Object.entries(sitelist.merchants || {})
    .filter(([_, merchant]) =>
      merchant.offers.some((offer) => {
        const type = SERVICES_BASE[offer.serviceId]?.type;
        return type !== "code" && type !== "info";
      })
    )
    .map(([host]) => host);
  console.log(`\n🔍 Checking CSP on ${merchants.length} sites with tracking-based services (parallel)...`);

  const CONCURRENCY = 30;
  const restrictedSites = [];
  let checked = 0;

  // Process in parallel batches
  for (let i = 0; i < merchants.length; i += CONCURRENCY) {
    const batch = merchants.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map((hostname) => checkSiteCSP(hostname)));

    for (const result of results) {
      checked++;
      if (result.allBlocked) {
        restrictedSites.push(result.hostname);
        console.log(`   [${checked}/${merchants.length}] ${result.hostname}: CSP blocks all test URLs`);
      }
    }
    process.stdout.write(`\r   [${checked}/${merchants.length}] Checking...`);
  }

  const sorted = restrictedSites.sort();
  console.log(`\n   ✓ Found ${sorted.length} CSP-restricted sites`);

  // Save to cache
  saveCSPCache(sorted);

  return sorted;
}

function updateCSPRestrictedSites(restrictedSites) {
  console.log("\n📝 Updating CSP_RESTRICTED_SITES in source files...");

  const siteListCode = restrictedSites.map((s) => `    "${s}",`).join("\n");
  const newSetCode = `const CSP_RESTRICTED_SITES = new Set([\n${siteListCode}\n  ]);`;

  // Update content.js
  let contentJs = fs.readFileSync("content.js", "utf8");
  contentJs = contentJs.replace(
    /const CSP_RESTRICTED_SITES = new Set\(\[\n[\s\S]*?\]\);/,
    newSetCode
  );
  fs.writeFileSync("content.js", contentJs);
  console.log("   ✓ Updated content.js");

  // Update userscript
  let userscript = fs.readFileSync("BonusVarsler.user.js", "utf8");
  userscript = userscript.replace(
    /const CSP_RESTRICTED_SITES = new Set\(\[\n[\s\S]*?\]\);/,
    newSetCode
  );
  fs.writeFileSync("BonusVarsler.user.js", userscript);
  console.log("   ✓ Updated BonusVarsler.user.js");
}

function createManifest(platform) {
  const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));

  // Set extension name
  manifest.name = EXTENSION_CONFIG.name;
  manifest.action.default_title = EXTENSION_CONFIG.shortName;

  if (platform === "chrome") {
    // Chrome uses service_worker
    manifest.background = {
      service_worker: "background.js",
    };
    // Remove Firefox-specific settings
    delete manifest.browser_specific_settings;
  } else {
    // Firefox uses scripts array
    manifest.background = {
      scripts: ["background.js"],
    };
    // Firefox-specific settings
    manifest.browser_specific_settings = {
      gecko: {
        id: EXTENSION_CONFIG.firefoxId,
        strict_min_version: "142.0",
        granted_host_permissions: true,
        data_collection_permissions: {
          required: ["none"],
          optional: [],
        },
      },
    };
  }

  return manifest;
}

function createPackages() {
  console.log("\n📦 Creating extension packages...");

  // Clean and create build directory
  if (fs.existsSync(BUILD_DIR)) {
    fs.rmSync(BUILD_DIR, { recursive: true });
  }
  fs.mkdirSync(BUILD_DIR, { recursive: true });

  // Read version from manifest
  const baseManifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
  const version = baseManifest.version;

  // Build Firefox XPI
  const firefoxDir = path.join(BUILD_DIR, "firefox");
  fs.mkdirSync(firefoxDir, { recursive: true });

  for (const file of EXTENSION_FILES) {
    if (!fs.existsSync(file)) continue;
    copyRecursive(file, path.join(firefoxDir, file));
  }
  fs.writeFileSync(
    path.join(firefoxDir, "manifest.json"),
    JSON.stringify(createManifest("firefox"), null, 2)
  );

  const xpiName = `bonusvarsler-${version}.xpi`;
  execSync(`cd "${firefoxDir}" && zip -r "../${xpiName}" .`, { stdio: "pipe" });
  console.log(`   ✓ Created ${xpiName}`);

  // Build Chrome ZIP
  const chromeDir = path.join(BUILD_DIR, "chrome");
  fs.mkdirSync(chromeDir, { recursive: true });

  for (const file of EXTENSION_FILES) {
    if (!fs.existsSync(file)) continue;
    copyRecursive(file, path.join(chromeDir, file));
  }
  fs.writeFileSync(
    path.join(chromeDir, "manifest.json"),
    JSON.stringify(createManifest("chrome"), null, 2)
  );

  const zipName = `bonusvarsler-${version}-chrome.zip`;
  execSync(`cd "${chromeDir}" && zip -r "../${zipName}" .`, { stdio: "pipe" });
  console.log(`   ✓ Created ${zipName}`);

  // Clean up temp directories
  fs.rmSync(firefoxDir, { recursive: true });
  fs.rmSync(chromeDir, { recursive: true });

  console.log(`\n✅ Build complete! Packages in ${BUILD_DIR}/`);
  console.log(`   - ${xpiName}`);
  console.log(`   - ${zipName}`);
}

function updateGitignore() {
  const gitignorePath = ".gitignore";
  let gitignore = "";
  let updated = false;

  if (fs.existsSync(gitignorePath)) {
    gitignore = fs.readFileSync(gitignorePath, "utf8");
  }

  if (!gitignore.includes(BUILD_DIR)) {
    gitignore = gitignore.trimEnd() + `\n\n# Build output\n${BUILD_DIR}/\n`;
    updated = true;
  }

  if (!gitignore.includes(CSP_CACHE_FILE)) {
    gitignore = gitignore.trimEnd() + `\n${CSP_CACHE_FILE}\n`;
    updated = true;
  }

  if (updated) {
    fs.writeFileSync(gitignorePath, gitignore);
    console.log("   ✓ Updated .gitignore");
  }
}

// ===================
// Main
// ===================

async function main() {
  try {
    console.log("🚀 Building BonusVarsler\n");

    // Run the scraper script to get fresh merchant data from all services
    console.log("📥 Running merchant scraper...\n");
    try {
      execSync("bun scripts/scrape-feeds.ts", { stdio: "inherit" });
    } catch (error) {
      console.error("   ⚠ Scraper failed, continuing with existing sitelist.json");
    }

    // Load the sitelist that was created/updated by the scraper
    // Try data/sitelist.json first, fall back to root sitelist.json
    let sitelist;
    if (fs.existsSync("data/sitelist.json")) {
      sitelist = JSON.parse(fs.readFileSync("data/sitelist.json", "utf8"));
      console.log(`\n   ✓ Loaded sitelist with ${Object.keys(sitelist.merchants || {}).length} merchants`);
    } else if (fs.existsSync("sitelist.json")) {
      console.log("\n   ⚠ data/sitelist.json not found, using root sitelist.json as fallback");
      sitelist = JSON.parse(fs.readFileSync("sitelist.json", "utf8"));
      console.log(`   ✓ Loaded sitelist with ${Object.keys(sitelist.merchants || {}).length} merchants`);
    } else {
      console.error("\n❌ No sitelist.json found in data/ or root. Run the scraper first.");
      process.exit(1);
    }

    // Copy to root sitelist.json (used for GitHub CDN fallback)
    fs.writeFileSync("sitelist.json", JSON.stringify(sitelist));

    // Check CSP on all sites
    const restrictedSites = await checkAllSitesCSP(sitelist);

    // Update source files with new CSP-restricted sites list
    updateCSPRestrictedSites(restrictedSites);

    // Bundle TypeScript source
    console.log("\n📦 Bundling TypeScript source...\n");
    try {
      execSync("bun run scripts/bundle.ts", { stdio: "inherit" });
    } catch (error) {
      console.error("   ⚠ TypeScript bundling failed, continuing with existing content.js");
    }

    // Update .gitignore
    updateGitignore();

    // Create packages
    createPackages();
  } catch (error) {
    console.error("\n❌ Build failed:", error.message);
    process.exit(1);
  }
}

main();
