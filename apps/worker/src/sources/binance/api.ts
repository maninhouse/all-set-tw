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

export const binanceConfigSchema = cryptoExchangeConfigSchema;
export type BinanceConfig = CryptoExchangeConfig;

export function parseBinanceConfig(config: unknown): BinanceConfig {
  return binanceConfigSchema.parse(config);
}

const BINANCE_API = "https://api.binance.com";
const RECV_WINDOW_MS = 10_000;
const EARN_PAGE_SIZE = 100;
const EARN_MAX_PAGES = 20;

type Holding = {
  wallet: string;
  walletLabel: string;
  asset: string;
  quantity: number;
};

function asRecords(value: unknown, label: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    throw new CryptoExchangeError(`Binance ${label} 回應格式已變更。`);
  }
  return value.filter(
    (item): item is Record<string, unknown> =>
      typeof item === "object" && item !== null,
  );
}

function assertNoApiError(body: unknown) {
  if (
    typeof body === "object" &&
    body !== null &&
    !Array.isArray(body) &&
    typeof (body as { code?: unknown }).code === "number" &&
    (body as { code: number }).code < 0
  ) {
    const code = (body as { code: number }).code;
    // -2014 API-key format, -2015 invalid key/IP/permission, -1022 signature.
    if (code === -2014 || code === -2015 || code === -1022) {
      throw new CryptoExchangeAuthError(
        "Binance 拒絕 API 金鑰，請確認金鑰、權限與 IP 限制。",
      );
    }
    throw new CryptoExchangeError(`Binance 回報錯誤（代碼 ${code}）。`);
  }
}

export class BinanceClient {
  constructor(
    private readonly fetcher: CryptoFetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async signed(
    config: Required<CryptoExchangeConfig>,
    method: "GET" | "POST",
    path: string,
    params: Record<string, string | number> = {},
  ): Promise<unknown> {
    const query = new URLSearchParams(
      Object.entries({
        ...params,
        recvWindow: RECV_WINDOW_MS,
        timestamp: this.now().getTime(),
      }).map(([key, value]) => [key, String(value)]),
    ).toString();
    const signature = await hmacHex("SHA-256", config.apiSecret, query);
    const body = await fetchJson(
      this.fetcher,
      `${BINANCE_API}${path}?${query}&signature=${signature}`,
      { method, headers: { "X-MBX-APIKEY": config.apiKey } },
      "Binance",
    );
    assertNoApiError(body);
    return body;
  }

  private async spot(
    config: Required<CryptoExchangeConfig>,
  ): Promise<Holding[]> {
    const body = (await this.signed(config, "GET", "/api/v3/account", {
      omitZeroBalances: "true",
    })) as { balances?: unknown };
    return asRecords(body.balances, "現貨").map((row) => ({
      wallet: "spot",
      walletLabel: "現貨",
      asset: String(row.asset),
      quantity: parseAmount(row.free) + parseAmount(row.locked),
    }));
  }

  private async funding(
    config: Required<CryptoExchangeConfig>,
  ): Promise<Holding[]> {
    const body = await this.signed(
      config,
      "POST",
      "/sapi/v1/asset/get-funding-asset",
    );
    return asRecords(body, "資金帳戶").map((row) => ({
      wallet: "funding",
      walletLabel: "資金",
      asset: String(row.asset),
      quantity:
        parseAmount(row.free) +
        parseAmount(row.locked) +
        parseAmount(row.freeze) +
        parseAmount(row.withdrawing),
    }));
  }

  private async earn(
    config: Required<CryptoExchangeConfig>,
    kind: "flexible" | "locked",
  ): Promise<Holding[]> {
    const holdings: Holding[] = [];
    for (let page = 1; page <= EARN_MAX_PAGES; page += 1) {
      const body = (await this.signed(
        config,
        "GET",
        `/sapi/v1/simple-earn/${kind}/position`,
        { current: page, size: EARN_PAGE_SIZE },
      )) as { rows?: unknown; total?: unknown };
      const rows = asRecords(body.rows, "理財");
      for (const row of rows) {
        holdings.push({
          wallet: `earn-${kind}`,
          walletLabel: kind === "flexible" ? "活期理財" : "定期理財",
          asset: String(row.asset),
          quantity: parseAmount(
            kind === "flexible" ? row.totalAmount : row.amount,
          ),
        });
      }
      if (
        rows.length < EARN_PAGE_SIZE ||
        holdings.length >= parseAmount(body.total)
      ) {
        break;
      }
    }
    return holdings;
  }

  private async prices(): Promise<Map<string, number>> {
    const body = await fetchJson(
      this.fetcher,
      `${BINANCE_API}/api/v3/ticker/price`,
      { method: "GET" },
      "Binance",
    );
    const prices = new Map<string, number>();
    for (const row of asRecords(body, "報價")) {
      const price = parseAmount(row.price);
      if (typeof row.symbol === "string" && price > 0) {
        prices.set(row.symbol, price);
      }
    }
    return prices;
  }

  async fetchPositions(
    config: CryptoExchangeConfig,
    asOfDate = this.now().toISOString().slice(0, 10),
  ): Promise<CryptoPosition[]> {
    if (!config.apiKey || !config.apiSecret) {
      throw new CryptoExchangeAuthError("尚未設定 Binance API 金鑰。");
    }
    const credentials = { apiKey: config.apiKey, apiSecret: config.apiSecret };
    const [spot, funding, flexible, locked, prices] = await Promise.all([
      this.spot(credentials),
      this.funding(credentials),
      this.earn(credentials, "flexible"),
      this.earn(credentials, "locked"),
      this.prices(),
    ]);
    return dropEarnReceiptTokens(spot, flexible)
      .concat(funding, flexible, locked)
      .filter((holding) => holding.quantity > 0)
      .map((holding) =>
        cryptoPosition({
          connectorId: "binance",
          ...holding,
          priceUsd: binanceUsdPrice(holding.asset, prices),
          asOfDate,
        }),
      );
  }
}

/**
 * 現貨帳戶會列出 Simple Earn 活期的憑證代幣（LDBNB 等），與「活期理財」是同一筆錢。
 * 只在去掉 LD 前綴後對得上活期理財持倉時才略過，避免誤傷 LDO 這類真實幣種。
 */
export function dropEarnReceiptTokens(
  spot: Holding[],
  flexible: Holding[],
): Holding[] {
  const earnAssets = new Set(flexible.map((holding) => holding.asset));
  return spot.filter(
    (holding) =>
      !(
        holding.asset.startsWith("LD") && earnAssets.has(holding.asset.slice(2))
      ),
  );
}

/** 穩定幣視為 1 USD；其餘依 USDT、再依 USDC 交易對換算。 */
export function binanceUsdPrice(
  asset: string,
  prices: ReadonlyMap<string, number>,
): number | undefined {
  if (USD_STABLECOINS.has(asset)) return 1;
  return prices.get(`${asset}USDT`) ?? prices.get(`${asset}USDC`);
}

export function createBinanceConnector(fetcher: CryptoFetch = fetch) {
  return new BinanceClient(fetcher);
}
