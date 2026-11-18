/**
 * Parsing for OPRA's public supporter pages (opra.no/stottespillere).
 *
 * The discounts themselves are members-only, but each supporter page embeds the
 * partner's keywords, description links and discount percentages in the
 * Next.js RSC payload.
 */

export interface OpraDiscount {
  title?: string | null;
  discountPercentage?: number | null;
}

export interface OpraBusiness {
  name: string;
  slug?: { current?: string };
  keywords?: string[] | null;
  description?: Array<{ markDefs?: Array<{ _type?: string; href?: string }> }> | null;
  discounts?: OpraDiscount[] | null;
}

/** The previous feed's offers, as far as carrying OPRA offers over needs them. */
interface PreviousFeed {
  merchants: Record<
    string,
    { hostName: string; offers: Array<{ serviceId: string; urlName: string; cashbackDescription: string }> }
  >;
}

// Bare domains as OPRA writes them in partner keywords and discount titles ("HellyHansen.no").
// Unicode-aware boundaries keep "montér.no" from matching as "r.no", and "example.com.au"
// from matching as "example.com", while a sentence-ending period still ends the domain.
const DOMAIN_PATTERN =
  /(?<![\p{L}\p{N}.-])(?:[a-z0-9-]+\.)+(?:no|com|se|dk|fi|eu|net|org|io|shop|store)(?![\p{L}\p{N}-]|\.[\p{L}\p{N}])/giu;

// Description links to these hosts never identify the partner's own store
const IGNORED_LINK_HOSTS = [
  "opra.no",
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "youtube.com",
  "tiktok.com",
  "twitter.com",
  "x.com",
  "google.com",
  "apple.com",
];

/**
 * Decodes the RSC payload that Next.js inlines as `self.__next_f.push([1,"..."])` script chunks.
 */
export function extractNextFlightPayload(html: string): string {
  const chunks = html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g);
  return Array.from(chunks, (match) => JSON.parse(match[1]!) as string).join("");
}

/**
 * Parses the JSON object or array that follows the first `"key":` in an RSC payload.
 */
export function extractJsonAfterKey<T>(payload: string, key: string): T | null {
  const marker = `"${key}":`;
  const markerIndex = payload.indexOf(marker);
  const start = markerIndex + marker.length;
  if (markerIndex < 0 || !"[{".includes(payload[start] ?? "")) {
    return null;
  }

  let depth = 0;
  let inString = false;
  for (let i = start; i < payload.length; i++) {
    const char = payload[i];
    if (inString) {
      if (char === "\\") i++;
      else if (char === '"') inString = false;
    } else if (char === '"') {
      inString = true;
    } else if (char === "{" || char === "[") {
      depth++;
    } else if ((char === "}" || char === "]") && --depth === 0) {
      return JSON.parse(payload.slice(start, i + 1)) as T;
    }
  }

  return null;
}

/**
 * Formats a partner's percentages as "20 %", "5 - 15 %", "Opptil 25 %" or "2,5 %".
 * Titles win over `discountPercentage`, which holds only the top of a range
 * ("5-50 % rabatt" has 50) and drops "Opptil".
 */
export function formatOpraDiscounts(discounts: OpraDiscount[]): string {
  let upTo = false;
  const percentages = discounts.flatMap((discount) => {
    const title = discount.title ?? "";
    const fromTitle = Array.from(
      title.matchAll(/(\d+(?:[.,]\d+)?)(?:\s*[-–]\s*(\d+(?:[.,]\d+)?))?\s*%/g),
      (match) =>
        [match[1], match[2]]
          .filter((value): value is string => Boolean(value))
          .map((value) => Number(value.replace(",", ".")))
    ).flat();
    if (fromTitle.length > 0) {
      upTo ||= /\bopp\s*til\b/i.test(title);
      return fromTitle;
    }

    const percentage = discount.discountPercentage;
    return typeof percentage === "number" && percentage > 0 ? [percentage] : [];
  });

  if (percentages.length === 0) {
    return "";
  }

  const min = Math.min(...percentages);
  const max = Math.max(...percentages);
  const text = min !== max ? `${min} - ${max} %` : upTo ? `Opptil ${max} %` : `${max} %`;
  // Norwegian decimal comma, as in the other services' descriptions
  return text.replaceAll(".", ",");
}

/**
 * Finds the partner's own domains. Keywords and discount titles name them
 * directly; description links are only trusted when they agree on one host,
 * since partners also link to suppliers and affiliates.
 */
export function getOpraDomains(business: OpraBusiness): string[] {
  const named = [
    ...(business.keywords ?? []),
    ...(business.discounts ?? []).map((discount) => discount.title ?? ""),
  ].flatMap((text) => text.toLowerCase().match(DOMAIN_PATTERN) ?? []);

  const domains = new Set(named.map((domain) => domain.replace(/^www\./, "")));
  if (domains.size > 0) {
    return [...domains];
  }

  const linkHosts = new Set<string>();
  for (const block of business.description ?? []) {
    for (const mark of block.markDefs ?? []) {
      if (mark._type !== "link" || !mark.href?.startsWith("http")) continue;
      try {
        const host = new URL(mark.href).hostname.toLowerCase().replace(/^www\./, "");
        const ignored = IGNORED_LINK_HOSTS.some(
          (ignoredHost) => host === ignoredHost || host.endsWith(`.${ignoredHost}`)
        );
        if (!ignored) linkHosts.add(host);
      } catch {
        // Ignore malformed links
      }
    }
  }

  return linkHosts.size === 1 ? [...linkHosts] : [];
}

/**
 * Rebuilds entries for partners whose pages failed to load from their offers in
 * the previous feed, so one failed page keeps a partner's offers instead of
 * dropping them. `failedPartners` maps slug to partner name.
 */
export function previousOpraEntries(feed: PreviousFeed, failedPartners: Map<string, string>) {
  return Object.values(feed.merchants).flatMap(({ hostName, offers }) =>
    offers.flatMap(({ serviceId, urlName, cashbackDescription }) => {
      const name = serviceId === "opra" ? failedPartners.get(urlName) : undefined;
      return name === undefined
        ? []
        : [{ name, slug: urlName, cashbackDescription, storeUrl: `https://${hostName}` }];
    })
  );
}
