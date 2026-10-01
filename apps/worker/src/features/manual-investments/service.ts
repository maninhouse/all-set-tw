import {
  MANUAL_INVESTMENT_MARKETS,
  type ManualInvestmentBroker,
  type ManualInvestmentMarket,
  type ManualInvestmentPosition,
} from "@taiwan-fin-hub/shared";
import { fetchQuote } from "./quote";
import {
  deleteManualInvestment,
  getManualInvestment,
  insertManualInvestment,
  listLatestSyncedHoldings,
  listManualInvestments,
  saveManualInvestmentQuotes,
  updateManualInvestment,
  type ManualInvestmentPatch,
  type ManualInvestmentRow,
  type SyncedHoldingRow,
} from "./repository";

export const QUOTE_STALE_MS = 30 * 60 * 1000;

export class ManualInvestmentConflictError extends Error {
  constructor() {
    super("A manual holding with the same broker, market and symbol exists.");
    this.name = "ManualInvestmentConflictError";
  }
}

export class ManualInvestmentNotFoundError extends Error {
  constructor() {
    super("Manual holding was not found.");
    this.name = "ManualInvestmentNotFoundError";
  }
}

export type ManualInvestmentInput = {
  broker: ManualInvestmentBroker;
  market: ManualInvestmentMarket;
  symbol: string;
  name: string;
  assetType: "stock" | "etf";
  quantity: number;
  manualPrice?: number | null;
  manualPriceDate?: string | null;
  note?: string | null;
};

type QuoteOptions = {
  fetcher?: typeof fetch;
  now?: Date;
  /** False in demo mode: quotes are fetched for display but never stored. */
  persist?: boolean;
};

export function normalizeSymbol(symbol: string) {
  return symbol.trim().toUpperCase();
}

export async function getManualInvestments(
  db: D1Database,
  options: QuoteOptions & { force?: boolean } = {},
): Promise<ManualInvestmentPosition[]> {
  const now = options.now ?? new Date();
  const rows = await listManualInvestments(db);
  const synced = await listLatestSyncedHoldings(db, [
    ...new Set(rows.map((row) => row.broker)),
  ]);
  const supersededBy = (row: ManualInvestmentRow) =>
    findSyncedHolding(synced, row);

  const due = rows.filter(
    (row) =>
      !supersededBy(row) && (options.force || isQuoteStale(row.quoteAt, now)),
  );
  const fresh = await fetchQuotes(due, options.fetcher);
  const quoteAt = now.toISOString();
  if (options.persist !== false) {
    await saveManualInvestmentQuotes(db, fresh, quoteAt);
  }
  const freshById = new Map(fresh.map((quote) => [quote.id, quote.price]));

  return rows.map((row) => {
    const freshPrice = freshById.get(row.id);
    return toPosition(
      freshPrice === undefined
        ? row
        : { ...row, quotePrice: freshPrice, quoteAt },
      now,
      supersededBy(row),
    );
  });
}

export async function addManualInvestment(
  db: D1Database,
  input: ManualInvestmentInput,
  options: QuoteOptions = {},
) {
  const now = options.now ?? new Date();
  const symbol = normalizeSymbol(input.symbol);
  await assertUnique(db, input.broker, input.market, symbol);

  const [quote] = await fetchQuotes(
    [{ id: "new", market: input.market, symbol }],
    options.fetcher,
  );
  const id = `manual-inv:${crypto.randomUUID()}`;
  const timestamp = now.toISOString();
  await insertManualInvestment(db, {
    id,
    broker: input.broker,
    market: input.market,
    symbol,
    name: input.name,
    assetType: input.assetType,
    quantity: input.quantity,
    currency: MANUAL_INVESTMENT_MARKETS[input.market].currency,
    manualPrice: input.manualPrice ?? null,
    manualPriceDate: input.manualPriceDate ?? null,
    quotePrice: quote?.price ?? null,
    quoteAt: quote ? timestamp : null,
    note: input.note ?? null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  return id;
}

export async function editManualInvestment(
  db: D1Database,
  id: string,
  input: Partial<ManualInvestmentInput>,
  options: QuoteOptions = {},
) {
  const existing = await getManualInvestment(db, id);
  if (!existing) throw new ManualInvestmentNotFoundError();

  const patch: ManualInvestmentPatch = { ...input };
  if (input.symbol !== undefined) patch.symbol = normalizeSymbol(input.symbol);
  const market = input.market ?? (existing.market as ManualInvestmentMarket);
  const symbol = patch.symbol ?? existing.symbol;
  const broker = input.broker ?? existing.broker;
  const identityChanged =
    market !== existing.market ||
    symbol !== existing.symbol ||
    broker !== existing.broker;
  if (identityChanged) await assertUnique(db, broker, market, symbol, id);

  if (market !== existing.market || symbol !== existing.symbol) {
    // A different instrument invalidates the stored quote.
    patch.currency = MANUAL_INVESTMENT_MARKETS[market].currency;
    const [quote] = await fetchQuotes(
      [{ id, market, symbol }],
      options.fetcher,
    );
    patch.quotePrice = quote?.price ?? null;
    patch.quoteAt = quote ? (options.now ?? new Date()).toISOString() : null;
  }

  await updateManualInvestment(
    db,
    id,
    patch,
    (options.now ?? new Date()).toISOString(),
  );
}

export function removeManualInvestment(db: D1Database, id: string) {
  return deleteManualInvestment(db, id);
}

function isQuoteStale(quoteAt: string | null, now: Date) {
  if (!quoteAt) return true;
  return now.getTime() - Date.parse(quoteAt) > QUOTE_STALE_MS;
}

function findSyncedHolding(
  synced: SyncedHoldingRow[],
  row: Pick<ManualInvestmentRow, "broker" | "symbol">,
) {
  const match = synced.find(
    (holding) =>
      holding.connectorId === row.broker && holding.symbol === row.symbol,
  );
  return match
    ? { connectorId: match.connectorId, asOfDate: match.asOfDate }
    : null;
}

async function fetchQuotes(
  rows: Array<Pick<ManualInvestmentRow, "id" | "market" | "symbol">>,
  fetcher?: typeof fetch,
) {
  const results = await Promise.allSettled(
    rows.map(async (row) => ({
      id: row.id,
      price: await fetchQuote(
        row.market as ManualInvestmentMarket,
        row.symbol,
        fetcher,
      ),
    })),
  );
  // A failed quote keeps the previous price; the row is reported as stale.
  return results.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
}

async function assertUnique(
  db: D1Database,
  broker: string,
  market: string,
  symbol: string,
  exceptId?: string,
) {
  const rows = await listManualInvestments(db);
  if (
    rows.some(
      (row) =>
        row.id !== exceptId &&
        row.broker === broker &&
        row.market === market &&
        row.symbol === symbol,
    )
  ) {
    throw new ManualInvestmentConflictError();
  }
}

function toPosition(
  row: ManualInvestmentRow,
  now: Date,
  supersededBy: ManualInvestmentPosition["supersededBy"],
): ManualInvestmentPosition {
  const price = row.manualPrice ?? row.quotePrice;
  return {
    id: row.id,
    broker: row.broker as ManualInvestmentBroker,
    market: row.market as ManualInvestmentMarket,
    symbol: row.symbol,
    name: row.name,
    assetType: row.assetType as "stock" | "etf",
    quantity: row.quantity,
    currency: row.currency,
    manualPrice: row.manualPrice,
    manualPriceDate: row.manualPriceDate,
    quotePrice: row.quotePrice,
    quoteAt: row.quoteAt,
    note: row.note,
    updatedAt: row.updatedAt,
    price,
    priceSource:
      row.manualPrice !== null
        ? "manual"
        : row.quotePrice !== null
          ? "quote"
          : "none",
    marketValue: price === null ? null : row.quantity * price,
    quoteStale: isQuoteStale(row.quoteAt, now),
    supersededBy,
  };
}
