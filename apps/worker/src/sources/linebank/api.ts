import forge from "node-forge";

// Observed in the official web banking bundle (ibk.linebank.com.tw) on 2026-10-04.
// This is an internal web API, not a published developer API.
const ORIGIN = "https://ibk.linebank.com.tw";
const KEYPAD_PATH = "/v1/security/keyPad/signed/authentication/1.1";
const LOGIN_PATH = "/v2/customer/login";
const LOGOUT_PATH = "/v1/customer/logout";
// AES-CBC IV hard-coded in the web bundle's keypad encryption.
const KEYPAD_IV_HEX = "1a2e9ef8a4d3d7c82737837a75f0a949";
const REQUEST_TIMEOUT_MS = 30_000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

// Read-only queries the web bundle issues after login. Certificate downloads
// and card-loss endpoints have side effects or fees and must never be called.
// Deposit accounts with their balance as of `baseDt` (YYYYMMDD). The bank only
// answers for dates before today.
const ACCOUNTS_PATH = "/v1/account/common/receivings";
const HISTORY_PATH = "/v1/timeline/history/recents";
const HISTORY_SORT_LATEST = 2;
const HISTORY_PAGE_SIZE = 100;
const HISTORY_MAX_PAGES = 30;

/** Calendar date in Taiwan (UTC+8) as YYYYMMDD, `daysAgo` days before `now`. */
export function linebankDate(daysAgo: number, now: Date): string {
  return new Date(now.getTime() + 8 * 3_600_000 - daysAgo * 86_400_000)
    .toISOString()
    .slice(0, 10)
    .replaceAll("-", "");
}

export type LinebankErrorKind =
  | "credentials"
  | "locked"
  | "session_conflict"
  | "account_unavailable"
  | "transport"
  | "protocol";

export class LinebankApiError extends Error {
  constructor(
    public readonly kind: LinebankErrorKind,
    public readonly code?: string,
  ) {
    super(`LINE Bank API：${kind}${code ? `（${code}）` : ""}`);
    this.name = "LinebankApiError";
  }
}

export type LinebankFetch = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

export type LinebankCredentials = {
  userId: string;
  account: string;
  password: string;
};

export type LinebankDepositPayloads = {
  /** YYYYMMDD the account balances refer to. */
  balanceDate: string;
  accounts: unknown;
  transactions: unknown[];
};

type JsonRecord = Record<string, unknown>;
type ApiResult = { httpStatus: number; body: JsonRecord | null };

function errorKind(code: string): LinebankErrorKind {
  if (
    code === "CHEA000010" ||
    code === "CHEA000011" ||
    code === "CHEA000012" ||
    code === "CHEA000014"
  ) {
    return "credentials";
  }
  if (code === "CHEA000013") return "locked";
  if (code === "CHEA000003") return "session_conflict";
  return "protocol";
}

function getSetCookieValues(headers: Headers): string[] {
  const direct = headers.getSetCookie?.();
  if (direct?.length) return direct;
  const combined = headers.get("set-cookie");
  return combined ? combined.split(/,(?=\s*[^;,=\s]+=[^;,]*)/g) : [];
}

// Mirrors the web keypad: AES-256-CBC with a random key, then RSA PKCS#1 v1.5
// over "<ciphertext hex>.<kpadId>" and over the key hex.
export function linebankKeypadEncrypt(
  plaintext: string,
  publicKeyBase64: string,
  kpadId: string,
) {
  const keyBytes = crypto.getRandomValues(new Uint8Array(32));
  const key = String.fromCharCode(...keyBytes);
  const cipher = forge.cipher.createCipher("AES-CBC", key);
  cipher.start({ iv: forge.util.hexToBytes(KEYPAD_IV_HEX) });
  cipher.update(forge.util.createBuffer(plaintext, "utf8"));
  cipher.finish();
  const publicKey = forge.pki.publicKeyFromPem(
    `-----BEGIN PUBLIC KEY-----\n${publicKeyBase64}\n-----END PUBLIC KEY-----`,
  );
  const rsaHex = (value: string) =>
    forge.util.bytesToHex(publicKey.encrypt(value, "RSAES-PKCS1-V1_5"));
  return {
    kpadId,
    kpadEncKeyVal: rsaHex(forge.util.bytesToHex(key)),
    kpadEncInpVal: rsaHex(`${cipher.output.toHex()}.${kpadId}`),
    kpadTknVal: kpadId,
  };
}

export class LinebankClient {
  private readonly cookies = new Map<string, string>();

  constructor(
    private readonly fetchImpl: LinebankFetch = (input, init) =>
      fetch(input, init),
  ) {}

  private async request(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    query?: Record<string, string | number>,
  ): Promise<ApiResult> {
    const search = query
      ? `?${new URLSearchParams(
          Object.entries(query).map(([key, value]) => [key, String(value)]),
        )}`
      : "";
    let response: Response;
    let text: string;
    try {
      response = await this.fetchImpl(`${ORIGIN}${path}${search}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          chnlDsCd: "IBK",
          lclCd: "zh-TW",
          "User-Agent": USER_AGENT,
          Origin: ORIGIN,
          Referer: `${ORIGIN}/login/`,
          Cookie: [...this.cookies]
            .map(([name, value]) => `${name}=${value}`)
            .join("; "),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      text = await response.text();
    } catch {
      throw new LinebankApiError("transport");
    }
    for (const line of getSetCookieValues(response.headers)) {
      const pair = line.split(";", 1)[0] ?? "";
      const index = pair.indexOf("=");
      if (index > 0) {
        this.cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1));
      }
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    return {
      httpStatus: response.status,
      body:
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as JsonRecord)
          : null,
    };
  }

  /** Sends exactly one login request; callers must not retry on failure. */
  async login(credentials: LinebankCredentials): Promise<unknown> {
    const keypad = await this.request("GET", KEYPAD_PATH);
    const content = keypad.body?.content as JsonRecord | undefined;
    const publicKey = content?.kpadPblcVal;
    const kpadId = content?.kpadId;
    if (
      keypad.body?.code !== "200" ||
      typeof publicKey !== "string" ||
      typeof kpadId !== "string"
    ) {
      throw new LinebankApiError(keypad.body ? "protocol" : "transport");
    }
    const login = await this.request("POST", LOGIN_PATH, {
      encPswd: linebankKeypadEncrypt(credentials.password, publicKey, kpadId),
      encParam: linebankKeypadEncrypt(
        JSON.stringify({
          loinId: credentials.account,
          natlId: credentials.userId.toUpperCase(),
        }),
        publicKey,
        kpadId,
      ),
      plafInfoCont: "Chrome",
      webOsInfoCont: "Windows 10",
      mbleUuid: "",
    });
    const code = login.body?.code;
    if (code !== "200") {
      if (typeof code !== "string") throw new LinebankApiError("transport");
      throw new LinebankApiError(errorKind(code), code);
    }
    return login.body?.content;
  }

  private async query(
    path: string,
    query: Record<string, string | number>,
  ): Promise<JsonRecord> {
    const result = await this.request("GET", path, undefined, query);
    const content = result.body?.content;
    if (!result.body) throw new LinebankApiError("transport");
    if (result.body.code !== "200") {
      const code = result.body.code;
      throw new LinebankApiError(
        "protocol",
        typeof code === "string" ? code : undefined,
      );
    }
    if (!content || typeof content !== "object" || Array.isArray(content)) {
      throw new LinebankApiError("protocol");
    }
    return content as JsonRecord;
  }

  /** Requires a prior `login`. Reads every history page or fails as a whole. */
  async fetchDeposits(
    historyDays: number,
    now = new Date(),
  ): Promise<LinebankDepositPayloads> {
    const balanceDate = linebankDate(1, now);
    const accounts = await this.query(ACCOUNTS_PATH, { baseDt: balanceDate });
    const transactions: unknown[] = [];
    for (let page = 1; ; page++) {
      if (page > HISTORY_MAX_PAGES) throw new LinebankApiError("protocol");
      const content = await this.query(HISTORY_PATH, {
        index: 0,
        listOutputCnt: HISTORY_PAGE_SIZE,
        perPage: HISTORY_PAGE_SIZE,
        inqrStrtDt: linebankDate(historyDays, now),
        inqrEndDt: linebankDate(0, now),
        sortTpCd: HISTORY_SORT_LATEST,
        pageCnt: HISTORY_PAGE_SIZE,
        pageNbr: page,
      });
      const { txLst, totCnt } = content;
      if (!Array.isArray(txLst) || typeof totCnt !== "number") {
        throw new LinebankApiError("protocol");
      }
      transactions.push(...txLst);
      if (txLst.length === 0 || transactions.length >= totCnt) break;
    }
    return { balanceDate, accounts, transactions };
  }

  async logout(): Promise<void> {
    await this.request("POST", LOGOUT_PATH);
  }
}
