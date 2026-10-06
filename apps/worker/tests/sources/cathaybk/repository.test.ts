import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestD1 } from "../../helpers/d1";
import { staleCathayUnbilledTransactionStatements } from "../../../src/sources/cathaybk/repository";

describe("國泰未出帳明細清理", () => {
  let harness: Awaited<ReturnType<typeof createTestD1>>;
  let db: D1Database;

  beforeAll(async () => {
    harness = await createTestD1();
    db = harness.binding as unknown as D1Database;
  }, 30000);
  afterAll(async () => {
    await harness?.mf.dispose();
  }, 30000);

  it("removes Cathay unbilled rows the bank no longer returns and keeps statement rows", async () => {
    await db.batch(
      [
        `INSERT INTO bank_accounts
          (id, connector_id, source_id, institution_name, account_name, account_type,
           currency, raw_payload, created_at, updated_at)
        VALUES
          ('cathaybk:credit:cathaybk:main', 'cathaybk', 'credit:cathaybk:main', '國泰世華銀行',
           '國泰信用卡', 'credit', 'TWD', '{}', '2026-10-01', '2026-10-01')`,
        `INSERT INTO bank_transactions
          (id, connector_id, account_id, source_id, posted_date, amount, currency,
           description, raw_payload, created_at, updated_at)
        VALUES
          ('stale', 'cathaybk', 'cathaybk:credit:cathaybk:main', 'k:stale:1', '2026-09-20', -100, 'TWD',
           '已沖銷', '{"unbilled":true}', '2026-10-01', '2026-10-01'),
          ('current', 'cathaybk', 'cathaybk:credit:cathaybk:main', 'k:current:1', '2026-09-21', -200, 'TWD',
           '仍未出帳', '{"unbilled":true}', '2026-10-01', '2026-10-01'),
          ('billed', 'cathaybk', 'cathaybk:credit:cathaybk:main', 'k:billed:1', '2026-08-20', -300, 'TWD',
           '已出帳', '{"billDate":"2026-09-08"}', '2026-10-01', '2026-10-01'),
          ('other', 'ctbc', 'cathaybk:credit:cathaybk:main', 'k:stale:1', '2026-09-20', -400, 'TWD',
           '其他來源', '{"unbilled":true}', '2026-10-01', '2026-10-01'),
          ('broken', 'cathaybk', 'cathaybk:credit:cathaybk:main', 'k:broken:1', '2026-07-01', -500, 'TWD',
           '舊資料', 'not json', '2026-10-01', '2026-10-01'),
          ('nulled', 'cathaybk', 'cathaybk:credit:cathaybk:main', 'k:nulled:1', '2026-07-02', -600, 'TWD',
           '無 raw', NULL, '2026-10-01', '2026-10-01')`,
        `UPDATE bank_transactions SET matched_transaction_id = 'stale', transfer_peer_id = 'stale'
          WHERE id = 'billed'`,
        `INSERT INTO bank_transaction_preferences
          (transaction_id, excluded_from_calculation, created_at, updated_at)
        VALUES ('stale', 1, '2026-10-01', '2026-10-01')`,
        `INSERT INTO classification_overrides
          (id, target_type, target_id, category_id, created_at, updated_at)
        VALUES ('o1', 'bank_transaction', 'stale', 'food', '2026-10-01', '2026-10-01')`,
      ].map((statement) => db.prepare(statement)),
    );

    await db.batch(
      staleCathayUnbilledTransactionStatements(db, ["k:current:1"]),
    );

    expect(
      (
        await db.prepare("SELECT id FROM bank_transactions ORDER BY id").all()
      ).results.map((row) => row.id),
    ).toEqual(["billed", "broken", "current", "nulled", "other"]);
    expect(
      await db
        .prepare(
          "SELECT matched_transaction_id AS m, transfer_peer_id AS p FROM bank_transactions WHERE id = 'billed'",
        )
        .first(),
    ).toEqual({ m: null, p: null });
    expect(
      await db
        .prepare("SELECT COUNT(*) AS n FROM bank_transaction_preferences")
        .first(),
    ).toEqual({ n: 0 });
    expect(
      await db
        .prepare("SELECT COUNT(*) AS n FROM classification_overrides")
        .first(),
    ).toEqual({ n: 0 });
  });
});
