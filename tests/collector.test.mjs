import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ISO_COUNTRY_CODES,
  collectSnapshot,
  convertAmount,
  fetchJsonWithRetry,
  mergeStaleRows,
  parsePriceResponse,
  validateCoverage,
  withConvertedAmounts,
} from "../scripts/collect-prices.mjs";

const fixtures = path.resolve(process.cwd(), "tests/fixtures");

async function fixture(name) {
  return JSON.parse(await readFile(path.join(fixtures, name), "utf8"));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("official Business monthly parser", () => {
  it("contains the full ISO alpha-2 probe list", () => {
    expect(ISO_COUNTRY_CODES).toHaveLength(249);
    expect(new Set(ISO_COUNTRY_CODES).size).toBe(249);
  });

  it.each([
    ["us.json", "US", 25, "USD", 2, "exclusive"],
    ["sg.json", "SG", 32, "SGD", 2, "exclusive"],
    ["in.json", "IN", 2250, "INR", 2, "exclusive"],
    ["jp.json", "JP", 3850, "JPY", 0, "exclusive"],
    ["de.json", "DE", 26, "EUR", 2, "inclusive"],
    ["br.json", "BR", 130, "BRL", 2, "exclusive"],
  ])("parses %s", async (name, code, amount, currency, exponent, tax) => {
    const row = parsePriceResponse(await fixture(name), code, "2026-07-22T00:00:00.000Z");
    expect(row).toMatchObject({
      countryCode: code,
      localAmount: amount,
      currencyCode: currency,
      minorUnitExponent: exponent,
      taxTreatment: tax,
      status: "fresh",
    });
  });

  it("rejects mismatched country responses", async () => {
    const raw = await fixture("us.json");
    expect(() => parsePriceResponse(raw, "SG")).toThrow(/Country mismatch/);
  });

  it("classifies a 404 response as unsupported", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(fetchJsonWithRetry("https://example.com/ZZ", { retries: 1 })).resolves.toEqual({
      kind: "unsupported",
      status: 404,
    });
  });
});

describe("conversion and snapshot guards", () => {
  const rates = { USD: 1, CNY: 6.8, SGD: 1.25 };

  it("converts local currency through USD", () => {
    expect(convertAmount(25, "USD", rates)).toEqual({ usdAmount: 25, cnyAmount: 170 });
    expect(convertAmount(32, "SGD", rates)).toEqual({ usdAmount: 25.6, cnyAmount: 174.08 });
  });

  it("rejects missing rates", () => {
    expect(() => convertAmount(100, "JPY", rates)).toThrow(/Missing FX rate/);
  });

  it("carries a failed row for at most fourteen days and refreshes its conversion", () => {
    const previous = {
      countryCode: "SG",
      countryName: "新加坡",
      currencyCode: "SGD",
      symbol: "S$",
      minorUnitExponent: 2,
      localAmount: 32,
      usdAmount: 99,
      cnyAmount: 99,
      taxTreatment: "exclusive",
      taxType: "gst",
      taxPercent: 9,
      status: "fresh",
      fetchedAt: "2026-07-10T00:00:00.000Z",
      sourceUrl: "https://chatgpt.com/backend-anon/checkout_pricing_config/configs/SG",
    };
    const rows = mergeStaleRows([], ["SG"], [previous], rates, new Date("2026-07-22T00:00:00.000Z"));
    expect(rows[0]).toMatchObject({ status: "stale", usdAmount: 25.6, cnyAmount: 174.08 });
    expect(mergeStaleRows([], ["SG"], [previous], rates, new Date("2026-07-26T00:00:00.000Z"))).toEqual([]);
  });

  it("enforces baseline and 90 percent coverage", () => {
    const us = withConvertedAmounts({
      countryCode: "US", countryName: "美国", currencyCode: "USD", symbol: "$", minorUnitExponent: 2,
      localAmount: 25, taxTreatment: "exclusive", taxType: "other", taxPercent: null,
      status: "fresh", fetchedAt: "2026-07-22T00:00:00.000Z", sourceUrl: "https://example.com/US",
    }, rates);
    const sg = withConvertedAmounts({ ...us, countryCode: "SG", countryName: "新加坡", currencyCode: "SGD", symbol: "S$", localAmount: 32 }, rates);
    const snapshot = { fx: { rates }, rows: [us, sg] };
    expect(() => validateCoverage(snapshot, null, 2)).not.toThrow();
    expect(() => validateCoverage(snapshot, { rows: Array.from({ length: 3 }) }, 2)).toThrow(/90%/);
  });

  it("builds a validated snapshot from pricing and FX responses", async () => {
    const usFixture = await fixture("us.json");
    const sgFixture = await fixture("sg.json");
    vi.stubGlobal("fetch", vi.fn(async (input) => {
      const url = String(input);
      if (url.endsWith("/US")) return { ok: true, status: 200, json: async () => usFixture };
      if (url.endsWith("/SG")) return { ok: true, status: 200, json: async () => sgFixture };
      if (url.endsWith("/ZZ")) return { ok: false, status: 404 };
      if (url.startsWith("https://api.frankfurter.dev/")) {
        return { ok: true, status: 200, json: async () => ({ base: "USD", date: "2026-07-22", rates: { CNY: 6.8, SGD: 1.25 } }) };
      }
      throw new Error(`Unexpected URL: ${url}`);
    }));

    const snapshot = await collectSnapshot({
      countryCodes: ["US", "SG", "ZZ"],
      generatedAt: "2026-07-22T00:00:00.000Z",
      concurrency: 2,
    });

    expect(snapshot.coverage).toEqual({ requested: 3, success: 2, unsupported: 1, failed: 0, stale: 0 });
    expect(snapshot.rows.map((row) => row.countryCode)).toEqual(["US", "SG"]);
    expect(snapshot.rows.find((row) => row.countryCode === "SG")).toMatchObject({ usdAmount: 25.6, cnyAmount: 174.08 });
    expect(() => validateCoverage(snapshot, null, 2)).not.toThrow();
  });
});
