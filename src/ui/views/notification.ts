/**
 * Main notification view
 * Shows cashback offer with settings panel
 */

import type { I18nAdapter } from "../../i18n/types.js";
import type { MatchResult } from "../../core/merchant-matching.js";
import type { Settings } from "../../core/settings.js";
import type { FetchAdapter } from "../../network/types.js";
import type { SessionStorageAdapter } from "../../storage/types.js";
import type { Position } from "../../config/constants.js";
import type { Service, ServiceRegistry } from "../../config/services.js";
import { MESSAGE_SHOWN_KEY_PREFIX } from "../../config/constants.js";
import { getNotificationStyles } from "../styles/index.js";
import {
  createShadowHost,
  applyThemeClass,
  applyServiceColor,
  injectStyles,
} from "../components/shadow-host.js";
import { getLogoIconForService, SETTINGS_ICON_URI } from "../components/icons.js";
import { makeCornerDraggable, type CleanupFunction } from "../components/draggable.js";
import { detectAdblock } from "../../core/adblock-detection.js";

export interface NotificationOptions {
  match: MatchResult;
  settings: Settings;
  services: ServiceRegistry;
  i18n: I18nAdapter;
  fetcher: FetchAdapter;
  sessionStorage: SessionStorageAdapter;
  currentHost: string;
  onClose?: () => void;
}

/**
 * Create and show the main notification
 */
export function createNotification(options: NotificationOptions): HTMLElement {
  const { match, settings, services, i18n, fetcher, sessionStorage, currentHost, onClose } = options;
  const service = match.service;

  // Create shadow host
  const shadowHost = createShadowHost();
  document.body.appendChild(shadowHost);
  const shadowRoot = shadowHost.attachShadow({ mode: "open" });

  // Inject styles
  injectStyles(shadowRoot, getNotificationStyles());

  // Create container
  const container = document.createElement("div");
  container.className = `container ${settings.getPosition()}`;
  container.setAttribute("role", "dialog");
  container.setAttribute("aria-label", i18n.getMessage("ariaNotificationLabel"));

  // Apply theme and service color
  applyThemeClass(shadowHost, settings.getTheme());
  if (service.color) {
    applyServiceColor(shadowHost, service.color);
  }

  // Header
  const header = createHeader(service, i18n);
  const { settingsBtn, minimizeBtn, closeBtn, headerRight } = createHeaderControls(
    match.cashbackDescription,
    i18n
  );
  header.appendChild(headerRight);

  // Body
  const body = document.createElement("div");
  body.className = "body";

  // Content section
  const content = document.createElement("div");
  content.className = "content";

  // Cashback display
  const cashback = createCashbackDisplay(match, container);

  // Subtitle
  const subtitle = document.createElement("span");
  subtitle.className = "subtitle";
  subtitle.textContent = i18n.getMessage("serviceBonusAt", [
    service.name,
    match.name || i18n.getMessage("thisStore"),
  ]);

  // Reminder checklist
  const reminder = document.createElement("p");
  reminder.className = "reminder";
  reminder.textContent = i18n.getMessage("rememberTo");

  const checklist = createChecklist(service, i18n);

  // Action button
  const { actionBtn, recheckIcon } = createActionButton(match, service, i18n, sessionStorage, currentHost, content);

  // Hide site link
  const hideSiteLink = document.createElement("span");
  hideSiteLink.className = "hide-site";
  hideSiteLink.textContent = i18n.getMessage("dontShowOnThisSite");
  hideSiteLink.setAttribute("role", "button");
  hideSiteLink.setAttribute("tabindex", "0");
  hideSiteLink.setAttribute("aria-label", i18n.getMessage("dontShowOnThisSite"));

  // Assemble content
  content.appendChild(cashback);
  content.appendChild(subtitle);
  content.appendChild(reminder);
  content.appendChild(checklist);
  content.appendChild(actionBtn);
  content.appendChild(hideSiteLink);
  body.appendChild(content);

  // Settings panel
  const settingsPanel = createSettingsPanel(settings, services, i18n, shadowHost, container);
  body.appendChild(settingsPanel);

  // Info link
  const infoLink = document.createElement("a");
  infoLink.className = "info-link";
  infoLink.href = "https://github.com/kristofferR/BonusVarsler";
  infoLink.target = "_blank";
  infoLink.rel = "noopener noreferrer";
  infoLink.textContent = "i";
  infoLink.title = i18n.getMessage("aboutExtension");

  // Assemble container
  container.appendChild(header);
  container.appendChild(body);
  container.appendChild(infoLink);
  shadowRoot.appendChild(container);

  // Apply initial minimized state
  if (settings.getStartMinimized()) {
    container.classList.add("minimized");
  }

  // Event handlers
  let draggableCleanup: CleanupFunction | null = null;

  function closeNotification() {
    draggableCleanup?.();
    shadowHost.remove();
    document.removeEventListener("keydown", handleKeydown);
    onClose?.();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      closeNotification();
    }
  }

  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    closeNotification();
  });
  document.addEventListener("keydown", handleKeydown);

  // Settings toggle
  const openSettings = (e: Event) => {
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

  // Minimize/expand toggle
  minimizeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    container.classList.add("minimized");
  });

  container.addEventListener("click", (e) => {
    const clickedHeader = (e.target as HTMLElement).closest(".header");
    if (container.classList.contains("minimized")) {
      container.classList.remove("minimized");
    } else if (clickedHeader) {
      container.classList.add("minimized");
    }
  });

  // Hide site
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

  // Adblock detection (skip for code-based services)
  if (service.type !== "code") {
    const originalHref = actionBtn.getAttribute("href") || "";
    const originalText = actionBtn.childNodes[0]?.textContent || "";

    const handleRecheck = async (e: Event) => {
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
        // On error, restore original state
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

    // Initial adblock check
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
      // Silently ignore detection failures
    });
  }

  // Make draggable
  draggableCleanup = makeCornerDraggable(container, async (position: Position) => {
    await settings.setPositionForSite(position);
  });

  return shadowHost;
}

function createHeader(service: Service, _i18n: I18nAdapter): HTMLDivElement {
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

function createHeaderControls(cashbackText: string, i18n: I18nAdapter) {
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

function createCashbackDisplay(match: MatchResult, container: HTMLElement): HTMLSpanElement {
  const cashback = document.createElement("span");
  cashback.className = "cashback";
  cashback.textContent = match.cashbackDescription || "";

  // Add tooltip for detailed cashback rates
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

    // Position tooltip on hover
    const positionTooltip = () => {
      const containerRect = container.getBoundingClientRect();
      const isRightSide =
        container.classList.contains("bottom-right") || container.classList.contains("top-right");

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

function createChecklist(service: Service, i18n: I18nAdapter): HTMLOListElement {
  const checklist = document.createElement("ol");
  checklist.className = "checklist";

  let items: string[];
  if (service.id === "dnb") {
    items = [
      i18n.getMessage("dnbInstruction1"),
      i18n.getMessage("dnbInstruction2"),
      i18n.getMessage("dnbInstruction3"),
    ];
  } else {
    items = [
      i18n.getMessage("disableAdblockers"),
      i18n.getMessage("acceptAllCookies"),
      i18n.getMessage("emptyCart"),
    ];
  }

  items.forEach((text) => {
    const li = document.createElement("li");
    li.textContent = text;
    checklist.appendChild(li);
  });

  return checklist;
}

function createActionButton(
  match: MatchResult,
  service: Service,
  i18n: I18nAdapter,
  sessionStorage: SessionStorageAdapter,
  currentHost: string,
  content: HTMLDivElement
): { actionBtn: HTMLAnchorElement; recheckIcon: HTMLSpanElement } {
  const actionBtn = document.createElement("a");
  actionBtn.className = "action-btn";

  // Build clickthrough URL
  const baseUrl = service.clickthroughUrl || "";
  const clickthroughUrl = baseUrl.includes("{urlName}")
    ? baseUrl.replace("{urlName}", match.urlName || "")
    : baseUrl;
  actionBtn.target = "_blank";
  actionBtn.rel = "noopener noreferrer";
  actionBtn.href = clickthroughUrl;

  // For code-based services, show the rebate code
  if (service.type === "code" && match.offer?.code) {
    actionBtn.classList.add("has-code");
    actionBtn.dataset.copied = "false";

    const codeText = document.createTextNode(match.offer.code);
    actionBtn.appendChild(codeText);

    const copyIcon = document.createElement("span");
    copyIcon.className = "copy-icon";
    copyIcon.textContent = "📋";
    copyIcon.title = i18n.getMessage("copyCode") || "Kopier kode";
    actionBtn.appendChild(copyIcon);
  } else {
    actionBtn.textContent = i18n.getMessage("getServiceBonus", service.name);
  }

  // Create recheck icon
  const recheckIcon = document.createElement("span");
  recheckIcon.className = "recheck-icon";
  recheckIcon.textContent = "↻";
  recheckIcon.title = i18n.getMessage("checkAdblockAgain");
  recheckIcon.setAttribute("role", "button");
  recheckIcon.setAttribute("tabindex", "0");
  recheckIcon.setAttribute("aria-label", i18n.getMessage("checkAdblockAgain"));
  actionBtn.appendChild(recheckIcon);

  // Click handler
  actionBtn.addEventListener("click", (e) => {
    // Don't proceed if adblock is detected - shake to indicate disabled
    if (actionBtn.classList.contains("adblock")) {
      e.preventDefault();
      actionBtn.style.animation = "shake 0.3s ease-in-out";
      actionBtn.addEventListener("animationend", () => {
        actionBtn.style.animation = "pulse 0.7s infinite alternate ease-in-out";
      }, { once: true });
      return;
    }

    sessionStorage.set(`${MESSAGE_SHOWN_KEY_PREFIX}${currentHost}`, Date.now().toString());

    // Code-based service handling
    if (service.type === "code" && match.offer?.code) {
      const copyIcon = actionBtn.querySelector(".copy-icon");
      if (actionBtn.dataset.copied !== "true") {
        e.preventDefault();

        // Guard against missing Clipboard API
        if (!navigator.clipboard || !navigator.clipboard.writeText) {
          if (copyIcon) {
            (copyIcon as HTMLElement).textContent = "⚠";
            (copyIcon as HTMLElement).title = i18n.getMessage("copyFailed") || "Kopiering feilet";
          }
          actionBtn.dataset.copied = "true";
          return;
        }

        navigator.clipboard
          .writeText(match.offer.code)
          .then(() => {
            if (copyIcon) {
              (copyIcon as HTMLElement).textContent = "✓";
            }
            actionBtn.dataset.copied = "true";
            window.getSelection()?.removeAllRanges();
          })
          .catch(() => {
            if (copyIcon) {
              (copyIcon as HTMLElement).textContent = "⚠";
              (copyIcon as HTMLElement).title = i18n.getMessage("copyFailed") || "Kopiering feilet";
            }
            actionBtn.dataset.copied = "true";
          });
        return;
      }
      return;
    }

    // Show confirmation for tracking-based services
    content.replaceChildren();
    const confirmation = document.createElement("div");
    confirmation.className = "confirmation";
    confirmation.textContent = i18n.getMessage("purchaseRegistered");
    content.appendChild(confirmation);
  });

  return { actionBtn, recheckIcon };
}

function createSettingsPanel(
  settings: Settings,
  services: ServiceRegistry,
  i18n: I18nAdapter,
  shadowHost: HTMLElement,
  container: HTMLElement
): HTMLDivElement {
  const panel = document.createElement("div");
  panel.className = "settings";

  // Services section
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

  // Settings grid
  const settingsGrid = document.createElement("div");
  settingsGrid.className = "settings-grid";

  // Theme row
  const themeRow = createThemeRow(settings, i18n, shadowHost);
  settingsGrid.appendChild(themeRow);

  // Position row
  const positionRow = createPositionRow(settings, i18n, container);
  settingsGrid.appendChild(positionRow);

  // Hidden sites row
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

  // Back link
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

function createThemeRow(
  settings: Settings,
  i18n: I18nAdapter,
  shadowHost: HTMLElement
): HTMLDivElement {
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
    { id: "system", label: i18n.getMessage("themeSystem") },
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
    const btn = (e.target as HTMLElement).closest(".theme-btn") as HTMLElement | null;
    if (!btn?.dataset.theme) return;

    const newTheme = btn.dataset.theme as "light" | "dark" | "system";
    await settings.setTheme(newTheme);
    applyThemeClass(shadowHost, newTheme);

    themeButtons.querySelectorAll(".theme-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
  });

  // Start minimized toggle
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

function createPositionRow(
  settings: Settings,
  i18n: I18nAdapter,
  container: HTMLElement
): HTMLDivElement {
  const positionRow = document.createElement("div");
  positionRow.className = "setting-row";

  const positionLabel = document.createElement("span");
  positionLabel.className = "setting-label";
  positionLabel.textContent = i18n.getMessage("defaultPosition");

  const positionButtons = document.createElement("div");
  positionButtons.className = "theme-buttons position-buttons";

  const defaultPosition = settings.getDefaultPosition();
  const positions = [
    { id: "top-left", label: "↖" },
    { id: "top-right", label: "↗" },
    { id: "bottom-left", label: "↙" },
    { id: "bottom-right", label: "↘" },
  ];

  positions.forEach((pos) => {
    const btn = document.createElement("span");
    btn.className = "theme-btn" + (defaultPosition === pos.id ? " active" : "");
    btn.textContent = pos.label;
    btn.dataset.position = pos.id;
    positionButtons.appendChild(btn);
  });

  positionButtons.addEventListener("click", async (e) => {
    const btn = (e.target as HTMLElement).closest(".theme-btn") as HTMLElement | null;
    if (!btn?.dataset.position) return;

    const newPosition = btn.dataset.position as Position;
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

function createHiddenSitesRow(
  settings: Settings,
  i18n: I18nAdapter,
  hiddenCount: number
): HTMLDivElement {
  const hiddenRow = document.createElement("div");
  hiddenRow.className = "setting-row";

  const hiddenLabel = document.createElement("span");
  hiddenLabel.className = "setting-label";
  hiddenLabel.textContent = i18n.getMessage("hiddenSites");

  const hiddenInfo = document.createElement("div");
  hiddenInfo.className = "hidden-sites-info";
  hiddenInfo.textContent =
    hiddenCount > 1
      ? i18n.getMessage("hiddenSitesCountPlural", hiddenCount.toString())
      : i18n.getMessage("hiddenSitesCount", hiddenCount.toString());

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
