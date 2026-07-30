import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sample from "../public/data/sample-prices.json";
import App from "./App";

describe("pricing explorer", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    window.localStorage.clear();
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce({ ok: true, json: async () => sample }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("loads the snapshot, preserves local prices and switches display currency locally", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect((await screen.findAllByText("S$32.00")).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "$ USD" })).toHaveAttribute("aria-pressed", "true");
    expect((await screen.findAllByText("$23.80")).length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "¥ CNY" }));
    expect(screen.getByRole("button", { name: "¥ CNY" })).toHaveAttribute("aria-pressed", "true");
    expect((await screen.findAllByText("¥161.93")).length).toBeGreaterThan(0);
    expect((screen.getAllByText("S$32.00")).length).toBeGreaterThan(0);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("links to the project repository and honors a saved CNY preference", () => {
    window.localStorage.setItem("business-price-radar:currency", "CNY");
    render(<App />);

    expect(screen.getByRole("button", { name: "¥ CNY" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("link", { name: "在 GitHub 查看 zhangkaihua88/chatgpt-business-price-radar" }))
      .toHaveAttribute("href", "https://github.com/zhangkaihua88/chatgpt-business-price-radar");
  });

  it("filters by country and tax treatment", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findAllByText("美国");
    await user.type(screen.getByPlaceholderText("搜索国家、代码或币种"), "新加坡");
    await waitFor(() => expect(screen.queryByText("德国")).not.toBeInTheDocument());
    expect(screen.getAllByText("新加坡").length).toBeGreaterThan(0);
    await user.clear(screen.getByPlaceholderText("搜索国家、代码或币种"));
    await user.selectOptions(screen.getByLabelText("税费"), "inclusive");
    expect(screen.getAllByText("德国").length).toBeGreaterThan(0);
    expect(screen.queryByText("新加坡")).not.toBeInTheDocument();
  });

  it("opens the generator with US and EGP defaults and responds to URL navigation", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /脚本生成器/ }));
    expect(screen.getByLabelText(/国家 ISO 缩写/)).toHaveValue("US");
    expect(screen.getByLabelText(/货币 ISO 缩写/)).toHaveValue("EGP");
    expect(new URLSearchParams(window.location.search).get("view")).toBe("generator");

    window.history.pushState({}, "", "/?view=generator&country=JP&currency=JPY");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await waitFor(() => expect(screen.getByLabelText(/国家 ISO 缩写/)).toHaveValue("JP"));
    expect(screen.getByLabelText(/货币 ISO 缩写/)).toHaveValue("JPY");
  });

  it("prefills a region from the radar and preserves the price filters on return", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findAllByText("新加坡");

    const search = screen.getByPlaceholderText("搜索国家、代码或币种");
    await user.type(search, "新加坡");
    await user.click(screen.getAllByRole("button", { name: "为新加坡生成脚本" })[0]);

    expect(screen.getByLabelText(/国家 ISO 缩写/)).toHaveValue("SG");
    expect(screen.getByLabelText(/货币 ISO 缩写/)).toHaveValue("SGD");
    expect(new URLSearchParams(window.location.search).get("country")).toBe("SG");
    expect(new URLSearchParams(window.location.search).get("currency")).toBe("SGD");

    await user.click(screen.getByRole("button", { name: /返回价格雷达/ }));
    expect(screen.getByPlaceholderText("搜索国家、代码或币种")).toHaveValue("新加坡");
  });

  it("blocks an empty coupon, then copies valid generated code without storing the coupon", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(<App />);
    await user.click(screen.getByRole("button", { name: /脚本生成器/ }));

    const copyButton = screen.getByRole("button", { name: /复制代码/ });
    expect(copyButton).toHaveAttribute("aria-disabled", "true");
    await user.click(copyButton);
    const coupon = screen.getByPlaceholderText("例如：XXXXXXXXXXXX");
    expect(coupon).toHaveFocus();
    expect(screen.getByText("请输入优惠码")).toBeInTheDocument();

    await user.type(coupon, "SAVE20");
    expect(copyButton).toHaveAttribute("aria-disabled", "false");
    await user.click(screen.getByRole("button", { name: /复制代码/ }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('const COUPON = "SAVE20"'));
    expect(window.location.search).not.toContain("SAVE20");
    expect(window.localStorage.getItem("coupon")).toBeNull();
  });

  it("downloads valid code and resets to US and EGP", async () => {
    const user = userEvent.setup();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const createObjectURL = vi.fn(() => "blob:checkout-script");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
    render(<App />);
    await user.click(screen.getByRole("button", { name: /脚本生成器/ }));

    await user.type(screen.getByPlaceholderText("例如：XXXXXXXXXXXX"), "SAVE20");
    await user.clear(screen.getByLabelText(/国家 ISO 缩写/));
    await user.type(screen.getByLabelText(/国家 ISO 缩写/), "sg");
    await user.click(screen.getByRole("button", { name: /下载/ }));
    expect(createObjectURL).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:checkout-script");

    await user.click(screen.getByRole("button", { name: /恢复默认值/ }));
    expect(screen.getByLabelText(/国家 ISO 缩写/)).toHaveValue("US");
    expect(screen.getByLabelText(/货币 ISO 缩写/)).toHaveValue("EGP");
  });

  it("accepts complete session JSON in manual token mode without storing it", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(<App />);
    await user.click(screen.getByRole("button", { name: /脚本生成器/ }));

    expect(screen.getByRole("radio", { name: /自动获取/ })).toBeChecked();
    await user.click(screen.getByRole("radio", { name: /手动粘贴/ }));
    const tokenInput = screen.getByPlaceholderText("粘贴 accessToken 或完整 Session JSON");
    const sessionJson = JSON.stringify({
      user: { email: "private@example.com" },
      accessToken: "session-access-token",
    });
    fireEvent.change(tokenInput, { target: { value: sessionJson } });
    await user.type(screen.getByPlaceholderText("例如：XXXXXXXXXXXX"), "SAVE20");
    await user.click(screen.getByRole("button", { name: /复制代码/ }));

    const copiedScript = writeText.mock.calls[0][0] as string;
    expect(copiedScript).toContain('const accessToken = "session-access-token"');
    expect(copiedScript).not.toContain("private@example.com");
    expect(copiedScript).not.toContain("/api/auth/session");
    expect(window.location.search).not.toContain("session-access-token");
    expect(Object.values(window.localStorage)).not.toContain("session-access-token");

    await user.click(screen.getByRole("radio", { name: /自动获取/ }));
    expect(screen.queryByPlaceholderText("粘贴 accessToken 或完整 Session JSON")).not.toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /手动粘贴/ }));
    expect(screen.getByPlaceholderText("粘贴 accessToken 或完整 Session JSON")).toHaveValue("");
  });
});
