import { test } from "vitest";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  BinanceClient,
  parseBinanceConfig,
} from "../../../src/sources/binance/api";
import { CryptoExchangeAuthError } from "../../../src/sources/crypto/exchange";

test("Binance 持倉解析、簽章與錯誤分類", async () => {
  assert.deepEqual(parseBinanceConfig({ apiKey: " k ", apiSecret: "s" }), {
    apiKey: "k",
    apiSecret: "s",
  });
  assert.throws(() => parseBinanceConfig({ apiKey: "" }));

  const NOW = new Date("2026-10-01T04:00:00.000Z");
  const requests: Array<{ url: URL; key: string | null; method: string }> = [];
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status });

  const fetcher = async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    requests.push({
      url,
      key: new Headers(init?.headers).get("X-MBX-APIKEY"),
      method: init?.method ?? "GET",
    });
    switch (url.pathname) {
      case "/api/v3/account":
        return json({
          balances: [
            { asset: "BTC", free: "0.5", locked: "0.1" },
            { asset: "USDT", free: "100.4", locked: "0" },
            { asset: "DUST", free: "0", locked: "0" },
            { asset: "NOPRICE", free: "3", locked: "0" },
            { asset: "LDUSDC", free: "50", locked: "0" },
            { asset: "LDO", free: "7", locked: "0" },
          ],
        });
      case "/sapi/v1/asset/get-funding-asset":
        return json([
          {
            asset: "ETH",
            free: "2",
            locked: "0",
            freeze: "0.5",
            withdrawing: "0",
          },
        ]);
      case "/sapi/v1/simple-earn/flexible/position":
        return json({ total: 1, rows: [{ asset: "USDC", totalAmount: "50" }] });
      case "/sapi/v1/simple-earn/locked/position":
        return json({ total: 0, rows: [] });
      case "/api/v3/ticker/price":
        return json([
          { symbol: "BTCUSDT", price: "60000.00" },
          { symbol: "ETHUSDT", price: "2000.00" },
        ]);
      default:
        return json({}, 404);
    }
  };

  const client = new BinanceClient(fetcher, () => NOW);
  const positions = await client.fetchPositions({
    apiKey: "key",
    apiSecret: "secret",
  });

  const bySource = Object.fromEntries(positions.map((p) => [p.sourceId, p]));
  assert.deepEqual(Object.keys(bySource).sort(), [
    "binance:earn-flexible:USDC",
    "binance:funding:ETH",
    "binance:spot:BTC",
    "binance:spot:LDO",
    "binance:spot:NOPRICE",
    "binance:spot:USDT",
  ]);
  assert.equal(bySource["binance:spot:BTC"]!.quantity, 0.6);
  assert.equal(bySource["binance:spot:BTC"]!.marketValue, 36000);
  assert.equal(bySource["binance:spot:BTC"]!.currency, "USD");
  assert.equal(bySource["binance:spot:BTC"]!.assetType, "crypto");
  assert.equal(bySource["binance:spot:BTC"]!.asOfDate, "2026-10-01");
  assert.equal(bySource["binance:spot:USDT"]!.marketValue, 100);
  assert.equal(bySource["binance:funding:ETH"]!.marketValue, 5000);
  assert.equal(bySource["binance:earn-flexible:USDC"]!.marketValue, 50);
  assert.equal(bySource["binance:spot:NOPRICE"]!.marketValue, undefined);
  // LDUSDC mirrors the flexible-earn USDC position; LDO is a real coin and stays.
  assert.equal(bySource["binance:spot:LDUSDC"], undefined);
  assert.equal(bySource["binance:spot:LDO"]!.quantity, 7);

  // Signed requests carry the key header and a valid HMAC-SHA256 signature.
  const account = requests.find((r) => r.url.pathname === "/api/v3/account")!;
  assert.equal(account.key, "key");
  const signature = account.url.searchParams.get("signature")!;
  account.url.searchParams.delete("signature");
  assert.equal(
    signature,
    createHmac("sha256", "secret")
      .update(account.url.searchParams.toString())
      .digest("hex"),
  );
  assert.equal(
    requests.find((r) => r.url.pathname === "/sapi/v1/asset/get-funding-asset")!
      .method,
    "POST",
  );
  assert.equal(
    requests.find((r) => r.url.pathname === "/api/v3/ticker/price")!.key,
    null,
  );

  // Credential rejection is typed so sync can mark needs_user_action.
  const rejected = new BinanceClient(
    async () =>
      json({ code: -2015, msg: "Invalid API-key, IP, or permissions" }, 401),
    () => NOW,
  );
  await assert.rejects(
    rejected.fetchPositions({ apiKey: "k", apiSecret: "s" }),
    CryptoExchangeAuthError,
  );
  await assert.rejects(client.fetchPositions({}), CryptoExchangeAuthError);
});
