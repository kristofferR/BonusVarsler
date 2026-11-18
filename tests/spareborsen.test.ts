import { describe, expect, test } from "bun:test";
import {
  formatSpareborsenCashback,
  parseSpareborsenPartner,
  parseSpareborsenSitemap,
  type SpareborsenPartner,
} from "../scripts/spareborsen-parser.ts";

function sitemap(paths: string[]): string {
  const urls = paths.map((path) => `<url><loc>https://spareborsen.no${path}</loc></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;
}

// Mirrors how Next.js streams RSC flight data: JSON string literals pushed in chunks.
function storePage(flight: string, chunkSize = 120): string {
  const pushes: string[] = [];
  for (let i = 0; i < flight.length; i += chunkSize) {
    pushes.push(`<script>self.__next_f.push([1,${JSON.stringify(flight.slice(i, i + chunkSize))}])</script>`);
  }
  return `<html><body>${pushes.join("")}</body></html>`;
}

describe("parseSpareborsenSitemap", () => {
  test("returns Norwegian store slugs only", () => {
    const xml = sitemap([
      "/marketplace",
      "/partnere/kategori",
      "/partnere/kategori/mote",
      "/partnere/beste-cashback",
      "/partnere/pace",
      "/partnere/l-occitane/",
      "/en/partnere/pace",
      "/for-partnere",
    ]);

    expect(parseSpareborsenSitemap(xml)).toEqual(["pace", "l-occitane"]);
  });

  test("fails loudly when the sitemap shape changes", () => {
    expect(() =>
      parseSpareborsenSitemap('<sitemapindex><sitemap><loc>https://spareborsen.no/a.xml</loc></sitemap></sitemapindex>')
    ).toThrow("no longer a <urlset>");
    expect(() => parseSpareborsenSitemap(sitemap(["/marketplace"]))).toThrow("no /partnere/{slug}");
  });
});

describe("parseSpareborsenPartner", () => {
  const full = {
    id: "abc",
    name: "Newport",
    slug: "newport",
    description: 'Braces {in} "strings" are fine',
    cashbackPercent: 5.7,
    baseCashbackPercent: 4.8,
    cashbackType: "percentage",
    cashbackCurrency: null,
    websiteUrl: "https://www.newporthome.no",
    active: true,
    segments: [{ name: "Ordre", cashbackValue: 5.7, cashbackType: "percentage" }],
  };
  // Pages can embed a trimmed stub of the same partner before the full record
  const flight = [
    `1:["$","li",null,{"partner":{"id":"abc","name":"Newport","slug":"newport","websiteUrl":"https://www.newporthome.no"},"children":"Se hos Newport"}]`,
    `2:["$","$L2c",null,{"partner":"$25:props:children"}]`,
    `3:["$","$L2c",null,{"partner":${JSON.stringify(full)},"hasCoupons":false}]`,
  ].join("\n");

  test("finds the full partner record across flight chunks", () => {
    expect(parseSpareborsenPartner(storePage(flight), "newport")).toEqual(full as SpareborsenPartner);
  });

  test("ignores partner records for other slugs", () => {
    expect(parseSpareborsenPartner(storePage(flight), "pace")).toBeNull();
  });
});

describe("formatSpareborsenCashback", () => {
  const partner = (overrides: Partial<SpareborsenPartner>): SpareborsenPartner => ({
    name: "Store",
    slug: "store",
    websiteUrl: "https://store.no",
    cashbackType: "percentage",
    cashbackPercent: 14.3,
    cashbackCurrency: null,
    ...overrides,
  });

  test("formats percentages and fixed kroner amounts like the feed", () => {
    expect(formatSpareborsenCashback(partner({}))).toBe("14,3 %");
    expect(formatSpareborsenCashback(partner({ cashbackPercent: 19 }))).toBe("19 %");
    expect(
      formatSpareborsenCashback(partner({ cashbackType: "fixed", cashbackPercent: 94.5, cashbackCurrency: "NOK" }))
    ).toBe("94,5 kr");
  });

  test("skips missing rates and unknown types or currencies", () => {
    expect(formatSpareborsenCashback(partner({ cashbackPercent: 0 }))).toBeNull();
    expect(formatSpareborsenCashback(partner({ cashbackPercent: null }))).toBeNull();
    expect(formatSpareborsenCashback(partner({ cashbackType: "points" }))).toBeNull();
    expect(
      formatSpareborsenCashback(partner({ cashbackType: "fixed", cashbackPercent: 10, cashbackCurrency: "EUR" }))
    ).toBeNull();
  });
});
