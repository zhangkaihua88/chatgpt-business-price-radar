import { extractAccessToken, type AccessTokenMode } from "./checkout-generator";

export type GeneratorTool = "checkout" | "codex" | "billing";

export const CODEX_COUNTRIES = [
  ["US", "美国", "USD"],
  ["SG", "新加坡", "SGD"],
  ["AU", "澳大利亚", "AUD"],
  ["FR", "法国", "EUR"],
  ["DE", "德国", "EUR"],
  ["IT", "意大利", "EUR"],
  ["MX", "墨西哥", "MXN"],
  ["CO", "哥伦比亚", "COP"],
  ["GB", "英国", "GBP"],
  ["JP", "日本", "JPY"],
  ["PH", "菲律宾", "PHP"],
  ["NZ", "新西兰", "NZD"],
  ["TH", "泰国", "THB"],
] as const;

type TokenInput = {
  accessTokenMode: AccessTokenMode;
  accessToken: string;
};

export type CodexScriptInput = TokenInput & {
  workspaceName: string;
  creditQuantity: number;
  country: string;
  autoOpen: boolean;
};

export type BillingScriptInput = TokenInput;

export type CodexInputField = "workspaceName" | "creditQuantity" | "country" | "accessToken";
export type BillingInputField = "accessToken";

function tokenError(input: TokenInput): string | undefined {
  if (input.accessTokenMode !== "manual") return undefined;
  if (!input.accessToken.trim()) return "请输入 Access Token 或 Session JSON";
  if (!extractAccessToken(input.accessToken)) return "未能从输入内容中提取 accessToken";
  return undefined;
}

export function validateCodexInput(input: CodexScriptInput): Partial<Record<CodexInputField, string>> {
  const errors: Partial<Record<CodexInputField, string>> = {};
  if (!input.workspaceName.trim()) errors.workspaceName = "请输入空间名称";
  if (!Number.isInteger(input.creditQuantity) || input.creditQuantity < 1) {
    errors.creditQuantity = "Credit 数量必须是大于 0 的整数";
  }
  if (!CODEX_COUNTRIES.some(([code]) => code === input.country)) errors.country = "请选择支持的国家或地区";
  const error = tokenError(input);
  if (error) errors.accessToken = error;
  return errors;
}

export function validateBillingInput(input: BillingScriptInput): Partial<Record<BillingInputField, string>> {
  const error = tokenError(input);
  return error ? { accessToken: error } : {};
}

function personalAccessTokenPrelude(input: TokenInput): string {
  if (input.accessTokenMode === "manual") {
    return `  const accessToken = ${JSON.stringify(extractAccessToken(input.accessToken) || "PASTE_ACCESS_TOKEN_HERE")};
  if (!accessToken || accessToken === "PASTE_ACCESS_TOKEN_HERE") {
    throw new Error("Access Token 为空，请重新生成并填入 Token");
  }`;
  }
  return `  const sessionResponse = await fetch("/api/auth/session", { credentials: "include" });
  const session = await sessionResponse.json().catch(() => ({}));
  if (!sessionResponse.ok || !session.accessToken) {
    throw new Error("无法从当前登录会话获取 Access Token，请手动填写 AT 或重新登录 ChatGPT");
  }
  const currentAccount = session.account || {};
  const currentPlan = currentAccount.planType || currentAccount.plan_type;
  const currentStructure = currentAccount.structure;
  if (currentPlan !== "free" || currentStructure !== "personal") {
    throw new Error("当前选中的不是 Personal/Free 个人账户，请先切换个人账户后重试");
  }
  const accessToken = session.accessToken;`;
}

export function generateCodexScript(input: CodexScriptInput): string {
  const country = CODEX_COUNTRIES.find(([code]) => code === input.country) || CODEX_COUNTRIES[0];
  const currency = country[2];
  return `(async function generateCodexUsageCheckout() {
  // ================= 配置项 =================
  const WORKSPACE_NAME = ${JSON.stringify(input.workspaceName.trim() || "work")};
  const CREDIT_QUANTITY = ${JSON.stringify(input.creditQuantity || 13)};
  const COUNTRY = ${JSON.stringify(country[0])};
  const CURRENCY = ${JSON.stringify(currency)};
  const AUTO_OPEN_CHECKOUT = ${JSON.stringify(input.autoOpen)};
  // ==========================================

  if (window.location.origin !== "https://chatgpt.com") {
    throw new Error(\`请在 https://chatgpt.com 页面执行脚本，当前来源为 \${window.location.origin}\`);
  }

${personalAccessTokenPrelude(input)}

  const payload = {
    plan_name: "chatgptbusiness_usage_based",
    entry_point: "team_workspace_purchase_modal",
    checkout_ui_mode: "hosted",
    billing_details: { country: COUNTRY, currency: CURRENCY },
    usage_based_workspace_credit_purchase_data: {
      workspace_name: WORKSPACE_NAME,
      quantity: CREDIT_QUANTITY,
      unit: "credit"
    },
    cancel_url: "https://chatgpt.com/#pricing"
  };

  console.log("⏳ 正在创建 Codex 按量 checkout...");
  const response = await fetch("/backend-api/payments/checkout", {
    method: "POST",
    headers: {
      Authorization: \`Bearer \${accessToken}\`,
      "Content-Type": "application/json"
    },
    credentials: "same-origin",
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data.detail || data.error?.message || data.error || \`HTTP \${response.status}\`;
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  if (!data.url) throw new Error(data.error || "服务端未返回支付链接");

  const checkoutUrl = new URL(data.url);
  if (checkoutUrl.protocol !== "https:") throw new Error("服务端返回了无效的支付链接");
  console.log("✅ Codex 按量支付长链已生成：", checkoutUrl.href);
  console.log("请在支付页核对空间名称、Credit 数量和金额。");
  if (AUTO_OPEN_CHECKOUT) window.open(checkoutUrl.href, "_blank", "noopener,noreferrer");
  return checkoutUrl.href;
})().catch((error) => {
  console.error("❌ Codex checkout 创建失败：", error.message);
});`;
}

export function generateBillingScript(input: BillingScriptInput): string {
  const sessionAndToken = input.accessTokenMode === "manual"
    ? `  const session = {};
  const accessToken = ${JSON.stringify(extractAccessToken(input.accessToken) || "PASTE_ACCESS_TOKEN_HERE")};
  if (!accessToken || accessToken === "PASTE_ACCESS_TOKEN_HERE") {
    throw new Error("Access Token 为空，请重新生成并填入 Token");
  }`
    : `  const sessionResp = await fetch("/api/auth/session", { credentials: "include" });
  if (!sessionResp.ok) throw new Error("session HTTP " + sessionResp.status);
  const session = await sessionResp.json();
  const accessToken = session.accessToken;
  if (!accessToken) throw new Error("没有拿到 accessToken，确认已登录 chatgpt.com");`;

  return `(async function queryChatGPTBilling() {
  if (window.location.origin !== "https://chatgpt.com") {
    throw new Error(\`请在 https://chatgpt.com 页面执行脚本，当前来源为 \${window.location.origin}\`);
  }

${sessionAndToken}

  const headers = {
    Authorization: \`Bearer \${accessToken}\`,
    Accept: "application/json",
    "Content-Type": "application/json",
    "oai-language": "zh-Hant",
    "oai-device-id": crypto.randomUUID()
  };

  const getJson = async (url) => {
    const response = await fetch(url, { headers });
    const text = await response.text();
    if (!response.ok) throw new Error(\`\${url} HTTP \${response.status}: \${text.slice(0, 300)}\`);
    return JSON.parse(text);
  };

  const accountCheck = await getJson("/backend-api/accounts/check/v4-2023-04-27");
  const accounts = accountCheck.accounts || {};
  const firstKey = Object.keys(accounts)[0];
  const accountId =
    accounts[firstKey]?.account?.account_id ||
    session.account?.id ||
    firstKey;
  if (!accountId) throw new Error("没有拿到 account_id");

  const [invoices, paymentMethods, billingInfo] = await Promise.all([
    getJson(\`/backend-api/invoices?limit=10&account_id=\${encodeURIComponent(accountId)}\`),
    getJson(\`/backend-api/payments/payment_methods?account_id=\${encodeURIComponent(accountId)}\`),
    getJson(\`/backend-api/payments/billing_info?account_id=\${encodeURIComponent(accountId)}\`)
  ]);

  const result = {
    email: session.user?.email || null,
    plan: accounts[firstKey]?.account?.plan_type || session.account?.planType || null,
    accountId,
    accessTokenStatus: accessToken ? \`exists (\${accessToken.length} chars)\` : "missing",
    invoices,
    paymentMethods,
    billingInfo
  };

  console.log("账单提取结果：", result);
  console.log("Stripe/账单管理页：", \`https://chatgpt.com/account/manage?account_id=\${encodeURIComponent(accountId)}\`);
  window.__billingResult = result;
  return result;
})().catch((error) => {
  console.error("❌ 账单查询失败：", error.message);
});`;
}
