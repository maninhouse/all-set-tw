import {
  CryptoExchangeAuthError,
  CryptoExchangeError,
  cryptoExchangeConfigSchema,
  cryptoPosition,
  fetchJson,
  hmacHex,
  parseAmount,
  USD_STABLECOINS,
  type CryptoExchangeConfig,
  type CryptoFetch,
  type CryptoPosition,
} from "../crypto/exchange";

export const bitfinexConfigSchema = cryptoExchangeConfigSchema;
export type BitfinexConfig = CryptoExchangeConfig;

export function parseBitfinexConfig(config: unknown): BitfinexConfig {
  return bitfinexConfigSchema.parse(config);
}

const BITFINEX_AUTH_API = "https://api.bitfinex.com";
const BITFINEX_PUBLIC_API = "https://api-pub.bitfinex.com";
const WALLETS_PATH = "/v2/auth/r/wallets";

const WALLET_LABELS: Record<string, string> = {
  exchange: "交易",
  funding: "資金（放貸）",
};

/** Bitfinex 的 ticker 代號與一般代號不同。 */
const SYMBOL_ALIASES: Record<string, string> = {
  UST: "USDT",
  UDC: "USDC",
  DSH: "DASH",
  QTM: "QTUM",
  IOT: "IOTA",
  BAB: "BCH",
};

export function normalizeBitfinexAsset(currency: string): string {
  return SYMBOL_ALIASES[currency] ?? currency;
}

export class BitfinexClient {
  constructor(
    private readonly fetcher: CryptoFetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async wallets(
    config: Required<CryptoExchangeConfig>,
  ): Promise<unknown[]> {
    const nonce = String(this.now().getTime() * 1000);
    const body = "{}";
    const signature = await hmacHex(
      "SHA-384",
      config.apiSecret,
      `/api${WALLETS_PATH}${nonce}${body}`,
    );
    const result = await fetchJson(
      this.fetcher,
      `${BITFINEX_AUTH_API}${WALLETS_PATH}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "bfx-nonce": nonce,
          "bfx-apikey": config.apiKey,
          "bfx-signature": signature,
        },
        body,
      },
      "Bitfinex",
    );
    if (!Array.isArray(result)) {
      throw new CryptoExchangeError("Bitfinex 錢包回應格式已變更。");
    }
    if (result[0] === "error") {
      // 10100 apikey: invalid, 10114 nonce too small.
      if (result[1] === 10100) {
        throw new CryptoExchangeAuthError(
          "Bitfinex 拒絕 API 金鑰，請確認金鑰與權限。",
        );
      }
      throw new CryptoExchangeError(
        `Bitfinex 回報錯誤（代碼 ${String(result[1])}）。`,
      );
    }
    return result;
  }

  private async prices(): Promise<Map<string, number>> {
    const body = await fetchJson(
      this.fetcher,
      `${BITFINEX_PUBLIC_API}/v2/tickers?symbols=ALL`,
      { method: "GET" },
      "Bitfinex",
    );
    if (!Array.isArray(body)) {
      throw new CryptoExchangeError("Bitfinex 報價回應格式已變更。");
    }
    const prices = new Map<string, number>();
    for (const row of body) {
      // Trading ticker: [SYMBOL, BID, BID_SIZE, ASK, ASK_SIZE, ..., LAST_PRICE, ...]
      if (!Array.isArray(row) || typeof row[0] !== "string") continue;
      const symbol = row[0];
      const last = parseAmount(row[7]);
      if (symbol.startsWith("t") && last > 0) prices.set(symbol, last);
    }
    return prices;
  }

  async fetchPositions(
    config: CryptoExchangeConfig,
    asOfDate = this.now().toISOString().slice(0, 10),
  ): Promise<CryptoPosition[]> {
    if (!config.apiKey || !config.apiSecret) {
      throw new CryptoExchangeAuthError("尚未設定 Bitfinex API 金鑰。");
    }
    const [wallets, prices] = await Promise.all([
      this.wallets({ apiKey: config.apiKey, apiSecret: config.apiSecret }),
      this.prices(),
    ]);
    const positions: CryptoPosition[] = [];
    for (const row of wallets) {
      if (!Array.isArray(row)) continue;
      const [type, currency, balance] = row;
      if (typeof type !== "string" || typeof currency !== "string") continue;
      // 衍生品保證金錢包含未實現損益，不屬於持倉範圍。
      const walletLabel = WALLET_LABELS[type];
      const quantity = parseAmount(balance);
      if (!walletLabel || quantity <= 0) continue;
      const asset = normalizeBitfinexAsset(currency);
      positions.push(
        cryptoPosition({
          connectorId: "bitfinex",
          wallet: type,
          walletLabel,
          asset,
          quantity,
          priceUsd: bitfinexUsdPrice(currency, prices),
          asOfDate,
        }),
      );
    }
    return positions;
  }
}

export function bitfinexUsdPrice(
  currency: string,
  prices: ReadonlyMap<string, number>,
): number | undefined {
  if (USD_STABLECOINS.has(normalizeBitfinexAsset(currency))) return 1;
  return (
    prices.get(`t${currency}USD`) ??
    prices.get(`t${currency}:USD`) ??
    prices.get(`t${currency}UST`)
  );
}

export function createBitfinexConnector(fetcher: CryptoFetch = fetch) {
  return new BitfinexClient(fetcher);
}
