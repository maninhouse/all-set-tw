import {
  createDrizzle,
  investmentPositions,
  manualInvestmentPositions,
} from "../../db";
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";

export type ManualInvestmentRow = typeof manualInvestmentPositions.$inferSelect;

export type ManualInvestmentInsert = Omit<
  ManualInvestmentRow,
  "quotePrice" | "quoteAt"
> & { quotePrice?: number | null; quoteAt?: string | null };

export type ManualInvestmentPatch = Partial<
  Pick<
    ManualInvestmentRow,
    | "broker"
    | "market"
    | "symbol"
    | "name"
    | "assetType"
    | "quantity"
    | "currency"
    | "manualPrice"
    | "manualPriceDate"
    | "note"
    | "quotePrice"
    | "quoteAt"
  >
>;

export type SyncedHoldingRow = {
  connectorId: string;
  symbol: string;
  asOfDate: string;
};

export async function listManualInvestments(db: D1Database) {
  return createDrizzle(db)
    .select()
    .from(manualInvestmentPositions)
    .orderBy(
      asc(manualInvestmentPositions.broker),
      asc(manualInvestmentPositions.market),
      asc(manualInvestmentPositions.symbol),
    )
    .all();
}

export async function getManualInvestment(db: D1Database, id: string) {
  return createDrizzle(db)
    .select()
    .from(manualInvestmentPositions)
    .where(eq(manualInvestmentPositions.id, id))
    .get();
}

export async function insertManualInvestment(
  db: D1Database,
  row: ManualInvestmentInsert,
) {
  await createDrizzle(db).insert(manualInvestmentPositions).values(row);
}

export async function updateManualInvestment(
  db: D1Database,
  id: string,
  patch: ManualInvestmentPatch,
  now: string,
) {
  const result = await createDrizzle(db)
    .update(manualInvestmentPositions)
    .set({ ...patch, updatedAt: now })
    .where(eq(manualInvestmentPositions.id, id))
    .run();
  return result.meta.changes > 0;
}

export async function saveManualInvestmentQuotes(
  db: D1Database,
  quotes: Array<{ id: string; price: number }>,
  quoteAt: string,
) {
  if (quotes.length === 0) return;
  const database = createDrizzle(db);
  const [first, ...rest] = quotes.map(({ id, price }) =>
    database
      .update(manualInvestmentPositions)
      .set({ quotePrice: price, quoteAt })
      .where(eq(manualInvestmentPositions.id, id)),
  );
  await database.batch([first!, ...rest]);
}

export async function deleteManualInvestment(db: D1Database, id: string) {
  await createDrizzle(db)
    .delete(manualInvestmentPositions)
    .where(eq(manualInvestmentPositions.id, id));
}

/**
 * Connector holdings that supersede manual rows: the latest snapshot per
 * connector + asset type, matching how the investments list picks positions.
 */
export async function listLatestSyncedHoldings(
  db: D1Database,
  connectorIds: string[],
): Promise<SyncedHoldingRow[]> {
  if (connectorIds.length === 0) return [];
  return createDrizzle(db)
    .select({
      connectorId: investmentPositions.connectorId,
      symbol: sql<string>`upper(${investmentPositions.symbol})`,
      asOfDate: investmentPositions.asOfDate,
    })
    .from(investmentPositions)
    .where(
      and(
        inArray(investmentPositions.connectorId, connectorIds),
        isNotNull(investmentPositions.symbol),
        eq(
          investmentPositions.asOfDate,
          sql`(
            SELECT MAX(p2.as_of_date)
            FROM investment_positions p2
            WHERE p2.connector_id = ${investmentPositions.connectorId}
              AND p2.asset_type = ${investmentPositions.assetType}
          )`,
        ),
      ),
    )
    .all();
}
