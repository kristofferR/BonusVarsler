import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { AD_TEST_URLS } from "../src/config/constants.ts";
import { checkAdUrlsBlocked } from "../src/core/adblock-detection.ts";

interface Scenario {
  /** Probes that fail in the page */
  failed?: readonly string[];
  /** Probes that get a CSP violation event right after settling, the way Firefox reports them */
  violations?: readonly string[];
  disposition?: "enforce" | "report";
  /** Probes that never answer */
  stalled?: readonly string[];
  /** Result of the same probes outside the page; omitted on platforms without that context */
  outsideBlocked?: boolean;
}

function probe({ failed = [], violations = [], disposition = "enforce", stalled = [], outsideBlocked }: Scenario) {
  const page = new EventTarget();
  const checkUrlBlocked = (url: string) => {
    if (stalled.includes(url)) return new Promise<boolean>(() => {});
    if (violations.includes(url)) {
      setTimeout(() => {
        page.dispatchEvent(
          Object.assign(new Event("securitypolicyviolation"), { blockedURI: url, disposition })
        );
      }, 0);
    }
    return Promise.resolve(failed.includes(url));
  };
  const fetcher =
    outsideBlocked === undefined
      ? { checkUrlBlocked }
      : { checkUrlBlocked, checkUrlBlockedOutsidePage: async () => outsideBlocked };
  return checkAdUrlsBlocked(fetcher, page, 20);
}

describe("checkAdUrlsBlocked", () => {
  const [first, ...rest] = AD_TEST_URLS;
  const all = AD_TEST_URLS;

  test("reports a probe that failed without a CSP violation", async () => {
    expect(await probe({ failed: [first] })).toBe(true);
  });

  test("ignores probes the page's CSP blocked", async () => {
    expect(await probe({ failed: all, violations: all })).toBe(false);
  });

  test("still reports an adblocked probe when the others hit the CSP", async () => {
    expect(await probe({ failed: all, violations: rest })).toBe(true);
  });

  test("reports a failed probe whose violation was only report-only", async () => {
    expect(await probe({ failed: [first], violations: [first], disposition: "report" })).toBe(true);
  });

  test("reports a blocker found outside the page when the CSP blocked every probe", async () => {
    expect(await probe({ failed: all, violations: all, outsideBlocked: true })).toBe(true);
  });

  test("reports nothing when the CSP-blocked probes get through outside the page", async () => {
    expect(await probe({ failed: all, violations: all, outsideBlocked: false })).toBe(false);
  });

  test("a stalled probe does not hide a blocked one", async () => {
    expect(await probe({ failed: rest, stalled: [first] })).toBe(true);
  });

  test("reports nothing when every probe succeeds", async () => {
    expect(await probe({})).toBe(false);
  });
});

// background.js is hand-written and cannot import the constants
test("background.js allows exactly the probe URLs", () => {
  const source = readFileSync(new URL("../background.js", import.meta.url), "utf8");
  const list = source.match(/const AD_TEST_URLS = \[([^\]]*)\]/)?.[1] ?? "";
  const allowed = [...list.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  expect(allowed).toEqual([...AD_TEST_URLS]);
});
