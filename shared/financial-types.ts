export interface NetWorthHistoryPoint {
  date: string; // YYYY-MM-DD
  netWorth: number;
  assetType?: "total" | "stock" | "fund";
}

export interface CreditCardBill {
  id: string;
  connectorId: string;
  accountId: string;
  sourceId: string;
  billingPeriod: string; // "2026-05"
  statementAmount?: number;
  minimumPayment?: number;
  paidAmount?: number;
  isPaid?: boolean;
  paymentDueDate?: string;
  statementClosingDate?: string;
  currency: string;
  raw?: unknown;
}

export interface Invoice {
  id: string;
  connectorId: string;
  sourceId: string;
  invoiceNumber?: string;
  /** YYYY-MM-DD when time is unknown; otherwise an ISO timestamp with timezone. */
  invoiceDate: string;
  sellerName?: string;
  amount: number;
  raw?: unknown;
}

export interface InvoiceLineItem {
  id: string;
  connectorId: string;
  invoiceId: string;
  invoiceSourceId: string;
  sourceId: string;
  lineNumber: number;
  description: string;
  quantity?: number;
  unitPrice?: number;
  amount: number;
  raw?: unknown;
}

export type AssetType = "stock" | "etf" | "fund" | "crypto";

export interface InvestmentPosition {
  id: string;
  connectorId: string;
  sourceId: string;
  assetType: AssetType;
  symbol?: string;
  name: string;
  quantity?: number;
  marketValue?: number;
  cashBalance?: number;
  currency: string;
  asOfDate: string;
  raw?: unknown;
}

/** Brokers without a connector yet; keys must match the future connector id. */
export const MANUAL_INVESTMENT_BROKERS = {
  fubon: "富邦證券",
  other: "其他",
} as const;

export type ManualInvestmentBroker = keyof typeof MANUAL_INVESTMENT_BROKERS;

export const MANUAL_INVESTMENT_MARKETS = {
  US: { label: "美股", currency: "USD" },
  JP: { label: "日股", currency: "JPY" },
  // LSE listings quoted in USD (e.g. VWRA); GBP/GBp-quoted lines are rejected.
  UK: { label: "英股（倫敦）", currency: "USD" },
} as const;

export type ManualInvestmentMarket = keyof typeof MANUAL_INVESTMENT_MARKETS;

export interface ManualInvestmentPosition {
  id: string;
  broker: ManualInvestmentBroker;
  market: ManualInvestmentMarket;
  symbol: string;
  name: string;
  assetType: "stock" | "etf";
  quantity: number;
  currency: string;
  manualPrice: number | null;
  manualPriceDate: string | null;
  quotePrice: number | null;
  quoteAt: string | null;
  note: string | null;
  updatedAt: string;
  price: number | null;
  priceSource: "manual" | "quote" | "none";
  marketValue: number | null;
  /** True when the latest quote refresh failed or is older than the stale window. */
  quoteStale: boolean;
  /** Set when a connector already syncs this holding; it must not be counted again. */
  supersededBy: { connectorId: string; asOfDate: string } | null;
}

export interface InvestmentTransaction {
  id: string;
  connectorId: string;
  accountId: string;
  sourceId: string;
  brokerNo?: string;
  brokerAccount?: string;
  brokerName?: string;
  symbol?: string;
  name?: string;
  assetType?: AssetType | "bond" | "unknown";
  tradeDate?: string;
  postedDate?: string;
  transactionCode?: string;
  transactionName?: string;
  quantity?: number;
  price?: number;
  amount?: number;
  currency: string;
  raw?: unknown;
}

export type BankAccountType =
  | "checking"
  | "savings"
  | "credit"
  | "loan"
  | "settlement_cash"
  | "time_deposit"
  | "stored_value"
  | "unknown";

export interface BankAccount {
  id: string;
  connectorId: string;
  sourceId: string;
  institutionName?: string;
  accountName?: string;
  accountType?: BankAccountType;
  currency: string;
  openedDate?: string;
  maturityDate?: string;
  inactiveAt?: string;
  creditLimit?: number;
  raw?: unknown;
}

export interface BankBalanceSnapshot {
  id: string;
  connectorId: string;
  accountId: string;
  sourceId: string;
  balance: number;
  availableBalance?: number;
  statementBalance?: number;
  paymentDueDate?: string;
  statementClosingDate?: string;
  noPaymentNeeded?: boolean;
  currency: string;
  asOfAt: string;
  raw?: unknown;
}

export type BankTransactionStatus = "pending" | "posted";

export interface BankTransaction {
  transferPeer?: { accountId: string; sourceId: string };
  id: string;
  connectorId: string;
  accountId: string;
  sourceId: string;
  postedDate?: string;
  /** Transaction/authorization date, with a timezone only when source time is known. */
  authorizedAt?: string;
  amount: number;
  currency: string;
  description?: string;
  counterparty?: string;
  status?: BankTransactionStatus;
  raw?: unknown;
}
