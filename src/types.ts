export type DisplayCurrency = "CNY" | "USD";
export type TaxTreatment = "inclusive" | "exclusive";
export type RowStatus = "fresh" | "stale";

export type PriceRow = {
  countryCode: string;
  countryName: string;
  currencyCode: string;
  symbol: string;
  minorUnitExponent: number;
  localAmount: number;
  usdAmount: number;
  cnyAmount: number;
  taxTreatment: TaxTreatment;
  taxType: string | null;
  taxPercent: number | null;
  status: RowStatus;
  fetchedAt: string;
  sourceUrl: string;
};

export type PricingSnapshot = {
  version: 1;
  mode: "live" | "sample";
  generatedAt: string;
  pricingSource: {
    name: string;
    urlTemplate: string;
  };
  fx: {
    baseCurrency: "USD";
    date: string;
    source: string;
    sourceUrls: string[];
    rates: Record<string, number>;
  };
  coverage: {
    requested: number;
    success: number;
    unsupported: number;
    failed: number;
    stale: number;
  };
  rows: PriceRow[];
};

export type SortMode = "converted" | "country" | "local" | "updated";
export type TaxFilter = "all" | TaxTreatment;
export type StatusFilter = "all" | RowStatus;
