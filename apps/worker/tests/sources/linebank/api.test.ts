import {
  LinebankApiError,
  LinebankClient,
} from "../../../src/sources/linebank/api";
import {
  createLinebankConnector,
  parseLinebankDeposits,
} from "../../../src/sources/linebank/protocol";
import forge from "node-forge";
import { describe, expect, it } from "vitest";

const keypair = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
const publicKeyBase64 = forge.pki
  .publicKeyToPem(keypair.publicKey)
  .replace(/-----[A-Z ]+-----|\s/g, "");
const kpadId = "AB".repeat(32);
const credentials = {
  userId: "a123456789",
  account: "tester01",
  password: "synthetic-pw",
};

function json(body: unknown, cookie?: string) {
  return new Response(JSON.stringify(body), {
    headers: cookie ? { "set-cookie": cookie } : undefined,
  });
}

function decrypt(value: {
  kpadEncKeyVal: string;
  kpadEncInpVal: string;
}): string {
  const rsa = (hex: string) =>
    keypair.privateKey.decrypt(forge.util.hexToBytes(hex), "RSAES-PKCS1-V1_5");
  const [cipherHex] = rsa(value.kpadEncInpVal).split(".");
  const decipher = forge.cipher.createDecipher(
    "AES-CBC",
    forge.util.hexToBytes(rsa(value.kpadEncKeyVal)),
  );
  decipher.start({
    iv: forge.util.hexToBytes("1a2e9ef8a4d3d7c82737837a75f0a949"),
  });
  decipher.update(forge.util.createBuffer(forge.util.hexToBytes(cipherHex!)));
  decipher.finish();
  return decipher.output.toString();
}

const account = {
  arrId: "0000000000001TW0000000001",
  acctNbr: "111007654321",
  acctNick: "主帳戶",
  pdNm: "主帳戶",
  acctBal: 52000,
  acctStsCd: "A",
  arrOpnDt: "20240105",
  arrMatDt: null,
  ccyCd: "TWD",
  stgBal: 0,
};
const transfer = {
  dpstWdrwDsCd: "2",
  cnclYn: "N",
  txCaseCd: "0001",
  bizTxFuncTpCd: "10001",
  bizTxFuncTpCdNm: "轉帳提款",
  txRmkCont: "午餐分攤",
  acctNbr: "111007654321",
  ctptBnkCd: "812",
  ctptAcctNbr: "200012345678",
  ctptAcctNick: null,
  ctptCustNm: null,
  txAmt: 350,
  txDt: "20261003",
  txTm: "121530",
};
const now = new Date("2026-10-04T05:00:00Z");

function fakeBank(
  loginResponse: unknown,
  pages: unknown[][] = [[transfer]],
  totCnt = pages.flat().length,
) {
  const calls: {
    path: string;
    query: URLSearchParams;
    method: string;
    cookie: string;
    body: any;
  }[] = [];
  const fetchImpl = async (input: string, init: RequestInit) => {
    const url = new URL(input);
    const path = url.pathname;
    calls.push({
      path,
      query: url.searchParams,
      method: init.method ?? "GET",
      cookie: (init.headers as Record<string, string>).Cookie ?? "",
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    if (path.startsWith("/v1/security/keyPad/")) {
      return json(
        { code: "200", content: { kpadPblcVal: publicKeyBase64, kpadId } },
        "TS01=edge; Path=/",
      );
    }
    if (path === "/v2/customer/login") {
      return json(loginResponse, "SESSION=synthetic; Path=/; HttpOnly");
    }
    if (path === "/v1/account/common/receivings") {
      return json({ code: "200", content: { acctList: [account] } });
    }
    if (path === "/v1/timeline/history/recents") {
      const page = Number(url.searchParams.get("pageNbr"));
      return json({
        code: "200",
        content: { totCnt, txLst: pages[page - 1] ?? [] },
      });
    }
    return json({ code: "200", content: {} });
  };
  return { client: new LinebankClient(fetchImpl), fetchImpl, calls };
}

describe("LINE Bank web API client", () => {
  it("logs in once with keypad-encrypted credentials and carries cookies", async () => {
    const { client, calls } = fakeBank({ code: "200", content: {} });

    await client.login(credentials);
    await client.logout();

    const logins = calls.filter((call) => call.path === "/v2/customer/login");
    expect(logins).toHaveLength(1);
    expect(logins[0]!.cookie).toBe("TS01=edge");
    expect(decrypt(logins[0]!.body.encPswd)).toBe("synthetic-pw");
    expect(JSON.parse(decrypt(logins[0]!.body.encParam))).toEqual({
      loinId: "tester01",
      natlId: "A123456789",
    });
    expect(JSON.stringify(logins[0]!.body)).not.toContain("synthetic-pw");
    expect(calls.at(-1)).toMatchObject({
      path: "/v1/customer/logout",
      method: "POST",
      cookie: "TS01=edge; SESSION=synthetic",
    });
  });

  it.each([
    ["CHEA000012", "credentials"],
    ["CHEA000013", "locked"],
    ["CHEA000003", "session_conflict"],
    ["CHEA999999", "protocol"],
  ])("maps login code %s to %s without retrying", async (code, kind) => {
    const { client, calls } = fakeBank({ code, message: "x" });

    const error: unknown = await client.login(credentials).catch((e) => e);

    expect(error).toBeInstanceOf(LinebankApiError);
    expect((error as LinebankApiError).kind).toBe(kind);
    expect(
      calls.filter((call) => call.path === "/v2/customer/login"),
    ).toHaveLength(1);
  });

  it("asks for yesterday's balances and a 90-day history in Taiwan time", async () => {
    const { fetchImpl, calls } = fakeBank({ code: "200", content: {} });

    await createLinebankConnector(fetchImpl).sync(credentials, now);

    const accounts = calls.find((call) => call.path.endsWith("/receivings"));
    const history = calls.find((call) => call.path.endsWith("/recents"));
    expect(accounts!.query.get("baseDt")).toBe("20261003");
    expect(history!.query.get("inqrStrtDt")).toBe("20260706");
    expect(history!.query.get("inqrEndDt")).toBe("20261004");
    expect(calls.at(-1)!.path).toBe("/v1/customer/logout");
  });

  it("reads every history page", async () => {
    const second = { ...transfer, txTm: "090000" };
    const { fetchImpl, calls } = fakeBank(
      { code: "200", content: {} },
      [[transfer], [second]],
      2,
    );

    const result = await createLinebankConnector(fetchImpl).sync(
      credentials,
      now,
    );

    expect(result.bankTransactions).toHaveLength(2);
    expect(calls.filter((call) => call.path.endsWith("/recents"))).toHaveLength(
      2,
    );
  });

  it("logs out and fails as a whole when a query is rejected", async () => {
    const { fetchImpl, calls } = fakeBank({ code: "200", content: {} }, [
      [{ ...transfer, txAmt: "350" }],
    ]);

    await expect(
      createLinebankConnector(fetchImpl).sync(credentials, now),
    ).rejects.toMatchObject({ kind: "protocol" });
    expect(calls.at(-1)!.path).toBe("/v1/customer/logout");
  });
});

describe("LINE Bank deposit normalization", () => {
  const parse = (transactions: unknown[]) =>
    parseLinebankDeposits({
      balanceDate: "20261003",
      accounts: { acctList: [account] },
      transactions,
    });

  it("normalizes accounts, the previous-day balance, and signed transactions", () => {
    const deposit = {
      ...transfer,
      dpstWdrwDsCd: "1",
      txAmt: 1200,
      txTm: "080000",
      ctptAcctNick: "房東",
    };
    const result = parse([transfer, deposit]);

    expect(result.bankAccounts).toEqual([
      {
        sourceId: "bank:linebank:111007654321:TWD",
        institutionName: "LINE Bank",
        accountName: "主帳戶",
        accountType: "savings",
        currency: "TWD",
        openedDate: "2024-01-05",
        maturityDate: undefined,
        raw: {
          accountType: "savings",
          product: "主帳戶",
          status: "A",
          accountLast4: "4321",
        },
      },
    ]);
    expect(result.bankBalanceSnapshots).toEqual([
      {
        accountId: "bank:linebank:111007654321:TWD",
        sourceId: "snapshot:linebank:111007654321:TWD:2026-10-03",
        balance: 52000,
        availableBalance: 52000,
        currency: "TWD",
        asOfAt: "2026-10-03T23:59:59+08:00",
        raw: { balanceDate: "2026-10-03" },
      },
    ]);
    expect(result.bankTransactions).toMatchObject([
      {
        accountId: "bank:linebank:111007654321:TWD",
        postedDate: "2026-10-03",
        authorizedAt: "2026-10-03T12:15:30+08:00",
        amount: -350,
        description: "午餐分攤",
        counterparty: "****5678",
        status: "posted",
      },
      { amount: 1200, counterparty: "房東" },
    ]);
    expect(JSON.stringify(result.bankTransactions)).not.toContain(
      "200012345678",
    );
  });

  it("keeps source IDs stable across syncs and separates identical rows", () => {
    const first = parse([transfer, transfer]).bankTransactions;
    const again = parse([transfer, transfer]).bankTransactions;

    expect(first.map((tx) => tx.sourceId)).toEqual(
      again.map((tx) => tx.sourceId),
    );
    expect(new Set(first.map((tx) => tx.sourceId)).size).toBe(2);
    expect(first[0]!.sourceId).toMatch(/^tx:linebank:[0-9a-f]{32}:0$/);
  });

  it("skips cancelled rows and rows for accounts missing from the list", () => {
    const result = parse([
      { ...transfer, cnclYn: "Y" },
      { ...transfer, acctNbr: "111000000000" },
    ]);

    expect(result.bankTransactions).toEqual([]);
    expect(result.skipped).toEqual({ cancelled: 1, unknownAccount: 1 });
  });

  it("rejects unknown directions and malformed accounts", () => {
    expect(() => parse([{ ...transfer, dpstWdrwDsCd: "3" }])).toThrow(
      LinebankApiError,
    );
    expect(() =>
      parseLinebankDeposits({
        balanceDate: "20261003",
        accounts: { acctList: [{ ...account, acctBal: "52000" }] },
        transactions: [],
      }),
    ).toThrow(LinebankApiError);
  });
});
