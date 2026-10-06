import { describe, expect, it } from "vitest";
import type { InvestmentRow } from "@/data/investments/types";
import {
  bankAccountCategory,
  calculateAssetSummary,
  investmentCategory,
} from "./summary";

describe("calculateAssetSummary", () => {
  it("counts credit-card overpayments toward net worth instead of debt", () => {
    const summary = calculateAssetSummary({
      bank: {
        accounts: [
          {
            id: "credit",
            sourceId: "credit",
            connectorId: "sinopac",
            accountType: "credit",
            balance: 137,
            currency: "TWD",
          },
          {
            id: "debt",
            sourceId: "debt",
            connectorId: "esun",
            accountType: "credit",
            balance: -1000,
            currency: "TWD",
          },
        ],
        transactions: [],
      },
      investments: [],
      manualAssets: [],
      rates: [],
    });
    expect(summary.cardDebt).toBe(863);
    expect(summary.netWorth).toBe(-863);
    expect(
      summary.institutionGroups.find((group) => group.cards[0]?.id === "credit")
        ?.debtTotalTwd,
    ).toBe(-137);
  });
  it("converts balances and groups accounts and cards by institution", () => {
    const summary = calculateAssetSummary({
      bank: {
        accounts: [
          {
            id: "deposit",
            connectorId: "esun",
            sourceId: "deposit",
            institutionName: "玉山銀行",
            bankCode: "808",
            accountType: "savings",
            balance: 100,
            currency: "USD",
          },
          {
            id: "card",
            connectorId: "esun",
            sourceId: "card",
            institutionName: "玉山銀行",
            bankCode: "808",
            accountType: "credit",
            balance: -2_000,
            currency: "TWD",
          },
        ],
        transactions: [],
      },
      investments: [
        {
          id: "investment",
          assetType: "stock",
          name: "測試持倉",
          marketValue: 10_000,
          currency: "TWD",
          asOfDate: "2026-07-22",
        },
      ],
      manualAssets: [
        {
          id: "home",
          name: "房屋",
          category: "real_estate",
          note: null,
          currency: "USD",
          createdAt: "2026-07-22",
          value: 200,
        },
      ],
      rates: [{ currency: "USD", rateTwd: 30, updatedAt: "2026-07-22" }],
    });

    expect(summary.bankTotal).toBe(3_000);
    expect(summary.cardDebt).toBe(2_000);
    expect(summary.netWorth).toBe(17_000);
    expect(summary.institutionGroups).toHaveLength(1);
    expect(summary.institutionGroups[0]).toMatchObject({
      key: "bank:808",
      institution: "玉山銀行",
      assetTotalTwd: 3_000,
      debtTotalTwd: 2_000,
    });
    expect(summary.institutionGroups[0]?.accounts).toHaveLength(1);
    expect(summary.institutionGroups[0]?.cards).toHaveLength(1);
    expect(summary.missingCurrencies).toEqual([]);
  });

  it("reports currencies omitted from TWD totals when exchange rates are missing", () => {
    const summary = calculateAssetSummary({
      bank: {
        accounts: [
          {
            id: "foreign",
            connectorId: "obank",
            sourceId: "foreign",
            accountType: "savings",
            balance: 100,
            currency: "USD",
          },
        ],
        transactions: [],
      },
      investments: [],
      manualAssets: [
        {
          id: "yen",
          name: "日圓資產",
          category: "other",
          note: null,
          currency: "JPY",
          createdAt: "2026-08-09",
          value: 10_000,
        },
      ],
      rates: [],
    });

    expect(summary.grossAssets).toBe(0);
    expect(summary.missingCurrencies).toEqual(["JPY", "USD"]);
  });
});

describe("asset categories", () => {
  it.each([
    ["checking", "demand"],
    ["savings", "demand"],
    ["settlement_cash", "demand"],
    ["stored_value", "demand"],
    ["unknown", "demand"],
    [undefined, "demand"],
    ["time_deposit", "time"],
    ["loan", "other-account"],
    ["credit", "credit"],
  ] as const)("classifies bank account type %s as %s", (type, key) => {
    expect(bankAccountCategory(type)).toBe(key);
  });

  it.each([
    ["stock", "TWD", "tw-stock"],
    ["etf", "TWD", "tw-stock"],
    ["stock", "USD", "foreign-stock"],
    ["etf", "JPY", "foreign-stock"],
    ["fund", "TWD", "fund"],
    ["fund", "USD", "fund"],
    ["crypto", "USD", "crypto"],
    ["bond", "TWD", "other-investment"],
  ] as const)("classifies %s in %s as %s", (assetType, currency, key) => {
    expect(
      investmentCategory({
        assetType: assetType as InvestmentRow["assetType"],
        currency,
      }),
    ).toBe(key);
  });

  const fixture = () =>
    calculateAssetSummary({
      bank: {
        accounts: [
          {
            id: "demand-twd",
            connectorId: "esun",
            sourceId: "bank:esun:0000000012345",
            institutionName: "玉山銀行",
            accountType: "savings",
            balance: 1_000,
            currency: "TWD",
          },
          {
            id: "demand-usd",
            connectorId: "esun",
            sourceId: "bank:esun:0000000067890",
            institutionName: "玉山銀行",
            accountType: "checking",
            balance: 100.1,
            currency: "USD",
          },
          {
            id: "time",
            connectorId: "esun",
            sourceId: "td",
            accountName: "定存一號",
            institutionName: "玉山銀行",
            accountType: "time_deposit",
            balance: 50_000,
            currency: "TWD",
            openedDate: "2026-01-01",
          },
          {
            id: "card",
            connectorId: "esun",
            sourceId: "card",
            institutionName: "玉山銀行",
            accountType: "credit",
            balance: -2_000,
            currency: "TWD",
          },
          {
            id: "card-unknown",
            connectorId: "ctbc",
            sourceId: "card2",
            accountType: "credit",
            balance: null,
            currency: "TWD",
          },
        ],
        transactions: [],
      },
      investments: [
        {
          id: "0050",
          assetType: "etf",
          symbol: "0050",
          name: "元大台灣50",
          marketValue: 20_000,
          currency: "TWD",
          asOfDate: "2026-10-01",
        },
        {
          id: "vt",
          assetType: "etf",
          symbol: "VT",
          name: "Vanguard Total World",
          marketValue: 33.3,
          currency: "USD",
          asOfDate: "2026-10-01",
          source: "manual",
        },
        {
          id: "jp",
          assetType: "stock",
          symbol: "7203",
          name: "Toyota",
          marketValue: 1_000,
          currency: "JPY",
          asOfDate: "2026-10-01",
          source: "manual",
        },
        {
          id: "fund",
          assetType: "fund",
          name: "某基金",
          marketValue: 5_000,
          cashBalance: 10,
          currency: "TWD",
          asOfDate: "2026-10-01",
        },
        {
          id: "btc",
          assetType: "crypto",
          symbol: "BTC",
          name: "BTC（現貨）",
          quantity: 0.01,
          marketValue: 600,
          currency: "USD",
          asOfDate: "2026-10-01",
        },
        {
          id: "dust",
          assetType: "crypto",
          symbol: "ACT",
          name: "ACT（資金）",
          marketValue: 0,
          currency: "USD",
          asOfDate: "2026-10-01",
        },
        {
          id: "unpriced",
          assetType: "crypto",
          symbol: "MONKY",
          name: "MONKY（現貨）",
          currency: "USD",
          asOfDate: "2026-10-01",
        },
      ],
      manualAssets: [
        {
          id: "home",
          name: "房屋",
          category: "real_estate",
          note: null,
          currency: "TWD",
          createdAt: "2026-07-22",
          value: 3_000_000,
        },
      ],
      rates: [{ currency: "USD", rateTwd: 32.1, updatedAt: "2026-10-01" }],
    });

  it("groups everything in a fixed order and omits empty categories", () => {
    const summary = fixture();
    expect(summary.categoryGroups.map((group) => group.label)).toEqual([
      "活存",
      "定存",
      "台股",
      "海外股",
      "基金",
      "CRYPTO",
      "其他資產",
      "信用卡負債",
    ]);
    const totalItems = summary.categoryGroups.reduce(
      (sum, group) => sum + group.items.length,
      0,
    );
    expect(totalItems).toBe(5 + 7 + 1);
  });

  it("reconciles subtotals with the summary totals", () => {
    const summary = fixture();
    const assets = summary.categoryGroups.filter(
      (group) => group.kind === "asset",
    );
    const credit = summary.categoryGroups.find(
      (group) => group.key === "credit",
    );
    expect(
      assets.reduce((sum, group) => sum + group.subtotalTwd, 0),
    ).toBeCloseTo(summary.grossAssets, 6);
    expect(credit?.subtotalTwd).toBeCloseTo(-summary.cardDebt, 6);
    expect(credit?.kind).toBe("liability");
  });

  it("builds item details and flags", () => {
    const groups = Object.fromEntries(
      fixture().categoryGroups.map((group) => [group.key, group]),
    );
    expect(groups.demand.items.map((item) => item.id)).toEqual([
      "demand-usd",
      "demand-twd",
    ]);
    expect(groups.demand.items[1]).toMatchObject({
      title: "12345",
      subtitle: "玉山銀行 · TWD",
    });
    expect(groups.time.items[0]).toMatchObject({
      title: "定存一號",
      detail: "起息日 2026/1/1 · 到期日 尚未取得",
    });
    expect(groups.fund.subtotalTwd).toBe(5_010);
    expect(groups["foreign-stock"].missingCurrencies).toEqual(["JPY"]);
    expect(groups["foreign-stock"].items[0]).toMatchObject({
      title: "VT Vanguard Total World",
      manual: true,
    });
    const crypto = new Map(groups.crypto.items.map((item) => [item.id, item]));
    expect(crypto.get("btc")?.title).toBe("BTC（現貨）");
    expect(crypto.get("dust")?.small).toBe(true);
    expect(crypto.get("unpriced")).toMatchObject({
      unpriced: true,
      small: false,
    });
    expect(groups.manual.items[0].subtitle).toBe("不動產 · TWD");
    expect(groups.credit.hasUnknownBalance).toBe(true);
    expect(groups.credit.items.map((item) => item.amount)).toEqual([-2_000, 0]);
  });

  it("marks dust across accounts and holdings, but never unknown values", () => {
    const account = (
      id: string,
      balance: number | null,
      currency = "TWD",
      accountType = "savings",
    ) => ({
      id,
      connectorId: "esun" as const,
      sourceId: id,
      accountType,
      balance,
      currency,
    });
    const summary = calculateAssetSummary({
      bank: {
        accounts: [
          account("zero", 0),
          account("nine", 9.99),
          account("ten", 10),
          account("usd-cent", 0.1, "USD"),
          // Worth NT$25.6, but USD items use the 1 USD threshold.
          account("usd-80-cents", 0.8, "USD"),
          account("usd-one", 1, "USD"),
          account("jpy-no-rate", 5, "JPY"),
          account("not-synced", null),
          account("card-zero", 0, "TWD", "credit"),
          account("card-unknown", null, "TWD", "credit"),
          account("card-debt", -5_000, "TWD", "credit"),
        ],
        transactions: [],
      },
      investments: [
        {
          id: "odd-lot",
          assetType: "stock",
          name: "零股",
          marketValue: 8,
          currency: "TWD",
          asOfDate: "2026-10-01",
        },
        {
          id: "crypto-5usd",
          assetType: "crypto",
          name: "ADA（現貨）",
          marketValue: 5,
          currency: "USD",
          asOfDate: "2026-10-01",
        },
        {
          id: "crypto-dust",
          assetType: "crypto",
          name: "ACT（資金）",
          marketValue: 0.5,
          currency: "USD",
          asOfDate: "2026-10-01",
        },
        {
          id: "unpriced-stock",
          assetType: "stock",
          name: "未報價",
          currency: "TWD",
          asOfDate: "2026-10-01",
        },
      ],
      manualAssets: [
        {
          id: "manual-zero",
          name: "待估值",
          category: "other",
          note: null,
          currency: "TWD",
          createdAt: "2026-10-01",
          value: 0,
        },
      ],
      rates: [{ currency: "USD", rateTwd: 32, updatedAt: "2026-10-01" }],
    });
    expect([...summary.smallItemIds].sort()).toEqual(
      [
        "card-zero",
        "crypto-dust",
        "nine",
        "odd-lot",
        "usd-80-cents",
        "usd-cent",
        "zero",
      ].sort(),
    );
  });

  it("returns no categories without any data", () => {
    expect(
      calculateAssetSummary({
        bank: { accounts: [], transactions: [] },
        investments: [],
        manualAssets: [],
      }).categoryGroups,
    ).toEqual([]);
  });
});
