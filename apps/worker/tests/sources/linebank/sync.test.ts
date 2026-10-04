import forge from "node-forge";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestD1 } from "../../helpers/d1";
import { encryptJson } from "../../../src/platform/crypto";
import type { Env } from "../../../src/platform/env";
import { NeedsUserActionError } from "../../../src/features/sync/errors";
import { syncLinebank } from "../../../src/sources/linebank/sync";

let harness: Awaited<ReturnType<typeof createTestD1>>;
let env: Env;
const key = "synthetic-test-encryption-key";
const keypair = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
const kpadPblcVal = forge.pki
  .publicKeyToPem(keypair.publicKey)
  .replace(/-----[A-Z ]+-----|\s/g, "");

async function saveSettings(config: Record<string, unknown>) {
  await env.DB.prepare(
    "INSERT INTO connector_settings(id, connector_id, encrypted_config, created_at, updated_at) VALUES(?, ?, ?, ?, ?)",
  )
    .bind(
      "linebank",
      "linebank",
      await encryptJson(config, key),
      "2026-10-04",
      "2026-10-04",
    )
    .run();
}

beforeEach(async () => {
  harness = await createTestD1();
  env = { DB: harness.binding, CONFIG_ENCRYPTION_KEY: key } as Env;
}, 30000);
afterEach(async () => {
  vi.restoreAllMocks();
  await harness?.mf.dispose();
}, 30000);

function bank(loginCode = "200") {
  const requests: string[] = [];
  const realFetch = globalThis.fetch.bind(globalThis);
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    if (url.origin !== "https://ibk.linebank.com.tw")
      return realFetch(input, init);
    requests.push(url.pathname);
    let content: unknown = {};
    let code = "200";
    if (url.pathname.startsWith("/v1/security/keyPad/"))
      content = { kpadPblcVal, kpadId: "AB".repeat(32) };
    else if (url.pathname === "/v2/customer/login") code = loginCode;
    else if (url.pathname === "/v1/account/common/receivings")
      content = {
        acctList: [
          {
            acctNbr: "111007654321",
            acctNick: "主帳戶",
            pdNm: "主帳戶",
            acctBal: 52000,
            acctStsCd: "A",
            arrOpnDt: "20240105",
            arrMatDt: null,
            ccyCd: "TWD",
          },
        ],
      };
    else if (url.pathname === "/v1/timeline/history/recents")
      content = {
        totCnt: 1,
        txLst: [
          {
            acctNbr: "111007654321",
            dpstWdrwDsCd: "2",
            cnclYn: "N",
            bizTxFuncTpCd: "10001",
            bizTxFuncTpCdNm: "轉帳提款",
            txRmkCont: "午餐分攤",
            ctptBnkCd: "812",
            ctptAcctNbr: "200012345678",
            txAmt: 350,
            txDt: "20261003",
            txTm: "121530",
          },
        ],
      };
    else if (url.pathname !== "/v1/customer/logout")
      throw new Error("Unexpected synthetic bank operation");
    return Response.json({ code, message: "synthetic", content });
  });
  return requests;
}

const count = async (table: string) =>
  (
    await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM ${table} WHERE connector_id = 'linebank'`,
    ).first<{ n: number }>()
  )?.n;

describe("LINE Bank sync", () => {
  it("writes deposits once, deduplicates a repeat sync, and keeps state untouched", async () => {
    await saveSettings({
      userId: "A123456789",
      account: "tester01",
      password: "synthetic-pw",
    });
    const requests = bank();
    const before = await env.DB.prepare(
      "SELECT encrypted_config, sync_cursor FROM connector_settings WHERE connector_id = 'linebank'",
    ).first<{ encrypted_config: string; sync_cursor: string | null }>();

    const first = await syncLinebank(env, "manual");
    const second = await syncLinebank(env, "scheduled");

    expect(first).toMatchObject({ records: 3, cursorUpdated: false });
    expect(first.newRecords.bankTransactions).toBe(1);
    expect(second.newRecords.bankTransactions).toBe(0);
    expect(await count("bank_accounts")).toBe(1);
    expect(await count("bank_balance_snapshots")).toBe(1);
    expect(await count("bank_transactions")).toBe(1);
    expect(
      await env.DB.prepare(
        "SELECT amount, status, posted_date FROM bank_transactions WHERE connector_id = 'linebank'",
      ).first(),
    ).toEqual({ amount: -350, status: "posted", posted_date: "2026-10-03" });
    expect(
      await env.DB.prepare(
        "SELECT encrypted_config, sync_cursor FROM connector_settings WHERE connector_id = 'linebank'",
      ).first(),
    ).toEqual(before);
    expect(before?.sync_cursor).toBeNull();
    expect(
      requests.filter((path) => path === "/v2/customer/login"),
    ).toHaveLength(2);
    expect(requests.at(-1)).toBe("/v1/customer/logout");
  }, 30000);

  it.each(["CHEA000012", "CHEA000013", "CHEA000003"])(
    "asks for user action on login code %s without retrying or writing",
    async (code) => {
      await saveSettings({
        userId: "A123456789",
        account: "tester01",
        password: "synthetic-pw",
      });
      const requests = bank(code);

      await expect(syncLinebank(env, "scheduled")).rejects.toBeInstanceOf(
        NeedsUserActionError,
      );
      expect(
        requests.filter((path) => path === "/v2/customer/login"),
      ).toHaveLength(1);
      expect(await count("bank_accounts")).toBe(0);
    },
    30000,
  );

  it("does not contact the bank when credentials are incomplete", async () => {
    await saveSettings({ userId: "A123456789" });
    const requests = bank();

    await expect(syncLinebank(env, "manual")).rejects.toBeInstanceOf(
      NeedsUserActionError,
    );
    expect(requests).toEqual([]);
  }, 30000);
});
