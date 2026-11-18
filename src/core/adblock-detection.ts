/**
 * Adblock detection
 * Detects if user has an adblocker that might interfere with tracking
 */

import type { FetchAdapter } from "../network/types.js";
import { AD_TEST_URLS, AD_BANNER_IDS, CONFIG } from "../config/constants.js";

// Firefox reports the CSP violation just after the blocked fetch rejects
const CSP_VIOLATION_GRACE_MS = 50;

/**
 * A probe that has not answered in time counts as not blocked, to avoid false positives
 */
function settled(probe: Promise<boolean>, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    probe.then(resolve, () => resolve(false)).finally(() => clearTimeout(timer));
  });
}

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
 * securitypolicyviolation event. Report-only policies fire the event too but block nothing,
 * so only enforced violations count.
 */
export async function checkAdUrlsBlocked(
  fetcher: Pick<FetchAdapter, "checkUrlBlocked" | "checkUrlBlockedOutsidePage">,
  violationTarget: EventTarget = document,
  timeoutMs: number = CONFIG.adblockTimeout
): Promise<boolean> {
  const cspBlockedOrigins = new Set<string>();
  const onViolation = (event: Event) => {
    const violation = event as SecurityPolicyViolationEvent;
    const origin = originOf(violation.blockedURI);
    if (violation.disposition === "enforce" && origin) cspBlockedOrigins.add(origin);
  };
  violationTarget.addEventListener("securitypolicyviolation", onViolation);

  let failed: string[];
  try {
    const results = await Promise.all(
      AD_TEST_URLS.map(async (url) => ({
        url,
        blocked: await settled(fetcher.checkUrlBlocked(url), timeoutMs),
      }))
    );
    failed = results.filter((result) => result.blocked).map((result) => result.url);
    if (failed.length === 0) return false;

    await new Promise((resolve) => setTimeout(resolve, CSP_VIOLATION_GRACE_MS));
  } finally {
    violationTarget.removeEventListener("securitypolicyviolation", onViolation);
  }

  // A failure the page's CSP does not explain is an adblocker
  if (failed.some((url) => !cspBlockedOrigins.has(new URL(url).origin))) return true;

  // The CSP stopped every failed probe before an adblocker could. Repeat them outside the
  // page, which catches network-level blockers such as DNS filters.
  const probeOutside = fetcher.checkUrlBlockedOutsidePage?.bind(fetcher);
  if (!probeOutside) return false;
  const outside = await Promise.all(failed.map((url) => settled(probeOutside(url), timeoutMs)));
  return outside.some((blocked) => blocked);
}

/**
 * Check if banner IDs are hidden (DOM-based detection)
 */
async function checkBannerIds(): Promise<boolean> {
  const container = document.createElement("div");
  container.style.cssText = "position:absolute;left:-9999px;top:-9999px;";

  const baits = AD_BANNER_IDS.map((id) => {
    const div = document.createElement("div");
    div.id = id;
    div.innerHTML = "&nbsp;";
    container.appendChild(div);
    return div;
  });

  document.body.appendChild(container);

  // Give adblockers time to hide elements
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Measure our own elements: the page may have one with the same id
  const blocked = baits.some(
    (bait) => !bait.isConnected || bait.offsetHeight === 0 || bait.offsetParent === null
  );

  container.remove();
  return blocked;
}

/**
 * Detect if adblock is enabled
 */
export async function detectAdblock(fetcher: FetchAdapter): Promise<boolean> {
  // The URL probes time out on their own, so a stalled one cannot hide the bait result
  const checks = await Promise.all([checkAdUrlsBlocked(fetcher), checkBannerIds()]);
  return checks.some((blocked) => blocked);
}
