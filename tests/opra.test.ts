import { describe, expect, test } from "bun:test";
import {
  extractJsonAfterKey,
  extractNextFlightPayload,
  formatOpraDiscounts,
  getOpraDomains,
  type OpraBusiness,
} from "../scripts/opra.ts";

function business(overrides: Partial<OpraBusiness> = {}): OpraBusiness {
  return { name: "Example", ...overrides };
}

describe("extractNextFlightPayload", () => {
  test("decodes and joins the inlined RSC chunks", () => {
    const html = [
      '<script>self.__next_f.push([0])</script>',
      '<script>self.__next_f.push([1,"a:{\\"name\\":"])</script>',
      '<script>self.__next_f.push([1,"\\"Øh3\\"}\\n"])</script>',
    ].join("");

    expect(extractNextFlightPayload(html)).toBe('a:{"name":"Øh3"}\n');
  });
});

describe("extractJsonAfterKey", () => {
  test("parses the value even when strings contain brackets and escaped quotes", () => {
    const payload = 'x:{"business":{"name":"A \\"}]\\" B","discounts":[{"title":"{20 %]"}]},"other":1}';

    expect(extractJsonAfterKey(payload, "business")).toEqual({
      name: 'A "}]" B',
      discounts: [{ title: "{20 %]" }],
    });
  });

  test("returns null when the key is missing or not an object", () => {
    expect(extractJsonAfterKey('{"business":null}', "business")).toBeNull();
    expect(extractJsonAfterKey('{"other":{}}', "business")).toBeNull();
  });
});

describe("formatOpraDiscounts", () => {
  test("formats a single percentage or a range across discounts", () => {
    expect(formatOpraDiscounts([{ discountPercentage: 20 }])).toBe("20 %");
    expect(
      formatOpraDiscounts([{ discountPercentage: 15 }, { discountPercentage: 5 }])
    ).toBe("5 - 15 %");
  });

  test("prefers the title, which keeps ranges and 'Opptil'", () => {
    expect(formatOpraDiscounts([{ title: "4 % rabatt hos Polestar", discountPercentage: null }])).toBe("4 %");
    expect(formatOpraDiscounts([{ title: "5-50 % rabatt hos Dekkstra", discountPercentage: 50 }])).toBe("5 - 50 %");
    expect(
      formatOpraDiscounts([{ title: "Opptil 25 % rabatt hos Radisson Hotels", discountPercentage: 25 }])
    ).toBe("Opptil 25 %");
  });

  test("uses discountPercentage when the title has no percentage", () => {
    expect(formatOpraDiscounts([{ title: "Kampanje: Outnorth", discountPercentage: 25 }])).toBe("25 %");
  });

  test("returns an empty description when no percentage is known", () => {
    expect(formatOpraDiscounts([{ title: "Gode rabatter hos Hertz" }])).toBe("");
  });
});

describe("getOpraDomains", () => {
  test("collects domains from keywords and discount titles", () => {
    const domains = getOpraDomains(
      business({
        keywords: ["helly", "hellyhansen.com", "www.hellyhansen.com"],
        discounts: [{ title: "20 % rabatt hos HellyHansen.no " }],
      })
    );

    expect(domains).toEqual(["hellyhansen.com", "hellyhansen.no"]);
  });

  test("does not match the ASCII tail of a non-ASCII domain", () => {
    expect(getOpraDomains(business({ keywords: ["montér.no", "optimera.no"] }))).toEqual([
      "optimera.no",
    ]);
  });

  test("uses description links only when they agree on one host", () => {
    const linked = (...hrefs: string[]) =>
      business({
        description: [{ markDefs: hrefs.map((href) => ({ _type: "link", href })) }],
      });

    expect(
      getOpraDomains(
        linked(
          "https://www.polestar.com/no/",
          "https://www.polestar.com/no/test-drive",
          "https://www.instagram.com/polestar",
          "mailto:post@polestar.com"
        )
      )
    ).toEqual(["polestar.com"]);
    expect(
      getOpraDomains(linked("https://www.sykehusapotekene.no/", "https://dinkroppdinhelse.com/"))
    ).toEqual([]);
  });
});
