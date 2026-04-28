import { describe, expect, test } from "bun:test";
import type { Service } from "../src/config/services.ts";
import {
  buildClickthroughUrl,
  collectAllowedClickthroughHosts,
  encodePathSegment,
  getSafeUrlNameForTemplate,
  resolveClickthroughUrl,
  toSafeHttpsUrl,
} from "../src/ui/utils/clickthrough.ts";

function service(overrides: Partial<Service> = {}): Service {
  return {
    id: "example",
    name: "Example",
    color: "#000000",
    clickthroughUrl: "https://portal.example.com/shop/{urlName}",
    reminderDomain: "Reminder.Example.com",
    ...overrides,
  };
}

describe("encodePathSegment", () => {
  test("encodes malformed percent input and dot path tokens", () => {
    expect(encodePathSegment("%E0%A4%A")).toBe("%25E0%25A4%25A");
    expect(encodePathSegment(".")).toBe("%252E");
    expect(encodePathSegment("..")).toBe("%252E%252E");
    expect(encodePathSegment("store name")).toBe("store%20name");
  });
});

describe("template URL builders", () => {
  test("encodes urlName as path segments when placeholder is in the path", () => {
    expect(
      getSafeUrlNameForTemplate(
        "https://portal.example.com/shop/{urlName}",
        "store name/../%E0%A4%A"
      )
    ).toBe("store%20name/%252E%252E/%25E0%25A4%25A");

    expect(
      buildClickthroughUrl(
        "https://portal.example.com/shop/{urlName}",
        "store name/.."
      )
    ).toBe("https://portal.example.com/shop/store%20name/%252E%252E");
  });

  test("encodes urlName as a single component when placeholder is in the query", () => {
    expect(
      getSafeUrlNameForTemplate(
        "https://portal.example.com/search?q={urlName}",
        "store/name value"
      )
    ).toBe("store%2Fname%20value");

    expect(buildClickthroughUrl("https://portal.example.com/static", "ignored")).toBe(
      "https://portal.example.com/static"
    );
  });
});

describe("collectAllowedClickthroughHosts", () => {
  test("normalizes reminder and parsed clickthrough hosts", () => {
    const hosts = collectAllowedClickthroughHosts(
      service({ clickthroughUrl: "https://Shop.Example.org/path/{urlName}" })
    );

    expect([...hosts].sort()).toEqual(["reminder.example.com", "shop.example.org"]);
  });

  test("ignores invalid clickthrough templates", () => {
    const hosts = collectAllowedClickthroughHosts(
      service({ clickthroughUrl: "not a url {urlName}" })
    );

    expect([...hosts]).toEqual(["reminder.example.com"]);
  });
});

describe("toSafeHttpsUrl", () => {
  const allowedHosts = new Set(["portal.example.com"]);

  test("accepts HTTPS URLs on allowed hosts", () => {
    expect(toSafeHttpsUrl("https://portal.example.com/path?x=1", allowedHosts)).toBe(
      "https://portal.example.com/path?x=1"
    );
  });

  test("rejects non-HTTPS, unknown hosts, and malformed URLs", () => {
    expect(toSafeHttpsUrl("http://portal.example.com/path", allowedHosts)).toBe("");
    expect(toSafeHttpsUrl("https://evil.example.com/path", allowedHosts)).toBe("");
    expect(toSafeHttpsUrl("%not-a-url", allowedHosts)).toBe("");
  });
});

describe("resolveClickthroughUrl", () => {
  test("prefers a safe offer clickthrough URL over the service fallback", () => {
    expect(
      resolveClickthroughUrl("https://portal.example.com/direct", service(), "fallback")
    ).toBe("https://portal.example.com/direct");
  });

  test("falls back to the sanitized service URL when the offer URL is unsafe", () => {
    expect(
      resolveClickthroughUrl("https://evil.example.com/direct", service(), "store name/..")
    ).toBe("https://portal.example.com/shop/store%20name/%252E%252E");
  });

  test("returns empty when neither offer nor fallback URL is safe", () => {
    expect(
      resolveClickthroughUrl(
        "http://portal.example.com/direct",
        service({ clickthroughUrl: "not a url {urlName}", reminderDomain: undefined }),
        "fallback"
      )
    ).toBe("");
  });
});
