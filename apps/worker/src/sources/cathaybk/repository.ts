/**
 * 國泰未出帳明細以 `raw.unbilled = 1` 保存為一般交易；同一筆消費出帳後會以同 sourceId
 * 被帳單版本覆蓋（raw 不再帶旗標）。本次成功取得未出帳清單時，清掉仍帶旗標、
 * 但銀行已不再回傳的列（出帳後 sourceId 不一致、被沖銷或改額），避免永久重複計入。
 */
export function staleCathayUnbilledTransactionStatements(
  db: D1Database,
  currentSourceIds: string[],
) {
  const currentJson = JSON.stringify(currentSourceIds);
  // 舊資料的 raw_payload 可能不是 JSON；json_extract 遇到壞 JSON 會讓整批失敗。
  const unbilledFlag = `CASE WHEN json_valid(raw_payload)
    THEN json_extract(raw_payload, '$.unbilled') END = 1`;
  const stale = `SELECT id FROM bank_transactions
    WHERE connector_id = 'cathaybk'
      AND ${unbilledFlag}
      AND source_id NOT IN (SELECT value FROM json_each(?1))`;
  return [
    db
      .prepare(
        `UPDATE bank_transactions SET matched_transaction_id = NULL
         WHERE matched_transaction_id IN (${stale})`,
      )
      .bind(currentJson),
    db
      .prepare(
        `UPDATE bank_transactions SET transfer_peer_id = NULL
         WHERE transfer_peer_id IN (${stale})`,
      )
      .bind(currentJson),
    db
      .prepare(
        `DELETE FROM invoice_transaction_preferences
         WHERE transaction_id IN (${stale})`,
      )
      .bind(currentJson),
    db
      .prepare(
        `DELETE FROM classification_overrides
         WHERE target_type = 'bank_transaction' AND target_id IN (${stale})`,
      )
      .bind(currentJson),
    db
      .prepare(
        `DELETE FROM bank_transaction_preferences
         WHERE transaction_id IN (${stale})`,
      )
      .bind(currentJson),
    db
      .prepare(
        `DELETE FROM bank_transactions
         WHERE connector_id = 'cathaybk'
           AND ${unbilledFlag}
           AND source_id NOT IN (SELECT value FROM json_each(?1))`,
      )
      .bind(currentJson),
  ];
}
