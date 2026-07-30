import {
  ArrowLeft,
  Check,
  Code2,
  Copy,
  Download,
  Info,
  RotateCcw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CHECKOUT_CURRENCIES,
  DEFAULT_CHECKOUT_COUNTRY,
  DEFAULT_CHECKOUT_CURRENCY,
  generateCheckoutScript,
  isSupportedCheckoutCurrency,
  normalizeIsoInput,
  validateCheckoutInput,
  type CheckoutScriptInput,
  type CheckoutValidationErrors,
} from "./checkout-generator";
import type { PriceRow } from "./types";

type CheckoutGeneratorProps = {
  initialCountry?: string;
  initialCurrency?: string;
  countries: PriceRow[];
  onBack: () => void;
};

const commonCurrencies = ["USD", "EUR", "GBP", "SGD", "EGP"];

export default function CheckoutGenerator({
  initialCountry = DEFAULT_CHECKOUT_COUNTRY,
  initialCurrency = DEFAULT_CHECKOUT_CURRENCY,
  countries,
  onBack,
}: CheckoutGeneratorProps) {
  const [coupon, setCoupon] = useState("");
  const [country, setCountry] = useState(initialCountry);
  const [currency, setCurrency] = useState(initialCurrency);
  const [errors, setErrors] = useState<CheckoutValidationErrors>({});
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState(false);
  const couponRef = useRef<HTMLInputElement>(null);
  const countryRef = useRef<HTMLInputElement>(null);
  const currencyRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setCountry(initialCountry || DEFAULT_CHECKOUT_COUNTRY);
    setCurrency(initialCurrency || DEFAULT_CHECKOUT_CURRENCY);
    setErrors({});
  }, [initialCountry, initialCurrency]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(""), 2600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const normalized: CheckoutScriptInput = {
    coupon: coupon.trim(),
    country: country.toUpperCase(),
    currency: currency.toUpperCase(),
  };
  const previewInput: CheckoutScriptInput = {
    coupon: normalized.coupon || "XXXXXXXXXXXX",
    country: /^[A-Z]{2}$/.test(normalized.country)
      ? normalized.country
      : DEFAULT_CHECKOUT_COUNTRY,
    currency: isSupportedCheckoutCurrency(normalized.currency)
      ? normalized.currency
      : DEFAULT_CHECKOUT_CURRENCY,
  };
  const source = useMemo(
    () => generateCheckoutScript(previewInput),
    [previewInput.coupon, previewInput.country, previewInput.currency],
  );
  const isInputValid = Object.keys(validateCheckoutInput(normalized)).length === 0;
  const currencyName = CHECKOUT_CURRENCIES.find(([code]) => code === normalized.currency)?.[1];

  const clearError = (field: keyof CheckoutScriptInput) => {
    if (!errors[field]) return;
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const validateAndFocus = () => {
    const nextErrors = validateCheckoutInput(normalized);
    setErrors(nextErrors);
    const firstError = Object.keys(nextErrors)[0] as keyof CheckoutScriptInput | undefined;
    if (firstError === "coupon") couponRef.current?.focus();
    if (firstError === "country") countryRef.current?.focus();
    if (firstError === "currency") currencyRef.current?.focus();
    return !firstError;
  };

  const handleGenerate = (event: React.FormEvent) => {
    event.preventDefault();
    if (!validateAndFocus()) {
      setNotice("请检查标红的参数");
      return;
    }
    document.querySelector("#script-result")?.scrollIntoView({ behavior: "smooth", block: "start" });
    setNotice("代码已按当前参数生成");
  };

  const copyCode = async () => {
    if (!validateAndFocus()) {
      setNotice("请先完成必填参数");
      return;
    }
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(source);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = source;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand?.("copy");
      textarea.remove();
    }
    setCopied(true);
    setNotice("完整代码已复制到剪贴板");
    window.setTimeout(() => setCopied(false), 1800);
  };

  const downloadCode = () => {
    if (!validateAndFocus()) {
      setNotice("请先完成必填参数");
      return;
    }
    const blob = new Blob([source], { type: "text/javascript;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "chatgpt-team-checkout.js";
    link.click();
    URL.revokeObjectURL(url);
    setNotice("代码文件已下载");
  };

  const reset = () => {
    setCoupon("");
    setCountry(DEFAULT_CHECKOUT_COUNTRY);
    setCurrency(DEFAULT_CHECKOUT_CURRENCY);
    setErrors({});
    setNotice("已恢复默认值 US / EGP");
    couponRef.current?.focus();
  };

  return (
    <div className="generator-page">
      <section className="generator-hero">
        <div>
          <button className="back-link" type="button" onClick={onBack}>
            <ArrowLeft size={15} /> 返回价格雷达
          </button>
          <span className="eyebrow"><Code2 size={15} /> BUSINESS TOOL · GENERATOR</span>
          <h1>参数填好，<br /><em>脚本即刻就绪。</em></h1>
          <p>输入优惠码、国家和货币，生成可复制的 ChatGPT Team 结账脚本。全部处理都在当前浏览器中完成。</p>
        </div>
        <div className="generator-promise">
          <ShieldCheck size={22} />
          <div><strong>本地生成</strong><span>不上传、不保存优惠码，也不会在本站执行脚本。</span></div>
        </div>
      </section>

      <section className="generator-workspace" aria-labelledby="generator-title">
        <div className="generator-form-panel">
          <div className="generator-section-head">
            <div><span className="section-kicker">INPUT PARAMETERS</span><h2 id="generator-title">脚本参数</h2></div>
            <span className="live-preview"><span /> 实时预览</span>
          </div>

          <form onSubmit={handleGenerate} noValidate>
            <label className={`generator-field ${errors.coupon ? "has-error" : ""}`}>
              <span><strong>优惠码</strong><small>必填</small></span>
              <input
                ref={couponRef}
                value={coupon}
                onChange={(event) => { setCoupon(event.target.value); clearError("coupon"); }}
                placeholder="例如：XXXXXXXXXXXX"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={Boolean(errors.coupon)}
              />
              {errors.coupon ? <em role="alert">{errors.coupon}</em> : null}
            </label>

            <div className="generator-field-grid">
              <label className={`generator-field ${errors.country ? "has-error" : ""}`}>
                <span><strong>国家 ISO 缩写</strong><small>2 位字母</small></span>
                <div className="iso-input"><b>ISO</b><input
                  ref={countryRef}
                  value={country}
                  onChange={(event) => { setCountry(normalizeIsoInput(event.target.value, 2)); clearError("country"); }}
                  maxLength={2}
                  list="checkout-country-list"
                  autoComplete="country"
                  spellCheck={false}
                  aria-invalid={Boolean(errors.country)}
                /></div>
                <datalist id="checkout-country-list">
                  {countries.map((row) => <option key={row.countryCode} value={row.countryCode}>{row.countryName}</option>)}
                </datalist>
                {errors.country ? <em role="alert">{errors.country}</em> : <small className="field-note">例如 CN、US、KE</small>}
              </label>

              <label className={`generator-field ${errors.currency ? "has-error" : ""}`}>
                <span><strong>货币 ISO 缩写</strong><small>39 种可选</small></span>
                <div className="iso-input"><b>ISO</b><input
                  ref={currencyRef}
                  value={currency}
                  onChange={(event) => { setCurrency(normalizeIsoInput(event.target.value, 3)); clearError("currency"); }}
                  maxLength={3}
                  list="checkout-currency-list"
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={Boolean(errors.currency)}
                /></div>
                <datalist id="checkout-currency-list">
                  {CHECKOUT_CURRENCIES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
                </datalist>
                {errors.currency ? <em role="alert">{errors.currency}</em> : <small className="field-note">{currencyName ? `${normalized.currency} · ${currencyName}` : "输入或选择货币代码"}</small>}
              </label>
            </div>

            <div className="quick-currency-row" aria-label="常用货币快捷选择">
              <span>快捷选择</span>
              {commonCurrencies.map((code) => (
                <button
                  key={code}
                  type="button"
                  className={normalized.currency === code ? "active" : ""}
                  onClick={() => { setCurrency(code); clearError("currency"); }}
                >{code}</button>
              ))}
            </div>

            <button className="generate-button" type="submit"><Sparkles size={17} /> 生成完整代码 <span>→</span></button>
          </form>

          <div className="generator-steps">
            <span>如何使用</span>
            <ol>
              <li>登录 ChatGPT 并打开浏览器控制台。</li>
              <li>复制生成的脚本，粘贴后执行。</li>
              <li>根据控制台输出查看 Stripe 长链接。</li>
            </ol>
          </div>
        </div>

        <div className="generator-result-panel" id="script-result">
          <div className="generator-section-head result-head">
            <div><span className="section-kicker">OUTPUT</span><h2>JavaScript</h2></div>
            <div className="code-actions">
              <button type="button" onClick={downloadCode} aria-disabled={!isInputValid}><Download size={14} /> 下载</button>
              <button className="copy-code" type="button" onClick={copyCode} aria-disabled={!isInputValid}>
                {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "已复制" : "复制代码"}
              </button>
            </div>
          </div>
          <div className="code-preview">
            <div className="code-titlebar"><span /><span /><span /><small>team-checkout.js</small></div>
            <pre><code>{source}</code></pre>
          </div>
          <div className="result-meta">
            <span><Info size={13} /> 在已登录 ChatGPT 的页面控制台中运行</span>
            <button type="button" onClick={reset}><RotateCcw size={13} /> 恢复默认值</button>
          </div>
        </div>
      </section>

      <section className="generator-disclaimer">
        <Info size={18} />
        <p><strong>请仅在你有权操作的账号中使用。</strong> 第三方接口、促销资格和结账规则可能调整，实际结果以 ChatGPT 结账页面为准。</p>
      </section>

      {notice ? <div className="generator-toast" role="status">{notice}</div> : null}
    </div>
  );
}
