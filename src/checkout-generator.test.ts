import { describe, expect, it } from "vitest";
import {
  CHECKOUT_CURRENCIES,
  DEFAULT_CHECKOUT_COUNTRY,
  DEFAULT_CHECKOUT_CURRENCY,
  generateCheckoutScript,
  isSupportedCheckoutCurrency,
  normalizeIsoInput,
  validateCheckoutInput,
} from "./checkout-generator";

describe("checkout script generator", () => {
  it("keeps the requested defaults and exact supported currency list", () => {
    expect(DEFAULT_CHECKOUT_COUNTRY).toBe("US");
    expect(DEFAULT_CHECKOUT_CURRENCY).toBe("EGP");
    expect(CHECKOUT_CURRENCIES).toHaveLength(39);
    expect(isSupportedCheckoutCurrency("egp")).toBe(true);
    expect(isSupportedCheckoutCurrency("TRY")).toBe(false);
  });

  it("normalizes ISO input and validates every field", () => {
    expect(normalizeIsoInput(" u-s1 ", 2)).toBe("US");
    expect(validateCheckoutInput({ coupon: "", country: "USA", currency: "TRY" }))
      .toEqual({
        coupon: "请输入优惠码",
        country: "请输入 2 位英文字母国家代码",
        currency: "请选择支持的货币代码",
      });
  });

  it("substitutes and safely escapes all generated values", () => {
    const script = generateCheckoutScript({
      coupon: 'SAVE "20" & 更多',
      country: "SG",
      currency: "SGD",
    });

    expect(script).toContain('const COUPON = "SAVE \\"20\\" & 更多"');
    expect(script).toContain('country: "SG"');
    expect(script).toContain('currency: "SGD"');
    expect(script).toContain("promo_code: COUPON");
    expect(script).toContain("promoCode=SAVE%20%2220%22%20%26%20%E6%9B%B4%E5%A4%9A");
    expect(() => new Function(script)).not.toThrow();
  });
});
