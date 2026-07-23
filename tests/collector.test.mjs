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
  sourceUrl,
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

  it("recovers omitted currency metadata from safe fallbacks", async () => {
    const us = await fixture("us.json");
    delete us.symbol_code;
    delete us.symbol;
    delete us.minor_unit_exponent;
    us.currency_config.business.year = { amount: 20 };
    us.amount_per_credit = 0.04;
    expect(parsePriceResponse(us, "US")).toMatchObject({
      currencyCode: "USD",
      currencySource: "usd-profile",
      symbol: "$",
      minorUnitExponent: 2,
    });

    const sg = await fixture("sg.json");
    delete sg.symbol_code;
    delete sg.symbol;
    sg.pricing_rollout_gate = "is_pricing_enabled_for_sgd";
    expect(parsePriceResponse(sg, "SG")).toMatchObject({ currencyCode: "SGD", currencySource: "rollout" });

    const br = await fixture("br.json");
    delete br.symbol_code;
    delete br.symbol;
    expect(parsePriceResponse(br, "BR")).toMatchObject({ currencyCode: "BRL", currencySource: "country-default" });
  });

  it("classifies a 404 response as unsupported", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(fetchJsonWithRetry("https://example.com/ZZ", { retries: 1 })).resolves.toEqual({
      kind: "unsupported",
      status: 404,
    });
  });

  it("sends the stable OpenAI route headers without session identifiers", async () => {
    const raw = await fixture("us.json");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(raw));
    vi.stubGlobal("fetch", fetchMock);
    await fetchJsonWithRetry(sourceUrl("US"), { retries: 1 });
    const headers = fetchMock.mock.calls[0][1].headers;
    expect(headers["x-openai-target-path"]).toBe("/backend-anon/checkout_pricing_config/configs/US");
    expect(headers["x-openai-target-route"]).toBe("/backend-anon/checkout_pricing_config/configs/{country_code}");
    expect(headers.referer).toBe("https://chatgpt.com/zh-Hans-CN/pricing/");
    expect(Object.keys(headers).some((key) => /session|device|cookie/i.test(key))).toBe(false);
  });

  it("includes a safe response preview when an edge rejects the request", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      headers: { get: (name) => name === "server" ? "cloudflare" : "text/html" },
      text: async () => "Access denied by edge policy",
    }));
    await expect(fetchJsonWithRetry(sourceUrl("US"), { retries: 1 })).rejects.toThrow(/HTTP 403.*Access denied/);
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
      if (url.endsWith("/US")) return jsonResponse(usFixture);
      if (url.endsWith("/SG")) return jsonResponse(sgFixture);
      if (url.endsWith("/ZZ")) return { ok: false, status: 404 };
      if (url.startsWith("https://api.frankfurter.dev/")) {
        return jsonResponse({ base: "USD", date: "2026-07-22", rates: { CNY: 6.8, SGD: 1.25 } });
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

function jsonResponse(data) {
  return {
    ok: true,
    status: 200,
    headers: { get: (name) => name === "content-type" ? "application/json" : null },
    text: async () => JSON.stringify(data),
  };
}
