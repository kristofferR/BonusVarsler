/**
 * Service selector view
 * First-run selector for choosing which services to enable
 * Uses plain Norwegian strings (no i18n) since this runs before merchant match
 */

import type { Settings } from "../../core/settings.js";
import type { ServiceRegistry } from "../../config/services.js";
import { SERVICE_ORDER } from "../../config/services.js";
import { getServiceSelectorStyles } from "../styles/index.js";
import { createShadowHost, injectStyles } from "../components/shadow-host.js";
import { LOGO_ICON_URL } from "../components/icons.js";

// Plain Norwegian strings for first-run UI (no i18n dependency)
const STRINGS = {
  selectServices: "Velg bonusprogrammer",
  comingSoon: "(kommer snart)",
  saveServices: "Lagre",
  saveFailed: "Kunne ikke lagre. Prøv igjen.",
};

export interface ServiceSelectorOptions {
  settings: Settings;
  services: ServiceRegistry;
  onSave?: (enabledServices: string[]) => void;
}

/**
 * Create and show the service selector
 */
export function createServiceSelector(options: ServiceSelectorOptions): HTMLElement {
  const { settings, services, onSave } = options;

  // Create shadow host (append to body after content is ready)
  const shadowHost = createShadowHost();
  const shadowRoot = shadowHost.attachShadow({ mode: "open" });

  // Inject styles
  injectStyles(shadowRoot, getServiceSelectorStyles());

  // Create container
  const container = document.createElement("div");
  container.className = `container animate-in ${settings.getPosition()}`;
  container.setAttribute("role", "dialog");
  container.setAttribute("aria-label", STRINGS.selectServices);

  // Force light theme for first-run selector
  shadowHost.className = "tbvl-light";

  // Header (simplified - no settings, minimize, or close buttons)
  const header = document.createElement("div");
  header.className = "header";

  const logo = document.createElement("div");
  logo.className = "logo";

  const logoIcon = document.createElement("img");
  logoIcon.className = "logo-icon";
  logoIcon.src = LOGO_ICON_URL;
  logoIcon.alt = "";

  const logoText = document.createElement("span");
  logoText.textContent = "BonusVarsler";

  logo.appendChild(logoIcon);
  logo.appendChild(logoText);
  header.appendChild(logo);

  // Body
  const body = document.createElement("div");
  body.className = "body";

  const content = document.createElement("div");
  content.className = "content";

  const title = document.createElement("div");
  title.className = "settings-title";
  title.textContent = STRINGS.selectServices;

  content.appendChild(title);

  // Use canonical service order from config
  const toggleStates: Record<string, boolean> = {};
  let hasActiveDefault = false;

  // Initialize from service defaults (fallback to first active service if none)
  SERVICE_ORDER.forEach((serviceId) => {
    const service = services[serviceId];
    const enabledByDefault = Boolean(service?.defaultEnabled) && !service?.comingSoon;
    toggleStates[serviceId] = enabledByDefault;
    if (enabledByDefault) {
      hasActiveDefault = true;
    }
  });

  if (!hasActiveDefault) {
    const fallbackServiceId = SERVICE_ORDER.find(
      (serviceId) => services[serviceId] && !services[serviceId]?.comingSoon
    );
    if (fallbackServiceId) {
      toggleStates[fallbackServiceId] = true;
    }
  }

  // Create service rows
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

    // Add "coming soon" text for placeholder services
    if (service.comingSoon) {
      const comingSoon = document.createElement("span");
      comingSoon.className = "coming-soon";
      comingSoon.textContent = STRINGS.comingSoon;
      info.appendChild(comingSoon);
    }

    // Give the name element a unique ID for the toggle's accessible name
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

    // Toggle handler (click and keyboard)
    const handleToggle = () => {
      // If turning off, check if this is the last active service
      if (toggleStates[serviceId]) {
        const activeEnabledCount = SERVICE_ORDER.filter(
          (id) => toggleStates[id] && !services[id]?.comingSoon
        ).length;
        // Prevent deselecting the last active service
        if (activeEnabledCount <= 1 && !services[serviceId]?.comingSoon) {
          toggle.classList.remove("shake");
          // Force reflow to restart animation
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

  // Save button
  const saveBtn = document.createElement("button");
  saveBtn.className = "action-btn";
  saveBtn.textContent = STRINGS.saveServices;

  // Error display element (initially hidden)
  const errorDisplay = document.createElement("div");
  errorDisplay.className = "error-message";
  errorDisplay.style.cssText = "color: #c50000; font-size: 13px; margin-top: 8px; display: none;";

  saveBtn.addEventListener("click", async () => {
    // Get enabled services
    const enabledServices = SERVICE_ORDER.filter((serviceId) => toggleStates[serviceId]);

    // Ensure at least one active (non-coming-soon) service is enabled
    const hasActiveService = enabledServices.some((id) => !services[id]?.comingSoon);
    if (!hasActiveService) {
      enabledServices.push("trumf");
    }

    // Hide any previous error
    errorDisplay.style.display = "none";

    try {
      // Save to storage
      await settings.setEnabledServices(enabledServices);
      await settings.setSetupComplete(true);

      // Call onSave callback or reload page
      if (onSave) {
        onSave(enabledServices);
      } else {
        window.location.reload();
      }
    } catch (error) {
      console.error("[BonusVarsler] Failed to save service selection:", error);
      // Show error and keep dialog open - do NOT proceed with callback/reload
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

  // Append to body after content is ready
  document.body.appendChild(shadowHost);

  return shadowHost;
}
