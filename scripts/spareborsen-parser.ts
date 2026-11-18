/**
 * Parsers for Sparebørsen (spareborsen.no) store data.
 *
 * Store pages live at /partnere/{slug} and are listed in the sitemap. Each page is a
 * Next.js app router page whose RSC flight data embeds the full partner record.
 * Kept separate from scrape-feeds.ts so the parsing can be tested without running the scraper.
 */

export interface SpareborsenPartner {
  name: string;
  slug: string;
  websiteUrl: string | null;
  /** "percentage" or "fixed" (kroner amount) */
  cashbackType: string;
  /** Current rate. For "fixed" partners this holds the amount in cashbackCurrency, despite the name. */
  cashbackPercent: number | null;
  cashbackCurrency: string | null;
  active?: boolean;
}

// Non-store pages that share the /partnere/ prefix
const NON_STORE_SLUGS = new Set(["kategori", "beste-cashback"]);

/**
 * Extract store slugs from the sitemap. Throws if the sitemap no longer has the
 * expected <urlset> shape with /partnere/{slug} pages, so a layout change fails loudly.
 */
export function parseSpareborsenSitemap(xml: string): string[] {
  if (!/<urlset[\s>]/.test(xml)) {
    throw new Error("Sparebørsen sitemap is no longer a <urlset> document");
  }

  const slugs = new Set<string>();
  for (const [, loc] of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
    let pathname: string;
    try {
      pathname = new URL(loc!).pathname;
    } catch {
      continue;
    }

    // Only Norwegian top-level store pages; skips /en/partnere/... and /partnere/kategori/...
    const match = pathname.match(/^\/partnere\/([^/]+)\/?$/);
    if (!match) continue;

    const slug = decodeURIComponent(match[1]!);
    if (!NON_STORE_SLUGS.has(slug)) {
      slugs.add(slug);
    }
  }

  if (slugs.size === 0) {
    throw new Error("Sparebørsen sitemap has no /partnere/{slug} store pages");
  }

  return [...slugs];
}

/**
 * Concatenate the RSC flight payload pushed via self.__next_f.push([1, "..."]).
 */
function extractFlightData(html: string): string {
  const chunks: string[] = [];
  for (const [, literal] of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) {
    chunks.push(JSON.parse(literal!) as string);
  }
  return chunks.join("");
}

/**
 * Return the JSON object text starting at `start` (which must point at "{"),
 * respecting strings so braces inside values don't end the scan early.
 */
function sliceJsonObject(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null;
}

function isSpareborsenPartner(value: unknown): value is SpareborsenPartner {
  if (typeof value !== "object" || value === null) return false;
  const partner = value as Record<string, unknown>;
  return (
    typeof partner.name === "string" &&
    typeof partner.slug === "string" &&
    typeof partner.cashbackType === "string" &&
    (typeof partner.websiteUrl === "string" || partner.websiteUrl === null) &&
    (typeof partner.cashbackPercent === "number" || partner.cashbackPercent === null) &&
    (typeof partner.cashbackCurrency === "string" || partner.cashbackCurrency === null)
  );
}

/**
 * Find the full partner record for `slug` in a store page.
 * Pages can also embed trimmed partner stubs (name, slug, websiteUrl only), so
 * we keep looking until a record with cashback fields turns up.
 */
export function parseSpareborsenPartner(html: string, slug: string): SpareborsenPartner | null {
  const flight = extractFlightData(html);
  const marker = '"partner":{';

  for (let index = flight.indexOf(marker); index >= 0; index = flight.indexOf(marker, index + 1)) {
    const objectText = sliceJsonObject(flight, index + marker.length - 1);
    if (!objectText) continue;

    let candidate: unknown;
    try {
      candidate = JSON.parse(objectText);
    } catch {
      continue;
    }

    if (isSpareborsenPartner(candidate) && candidate.slug === slug) {
      return candidate;
    }
  }

  return null;
}

function formatAmount(value: number): string {
  return String(Math.round(value * 100) / 100).replace(".", ",");
}

/**
 * Format the cashback like the existing feed and Sparebørsen itself: "14,3 %" or "94,5 kr".
 * Returns null when there is no usable rate.
 */
export function formatSpareborsenCashback(partner: SpareborsenPartner): string | null {
  const value = partner.cashbackPercent;
  if (value === null || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  if (partner.cashbackType === "percentage") {
    return `${formatAmount(value)} %`;
  }

  if (partner.cashbackType === "fixed" && (partner.cashbackCurrency ?? "NOK") === "NOK") {
    return `${formatAmount(value)} kr`;
  }

  return null;
}
