/**
 * Adblock detection
 * Detects if user has an adblocker that might interfere with tracking
 */

import type { FetchAdapter } from "../network/types.js";
import { AD_TEST_URLS, AD_BANNER_IDS, CONFIG } from "../config/constants.js";

// Firefox reports the CSP violation just after the blocked fetch rejects
const CSP_VIOLATION_GRACE_MS = 50;

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null; // e.g. "inline" or "eval"
  }
}

/**
 * Check if any ad test URL is blocked.
 * Firefox applies the page's CSP to content-script requests and userscripts may run in the
 * page itself, so a probe can fail without any adblocker. Those failures come with a
 * securitypolicyviolation event and are ignored.
 */
export async function checkAdUrlsBlocked(
  fetcher: Pick<FetchAdapter, "checkUrlBlocked">,
  violationTarget: EventTarget = document
): Promise<boolean> {
  const cspBlockedOrigins = new Set<string | null>();
  const onViolation = (event: Event) => {
    cspBlockedOrigins.add(originOf((event as SecurityPolicyViolationEvent).blockedURI));
  };
  violationTarget.addEventListener("securitypolicyviolation", onViolation);

  try {
    const results = await Promise.all(
      AD_TEST_URLS.map(async (url) => ({ url, blocked: await fetcher.checkUrlBlocked(url) }))
    );
    if (!results.some((result) => result.blocked)) return false;

    await new Promise((resolve) => setTimeout(resolve, CSP_VIOLATION_GRACE_MS));
    return results.some(({ url, blocked }) => blocked && !cspBlockedOrigins.has(originOf(url)));
  } finally {
    violationTarget.removeEventListener("securitypolicyviolation", onViolation);
  }
}

/**
 * Check if banner IDs are hidden (DOM-based detection)
 */
async function checkBannerIds(): Promise<boolean> {
  const container = document.createElement("div");
  container.style.cssText = "position:absolute;left:-9999px;top:-9999px;";

  AD_BANNER_IDS.forEach((id) => {
    const div = document.createElement("div");
    div.id = id;
    div.innerHTML = "&nbsp;";
    container.appendChild(div);
  });

  document.body.appendChild(container);

  // Give adblockers time to hide elements
  await new Promise((resolve) => setTimeout(resolve, 100));

  let blocked = false;
  AD_BANNER_IDS.forEach((id) => {
    const elem = document.getElementById(id);
    if (!elem || elem.offsetHeight === 0 || elem.offsetParent === null) {
      blocked = true;
    }
  });

  container.remove();
  return blocked;
}

/**
 * Utility to race a promise against a timeout
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("Timeout")), ms)),
  ]);
}

/**
 * Detect if adblock is enabled
 */
export async function detectAdblock(fetcher: FetchAdapter): Promise<boolean> {
  try {
    const checks = await withTimeout(
      Promise.all([checkAdUrlsBlocked(fetcher), checkBannerIds()]),
      CONFIG.adblockTimeout
    );

    // If any check returns true (blocked), adblock is detected
    return checks.some((blocked) => blocked);
  } catch {
    // On timeout, assume no adblock to avoid false positives
    return false;
  }
}
