/**
 * Domain aliases mapping
 * Maps redirect targets to feed domains
 * Key = domain user visits, Value = domain in feed
 */

export const DOMAIN_ALIASES: Record<string, string> = {
  "nordicfeel.com": "nordicfeel.no",
  "www.nordicfeel.com": "www.nordicfeel.no",
  "lekmer.com": "lekmer.no",
  "www.lekmer.com": "lekmer.no",
  "lyko.com": "lyko.no",
  "www.lyko.com": "www.lyko.no",
  "storytel.com": "storytel.no",
  "www.storytel.com": "www.storytel.no",
  "beckmann-norway.com": "beckmann.no",
  "www.beckmann-norway.com": "beckmann.no",
  "nordicnest.no": "id.nordicnest.no",
  "www.nordicnest.no": "id.nordicnest.no",
  "dbjourney.com": "dbjourney.no",
  "www.dbjourney.com": "dbjourney.no",
  "bookbeat.com": "bookbeat.no",
  "www.bookbeat.com": "www.bookbeat.no",
  "outnorth.com": "outnorth.no",
  "www.outnorth.com": "outnorth.no",
  "no-pin.loccitane.com": "no.loccitane.com",
  "bilglass.no": "booking.bilglass.no",
  "www.bilglass.no": "booking.bilglass.no",
  "booking.fyriresort.com": "fyriresort.com",
  "www.oakley.com": "no.oakley.com",
  "www.viator.com": "www.viatorcom.no",
  "www.scandichotels.com": "www.scandichotels.no",
  "www.omio.com": "www.omio.no",
  "trip.com": "www.trip.com",
  "no.trip.com": "www.trip.com",
  "comfort.no": "www.bademiljo.no",
  "www.comfort.no": "www.bademiljo.no",
  "blivakker.no": "www.blivakker.no",
  "addresshotels.com": "www.addresshotels.com",
  "bravofly.com": "www.bravofly.com",
  "computersalg.no": "csmegastore.no",
  "www.computersalg.no": "csmegastore.no",
  "www.csmegastore.no": "csmegastore.no",
  "www.houdinisportswear.com": "houdinisportswear.com",
  "ralphlauren.global": "www.ralphlauren.global",
};

/**
 * Get aliased host for a given hostname
 * Returns the original hostname if no alias exists
 */
export function getAliasedHost(hostname: string): string {
  return DOMAIN_ALIASES[hostname] || hostname;
}

/**
 * Try to find a match in the aliases for a given host
 * Checks with and without www prefix
 */
export function resolveHostAlias(hostname: string): string | null {
  // Direct alias check
  if (DOMAIN_ALIASES[hostname]) {
    return DOMAIN_ALIASES[hostname];
  }

  // Check without www
  const noWww = hostname.replace(/^www\./, "");
  if (noWww !== hostname && DOMAIN_ALIASES[noWww]) {
    return DOMAIN_ALIASES[noWww];
  }

  // Check with www prefix (if not already starting with www)
  if (!hostname.startsWith("www.")) {
    const withWww = "www." + hostname;
    if (DOMAIN_ALIASES[withWww]) {
      return DOMAIN_ALIASES[withWww];
    }
  }

  return null;
}
