import { test } from "vitest";
import assert from "node:assert/strict";
import {
  parseLinebankConfig,
  parseLinebankDeposits,
} from "../../../src/sources/linebank/protocol";
import {
  LinebankApiError,
  linebankDate,
} from "../../../src/sources/linebank/api";

test("LINE Bank 設定與存款資料解析", async () => {
  assert.deepEqual(
    parseLinebankConfig({
      userId: "A123456789",
      account: "tester01",
      password: "synthetic-pw",
      sessionCookies: "dropped",
    }),
    { userId: "A123456789", account: "tester01", password: "synthetic-pw" },
  );
  assert.throws(() => parseLinebankConfig({ password: "" }));

  // 台灣時間換日：UTC 16:00 已是台灣隔日。
  const lateUtc = new Date("2026-10-03T16:30:00Z");
  assert.equal(linebankDate(0, lateUtc), "20261004");
  assert.equal(linebankDate(1, lateUtc), "20261003");

  const payloads = {
    balanceDate: "20261003",
    accounts: {
      acctList: [
        {
          acctNbr: "111007654321",
          acctNick: null,
          pdNm: "定期存款",
          acctBal: 100000,
          acctStsCd: "A",
          arrOpnDt: "20260101",
          arrMatDt: "20270101",
          ccyCd: "twd",
        },
      ],
    },
    transactions: [
      {
        acctNbr: "111007654321",
        dpstWdrwDsCd: "1",
        cnclYn: "N",
        bizTxFuncTpCdNm: "利息",
        txAmt: 12,
        txDt: "20260921",
        txTm: "000501",
      },
    ],
  };
  const result = parseLinebankDeposits(payloads);
  assert.equal(result.bankAccounts[0]?.accountType, "time_deposit");
  assert.equal(result.bankAccounts[0]?.accountName, "定期存款");
  assert.equal(result.bankAccounts[0]?.maturityDate, "2027-01-01");
  assert.equal(result.bankAccounts[0]?.currency, "TWD");
  assert.equal(
    result.bankTransactions[0]?.accountId,
    result.bankAccounts[0]?.sourceId,
  );
  assert.equal(result.bankTransactions[0]?.amount, 12);
  assert.equal(result.bankTransactions[0]?.description, "利息");
  assert.equal(
    result.bankTransactions[0]?.sourceId,
    parseLinebankDeposits(payloads).bankTransactions[0]?.sourceId,
  );
  assert.throws(
    () => parseLinebankDeposits({ ...payloads, accounts: { acctList: null } }),
    LinebankApiError,
  );
});
