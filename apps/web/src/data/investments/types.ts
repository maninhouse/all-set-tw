import type {
  ConnectorId,
  ManualInvestmentPosition,
} from "@taiwan-fin-hub/shared";

export type ManualInvestmentRow = ManualInvestmentPosition;

export interface InvestmentRow {
  id: string;
  assetType: "stock" | "etf" | "fund" | "crypto";
  symbol?: string;
  name: string;
  quantity?: number;
  marketValue?: number;
  cashBalance?: number;
  currency: string;
  asOfDate: string;
  /** Present only for holdings entered by hand instead of synced. */
  source?: "manual";
  quoteStale?: boolean;
}

export interface InvestmentTransactionRow {
  id: string;
  connectorId: ConnectorId;
  accountId: string;
  sourceId: string;
  brokerNo?: string;
  brokerAccount?: string;
  brokerName?: string;
  symbol?: string;
  name?: string;
  assetType?: "stock" | "etf" | "fund" | "bond" | "unknown";
  tradeDate?: string;
  postedDate?: string;
  transactionCode?: string;
  transactionName?: string;
  quantity?: number;
  price?: number;
  amount?: number;
  currency: string;
}
