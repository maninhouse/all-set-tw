import { z } from "zod";
import {
  CRYPTO_REQUEST_TIMEOUT_MS,
  CryptoExchangeAuthError,
  CryptoExchangeError,
  cryptoPosition,
  fetchJson,
  parseAmount,
  usdMarketValue,
  type CryptoFetch,
  type CryptoPosition,
} from "../crypto/exchange";

/** Flow（Cadence）帳戶地址：8 bytes，儲存時統一為小寫並帶 0x。 */
export const flowwalletConfigSchema = z.object({
  address: z
    .string()
    .trim()
    .regex(/^(0x)?[0-9a-f]{16}$/i)
    .transform((value) => `0x${value.replace(/^0x/i, "").toLowerCase()}`)
    .optional(),
});

export type FlowwalletConfig = z.infer<typeof flowwalletConfigSchema>;

export function parseFlowwalletConfig(config: unknown): FlowwalletConfig {
  return flowwalletConfigSchema.parse(config);
}

const FLOW_ACCESS_API = "https://rest-mainnet.onflow.org";
const FLOW_TOKEN_IDENTIFIER = "A.1654653399040a61.FlowToken.Vault";
const SYMBOL_MAX_LENGTH = 24;

/**
 * 視為 1 USD 的穩定幣，以合約型別識別而非代號比對：代號由合約自行宣告，
 * 任何代幣都能自稱 USDC。
 */
const USD_STABLECOIN_IDENTIFIERS: ReadonlySet<string> = new Set([
  // USDC.e
  "A.f1ab99c82dee3526.USDCFlow.Vault",
  // USDF
  "A.1e4aa0b87d10b141.EVMVMBridgedToken_2aabea2058b5ac2d339b163c6ab6f2b6d53aabed.Vault",
  // PYUSD0
  "A.1e4aa0b87d10b141.EVMVMBridgedToken_99af3eea856556646c98c8b9b2548fe815240750.Vault",
]);

const STORAGE_ITERATION = `
  let account = getAuthAccount<auth(BorrowValue) &Account>(address)
  let vaultType = Type<@{FungibleToken.Vault}>()
  account.storage.forEachStored(fun (path: StoragePath, type: Type): Bool {
    // 已失效而由系統復原的合約（例如舊版 FiatToken）不納入。
    if type.isRecovered || !type.isSubtype(of: vaultType) {
      return true
    }
    if let vault = account.storage.borrow<&{FungibleToken.Vault}>(from: path) {
      VISIT
    }
    return true
  })`;

/** 只讀取 Vault 的 balance 欄位與質押資訊，不呼叫代幣合約自訂的函式。 */
export const FLOW_HOLDINGS_SCRIPT = `
import FungibleToken from 0xf233dcee88fe0abe
import FlowStakingCollection from 0x8d0e87b65159ae63

access(all) struct Holdings {
  access(all) let balances: {String: UFix64}
  access(all) let staked: UFix64

  init(balances: {String: UFix64}, staked: UFix64) {
    self.balances = balances
    self.staked = staked
  }
}

access(all) fun main(address: Address): Holdings {
  let balances: {String: UFix64} = {}
${STORAGE_ITERATION.replace(
  "VISIT",
  "balances[type.identifier] = (balances[type.identifier] ?? 0.0) + vault.balance",
)}

  var staked = 0.0
  if FlowStakingCollection.doesAccountHaveStakingCollection(address: address) {
    for info in FlowStakingCollection.getAllDelegatorInfo(address: address) {
      staked = staked + info.tokensCommitted + info.tokensStaked
        + info.tokensUnstaking + info.tokensRewarded + info.tokensUnstaked
    }
    for info in FlowStakingCollection.getAllNodeInfo(address: address) {
      staked = staked + info.tokensCommitted + info.tokensStaked
        + info.tokensUnstaking + info.tokensRewarded + info.tokensUnstaked
    }
  }
  return Holdings(balances: balances, staked: staked)
}
`;

/**
 * 代號來自各代幣合約的 metadata view，合約可能 panic 而讓整支 script 失敗，
 * 因此與餘額分開查詢，失敗時改用合約名稱。
 */
export const FLOW_SYMBOLS_SCRIPT = `
import FungibleToken from 0xf233dcee88fe0abe
import FungibleTokenMetadataViews from 0xf233dcee88fe0abe

access(all) fun main(address: Address): {String: String} {
  let symbols: {String: String} = {}
${STORAGE_ITERATION.replace(
  "VISIT",
  `if let display = FungibleTokenMetadataViews.getFTDisplay(vault) {
        symbols[type.identifier] = display.symbol
      }`,
)}
  return symbols
}
`;

/** 將 JSON-Cadence 值轉為一般 JS 值；Dictionary 轉為以字串為 key 的物件。 */
export function decodeCadenceValue(node: unknown): unknown {
  if (typeof node !== "object" || node === null) return undefined;
  const { type, value } = node as { type?: unknown; value?: unknown };
  if (type === "Optional") {
    return value === null ? undefined : decodeCadenceValue(value);
  }
  if (type === "Array") {
    return Array.isArray(value) ? value.map(decodeCadenceValue) : [];
  }
  if (type === "Dictionary") {
    const entries = Array.isArray(value) ? value : [];
    return Object.fromEntries(
      entries.map((entry: { key?: unknown; value?: unknown }) => [
        String(decodeCadenceValue(entry.key)),
        decodeCadenceValue(entry.value),
      ]),
    );
  }
  if (type === "Struct" || type === "Resource" || type === "Event") {
    const fields = (value as { fields?: unknown } | null)?.fields;
    return Object.fromEntries(
      (Array.isArray(fields) ? fields : []).map(
        (field: { name?: unknown; value?: unknown }) => [
          String(field.name),
          decodeCadenceValue(field.value),
        ],
      ),
    );
  }
  return value;
}

function base64Encode(text: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)));
}

function base64Decode(encoded: string): string {
  return new TextDecoder().decode(
    Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0)),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `A.<address>.<Contract>.Vault` 的合約名稱，供沒有代號的代幣顯示。 */
function contractName(identifier: string): string {
  return identifier.split(".")[2] ?? identifier;
}

function displaySymbol(identifier: string, symbol: unknown): string {
  const declared = typeof symbol === "string" ? symbol.trim() : "";
  return (declared || contractName(identifier)).slice(0, SYMBOL_MAX_LENGTH);
}

export class FlowwalletClient {
  constructor(
    private readonly fetcher: CryptoFetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Script 對不存在的地址會回傳空結果，因此先向 Access API 確認帳戶存在。 */
  private async assertAccountExists(address: string): Promise<void> {
    // Workers 的全域 fetch 不能以方法形式（this.fetcher(...)）呼叫。
    const fetcher = this.fetcher;
    let response: Response;
    try {
      response = await fetcher(`${FLOW_ACCESS_API}/v1/accounts/${address}`, {
        signal: AbortSignal.timeout(CRYPTO_REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new CryptoExchangeError("Flow 連線失敗或逾時。");
    }
    if (response.status === 400 || response.status === 404) {
      throw new CryptoExchangeAuthError(
        "Flow 主網找不到這個錢包地址，請確認填入的是 Flow（Cadence）帳戶地址。",
        response.status,
      );
    }
    if (!response.ok) {
      throw new CryptoExchangeError(
        `Flow 回應錯誤（HTTP ${response.status}）。`,
        response.status,
      );
    }
  }

  private async executeScript(
    script: string,
    address: string,
  ): Promise<unknown> {
    const body = await fetchJson(
      this.fetcher,
      `${FLOW_ACCESS_API}/v1/scripts`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          script: base64Encode(script),
          arguments: [
            base64Encode(JSON.stringify({ type: "Address", value: address })),
          ],
        }),
      },
      "Flow",
    );
    if (typeof body !== "string") {
      throw new CryptoExchangeError("Flow script 回應格式已變更。");
    }
    try {
      return decodeCadenceValue(JSON.parse(base64Decode(body)));
    } catch {
      throw new CryptoExchangeError("Flow script 回應無法解析。");
    }
  }

  private async holdings(
    address: string,
  ): Promise<{ balances: Record<string, number>; staked: number }> {
    const result = await this.executeScript(FLOW_HOLDINGS_SCRIPT, address);
    if (!isRecord(result) || !isRecord(result.balances)) {
      throw new CryptoExchangeError("Flow 持倉回應格式已變更。");
    }
    return {
      balances: Object.fromEntries(
        Object.entries(result.balances).map(([identifier, balance]) => [
          identifier,
          parseAmount(balance),
        ]),
      ),
      staked: parseAmount(result.staked),
    };
  }

  private async symbols(address: string): Promise<Record<string, unknown>> {
    try {
      const result = await this.executeScript(FLOW_SYMBOLS_SCRIPT, address);
      return isRecord(result) ? result : {};
    } catch {
      return {};
    }
  }

  /** FLOW 的 USD 現價；兩個公開來源都失敗時整次同步失敗，不以缺價寫入。 */
  private async flowUsdPrice(): Promise<number> {
    const sources: Array<{ url: string; read: (body: unknown) => unknown }> = [
      {
        url: "https://api.coinbase.com/v2/prices/FLOW-USD/spot",
        read: (body) =>
          (body as { data?: { amount?: unknown } } | null)?.data?.amount,
      },
      {
        url: "https://api.coingecko.com/api/v3/simple/price?ids=flow&vs_currencies=usd",
        read: (body) =>
          (body as { flow?: { usd?: unknown } } | null)?.flow?.usd,
      },
    ];
    for (const source of sources) {
      try {
        const price = parseAmount(
          source.read(
            await fetchJson(
              this.fetcher,
              source.url,
              { method: "GET" },
              "FLOW 報價",
            ),
          ),
        );
        if (price > 0) return price;
      } catch {
        // 改用下一個報價來源。
      }
    }
    throw new CryptoExchangeError("無法取得 FLOW 報價，請稍後再試。");
  }

  async fetchPositions(
    config: FlowwalletConfig,
    asOfDate = this.now().toISOString().slice(0, 10),
  ): Promise<CryptoPosition[]> {
    const { address } = config;
    if (!address) {
      throw new CryptoExchangeAuthError("尚未設定 Flow 錢包地址。");
    }
    await this.assertAccountExists(address);
    const { balances, staked } = await this.holdings(address);
    const flowBalance = balances[FLOW_TOKEN_IDENTIFIER] ?? 0;
    const tokens = Object.entries(balances).filter(
      ([identifier, balance]) =>
        identifier !== FLOW_TOKEN_IDENTIFIER && balance > 0,
    );
    const [flowPrice, symbols] = await Promise.all([
      flowBalance > 0 || staked > 0 ? this.flowUsdPrice() : undefined,
      tokens.length > 0 ? this.symbols(address) : {},
    ]);

    const positions: CryptoPosition[] = [];
    const flowHoldings = [
      { wallet: "wallet", walletLabel: "錢包", quantity: flowBalance },
      { wallet: "staking", walletLabel: "質押", quantity: staked },
    ];
    for (const holding of flowHoldings) {
      if (holding.quantity <= 0) continue;
      positions.push(
        cryptoPosition({
          connectorId: "flowwallet",
          ...holding,
          asset: "FLOW",
          priceUsd: flowPrice,
          asOfDate,
        }),
      );
    }
    for (const [identifier, quantity] of tokens) {
      const symbol = displaySymbol(
        identifier,
        (symbols as Record<string, unknown>)[identifier],
      );
      positions.push({
        // 代號可能重複，以合約型別作為穩定識別。
        sourceId: `flowwallet:token:${identifier}`,
        assetType: "crypto",
        symbol,
        name: `${symbol}（錢包）`,
        quantity,
        marketValue: usdMarketValue(
          quantity,
          USD_STABLECOIN_IDENTIFIERS.has(identifier) ? 1 : undefined,
        ),
        currency: "USD",
        asOfDate,
        raw: { wallet: "token", asset: symbol, identifier },
      });
    }
    return positions;
  }
}

export function createFlowwalletConnector(fetcher: CryptoFetch = fetch) {
  return new FlowwalletClient(fetcher);
}
