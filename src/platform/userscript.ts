/**
 * Userscript platform entry point
 * Wires GM-specific adapters and initializes BonusVarsler
 */

import { getGMStorage, getGMSessionStorage } from "../storage/gm-storage.js";
import { getGMFetch } from "../network/gm-fetch.js";
import { getStaticI18n } from "../i18n/static-i18n.js";
import {
  shouldBailOutEarly,
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
  "use strict";

  const currentHost = window.location.hostname;
  const sessionStorage = getGMSessionStorage();

  // Early bailout checks
  if (shouldBailOutEarly(sessionStorage, currentHost)) {
    return;
  }

  // Create platform adapters
  const adapters: PlatformAdapters = {
    storage: getGMStorage(),
    sessionStorage,
    fetcher: getGMFetch(),
    i18n: getStaticI18n(),
  };

  // Initialize core
  const result = await initialize(adapters, currentHost);
  const { storage, fetcher, i18n } = adapters;

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

  // Check if we should show reminder on cashback portal
  if (result.status === "match") {
    const enabledServices = result.settings.getEnabledServices();
    const services = result.feedManager.getServices();
    const reminderResult = isOnCashbackPage(
      currentHost,
      window.location.pathname,
      enabledServices,
      services
    );

    // Check if reminder already shown this session
    const reminderShownKey = `BonusVarsler_ReminderShown`;
    const reminderShown = sessionStorage.get(reminderShownKey);

    if (reminderResult.isOnPage && reminderResult.service && !reminderShown) {
      sessionStorage.set(reminderShownKey, "true");
      createReminderNotification({
        service: reminderResult.service,
        settings: result.settings,
        i18n,
      });
      return;
    }
  }

  if (result.status !== "match") {
    return;
  }

  const { settings, feedManager, match } = result;

  // Mark message as shown
  markMessageShown(sessionStorage, currentHost);

  // Create and show notification
  createNotification({
    match,
    settings,
    services: feedManager.getServices(),
    i18n,
    fetcher,
    sessionStorage,
    currentHost,
  });
})();
