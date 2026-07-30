import { describe, expect, it } from "vitest";
import {
  CODEX_COUNTRIES,
  generateBillingScript,
  generateCodexScript,
  validateCodexInput,
} from "./script-generators";

describe("additional script generators", () => {
  it("generates a Codex usage checkout with mapped currency and credits", () => {
    expect(CODEX_COUNTRIES.some(([country, , currency]) => country === "TH" && currency === "THB")).toBe(true);
    const script = generateCodexScript({
      workspaceName: "work",
      creditQuantity: 13,
      country: "TH",
      autoOpen: true,
      accessTokenMode: "auto",
      accessToken: "",
    });
    expect(script).toContain('plan_name: "chatgptbusiness_usage_based"');
    expect(script).toContain('const COUNTRY = "TH"');
    expect(script).toContain('const CURRENCY = "THB"');
    expect(script).toContain("const CREDIT_QUANTITY = 13");
    expect(script).toContain("Personal/Free");
    expect(() => new Function(script)).not.toThrow();
  });

  it("validates Codex workspace and credit quantity", () => {
    expect(validateCodexInput({
      workspaceName: "",
      creditQuantity: 0,
      country: "XX",
      autoOpen: false,
      accessTokenMode: "auto",
      accessToken: "",
    })).toEqual({
      workspaceName: "请输入空间名称",
      creditQuantity: "Credit 数量必须是大于 0 的整数",
      country: "请选择支持的国家或地区",
    });
  });

  it("generates automatic and manual billing query variants", () => {
    const automatic = generateBillingScript({ accessTokenMode: "auto", accessToken: "" });
    expect(automatic).toContain('/api/auth/session');
    expect(automatic).toContain('/backend-api/invoices?limit=10');
    expect(automatic).toContain('/backend-api/payments/payment_methods');
    expect(automatic).toContain('/backend-api/payments/billing_info');
    expect(automatic).toContain("window.__billingResult = result");
    expect(() => new Function(automatic)).not.toThrow();

    const manual = generateBillingScript({
      accessTokenMode: "manual",
      accessToken: JSON.stringify({ accessToken: "manual-billing-token", user: { email: "private@example.com" } }),
    });
    expect(manual).toContain('const accessToken = "manual-billing-token"');
    expect(manual).not.toContain('/api/auth/session');
    expect(manual).not.toContain("private@example.com");
    expect(() => new Function(manual)).not.toThrow();
  });
});
