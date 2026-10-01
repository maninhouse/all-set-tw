import { test } from "vitest";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  BitfinexClient,
  parseBitfinexConfig,
} from "../../../src/sources/bitfinex/api";
import { CryptoExchangeAuthError } from "../../../src/sources/crypto/exchange";

test("Bitfinex 持倉解析、簽章與錯誤分類", async () => {
  assert.deepEqual(parseBitfinexConfig({ apiKey: "k", apiSecret: "s" }), {
    apiKey: "k",
    apiSecret: "s",
  });
  assert.throws(() => parseBitfinexConfig({ apiSecret: "" }));

  const NOW = new Date("2026-10-01T04:00:00.000Z");
  const seen: Array<{ url: string; headers: Headers; body?: unknown }> = [];
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status });
  const ticker = (symbol: string, last: number) => [
    symbol,
    last,
    1,
    last,
    1,
    0,
    0,
    last,
    1,
    1,
    1,
  ];

  const fetcher = async (input: string, init?: RequestInit) => {
    seen.push({
      url: input,
      headers: new Headers(init?.headers),
      body: init?.body,
    });
    if (input.endsWith("/v2/auth/r/wallets")) {
      return json([
        ["exchange", "BTC", 0.25, 0, 0.25, null, null],
        ["exchange", "UST", 120.5, 0, 120.5, null, null],
        ["funding", "USD", 1000, 0, 0, null, null],
        ["funding", "ETH", 0, 0, 0, null, null],
        ["margin", "BTC", 9, 0, 9, null, null],
        ["exchange", "XYZ", 5, 0, 5, null, null],
      ]);
    }
    if (input.includes("/v2/tickers")) {
      return json([
        ticker("tBTCUSD", 60000),
        ticker("tETHUSD", 2000),
        ["fUSD", 0],
      ]);
    }
    return json({}, 404);
  };

  const client = new BitfinexClient(fetcher, () => NOW);
  const positions = await client.fetchPositions({
    apiKey: "key",
    apiSecret: "secret",
  });
  const bySource = Object.fromEntries(positions.map((p) => [p.sourceId, p]));

  // Margin wallets and empty balances are excluded.
  assert.deepEqual(Object.keys(bySource).sort(), [
    "bitfinex:exchange:BTC",
    "bitfinex:exchange:USDT",
    "bitfinex:exchange:XYZ",
    "bitfinex:funding:USD",
  ]);
  assert.equal(bySource["bitfinex:exchange:BTC"]!.marketValue, 15000);
  assert.equal(bySource["bitfinex:exchange:USDT"]!.symbol, "USDT");
  assert.equal(bySource["bitfinex:exchange:USDT"]!.marketValue, 121);
  assert.equal(bySource["bitfinex:funding:USD"]!.marketValue, 1000);
  assert.equal(bySource["bitfinex:exchange:XYZ"]!.marketValue, undefined);
  assert.equal(bySource["bitfinex:exchange:BTC"]!.currency, "USD");

  const request = seen.find((r) => r.url.endsWith("/v2/auth/r/wallets"))!;
  const nonce = request.headers.get("bfx-nonce")!;
  assert.equal(request.headers.get("bfx-apikey"), "key");
  assert.equal(
    request.headers.get("bfx-signature"),
    createHmac("sha384", "secret")
      .update(`/api/v2/auth/r/wallets${nonce}${String(request.body)}`)
      .digest("hex"),
  );

  const rejected = new BitfinexClient(
    async (input) =>
      input.includes("tickers")
        ? json([])
        : json(["error", 10100, "apikey: invalid"]),
    () => NOW,
  );
  await assert.rejects(
    rejected.fetchPositions({ apiKey: "k", apiSecret: "s" }),
    CryptoExchangeAuthError,
  );
  await assert.rejects(client.fetchPositions({}), CryptoExchangeAuthError);
});
