/**
 * Shadow DOM host creation
 */

import type { Theme } from "../../config/constants.js";

/**
 * Create a shadow host element for the notification
 */
export function createShadowHost(): HTMLElement {
  const shadowHost = document.createElement("div");
  shadowHost.style.cssText =
    "all:initial !important;position:fixed !important;bottom:0 !important;right:0 !important;z-index:2147483647 !important;display:block !important;visibility:visible !important;opacity:1 !important;pointer-events:auto !important;";
  return shadowHost;
}

/**
 * Apply theme class to shadow host
 */
export function applyThemeClass(shadowHost: HTMLElement, theme: Theme): void {
  shadowHost.className = `tbvl-${theme}`;
}

/**
 * Apply service-specific accent color
 */
export function applyServiceColor(shadowHost: HTMLElement, color: string): void {
  shadowHost.style.setProperty("--accent", color);
  shadowHost.style.setProperty("--btn-bg-active", color);

  // Calculate hover color (slightly darker)
  const hoverColor = color.replace(
    /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i,
    (_, r, g, b) => {
      const darken = (hex: string) =>
        Math.max(0, parseInt(hex, 16) - 30)
          .toString(16)
          .padStart(2, "0");
      return `#${darken(r)}${darken(g)}${darken(b)}`;
    }
  );
  shadowHost.style.setProperty("--accent-hover", hoverColor);
}

/**
 * Inject styles into shadow root
 */
export function injectStyles(shadowRoot: ShadowRoot, css: string): void {
  const styleEl = document.createElement("style");
  styleEl.textContent = css;
  shadowRoot.appendChild(styleEl);
}

/**
 * Safely append an element to document.body.
 * At @run-at document-start (userscript), document.body may not exist yet.
 */
export function appendToBody(element: HTMLElement): void {
  if (document.body) {
    document.body.appendChild(element);
  } else {
    document.addEventListener("DOMContentLoaded", () => {
      document.body.appendChild(element);
    }, { once: true });
  }
}
