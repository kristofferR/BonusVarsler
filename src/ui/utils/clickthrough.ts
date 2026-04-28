import type { Service } from "../../config/services.js";

function encodePathSegment(segment: string): string {
  let decodedSegment = segment;
  try {
    decodedSegment = decodeURIComponent(segment);
  } catch {
    // Keep malformed input and encode it below.
  }

  if (decodedSegment === ".") {
    return "%2E";
  }

  if (decodedSegment === "..") {
    return "%2E%2E";
  }

  return encodeURIComponent(decodedSegment);
}

export function getSafeUrlNameForTemplate(templateUrl: string, urlName: string): string {
  const placeholderIndex = templateUrl.indexOf("{urlName}");
  const queryIndex = templateUrl.indexOf("?");
  if (queryIndex !== -1 && placeholderIndex > queryIndex) {
    return encodeURIComponent(urlName);
  }

  return urlName.split("/").map(encodePathSegment).join("/");
}

export function buildClickthroughUrl(templateUrl: string, urlName: string): string {
  if (!templateUrl) {
    return "";
  }

  return templateUrl.includes("{urlName}")
    ? templateUrl.replace("{urlName}", getSafeUrlNameForTemplate(templateUrl, urlName))
    : templateUrl;
}

function addAllowedHost(allowedHosts: Set<string>, hostname: string | undefined): void {
  if (hostname) {
    allowedHosts.add(hostname.toLowerCase());
  }
}

export function collectAllowedClickthroughHosts(service: Service): Set<string> {
  const allowedHosts = new Set<string>();
  addAllowedHost(allowedHosts, service.reminderDomain);

  try {
    addAllowedHost(allowedHosts, new URL(buildClickthroughUrl(service.clickthroughUrl || "", "")).hostname);
  } catch {
    // Services without parseable clickthrough URLs simply have no fallback host.
  }

  return allowedHosts;
}

function isAllowedClickthroughHost(hostname: string, allowedHosts: ReadonlySet<string>): boolean {
  if (allowedHosts.size === 0) {
    return false;
  }

  return allowedHosts.has(hostname.toLowerCase());
}

export function toSafeHttpsUrl(rawUrl: string, allowedHosts: ReadonlySet<string>): string {
  const trimmedUrl = rawUrl.trim();
  if (!trimmedUrl) {
    return "";
  }

  try {
    const parsedUrl = new URL(trimmedUrl);
    if (
      parsedUrl.protocol !== "https:" ||
      !parsedUrl.hostname ||
      !isAllowedClickthroughHost(parsedUrl.hostname, allowedHosts)
    ) {
      return "";
    }

    return parsedUrl.toString();
  } catch {
    return "";
  }
}

export function resolveClickthroughUrl(
  offerClickthroughUrl: string | undefined,
  service: Service,
  urlName: string
): string {
  const allowedHosts = collectAllowedClickthroughHosts(service);
  const fallbackUrl = buildClickthroughUrl(service.clickthroughUrl || "", urlName);

  return (
    toSafeHttpsUrl(offerClickthroughUrl || "", allowedHosts) ||
    toSafeHttpsUrl(fallbackUrl, allowedHosts)
  );
}

export function restoreActionButtonHref(actionBtn: HTMLAnchorElement, href: string): void {
  if (href) {
    actionBtn.href = href;
    actionBtn.target = "_blank";
    actionBtn.rel = "noopener noreferrer";
    actionBtn.removeAttribute("aria-disabled");
  } else {
    actionBtn.removeAttribute("href");
    actionBtn.removeAttribute("target");
    actionBtn.removeAttribute("rel");
    actionBtn.setAttribute("aria-disabled", "true");
  }
}
