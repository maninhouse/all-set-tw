import { describe, expect, it, vi } from "vitest";
import { scrapeCreditCards } from "../../../src/sources/cathaybk/connector";

describe("國泰信用卡總覽", () => {
  it("reloads the overview once when the card block fails to render", async () => {
    const page = {
      evaluate: vi
        .fn()
        .mockResolvedValueOnce("信用卡帳戶總覽")
        .mockResolvedValueOnce("卡片末四碼：1234")
        .mockResolvedValueOnce({ allBills: [], monthDetails: [] }),
      goto: vi.fn().mockResolvedValue(undefined),
      waitForFunction: vi.fn().mockResolvedValue(undefined),
    };

    const result = await scrapeCreditCards(
      page as unknown as Parameters<typeof scrapeCreditCards>[0],
    );

    expect(page.goto).toHaveBeenCalledTimes(3);
    expect(result.bankAccounts).toHaveLength(1);
  });
});
