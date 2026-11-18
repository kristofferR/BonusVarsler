/**
 * Userscript platform entry point
 * Wires GM-specific adapters and initializes BonusVarsler
 */

import { getGMStorage, getGMSessionStorage } from "../storage/gm-storage.js";
import { getGMFetch } from "../network/gm-fetch.js";
import { getStaticI18n } from "../i18n/static-i18n.js";
import {
  canSkipPage,
  countVisitAndCheckCooldown,
  markMessageShown,
  initialize,
  isOnCashbackPage,
} from "../main.js";
import type { PlatformAdapters } from "../main.js";
import { createNotification } from "../ui/views/notification.js";
import { createReminderNotification } from "../ui/views/reminder.js";
import { createServiceSelector } from "../ui/views/service-selector.js";
import { STORAGE_KEYS } from "../config/constants.js";
import { SERVICES_FALLBACK } from "../config/services.js";

// Immediate IIFE for early bailout
(async function () {
  // Skip iframes entirely
  if (window.top !== window.self) {
    return;
  }

  const currentHost = window.location.hostname;
  const currentPathname = window.location.pathname;

  // Create platform adapters
  const adapters: PlatformAdapters = {
    storage: getGMStorage(),
    sessionStorage: getGMSessionStorage(),
    fetcher: getGMFetch(),
    i18n: getStaticI18n(),
  };
  const { storage, sessionStorage, fetcher, i18n } = adapters;

  // Most pages need nothing from us; decide that before touching the page's storage
  if (await canSkipPage(storage, currentHost, currentPathname)) {
    return;
  }

  if (countVisitAndCheckCooldown(sessionStorage, currentHost, currentPathname)) {
    return;
  }

  // Initialize core
  const result = await initialize(adapters, currentHost, currentPathname);

  // Blocked sites get no UI at all
  if (result.status === "blocked") {
    return;
  }

  // Check for first-run setup flow
  const setupComplete = await storage.get<boolean>(STORAGE_KEYS.setupComplete, false);
  const setupShowCount = await storage.get<number>(STORAGE_KEYS.setupShowCount, 0);

  if (!setupComplete) {
    // First-run flow
    if (setupShowCount === 0) {
      // Count 0: Show selector on any page
      const services = result.status === "match" ? result.feedManager.getServices() : SERVICES_FALLBACK;
      await storage.set(STORAGE_KEYS.setupShowCount, 1);
      createServiceSelector({
        settings: result.settings,
        services,
      });
      return;
    }

    // Count 1+: Only show on merchant pages
    if (result.status !== "match") {
      return;
    }

    if (setupShowCount === 1) {
      // Count 1: Show selector on merchant page
      await storage.set(STORAGE_KEYS.setupShowCount, 2);
      createServiceSelector({
        settings: result.settings,
        services: result.feedManager.getServices(),
      });
      return;
    }

    // Count 2+: Auto-enable all services and complete setup
    const allServices = Object.values(result.feedManager.getServices())
      .filter((s) => !s.comingSoon)
      .map((s) => s.id);
    await storage.set(STORAGE_KEYS.enabledServices, allServices);
    await storage.set(STORAGE_KEYS.setupComplete, true);
    // Continue to show notification
  }

  // Check if we should show reminder on cashback portal.
  // This must run even on "no-match" pages, since cashback portals are not merchant pages.
  const reminderServices = result.status === "match" ? result.feedManager.getServices() : SERVICES_FALLBACK;
  const reminderResult = isOnCashbackPage(
    currentHost,
    window.location.pathname,
    result.settings.getEnabledServices(),
    reminderServices
  );

  // Check if reminder already shown this session
  const reminderShown = sessionStorage.get(STORAGE_KEYS.reminderShown);

  if (reminderResult.isOnPage && reminderResult.service && !reminderShown) {
    sessionStorage.set(STORAGE_KEYS.reminderShown, "true");
    createReminderNotification({
      service: reminderResult.service,
      settings: result.settings,
      i18n,
    });
    return;
  }

  if (result.status !== "match") {
    return;
  }

  const { settings, feedManager, match } = result;

  // Mark message as shown
  markMessageShown(sessionStorage, currentHost, currentPathname);

  // Create and show notification
  createNotification({
    match,
    settings,
    services: feedManager.getServices(),
    i18n,
    fetcher,
    sessionStorage,
    currentHost,
    currentPathname,
  });
})();
