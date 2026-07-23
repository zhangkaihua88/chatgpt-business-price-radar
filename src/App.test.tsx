import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sample from "../public/data/sample-prices.json";
import App from "./App";

describe("pricing explorer", () => {
  beforeEach(() => {
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
    expect(screen.getByRole("button", { name: "$ USD" })).toHaveAttribute("aria-pressed", "false");
    await user.click(screen.getByRole("button", { name: "$ USD" }));
    expect(screen.getByRole("button", { name: "$ USD" })).toHaveAttribute("aria-pressed", "true");
    expect((await screen.findAllByText("$23.80")).length).toBeGreaterThan(0);
    expect((screen.getAllByText("S$32.00")).length).toBeGreaterThan(0);
    expect(fetch).toHaveBeenCalledTimes(2);
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
});
