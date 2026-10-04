import type { SyncTrigger } from "../../db";
import { requireConnectorSettings } from "../../features/sync/config";
import { linkCanonicalBankAccountsStatement } from "../../features/sync/connector-repository";
import { NeedsUserActionError } from "../../features/sync/errors";
import {
  type SyncWriteRecord,
  persistStagedSyncWrite,
} from "../../features/sync/persistence";
import {
  bankAccountRecord,
  bankBalanceSnapshotRecord,
  bankTransactionRecord,
} from "../../features/sync/record-mapper";
import type { SyncOutcome } from "../../features/sync/types";
import {
  rebuildBankDepositHistory,
  dateFromIso,
} from "../../features/net-worth/service";
import { configEncryptionKey } from "../../platform/config";
import { decryptJson } from "../../platform/crypto";
import type { Env } from "../../platform/env";
import { LinebankApiError } from "./api";
import {
  createLinebankConnector,
  parseLinebankConfig,
  type LinebankData,
} from "./protocol";

// 每次同步只送出一次登入，失敗不重試；查詢後一律登出，不保存 session。
export async function syncLinebank(
  env: Env,
  trigger: SyncTrigger,
): Promise<SyncOutcome> {
  const connectorId = "linebank";
  const scope = "all";
  const settings = await requireConnectorSettings(env.DB, connectorId);
  const config = parseLinebankConfig(
    await decryptJson<Record<string, unknown>>(
      settings.encrypted_config,
      configEncryptionKey(env),
    ),
  );
  const { userId, account, password } = config;
  if (!userId || !account || !password) {
    throw new NeedsUserActionError(
      "請先設定 LINE Bank 身分證字號、使用者代號與密碼。",
    );
  }

  console.log(`[sync] ${connectorId}/${scope}: starting trigger=${trigger}`);
  let result: LinebankData;
  try {
    result = await createLinebankConnector().sync({
      userId,
      account,
      password,
    });
  } catch (error) {
    if (error instanceof LinebankApiError) {
      if (error.kind === "credentials") {
        throw new NeedsUserActionError(
          "LINE Bank 登入資料驗證失敗，請確認身分證字號、使用者代號與密碼。",
        );
      }
      if (error.kind === "locked") {
        throw new NeedsUserActionError(
          "LINE Bank 帳號已暫時鎖定，請依銀行指示解鎖後再同步。",
        );
      }
      if (error.kind === "session_conflict") {
        throw new NeedsUserActionError(
          "LINE Bank 回報重複登入，請先登出其他裝置的網路銀行後再同步。",
        );
      }
    }
    throw error;
  }

  const { bankAccounts, bankBalanceSnapshots, bankTransactions, skipped } =
    result;
  console.log(
    `[sync] ${connectorId}/${scope}: accounts=${bankAccounts.length} snapshots=${bankBalanceSnapshots.length} transactions=${bankTransactions.length} skippedCancelled=${skipped.cancelled} skippedUnknownAccount=${skipped.unknownAccount}`,
  );

  const now = new Date().toISOString();
  const records: SyncWriteRecord[] = [
    ...bankAccounts.map((item) => bankAccountRecord(connectorId, item, now)),
    ...bankBalanceSnapshots.map((snapshot) =>
      bankBalanceSnapshotRecord(connectorId, snapshot, now),
    ),
    ...bankTransactions.map((transaction) =>
      bankTransactionRecord(connectorId, transaction, now),
    ),
  ];
  const newRecords = await persistStagedSyncWrite(env.DB, {
    records,
    afterPromoteStatements:
      bankAccounts.length > 0
        ? [linkCanonicalBankAccountsStatement(env.DB)]
        : [],
  });

  if (bankBalanceSnapshots.length > 0) {
    // 餘額是前一日日終，快照日期與同步當日都要重算。
    await rebuildBankDepositHistory(env.DB, [
      ...new Set([
        ...bankBalanceSnapshots.map((snapshot) => dateFromIso(snapshot.asOfAt)),
        dateFromIso(now),
      ]),
    ]);
  }

  return {
    success: true,
    connectorId,
    scope,
    records: records.length,
    newRecords,
    cursorUpdated: false,
  };
}
