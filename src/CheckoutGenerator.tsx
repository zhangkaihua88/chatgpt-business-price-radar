import {
  ArrowLeft,
  Check,
  Code2,
  Copy,
  CreditCard,
  Download,
  Info,
  ReceiptText,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CHECKOUT_CURRENCIES,
  DEFAULT_ACCESS_TOKEN_MODE,
  DEFAULT_CHECKOUT_COUNTRY,
  DEFAULT_CHECKOUT_CURRENCY,
  generateCheckoutScript,
  isSupportedCheckoutCurrency,
  normalizeIsoInput,
  validateCheckoutInput,
  type AccessTokenMode,
  type CheckoutScriptInput,
} from "./checkout-generator";
import {
  CODEX_COUNTRIES,
  generateBillingScript,
  generateCodexScript,
  validateBillingInput,
  validateCodexInput,
  type BillingScriptInput,
  type CodexScriptInput,
  type GeneratorTool,
} from "./script-generators";
import type { PriceRow } from "./types";

type CheckoutGeneratorProps = {
  initialTool?: GeneratorTool;
  initialCountry?: string;
  initialCurrency?: string;
  countries: PriceRow[];
  onBack: () => void;
  onToolChange: (tool: GeneratorTool) => void;
};

type FormField =
  | "coupon"
  | "country"
  | "currency"
  | "existingWorkspaceId"
  | "accessToken"
  | "workspaceName"
  | "creditQuantity";
type FormErrors = Partial<Record<FormField, string>>;

const commonCurrencies = ["USD", "EUR", "GBP", "SGD", "EGP"];
const toolMeta: Record<GeneratorTool, { title: string; description: string; filename: string; codeTitle: string }> = {
  checkout: {
    title: "Team 优惠长链",
    description: "使用优惠码新建 Team 空间，或将优惠应用到已有 Codex 空间。",
    filename: "chatgpt-team-checkout.js",
    codeTitle: "team-checkout.js",
  },
  codex: {
    title: "Codex 按量长链",
    description: "按空间名称和 Credit 数量生成 Codex usage-based checkout。",
    filename: "chatgpt-codex-usage-checkout.js",
    codeTitle: "codex-usage-checkout.js",
  },
  billing: {
    title: "账单查询脚本",
    description: "查询账户、最近 10 条发票、支付方式和账单资料。",
    filename: "chatgpt-billing-query.js",
    codeTitle: "billing-query.js",
  },
};

export default function CheckoutGenerator({
  initialTool = "checkout",
  initialCountry = DEFAULT_CHECKOUT_COUNTRY,
  initialCurrency = DEFAULT_CHECKOUT_CURRENCY,
  countries,
  onBack,
  onToolChange,
}: CheckoutGeneratorProps) {
  const [activeTool, setActiveTool] = useState<GeneratorTool>(initialTool);
  const [coupon, setCoupon] = useState("");
  const [country, setCountry] = useState(initialCountry);
  const [currency, setCurrency] = useState(initialCurrency);
  const [existingWorkspaceId, setExistingWorkspaceId] = useState("");
  const [workspaceName, setWorkspaceName] = useState("work");
  const [creditQuantity, setCreditQuantity] = useState("13");
  const [codexCountry, setCodexCountry] = useState("US");
  const [autoOpen, setAutoOpen] = useState(false);
  const [accessTokenMode, setAccessTokenMode] = useState<AccessTokenMode>(DEFAULT_ACCESS_TOKEN_MODE);
  const [accessToken, setAccessToken] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState(false);
  const couponRef = useRef<HTMLInputElement>(null);
  const countryRef = useRef<HTMLInputElement>(null);
  const currencyRef = useRef<HTMLInputElement>(null);
  const workspaceIdRef = useRef<HTMLInputElement>(null);
  const workspaceNameRef = useRef<HTMLInputElement>(null);
  const creditQuantityRef = useRef<HTMLInputElement>(null);
  const accessTokenRef = useRef<HTMLInputElement>(null);

  useEffect(() => setActiveTool(initialTool), [initialTool]);

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

  const tokenInput = { accessTokenMode, accessToken: accessToken.trim() };
  const checkoutInput: CheckoutScriptInput = {
    coupon: coupon.trim(),
    country: country.toUpperCase(),
    currency: currency.toUpperCase(),
    existingWorkspaceId: existingWorkspaceId.trim(),
    autoOpen,
    ...tokenInput,
  };
  const codexInput: CodexScriptInput = {
    workspaceName: workspaceName.trim(),
    creditQuantity: Number(creditQuantity),
    country: codexCountry,
    autoOpen,
    ...tokenInput,
  };
  const billingInput: BillingScriptInput = tokenInput;

  const currentErrors = (): FormErrors => {
    if (activeTool === "checkout") return validateCheckoutInput(checkoutInput);
    if (activeTool === "codex") return validateCodexInput(codexInput);
    return validateBillingInput(billingInput);
  };

  const source = useMemo(() => {
    const previewToken = accessTokenMode === "manual"
      ? accessToken.trim() || "PASTE_ACCESS_TOKEN_HERE"
      : "";
    if (activeTool === "billing") {
      return generateBillingScript({ accessTokenMode, accessToken: previewToken });
    }
    if (activeTool === "codex") {
      return generateCodexScript({
        ...codexInput,
        workspaceName: codexInput.workspaceName || "work",
        creditQuantity: Number.isInteger(codexInput.creditQuantity) && codexInput.creditQuantity > 0
          ? codexInput.creditQuantity
          : 13,
        accessToken: previewToken,
      });
    }
    return generateCheckoutScript({
      ...checkoutInput,
      coupon: checkoutInput.coupon || "XXXXXXXXXXXX",
      country: /^[A-Z]{2}$/.test(checkoutInput.country) ? checkoutInput.country : DEFAULT_CHECKOUT_COUNTRY,
      currency: isSupportedCheckoutCurrency(checkoutInput.currency) ? checkoutInput.currency : DEFAULT_CHECKOUT_CURRENCY,
      existingWorkspaceId: currentErrors().existingWorkspaceId ? "" : checkoutInput.existingWorkspaceId,
      accessToken: previewToken,
    });
  }, [
    activeTool,
    coupon,
    country,
    currency,
    existingWorkspaceId,
    workspaceName,
    creditQuantity,
    codexCountry,
    autoOpen,
    accessTokenMode,
    accessToken,
  ]);

  const isInputValid = Object.keys(currentErrors()).length === 0;
  const currencyName = CHECKOUT_CURRENCIES.find(([code]) => code === checkoutInput.currency)?.[1];
  const selectedCodexCountry = CODEX_COUNTRIES.find(([code]) => code === codexCountry) || CODEX_COUNTRIES[0];
  const meta = toolMeta[activeTool];

  const clearError = (field: FormField) => {
    if (!errors[field]) return;
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const focusField = (field: FormField) => {
    if (field === "coupon") couponRef.current?.focus();
    if (field === "country") countryRef.current?.focus();
    if (field === "currency") currencyRef.current?.focus();
    if (field === "existingWorkspaceId") workspaceIdRef.current?.focus();
    if (field === "workspaceName") workspaceNameRef.current?.focus();
    if (field === "creditQuantity") creditQuantityRef.current?.focus();
    if (field === "accessToken") accessTokenRef.current?.focus();
  };

  const validateAndFocus = () => {
    const nextErrors = currentErrors();
    setErrors(nextErrors);
    const firstError = Object.keys(nextErrors)[0] as FormField | undefined;
    if (firstError) focusField(firstError);
    return !firstError;
  };

  const handleGenerate = (event: React.FormEvent) => {
    event.preventDefault();
    if (!validateAndFocus()) {
      setNotice("请检查标红的参数");
      return;
    }
    document.querySelector("#script-result")?.scrollIntoView({ behavior: "smooth", block: "start" });
    setNotice(`${meta.title}已生成`);
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
    link.download = meta.filename;
    link.click();
    URL.revokeObjectURL(url);
    setNotice("代码文件已下载");
  };

  const reset = () => {
    setCoupon("");
    setCountry(DEFAULT_CHECKOUT_COUNTRY);
    setCurrency(DEFAULT_CHECKOUT_CURRENCY);
    setExistingWorkspaceId("");
    setWorkspaceName("work");
    setCreditQuantity("13");
    setCodexCountry("US");
    setAutoOpen(false);
    setAccessTokenMode(DEFAULT_ACCESS_TOKEN_MODE);
    setAccessToken("");
    setErrors({});
    setNotice("已恢复当前生成器的默认值");
  };

  const changeTool = (tool: GeneratorTool) => {
    if (tool === activeTool) return;
    setActiveTool(tool);
    setErrors({});
    setCopied(false);
    onToolChange(tool);
  };

  const renderTokenFields = () => (
    <>
      <fieldset className="token-source-field">
        <legend>Access Token 来源</legend>
        <div className="token-source-options">
          <label className={accessTokenMode === "auto" ? "active" : ""}>
            <input
              type="radio"
              name="access-token-mode"
              value="auto"
              checked={accessTokenMode === "auto"}
              onChange={() => {
                setAccessTokenMode("auto");
                setAccessToken("");
                clearError("accessToken");
              }}
            />
            <span><strong>自动获取</strong><small>运行时读取登录 Session</small></span>
          </label>
          <label className={accessTokenMode === "manual" ? "active" : ""}>
            <input
              type="radio"
              name="access-token-mode"
              value="manual"
              checked={accessTokenMode === "manual"}
              onChange={() => { setAccessTokenMode("manual"); clearError("accessToken"); }}
            />
            <span><strong>手动粘贴</strong><small>支持 Token 或 Session JSON</small></span>
          </label>
        </div>
      </fieldset>
      {accessTokenMode === "manual" ? (
        <label className={`generator-field token-value-field ${errors.accessToken ? "has-error" : ""}`}>
          <span><strong>Access Token / Session JSON</strong><small>仅用于当前生成结果</small></span>
          <input
            ref={accessTokenRef}
            type="password"
            value={accessToken}
            onChange={(event) => { setAccessToken(event.target.value); clearError("accessToken"); }}
            placeholder="粘贴 accessToken 或完整 Session JSON"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={Boolean(errors.accessToken)}
          />
          {errors.accessToken
            ? <em role="alert">{errors.accessToken}</em>
            : <small className="field-note">只提取 accessToken；切换回自动获取时立即清空</small>}
        </label>
      ) : null}
    </>
  );

  return (
    <div className="generator-page">
      <section className="generator-hero">
        <div>
          <button className="back-link" type="button" onClick={onBack}><ArrowLeft size={15} /> 返回价格雷达</button>
          <span className="eyebrow"><Code2 size={15} /> BUSINESS TOOL · GENERATOR</span>
          <h1>选择工具，<br /><em>脚本即刻就绪。</em></h1>
          <p>生成 Team 优惠、Codex 按量和账单查询脚本。网站只生成文本，不会代替你请求账户或支付接口。</p>
        </div>
        <div className="generator-promise">
          <ShieldCheck size={22} />
          <div><strong>本地生成</strong><span>不上传、不保存优惠码、空间信息或 Access Token。</span></div>
        </div>
      </section>

      <div className="generator-tool-tabs" role="tablist" aria-label="脚本类型">
        <button role="tab" aria-selected={activeTool === "checkout"} className={activeTool === "checkout" ? "active" : ""} onClick={() => changeTool("checkout")}><Users size={16} /><span><strong>Team 优惠</strong><small>新建或已有空间</small></span></button>
        <button role="tab" aria-selected={activeTool === "codex"} className={activeTool === "codex" ? "active" : ""} onClick={() => changeTool("codex")}><CreditCard size={16} /><span><strong>Codex 按量</strong><small>购买 Workspace Credit</small></span></button>
        <button role="tab" aria-selected={activeTool === "billing"} className={activeTool === "billing" ? "active" : ""} onClick={() => changeTool("billing")}><ReceiptText size={16} /><span><strong>账单查询</strong><small>发票与支付资料</small></span></button>
      </div>

      <section className="generator-workspace" aria-labelledby="generator-title">
        <div className="generator-form-panel">
          <div className="generator-section-head">
            <div><span className="section-kicker">INPUT PARAMETERS</span><h2 id="generator-title">{meta.title}</h2></div>
            <span className="live-preview"><span /> 实时预览</span>
          </div>
          <p className="tool-description">{meta.description}</p>

          <form onSubmit={handleGenerate} noValidate>
            {activeTool === "checkout" ? (
              <>
                <label className={`generator-field ${errors.coupon ? "has-error" : ""}`}>
                  <span><strong>优惠码</strong><small>必填</small></span>
                  <input ref={couponRef} value={coupon} onChange={(event) => { setCoupon(event.target.value); clearError("coupon"); }} placeholder="例如：XXXXXXXXXXXX" autoComplete="off" spellCheck={false} aria-invalid={Boolean(errors.coupon)} />
                  {errors.coupon ? <em role="alert">{errors.coupon}</em> : null}
                </label>
                <label className={`generator-field ${errors.existingWorkspaceId ? "has-error" : ""}`}>
                  <span><strong>已有 Codex 空间 ID</strong><small>可选</small></span>
                  <input ref={workspaceIdRef} value={existingWorkspaceId} onChange={(event) => { setExistingWorkspaceId(event.target.value.trim()); clearError("existingWorkspaceId"); }} placeholder="填写 UUID 则应用到已有空间；留空则新建" autoComplete="off" spellCheck={false} aria-invalid={Boolean(errors.existingWorkspaceId)} />
                  {errors.existingWorkspaceId ? <em role="alert">{errors.existingWorkspaceId}</em> : <small className="field-note">适用于已有 0.52 Codex 空间</small>}
                </label>
                <div className="generator-field-grid">
                  <label className={`generator-field ${errors.country ? "has-error" : ""}`}>
                    <span><strong>国家 ISO 缩写</strong><small>2 位字母</small></span>
                    <div className="iso-input"><b>ISO</b><input ref={countryRef} value={country} onChange={(event) => { setCountry(normalizeIsoInput(event.target.value, 2)); clearError("country"); }} maxLength={2} list="checkout-country-list" autoComplete="country" spellCheck={false} aria-invalid={Boolean(errors.country)} /></div>
                    <datalist id="checkout-country-list">{countries.map((row) => <option key={row.countryCode} value={row.countryCode}>{row.countryName}</option>)}</datalist>
                    {errors.country ? <em role="alert">{errors.country}</em> : <small className="field-note">例如 CN、US、KE</small>}
                  </label>
                  <label className={`generator-field ${errors.currency ? "has-error" : ""}`}>
                    <span><strong>货币 ISO 缩写</strong><small>39 种可选</small></span>
                    <div className="iso-input"><b>ISO</b><input ref={currencyRef} value={currency} onChange={(event) => { setCurrency(normalizeIsoInput(event.target.value, 3)); clearError("currency"); }} maxLength={3} list="checkout-currency-list" autoComplete="off" spellCheck={false} aria-invalid={Boolean(errors.currency)} /></div>
                    <datalist id="checkout-currency-list">{CHECKOUT_CURRENCIES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</datalist>
                    {errors.currency ? <em role="alert">{errors.currency}</em> : <small className="field-note">{currencyName ? `${checkoutInput.currency} · ${currencyName}` : "输入或选择货币代码"}</small>}
                  </label>
                </div>
                <div className="quick-currency-row" aria-label="常用货币快捷选择"><span>快捷选择</span>{commonCurrencies.map((code) => <button key={code} type="button" className={checkoutInput.currency === code ? "active" : ""} onClick={() => { setCurrency(code); clearError("currency"); }}>{code}</button>)}</div>
              </>
            ) : null}

            {activeTool === "codex" ? (
              <>
                <label className={`generator-field ${errors.workspaceName ? "has-error" : ""}`}>
                  <span><strong>空间名称</strong><small>必填</small></span>
                  <input ref={workspaceNameRef} value={workspaceName} onChange={(event) => { setWorkspaceName(event.target.value); clearError("workspaceName"); }} placeholder="填写空间名称" autoComplete="off" aria-invalid={Boolean(errors.workspaceName)} />
                  {errors.workspaceName ? <em role="alert">{errors.workspaceName}</em> : null}
                </label>
                <div className="generator-field-grid">
                  <label className={`generator-field ${errors.creditQuantity ? "has-error" : ""}`}>
                    <span><strong>Credit 数量</strong><small>大于 0 的整数</small></span>
                    <input ref={creditQuantityRef} type="number" min="1" step="1" value={creditQuantity} onChange={(event) => { setCreditQuantity(event.target.value); clearError("creditQuantity"); }} aria-invalid={Boolean(errors.creditQuantity)} />
                    {errors.creditQuantity ? <em role="alert">{errors.creditQuantity}</em> : <small className="field-note">默认 13 Credit</small>}
                  </label>
                  <label className={`generator-field ${errors.country ? "has-error" : ""}`}>
                    <span><strong>国家或地区</strong><small>自动匹配货币</small></span>
                    <select value={codexCountry} onChange={(event) => { setCodexCountry(event.target.value); clearError("country"); }} aria-invalid={Boolean(errors.country)}>
                      {CODEX_COUNTRIES.map(([code, name, mappedCurrency]) => <option key={code} value={code}>{name} ({mappedCurrency})</option>)}
                    </select>
                    <small className="field-note">{selectedCodexCountry[0]} · {selectedCodexCountry[2]}</small>
                  </label>
                </div>
              </>
            ) : null}

            {activeTool === "billing" ? (
              <div className="billing-scope-note"><ReceiptText size={18} /><div><strong>查询内容</strong><span>账户 ID、套餐、最近 10 条发票、支付方式和账单资料；结果保存到 <code>window.__billingResult</code>。</span></div></div>
            ) : null}

            {renderTokenFields()}

            {activeTool !== "billing" ? (
              <label className="generator-checkbox"><input type="checkbox" checked={autoOpen} onChange={(event) => setAutoOpen(event.target.checked)} /><span>生成成功后自动打开支付页面</span></label>
            ) : null}

            <button className="generate-button" type="submit"><Sparkles size={17} /> 生成{meta.title} <span>→</span></button>
          </form>

          <div className="generator-steps">
            <span>安全提示</span>
            {activeTool === "billing" ? (
              <p>查询结果包含发票、支付方式和账单资料。请仅在自己的账户中运行，不要分享控制台输出。</p>
            ) : (
              <p>请使用 Personal/Free 个人账户 Token，不要使用 Business/Codex 空间 Token，并在支付页核对最终金额与目标空间。</p>
            )}
          </div>
        </div>

        <div className="generator-result-panel" id="script-result">
          <div className="generator-section-head result-head">
            <div><span className="section-kicker">OUTPUT</span><h2>JavaScript</h2></div>
            <div className="code-actions">
              <button type="button" onClick={downloadCode} aria-disabled={!isInputValid}><Download size={14} /> 下载</button>
              <button className="copy-code" type="button" onClick={copyCode} aria-disabled={!isInputValid}>{copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "已复制" : "复制代码"}</button>
            </div>
          </div>
          <div className="code-preview">
            <div className="code-titlebar"><span /><span /><span /><small>{meta.codeTitle}</small></div>
            <pre><code>{source}</code></pre>
          </div>
          <div className="result-meta">
            <span><Info size={13} /> 在已登录 ChatGPT 的页面控制台中运行</span>
            <button type="button" onClick={reset}><RotateCcw size={13} /> 恢复默认值</button>
          </div>
        </div>
      </section>

      <section className="generator-disclaimer"><Info size={18} /><p><strong>请仅在你有权操作的账号中使用。</strong> 第三方接口、促销资格和结账规则可能调整，实际结果以 ChatGPT 页面为准。</p></section>
      {notice ? <div className="generator-toast" role="status">{notice}</div> : null}
    </div>
  );
}
