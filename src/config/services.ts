/**
 * Service definitions for BonusVarsler
 * Canonical source is data/services.json, but we include fallback definitions
 * for when the feed is not yet loaded.
 */

export interface Service {
  id: string;
  name: string;
  clickthroughUrl?: string;
  reminderDomain?: string;
  cashbackPathPatterns?: string[]; // Path prefixes that indicate cashback pages (e.g., ["/cashback/", "/shop/"])
  color: string;
  defaultEnabled?: boolean;
  type?: "code" | "info"; // "code" for code-based (DNB), "info" for informational (OBOS)
  comingSoon?: boolean;
}

export interface ServiceRegistry {
  [key: string]: Service;
}

/**
 * Fallback service definitions
 * Used when feed is not yet loaded or for legacy feeds without services metadata.
 */
export const SERVICES_FALLBACK: ServiceRegistry = {
  trumf: {
    id: "trumf",
    name: "Trumf",
    clickthroughUrl: "https://trumfnetthandel.no/cashback/{urlName}",
    reminderDomain: "trumfnetthandel.no",
    color: "#4D4DFF",
    defaultEnabled: true,
  },
  sas: {
    id: "sas",
    name: "SAS EuroBonus",
    clickthroughUrl: "https://onlineshopping.flysas.com/nb-NO/butikker/{urlName}",
    reminderDomain: "onlineshopping.flysas.com",
    cashbackPathPatterns: ["/nb-NO/butikker"],
    color: "#0F1E82",
    defaultEnabled: false,
  },
  remember: {
    id: "remember",
    name: "re:member",
    clickthroughUrl: "https://www.remember.no/reward/rabatt/{urlName}",
    reminderDomain: "remember.no",
    color: "#f28d00",
    defaultEnabled: false,
  },
  dnb: {
    id: "dnb",
    name: "DNB",
    clickthroughUrl: "https://www.dnb.no/kundeprogram/fordeler/faste-rabatter",
    color: "#007272",
    defaultEnabled: false,
    type: "code",
  },
  obos: {
    id: "obos",
    name: "OBOS",
    clickthroughUrl: "https://www.obos.no/medlem/medlemsfordeler/{urlName}",
    color: "#0047ba",
    defaultEnabled: false,
    type: "info",
  },
  naf: {
    id: "naf",
    name: "NAF",
    clickthroughUrl: "https://www.naf.no/medlemskap/medlemsfordeler/{urlName}",
    reminderDomain: "naf.no",
    cashbackPathPatterns: ["/medlemskap/medlemsfordeler"],
    color: "#c9a000",
    defaultEnabled: false,
    type: "info",
  },
  lofavor: {
    id: "lofavor",
    name: "LOfavør",
    clickthroughUrl: "https://www.lofavor.no/{urlName}",
    color: "#66083c",
    defaultEnabled: false,
    type: "info",
  },
};

// Service display order (active services first, then coming soon)
export const SERVICE_ORDER = ["trumf", "sas", "remember", "dnb", "obos", "naf", "lofavor"] as const;

/**
 * Get default enabled services
 */
export function getDefaultEnabledServices(services: ServiceRegistry = SERVICES_FALLBACK): string[] {
  return Object.values(services)
    .filter((s) => s.defaultEnabled)
    .map((s) => s.id);
}

/**
 * Validate that a service has all required fields
 */
function isValidService(service: Partial<Service>): service is Service {
  return (
    typeof service.name === "string" &&
    service.name.length > 0 &&
    typeof service.color === "string" &&
    service.color.length > 0
  );
}

/**
 * Merge feed services with fallback (feed overrides, but missing fields preserved)
 */
export function mergeServices(
  feedServices: Record<string, Partial<Service>> | undefined,
  fallback: ServiceRegistry = SERVICES_FALLBACK
): ServiceRegistry {
  if (!feedServices) {
    return { ...fallback };
  }

  const merged: ServiceRegistry = { ...fallback };
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
