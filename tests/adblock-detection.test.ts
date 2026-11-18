import { describe, expect, test } from "bun:test";
import { AD_TEST_URLS } from "../src/config/constants.ts";
import { checkAdUrlsBlocked } from "../src/core/adblock-detection.ts";

type Disposition = "enforce" | "report";

/**
 * Fails the probes in `failed`. The ones in `violations` also get a CSP violation event
 * right after the request settles, the way Firefox reports them.
 */
function probe(failed: readonly string[], violations: readonly string[], disposition: Disposition = "enforce") {
  const page = new EventTarget();
  const fetcher = {
    checkUrlBlocked: async (url: string) => {
      if (violations.includes(url)) {
        setTimeout(() => {
          page.dispatchEvent(
            Object.assign(new Event("securitypolicyviolation"), { blockedURI: url, disposition })
          );
        }, 0);
      }
      return failed.includes(url);
    },
  };
  return checkAdUrlsBlocked(fetcher, page);
}

describe("checkAdUrlsBlocked", () => {
  const [first = "", ...rest] = AD_TEST_URLS;

  test("reports a probe that failed without a CSP violation", async () => {
    expect(await probe([first], [])).toBe(true);
  });

  test("ignores probes the page's CSP blocked", async () => {
    expect(await probe(AD_TEST_URLS, AD_TEST_URLS)).toBe(false);
  });

  test("still reports an adblocked probe when the others hit the CSP", async () => {
    expect(await probe(AD_TEST_URLS, rest)).toBe(true);
  });

  test("reports a failed probe whose violation was only report-only", async () => {
    expect(await probe([first], [first], "report")).toBe(true);
  });

  test("reports nothing when every probe succeeds", async () => {
    expect(await probe([], [])).toBe(false);
  });
});
