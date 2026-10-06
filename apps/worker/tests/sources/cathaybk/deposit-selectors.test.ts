import { afterEach, describe, expect, it, vi } from "vitest";

import {
  chooseCathayComboboxOption,
  dismissCathayAnnouncementModalIfPresent,
  selectTransactionPeriod,
} from "../../../src/sources/cathaybk/connector";

afterEach(() => vi.unstubAllGlobals());

describe("Cathay transaction page comboboxes", () => {
  function combobox(label: string) {
    const control = {
      innerText: label,
      className: "css-13cymwt-control",
      dataset: {} as Record<string, string>,
      parentElement: null,
    };
    return {
      dataset: {} as Record<string, string>,
      disabled: false,
      parentElement: control as unknown,
      closest: () => ({ textContent: label }),
      getAttribute: () => "false",
    };
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

  it("retries the period selector when its menu has not rendered yet", async () => {
    vi.useFakeTimers();
    const input = combobox("近 30 天");
    const option = { textContent: "近 90 天", click: vi.fn() };
    let menuReady = false;
    vi.stubGlobal("document", {
      querySelectorAll: (selector: string) =>
        selector.includes("combobox")
          ? [input]
          : selector.includes("option") && menuReady
            ? [option]
            : [],
    });
    const page = {
      evaluate: vi.fn(
        async (fn: (...args: unknown[]) => unknown, ...args: unknown[]) =>
          fn(...args),
      ),
      focus: vi.fn().mockResolvedValue(undefined),
      keyboard: {
        press: vi.fn(async (key: string) => {
          if (key === "Escape") menuReady = true;
        }),
      },
      waitForFunction: vi.fn().mockResolvedValue(undefined),
    };

    const selected = selectTransactionPeriod(page as never, 90);
    await vi.runAllTimersAsync();
    await expect(selected).resolves.toBeUndefined();
    expect(page.keyboard.press).toHaveBeenCalledWith("Escape");
    expect(option.click).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("opens the menu with a mouse press when the keyboard does not", async () => {
    const input = combobox("近 30 天");
    const option = { textContent: "近 90 天", click: vi.fn() };
    let menuReady = false;
    vi.stubGlobal("document", {
      querySelectorAll: (selector: string) =>
        selector.includes("combobox")
          ? [input]
          : selector.includes("option") && menuReady
            ? [option]
            : [],
    });
    const page = {
      evaluate: vi.fn(
        async (fn: (...args: unknown[]) => unknown, ...args: unknown[]) =>
          fn(...args),
      ),
      focus: vi.fn().mockResolvedValue(undefined),
      keyboard: { press: vi.fn().mockResolvedValue(undefined) },
      click: vi.fn(async () => {
        menuReady = true;
      }),
      waitForFunction: vi.fn(async () => {
        if (!menuReady) throw new Error("timeout");
      }),
    };

    await expect(
      chooseCathayComboboxOption(page as never, "period", "近 90 天"),
    ).resolves.toBe(true);
    expect(page.click).toHaveBeenCalledWith(
      '[data-cathay-combobox-control="period"]',
    );
    expect(option.click).toHaveBeenCalledOnce();
  });

  it("closes an announcement modal that blocks the period selector", async () => {
    const input = combobox("近 30 天");
    const option = { textContent: "近 90 天", click: vi.fn() };
    let modalOpen = true;
    const later = {
      textContent: "下次再提醒",
      dataset: {} as Record<string, string>,
      getClientRects: () => [{}],
    };
    const never = {
      textContent: "不要再顯示",
      dataset: {} as Record<string, string>,
      getClientRects: () => [{}],
    };
    const modal = {
      innerText: "系統維護公告\n2026/10/04 配合國泰證券系統維護作業",
      getClientRects: () => (modalOpen ? [{}] : []),
      querySelectorAll: () => [never, later],
      querySelector: () => null,
    };
    vi.stubGlobal("document", {
      querySelectorAll: (selector: string) => {
        if (selector.includes("combobox")) return [input];
        if (selector.includes("modal")) return [modal];
        return selector.includes("option") && !modalOpen ? [option] : [];
      },
    });
    const page = {
      evaluate: vi.fn(
        async (fn: (...args: unknown[]) => unknown, ...args: unknown[]) =>
          fn(...args),
      ),
      focus: vi.fn().mockResolvedValue(undefined),
      keyboard: { press: vi.fn().mockResolvedValue(undefined) },
      click: vi.fn(async (selector: string) => {
        if (selector === '[data-cathay-announcement-dismiss="true"]')
          modalOpen = false;
      }),
      waitForFunction: vi.fn().mockResolvedValue(undefined),
    };

    await expect(
      selectTransactionPeriod(page as never, 90),
    ).resolves.toBeUndefined();
    expect(later.dataset.cathayAnnouncementDismiss).toBe("true");
    expect(never.dataset.cathayAnnouncementDismiss).toBeUndefined();
    expect(option.click).toHaveBeenCalledOnce();
  });

  it("leaves the page alone when no announcement modal is open", async () => {
    vi.stubGlobal("document", { querySelectorAll: () => [] });
    const page = {
      evaluate: vi.fn(
        async (fn: (...args: unknown[]) => unknown, ...args: unknown[]) =>
          fn(...args),
      ),
      click: vi.fn(),
      waitForFunction: vi.fn(),
    };

    await expect(
      dismissCathayAnnouncementModalIfPresent(page as never),
    ).resolves.toBe(false);
    expect(page.click).not.toHaveBeenCalled();
  });

  it("fails after three attempts when the period option never appears", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("document", {
      querySelectorAll: (selector: string) =>
        selector.includes("combobox") ? [combobox("近 30 天")] : [],
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

    const selected = selectTransactionPeriod(page as never, 90);
    const assertion = expect(selected).rejects.toThrow(
      'Cathay Bank period option "近 90 天" was not found.',
    );
    await vi.runAllTimersAsync();
    await assertion;
    expect(page.focus).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });
});
