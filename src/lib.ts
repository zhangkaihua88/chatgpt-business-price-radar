import type {
  DisplayCurrency,
  PriceRow,
  SortMode,
  StatusFilter,
  TaxFilter,
} from "./types";

export function formatConverted(amount: number, currency: DisplayCurrency): string {
  const value = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return `${currency === "CNY" ? "¥" : "$"}${value}`;
}

export function formatLocal(row: PriceRow): string {
  const value = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: row.minorUnitExponent,
    maximumFractionDigits: row.minorUnitExponent,
  }).format(row.localAmount);
  return `${row.symbol}${value}`;
}

export function flagEmoji(countryCode: string): string {
  return [...countryCode.toUpperCase()]
    .map((char) => String.fromCodePoint(127397 + char.charCodeAt(0)))
    .join("");
}

export function relativeTime(iso: string): string {
  const delta = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(delta) || delta < 0) return "刚刚";
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

export function taxLabel(row: PriceRow): string {
  const treatment = row.taxTreatment === "inclusive" ? "含税" : "未含税";
  const detail = [row.taxType?.toUpperCase(), row.taxPercent == null ? null : `${row.taxPercent}%`]
    .filter(Boolean)
    .join(" · ");
  return detail ? `${treatment} · ${detail}` : treatment;
}

export function filterAndSortRows(
  rows: PriceRow[],
  options: {
    query: string;
    tax: TaxFilter;
    status: StatusFilter;
    sort: SortMode;
    currency: DisplayCurrency;
  },
): PriceRow[] {
  const query = options.query.trim().toLocaleLowerCase("zh-CN");
  const filtered = rows.filter((row) => {
    if (options.tax !== "all" && row.taxTreatment !== options.tax) return false;
    if (options.status !== "all" && row.status !== options.status) return false;
    if (!query) return true;
    return [row.countryName, row.countryCode, row.currencyCode]
      .join(" ")
      .toLocaleLowerCase("zh-CN")
      .includes(query);
  });

  return filtered.sort((a, b) => {
    if (options.sort === "country") return a.countryName.localeCompare(b.countryName, "zh-CN");
    if (options.sort === "local") return a.localAmount - b.localAmount;
    if (options.sort === "updated") return b.fetchedAt.localeCompare(a.fetchedAt);
    const aValue = options.currency === "CNY" ? a.cnyAmount : a.usdAmount;
    const bValue = options.currency === "CNY" ? b.cnyAmount : b.usdAmount;
    return aValue - bValue;
  });
}
