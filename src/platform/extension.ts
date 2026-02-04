/**
 * Extension platform entry point
 * Wires extension-specific adapters and initializes BonusVarsler
 */

import { getExtensionStorage, getExtensionSessionStorage } from "../storage/extension-storage.js";
import { getExtensionFetch } from "../network/extension-fetch.js";
import { getExtensionI18n } from "../i18n/extension-i18n.js";
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
  const sessionStorage = getExtensionSessionStorage();

  // Early bailout checks
  if (shouldBailOutEarly(sessionStorage, currentHost)) {
    return;
  }

  // Create platform adapters
  const adapters: PlatformAdapters = {
    storage: getExtensionStorage(),
    sessionStorage,
    fetcher: getExtensionFetch(),
    i18n: getExtensionI18n(),
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
      // Get services - either from result or use fallback
      const services = result.status === "match" ? result.feedManager.getServices() : null;
      const hasServices = services && Object.keys(services).length > 0;

      if (!hasServices) {
        // No services available yet - use fallback to ensure selector has content
        await storage.set(STORAGE_KEYS.setupShowCount, 1);
        createServiceSelector({
          settings: result.settings,
          services: SERVICES_FALLBACK,
        });
        return;
      }

      // Services available - proceed with selector
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
