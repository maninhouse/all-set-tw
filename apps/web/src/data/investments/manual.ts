import type { InvestmentRow, ManualInvestmentRow } from "./types";

/**
 * Manual holdings counted alongside synced positions. Rows a connector
 * already syncs are dropped so the same holding is never counted twice.
 */
export function toInvestmentRows(rows: ManualInvestmentRow[]): InvestmentRow[] {
  return rows
    .filter((row) => row.supersededBy === null)
    .map((row) => ({
      id: row.id,
      assetType: row.assetType,
      symbol: row.symbol,
      name: row.name,
      quantity: row.quantity,
      marketValue: row.marketValue ?? undefined,
      currency: row.currency,
      asOfDate:
        row.priceSource === "manual"
          ? (row.manualPriceDate ?? row.updatedAt.slice(0, 10))
          : (row.quoteAt ?? row.updatedAt).slice(0, 10),
      source: "manual",
      quoteStale: row.priceSource === "quote" ? row.quoteStale : false,
    }));
}
