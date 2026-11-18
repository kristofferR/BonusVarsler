import { describe, expect, test } from "bun:test";
import { SERVICES_FALLBACK } from "../src/config/services.ts";
import { fillSpennId, needsSpennId, normalizeSpennId } from "../src/core/spenn-id.ts";
import { resolveClickthroughUrl } from "../src/ui/utils/clickthrough.ts";
import { compareCashbackRates, parseCashbackRate } from "../src/core/merchant-matching.ts";

const spenn = SERVICES_FALLBACK.spenn!;
const storeId = "39d24592-869a-4c88-918e-167d67f26215";
const catalogUrl = `https://spenn.refunder.com/click?site=4aefb3fa-6549-11ef-be75-0aaed722973b&store=${storeId}&source=browser-extension&spennId={spennId}`;

describe("normalizeSpennId", () => {
  test("accepts 9 digits, ignoring spaces the app shows between groups", () => {
    expect(normalizeSpennId("123 456 789")).toBe("123456789");
    expect(normalizeSpennId(" 123 456 789 ")).toBe("123456789");
  });

  test("rejects anything that isn't a non-zero 9-digit number", () => {
    expect(normalizeSpennId("")).toBeNull();
    expect(normalizeSpennId("12345678")).toBeNull();
    expect(normalizeSpennId("1234567890")).toBeNull();
    expect(normalizeSpennId("12345678a")).toBeNull();
    expect(normalizeSpennId("000000000")).toBeNull();
  });
});

describe("Spenn clickthrough", () => {
  test("keeps the placeholder through URL sanitizing so it can be filled on click", () => {
    const resolved = resolveClickthroughUrl(catalogUrl, spenn, storeId);
    expect(needsSpennId(resolved)).toBe(true);
    expect(fillSpennId(resolved, "123456789")).toBe(catalogUrl.replace("{spennId}", "123456789"));
  });

  test("falls back to the service template with the store id", () => {
    const resolved = resolveClickthroughUrl(undefined, spenn, storeId);
    expect(fillSpennId(resolved, "123456789")).toBe(catalogUrl.replace("{spennId}", "123456789"));
  });

  test("rejects offer URLs on other hosts", () => {
    const resolved = resolveClickthroughUrl(
      "https://evil.example/click?spennId={spennId}",
      spenn,
      storeId
    );
    expect(resolved.startsWith("https://spenn.refunder.com/click?")).toBe(true);
  });
});

describe("Spenn rate ranking", () => {
  test("reads the spend as a denominator, not a fixed kroner reward", () => {
    const low = parseCashbackRate("1 Spenn / 10 kr");
    const high = parseCashbackRate("Opptil 12 Spenn / 10 kr");
    expect(low).toEqual({ value: 1, type: "percent", isVariable: false });
    expect(high.value).toBeCloseTo(12);
    expect(compareCashbackRates(high, low)).toBe(-1);
  });

  test("values fixed Spenn rewards, including nb-NO thousand separators", () => {
    expect(parseCashbackRate("480 Spenn").value).toBeCloseTo(48);
    expect(parseCashbackRate("Opptil 1 020 Spenn (Årsabonnement)")).toMatchObject({
      type: "fixed",
      isVariable: true,
    });
    expect(parseCashbackRate("Opptil 1 020 Spenn (Årsabonnement)").value).toBeCloseTo(102);
  });
});
