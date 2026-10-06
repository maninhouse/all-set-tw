import type { ExchangeRateRow, ManualAssetRow } from "@/data/assets/types";
import type { BankAccountRow, BankData } from "@/data/bank/types";
import type { InvestmentRow } from "@/data/investments/types";
import {
  formatBankAccountName,
  formatDate,
  formatNumber,
  missingExchangeRateCurrencies,
} from "@/shared/format/financial";
import { isSmallAmount } from "./small-positions";

const CONNECTOR_BANK_CODES: Record<string, string> = {
  firstbank: "007",
  hncb: "008",
  cathaybk: "013",
  obank: "048",
  skbank: "103",
  sinopac: "807",
  esun: "808",
  taishin: "812",
  ctbc: "822",
  kgibank: "809",
  megabank: "017",
  rakuten: "826",
};

export interface InstitutionAssetGroup {
  key: string;
  institution: string;
  accounts: BankAccountRow[];
  cards: BankAccountRow[];
  assetTotalTwd: number;
  debtTotalTwd: number;
  hasUnknownCardBalance: boolean;
  foreignCurrencies: string[];
}

export type AssetCategoryKey =
  | "demand"
  | "time"
  | "other-account"
  | "tw-stock"
  | "foreign-stock"
  | "fund"
  | "crypto"
  | "other-investment"
  | "manual"
  | "credit";

/** Display order of the category ledger; empty categories are omitted. */
const ASSET_CATEGORIES: ReadonlyArray<{
  key: AssetCategoryKey;
  label: string;
}> = [
  { key: "demand", label: "活存" },
  { key: "time", label: "定存" },
  { key: "other-account", label: "其他帳戶" },
  { key: "tw-stock", label: "台股" },
  { key: "foreign-stock", label: "海外股" },
  { key: "fund", label: "基金" },
  { key: "crypto", label: "CRYPTO" },
  { key: "other-investment", label: "其他投資" },
  { key: "manual", label: "其他資產" },
  { key: "credit", label: "信用卡負債" },
];

export const MANUAL_ASSET_CATEGORY_LABELS = {
  real_estate: "不動產",
  insurance: "保險",
  vehicle: "交通工具",
  other: "其他",
};

const DEMAND_ACCOUNT_TYPES = new Set([
  "checking",
  "savings",
  "settlement_cash",
  "stored_value",
  "unknown",
]);

export interface AssetCategoryItem {
  id: string;
  title: string;
  subtitle: string;
  /** Extra detail line, e.g. time deposit start and maturity dates. */
  detail?: string;
  /** Signed amount in `currency`; credit card debt is negative. */
  amount: number;
  currency: string;
  amountTwd: number;
  /** Credit card whose balance has not been synced yet. */
  unknownAmount?: boolean;
  /** Holding with neither a market value nor cash, e.g. an unpriced coin. */
  unpriced?: boolean;
  /** Dust the ledger can hide: under 1 USD or NT$10 by currency. */
  small?: boolean;
  manual?: boolean;
}

export interface AssetCategoryGroup {
  key: AssetCategoryKey;
  label: string;
  kind: "asset" | "liability";
  items: AssetCategoryItem[];
  /** TWD subtotal; negative for liabilities. */
  subtotalTwd: number;
  missingCurrencies: string[];
  hasUnknownBalance: boolean;
}

export function bankAccountCategory(
  accountType: string | null | undefined,
): AssetCategoryKey {
  if (accountType === "credit") return "credit";
  if (accountType === "time_deposit") return "time";
  if (accountType == null || DEMAND_ACCOUNT_TYPES.has(accountType))
    return "demand";
  return "other-account";
}

export function investmentCategory(
  row: Pick<InvestmentRow, "assetType" | "currency">,
): AssetCategoryKey {
  const assetType: string = row.assetType;
  if (assetType === "stock" || assetType === "etf")
    return row.currency === "TWD" ? "tw-stock" : "foreign-stock";
  if (assetType === "fund") return "fund";
  if (assetType === "crypto") return "crypto";
  return "other-investment";
}

export interface AssetSummary {
  deposits: BankAccountRow[];
  cards: BankAccountRow[];
  bankTotal: number;
  investmentTotal: number;
  manualTotal: number;
  cardDebt: number;
  hasUnknownCardBalance: boolean;
  grossAssets: number;
  netWorth: number;
  institutionGroups: InstitutionAssetGroup[];
  /** Asset subtotals sum to `grossAssets`; the credit group to `-cardDebt`. */
  categoryGroups: AssetCategoryGroup[];
  /** Bank account and investment ids small enough to hide in either view. */
  smallItemIds: Set<string>;
  missingCurrencies: string[];
}

function institutionKey(account: BankAccountRow) {
  const bankCode =
    account.bankCode ?? CONNECTOR_BANK_CODES[account.connectorId];
  return bankCode ? `bank:${bankCode}` : `connector:${account.connectorId}`;
}

export function calculateAssetSummary({
  bank,
  investments,
  manualAssets,
  rates,
}: {
  bank: BankData;
  investments: InvestmentRow[];
  manualAssets: ManualAssetRow[];
  rates?: ExchangeRateRow[];
}): AssetSummary {
  const rateValues = Object.fromEntries(
    (rates ?? []).map((rate) => [rate.currency, rate.rateTwd]),
  );
  const toTwd = (value: number, currency: string) =>
    currency === "TWD" ? value : value * (rateValues[currency] ?? 0);
  const deposits = bank.accounts.filter(
    (account) => account.accountType !== "credit",
  );
  const cards = bank.accounts.filter(
    (account) => account.accountType === "credit",
  );
  const missingCurrencies = missingExchangeRateCurrencies(
    [
      ...deposits.map((account) => ({
        currency: account.currency,
        amount: account.balance ?? 0,
      })),
      ...cards.map((account) => ({
        currency: account.currency,
        amount: Math.abs(account.balance ?? 0),
      })),
      ...investments.map((item) => ({
        currency: item.currency,
        amount: (item.marketValue ?? 0) + (item.cashBalance ?? 0),
      })),
      ...manualAssets.map((item) => ({
        currency: item.currency,
        amount: item.value ?? 0,
      })),
    ],
    rateValues,
  );
  const bankTotal = deposits.reduce(
    (sum, account) => sum + toTwd(account.balance ?? 0, account.currency),
    0,
  );
  const investmentTotal = investments.reduce(
    (sum, item) =>
      sum +
      toTwd((item.marketValue ?? 0) + (item.cashBalance ?? 0), item.currency),
    0,
  );
  const manualTotal = manualAssets.reduce(
    (sum, item) => sum + toTwd(item.value ?? 0, item.currency),
    0,
  );
  const cardDebt = cards.reduce(
    (sum, account) => sum - toTwd(account.balance ?? 0, account.currency),
    0,
  );
  const grossAssets = bankTotal + investmentTotal + manualTotal;

  const groups = bank.accounts.reduce<Record<string, BankAccountRow[]>>(
    (result, account) => {
      (result[institutionKey(account)] ??= []).push(account);
      return result;
    },
    {},
  );
  const institutionGroups = Object.entries(groups)
    .map(([key, groupedAccounts]) => {
      const accounts = groupedAccounts.filter(
        (account) => account.accountType !== "credit",
      );
      const cards = groupedAccounts.filter(
        (account) => account.accountType === "credit",
      );
      return {
        key,
        institution:
          groupedAccounts.find((account) => account.institutionName)
            ?.institutionName ??
          groupedAccounts[0]?.connectorId ??
          "金融機構",
        accounts: [...accounts].sort(
          (a, b) =>
            toTwd(b.balance ?? 0, b.currency) -
            toTwd(a.balance ?? 0, a.currency),
        ),
        cards: [...cards].sort(
          (a, b) =>
            Math.abs(toTwd(b.balance ?? 0, b.currency)) -
            Math.abs(toTwd(a.balance ?? 0, a.currency)),
        ),
        assetTotalTwd: accounts.reduce(
          (sum, account) => sum + toTwd(account.balance ?? 0, account.currency),
          0,
        ),
        hasUnknownCardBalance: cards.some((card) => card.balance == null),
        debtTotalTwd: cards.reduce(
          (sum, account) => sum - toTwd(account.balance ?? 0, account.currency),
          0,
        ),
        foreignCurrencies: [
          ...new Set(
            groupedAccounts
              .map((account) => account.currency)
              .filter((currency) => currency !== "TWD"),
          ),
        ],
      };
    })
    .sort(
      (a, b) =>
        b.assetTotalTwd - a.assetTotalTwd ||
        b.debtTotalTwd - a.debtTotalTwd ||
        a.institution.localeCompare(b.institution, "zh-TW"),
    );

  const categoryItems = new Map<AssetCategoryKey, AssetCategoryItem[]>();
  const addItem = (key: AssetCategoryKey, item: AssetCategoryItem) =>
    categoryItems.set(key, [...(categoryItems.get(key) ?? []), item]);
  for (const account of bank.accounts) {
    const key = bankAccountCategory(account.accountType);
    const title = account.accountName ?? formatBankAccountName(account);
    const subtitle = [account.institutionName, account.currency]
      .filter(Boolean)
      .join(" · ");
    if (key === "credit") {
      // Signed like the bank balance: debt is negative, an overpayment positive.
      const amount = account.balance ?? 0;
      addItem(key, {
        id: account.id,
        title,
        subtitle,
        amount,
        currency: account.currency,
        amountTwd: toTwd(amount, account.currency),
        unknownAmount: account.balance == null,
        small:
          account.balance != null &&
          isSmallAmount(amount, account.currency, rateValues),
      });
      continue;
    }
    const amount = account.balance ?? 0;
    addItem(key, {
      id: account.id,
      title,
      subtitle,
      detail:
        key === "time"
          ? `起息日 ${account.openedDate ? formatDate(account.openedDate) : "尚未取得"} · 到期日 ${account.maturityDate ? formatDate(account.maturityDate) : "尚未取得"}`
          : undefined,
      amount,
      currency: account.currency,
      amountTwd: toTwd(amount, account.currency),
      small:
        account.balance != null &&
        isSmallAmount(amount, account.currency, rateValues),
    });
  }
  for (const item of investments) {
    const amount = (item.marketValue ?? 0) + (item.cashBalance ?? 0);
    const unpriced = item.marketValue == null && item.cashBalance == null;
    addItem(investmentCategory(item), {
      id: item.id,
      // Crypto names already start with the symbol, e.g. "BTC（現貨）".
      title:
        item.symbol && !item.name.startsWith(item.symbol)
          ? `${item.symbol} ${item.name}`
          : item.name,
      subtitle: `${item.assetType.toUpperCase()} · ${item.currency} · ${formatNumber(item.quantity ?? 0)} 單位${item.source === "manual" ? " · 手動" : ""}`,
      amount,
      currency: item.currency,
      amountTwd: toTwd(amount, item.currency),
      unpriced,
      small: !unpriced && isSmallAmount(amount, item.currency, rateValues),
      manual: item.source === "manual",
    });
  }
  for (const item of manualAssets) {
    const amount = item.value ?? 0;
    addItem("manual", {
      id: item.id,
      title: item.name,
      subtitle: `${MANUAL_ASSET_CATEGORY_LABELS[item.category as keyof typeof MANUAL_ASSET_CATEGORY_LABELS] ?? item.category} · ${item.currency}`,
      amount,
      currency: item.currency,
      amountTwd: toTwd(amount, item.currency),
    });
  }
  const categoryGroups = ASSET_CATEGORIES.flatMap(
    ({ key, label }): AssetCategoryGroup[] => {
      const items = categoryItems.get(key);
      if (!items?.length) return [];
      return [
        {
          key,
          label,
          kind: key === "credit" ? "liability" : "asset",
          // Largest holding (or debt) first.
          items: [...items].sort(
            (a, b) => Math.abs(b.amountTwd) - Math.abs(a.amountTwd),
          ),
          subtotalTwd: items.reduce((sum, item) => sum + item.amountTwd, 0),
          missingCurrencies: missingExchangeRateCurrencies(
            items.map((item) => ({
              currency: item.currency,
              amount: Math.abs(item.amount),
            })),
            rateValues,
          ),
          hasUnknownBalance: items.some((item) => item.unknownAmount),
        },
      ];
    },
  );

  return {
    deposits,
    cards,
    bankTotal,
    investmentTotal,
    manualTotal,
    cardDebt,
    hasUnknownCardBalance: cards.some((card) => card.balance == null),
    grossAssets,
    netWorth: grossAssets - cardDebt,
    institutionGroups,
    categoryGroups,
    smallItemIds: new Set(
      categoryGroups.flatMap((group) =>
        group.items.filter((item) => item.small).map((item) => item.id),
      ),
    ),
    missingCurrencies,
  };
}
