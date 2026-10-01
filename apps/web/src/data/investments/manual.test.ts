import { describe, expect, it } from "vitest";
import { toInvestmentRows } from "./manual";
import type { ManualInvestmentRow } from "./types";

function holding(overrides: Partial<ManualInvestmentRow>): ManualInvestmentRow {
  return {
    id: "manual-inv:1",
    broker: "fubon",
    market: "US",
    symbol: "AAPL",
    name: "Apple",
    assetType: "stock",
    quantity: 10,
    currency: "USD",
    manualPrice: null,
    manualPriceDate: null,
    quotePrice: 200,
    quoteAt: "2026-10-01T01:00:00.000Z",
    note: null,
    updatedAt: "2026-09-01T00:00:00.000Z",
    price: 200,
    priceSource: "quote",
    marketValue: 2000,
    quoteStale: false,
    supersededBy: null,
    ...overrides,
  };
}

describe("toInvestmentRows", () => {
  it("maps quoted holdings to investment rows dated by the quote", () => {
    expect(toInvestmentRows([holding({ quoteStale: true })])).toEqual([
      {
        id: "manual-inv:1",
        assetType: "stock",
        symbol: "AAPL",
        name: "Apple",
        quantity: 10,
        marketValue: 2000,
        currency: "USD",
        asOfDate: "2026-10-01",
        source: "manual",
        quoteStale: true,
      },
    ]);
  });

  it("dates manual prices by their price date and never flags them stale", () => {
    const [row] = toInvestmentRows([
      holding({
        manualPrice: 150,
        manualPriceDate: "2026-09-30",
        price: 150,
        priceSource: "manual",
        marketValue: 1500,
        quoteStale: true,
      }),
    ]);
    expect(row).toMatchObject({
      asOfDate: "2026-09-30",
      marketValue: 1500,
      quoteStale: false,
    });
  });

  it("leaves the value empty when no price is available", () => {
    const [row] = toInvestmentRows([
      holding({ price: null, priceSource: "none", marketValue: null }),
    ]);
    expect(row?.marketValue).toBeUndefined();
  });

  it("drops holdings a connector already syncs", () => {
    expect(
      toInvestmentRows([
        holding({
          supersededBy: { connectorId: "fubon", asOfDate: "2026-09-30" },
        }),
        holding({ id: "manual-inv:2", symbol: "MSFT" }),
      ]).map((row) => row.symbol),
    ).toEqual(["MSFT"]);
  });
});
