import { afterEach, describe, expect, it, vi } from "vitest";

import {
  parseCathayUnbilledConsume,
  scrapeCreditCards,
} from "../../../src/sources/cathaybk/connector";

afterEach(() => vi.unstubAllGlobals());

describe("Cathay unbilled consumption", () => {
  const unbilledResponse = (details: unknown[] = []) => ({
    success: true,
    content: {
      nextBillDate: "2026-10-08T00:00:00",
      unBilledAmount: 1230,
      unBilledCount: details.length,
      foreignUnBilledAmount: null,
      twdUnbilledConsumeDetail: details,
    },
  });

  it("parses TWD unbilled rows and summary totals", () => {
    const parsed = parseCathayUnbilledConsume(
      unbilledResponse([
        {
          consumeDate: "2026-09-28T00:00:00",
          merchantName: "全聯 ",
          twdAmount: 230,
        },
        {
          consumeDate: "2026-09-29T00:00:00",
          merchantName: "退款",
          twdAmount: 0,
        },
      ]),
    );

    expect(parsed).toMatchObject({
      nextBillDate: "2026-10-08T00:00:00",
      amount: 1230,
      count: 2,
      trades: [
        {
          consumeDate: "2026-09-28T00:00:00",
          transDesc: "全聯",
          amount: 230,
          currency: "TWD",
        },
      ],
    });
  });

  it("treats a missing list or inconsistent totals as a failed fetch", () => {
    expect(
      parseCathayUnbilledConsume({ success: true, content: {} }),
    ).toBeNull();
    expect(
      parseCathayUnbilledConsume({
        success: true,
        content: { twdUnbilledConsumeDetail: null },
      }),
    ).toBeNull();
    expect(
      parseCathayUnbilledConsume({
        success: true,
        content: {
          unBilledAmount: 500,
          unBilledCount: 0,
          twdUnbilledConsumeDetail: [],
        },
      }),
    ).toBeNull();
    expect(
      parseCathayUnbilledConsume({
        success: true,
        content: {
          unBilledCount: 3,
          twdUnbilledConsumeDetail: [
            {
              consumeDate: "2026-09-28T00:00:00",
              merchantName: "a",
              twdAmount: 1,
            },
          ],
        },
      }),
    ).toBeNull();
    expect(
      parseCathayUnbilledConsume({
        success: true,
        content: {
          unBilledAmount: 0,
          unBilledCount: 0,
          twdUnbilledConsumeDetail: [],
        },
      }),
    ).toMatchObject({ trades: [] });
  });

  it("returns null for failed or malformed responses", () => {
    expect(parseCathayUnbilledConsume(null)).toBeNull();
    expect(
      parseCathayUnbilledConsume({ success: false, content: null }),
    ).toBeNull();
    expect(
      parseCathayUnbilledConsume({
        success: true,
        content: { twdUnbilledConsumeDetail: "oops" },
      }),
    ).toBeNull();
    expect(
      parseCathayUnbilledConsume(
        unbilledResponse([{ consumeDate: "2026-09-28T00:00:00" }]),
      ),
    ).toBeNull();
  });

  it("imports unbilled rows once and keeps statement rows on overlap", async () => {
    const overview =
      "信用卡帳戶總覽 卡片末四碼：1234 永久信用額度 TWD 100,000 剩餘可用額度 TWD 90,000 無需繳費";
    const statementTrade = {
      consumeDate: "2026-08-31T00:00:00",
      transDesc: "無老鍋",
      amount: 2147,
      currency: "TWD",
    };
    const page = {
      evaluate: vi
        .fn()
        .mockResolvedValueOnce(overview)
        .mockResolvedValueOnce({
          allBills: [
            {
              billDate: "2026-09-08T00:00:00",
              twdAmount: 2147,
              usdAmount: null,
              billStatus: "paid",
            },
          ],
          monthDetails: [
            {
              billDate: "2026-09-08T00:00:00",
              twdAmount: 2147,
              sections: [
                {
                  detailType: "PrimaryCardConsume",
                  tradeData: [statementTrade],
                },
              ],
            },
          ],
          unbilledResp: unbilledResponse([
            {
              consumeDate: "2026-08-31T00:00:00",
              merchantName: "無老鍋",
              twdAmount: 2147,
            },
            {
              consumeDate: "2026-09-28T00:00:00",
              merchantName: "全聯",
              twdAmount: 230,
            },
            {
              consumeDate: "2026-09-28T00:00:00",
              merchantName: "全聯",
              twdAmount: 230,
            },
          ]),
        }),
      goto: vi.fn().mockResolvedValue(undefined),
      waitForFunction: vi.fn().mockResolvedValue(undefined),
    };

    const result = await scrapeCreditCards(
      page as unknown as Parameters<typeof scrapeCreditCards>[0],
    );

    const ids = result.bankTransactions.map((t) => t.sourceId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(result.bankTransactions).toHaveLength(3);
    expect(
      result.bankTransactions.filter((t) => t.description === "全聯"),
    ).toMatchObject([
      { amount: -230, raw: { unbilled: true, duplicateOccurrence: 1 } },
      { amount: -230, raw: { unbilled: true, duplicateOccurrence: 2 } },
    ]);
    expect(
      result.bankTransactions.find((t) => t.description === "無老鍋")?.raw,
    ).not.toHaveProperty("unbilled");
    expect(result.bankBalanceSnapshots[0]?.raw).toMatchObject({
      unbilledAmount: 1230,
      nextBillDate: "2026-10-08T00:00:00",
    });
  });

  it("keeps bills and statement rows when the unbilled call fails", async () => {
    const page = {
      evaluate: vi
        .fn()
        .mockResolvedValueOnce("卡片末四碼：1234")
        .mockResolvedValueOnce({
          allBills: [],
          monthDetails: [],
          unbilledResp: null,
        }),
      goto: vi.fn().mockResolvedValue(undefined),
      waitForFunction: vi.fn().mockResolvedValue(undefined),
    };

    const result = await scrapeCreditCards(
      page as unknown as Parameters<typeof scrapeCreditCards>[0],
    );

    expect(result.bankTransactions).toEqual([]);
    expect(result.bankAccounts).toHaveLength(1);
  });
});
