/**
 * Reminder notification view
 * Shows on cashback portal pages to remind users about tracking
 */

import type { I18nAdapter } from "../../i18n/types.js";
import type { Settings } from "../../core/settings.js";
import type { Service } from "../../config/services.js";
import type { Position } from "../../config/constants.js";
import { getReminderStyles } from "../styles/index.js";
import {
  createShadowHost,
  appendToBody,
  applyThemeClass,
  injectStyles,
} from "../components/shadow-host.js";
import { getLogoIconForService } from "../components/icons.js";
import { makeCornerDraggable, type CleanupFunction } from "../components/draggable.js";

export interface ReminderOptions {
  service: Service;
  settings: Settings;
  i18n: I18nAdapter;
  onClose?: () => void;
}

// Validate hex color format
function isValidHexColor(color: string): boolean {
  return /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(color);
}

/**
 * Create and show the reminder notification
 */
export function createReminderNotification(options: ReminderOptions): HTMLElement {
  const { service, settings, i18n, onClose } = options;

  // Capture focus to restore later
  const previousActiveElement = document.activeElement as HTMLElement | null;

  // Create shadow host
  const shadowHost = createShadowHost();
  appendToBody(shadowHost);
  const shadowRoot = shadowHost.attachShadow({ mode: "open" });

  // Inject styles with service color override (validate color first)
  const safeColor = isValidHexColor(service.color) ? service.color : "#4D4DFF";
  const styleOverride = `
    :host {
      --accent: ${safeColor};
      --accent-hover: ${safeColor};
    }
  `;
  injectStyles(shadowRoot, getReminderStyles() + styleOverride);

  // Create container
  const container = document.createElement("div");
  container.className = `container animate-in ${settings.getPosition()}`;
  container.setAttribute("role", "dialog");
  container.setAttribute("aria-label", i18n.getMessage("ariaReminderLabel"));

  // Apply theme
  applyThemeClass(shadowHost, settings.getTheme());

  // Header
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

  // Reminder badge for minimized state
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

  // Body
  const body = document.createElement("div");
  body.className = "body";

  const title = document.createElement("span");
  title.className = "title";
  title.textContent = i18n.getMessage("importantReminder");

  body.appendChild(title);

  if (service.type === "info") {
    // Info-type services (OBOS, NAF, LOfavør): just log in, no adblock concerns
    const message = document.createElement("p");
    message.className = "message";
    message.textContent = i18n.getMessage("infoReminderMessage", service.name);
    body.appendChild(message);
  } else {
    // Tracking-based services: adblock and cookie warnings
    const message = document.createElement("p");
    message.className = "message";
    message.textContent = i18n.getMessage("reminderMessage");

    const adblockWarning = document.createElement("p");
    adblockWarning.className = "message";
    adblockWarning.textContent = i18n.getMessage("reminderAdblockWarning");

    const tip = document.createElement("p");
    tip.className = "tip";
    tip.textContent = i18n.getMessage("reminderTip");

    body.appendChild(message);
    body.appendChild(adblockWarning);
    body.appendChild(tip);
  }

  container.appendChild(header);
  container.appendChild(body);
  shadowRoot.appendChild(container);

  // Event handlers
  let draggableCleanup: CleanupFunction | null = null;

  function closeNotification() {
    draggableCleanup?.();
    shadowHost.remove();
    document.removeEventListener("keydown", handleKeydown);
    // Restore focus to previously focused element
    if (previousActiveElement && typeof previousActiveElement.focus === "function") {
      previousActiveElement.focus();
    }
    onClose?.();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      closeNotification();
      return;
    }

    // Simple focus trap for Tab key within the dialog
    if (e.key === "Tab") {
      const focusableElements = shadowRoot.querySelectorAll<HTMLElement>(
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

  // Move focus into the dialog
  closeBtn.focus();

  // Minimize/expand toggle
  minimizeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    container.classList.add("minimized");
  });

  container.addEventListener("click", (e) => {
    if (container.classList.contains("minimized")) {
      if (!(e.target as HTMLElement).closest(".close-btn")) {
        container.classList.remove("minimized");
      }
    }
  });

  // Make draggable
  draggableCleanup = makeCornerDraggable(container, async (position: Position) => {
    await settings.setPositionForSite(position);
  });

  return shadowHost;
}
