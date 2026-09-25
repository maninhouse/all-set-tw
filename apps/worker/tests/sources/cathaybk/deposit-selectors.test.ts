import { afterEach, describe, expect, it, vi } from "vitest";

import { chooseCathayComboboxOption } from "../../../src/sources/cathaybk/connector";

afterEach(() => vi.unstubAllGlobals());

describe("Cathay transaction page comboboxes", () => {
  function combobox(label: string) {
    const input = {
      dataset: {} as Record<string, string>,
      parentElement: null as unknown,
    };
    input.parentElement = { innerText: label, parentElement: null };
    return input;
  }

  it.each([
    ["period", "近 90 天", 0],
    ["account", "123456789012", 1],
  ] as const)(
    "finds the %s selector by its react-select label and picks the option",
    async (kind, match, expectedIndex) => {
      const inputs = [
        combobox("近 30 天"),
        combobox("123456789012 活期儲蓄薪資轉帳存款"),
      ];
      const option = { textContent: "", click: vi.fn() };
      option.textContent =
        kind === "period" ? "近 90 天" : "123456789012 證券活期儲蓄存款";
      vi.stubGlobal("document", {
        querySelectorAll: (selector: string) =>
          selector.includes("combobox") ? inputs : [option],
      });
      const page = {
        evaluate: vi.fn(
          async (fn: (...args: unknown[]) => unknown, ...args: unknown[]) =>
            fn(...args),
        ),
        focus: vi.fn().mockResolvedValue(undefined),
        keyboard: { press: vi.fn().mockResolvedValue(undefined) },
        waitForFunction: vi.fn().mockResolvedValue(undefined),
      };

      await expect(
        chooseCathayComboboxOption(page as never, kind, match),
      ).resolves.toBe(true);
      expect(inputs[expectedIndex]!.dataset.cathayCombobox).toBe(kind);
      expect(page.focus).toHaveBeenCalledWith(
        `[data-cathay-combobox="${kind}"]`,
      );
      expect(page.keyboard.press).toHaveBeenCalledWith("ArrowDown");
      expect(option.click).toHaveBeenCalledOnce();
    },
  );

  it("matches account options by the whole account number", async () => {
    const input = combobox("123456789012 活期儲蓄薪資轉帳存款");
    const longer = { textContent: "1234567890123 其他帳戶", click: vi.fn() };
    const exact = { textContent: "123456789012 子帳戶", click: vi.fn() };
    vi.stubGlobal("document", {
      querySelectorAll: (selector: string) =>
        selector.includes("combobox") ? [input] : [longer, exact],
    });
    const page = {
      evaluate: vi.fn(
        async (fn: (...args: unknown[]) => unknown, ...args: unknown[]) =>
          fn(...args),
      ),
      focus: vi.fn().mockResolvedValue(undefined),
      keyboard: { press: vi.fn().mockResolvedValue(undefined) },
      waitForFunction: vi.fn().mockResolvedValue(undefined),
    };

    await expect(
      chooseCathayComboboxOption(page as never, "account", "123456789012"),
    ).resolves.toBe(true);
    expect(longer.click).not.toHaveBeenCalled();
    expect(exact.click).toHaveBeenCalledOnce();
  });

  it("reports a missing selector without touching the page", async () => {
    vi.stubGlobal("document", {
      querySelectorAll: () => [combobox("其他欄位")],
    });
    const page = {
      evaluate: vi.fn(
        async (fn: (...args: unknown[]) => unknown, ...args: unknown[]) =>
          fn(...args),
      ),
      focus: vi.fn(),
      keyboard: { press: vi.fn() },
      waitForFunction: vi.fn(),
    };

    await expect(
      chooseCathayComboboxOption(page as never, "period", "近 90 天"),
    ).resolves.toBe(false);
    expect(page.focus).not.toHaveBeenCalled();
  });
});
