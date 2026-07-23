import {
  ArrowDownUp,
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  Database,
  Info,
  Search,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { filterAndSortRows, flagEmoji, formatConverted, formatLocal, relativeTime, taxLabel } from "./lib";
import type {
  DisplayCurrency,
  PriceRow,
  PricingSnapshot,
  SortMode,
  StatusFilter,
  TaxFilter,
} from "./types";

const currencyStorageKey = "business-price-radar:currency";

async function loadSnapshot(): Promise<PricingSnapshot> {
  const liveUrl = new URL("data/prices.json", document.baseURI);
  const sampleUrl = new URL("data/sample-prices.json", document.baseURI);

  const liveResponse = await fetch(liveUrl, { cache: "no-store" });
  if (liveResponse.ok) {
    const contentType = liveResponse.headers?.get?.("content-type") || "application/json";
    if (contentType.includes("json")) {
      try {
        return await liveResponse.json() as PricingSnapshot;
      } catch {
        // Vite and some static hosts may return index.html for a missing JSON file.
      }
    }
  }

  const sampleResponse = await fetch(sampleUrl, { cache: "no-store" });
  if (!sampleResponse.ok) throw new Error("价格快照暂时不可用");
  return sampleResponse.json() as Promise<PricingSnapshot>;
}

function initialCurrency(): DisplayCurrency {
  const stored = window.localStorage.getItem(currencyStorageKey);
  return stored === "USD" ? "USD" : "CNY";
}

export default function App() {
  const [snapshot, setSnapshot] = useState<PricingSnapshot | null>(null);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [currency, setCurrency] = useState<DisplayCurrency>(initialCurrency);
  const [query, setQuery] = useState("");
  const [tax, setTax] = useState<TaxFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<SortMode>("converted");

  useEffect(() => {
    let active = true;
    loadSnapshot()
      .then((data) => {
        if (active) setSnapshot(data);
      })
      .catch((error: unknown) => {
        if (active) setLoadingError(error instanceof Error ? error.message : "价格快照暂时不可用");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    window.localStorage.setItem(currencyStorageKey, currency);
  }, [currency]);

  const rows = useMemo(
    () =>
      filterAndSortRows(snapshot?.rows ?? [], {
        query,
        tax,
        status,
        sort,
        currency,
      }),
    [snapshot, query, tax, status, sort, currency],
  );

  const lowest = useMemo(() => {
    if (!snapshot?.rows.length) return null;
    return [...snapshot.rows].sort((a, b) => {
      const aValue = currency === "CNY" ? a.cnyAmount : a.usdAmount;
      const bValue = currency === "CNY" ? b.cnyAmount : b.usdAmount;
      return aValue - bValue;
    })[0];
  }, [snapshot, currency]);

  const setDisplayCurrency = (value: DisplayCurrency) => {
    setCurrency(value);
    window.localStorage.setItem(currencyStorageKey, value);
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="./" aria-label="Business Price Radar 首页">
          <span className="brand-mark" aria-hidden="true">
            <span />
          </span>
          <span>
            <strong>Business Price Radar</strong>
            <small>全球月付价格</small>
          </span>
        </a>
        <div className="topbar-actions">
          <span className="source-pill">
            <span className="live-dot" /> OpenAI 公开配置
          </span>
          <CurrencyToggle value={currency} onChange={setDisplayCurrency} />
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="hero-copy">
            <span className="eyebrow"><CircleDollarSign size={15} /> CHATGPT BUSINESS · MONTHLY</span>
            <h1>一眼看懂，<br /><em>全球月付差多少。</em></h1>
            <p>
              汇总不同国家和地区的 ChatGPT Business 官方月付配置，保留原币价格，统一换算成人民币或美元。
            </p>
            <div className="hero-notes">
              <span><Users size={16} /> 每用户 / 月</span>
              <span><ShieldCheck size={16} /> 原价税务口径</span>
              <span><CalendarClock size={16} /> 每两天更新</span>
            </div>
          </div>

          <div className="hero-card">
            <div className="hero-card-top">
              <span>当前最低月付</span>
              <span className="rank-badge">全球 #1</span>
            </div>
            {lowest ? (
              <>
                <div className="lowest-country">
                  <span className="large-flag">{flagEmoji(lowest.countryCode)}</span>
                  <div>
                    <strong>{lowest.countryName}</strong>
                    <span>{lowest.countryCode} · {lowest.currencyCode}</span>
                  </div>
                </div>
                <div className="lowest-price">
                  {formatConverted(currency === "CNY" ? lowest.cnyAmount : lowest.usdAmount, currency)}
                  <small>/ 用户 / 月</small>
                </div>
                <div className="local-price-line">
                  官方原价 <strong>{formatLocal(lowest)}</strong>
                </div>
              </>
            ) : (
              <div className="hero-skeleton" aria-label="正在加载最低价格" />
            )}
            <div className="hero-card-foot">
              <CheckCircle2 size={15} /> 价格按接口返回口径比较，未自行加税
            </div>
          </div>
        </section>

        {snapshot?.mode === "sample" ? (
          <div className="sample-banner" role="status">
            <Info size={17} /> 当前为本地演示快照；GitHub Actions 首次成功部署后将自动替换为全量实时数据。
          </div>
        ) : null}

        {loadingError ? (
          <section className="error-state" role="alert">
            <Database size={28} />
            <div><strong>暂时无法读取价格快照</strong><span>{loadingError}</span></div>
          </section>
        ) : null}

        <section className="metrics" aria-label="数据概览">
          <Metric
            icon={<Database size={20} />}
            label="有效地区"
            value={snapshot ? String(snapshot.coverage.success + snapshot.coverage.stale) : "—"}
            detail={snapshot ? `探测 ${snapshot.coverage.requested} 个 ISO 地区` : "正在读取快照"}
          />
          <Metric
            icon={<CircleDollarSign size={20} />}
            label="显示币种"
            value={currency}
            detail={currency === "CNY" ? "按美元中间价折算人民币" : "统一折算为美元"}
          />
          <Metric
            icon={<CalendarClock size={20} />}
            label="数据更新时间"
            value={snapshot ? relativeTime(snapshot.generatedAt) : "—"}
            detail={snapshot ? `汇率日期 ${snapshot.fx.date}` : "等待数据"}
          />
          <Metric
            icon={<ShieldCheck size={20} />}
            label="暂旧数据"
            value={snapshot ? String(snapshot.coverage.stale) : "—"}
            detail="最多沿用 14 天"
          />
        </section>

        <section className="explorer" aria-labelledby="price-list-title">
          <div className="section-heading">
            <div>
              <span className="section-kicker">REGIONAL PRICING</span>
              <h2 id="price-list-title">地区月付价格</h2>
            </div>
            <p>共显示 <strong>{rows.length}</strong> 个地区</p>
          </div>

          <div className="controls">
            <label className="search-control">
              <Search size={18} />
              <span className="sr-only">搜索地区</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索国家、代码或币种" />
            </label>
            <label className="select-control">
              <span>税费</span>
              <select value={tax} onChange={(event) => setTax(event.target.value as TaxFilter)}>
                <option value="all">全部口径</option>
                <option value="inclusive">含税</option>
                <option value="exclusive">未含税</option>
              </select>
            </label>
            <label className="select-control">
              <span>状态</span>
              <select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)}>
                <option value="all">全部状态</option>
                <option value="fresh">最新</option>
                <option value="stale">暂旧</option>
              </select>
            </label>
            <label className="select-control sort-control">
              <ArrowDownUp size={16} />
              <span className="sr-only">排序</span>
              <select value={sort} onChange={(event) => setSort(event.target.value as SortMode)}>
                <option value="converted">折合价格最低</option>
                <option value="country">国家名称</option>
                <option value="local">原币数字</option>
                <option value="updated">最近更新</option>
              </select>
            </label>
          </div>

          {!snapshot && !loadingError ? <LoadingRows /> : null}
          {snapshot && rows.length ? (
            <>
              <PriceTable rows={rows} currency={currency} />
              <PriceCards rows={rows} currency={currency} />
            </>
          ) : null}
          {snapshot && !rows.length ? (
            <div className="empty-state"><Search size={24} /><span>没有符合当前筛选条件的地区</span></div>
          ) : null}
        </section>

        <section className="explainers">
          <article>
            <span className="explainer-number">01</span>
            <h3>价格从哪里来？</h3>
            <p>报价来自 chatgpt.com 的公开结账价格配置接口。本站只读取 Business 月付字段，不参与购买。</p>
          </article>
          <article>
            <span className="explainer-number">02</span>
            <h3>为什么金额会不同？</h3>
            <p>OpenAI 会按地区设置本地币种和价格。汇率换算只用于横向比较，不等于发卡行最终结算价。</p>
          </article>
          <article>
            <span className="explainer-number">03</span>
            <h3>税费如何处理？</h3>
            <p>不自行加税，直接展示接口的含税或未含税标记。企业税号、VAT 与反向征税可能改变账单。</p>
          </article>
        </section>

        <section className="disclaimer">
          <Info size={19} />
          <p>
            <strong>独立信息工具，非 OpenAI 官方产品。</strong>
            实际价格、税费、付款资格与地区可用性以结账页为准。ChatGPT Business 按用户计费，标准席位至少购买 2 个。
            <a href="https://help.openai.com/en/articles/8792536" target="_blank" rel="noreferrer">查看官方账单说明 <ArrowUpRight size={14} /></a>
          </p>
        </section>
      </main>

      <footer>
        <div className="brand footer-brand">
          <span className="brand-mark" aria-hidden="true"><span /></span>
          <span><strong>Business Price Radar</strong><small>Independent pricing reference</small></span>
        </div>
        <p>ChatGPT 与 OpenAI 为其各自权利人的商标。本站与 OpenAI 无隶属或背书关系。</p>
        <span>MIT License · Data refreshed by GitHub Actions</span>
      </footer>
    </div>
  );
}

function CurrencyToggle({ value, onChange }: { value: DisplayCurrency; onChange: (value: DisplayCurrency) => void }) {
  return (
    <div className="currency-toggle" aria-label="显示币种">
      {(["CNY", "USD"] as const).map((currency) => (
        <button
          key={currency}
          type="button"
          aria-pressed={value === currency}
          className={value === currency ? "active" : ""}
          onClick={() => onChange(currency)}
        >
          {currency === "CNY" ? "¥ CNY" : "$ USD"}
        </button>
      ))}
    </div>
  );
}

function Metric({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string; detail: string }) {
  return (
    <article className="metric-card">
      <div className="metric-icon">{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function ConvertedPrice({ row, currency }: { row: PriceRow; currency: DisplayCurrency }) {
  const amount = currency === "CNY" ? row.cnyAmount : row.usdAmount;
  return <>{formatConverted(amount, currency)}</>;
}

function StatusBadge({ status }: { status: PriceRow["status"] }) {
  return status === "fresh" ? (
    <span className="status-badge fresh"><span /> 最新</span>
  ) : (
    <span className="status-badge stale"><span /> 数据暂旧</span>
  );
}

function PriceTable({ rows, currency }: { rows: PriceRow[]; currency: DisplayCurrency }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col">地区</th>
            <th scope="col">官方原币月价</th>
            <th scope="col">折合 {currency}</th>
            <th scope="col">税费口径</th>
            <th scope="col">更新时间</th>
            <th scope="col"><span className="sr-only">来源</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.countryCode}>
              <td>
                <div className="country-cell">
                  <span className="rank">{String(index + 1).padStart(2, "0")}</span>
                  <span className="flag">{flagEmoji(row.countryCode)}</span>
                  <div><strong>{row.countryName}</strong><span>{row.countryCode} · {row.currencyCode}</span></div>
                </div>
              </td>
              <td><strong className="local-amount">{formatLocal(row)}</strong><span className="per-user">/ 用户 / 月</span></td>
              <td><strong className="converted-amount"><ConvertedPrice row={row} currency={currency} /></strong></td>
              <td><span className={`tax-badge ${row.taxTreatment}`}>{taxLabel(row)}</span></td>
              <td><StatusBadge status={row.status} /><span className="updated-time">{relativeTime(row.fetchedAt)}</span></td>
              <td>
                <a className="source-link" href={row.sourceUrl} target="_blank" rel="noreferrer" aria-label={`查看${row.countryName}官方价格源`}>
                  <ArrowUpRight size={17} />
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PriceCards({ rows, currency }: { rows: PriceRow[]; currency: DisplayCurrency }) {
  return (
    <div className="price-cards">
      {rows.map((row, index) => (
        <article className="price-card" key={row.countryCode}>
          <div className="price-card-head">
            <span className="mobile-rank">#{index + 1}</span>
            <StatusBadge status={row.status} />
          </div>
          <div className="price-card-country">
            <span className="flag">{flagEmoji(row.countryCode)}</span>
            <div><strong>{row.countryName}</strong><span>{row.countryCode} · {row.currencyCode}</span></div>
          </div>
          <div className="mobile-price"><ConvertedPrice row={row} currency={currency} /><small>/ 用户 / 月</small></div>
          <div className="mobile-details">
            <span>官方原价 <strong>{formatLocal(row)}</strong></span>
            <span className={`tax-badge ${row.taxTreatment}`}>{taxLabel(row)}</span>
          </div>
          <a href={row.sourceUrl} target="_blank" rel="noreferrer">查看官方价格源 <ArrowUpRight size={15} /></a>
        </article>
      ))}
    </div>
  );
}

function LoadingRows() {
  return (
    <div className="loading-rows" aria-label="正在加载价格">
      {Array.from({ length: 5 }, (_, index) => <span key={index} />)}
    </div>
  );
}
