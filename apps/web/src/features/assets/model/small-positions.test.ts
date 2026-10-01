import { describe, expect, it } from "vitest";
import type { InvestmentRow } from "@/data/investments/types";
import { isSmallCryptoPosition } from "./small-positions";

const row = (overrides: Partial<InvestmentRow>): InvestmentRow =>
  ({
    id: "p",
    connectorId: "binance",
    sourceId: "binance:spot:BTC",
    assetType: "crypto",
    name: "BTC",
    currency: "USD",
    marketValue: 100,
    asOfDate: "2026-10-01",
    ...overrides,
  }) as InvestmentRow;

describe("isSmallCryptoPosition", () => {
  it("flags crypto worth less than 1 USD, including zero", () => {
    expect(isSmallCryptoPosition(row({ marketValue: 0 }))).toBe(true);
    expect(isSmallCryptoPosition(row({ marketValue: 1 }))).toBe(false);
    expect(isSmallCryptoPosition(row({ marketValue: 250 }))).toBe(false);
  });

  it("keeps crypto with an unknown price visible", () => {
    expect(isSmallCryptoPosition(row({ marketValue: undefined }))).toBe(false);
  });

  it("never hides non-crypto or non-USD positions", () => {
    expect(
      isSmallCryptoPosition(row({ assetType: "stock", marketValue: 0 })),
    ).toBe(false);
    expect(
      isSmallCryptoPosition(row({ currency: "TWD", marketValue: 0 })),
    ).toBe(false);
  });
});
