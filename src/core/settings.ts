/**
 * Settings management
 * Handles theme, position, hidden sites, and enabled services
 */

import type { StorageAdapter } from "../storage/types.js";
import type { Position, Theme } from "../config/constants.js";
import {
  STORAGE_KEYS,
  LEGACY_KEYS,
  CURRENT_VERSION,
  DEFAULT_POSITION,
  DEFAULT_THEME,
} from "../config/constants.js";
import { getDefaultEnabledServices } from "../config/services.js";

// Maximum number of site-specific positions to store (to prevent unbounded growth)
const MAX_SITE_POSITIONS = 100;

export interface SettingsCache {
  hiddenSites: Set<string>;
  blacklistedSites: Set<string>;
  theme: Theme;
  startMinimized: boolean;
  position: Position;
  sitePositions: Record<string, Position>;
  enabledServices: string[] | null;
  setupComplete: boolean;
  setupShowCount: number;
}

export function createDefaultSettings(): SettingsCache {
  return {
    hiddenSites: new Set(),
    blacklistedSites: new Set(),
    theme: DEFAULT_THEME,
    startMinimized: false,
    position: DEFAULT_POSITION,
    sitePositions: {},
    enabledServices: null,
    setupComplete: false,
    setupShowCount: 0,
  };
}

/**
 * Settings manager class
 */
export class Settings {
  private cache: SettingsCache;
  private storage: StorageAdapter;
  private currentHost: string;

  constructor(storage: StorageAdapter, currentHost: string) {
    this.cache = createDefaultSettings();
    this.storage = storage;
    this.currentHost = currentHost;
  }

  /**
   * Run version-based migrations
   */
  async runMigrations(): Promise<void> {
    try {
      const storedVersion = await this.storage.get<string | null>(STORAGE_KEYS.version, null);

      if (storedVersion !== CURRENT_VERSION) {
        // Check if this is a legacy user upgrading
        const existingEnabledServices = await this.storage.get<string[] | null>(
          STORAGE_KEYS.enabledServices,
          null
        );
        const legacyFeedData = await this.storage.get(LEGACY_KEYS.feedData_v3, null);
        const legacyFeedTime = await this.storage.get(LEGACY_KEYS.feedTime_v3, null);
        const legacyFeedDataV4 = await this.storage.get(LEGACY_KEYS.feedData_v4, null);
        const legacyFeedTimeV4 = await this.storage.get(LEGACY_KEYS.feedTime_v4, null);
        const isLegacyUser =
          existingEnabledServices === null &&
          (legacyFeedData !== null || legacyFeedTime !== null ||
           legacyFeedDataV4 !== null || legacyFeedTimeV4 !== null);

        // Check if this is an existing user
        const isExistingUser =
          storedVersion !== null || existingEnabledServices !== null || isLegacyUser;

        // Remove cache-related and legacy keys (v3 and v4)
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
          STORAGE_KEYS.reminderShown,
        ];

        await this.storage.remove(keysToRemove);

        // Seed legacy users with Trumf-only
        if (isLegacyUser) {
          await this.storage.set(STORAGE_KEYS.enabledServices, ["trumf"]);
        }

        // Mark existing users as having completed setup
        if (isExistingUser) {
          await this.storage.set(STORAGE_KEYS.setupComplete, true);
        }

        // Set version to prevent re-running migration
        await this.storage.set(STORAGE_KEYS.version, CURRENT_VERSION);

        console.log("[BonusVarsler] Migrated to version", CURRENT_VERSION);
      }
    } catch (err) {
      // Migration failed - log error but continue anyway to not block the user
      console.error("[BonusVarsler] Settings migration failed:", err);
    }
  }

  /**
   * Load all settings from storage
   */
  async load(): Promise<void> {
    // Run migrations first
    await this.runMigrations();

    const hiddenSitesArray = await this.storage.get<string[]>(STORAGE_KEYS.hiddenSites, []);
    this.cache.hiddenSites = new Set(hiddenSitesArray);
    const blacklistedSitesArray = await this.storage.get<string[]>(STORAGE_KEYS.blacklistedSites, []);
    this.cache.blacklistedSites = new Set(blacklistedSitesArray);
    this.cache.theme = await this.storage.get<Theme>(STORAGE_KEYS.theme, DEFAULT_THEME);
    this.cache.startMinimized = await this.storage.get<boolean>(STORAGE_KEYS.startMinimized, false);
    this.cache.position = await this.storage.get<Position>(STORAGE_KEYS.position, DEFAULT_POSITION);
    this.cache.sitePositions = await this.storage.get<Record<string, Position>>(
      STORAGE_KEYS.sitePositions,
      {}
    );

    // Load enabled services
    const storedServices = await this.storage.get<string[] | null>(
      STORAGE_KEYS.enabledServices,
      null
    );
    this.cache.enabledServices = storedServices;

    // Load first-run setup status
    this.cache.setupComplete = await this.storage.get<boolean>(STORAGE_KEYS.setupComplete, false);
    this.cache.setupShowCount = await this.storage.get<number>(STORAGE_KEYS.setupShowCount, 0);
  }

  // ==================
  // Hidden Sites
  // ==================

  getHiddenSites(): Set<string> {
    return this.cache.hiddenSites;
  }

  isSiteHidden(host: string): boolean {
    const normalized = this.normalizeHost(host);
    return this.cache.hiddenSites.has(normalized);
  }

  async hideSite(host: string): Promise<void> {
    const normalized = this.normalizeHost(host);
    if (!this.cache.hiddenSites.has(normalized)) {
      this.cache.hiddenSites.add(normalized);
      await this.storage.set(STORAGE_KEYS.hiddenSites, [...this.cache.hiddenSites]);
    }
  }

  async resetHiddenSites(): Promise<void> {
    this.cache.hiddenSites = new Set();
    await this.storage.set(STORAGE_KEYS.hiddenSites, []);
  }

  // ==================
  // Blacklisted Sites
  // ==================

  private normalizeHost(host: string): string {
    let h = host.trim().toLowerCase();
    if (h.startsWith("www.")) {
      h = h.slice(4);
    }
    // Strip leading/trailing dots
    h = h.replace(/^\.+|\.+$/g, "");
    return h;
  }

  getBlacklistedSites(): Set<string> {
    return this.cache.blacklistedSites;
  }

  isSiteBlacklisted(host: string): boolean {
    return this.cache.blacklistedSites.has(this.normalizeHost(host));
  }

  async blacklistSite(host: string): Promise<void> {
    const normalized = this.normalizeHost(host);
    if (!this.cache.blacklistedSites.has(normalized)) {
      this.cache.blacklistedSites.add(normalized);
      await this.storage.set(STORAGE_KEYS.blacklistedSites, [...this.cache.blacklistedSites]);
    }
  }

  async unblacklistSite(host: string): Promise<void> {
    const normalized = this.normalizeHost(host);
    if (this.cache.blacklistedSites.has(normalized)) {
      this.cache.blacklistedSites.delete(normalized);
      await this.storage.set(STORAGE_KEYS.blacklistedSites, [...this.cache.blacklistedSites]);
    }
  }

  async resetBlacklistedSites(): Promise<void> {
    this.cache.blacklistedSites = new Set();
    await this.storage.set(STORAGE_KEYS.blacklistedSites, []);
  }

  // ==================
  // Theme
  // ==================

  getTheme(): Theme {
    return this.cache.theme;
  }

  async setTheme(theme: Theme): Promise<void> {
    this.cache.theme = theme;
    await this.storage.set(STORAGE_KEYS.theme, theme);
  }

  // ==================
  // Start Minimized
  // ==================

  getStartMinimized(): boolean {
    return this.cache.startMinimized;
  }

  async setStartMinimized(value: boolean): Promise<void> {
    this.cache.startMinimized = value;
    await this.storage.set(STORAGE_KEYS.startMinimized, value);
  }

  // ==================
  // Position
  // ==================

  getPosition(): Position {
    // Check for site-specific override first
    return this.cache.sitePositions[this.currentHost] || this.cache.position;
  }

  getDefaultPosition(): Position {
    return this.cache.position;
  }

  async setDefaultPosition(position: Position): Promise<void> {
    this.cache.position = position;
    await this.storage.set(STORAGE_KEYS.position, position);
  }

  async setPositionForSite(position: Position): Promise<void> {
    this.cache.sitePositions[this.currentHost] = position;

    // Evict oldest entries if over limit
    const hosts = Object.keys(this.cache.sitePositions);
    if (hosts.length > MAX_SITE_POSITIONS) {
      // Remove oldest entries (first in object order) to get back under limit
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

  getEnabledServices(): string[] {
    return this.cache.enabledServices || getDefaultEnabledServices();
  }

  isServiceEnabled(serviceId: string): boolean {
    return this.getEnabledServices().includes(serviceId);
  }

  async setServiceEnabled(serviceId: string, enabled: boolean): Promise<void> {
    const current = this.getEnabledServices();
    let updated: string[];

    if (enabled && !current.includes(serviceId)) {
      updated = [...current, serviceId];
    } else if (!enabled && current.includes(serviceId)) {
      updated = current.filter((s) => s !== serviceId);
    } else {
      return; // No change
    }

    this.cache.enabledServices = updated;
    await this.storage.set(STORAGE_KEYS.enabledServices, updated);
  }

  async setEnabledServices(services: string[]): Promise<void> {
    this.cache.enabledServices = services;
    await this.storage.set(STORAGE_KEYS.enabledServices, services);
  }

  // ==================
  // Setup Complete
  // ==================

  isSetupComplete(): boolean {
    return this.cache.setupComplete;
  }

  getSetupShowCount(): number {
    return this.cache.setupShowCount;
  }

  async setSetupComplete(complete: boolean): Promise<void> {
    this.cache.setupComplete = complete;
    await this.storage.set(STORAGE_KEYS.setupComplete, complete);
  }

  async incrementSetupShowCount(): Promise<void> {
    this.cache.setupShowCount++;
    await this.storage.set(STORAGE_KEYS.setupShowCount, this.cache.setupShowCount);
  }
}
