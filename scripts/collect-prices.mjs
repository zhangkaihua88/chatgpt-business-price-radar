import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";

export const ISO_COUNTRY_CODES = `
AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ
BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ
CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ
DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR
GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY
HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP
KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY
MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ
NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY
QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ
TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ
VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW
`.trim().split(/\s+/).sort();

export const PRICING_URL_TEMPLATE = "https://chatgpt.com/backend-anon/checkout_pricing_config/configs/{country_code}";
const FRANKFURTER_URL = "https://api.frankfurter.dev/v1/latest";
const OPEN_EXCHANGE_URL = "https://open.er-api.com/v6/latest/USD";
const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_RETRIES = 3;
const DEFAULT_CONCURRENCY = 4;
const STALE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

const upstreamSchema = z.object({
  country_code: z.string().length(2),
  currency_config: z.object({
    business: z.object({
      month: z.object({
        amount: z.number().positive().finite(),
        tax: z.enum(["inclusive", "exclusive"]),
      }),
    }),
  }),
  symbol_code: z.string().length(3),
  symbol: z.string().min(1),
  minor_unit_exponent: z.number().int().min(0).max(4).optional().default(2),
  tax_type: z.string().min(1).nullable().optional(),
  tax_percent: z.number().finite().nullable().optional(),
}).passthrough();

const snapshotSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string(),
  rows: z.array(z.object({
    countryCode: z.string().length(2),
    countryName: z.string(),
    currencyCode: z.string().length(3),
    symbol: z.string(),
    minorUnitExponent: z.number().int(),
    localAmount: z.number(),
    usdAmount: z.number(),
    cnyAmount: z.number(),
    taxTreatment: z.enum(["inclusive", "exclusive"]),
    taxType: z.string().nullable(),
    taxPercent: z.number().nullable(),
    status: z.enum(["fresh", "stale"]),
    fetchedAt: z.string(),
    sourceUrl: z.string().url(),
  })),
}).passthrough();

const countryNames = new Intl.DisplayNames(["zh-CN"], { type: "region" });

export function sourceUrl(countryCode) {
  return PRICING_URL_TEMPLATE.replace("{country_code}", countryCode.toUpperCase());
}

export function parsePriceResponse(raw, requestedCode, fetchedAt = new Date().toISOString()) {
  const data = upstreamSchema.parse(raw);
  const countryCode = requestedCode.toUpperCase();
  if (data.country_code.toUpperCase() !== countryCode) {
    throw new Error(`Country mismatch: requested ${countryCode}, received ${data.country_code}`);
  }

  return {
    countryCode,
    countryName: countryNames.of(countryCode) || countryCode,
    currencyCode: data.symbol_code.toUpperCase(),
    symbol: data.symbol,
    minorUnitExponent: data.minor_unit_exponent,
    localAmount: data.currency_config.business.month.amount,
    taxTreatment: data.currency_config.business.month.tax,
    taxType: data.tax_type ?? null,
    taxPercent: data.tax_percent ?? null,
    status: "fresh",
    fetchedAt,
    sourceUrl: sourceUrl(countryCode),
  };
}

export function convertAmount(localAmount, currencyCode, rates) {
  const localRate = currencyCode === "USD" ? 1 : Number(rates[currencyCode]);
  const cnyRate = Number(rates.CNY);
  if (!Number.isFinite(localRate) || localRate <= 0) throw new Error(`Missing FX rate for ${currencyCode}`);
  if (!Number.isFinite(cnyRate) || cnyRate <= 0) throw new Error("Missing FX rate for CNY");
  const rawUsd = localAmount / localRate;
  return {
    usdAmount: roundMoney(rawUsd),
    cnyAmount: roundMoney(rawUsd * cnyRate),
  };
}

export function withConvertedAmounts(row, rates) {
  return { ...row, ...convertAmount(row.localAmount, row.currencyCode, rates) };
}

export function mergeStaleRows(freshRows, failedCodes, previousRows, rates, now = new Date()) {
  const freshCodes = new Set(freshRows.map((row) => row.countryCode));
  const failed = new Set(failedCodes);
  const staleRows = previousRows
    .filter((row) => failed.has(row.countryCode) && !freshCodes.has(row.countryCode))
    .filter((row) => now.getTime() - new Date(row.fetchedAt).getTime() <= STALE_MAX_AGE_MS)
    .map((row) => withConvertedAmounts({ ...row, status: "stale" }, rates));
  return [...freshRows, ...staleRows];
}

export function validateCoverage(snapshot, previousSnapshot = null, minimumFirstRunRows = 20) {
  const freshUs = snapshot.rows.find((row) => row.countryCode === "US" && row.status === "fresh");
  if (!freshUs) throw new Error("Coverage guard failed: a fresh US Business price is required.");
  const freshNonUsd = snapshot.rows.find((row) => row.currencyCode !== "USD" && row.status === "fresh");
  if (!freshNonUsd) throw new Error("Coverage guard failed: a fresh non-USD Business price is required.");
  if (!Number.isFinite(Number(snapshot.fx.rates.CNY))) throw new Error("Coverage guard failed: CNY FX rate is required.");

  if (previousSnapshot?.rows?.length) {
    const minimum = Math.ceil(previousSnapshot.rows.length * 0.9);
    if (snapshot.rows.length < minimum) {
      throw new Error(`Coverage guard failed: ${snapshot.rows.length} rows is below 90% of previous ${previousSnapshot.rows.length}.`);
    }
  } else if (snapshot.rows.length < minimumFirstRunRows) {
    throw new Error(`Coverage guard failed: first live snapshot requires at least ${minimumFirstRunRows} rows.`);
  }
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    return await fetch(url, {
      headers: {
        ...requestHeaders(url),
        ...options.headers,
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJsonWithRetry(url, options = {}) {
  const retries = options.retries ?? DEFAULT_RETRIES;
  let lastError;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, options);
      if (response.status === 404) return { kind: "unsupported", status: 404 };
      if (!response.ok) {
        const detail = await responseDetail(response);
        const error = new Error(`HTTP ${response.status} for ${url}${detail}`);
        if (response.status < 500 && response.status !== 429) throw Object.assign(error, { nonRetryable: true });
        throw error;
      }
      const contentType = response.headers?.get?.("content-type") || "unknown";
      const body = await response.text();
      try {
        return { kind: "success", data: JSON.parse(body), status: response.status };
      } catch {
        const preview = safePreview(body);
        throw Object.assign(
          new Error(`Invalid JSON from ${url}; content-type=${contentType}; body=${preview}`),
          { nonRetryable: true },
        );
      }
    } catch (error) {
      lastError = error;
      if (error?.nonRetryable || attempt === retries - 1) break;
      await sleep((attempt + 1) * 850 + Math.floor(Math.random() * 250));
    }
  }
  throw lastError;
}

async function collectCountry(countryCode, fetchedAt) {
  const result = await fetchJsonWithRetry(sourceUrl(countryCode));
  if (result.kind === "unsupported") return { kind: "unsupported", countryCode };
  return { kind: "success", countryCode, row: parsePriceResponse(result.data, countryCode, fetchedAt) };
}

function requestHeaders(url) {
  const parsed = new URL(url);
  const common = {
    accept: "application/json, text/plain, */*",
    "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
    "cache-control": "no-cache",
    pragma: "no-cache",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
  };
  if (parsed.hostname !== "chatgpt.com" || !parsed.pathname.startsWith("/backend-anon/checkout_pricing_config/configs/")) {
    return common;
  }
  return {
    ...common,
    origin: "https://chatgpt.com",
    referer: "https://chatgpt.com/zh-Hans-CN/pricing/",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "x-openai-target-path": parsed.pathname,
    "x-openai-target-route": "/backend-anon/checkout_pricing_config/configs/{country_code}",
  };
}

async function responseDetail(response) {
  const contentType = response.headers?.get?.("content-type") || "unknown";
  const server = response.headers?.get?.("server") || "unknown";
  const ray = response.headers?.get?.("cf-ray") || "none";
  let body = "";
  try {
    body = await response.text();
  } catch {
    body = "<unreadable>";
  }
  return `; content-type=${contentType}; server=${server}; cf-ray=${ray}; body=${safePreview(body)}`;
}

function safePreview(value) {
  return JSON.stringify(String(value || "").replace(/\s+/g, " ").slice(0, 240));
}

async function collectAllCountries(countryCodes, fetchedAt, concurrency = DEFAULT_CONCURRENCY) {
  const results = await mapLimit(countryCodes, concurrency, async (countryCode) => {
    try {
      return await collectCountry(countryCode, fetchedAt);
    } catch (error) {
      return {
        kind: "failed",
        countryCode,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  return {
    rows: results.filter((item) => item.kind === "success").map((item) => item.row),
    unsupportedCodes: results.filter((item) => item.kind === "unsupported").map((item) => item.countryCode),
    failedItems: results.filter((item) => item.kind === "failed"),
  };
}

export async function fetchFxSnapshot(currencies) {
  const wanted = [...new Set(["CNY", ...currencies.filter((item) => item !== "USD")])].sort();
  const rates = { USD: 1 };
  const sourceUrls = [];
  let primaryDate = null;
  let primaryWorked = false;

  const primaryUrl = `${FRANKFURTER_URL}?base=USD&symbols=${encodeURIComponent(wanted.join(","))}`;
  sourceUrls.push(primaryUrl);
  try {
    const result = await fetchJsonWithRetry(primaryUrl, { retries: 2 });
    if (result.kind === "success") {
      Object.assign(rates, numericRates(result.data.rates));
      primaryDate = result.data.date || null;
      primaryWorked = true;
    }
  } catch (error) {
    console.warn(`Frankfurter unavailable: ${error instanceof Error ? error.message : error}`);
  }

  const missing = wanted.filter((currency) => !Number.isFinite(Number(rates[currency])));
  let fallbackDate = null;
  if (missing.length) {
    sourceUrls.push(OPEN_EXCHANGE_URL);
    const fallback = await fetchJsonWithRetry(OPEN_EXCHANGE_URL);
    if (fallback.kind !== "success") throw new Error("FX fallback unexpectedly returned no data.");
    const fallbackRates = numericRates(fallback.data.rates);
    for (const currency of missing) {
      if (Number.isFinite(fallbackRates[currency])) rates[currency] = fallbackRates[currency];
    }
    fallbackDate = dateFromOpenExchange(fallback.data.time_last_update_utc);
  }

  const stillMissing = wanted.filter((currency) => !Number.isFinite(Number(rates[currency])));
  if (stillMissing.length) throw new Error(`Missing FX rates for ${stillMissing.join(", ")}`);

  return {
    baseCurrency: "USD",
    date: primaryDate || fallbackDate || new Date().toISOString().slice(0, 10),
    source: missing.length ? (primaryWorked ? "Frankfurter + open.er-api.com" : "open.er-api.com") : "Frankfurter",
    sourceUrls,
    rates,
  };
}

function numericRates(value) {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([currency, rate]) => [currency, Number(rate)])
      .filter(([, rate]) => Number.isFinite(rate) && rate > 0),
  );
}

function dateFromOpenExchange(value) {
  const date = new Date(value || "");
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

async function readPreviousSnapshot(urlOrPath) {
  if (!urlOrPath) return null;
  try {
    let raw;
    if (/^https?:\/\//i.test(urlOrPath)) {
      const result = await fetchJsonWithRetry(urlOrPath, { retries: 1, timeoutMs: 8_000 });
      if (result.kind !== "success") return null;
      raw = result.data;
    } else {
      raw = JSON.parse(await readFile(urlOrPath, "utf8"));
    }
    return snapshotSchema.parse(raw);
  } catch (error) {
    console.warn(`Previous snapshot unavailable: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}

export async function collectSnapshot(options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const countryCodes = options.countryCodes || ISO_COUNTRY_CODES;
  const previousSnapshot = options.previousSnapshot || null;
  const collected = await collectAllCountries(countryCodes, generatedAt, options.concurrency);
  logCollectionDiagnostics(collected, countryCodes.length);
  const currencies = collected.rows.map((row) => row.currencyCode);
  for (const failed of collected.failedItems) {
    const previous = previousSnapshot?.rows?.find((row) => row.countryCode === failed.countryCode);
    if (previous) currencies.push(previous.currencyCode);
  }
  const fx = await fetchFxSnapshot(currencies);
  const freshRows = collected.rows.map((row) => withConvertedAmounts(row, fx.rates));
  const rows = mergeStaleRows(
    freshRows,
    collected.failedItems.map((item) => item.countryCode),
    previousSnapshot?.rows || [],
    fx.rates,
    new Date(generatedAt),
  ).sort((a, b) => a.cnyAmount - b.cnyAmount);

  return {
    version: 1,
    mode: "live",
    generatedAt,
    pricingSource: {
      name: "OpenAI ChatGPT checkout pricing config",
      urlTemplate: PRICING_URL_TEMPLATE,
    },
    fx,
    coverage: {
      requested: countryCodes.length,
      success: freshRows.length,
      unsupported: collected.unsupportedCodes.length,
      failed: collected.failedItems.length,
      stale: rows.filter((row) => row.status === "stale").length,
    },
    rows,
  };
}

function logCollectionDiagnostics(collected, requested) {
  console.log(
    `[pricing] requested=${requested} success=${collected.rows.length} unsupported=${collected.unsupportedCodes.length} failed=${collected.failedItems.length}`,
  );
  if (!collected.failedItems.length) return;
  const prioritized = [...collected.failedItems].sort((a, b) => {
    if (a.countryCode === "US") return -1;
    if (b.countryCode === "US") return 1;
    return a.countryCode.localeCompare(b.countryCode);
  });
  for (const item of prioritized.slice(0, 12)) {
    console.warn(`[pricing] ${item.countryCode} failed: ${item.error}`);
  }
  if (prioritized.length > 12) console.warn(`[pricing] ${prioritized.length - 12} additional failures omitted.`);
}

async function runCli() {
  const probeCode = cliValue("--probe");
  if (probeCode) {
    const result = await collectCountry(probeCode.toUpperCase(), new Date().toISOString());
    if (result.kind !== "success") throw new Error(`Pricing probe ${probeCode.toUpperCase()} returned ${result.kind}.`);
    console.log(`[pricing] probe ${result.countryCode} ok: ${result.row.currencyCode} ${result.row.localAmount}`);
    return;
  }
  const outputPath = cliValue("--output") || process.env.OUTPUT_PATH || "public/data/prices.json";
  const previousSource = process.env.PREVIOUS_SNAPSHOT_URL || process.env.PREVIOUS_SNAPSHOT_PATH || null;
  const previousSnapshot = await readPreviousSnapshot(previousSource);
  const snapshot = await collectSnapshot({
    previousSnapshot,
    concurrency: Number(process.env.PRICING_CONCURRENCY || DEFAULT_CONCURRENCY),
  });
  validateCoverage(snapshot, previousSnapshot, Number(process.env.MIN_FIRST_RUN_ROWS || 20));
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ outputPath, generatedAt: snapshot.generatedAt, coverage: snapshot.coverage, fx: snapshot.fx.source }, null, 2));
}

function cliValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function mapLimit(items, limit, mapper) {
  const output = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      output[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return output;
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exitCode = 1;
  });
}
