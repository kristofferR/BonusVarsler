import { describe, expect, test } from "bun:test";
import { CURRENT_VERSION, STORAGE_KEYS } from "../src/config/constants.ts";
import { canSkipPage } from "../src/main.ts";
import type { StorageAdapter } from "../src/storage/types.ts";

// State of a set-up install that has a cached host index
const SETTLED = {
  [STORAGE_KEYS.version]: CURRENT_VERSION,
  [STORAGE_KEYS.setupComplete]: true,
  [STORAGE_KEYS.hostIndex]: ["www.hotels.com", "komplett.no"],
};

function storageWith(values: Record<string, unknown>): StorageAdapter {
  return {
    get: async <T>(key: string, defaultValue: T) =>
      key in values ? (values[key] as T) : defaultValue,
    set: async () => {},
    remove: async () => {},
  };
}

describe("canSkipPage", () => {
  test("skips a host that is not in the merchant index", async () => {
    expect(await canSkipPage(storageWith(SETTLED), "www.vg.no", "/")).toBe(true);
  });

  test.each([
    ["a known merchant", SETTLED, "www.hotels.com", "/"],
    ["a known merchant without its www prefix", SETTLED, "hotels.com", "/"],
    ["a cashback portal page", SETTLED, "trumfnetthandel.no", "/cashback/komplett"],
    ["a missing host index", { ...SETTLED, [STORAGE_KEYS.hostIndex]: null }, "www.vg.no", "/"],
    ["a corrupt host index", { ...SETTLED, [STORAGE_KEYS.hostIndex]: {} }, "www.vg.no", "/"],
    ["a pending migration", { ...SETTLED, [STORAGE_KEYS.version]: "9.0" }, "www.vg.no", "/"],
    ["unfinished first-run setup", { ...SETTLED, [STORAGE_KEYS.setupComplete]: false }, "www.vg.no", "/"],
  ])("runs the full flow for %s", async (_case, values, host, pathname) => {
    expect(await canSkipPage(storageWith(values), host, pathname)).toBe(false);
  });
});
