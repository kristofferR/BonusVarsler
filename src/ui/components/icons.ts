/**
 * Icon data URIs (PNG files converted to base64 at build time)
 */

import { SERVICE_ORDER } from "../../config/services.js";

// Logo icons (64px for 2x retina, displayed at 32px)
import LOGO_ICON_URL from "../../../icons/icon-64.png";
import LOGO_ICON_REMEMBER_URL from "../../../icons/icon-64-remember.png";
import LOGO_ICON_SAS_URL from "../../../icons/icon-64-sas.png";
import LOGO_ICON_DNB_URL from "../../../icons/icon-64-dnb.png";
import LOGO_ICON_OBOS_URL from "../../../icons/icon-64-obos.png";
import LOGO_ICON_NAF_URL from "../../../icons/icon-64-naf.png";
import LOGO_ICON_LOFAVOR_URL from "../../../icons/icon-64-lofavor.png";

export { LOGO_ICON_URL, LOGO_ICON_REMEMBER_URL, LOGO_ICON_SAS_URL, LOGO_ICON_DNB_URL, LOGO_ICON_OBOS_URL, LOGO_ICON_NAF_URL, LOGO_ICON_LOFAVOR_URL };

// Service ID type derived from SERVICE_ORDER
export type ServiceId = (typeof SERVICE_ORDER)[number];

// Typed mapping of service IDs to logo icons
const SERVICE_LOGO_ICONS: Readonly<Partial<Record<ServiceId, string>>> = {
  trumf: LOGO_ICON_URL,
  sas: LOGO_ICON_SAS_URL,
  remember: LOGO_ICON_REMEMBER_URL,
  dnb: LOGO_ICON_DNB_URL,
  obos: LOGO_ICON_OBOS_URL,
  naf: LOGO_ICON_NAF_URL,
  lofavor: LOGO_ICON_LOFAVOR_URL,
} as const;

// Settings gear icon
export const SETTINGS_ICON_URI =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  );

/**
 * Get logo icon URL for a service
 * Accepts ServiceId for type-safe calls or string for dynamic service IDs
 */
export function getLogoIconForService(service: ServiceId | string): string {
  return SERVICE_LOGO_ICONS[service as ServiceId] ?? LOGO_ICON_URL;
}
