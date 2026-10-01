import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  addManualInvestment,
  editManualInvestment,
  getManualInvestments,
  ManualInvestmentConflictError,
} from "../../../src/features/manual-investments/service";
import { createTestD1 } from "../../helpers/d1";

function quoteFetcher(
  prices: Record<string, number | Error>,
  currency = "USD",
) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const symbol = decodeURIComponent(url.pathname.split("/").at(-1)!);
    const price = prices[symbol];
    if (price === undefined || price instanceof Error) {
      throw price ?? new Error(`unexpected ${symbol}`);
    }
    return Response.json({
      chart: {
        result: [
          {
            meta: {
              currency: symbol.endsWith(".T") ? "JPY" : currency,
              regularMarketPrice: price,
            },
          },
        ],
      },
    });
  }) as unknown as typeof fetch;
}

const baseInput = {
  broker: "fubon" as const,
  market: "US" as const,
  symbol: " aapl ",
  name: "Apple",
  assetType: "stock" as const,
  quantity: 10,
};

describe("manual investment service", () => {
  let harness: Awaited<ReturnType<typeof createTestD1>>;

  beforeAll(async () => {
    harness = await createTestD1();
  }, 60_000);

  afterAll(async () => {
    await harness?.mf.dispose();
  });

  beforeEach(async () => {
    await harness.binding.batch([
      harness.binding.prepare("DELETE FROM manual_investment_positions"),
      harness.binding.prepare("DELETE FROM investment_positions"),
    ]);
  });

  it("normalizes the symbol, fetches a quote and values the holding", async () => {
    const now = new Date("2026-10-01T00:00:00.000Z");
    const fetcher = quoteFetcher({ AAPL: 200 });
    await addManualInvestment(harness.binding, baseInput, { fetcher, now });

    const [position] = await getManualInvestments(harness.binding, {
      fetcher,
      now,
    });
    expect(position).toMatchObject({
      symbol: "AAPL",
      currency: "USD",
      quotePrice: 200,
      price: 200,
      priceSource: "quote",
      marketValue: 2000,
      quoteStale: false,
      supersededBy: null,
    });
    // Fresh quote is reused: no second provider call on read.
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("quotes London-listed USD lines with the .L suffix", async () => {
    const now = new Date("2026-10-01T00:00:00.000Z");
    const fetcher = quoteFetcher({ "VWRA.L": 190 });
    await addManualInvestment(
      harness.binding,
      {
        ...baseInput,
        market: "UK",
        symbol: "vwra",
        name: "Vanguard FTSE All-World",
        assetType: "etf",
        quantity: 3,
      },
      { fetcher, now },
    );

    const rows = await getManualInvestments(harness.binding, { fetcher, now });
    expect(rows.find((row) => row.market === "UK")).toMatchObject({
      symbol: "VWRA",
      currency: "USD",
      marketValue: 570,
    });
  });

  it("prefers the manual price over the quote", async () => {
    const now = new Date("2026-10-01T00:00:00.000Z");
    await addManualInvestment(
      harness.binding,
      { ...baseInput, manualPrice: 150, manualPriceDate: "2026-09-30" },
      { fetcher: quoteFetcher({ AAPL: 200 }), now },
    );

    const [position] = await getManualInvestments(harness.binding, {
      fetcher: quoteFetcher({}),
      now,
    });
    expect(position).toMatchObject({
      price: 150,
      priceSource: "manual",
      marketValue: 1500,
      quotePrice: 200,
    });
  });

  it("refreshes stale quotes and keeps the old price when the provider fails", async () => {
    const created = new Date("2026-10-01T00:00:00.000Z");
    await addManualInvestment(harness.binding, baseInput, {
      fetcher: quoteFetcher({ AAPL: 200 }),
      now: created,
    });
    const later = new Date("2026-10-01T01:00:00.000Z");

    const [failed] = await getManualInvestments(harness.binding, {
      fetcher: quoteFetcher({ AAPL: new Error("down") }),
      now: later,
    });
    expect(failed).toMatchObject({ price: 200, quoteStale: true });

    const [refreshed] = await getManualInvestments(harness.binding, {
      fetcher: quoteFetcher({ AAPL: 210 }),
      now: later,
    });
    expect(refreshed).toMatchObject({
      price: 210,
      quoteStale: false,
      quoteAt: later.toISOString(),
    });
  });

  it("does not store quotes when persistence is disabled", async () => {
    const created = new Date("2026-10-01T00:00:00.000Z");
    await addManualInvestment(harness.binding, baseInput, {
      fetcher: quoteFetcher({ AAPL: 200 }),
      now: created,
    });
    const later = new Date("2026-10-01T01:00:00.000Z");
    const [shown] = await getManualInvestments(harness.binding, {
      fetcher: quoteFetcher({ AAPL: 210 }),
      now: later,
      persist: false,
    });
    expect(shown?.price).toBe(210);

    const [stored] = await getManualInvestments(harness.binding, {
      fetcher: quoteFetcher({ AAPL: new Error("down") }),
      now: later,
    });
    expect(stored?.price).toBe(200);
  });

  it("rejects a quote in an unexpected currency", async () => {
    await addManualInvestment(harness.binding, baseInput, {
      fetcher: quoteFetcher({ AAPL: 200 }, "EUR"),
      now: new Date("2026-10-01T00:00:00.000Z"),
    });
    const [position] = await getManualInvestments(harness.binding, {
      fetcher: quoteFetcher({}),
      now: new Date("2026-10-01T00:00:00.000Z"),
    });
    expect(position).toMatchObject({ price: null, priceSource: "none" });
  });

  it("rejects duplicates by broker, market and normalized symbol", async () => {
    const fetcher = quoteFetcher({ AAPL: 200, MSFT: 400 });
    await addManualInvestment(harness.binding, baseInput, { fetcher });
    await expect(
      addManualInvestment(
        harness.binding,
        { ...baseInput, symbol: "AAPL" },
        { fetcher },
      ),
    ).rejects.toBeInstanceOf(ManualInvestmentConflictError);

    const id = await addManualInvestment(
      harness.binding,
      { ...baseInput, symbol: "MSFT" },
      { fetcher },
    );
    await expect(
      editManualInvestment(
        harness.binding,
        id,
        { symbol: "aapl" },
        { fetcher },
      ),
    ).rejects.toBeInstanceOf(ManualInvestmentConflictError);
  });

  it("marks holdings already synced by the matching connector as superseded", async () => {
    const now = new Date("2026-10-01T00:00:00.000Z");
    const fetcher = quoteFetcher({ AAPL: 200, MSFT: 400 });
    await addManualInvestment(harness.binding, baseInput, { fetcher, now });
    await addManualInvestment(
      harness.binding,
      { ...baseInput, symbol: "MSFT" },
      { fetcher, now },
    );
    await addManualInvestment(
      harness.binding,
      { ...baseInput, broker: "other", symbol: "AAPL" },
      { fetcher, now },
    );
    const insert = harness.binding.prepare(
      `INSERT INTO investment_positions
         (id, connector_id, source_id, asset_type, symbol, name, quantity,
          market_value, currency, as_of_date, created_at, updated_at)
       VALUES (?, ?, ?, 'stock', ?, ?, 10, 2000, 'USD', ?, ?, ?)`,
    );
    await harness.binding.batch([
      insert.bind(
        "p1",
        "fubon",
        "aapl",
        "aapl",
        "Apple",
        "2026-09-30",
        "t",
        "t",
      ),
      // An older snapshot must not supersede: MSFT was sold before 09-30.
      insert.bind(
        "p2",
        "fubon",
        "msft",
        "MSFT",
        "Microsoft",
        "2026-09-01",
        "t",
        "t",
      ),
    ]);

    const positions = await getManualInvestments(harness.binding, {
      fetcher,
      now,
    });
    const bySymbol = (broker: string, symbol: string) =>
      positions.find((p) => p.broker === broker && p.symbol === symbol);
    expect(bySymbol("fubon", "AAPL")?.supersededBy).toEqual({
      connectorId: "fubon",
      asOfDate: "2026-09-30",
    });
    expect(bySymbol("fubon", "MSFT")?.supersededBy).toBeNull();
    expect(bySymbol("other", "AAPL")?.supersededBy).toBeNull();
  });
});
