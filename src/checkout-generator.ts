export const CHECKOUT_CURRENCIES = [
  ["USD", "美元"],
  ["AUD", "澳大利亚元（澳元）"],
  ["CAD", "加拿大元（加元）"],
  ["GBP", "英镑"],
  ["EUR", "欧元"],
  ["CLP", "智利比索"],
  ["JPY", "日元"],
  ["INR", "印度卢比"],
  ["IDR", "印尼盾（印度尼西亚卢比）"],
  ["PKR", "巴基斯坦卢比"],
  ["THB", "泰铢"],
  ["MYR", "马来西亚林吉特"],
  ["TWD", "新台币"],
  ["VND", "越南盾"],
  ["PHP", "菲律宾比索"],
  ["NGN", "尼日利亚奈拉"],
  ["ZAR", "南非兰特"],
  ["KZT", "哈萨克斯坦坚戈"],
  ["TZS", "坦桑尼亚先令"],
  ["EGP", "埃及镑"],
  ["BRL", "巴西雷亚尔"],
  ["SEK", "瑞典克朗"],
  ["CZK", "捷克克朗"],
  ["PLN", "波兰兹罗提"],
  ["DKK", "丹麦克朗"],
  ["NOK", "挪威克朗"],
  ["KRW", "韩元（韩国圆）"],
  ["COP", "哥伦比亚比索"],
  ["MXN", "墨西哥比索"],
  ["PEN", "秘鲁索尔"],
  ["HUF", "匈牙利福林"],
  ["QAR", "卡塔尔里亚尔"],
  ["RON", "罗马尼亚列伊"],
  ["ILS", "以色列新谢克尔"],
  ["AED", "阿联酋迪拉姆"],
  ["SGD", "新加坡元（新元）"],
  ["NZD", "新西兰元（纽元）"],
  ["CHF", "瑞士法郎"],
  ["SAR", "沙特里亚尔"],
] as const;

export const DEFAULT_CHECKOUT_COUNTRY = "US";
export const DEFAULT_CHECKOUT_CURRENCY = "EGP";
export const DEFAULT_ACCESS_TOKEN_MODE = "auto" as const;

const currencyCodes = new Set<string>(CHECKOUT_CURRENCIES.map(([code]) => code));

export type AccessTokenMode = "auto" | "manual";

export type CheckoutScriptInput = {
  coupon: string;
  country: string;
  currency: string;
  accessTokenMode: AccessTokenMode;
  accessToken: string;
};

export type CheckoutInputField = "coupon" | "country" | "currency" | "accessToken";
export type CheckoutValidationErrors = Partial<Record<CheckoutInputField, string>>;

export function normalizeIsoInput(value: string, maxLength: number): string {
  return value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, maxLength);
}

export function isSupportedCheckoutCurrency(value: string): boolean {
  return currencyCodes.has(value.toUpperCase());
}

function findAccessToken(value: unknown, depth = 0): string | null {
  if (depth > 4 || value == null || typeof value !== "object") return null;
  for (const [key, child] of Object.entries(value)) {
    if ((key === "accessToken" || key === "access_token") && typeof child === "string" && child.trim()) {
      return child.trim();
    }
  }
  for (const child of Object.values(value)) {
    const token = findAccessToken(child, depth + 1);
    if (token) return token;
  }
  return null;
}

export function extractAccessToken(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[") && !trimmed.startsWith('"')) {
    return trimmed;
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed === "string") return parsed.trim() || null;
    return findAccessToken(parsed);
  } catch {
    return null;
  }
}

export function validateCheckoutInput(input: CheckoutScriptInput): CheckoutValidationErrors {
  const errors: CheckoutValidationErrors = {};
  if (!input.coupon.trim()) errors.coupon = "请输入优惠码";
  if (!/^[A-Z]{2}$/.test(input.country)) errors.country = "请输入 2 位英文字母国家代码";
  if (!isSupportedCheckoutCurrency(input.currency)) errors.currency = "请选择支持的货币代码";
  if (input.accessTokenMode === "manual" && !input.accessToken.trim()) {
    errors.accessToken = "请输入 Access Token 或 Session JSON";
  } else if (input.accessTokenMode === "manual" && !extractAccessToken(input.accessToken)) {
    errors.accessToken = "未能从输入内容中提取 accessToken";
  }
  return errors;
}

export function generateCheckoutScript(input: CheckoutScriptInput): string {
  const coupon = input.coupon || "XXXXXXXXXXXX";
  const country = input.country || DEFAULT_CHECKOUT_COUNTRY;
  const currency = input.currency || DEFAULT_CHECKOUT_CURRENCY;
  const encodedCoupon = encodeURIComponent(coupon);
  const tokenStatusMessage = input.accessTokenMode === "manual"
    ? "⏳ 正在使用手动 Access Token..."
    : "⏳ 正在获取 ChatGPT Session Token...";
  const manualAccessToken = extractAccessToken(input.accessToken);
  const tokenSource = input.accessTokenMode === "manual"
    ? `  // 1. 使用手动提供的登录凭证
  const accessToken = ${JSON.stringify(manualAccessToken || "PASTE_ACCESS_TOKEN_HERE")};
  if (!accessToken || accessToken === "PASTE_ACCESS_TOKEN_HERE") {
    console.error("❌ Access Token 为空，请重新生成并填入 Token");
    return;
  }
  console.log("✅ 已使用手动 Access Token");`
    : `  // 1. 自动获取登录凭证
  let accessToken;
  try {
    const s = await fetch("/api/auth/session").then(r => r.json());
    accessToken = s?.accessToken;
    if (!accessToken) throw new Error("accessToken 为空，请确认已登录 ChatGPT 账号");
  } catch (e) {
    console.error("❌ 获取 Token 失败：", e.message);
    return;
  }
  console.log("✅ Token 获取成功");`;

  return `(async function generateAUTeamLink() {
  // ================= 配置项 =================
  const WORKSPACE_NAME = "xxx";
  const COUPON = ${JSON.stringify(coupon)};   // 优惠码
  const SEAT_QUANTITY = 2;            // 席位数量（Team 最少 2 个）
  // ==========================================

  console.log(${JSON.stringify(tokenStatusMessage)});

${tokenSource}

  // 2. 构建请求 Payload
  const payload = {
    plan_name: "chatgptteamplan",
    team_plan_data: {
      workspace_name: WORKSPACE_NAME,
      price_interval: "month", // month 或 year
      seat_quantity: SEAT_QUANTITY
    },
    billing_details: {
      country: ${JSON.stringify(country)},
      currency: ${JSON.stringify(currency)}
    },
    cancel_url: "https://chatgpt.com/?promoCode=${encodedCoupon}",
    promo_code: COUPON,
    checkout_ui_mode: "hosted"
  };

  // 3. 请求 Stripe 长链接
  console.log("⏳ 正在请求 Stripe 支付长链接...");
  try {
    const resp = await fetch(
      "https://chatgpt.com/backend-api/payments/checkout",
      {
        method: "POST",
        headers: {
          Authorization: \`Bearer \${accessToken}\`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      }
    );
    const data = await resp.json();

    if (!resp.ok) {
      console.error(\`❌ 请求失败 HTTP \${resp.status}\`);
      console.log("📋 响应详情：", data);
      return;
    }

    const hostedUrl = data?.url || data?.stripe_hosted_url || data?.checkout_url;
    if (!hostedUrl) {
      console.warn("⚠️ 未找到长链接，原始响应：", data);
      return;
    }

    // 4. 打印结果
    console.log("─".repeat(60));
    console.log("✅ ChatGPT Team 链接生成成功！");
    console.log(\`📌 工作区名称 : \${payload.team_plan_data.workspace_name}\`);
    console.log(\`💺 席位数量   : \${payload.team_plan_data.seat_quantity}\`);
    console.log(\`🎟️  优惠码     : \${COUPON}\`);
    console.log(\`🌍 地区/货币   : \${payload.billing_details.country} (\${payload.billing_details.currency})\`);
    if (data.checkout_session_id) {
      console.log(\`🆔 Session ID : \${data.checkout_session_id}\`);
    }
    console.log("─".repeat(60));
    console.log("🔗 Stripe 支付长链接（复制到浏览器打开）：");
    console.log(hostedUrl);
    console.log("─".repeat(60));
  } catch (e) {
    console.error("❌ 网络异常或请求失败：", e.message);
  }
})();`;
}
