"use strict";
(() => {
  // src/storage/local-session-storage.ts
  var LocalSessionStorage = class {
    get(key) {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    }
    set(key, value) {
      try {
        localStorage.setItem(key, value);
      } catch {
      }
    }
  };
  var localSessionStorageInstance = null;
  function getLocalSessionStorage() {
    if (!localSessionStorageInstance) {
      localSessionStorageInstance = new LocalSessionStorage();
    }
    return localSessionStorageInstance;
  }

  // src/storage/extension-storage.ts
  var browserAPI = typeof browser !== "undefined" ? browser : chrome;
  var ExtensionStorage = class {
    async get(key, defaultValue) {
      try {
        const result = await browserAPI.storage.local.get(key);
        return result[key] !== void 0 ? result[key] : defaultValue;
      } catch {
        return defaultValue;
      }
    }
    async set(key, value) {
      try {
        await browserAPI.storage.local.set({ [key]: value });
      } catch {
      }
    }
    async remove(keys) {
      try {
        await browserAPI.storage.local.remove(keys);
      } catch {
      }
    }
  };
  var extensionStorageInstance = null;
  function getExtensionStorage() {
    if (!extensionStorageInstance) {
      extensionStorageInstance = new ExtensionStorage();
    }
    return extensionStorageInstance;
  }
  function getSessionStorage() {
    return getLocalSessionStorage();
  }
  var getExtensionSessionStorage = getSessionStorage;

  // src/network/extension-fetch.ts
  var browserAPI2 = typeof browser !== "undefined" ? browser : chrome;
  var ExtensionFetch = class {
    async fetchJSON(url) {
      try {
        const response = await fetch(url);
        if (!response.ok) {
          return null;
        }
        return await response.json();
      } catch {
        return null;
      }
    }
    // URL params are intentionally unused here because the background script manages
    // feed URLs and handles CORS/fallback logic internally via its own configuration.
    async fetchFeed(_primaryUrl, _fallbackUrl) {
      try {
        const response = await browserAPI2.runtime.sendMessage({ type: "fetchFeed" });
        return response?.feed || null;
      } catch {
        return null;
      }
    }
    async checkUrlBlocked(url) {
      try {
        await fetch(url, { mode: "no-cors" });
        return false;
      } catch {
        return true;
      }
    }
  };
  var instance = null;
  function getExtensionFetch() {
    if (!instance) {
      instance = new ExtensionFetch();
    }
    return instance;
  }

  // src/i18n/extension-i18n.ts
  var browserAPI3 = typeof browser !== "undefined" ? browser : chrome;
  var ExtensionI18n = class {
    messages = {};
    async loadMessages(lang) {
      try {
        const url = browserAPI3.runtime.getURL(`_locales/${lang}/messages.json`);
        const response = await fetch(url);
        if (!response.ok) {
          this.messages = {};
          return;
        }
        this.messages = await response.json();
      } catch {
        this.messages = {};
      }
    }
    getMessage(key, substitutions) {
      const entry = this.messages[key];
      if (!entry || !entry.message) {
        return key;
      }
      let msg = entry.message;
      if (substitutions !== void 0) {
        const subs = Array.isArray(substitutions) ? substitutions : [substitutions];
        subs.forEach((sub, index) => {
          const placeholder = `$${index + 1}`;
          msg = msg.replace(placeholder, sub);
          if (entry.placeholders) {
            for (const [name, config] of Object.entries(entry.placeholders)) {
              if (config.content === placeholder) {
                msg = msg.replace(new RegExp(`\\$${name.toUpperCase()}\\$`, "g"), sub);
              }
            }
          }
        });
      }
      return msg;
    }
  };
  var instance2 = null;
  function getExtensionI18n() {
    if (!instance2) {
      instance2 = new ExtensionI18n();
    }
    return instance2;
  }

  // src/config/constants.ts
  var CONFIG = {
    feedUrl: "https://raw.githubusercontent.com/kristofferR/BonusVarsler/main/sitelist.json",
    fallbackUrl: "https://wlp.tcb-cdn.com/trumf/notifierfeed.json",
    cacheDuration: 48 * 60 * 60 * 1e3,
    // 48 hours
    messageDuration: 10 * 60 * 1e3,
    // 10 minutes
    pageVisitsBeforeCooldown: 3,
    // Start cooldown after this many page visits per site
    maxRetries: 5,
    retryDelays: [100, 500, 1e3, 2e3, 4e3],
    // Exponential backoff
    adblockTimeout: 3e3
    // 3 seconds timeout for adblock checks
  };
  var STORAGE_KEYS = {
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
    version: "BonusVarsler_Version"
  };
  var LEGACY_KEYS = {
    feedData_v3: "BonusVarsler_FeedData_v3",
    feedTime_v3: "BonusVarsler_FeedTime_v3",
    hostIndex_v3: "BonusVarsler_HostIndex_v3",
    feedData_v4: "BonusVarsler_FeedData_v4",
    feedTime_v4: "BonusVarsler_FeedTime_v4",
    hostIndex_v4: "BonusVarsler_HostIndex_v4"
  };
  var CURRENT_VERSION = "6.1";
  var MESSAGE_SHOWN_KEY_PREFIX = "BonusVarsler_MessageShown_";
  var PAGE_VISIT_COUNT_PREFIX = "BonusVarsler_PageVisits_";
  var DEFAULT_POSITION = "bottom-right";
  var DEFAULT_THEME = "light";
  var AD_TEST_URLS = [
    "https://widgets.outbrain.com/outbrain.js",
    "https://adligature.com/",
    "https://secure.quantserve.com/quant.js",
    "https://srvtrck.com/assets/css/LineIcons.css"
  ];
  var AD_BANNER_IDS = [
    "AdHeader",
    "AdContainer",
    "AD_Top",
    "homead",
    "ad-lead"
  ];
  var CSP_RESTRICTED_SITES = /* @__PURE__ */ new Set([
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
    "www.vivara.no"
  ]);

  // src/config/domain-aliases.ts
  var DOMAIN_ALIASES = {
    "nordicfeel.com": "nordicfeel.no",
    "www.nordicfeel.com": "www.nordicfeel.no",
    "lekmer.com": "lekmer.no",
    "www.lekmer.com": "lekmer.no",
    "lyko.com": "lyko.no",
    "www.lyko.com": "www.lyko.no",
    "storytel.com": "storytel.no",
    "www.storytel.com": "www.storytel.no",
    "beckmann-norway.com": "beckmann.no",
    "www.beckmann-norway.com": "beckmann.no",
    "nordicnest.no": "id.nordicnest.no",
    "www.nordicnest.no": "id.nordicnest.no",
    "dbjourney.com": "dbjourney.no",
    "www.dbjourney.com": "dbjourney.no",
    "bookbeat.com": "bookbeat.no",
    "www.bookbeat.com": "www.bookbeat.no",
    "www.oakley.com": "no.oakley.com",
    "www.viator.com": "www.viatorcom.no",
    "www.scandichotels.com": "www.scandichotels.no",
    "www.omio.com": "www.omio.no",
    "trip.com": "www.trip.com",
    "no.trip.com": "www.trip.com"
  };

  // src/config/services.ts
  var SERVICES_FALLBACK = {
    trumf: {
      id: "trumf",
      name: "Trumf",
      clickthroughUrl: "https://trumfnetthandel.no/cashback/{urlName}",
      reminderDomain: "trumfnetthandel.no",
      color: "#4D4DFF",
      defaultEnabled: true
    },
    remember: {
      id: "remember",
      name: "re:member",
      clickthroughUrl: "https://www.remember.no/reward/rabatt/{urlName}",
      reminderDomain: "remember.no",
      color: "#f28d00",
      defaultEnabled: false
    },
    dnb: {
      id: "dnb",
      name: "DNB",
      clickthroughUrl: "https://www.dnb.no/kundeprogram/fordeler/faste-rabatter",
      color: "#007272",
      defaultEnabled: false,
      type: "code"
    },
    obos: {
      id: "obos",
      name: "OBOS",
      color: "#0047ba",
      comingSoon: true
    },
    naf: {
      id: "naf",
      name: "NAF",
      color: "#ffd816",
      comingSoon: true
    },
    lofavor: {
      id: "lofavor",
      name: "LOfav\xF8r",
      color: "#ff0000",
      comingSoon: true
    }
  };
  var SERVICE_ORDER = ["trumf", "remember", "dnb", "obos", "naf", "lofavor"];
  function getDefaultEnabledServices(services = SERVICES_FALLBACK) {
    return Object.values(services).filter((s) => s.defaultEnabled).map((s) => s.id);
  }
  function isValidService(service) {
    return typeof service.name === "string" && service.name.length > 0 && typeof service.color === "string" && service.color.length > 0;
  }
  function mergeServices(feedServices, fallback = SERVICES_FALLBACK) {
    if (!feedServices) {
      return { ...fallback };
    }
    const merged = { ...fallback };
    for (const [id, service] of Object.entries(feedServices)) {
      const existing = merged[id] || {};
      const candidate = { ...existing, ...service, id };
      if (isValidService(candidate)) {
        merged[id] = candidate;
      } else {
        console.warn(`BonusVarsler: Skipping invalid service "${id}" - missing required fields`);
      }
    }
    return merged;
  }

  // src/core/settings.ts
  var MAX_SITE_POSITIONS = 100;
  function createDefaultSettings() {
    return {
      hiddenSites: /* @__PURE__ */ new Set(),
      blacklistedSites: /* @__PURE__ */ new Set(),
      theme: DEFAULT_THEME,
      startMinimized: false,
      position: DEFAULT_POSITION,
      sitePositions: {},
      enabledServices: null,
      setupComplete: false,
      setupShowCount: 0
    };
  }
  var Settings = class {
    cache;
    storage;
    currentHost;
    constructor(storage, currentHost) {
      this.cache = createDefaultSettings();
      this.storage = storage;
      this.currentHost = currentHost;
    }
    /**
     * Run version-based migrations
     */
    async runMigrations() {
      try {
        const storedVersion = await this.storage.get(STORAGE_KEYS.version, null);
        if (storedVersion !== CURRENT_VERSION) {
          const existingEnabledServices = await this.storage.get(
            STORAGE_KEYS.enabledServices,
            null
          );
          const legacyFeedData = await this.storage.get(LEGACY_KEYS.feedData_v3, null);
          const legacyFeedTime = await this.storage.get(LEGACY_KEYS.feedTime_v3, null);
          const legacyFeedDataV4 = await this.storage.get(LEGACY_KEYS.feedData_v4, null);
          const legacyFeedTimeV4 = await this.storage.get(LEGACY_KEYS.feedTime_v4, null);
          const isLegacyUser = existingEnabledServices === null && (legacyFeedData !== null || legacyFeedTime !== null || legacyFeedDataV4 !== null || legacyFeedTimeV4 !== null);
          const isExistingUser = storedVersion !== null || existingEnabledServices !== null || isLegacyUser;
          const keysToRemove = [
            STORAGE_KEYS.feedData,
            STORAGE_KEYS.feedTime,
            STORAGE_KEYS.hostIndex,
            LEGACY_KEYS.feedData_v3,
            LEGACY_KEYS.feedTime_v3,
            LEGACY_KEYS.hostIndex_v3,
            LEGACY_KEYS.feedData_v4,
            LEGACY_KEYS.feedTime_v4,
            LEGACY_KEYS.hostIndex_v4,
            STORAGE_KEYS.reminderShown
          ];
          await this.storage.remove(keysToRemove);
          if (isLegacyUser) {
            await this.storage.set(STORAGE_KEYS.enabledServices, ["trumf"]);
          }
          if (isExistingUser) {
            await this.storage.set(STORAGE_KEYS.setupComplete, true);
          }
          await this.storage.set(STORAGE_KEYS.version, CURRENT_VERSION);
          console.log("[BonusVarsler] Migrated to version", CURRENT_VERSION);
        }
      } catch (err) {
        console.error("[BonusVarsler] Settings migration failed:", err);
      }
    }
    /**
     * Load all settings from storage
     */
    async load() {
      await this.runMigrations();
      const hiddenSitesArray = await this.storage.get(STORAGE_KEYS.hiddenSites, []);
      this.cache.hiddenSites = new Set(hiddenSitesArray);
      const blacklistedSitesArray = await this.storage.get(STORAGE_KEYS.blacklistedSites, []);
      this.cache.blacklistedSites = new Set(blacklistedSitesArray);
      this.cache.theme = await this.storage.get(STORAGE_KEYS.theme, DEFAULT_THEME);
      this.cache.startMinimized = await this.storage.get(STORAGE_KEYS.startMinimized, false);
      this.cache.position = await this.storage.get(STORAGE_KEYS.position, DEFAULT_POSITION);
      this.cache.sitePositions = await this.storage.get(
        STORAGE_KEYS.sitePositions,
        {}
      );
      const storedServices = await this.storage.get(
        STORAGE_KEYS.enabledServices,
        null
      );
      this.cache.enabledServices = storedServices;
      this.cache.setupComplete = await this.storage.get(STORAGE_KEYS.setupComplete, false);
      this.cache.setupShowCount = await this.storage.get(STORAGE_KEYS.setupShowCount, 0);
    }
    // ==================
    // Hidden Sites
    // ==================
    getHiddenSites() {
      return this.cache.hiddenSites;
    }
    isSiteHidden(host) {
      const normalized = this.normalizeHost(host);
      return this.cache.hiddenSites.has(normalized);
    }
    async hideSite(host) {
      const normalized = this.normalizeHost(host);
      if (!this.cache.hiddenSites.has(normalized)) {
        this.cache.hiddenSites.add(normalized);
        await this.storage.set(STORAGE_KEYS.hiddenSites, [...this.cache.hiddenSites]);
      }
    }
    async resetHiddenSites() {
      this.cache.hiddenSites = /* @__PURE__ */ new Set();
      await this.storage.set(STORAGE_KEYS.hiddenSites, []);
    }
    // ==================
    // Blacklisted Sites
    // ==================
    normalizeHost(host) {
      let h = host.trim().toLowerCase();
      if (h.startsWith("www.")) {
        h = h.slice(4);
      }
      h = h.replace(/^\.+|\.+$/g, "");
      return h;
    }
    getBlacklistedSites() {
      return this.cache.blacklistedSites;
    }
    isSiteBlacklisted(host) {
      return this.cache.blacklistedSites.has(this.normalizeHost(host));
    }
    async blacklistSite(host) {
      const normalized = this.normalizeHost(host);
      if (!this.cache.blacklistedSites.has(normalized)) {
        this.cache.blacklistedSites.add(normalized);
        await this.storage.set(STORAGE_KEYS.blacklistedSites, [...this.cache.blacklistedSites]);
      }
    }
    async unblacklistSite(host) {
      const normalized = this.normalizeHost(host);
      if (this.cache.blacklistedSites.has(normalized)) {
        this.cache.blacklistedSites.delete(normalized);
        await this.storage.set(STORAGE_KEYS.blacklistedSites, [...this.cache.blacklistedSites]);
      }
    }
    async resetBlacklistedSites() {
      this.cache.blacklistedSites = /* @__PURE__ */ new Set();
      await this.storage.set(STORAGE_KEYS.blacklistedSites, []);
    }
    // ==================
    // Theme
    // ==================
    getTheme() {
      return this.cache.theme;
    }
    async setTheme(theme) {
      this.cache.theme = theme;
      await this.storage.set(STORAGE_KEYS.theme, theme);
    }
    // ==================
    // Start Minimized
    // ==================
    getStartMinimized() {
      return this.cache.startMinimized;
    }
    async setStartMinimized(value) {
      this.cache.startMinimized = value;
      await this.storage.set(STORAGE_KEYS.startMinimized, value);
    }
    // ==================
    // Position
    // ==================
    getPosition() {
      return this.cache.sitePositions[this.currentHost] || this.cache.position;
    }
    getDefaultPosition() {
      return this.cache.position;
    }
    async setDefaultPosition(position) {
      this.cache.position = position;
      await this.storage.set(STORAGE_KEYS.position, position);
    }
    async setPositionForSite(position) {
      this.cache.sitePositions[this.currentHost] = position;
      const hosts = Object.keys(this.cache.sitePositions);
      if (hosts.length > MAX_SITE_POSITIONS) {
        const toRemove = hosts.slice(0, hosts.length - MAX_SITE_POSITIONS);
        for (const host of toRemove) {
          delete this.cache.sitePositions[host];
        }
      }
      await this.storage.set(STORAGE_KEYS.sitePositions, this.cache.sitePositions);
    }
    // ==================
    // Enabled Services
    // ==================
    getEnabledServices() {
      return this.cache.enabledServices || getDefaultEnabledServices();
    }
    isServiceEnabled(serviceId) {
      return this.getEnabledServices().includes(serviceId);
    }
    async setServiceEnabled(serviceId, enabled) {
      const current = this.getEnabledServices();
      let updated;
      if (enabled && !current.includes(serviceId)) {
        updated = [...current, serviceId];
      } else if (!enabled && current.includes(serviceId)) {
        updated = current.filter((s) => s !== serviceId);
      } else {
        return;
      }
      this.cache.enabledServices = updated;
      await this.storage.set(STORAGE_KEYS.enabledServices, updated);
    }
    async setEnabledServices(services) {
      this.cache.enabledServices = services;
      await this.storage.set(STORAGE_KEYS.enabledServices, services);
    }
    // ==================
    // Setup Complete
    // ==================
    isSetupComplete() {
      return this.cache.setupComplete;
    }
    getSetupShowCount() {
      return this.cache.setupShowCount;
    }
    async setSetupComplete(complete) {
      this.cache.setupComplete = complete;
      await this.storage.set(STORAGE_KEYS.setupComplete, complete);
    }
    async incrementSetupShowCount() {
      this.cache.setupShowCount++;
      await this.storage.set(STORAGE_KEYS.setupShowCount, this.cache.setupShowCount);
    }
  };

  // src/core/feed.ts
  function isValidFeed(feed) {
    return feed !== null && typeof feed === "object" && "merchants" in feed && typeof feed.merchants === "object" && feed.merchants !== null;
  }
  function isUnifiedFeedFormat(feed) {
    return feed.services !== void 0 && typeof feed.services === "object";
  }
  var FeedManager = class {
    storage;
    fetcher;
    cachedFeed = null;
    services = { ...SERVICES_FALLBACK };
    constructor(storage, fetcher) {
      this.storage = storage;
      this.fetcher = fetcher;
    }
    /**
     * Get the service registry (merged from feed and fallback)
     */
    getServices() {
      return this.services;
    }
    /**
     * Get cached feed from storage
     */
    async getCachedFeed() {
      const storedTime = await this.storage.get(STORAGE_KEYS.feedTime, null);
      if (!storedTime) {
        return null;
      }
      const elapsed = Date.now() - storedTime;
      if (elapsed >= CONFIG.cacheDuration) {
        return null;
      }
      const storedData = await this.storage.get(STORAGE_KEYS.feedData, null);
      if (isValidFeed(storedData)) {
        this.updateServicesFromFeed(storedData);
        return storedData;
      }
      return null;
    }
    /**
     * Cache feed data to storage
     */
    async cacheFeed(data) {
      try {
        await this.storage.set(STORAGE_KEYS.feedData, data);
        await this.storage.set(STORAGE_KEYS.feedTime, Date.now());
        if (data.merchants) {
          await this.storage.set(STORAGE_KEYS.hostIndex, Object.keys(data.merchants));
        }
        this.updateServicesFromFeed(data);
      } catch {
      }
    }
    /**
     * Update service registry from feed data
     */
    updateServicesFromFeed(feed) {
      if (feed.services) {
        this.services = mergeServices(feed.services, SERVICES_FALLBACK);
      }
    }
    /**
     * Get feed (from cache or fetch)
     */
    async getFeed() {
      if (this.cachedFeed) {
        return this.cachedFeed;
      }
      const cached = await this.getCachedFeed();
      if (cached) {
        this.cachedFeed = cached;
        return cached;
      }
      const feed = await this.fetcher.fetchFeed(CONFIG.feedUrl, CONFIG.fallbackUrl);
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
    async isKnownMerchantHost(currentHost, domainAliases) {
      const hostIndex = await this.storage.get(STORAGE_KEYS.hostIndex, null);
      if (!hostIndex) {
        return null;
      }
      const hostSet = new Set(hostIndex);
      const noWww = currentHost.replace(/^www\./, "");
      if (hostSet.has(currentHost) || hostSet.has(noWww) || hostSet.has("www." + noWww)) {
        return true;
      }
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
  };

  // src/core/merchant-matching.ts
  function parseCashbackRate(description) {
    if (!description) return { value: 0, type: "percent", isVariable: false };
    const normalized = description.toLowerCase().trim();
    const isVariable = normalized.startsWith("opptil") || normalized.startsWith("opp til") || normalized.startsWith("up to") || /\d+\s*[-\u2013]\s*\d+/.test(normalized);
    const cleanDesc = description.replace(/^(opptil|opp til|up to)\s*/i, "").trim();
    const rangePercentMatch = cleanDesc.match(/(\d+[,.]?\d*)\s*[-\u2013]\s*(\d+[,.]?\d*)\s*%/);
    if (rangePercentMatch?.[2]) {
      const value = parseFloat(rangePercentMatch[2].replace(",", "."));
      return { value, type: "percent", isVariable };
    }
    const percentMatch = cleanDesc.match(/(\d+[,.]?\d*)\s*%/);
    if (percentMatch?.[1]) {
      const value = parseFloat(percentMatch[1].replace(",", "."));
      return { value, type: "percent", isVariable };
    }
    const fixedMatch = cleanDesc.match(/(\d+[,.]?\d*)\s*kr/i);
    if (fixedMatch?.[1]) {
      const value = parseFloat(fixedMatch[1].replace(",", "."));
      return { value, type: "fixed", isVariable };
    }
    return { value: 0, type: "percent", isVariable: false };
  }
  function compareCashbackRates(a, b, avgPurchaseAmount = 500) {
    if (a.type !== b.type) {
      const monetaryA = a.type === "percent" ? a.value / 100 * avgPurchaseAmount : a.value;
      const monetaryB = b.type === "percent" ? b.value / 100 * avgPurchaseAmount : b.value;
      if (monetaryA > monetaryB) return -1;
      if (monetaryA < monetaryB) return 1;
      if (a.type === "percent") return -1;
      return 1;
    }
    if (a.value > b.value) return -1;
    if (a.value < b.value) return 1;
    if (!a.isVariable && b.isVariable) return -1;
    if (a.isVariable && !b.isVariable) return 1;
    return 0;
  }
  function tryHost(merchants, host) {
    if (merchants[host]) {
      return merchants[host];
    }
    const noWww = host.replace(/^www\./, "");
    if (noWww !== host && merchants[noWww]) {
      return merchants[noWww];
    }
    if (!host.startsWith("www.")) {
      const withWww = "www." + host;
      if (merchants[withWww]) {
        return merchants[withWww];
      }
    }
    return null;
  }
  function findBestOffer(feed, currentHost, enabledServices, services = SERVICES_FALLBACK) {
    if (!feed?.merchants) {
      return null;
    }
    const { merchants } = feed;
    const isUnified = isUnifiedFeedFormat(feed);
    let merchant = tryHost(merchants, currentHost);
    if (!merchant) {
      const aliasedHost = DOMAIN_ALIASES[currentHost];
      if (aliasedHost) {
        merchant = tryHost(merchants, aliasedHost);
      }
    }
    if (!merchant) {
      const noWwwHost = currentHost.replace(/^www\./, "");
      const aliasedNoWww = DOMAIN_ALIASES[noWwwHost];
      if (aliasedNoWww) {
        merchant = tryHost(merchants, aliasedNoWww);
      }
    }
    if (!merchant) {
      return null;
    }
    if (isUnified && merchant.offers) {
      const availableOffers = merchant.offers.filter(
        (offer) => enabledServices.includes(offer.serviceId)
      );
      if (availableOffers.length === 0) {
        return null;
      }
      availableOffers.sort((a, b) => {
        const rateA = parseCashbackRate(a.cashbackDescription);
        const rateB = parseCashbackRate(b.cashbackDescription);
        return compareCashbackRates(rateA, rateB);
      });
      const bestOffer = availableOffers[0];
      if (!bestOffer) {
        return null;
      }
      const service2 = services[bestOffer.serviceId] || services.trumf;
      if (!service2) {
        return null;
      }
      return {
        merchant: {
          hostName: merchant.hostName,
          name: merchant.name
        },
        offer: bestOffer,
        service: service2,
        // Convenience accessors
        name: merchant.name,
        urlName: bestOffer.urlName,
        cashbackDescription: bestOffer.cashbackDescription,
        cashbackDetails: bestOffer.cashbackDetails || null
      };
    }
    const service = services.trumf;
    if (!service || !enabledServices.includes("trumf")) {
      return null;
    }
    return {
      merchant: {
        hostName: merchant.hostName,
        name: merchant.name
      },
      offer: {
        serviceId: "trumf",
        urlName: merchant.urlName || "",
        cashbackDescription: merchant.cashbackDescription || ""
      },
      service,
      // Convenience accessors
      name: merchant.name,
      urlName: merchant.urlName || "",
      cashbackDescription: merchant.cashbackDescription || "",
      cashbackDetails: null
    };
  }

  // src/main.ts
  function shouldBailOutEarly(sessionStorage, currentHost) {
    if (window.top !== window.self) return true;
    const pageVisitKey = `${PAGE_VISIT_COUNT_PREFIX}${currentHost}`;
    const currentVisits = parseInt(sessionStorage.get(pageVisitKey) ?? "0", 10);
    const newVisitCount = currentVisits + 1;
    sessionStorage.set(pageVisitKey, newVisitCount.toString());
    if (newVisitCount <= CONFIG.pageVisitsBeforeCooldown) {
      return false;
    }
    const messageShownKey = `${MESSAGE_SHOWN_KEY_PREFIX}${currentHost}`;
    const messageShownTime = sessionStorage.get(messageShownKey);
    if (messageShownTime) {
      const elapsed = Date.now() - parseInt(messageShownTime, 10);
      if (elapsed < CONFIG.messageDuration) return true;
    }
    return false;
  }
  function markMessageShown(sessionStorage, currentHost) {
    const messageShownKey = `${MESSAGE_SHOWN_KEY_PREFIX}${currentHost}`;
    sessionStorage.set(messageShownKey, Date.now().toString());
  }
  async function initialize(adapters, currentHost) {
    const { storage, fetcher, i18n } = adapters;
    const settings = new Settings(storage, currentHost);
    await settings.load();
    if (settings.isSiteHidden(currentHost) || settings.isSiteBlacklisted(currentHost)) {
      return { status: "blocked" };
    }
    const feedManager = new FeedManager(storage, fetcher);
    const isKnown = await feedManager.isKnownMerchantHost(currentHost, DOMAIN_ALIASES);
    if (isKnown === false) {
      return { status: "no-match", settings };
    }
    const feed = await feedManager.getFeed();
    if (!feed) {
      return { status: "no-match", settings };
    }
    const enabledServices = settings.getEnabledServices();
    const services = feedManager.getServices();
    const match = findBestOffer(feed, currentHost, enabledServices, services);
    if (!match) {
      return { status: "no-match", settings };
    }
    const lang = await storage.get(STORAGE_KEYS.language, "no");
    await i18n.loadMessages(lang);
    return { status: "match", settings, feedManager, match };
  }
  var DEFAULT_CASHBACK_PATHS = ["/cashback/", "/shop/", "/reward/"];
  function isOnCashbackPage(currentHost, pathname, enabledServices, services) {
    for (const serviceId of enabledServices) {
      const service = services[serviceId];
      if (!service?.reminderDomain) continue;
      const isServiceDomain = currentHost === service.reminderDomain || currentHost === "www." + service.reminderDomain;
      const patterns = service.cashbackPathPatterns ?? DEFAULT_CASHBACK_PATHS;
      const isCashbackPath = patterns.some((pattern) => pathname.startsWith(pattern));
      if (isServiceDomain && isCashbackPath) {
        return { isOnPage: true, service };
      }
    }
    return { isOnPage: false, service: null };
  }

  // src/ui/styles/base.css
  var base_default = `/**
 * Base CSS for BonusVarsler notifications
 * Shared styles for all notification types
 */

:host {
    all: initial;
    font-family: 'Segoe UI', system-ui, sans-serif;
    font-size: 15px;
    line-height: 1.6;
    --bg: #fff;
    --bg-transparent: rgba(255, 255, 255, 0.97);
    --bg-header: #f3f3f3;
    --border: #ececec;
    --text: #333;
    --text-muted: #666;
    --accent: #4D4DFF;
    --accent-hover: #3232ff;
    --shadow: rgba(0,0,0,0.3);
    --info-bg: #ccc;
    --btn-bg: #e8e8e8;
    --btn-bg-active: #4D4DFF;
    color: var(--text);
}

:host(.tbvl-dark) {
    --bg: #2a2a2a;
    --bg-transparent: rgba(42, 42, 42, 0.97);
    --bg-header: #363636;
    --border: #4a4a4a;
    --text: #e0e0e0;
    --text-muted: #a0a0a0;
    --accent: #8c8cff;
    --accent-hover: #7a7aff;
    --shadow: rgba(0,0,0,0.4);
    --info-bg: #5a5a5a;
    --btn-bg: #4a4a4a;
    --btn-bg-active: #8c8cff;
}

@media (prefers-color-scheme: dark) {
    :host(.tbvl-system) {
        --bg: #2a2a2a;
        --bg-transparent: rgba(42, 42, 42, 0.97);
        --bg-header: #363636;
        --border: #4a4a4a;
        --text: #e0e0e0;
        --text-muted: #a0a0a0;
        --accent: #8c8cff;
        --accent-hover: #7a7aff;
        --shadow: rgba(0,0,0,0.4);
        --info-bg: #5a5a5a;
        --btn-bg: #4a4a4a;
        --btn-bg-active: #8c8cff;
    }
}

:host *,
:host *::before,
:host *::after {
    all: revert;
    box-sizing: border-box;
    font-family: 'Segoe UI', system-ui, sans-serif !important;
    font-size: inherit;
    line-height: inherit;
    letter-spacing: normal;
    word-spacing: normal;
    text-transform: none;
    text-indent: 0;
    text-shadow: none;
    text-decoration: none;
    text-align: left;
    white-space: normal;
    font-style: normal;
    font-weight: normal;
    font-variant: normal;
    color: inherit;
    background: transparent;
    border: none;
    margin: 0;
    padding: 0;
    outline: none;
    vertical-align: baseline;
    float: none;
    clear: none;
    direction: ltr;
    visibility: visible;
    opacity: 1;
    filter: none;
    transform: none;
    pointer-events: auto;
}

/* Restore accessible focus indicators for keyboard users */
:host button:focus-visible,
:host a:focus-visible,
:host [tabindex]:focus-visible,
:host [role="button"]:focus-visible,
:host [role="switch"]:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
}

/* Container */
.container {
    position: fixed;
    z-index: 2147483647;
    width: 360px;
    max-width: calc(100vw - 40px);
    background: var(--bg);
    border-radius: 8px;
    box-shadow: 0 8px 24px var(--shadow);
    overflow: hidden;
    transition: top 0.3s ease, bottom 0.3s ease, left 0.3s ease, right 0.3s ease;
}

.container.animate-in {
    animation: slideIn 0.4s ease-out;
}

.container.dragging {
    transition: none;
    opacity: 0.9;
}

.container.snapping {
    transition: left 0.35s cubic-bezier(0.25, 0.46, 0.45, 0.94),
                top 0.35s cubic-bezier(0.25, 0.46, 0.45, 0.94);
}

/* Position classes */
.container.bottom-right { bottom: 20px; right: 20px; }
.container.bottom-left { bottom: 20px; left: 20px; }
.container.top-right { top: 20px; right: 20px; }
.container.top-left { top: 20px; left: 20px; }

@keyframes slideIn {
    from { opacity: 0; transform: translateY(40px); }
    to { opacity: 1; transform: translateY(0); }
}

/* Header */
.header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    background: var(--bg-header);
    border-bottom: 1px solid var(--border);
    user-select: none;
}

.logo {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 18px;
    font-weight: 700;
    color: var(--text);
    letter-spacing: -0.5px;
}

.logo-icon {
    display: inline-block;
    width: 32px;
    height: 32px;
    flex-shrink: 0;
    object-fit: contain;
}

.header-right {
    display: flex;
    align-items: center;
}

/* Close button */
.close-btn {
    width: 22px;
    height: 22px;
    cursor: pointer;
    transition: transform 0.2s;
    position: relative;
    border: none;
    background: transparent;
    padding: 0;
}

.close-btn::before,
.close-btn::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    width: 16px;
    height: 2px;
    background: var(--text-muted);
    border-radius: 1px;
}

.close-btn::before {
    transform: translate(-50%, -50%) rotate(45deg);
}

.close-btn::after {
    transform: translate(-50%, -50%) rotate(-45deg);
}

.close-btn:hover {
    transform: scale(1.15);
}

.close-btn:hover::before,
.close-btn:hover::after {
    background: var(--text);
}

/* Body */
.body {
    padding: 16px;
    max-height: 500px;
    opacity: 1;
    overflow-y: auto;
    transition: max-height 0.3s ease, opacity 0.2s ease, padding 0.3s ease;
}
`;

  // src/ui/styles/notification.css
  var notification_default = `/**
 * Main notification CSS
 * Extends base.css for the main cashback notification
 */

/* Settings button */
.settings-btn {
    width: 20px;
    height: 20px;
    cursor: pointer;
    opacity: 0.6;
    transition: opacity 0.2s, transform 0.2s;
    margin-right: 12px;
}

.settings-btn:hover {
    opacity: 1;
    transform: rotate(30deg);
}

:host(.tbvl-dark) .settings-btn {
    filter: invert(1);
}

@media (prefers-color-scheme: dark) {
    :host(.tbvl-system) .settings-btn {
        filter: invert(1);
    }
}

/* Minimize button */
.minimize-btn {
    width: 20px;
    height: 20px;
    cursor: pointer;
    opacity: 0.6;
    transition: opacity 0.2s ease, transform 0.2s ease;
    margin-right: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
}

.minimize-btn:hover {
    opacity: 1;
}

.minimize-btn::before {
    content: '';
    width: 12px;
    height: 2px;
    background: var(--text-muted);
    border-radius: 1px;
}

.minimize-btn:hover::before {
    background: var(--text);
}

/* Cashback display */
.cashback {
    display: block;
    font-size: 20px;
    font-weight: 700;
    color: var(--accent);
    margin-bottom: 6px;
}

.cashback.has-details {
    cursor: pointer;
    position: relative;
}

/* Cashback tooltip */
.cashback-tooltip {
    display: none;
    position: fixed;
    width: 320px;
    max-height: 70vh;
    overflow-y: auto;
    padding: 12px;
    background: var(--bg-transparent, rgba(30, 30, 30, 0.97));
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    font-size: 13px;
    font-weight: 400;
    color: var(--text);
    z-index: 10;
    white-space: normal;
    line-height: 1.4;
}

.cashback.has-details:hover .cashback-tooltip,
.cashback.has-details.tooltip-visible .cashback-tooltip {
    display: block;
}

.cashback-tooltip-item {
    display: flex;
    gap: 8px;
    margin-bottom: 8px;
}

.cashback-tooltip-item:last-child {
    margin-bottom: 0;
}

.cashback-tooltip-value {
    font-weight: 600;
    color: var(--accent);
    white-space: nowrap;
    min-width: 45px;
}

.cashback-tooltip-desc {
    flex: 1;
}

/* Subtitle and reminder */
.subtitle {
    display: block;
    font-size: 16px;
    font-weight: 600;
    margin-bottom: 10px;
    color: var(--text);
}

.reminder {
    margin: 0 0 6px;
    font-weight: 500;
    color: var(--text);
}

/* Checklist */
.checklist {
    list-style: decimal;
    margin: 8px 0 0 20px;
    padding: 0;
    font-size: 13px;
    color: var(--text);
}

.checklist li {
    display: list-item;
    margin: 6px 0;
}

/* Action button */
.action-btn {
    display: block;
    margin: 16px auto 0;
    padding: 12px 24px;
    background: var(--accent);
    color: #fff;
    text-decoration: none;
    border-radius: 6px;
    font-weight: 600;
    text-align: center;
    cursor: pointer;
    transition: background 0.2s;
}

.action-btn:hover {
    background: var(--accent-hover);
}

/* Adblock warning state */
.action-btn.adblock {
    background: #c50000;
    animation: pulse 0.7s infinite alternate ease-in-out;
    cursor: default;
    position: relative;
    padding-right: 36px;
    border: 2px solid #900;
}

.action-btn.adblock::before {
    content: "\u26A0 ";
}

@keyframes pulse {
    from { transform: scale(1); }
    to { transform: scale(1.03); }
}

@keyframes shake {
    0%, 100% { transform: translateX(0); }
    25% { transform: translateX(-5px); }
    75% { transform: translateX(5px); }
}

/* Recheck icon */
.recheck-icon {
    display: none;
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    font-size: 18px;
    cursor: pointer;
    pointer-events: auto;
    opacity: 0.8;
    transition: opacity 0.2s, transform 0.2s;
}

.recheck-icon:hover {
    opacity: 1;
}

.action-btn.adblock .recheck-icon {
    display: inline-block;
}

.recheck-icon.spinning {
    animation: spin 0.8s linear infinite;
}

@keyframes spin {
    from { transform: translateY(-50%) rotate(0deg); }
    to { transform: translateY(-50%) rotate(360deg); }
}

/* Code button */
.action-btn.has-code {
    position: relative;
    padding-right: 40px;
}

.copy-icon {
    position: absolute;
    right: 12px;
    top: 50%;
    transform: translateY(-50%);
    font-size: 14px;
    cursor: pointer;
    opacity: 0.7;
    transition: opacity 0.2s;
}

.copy-icon:hover {
    opacity: 1;
}

.copy-icon.copied {
    opacity: 1;
}

/* Hide site link */
.hide-site {
    display: block;
    margin-top: 12px;
    font-size: 11px;
    color: var(--text-muted);
    text-align: center;
    cursor: pointer;
    text-decoration: none;
    transition: color 0.2s;
}

.hide-site:hover {
    color: var(--text);
    text-decoration: underline;
}

/* Info link */
.info-link {
    position: absolute;
    bottom: 8px;
    right: 8px;
    width: 16px;
    height: 16px;
    font-size: 9px;
    font-weight: bold;
    color: var(--text);
    background: var(--info-bg);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    text-decoration: none;
    opacity: 0.2;
    cursor: pointer;
    transition: opacity 0.2s ease;
}

.info-link:hover {
    opacity: 0.45;
}

/* Confirmation state */
.confirmation {
    text-align: center;
    padding: 8px 0;
    color: var(--text);
}

/* Settings panel */
.settings {
    display: none;
}

.settings.active {
    display: block;
}

.content.hidden {
    display: none;
}

.settings-title {
    font-size: 16px;
    font-weight: 600;
    margin-bottom: 16px;
}

:host(.tbvl-dark) .settings-title {
    color: #fff;
}

@media (prefers-color-scheme: dark) {
    :host(.tbvl-system) .settings-title {
        color: #fff;
    }
}

.setting-row {
    margin-bottom: 16px;
}

.setting-label {
    display: block;
    font-size: 13px;
    color: var(--text-muted);
    margin-bottom: 8px;
}

.settings-grid {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 12px 16px;
    align-items: start;
    margin-bottom: 16px;
}

.settings-grid .setting-row {
    margin-bottom: 0;
}

.settings-grid .setting-row:nth-child(2) {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
}

.settings-grid .setting-label {
    margin-bottom: 6px;
}

/* Theme buttons */
.theme-buttons {
    display: flex;
    gap: 8px;
}

.theme-btn {
    flex: 1;
    padding: 8px 12px;
    background: var(--btn-bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    font-size: 13px;
    cursor: pointer;
    transition: all 0.2s;
    text-align: center;
}

.theme-btn:hover {
    border-color: var(--accent);
}

.theme-btn.active {
    background: var(--btn-bg-active);
    color: #fff;
    border-color: var(--btn-bg-active);
}

/* Position buttons */
.position-buttons {
    flex-wrap: wrap;
    width: 80px;
}

.position-buttons .theme-btn {
    flex: 0 0 calc(50% - 4px);
    padding: 6px;
    font-size: 16px;
}

/* Settings back link */
.settings-back {
    display: inline-block;
    margin-top: 12px;
    font-size: 13px;
    color: var(--accent);
    cursor: pointer;
    text-decoration: none;
}

.settings-back:hover {
    text-decoration: underline;
}

/* Hidden sites info */
.hidden-sites-info {
    font-size: 12px;
    color: var(--text-muted);
    margin-top: 8px;
}

.reset-hidden {
    font-size: 12px;
    color: var(--accent);
    cursor: pointer;
    text-decoration: none;
}

.reset-hidden:hover {
    text-decoration: underline;
}

/* Toggle switch */
.toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
}

.toggle-switch {
    position: relative;
    width: 44px;
    height: 24px;
    background: var(--btn-bg);
    border: 1px solid var(--border);
    border-radius: 12px;
    cursor: pointer;
    transition: background 0.2s, border-color 0.2s;
    flex-shrink: 0;
}

.toggle-switch::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 18px;
    height: 18px;
    background: var(--text-muted);
    border-radius: 50%;
    transition: transform 0.2s, background 0.2s;
}

.toggle-switch.active {
    background: var(--btn-bg-active);
    border-color: var(--btn-bg-active);
}

.toggle-switch.active::after {
    transform: translateX(20px);
    background: #fff;
}

/* Service toggle rows */
.service-toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 0;
}

.service-toggle-row:first-child {
    padding-top: 0;
}

.service-info {
    display: flex;
    align-items: center;
    gap: 8px;
}

.service-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
}

.service-name {
    font-size: 14px;
    color: var(--text);
}

.coming-soon {
    font-size: 12px;
    color: var(--text-muted);
    margin-left: 4px;
}

/* Minimized state */
.container.minimized {
    width: auto;
    min-width: 270px;
    cursor: pointer;
}

.container.minimized .body {
    max-height: 0;
    opacity: 0;
    padding: 0 16px;
}

.container.minimized .info-link {
    opacity: 0;
    pointer-events: none;
}

/* Cashback badge for minimized state */
.cashback-mini {
    font-weight: 700;
    font-size: 15px;
    color: var(--accent);
    margin-left: auto;
    padding: 0 16px;
    opacity: 0;
    max-width: 0;
    height: 0;
    overflow: hidden;
    text-align: center;
    transition: opacity 0.2s ease, max-width 0.3s ease, height 0.3s ease;
}

.container.minimized .cashback-mini {
    opacity: 1;
    max-width: 150px;
    height: auto;
}

.container.minimized .settings-btn,
.container.minimized .minimize-btn {
    opacity: 0;
    pointer-events: none;
    width: 0;
    margin: 0;
    overflow: hidden;
}

/* Mobile responsive */
@media (max-width: 700px) {
    .checklist { display: none; }
    .reminder { display: none; }
}
`;

  // src/ui/styles/reminder.css
  var reminder_default = "/**\n * Reminder notification CSS\n * Extends base.css for the reminder notification on cashback portal pages\n */\n\n/* Title */\n.title {\n    display: block;\n    font-size: 16px;\n    font-weight: 600;\n    margin-bottom: 10px;\n    color: var(--accent);\n}\n\n/* Message */\n.message {\n    margin: 0 0 12px;\n    color: var(--text);\n}\n\n/* Tip */\n.tip {\n    font-size: 13px;\n    color: var(--text-muted);\n    margin: 0;\n}\n\n/* Minimize button */\n.minimize-btn {\n    width: 20px;\n    height: 20px;\n    cursor: pointer;\n    opacity: 0.6;\n    transition: opacity 0.2s ease, transform 0.2s ease;\n    margin-right: 12px;\n    display: flex;\n    align-items: center;\n    justify-content: center;\n}\n\n.minimize-btn:hover {\n    opacity: 1;\n}\n\n.minimize-btn::before {\n    content: '';\n    width: 12px;\n    height: 2px;\n    background: var(--text-muted);\n    border-radius: 1px;\n}\n\n.minimize-btn:hover::before {\n    background: var(--text);\n}\n\n/* Minimized state */\n.container {\n    transition: width 0.3s ease, min-width 0.3s ease;\n}\n\n.container.minimized {\n    width: auto;\n    min-width: 270px;\n    cursor: pointer;\n}\n\n.container.minimized .body {\n    max-height: 0;\n    opacity: 0;\n    padding: 0 16px;\n}\n\n/* Reminder badge for minimized state */\n.reminder-mini {\n    font-weight: 700;\n    font-size: 16px;\n    color: var(--accent);\n    margin-left: auto;\n    padding: 0 16px;\n    opacity: 0;\n    max-width: 0;\n    overflow: hidden;\n    text-align: center;\n    transition: opacity 0.2s ease, max-width 0.3s ease;\n}\n\n.container.minimized .reminder-mini {\n    opacity: 1;\n    max-width: 50px;\n}\n\n.container.minimized .minimize-btn {\n    opacity: 0;\n    pointer-events: none;\n    width: 0;\n    margin: 0;\n    overflow: hidden;\n}\n";

  // src/ui/styles/service-selector.css
  var service_selector_default = "/**\n * Service selector CSS\n * Extends base.css for the first-run service selector\n */\n\n.header {\n    cursor: default;\n}\n\n.settings-title {\n    font-size: 16px;\n    font-weight: 600;\n    margin-bottom: 16px;\n    color: var(--text);\n}\n\n.service-toggle-row {\n    display: flex;\n    align-items: center;\n    justify-content: space-between;\n    padding: 8px 0;\n}\n\n.service-toggle-row:first-child {\n    padding-top: 0;\n}\n\n.service-info {\n    display: flex;\n    align-items: center;\n    gap: 8px;\n}\n\n.service-dot {\n    width: 10px;\n    height: 10px;\n    border-radius: 50%;\n    flex-shrink: 0;\n}\n\n.service-name {\n    font-size: 14px;\n    color: var(--text);\n}\n\n.coming-soon {\n    font-size: 12px;\n    color: var(--text-muted);\n    margin-left: 4px;\n}\n\n.toggle-switch {\n    position: relative;\n    width: 44px;\n    height: 24px;\n    background: var(--btn-bg);\n    border: 1px solid var(--border);\n    border-radius: 12px;\n    cursor: pointer;\n    transition: background 0.2s, border-color 0.2s;\n    flex-shrink: 0;\n}\n\n.toggle-switch::after {\n    content: '';\n    position: absolute;\n    top: 2px;\n    left: 2px;\n    width: 18px;\n    height: 18px;\n    background: var(--text-muted);\n    border-radius: 50%;\n    transition: transform 0.2s, background 0.2s;\n}\n\n.toggle-switch.active {\n    background: var(--btn-bg-active);\n    border-color: var(--btn-bg-active);\n}\n\n.toggle-switch.active::after {\n    transform: translateX(20px);\n    background: var(--accent-contrast, #fff);\n}\n\n@keyframes shake {\n    0%, 100% { transform: translateX(0); }\n    20% { transform: translateX(-3px); }\n    40% { transform: translateX(3px); }\n    60% { transform: translateX(-3px); }\n    80% { transform: translateX(3px); }\n}\n\n.toggle-switch.shake {\n    animation: shake 0.3s ease-in-out;\n}\n\n.action-btn {\n    display: block;\n    margin: 20px auto 0;\n    padding: 12px 24px;\n    background: var(--accent);\n    color: #fff;\n    text-decoration: none;\n    border-radius: 6px;\n    font-weight: 600;\n    text-align: center;\n    cursor: pointer;\n    transition: background 0.2s;\n    max-width: 200px;\n    border: none;\n}\n\n.action-btn:hover {\n    background: var(--accent-hover);\n}\n";

  // src/ui/styles/index.ts
  function getNotificationStyles() {
    return base_default + notification_default;
  }
  function getReminderStyles() {
    return base_default + reminder_default;
  }
  function getServiceSelectorStyles() {
    return base_default + service_selector_default;
  }

  // src/ui/components/shadow-host.ts
  function createShadowHost() {
    const shadowHost = document.createElement("div");
    shadowHost.style.cssText = "all:initial !important;position:fixed !important;bottom:0 !important;right:0 !important;z-index:2147483647 !important;display:block !important;visibility:visible !important;opacity:1 !important;pointer-events:auto !important;";
    return shadowHost;
  }
  function applyThemeClass(shadowHost, theme) {
    shadowHost.className = `tbvl-${theme}`;
  }
  function applyServiceColor(shadowHost, color) {
    shadowHost.style.setProperty("--accent", color);
    shadowHost.style.setProperty("--btn-bg-active", color);
    const hoverColor = color.replace(
      /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i,
      (_, r, g, b) => {
        const darken = (hex) => Math.max(0, parseInt(hex, 16) - 30).toString(16).padStart(2, "0");
        return `#${darken(r)}${darken(g)}${darken(b)}`;
      }
    );
    shadowHost.style.setProperty("--accent-hover", hoverColor);
  }
  function injectStyles(shadowRoot, css) {
    const styleEl = document.createElement("style");
    styleEl.textContent = css;
    shadowRoot.appendChild(styleEl);
  }

  // icons/icon-64.png
  var icon_64_default = "data:image/png;base64,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";

  // icons/icon-64-remember.png
  var icon_64_remember_default = "data:image/png;base64,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";

  // icons/icon-64-dnb.png
  var icon_64_dnb_default = "data:image/png;base64,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";

  // src/ui/components/icons.ts
  var SERVICE_LOGO_ICONS = {
    trumf: icon_64_default,
    remember: icon_64_remember_default,
    dnb: icon_64_dnb_default
  };
  var SETTINGS_ICON_URI = "data:image/svg+xml," + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>'
  );
  function getLogoIconForService(service) {
    return SERVICE_LOGO_ICONS[service] ?? icon_64_default;
  }

  // src/ui/components/draggable.ts
  var DRAG_THRESHOLD = 5;
  var SNAPPING_DURATION_MS = 350;
  function makeCornerDraggable(container, onPositionChange) {
    let isDragging = false;
    let hasMoved = false;
    let startX;
    let startY;
    let startLeft;
    let startTop;
    function getContainerRect() {
      return container.getBoundingClientRect();
    }
    function onDragStart(e) {
      const target = e.target;
      if (target.closest("button, a, .settings-btn, .minimize-btn, .close-btn")) {
        return;
      }
      const isMinimized = container.classList.contains("minimized");
      if (!isMinimized && !target.closest(".header")) {
        return;
      }
      isDragging = true;
      hasMoved = false;
      const rect = getContainerRect();
      startLeft = rect.left;
      startTop = rect.top;
      if (e.type === "touchstart") {
        const touch = e.touches[0];
        if (touch) {
          startX = touch.clientX;
          startY = touch.clientY;
        }
      } else {
        startX = e.clientX;
        startY = e.clientY;
      }
    }
    function onDragMove(e) {
      if (!isDragging) return;
      let clientX;
      let clientY;
      if (e.type === "touchmove") {
        const touch = e.touches[0];
        if (touch) {
          clientX = touch.clientX;
          clientY = touch.clientY;
        } else {
          return;
        }
      } else {
        clientX = e.clientX;
        clientY = e.clientY;
      }
      const deltaX = clientX - startX;
      const deltaY = clientY - startY;
      if (!hasMoved) {
        if (Math.abs(deltaX) < DRAG_THRESHOLD && Math.abs(deltaY) < DRAG_THRESHOLD) {
          return;
        }
        hasMoved = true;
        container.classList.add("dragging");
        container.classList.remove("bottom-right", "bottom-left", "top-right", "top-left");
        container.style.left = startLeft + "px";
        container.style.top = startTop + "px";
        container.style.right = "auto";
        container.style.bottom = "auto";
      }
      e.preventDefault();
      container.style.left = startLeft + deltaX + "px";
      container.style.top = startTop + deltaY + "px";
    }
    function onDragEnd() {
      if (!isDragging) return;
      isDragging = false;
      if (!hasMoved) {
        return;
      }
      container.classList.remove("dragging");
      const rect = getContainerRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const isRight = centerX > viewportWidth / 2;
      const isBottom = centerY > viewportHeight / 2;
      let position;
      if (isBottom && isRight) position = "bottom-right";
      else if (isBottom && !isRight) position = "bottom-left";
      else if (!isBottom && isRight) position = "top-right";
      else position = "top-left";
      const margin = 20;
      const targetLeft = isRight ? viewportWidth - rect.width - margin : margin;
      const targetTop = isBottom ? viewportHeight - rect.height - margin : margin;
      container.classList.add("snapping");
      container.style.left = targetLeft + "px";
      container.style.top = targetTop + "px";
      setTimeout(() => {
        container.classList.remove("snapping");
        container.style.left = "";
        container.style.top = "";
        container.style.right = "";
        container.style.bottom = "";
        container.classList.add(position);
      }, SNAPPING_DURATION_MS);
      onPositionChange(position);
    }
    function onClickCapture(e) {
      if (hasMoved) {
        e.stopPropagation();
        hasMoved = false;
      }
    }
    container.addEventListener("mousedown", onDragStart);
    document.addEventListener("mousemove", onDragMove);
    document.addEventListener("mouseup", onDragEnd);
    container.addEventListener("click", onClickCapture, true);
    container.addEventListener("touchstart", onDragStart, { passive: true });
    document.addEventListener("touchmove", onDragMove, { passive: false });
    document.addEventListener("touchend", onDragEnd);
    return function cleanup() {
      container.removeEventListener("mousedown", onDragStart);
      document.removeEventListener("mousemove", onDragMove);
      document.removeEventListener("mouseup", onDragEnd);
      container.removeEventListener("click", onClickCapture, true);
      container.removeEventListener("touchstart", onDragStart);
      document.removeEventListener("touchmove", onDragMove);
      document.removeEventListener("touchend", onDragEnd);
    };
  }

  // src/core/adblock-detection.ts
  function isCspRestrictedSite(currentHost) {
    if (CSP_RESTRICTED_SITES.has(currentHost)) return true;
    return document.querySelector('meta[http-equiv="Content-Security-Policy"]') !== null;
  }
  async function checkUrlBlocked(fetcher, url) {
    return fetcher.checkUrlBlocked(url);
  }
  async function checkBannerIds() {
    const container = document.createElement("div");
    container.style.cssText = "position:absolute;left:-9999px;top:-9999px;";
    AD_BANNER_IDS.forEach((id) => {
      const div = document.createElement("div");
      div.id = id;
      div.innerHTML = "&nbsp;";
      container.appendChild(div);
    });
    document.body.appendChild(container);
    await new Promise((resolve) => setTimeout(resolve, 100));
    let blocked = false;
    AD_BANNER_IDS.forEach((id) => {
      const elem = document.getElementById(id);
      if (!elem || elem.offsetHeight === 0 || elem.offsetParent === null) {
        blocked = true;
      }
    });
    container.remove();
    return blocked;
  }
  function withTimeout(promise, ms) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), ms))
    ]);
  }
  async function detectAdblock(fetcher, currentHost) {
    const skipUrlChecks = isCspRestrictedSite(currentHost);
    try {
      const checks = await withTimeout(
        Promise.all([
          ...skipUrlChecks ? [] : AD_TEST_URLS.map((url) => checkUrlBlocked(fetcher, url)),
          checkBannerIds()
        ]),
        CONFIG.adblockTimeout
      );
      return checks.some((blocked) => blocked);
    } catch {
      return false;
    }
  }

  // src/ui/views/notification.ts
  function createNotification(options) {
    const { match, settings, services, i18n, fetcher, sessionStorage, currentHost, onClose } = options;
    const service = match.service;
    const shadowHost = createShadowHost();
    document.body.appendChild(shadowHost);
    const shadowRoot = shadowHost.attachShadow({ mode: "open" });
    injectStyles(shadowRoot, getNotificationStyles());
    const container = document.createElement("div");
    container.className = `container ${settings.getPosition()}`;
    container.setAttribute("role", "dialog");
    container.setAttribute("aria-label", i18n.getMessage("ariaNotificationLabel"));
    applyThemeClass(shadowHost, settings.getTheme());
    if (service.color) {
      applyServiceColor(shadowHost, service.color);
    }
    const header = createHeader(service, i18n);
    const { settingsBtn, minimizeBtn, closeBtn, headerRight } = createHeaderControls(
      match.cashbackDescription,
      i18n
    );
    header.appendChild(headerRight);
    const body = document.createElement("div");
    body.className = "body";
    const content = document.createElement("div");
    content.className = "content";
    const cashback = createCashbackDisplay(match, container);
    const subtitle = document.createElement("span");
    subtitle.className = "subtitle";
    subtitle.textContent = i18n.getMessage("serviceBonusAt", [
      service.name,
      match.name || i18n.getMessage("thisStore")
    ]);
    const reminder = document.createElement("p");
    reminder.className = "reminder";
    reminder.textContent = i18n.getMessage("rememberTo");
    const checklist = createChecklist(service, i18n);
    const { actionBtn, recheckIcon } = createActionButton(match, service, i18n, sessionStorage, currentHost, content);
    const hideSiteLink = document.createElement("span");
    hideSiteLink.className = "hide-site";
    hideSiteLink.textContent = i18n.getMessage("dontShowOnThisSite");
    hideSiteLink.setAttribute("role", "button");
    hideSiteLink.setAttribute("tabindex", "0");
    hideSiteLink.setAttribute("aria-label", i18n.getMessage("dontShowOnThisSite"));
    content.appendChild(cashback);
    content.appendChild(subtitle);
    content.appendChild(reminder);
    content.appendChild(checklist);
    content.appendChild(actionBtn);
    content.appendChild(hideSiteLink);
    body.appendChild(content);
    const settingsPanel = createSettingsPanel(settings, services, i18n, shadowHost, container);
    body.appendChild(settingsPanel);
    const infoLink = document.createElement("a");
    infoLink.className = "info-link";
    infoLink.href = "https://github.com/kristofferR/BonusVarsler";
    infoLink.target = "_blank";
    infoLink.rel = "noopener noreferrer";
    infoLink.textContent = "i";
    infoLink.title = i18n.getMessage("aboutExtension");
    container.appendChild(header);
    container.appendChild(body);
    container.appendChild(infoLink);
    shadowRoot.appendChild(container);
    if (settings.getStartMinimized()) {
      container.classList.add("minimized");
    }
    let draggableCleanup = null;
    function closeNotification() {
      draggableCleanup?.();
      shadowHost.remove();
      document.removeEventListener("keydown", handleKeydown);
      onClose?.();
    }
    function handleKeydown(e) {
      if (e.key === "Escape") {
        closeNotification();
      }
    }
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeNotification();
    });
    document.addEventListener("keydown", handleKeydown);
    const openSettings = (e) => {
      e.stopPropagation();
      content.classList.add("hidden");
      settingsPanel.classList.add("active");
    };
    settingsBtn.addEventListener("click", openSettings);
    settingsBtn.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openSettings(e);
      }
    });
    minimizeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      container.classList.add("minimized");
    });
    container.addEventListener("click", (e) => {
      const clickedHeader = e.target.closest(".header");
      if (container.classList.contains("minimized")) {
        container.classList.remove("minimized");
      } else if (clickedHeader) {
        container.classList.add("minimized");
      }
    });
    const handleHideSite = async () => {
      await settings.hideSite(currentHost);
      closeNotification();
    };
    hideSiteLink.addEventListener("click", handleHideSite);
    hideSiteLink.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleHideSite();
      }
    });
    if (service.type !== "code") {
      const originalHref = actionBtn.getAttribute("href") || "";
      const originalText = actionBtn.childNodes[0]?.textContent || "";
      const handleRecheck = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (actionBtn.childNodes[0]) {
          actionBtn.childNodes[0].textContent = i18n.getMessage("checkingAdblock");
        }
        recheckIcon.classList.add("spinning");
        try {
          const isBlocked = await detectAdblock(fetcher, currentHost);
          if (isBlocked) {
            actionBtn.classList.add("adblock");
            if (actionBtn.childNodes[0]) {
              actionBtn.childNodes[0].textContent = i18n.getMessage("adblockerDetected");
            }
            actionBtn.removeAttribute("href");
            actionBtn.removeAttribute("target");
          } else {
            actionBtn.classList.remove("adblock");
            actionBtn.style.animation = "";
            if (actionBtn.childNodes[0]) {
              actionBtn.childNodes[0].textContent = originalText;
            }
            actionBtn.setAttribute("href", originalHref);
            actionBtn.setAttribute("target", "_blank");
          }
        } catch {
          actionBtn.classList.remove("adblock");
          actionBtn.style.animation = "";
          if (actionBtn.childNodes[0]) {
            actionBtn.childNodes[0].textContent = originalText;
          }
          actionBtn.setAttribute("href", originalHref);
          actionBtn.setAttribute("target", "_blank");
        } finally {
          recheckIcon.classList.remove("spinning");
        }
      };
      recheckIcon.addEventListener("click", handleRecheck);
      recheckIcon.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          handleRecheck(e);
        }
      });
      detectAdblock(fetcher, currentHost).then((isBlocked) => {
        if (isBlocked) {
          actionBtn.classList.add("adblock");
          if (actionBtn.childNodes[0]) {
            actionBtn.childNodes[0].textContent = i18n.getMessage("adblockerDetected");
          }
          actionBtn.removeAttribute("href");
          actionBtn.removeAttribute("target");
        }
      }).catch(() => {
      });
    }
    draggableCleanup = makeCornerDraggable(container, async (position) => {
      await settings.setPositionForSite(position);
    });
    return shadowHost;
  }
  function createHeader(service, _i18n) {
    const header = document.createElement("div");
    header.className = "header";
    const logo = document.createElement("div");
    logo.className = "logo";
    const logoIcon = document.createElement("img");
    logoIcon.className = "logo-icon";
    logoIcon.src = getLogoIconForService(service.id);
    logoIcon.alt = "";
    const logoText = document.createElement("span");
    logoText.textContent = "BonusVarsler";
    logo.appendChild(logoIcon);
    logo.appendChild(logoText);
    header.appendChild(logo);
    return header;
  }
  function createHeaderControls(cashbackText, i18n) {
    const headerRight = document.createElement("div");
    headerRight.className = "header-right";
    const cashbackMini = document.createElement("span");
    cashbackMini.className = "cashback-mini";
    cashbackMini.textContent = cashbackText;
    const settingsBtn = document.createElement("img");
    settingsBtn.className = "settings-btn";
    settingsBtn.src = SETTINGS_ICON_URI;
    settingsBtn.alt = i18n.getMessage("settings");
    settingsBtn.setAttribute("role", "button");
    settingsBtn.setAttribute("tabindex", "0");
    settingsBtn.setAttribute("aria-label", i18n.getMessage("settings"));
    const minimizeBtn = document.createElement("button");
    minimizeBtn.className = "minimize-btn";
    minimizeBtn.setAttribute("aria-label", i18n.getMessage("ariaMinimize"));
    const closeBtn = document.createElement("button");
    closeBtn.className = "close-btn";
    closeBtn.setAttribute("aria-label", i18n.getMessage("ariaClose"));
    headerRight.appendChild(cashbackMini);
    headerRight.appendChild(settingsBtn);
    headerRight.appendChild(minimizeBtn);
    headerRight.appendChild(closeBtn);
    return { cashbackMini, settingsBtn, minimizeBtn, closeBtn, headerRight };
  }
  function createCashbackDisplay(match, container) {
    const cashback = document.createElement("span");
    cashback.className = "cashback";
    cashback.textContent = match.cashbackDescription || "";
    if (match.cashbackDetails && match.cashbackDetails.length > 1) {
      cashback.classList.add("has-details");
      const tooltip = document.createElement("div");
      tooltip.className = "cashback-tooltip";
      for (const detail of match.cashbackDetails) {
        const item = document.createElement("div");
        item.className = "cashback-tooltip-item";
        const value = document.createElement("span");
        value.className = "cashback-tooltip-value";
        value.textContent = detail.type === "PERCENTAGE" ? `${detail.value}%` : `${detail.value} kr`;
        const desc = document.createElement("span");
        desc.className = "cashback-tooltip-desc";
        desc.textContent = detail.description || "";
        item.appendChild(value);
        item.appendChild(desc);
        tooltip.appendChild(item);
      }
      cashback.appendChild(tooltip);
      const positionTooltip = () => {
        const containerRect = container.getBoundingClientRect();
        const isRightSide = container.classList.contains("bottom-right") || container.classList.contains("top-right");
        const bottom = window.innerHeight - containerRect.bottom;
        tooltip.style.bottom = `${bottom}px`;
        tooltip.style.top = "auto";
        if (isRightSide) {
          tooltip.style.right = `${window.innerWidth - containerRect.left + 12}px`;
          tooltip.style.left = "auto";
        } else {
          tooltip.style.left = `${containerRect.right + 12}px`;
          tooltip.style.right = "auto";
        }
        const maxHeight = containerRect.bottom - 20;
        tooltip.style.maxHeight = `${Math.min(maxHeight, window.innerHeight * 0.7)}px`;
      };
      cashback.addEventListener("mouseenter", positionTooltip);
      cashback.addEventListener("click", (e) => {
        e.stopPropagation();
        cashback.classList.toggle("tooltip-visible");
        if (cashback.classList.contains("tooltip-visible")) {
          positionTooltip();
        }
      });
    }
    return cashback;
  }
  function createChecklist(service, i18n) {
    const checklist = document.createElement("ol");
    checklist.className = "checklist";
    let items;
    if (service.id === "dnb") {
      items = [
        i18n.getMessage("dnbInstruction1"),
        i18n.getMessage("dnbInstruction2"),
        i18n.getMessage("dnbInstruction3")
      ];
    } else {
      items = [
        i18n.getMessage("disableAdblockers"),
        i18n.getMessage("acceptAllCookies"),
        i18n.getMessage("emptyCart")
      ];
    }
    items.forEach((text) => {
      const li = document.createElement("li");
      li.textContent = text;
      checklist.appendChild(li);
    });
    return checklist;
  }
  function createActionButton(match, service, i18n, sessionStorage, currentHost, content) {
    const actionBtn = document.createElement("a");
    actionBtn.className = "action-btn";
    const baseUrl = service.clickthroughUrl || "";
    const clickthroughUrl = baseUrl.includes("{urlName}") ? baseUrl.replace("{urlName}", match.urlName || "") : baseUrl;
    actionBtn.target = "_blank";
    actionBtn.rel = "noopener noreferrer";
    actionBtn.href = clickthroughUrl;
    if (service.type === "code" && match.offer?.code) {
      actionBtn.classList.add("has-code");
      actionBtn.dataset.copied = "false";
      const codeText = document.createTextNode(match.offer.code);
      actionBtn.appendChild(codeText);
      const copyIcon = document.createElement("span");
      copyIcon.className = "copy-icon";
      copyIcon.textContent = "\u{1F4CB}";
      copyIcon.title = i18n.getMessage("copyCode") || "Kopier kode";
      actionBtn.appendChild(copyIcon);
    } else {
      actionBtn.textContent = i18n.getMessage("getServiceBonus", service.name);
    }
    const recheckIcon = document.createElement("span");
    recheckIcon.className = "recheck-icon";
    recheckIcon.textContent = "\u21BB";
    recheckIcon.title = i18n.getMessage("checkAdblockAgain");
    recheckIcon.setAttribute("role", "button");
    recheckIcon.setAttribute("tabindex", "0");
    recheckIcon.setAttribute("aria-label", i18n.getMessage("checkAdblockAgain"));
    actionBtn.appendChild(recheckIcon);
    actionBtn.addEventListener("click", (e) => {
      if (actionBtn.classList.contains("adblock")) {
        e.preventDefault();
        actionBtn.style.animation = "shake 0.3s ease-in-out";
        actionBtn.addEventListener("animationend", () => {
          actionBtn.style.animation = "pulse 0.7s infinite alternate ease-in-out";
        }, { once: true });
        return;
      }
      sessionStorage.set(`${MESSAGE_SHOWN_KEY_PREFIX}${currentHost}`, Date.now().toString());
      if (service.type === "code" && match.offer?.code) {
        const copyIcon = actionBtn.querySelector(".copy-icon");
        if (actionBtn.dataset.copied !== "true") {
          e.preventDefault();
          if (!navigator.clipboard || !navigator.clipboard.writeText) {
            if (copyIcon) {
              copyIcon.textContent = "\u26A0";
              copyIcon.title = i18n.getMessage("copyFailed") || "Kopiering feilet";
            }
            actionBtn.dataset.copied = "true";
            return;
          }
          navigator.clipboard.writeText(match.offer.code).then(() => {
            if (copyIcon) {
              copyIcon.textContent = "\u2713";
            }
            actionBtn.dataset.copied = "true";
            window.getSelection()?.removeAllRanges();
          }).catch(() => {
            if (copyIcon) {
              copyIcon.textContent = "\u26A0";
              copyIcon.title = i18n.getMessage("copyFailed") || "Kopiering feilet";
            }
            actionBtn.dataset.copied = "true";
          });
          return;
        }
        return;
      }
      content.replaceChildren();
      const confirmation = document.createElement("div");
      confirmation.className = "confirmation";
      confirmation.textContent = i18n.getMessage("purchaseRegistered");
      content.appendChild(confirmation);
    });
    return { actionBtn, recheckIcon };
  }
  function createSettingsPanel(settings, services, i18n, shadowHost, container) {
    const panel = document.createElement("div");
    panel.className = "settings";
    const servicesRow = document.createElement("div");
    servicesRow.className = "setting-row";
    const servicesLabel = document.createElement("span");
    servicesLabel.className = "setting-label";
    servicesLabel.textContent = i18n.getMessage("services");
    const servicesContainer = document.createElement("div");
    for (const svc of Object.values(services)) {
      const row = document.createElement("div");
      row.className = "service-toggle-row";
      const info = document.createElement("div");
      info.className = "service-info";
      const dot = document.createElement("span");
      dot.className = "service-dot";
      dot.style.background = svc.color;
      const name = document.createElement("span");
      name.className = "service-name";
      name.textContent = svc.name;
      info.appendChild(dot);
      info.appendChild(name);
      if (svc.comingSoon) {
        const comingSoon = document.createElement("span");
        comingSoon.className = "coming-soon";
        comingSoon.textContent = i18n.getMessage("comingSoon");
        info.appendChild(comingSoon);
      }
      const toggle = document.createElement("span");
      toggle.className = "toggle-switch" + (settings.isServiceEnabled(svc.id) ? " active" : "");
      toggle.dataset.serviceId = svc.id;
      toggle.addEventListener("click", async () => {
        const isActive = toggle.classList.toggle("active");
        await settings.setServiceEnabled(svc.id, isActive);
      });
      row.appendChild(info);
      row.appendChild(toggle);
      servicesContainer.appendChild(row);
    }
    servicesRow.appendChild(servicesLabel);
    servicesRow.appendChild(servicesContainer);
    const settingsGrid = document.createElement("div");
    settingsGrid.className = "settings-grid";
    const themeRow = createThemeRow(settings, i18n, shadowHost);
    settingsGrid.appendChild(themeRow);
    const positionRow = createPositionRow(settings, i18n, container);
    settingsGrid.appendChild(positionRow);
    const hiddenSites = settings.getHiddenSites();
    if (hiddenSites.size > 0) {
      const hiddenRow = createHiddenSitesRow(settings, i18n, hiddenSites.size);
      panel.appendChild(servicesRow);
      panel.appendChild(settingsGrid);
      panel.appendChild(hiddenRow);
    } else {
      panel.appendChild(servicesRow);
      panel.appendChild(settingsGrid);
    }
    const backLink = document.createElement("span");
    backLink.className = "settings-back";
    backLink.textContent = i18n.getMessage("back");
    backLink.addEventListener("click", () => {
      panel.classList.remove("active");
      const content = panel.parentElement?.querySelector(".content");
      content?.classList.remove("hidden");
    });
    panel.appendChild(backLink);
    return panel;
  }
  function createThemeRow(settings, i18n, shadowHost) {
    const themeRow = document.createElement("div");
    themeRow.className = "setting-row";
    const themeLabel = document.createElement("span");
    themeLabel.className = "setting-label";
    themeLabel.textContent = i18n.getMessage("appearance");
    const themeButtons = document.createElement("div");
    themeButtons.className = "theme-buttons";
    const themes = [
      { id: "light", label: i18n.getMessage("themeLight") },
      { id: "dark", label: i18n.getMessage("themeDark") },
      { id: "system", label: i18n.getMessage("themeSystem") }
    ];
    const currentTheme = settings.getTheme();
    themes.forEach((theme) => {
      const btn = document.createElement("span");
      btn.className = "theme-btn" + (currentTheme === theme.id ? " active" : "");
      btn.textContent = theme.label;
      btn.dataset.theme = theme.id;
      themeButtons.appendChild(btn);
    });
    themeButtons.addEventListener("click", async (e) => {
      const btn = e.target.closest(".theme-btn");
      if (!btn?.dataset.theme) return;
      const newTheme = btn.dataset.theme;
      await settings.setTheme(newTheme);
      applyThemeClass(shadowHost, newTheme);
      themeButtons.querySelectorAll(".theme-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
    });
    const minimizeRow = document.createElement("div");
    minimizeRow.className = "toggle-row";
    minimizeRow.style.marginTop = "12px";
    const minimizeLabel = document.createElement("span");
    minimizeLabel.className = "setting-label";
    minimizeLabel.style.marginBottom = "0";
    minimizeLabel.textContent = i18n.getMessage("startMinimized");
    const minimizeToggle = document.createElement("span");
    minimizeToggle.className = "toggle-switch" + (settings.getStartMinimized() ? " active" : "");
    minimizeToggle.addEventListener("click", async () => {
      const isActive = minimizeToggle.classList.toggle("active");
      await settings.setStartMinimized(isActive);
    });
    minimizeRow.appendChild(minimizeLabel);
    minimizeRow.appendChild(minimizeToggle);
    themeRow.appendChild(themeLabel);
    themeRow.appendChild(themeButtons);
    themeRow.appendChild(minimizeRow);
    return themeRow;
  }
  function createPositionRow(settings, i18n, container) {
    const positionRow = document.createElement("div");
    positionRow.className = "setting-row";
    const positionLabel = document.createElement("span");
    positionLabel.className = "setting-label";
    positionLabel.textContent = i18n.getMessage("defaultPosition");
    const positionButtons = document.createElement("div");
    positionButtons.className = "theme-buttons position-buttons";
    const defaultPosition = settings.getDefaultPosition();
    const positions = [
      { id: "top-left", label: "\u2196" },
      { id: "top-right", label: "\u2197" },
      { id: "bottom-left", label: "\u2199" },
      { id: "bottom-right", label: "\u2198" }
    ];
    positions.forEach((pos) => {
      const btn = document.createElement("span");
      btn.className = "theme-btn" + (defaultPosition === pos.id ? " active" : "");
      btn.textContent = pos.label;
      btn.dataset.position = pos.id;
      positionButtons.appendChild(btn);
    });
    positionButtons.addEventListener("click", async (e) => {
      const btn = e.target.closest(".theme-btn");
      if (!btn?.dataset.position) return;
      const newPosition = btn.dataset.position;
      await settings.setDefaultPosition(newPosition);
      positionButtons.querySelectorAll(".theme-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      container.classList.remove("bottom-right", "bottom-left", "top-right", "top-left");
      container.classList.add(newPosition);
    });
    positionRow.appendChild(positionLabel);
    positionRow.appendChild(positionButtons);
    return positionRow;
  }
  function createHiddenSitesRow(settings, i18n, hiddenCount) {
    const hiddenRow = document.createElement("div");
    hiddenRow.className = "setting-row";
    const hiddenLabel = document.createElement("span");
    hiddenLabel.className = "setting-label";
    hiddenLabel.textContent = i18n.getMessage("hiddenSites");
    const hiddenInfo = document.createElement("div");
    hiddenInfo.className = "hidden-sites-info";
    hiddenInfo.textContent = hiddenCount > 1 ? i18n.getMessage("hiddenSitesCountPlural", hiddenCount.toString()) : i18n.getMessage("hiddenSitesCount", hiddenCount.toString());
    const resetHidden = document.createElement("span");
    resetHidden.className = "reset-hidden";
    resetHidden.textContent = i18n.getMessage("reset");
    resetHidden.addEventListener("click", async () => {
      await settings.resetHiddenSites();
      hiddenRow.remove();
    });
    hiddenInfo.appendChild(document.createTextNode(" - "));
    hiddenInfo.appendChild(resetHidden);
    hiddenRow.appendChild(hiddenLabel);
    hiddenRow.appendChild(hiddenInfo);
    return hiddenRow;
  }

  // src/ui/views/reminder.ts
  function isValidHexColor(color) {
    return /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(color);
  }
  function createReminderNotification(options) {
    const { service, settings, i18n, onClose } = options;
    const previousActiveElement = document.activeElement;
    const shadowHost = createShadowHost();
    document.body.appendChild(shadowHost);
    const shadowRoot = shadowHost.attachShadow({ mode: "open" });
    const safeColor = isValidHexColor(service.color) ? service.color : "#4D4DFF";
    const styleOverride = `
    :host {
      --accent: ${safeColor};
      --accent-hover: ${safeColor};
    }
  `;
    injectStyles(shadowRoot, getReminderStyles() + styleOverride);
    const container = document.createElement("div");
    container.className = `container animate-in ${settings.getPosition()}`;
    container.setAttribute("role", "dialog");
    container.setAttribute("aria-label", i18n.getMessage("ariaReminderLabel"));
    applyThemeClass(shadowHost, settings.getTheme());
    const header = document.createElement("div");
    header.className = "header";
    const logo = document.createElement("div");
    logo.className = "logo";
    const logoIcon = document.createElement("img");
    logoIcon.className = "logo-icon";
    logoIcon.src = getLogoIconForService(service.id);
    logoIcon.alt = "";
    const logoText = document.createElement("span");
    logoText.textContent = "BonusVarsler";
    logo.appendChild(logoIcon);
    logo.appendChild(logoText);
    const headerRight = document.createElement("div");
    headerRight.className = "header-right";
    const reminderMini = document.createElement("span");
    reminderMini.className = "reminder-mini";
    reminderMini.textContent = "!";
    const minimizeBtn = document.createElement("button");
    minimizeBtn.className = "minimize-btn";
    minimizeBtn.setAttribute("aria-label", i18n.getMessage("ariaMinimize"));
    const closeBtn = document.createElement("button");
    closeBtn.className = "close-btn";
    closeBtn.setAttribute("aria-label", i18n.getMessage("ariaClose"));
    headerRight.appendChild(reminderMini);
    headerRight.appendChild(minimizeBtn);
    headerRight.appendChild(closeBtn);
    header.appendChild(logo);
    header.appendChild(headerRight);
    const body = document.createElement("div");
    body.className = "body";
    const title = document.createElement("span");
    title.className = "title";
    title.textContent = i18n.getMessage("importantReminder");
    const message = document.createElement("p");
    message.className = "message";
    message.textContent = i18n.getMessage("reminderMessage");
    const adblockWarning = document.createElement("p");
    adblockWarning.className = "message";
    adblockWarning.textContent = i18n.getMessage("reminderAdblockWarning");
    const tip = document.createElement("p");
    tip.className = "tip";
    tip.textContent = i18n.getMessage("reminderTip");
    body.appendChild(title);
    body.appendChild(message);
    body.appendChild(adblockWarning);
    body.appendChild(tip);
    container.appendChild(header);
    container.appendChild(body);
    shadowRoot.appendChild(container);
    let draggableCleanup = null;
    function closeNotification() {
      draggableCleanup?.();
      shadowHost.remove();
      document.removeEventListener("keydown", handleKeydown);
      if (previousActiveElement && typeof previousActiveElement.focus === "function") {
        previousActiveElement.focus();
      }
      onClose?.();
    }
    function handleKeydown(e) {
      if (e.key === "Escape") {
        closeNotification();
        return;
      }
      if (e.key === "Tab") {
        const focusableElements = shadowRoot.querySelectorAll(
          'button, [href], [tabindex]:not([tabindex="-1"])'
        );
        const firstFocusable = focusableElements[0];
        const lastFocusable = focusableElements[focusableElements.length - 1];
        if (e.shiftKey && shadowRoot.activeElement === firstFocusable) {
          e.preventDefault();
          lastFocusable?.focus();
        } else if (!e.shiftKey && shadowRoot.activeElement === lastFocusable) {
          e.preventDefault();
          firstFocusable?.focus();
        }
      }
    }
    closeBtn.addEventListener("click", closeNotification);
    document.addEventListener("keydown", handleKeydown);
    closeBtn.focus();
    minimizeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      container.classList.add("minimized");
    });
    container.addEventListener("click", (e) => {
      if (container.classList.contains("minimized")) {
        if (!e.target.closest(".close-btn")) {
          container.classList.remove("minimized");
        }
      }
    });
    draggableCleanup = makeCornerDraggable(container, async (position) => {
      await settings.setPositionForSite(position);
    });
    return shadowHost;
  }

  // src/ui/views/service-selector.ts
  var STRINGS = {
    selectServices: "Velg bonusprogrammer",
    comingSoon: "(kommer snart)",
    saveServices: "Lagre",
    saveFailed: "Kunne ikke lagre. Pr\xF8v igjen."
  };
  function createServiceSelector(options) {
    const { settings, services, onSave } = options;
    const shadowHost = createShadowHost();
    const shadowRoot = shadowHost.attachShadow({ mode: "open" });
    injectStyles(shadowRoot, getServiceSelectorStyles());
    const container = document.createElement("div");
    container.className = `container animate-in ${settings.getPosition()}`;
    container.setAttribute("role", "dialog");
    container.setAttribute("aria-label", STRINGS.selectServices);
    shadowHost.className = "tbvl-light";
    const header = document.createElement("div");
    header.className = "header";
    const logo = document.createElement("div");
    logo.className = "logo";
    const logoIcon = document.createElement("img");
    logoIcon.className = "logo-icon";
    logoIcon.src = icon_64_default;
    logoIcon.alt = "";
    const logoText = document.createElement("span");
    logoText.textContent = "BonusVarsler";
    logo.appendChild(logoIcon);
    logo.appendChild(logoText);
    header.appendChild(logo);
    const body = document.createElement("div");
    body.className = "body";
    const content = document.createElement("div");
    content.className = "content";
    const title = document.createElement("div");
    title.className = "settings-title";
    title.textContent = STRINGS.selectServices;
    content.appendChild(title);
    const toggleStates = {};
    SERVICE_ORDER.forEach((serviceId) => {
      toggleStates[serviceId] = serviceId === "trumf";
    });
    SERVICE_ORDER.forEach((serviceId) => {
      const service = services[serviceId];
      if (!service) return;
      const row = document.createElement("div");
      row.className = "service-toggle-row";
      const info = document.createElement("div");
      info.className = "service-info";
      const dot = document.createElement("span");
      dot.className = "service-dot";
      dot.style.backgroundColor = service.color;
      const name = document.createElement("span");
      name.className = "service-name";
      name.textContent = service.name;
      info.appendChild(dot);
      info.appendChild(name);
      if (service.comingSoon) {
        const comingSoon = document.createElement("span");
        comingSoon.className = "coming-soon";
        comingSoon.textContent = STRINGS.comingSoon;
        info.appendChild(comingSoon);
      }
      const nameId = `service-name-${serviceId}`;
      name.id = nameId;
      const toggle = document.createElement("div");
      toggle.className = "toggle-switch";
      toggle.setAttribute("role", "switch");
      toggle.setAttribute("tabindex", "0");
      toggle.setAttribute("aria-checked", String(toggleStates[serviceId]));
      toggle.setAttribute("aria-labelledby", nameId);
      if (toggleStates[serviceId]) {
        toggle.classList.add("active");
      }
      const handleToggle = () => {
        if (toggleStates[serviceId]) {
          const activeEnabledCount = SERVICE_ORDER.filter(
            (id) => toggleStates[id] && !services[id]?.comingSoon
          ).length;
          if (activeEnabledCount <= 1 && !services[serviceId]?.comingSoon) {
            toggle.classList.remove("shake");
            void toggle.offsetWidth;
            toggle.classList.add("shake");
            return;
          }
        }
        toggleStates[serviceId] = !toggleStates[serviceId];
        toggle.classList.toggle("active", toggleStates[serviceId]);
        toggle.setAttribute("aria-checked", String(toggleStates[serviceId]));
      };
      toggle.addEventListener("click", handleToggle);
      toggle.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleToggle();
        }
      });
      row.appendChild(info);
      row.appendChild(toggle);
      content.appendChild(row);
    });
    const saveBtn = document.createElement("button");
    saveBtn.className = "action-btn";
    saveBtn.textContent = STRINGS.saveServices;
    const errorDisplay = document.createElement("div");
    errorDisplay.className = "error-message";
    errorDisplay.style.cssText = "color: #c50000; font-size: 13px; margin-top: 8px; display: none;";
    saveBtn.addEventListener("click", async () => {
      const enabledServices = SERVICE_ORDER.filter((serviceId) => toggleStates[serviceId]);
      const hasActiveService = enabledServices.some((id) => !services[id]?.comingSoon);
      if (!hasActiveService) {
        enabledServices.push("trumf");
      }
      errorDisplay.style.display = "none";
      try {
        await settings.setEnabledServices(enabledServices);
        await settings.setSetupComplete(true);
        if (onSave) {
          onSave(enabledServices);
        } else {
          window.location.reload();
        }
      } catch (error) {
        console.error("[BonusVarsler] Failed to save service selection:", error);
        errorDisplay.textContent = STRINGS.saveFailed;
        errorDisplay.style.display = "block";
      }
    });
    content.appendChild(saveBtn);
    content.appendChild(errorDisplay);
    body.appendChild(content);
    container.appendChild(header);
    container.appendChild(body);
    shadowRoot.appendChild(container);
    document.body.appendChild(shadowHost);
    return shadowHost;
  }

  // src/platform/extension.ts
  (async function() {
    "use strict";
    const currentHost = window.location.hostname;
    const sessionStorage = getExtensionSessionStorage();
    if (shouldBailOutEarly(sessionStorage, currentHost)) {
      return;
    }
    const adapters = {
      storage: getExtensionStorage(),
      sessionStorage,
      fetcher: getExtensionFetch(),
      i18n: getExtensionI18n()
    };
    const result = await initialize(adapters, currentHost);
    const { storage, fetcher, i18n } = adapters;
    if (result.status === "blocked") {
      return;
    }
    const setupComplete = await storage.get(STORAGE_KEYS.setupComplete, false);
    const setupShowCount = await storage.get(STORAGE_KEYS.setupShowCount, 0);
    if (!setupComplete) {
      if (setupShowCount === 0) {
        const services = result.status === "match" ? result.feedManager.getServices() : null;
        const hasServices = services && Object.keys(services).length > 0;
        if (!hasServices) {
          await storage.set(STORAGE_KEYS.setupShowCount, 1);
          createServiceSelector({
            settings: result.settings,
            services: SERVICES_FALLBACK
          });
          return;
        }
        await storage.set(STORAGE_KEYS.setupShowCount, 1);
        createServiceSelector({
          settings: result.settings,
          services
        });
        return;
      }
      if (result.status !== "match") {
        return;
      }
      if (setupShowCount === 1) {
        await storage.set(STORAGE_KEYS.setupShowCount, 2);
        createServiceSelector({
          settings: result.settings,
          services: result.feedManager.getServices()
        });
        return;
      }
      const allServices = Object.values(result.feedManager.getServices()).filter((s) => !s.comingSoon).map((s) => s.id);
      await storage.set(STORAGE_KEYS.enabledServices, allServices);
      await storage.set(STORAGE_KEYS.setupComplete, true);
    }
    if (result.status === "match") {
      const enabledServices = result.settings.getEnabledServices();
      const services = result.feedManager.getServices();
      const reminderResult = isOnCashbackPage(
        currentHost,
        window.location.pathname,
        enabledServices,
        services
      );
      const reminderShown = sessionStorage.get(STORAGE_KEYS.reminderShown);
      if (reminderResult.isOnPage && reminderResult.service && !reminderShown) {
        sessionStorage.set(STORAGE_KEYS.reminderShown, "true");
        createReminderNotification({
          service: reminderResult.service,
          settings: result.settings,
          i18n
        });
        return;
      }
    }
    if (result.status !== "match") {
      return;
    }
    const { settings, feedManager, match } = result;
    markMessageShown(sessionStorage, currentHost);
    createNotification({
      match,
      settings,
      services: feedManager.getServices(),
      i18n,
      fetcher,
      sessionStorage,
      currentHost
    });
  })();
})();
