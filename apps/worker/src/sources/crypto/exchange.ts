import type { InvestmentPosition } from "@taiwan-fin-hub/shared";
import { z } from "zod";

/** 交易所 API 金鑰設定；兩個欄位都由 Worker 加密保存。 */
export const cryptoExchangeConfigSchema = z.object({
  apiKey: z.string().trim().min(1).max(256).optional(),
  apiSecret: z.string().trim().min(1).max(512).optional(),
});

export type CryptoExchangeConfig = z.infer<typeof cryptoExchangeConfigSchema>;

export type CryptoFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export type CryptoPosition = Omit<InvestmentPosition, "id" | "connectorId">;

export const CRYPTO_REQUEST_TIMEOUT_MS = 15_000;

/** 視為 1 USD 的穩定幣；其餘幣種以交易所現價換算。 */
export const USD_STABLECOINS: ReadonlySet<string> = new Set([
  "USD",
  "USDT",
  "USDC",
  "FDUSD",
  "BUSD",
  "TUSD",
  "DAI",
  "USD1",
]);

export class CryptoExchangeError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "CryptoExchangeError";
  }
}

/** 憑證遭拒（401／403 或 API 回報簽章／金鑰無效），需由使用者更換金鑰。 */
export class CryptoExchangeAuthError extends CryptoExchangeError {
  constructor(message: string, status?: number) {
    super(message, status);
    this.name = "CryptoExchangeAuthError";
  }
}

export async function hmacHex(
  algorithm: "SHA-256" | "SHA-384",
  secret: string,
  message: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: algorithm },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(message),
  );
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function fetchJson(
  fetcher: CryptoFetch,
  url: string,
  init: RequestInit,
  exchange: string,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher(url, {
      ...init,
      signal: AbortSignal.timeout(CRYPTO_REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new CryptoExchangeError(`${exchange} 連線失敗或逾時。`);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  if (
    response.status === 401 ||
    response.status === 403 ||
    isCredentialRejectionCode(body)
  ) {
    throw new CryptoExchangeAuthError(
      `${exchange} 拒絕 API 金鑰，請確認金鑰、權限與 IP 限制（${new URL(url).pathname}${apiErrorDetail(body)}）。`,
      response.status,
    );
  }
  if (response.status === 429) {
    throw new CryptoExchangeError(
      `${exchange} 請求過於頻繁，請稍後再試。`,
      429,
    );
  }
  if (response.status === 451) {
    throw new CryptoExchangeError(
      `${exchange} 因地區限制拒絕此 Worker 的請求。`,
      451,
    );
  }
  if (body === undefined) {
    throw new CryptoExchangeError(
      `${exchange} 回應格式無法解析（HTTP ${response.status}，${new URL(url).pathname}）。`,
      response.status,
    );
  }
  if (!response.ok) {
    throw new CryptoExchangeError(
      `${exchange} 回應錯誤（HTTP ${response.status}，${new URL(url).pathname}${apiErrorDetail(body)}）。`,
      response.status,
    );
  }
  return body;
}

/** Binance -2014 金鑰格式、-2015 金鑰／IP／權限、-1022 簽章無效。 */
function isCredentialRejectionCode(body: unknown): boolean {
  const code =
    typeof body === "object" && body !== null
      ? (body as { code?: unknown }).code
      : undefined;
  return code === -2014 || code === -2015 || code === -1022;
}

/** 只取交易所的錯誤代碼與說明，不回傳整個回應內容。 */
function apiErrorDetail(body: unknown): string {
  if (typeof body !== "object" || body === null) return "";
  const { code, msg } = body as { code?: unknown; msg?: unknown };
  const parts = [
    typeof code === "number" || typeof code === "string"
      ? `代碼 ${code}`
      : undefined,
    typeof msg === "string" ? msg.slice(0, 120) : undefined,
  ].filter(Boolean);
  return parts.length > 0 ? `，${parts.join("：")}` : "";
}

export function parseAmount(value: unknown): number {
  const amount = typeof value === "string" ? Number(value) : value;
  return typeof amount === "number" && Number.isFinite(amount) ? amount : 0;
}

/** 以 USD 單價計算市值；價格未知時回傳 undefined，不猜測。 */
export function usdMarketValue(
  quantity: number,
  priceUsd: number | undefined,
): number | undefined {
  if (priceUsd === undefined || !Number.isFinite(priceUsd)) return undefined;
  return Math.round(quantity * priceUsd);
}

export function cryptoPosition(input: {
  connectorId: "binance" | "bitfinex" | "flowwallet";
  wallet: string;
  walletLabel: string;
  asset: string;
  quantity: number;
  priceUsd: number | undefined;
  asOfDate: string;
}): CryptoPosition {
  return {
    sourceId: `${input.connectorId}:${input.wallet}:${input.asset}`,
    assetType: "crypto",
    symbol: input.asset,
    name: `${input.asset}（${input.walletLabel}）`,
    quantity: input.quantity,
    marketValue: usdMarketValue(input.quantity, input.priceUsd),
    currency: "USD",
    asOfDate: input.asOfDate,
    raw: { wallet: input.wallet, asset: input.asset },
  };
}

export type CryptoExchangeClient = {
  fetchPositions(config: CryptoExchangeConfig): Promise<CryptoPosition[]>;
};
