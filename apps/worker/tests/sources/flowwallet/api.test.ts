import { test } from "vitest";
import assert from "node:assert/strict";
import { CryptoExchangeAuthError } from "../../../src/sources/crypto/exchange";
import {
  FLOW_HOLDINGS_SCRIPT,
  FLOW_SYMBOLS_SCRIPT,
  FlowwalletClient,
  decodeCadenceValue,
  parseFlowwalletConfig,
} from "../../../src/sources/flowwallet/api";

test("Flow Wallet 地址驗證、Cadence 解碼與持倉換算", async () => {
  assert.deepEqual(parseFlowwalletConfig({ address: " 0xABCDEF0123456789 " }), {
    address: "0xabcdef0123456789",
  });
  assert.deepEqual(parseFlowwalletConfig({ address: "abcdef0123456789" }), {
    address: "0xabcdef0123456789",
  });
  assert.deepEqual(parseFlowwalletConfig({}), {});
  // EVM 地址（20 bytes）不是 Cadence 帳戶地址。
  assert.throws(() =>
    parseFlowwalletConfig({
      address: "0x2aabea2058b5ac2d339b163c6ab6f2b6d53aabed",
    }),
  );
  assert.throws(() => parseFlowwalletConfig({ address: "" }));

  assert.deepEqual(
    decodeCadenceValue({
      type: "Struct",
      value: {
        id: "s.x.Holdings",
        fields: [
          {
            name: "balances",
            value: {
              type: "Dictionary",
              value: [
                {
                  key: { type: "String", value: "A.1.T.Vault" },
                  value: { type: "UFix64", value: "1.50000000" },
                },
              ],
            },
          },
          { name: "missing", value: { type: "Optional", value: null } },
          {
            name: "present",
            value: { type: "Optional", value: { type: "String", value: "ok" } },
          },
        ],
      },
    }),
    {
      balances: { "A.1.T.Vault": "1.50000000" },
      missing: undefined,
      present: "ok",
    },
  );

  const NOW = new Date("2026-10-06T04:00:00.000Z");
  const ADDRESS = "0xabcdef0123456789";
  const FLOW = "A.1654653399040a61.FlowToken.Vault";
  const USDC = "A.f1ab99c82dee3526.USDCFlow.Vault";
  const ST_FLOW = "A.d6f80565193ad727.stFlowToken.Vault";
  const FAKE_USDC = "A.0000000000000bad.FakeToken.Vault";
  const NAMELESS = "A.0000000000000abc.MysteryToken.Vault";
  const EMPTY = "A.0000000000000abc.EmptyToken.Vault";

  const base64 = (text: string) => Buffer.from(text, "utf8").toString("base64");
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status });
  const dictionary = (entries: Record<string, string>, valueType: string) => ({
    type: "Dictionary",
    value: Object.entries(entries).map(([key, value]) => ({
      key: { type: "String", value: key },
      value: { type: valueType, value },
    })),
  });
  const holdingsResponse = (balances: Record<string, string>, staked: string) =>
    json(
      base64(
        JSON.stringify({
          type: "Struct",
          value: {
            id: "s.x.Holdings",
            fields: [
              { name: "balances", value: dictionary(balances, "UFix64") },
              { name: "staked", value: { type: "UFix64", value: staked } },
            ],
          },
        }),
      ),
    );

  type Options = {
    accountStatus?: number;
    symbolsFail?: boolean;
    coinbaseFails?: boolean;
    coingeckoFails?: boolean;
    balances?: Record<string, string>;
    staked?: string;
  };

  function wallet(options: Options = {}) {
    const seen: string[] = [];
    const fetcher = async (input: string, init?: RequestInit) => {
      seen.push(input);
      if (input.endsWith(`/v1/accounts/${ADDRESS}`)) {
        return json(
          { address: ADDRESS.slice(2) },
          options.accountStatus ?? 200,
        );
      }
      if (input.endsWith("/v1/scripts")) {
        const request = JSON.parse(String(init?.body)) as {
          script: string;
          arguments: string[];
        };
        assert.deepEqual(
          JSON.parse(Buffer.from(request.arguments[0]!, "base64").toString()),
          { type: "Address", value: ADDRESS },
        );
        const script = Buffer.from(request.script, "base64").toString();
        if (script === FLOW_HOLDINGS_SCRIPT) {
          return holdingsResponse(
            options.balances ?? {
              [FLOW]: "100.50000000",
              [USDC]: "25.40000000",
              [ST_FLOW]: "3.00000000",
              [FAKE_USDC]: "9999.00000000",
              [NAMELESS]: "7.00000000",
              [EMPTY]: "0.00000000",
            },
            options.staked ?? "2000.00000000",
          );
        }
        assert.equal(script, FLOW_SYMBOLS_SCRIPT);
        if (options.symbolsFail)
          return json({ code: 400, message: "panic" }, 400);
        return json(
          base64(
            JSON.stringify(
              dictionary(
                {
                  [USDC]: "USDC.e",
                  [ST_FLOW]: "stFlow",
                  [FAKE_USDC]: "USDC",
                },
                "String",
              ),
            ),
          ),
        );
      }
      if (input.includes("api.coinbase.com")) {
        return options.coinbaseFails
          ? json({}, 503)
          : json({ data: { amount: "0.5", base: "FLOW", currency: "USD" } });
      }
      if (input.includes("api.coingecko.com")) {
        return options.coingeckoFails
          ? json({}, 429)
          : json({ flow: { usd: 0.4 } });
      }
      return json({}, 404);
    };
    return { seen, fetcher, client: new FlowwalletClient(fetcher, () => NOW) };
  }

  const { client } = wallet();
  const positions = await client.fetchPositions({ address: ADDRESS });
  const bySource = Object.fromEntries(positions.map((p) => [p.sourceId, p]));

  // Empty vaults are excluded; every other vault becomes one position.
  assert.deepEqual(Object.keys(bySource).sort(), [
    `flowwallet:staking:FLOW`,
    `flowwallet:token:${NAMELESS}`,
    `flowwallet:token:${FAKE_USDC}`,
    `flowwallet:token:${ST_FLOW}`,
    `flowwallet:token:${USDC}`,
    `flowwallet:wallet:FLOW`,
  ]);
  assert.equal(bySource["flowwallet:wallet:FLOW"]!.quantity, 100.5);
  assert.equal(bySource["flowwallet:wallet:FLOW"]!.marketValue, 50);
  assert.equal(bySource["flowwallet:wallet:FLOW"]!.name, "FLOW（錢包）");
  assert.equal(bySource["flowwallet:staking:FLOW"]!.marketValue, 1000);
  assert.equal(bySource["flowwallet:staking:FLOW"]!.name, "FLOW（質押）");
  assert.equal(bySource[`flowwallet:token:${USDC}`]!.symbol, "USDC.e");
  assert.equal(bySource[`flowwallet:token:${USDC}`]!.marketValue, 25);
  // Tokens without a price source keep an empty market value.
  assert.equal(bySource[`flowwallet:token:${ST_FLOW}`]!.marketValue, undefined);
  // A token that merely declares a stablecoin symbol is not priced.
  assert.equal(bySource[`flowwallet:token:${FAKE_USDC}`]!.symbol, "USDC");
  assert.equal(
    bySource[`flowwallet:token:${FAKE_USDC}`]!.marketValue,
    undefined,
  );
  // Tokens without metadata fall back to the contract name.
  assert.equal(
    bySource[`flowwallet:token:${NAMELESS}`]!.symbol,
    "MysteryToken",
  );
  for (const position of positions) {
    assert.equal(position.currency, "USD");
    assert.equal(position.assetType, "crypto");
    assert.equal(position.asOfDate, "2026-10-06");
    // The wallet address never reaches persisted identifiers or raw payloads.
    assert.ok(!JSON.stringify(position).includes(ADDRESS.slice(2)));
  }

  // Stable identifiers across repeated syncs.
  assert.deepEqual(
    (await wallet().client.fetchPositions({ address: ADDRESS }))
      .map((p) => p.sourceId)
      .sort(),
    Object.keys(bySource).sort(),
  );

  // A panicking token contract only costs the display symbols.
  const withoutSymbols = await wallet({
    symbolsFail: true,
  }).client.fetchPositions({ address: ADDRESS });
  assert.equal(withoutSymbols.length, 6);
  assert.equal(
    withoutSymbols.find((p) => p.sourceId === `flowwallet:token:${USDC}`)!
      .symbol,
    "USDCFlow",
  );
  assert.equal(
    withoutSymbols.find((p) => p.sourceId === `flowwallet:token:${USDC}`)!
      .marketValue,
    25,
  );

  // Falls back to the second price source, and fails rather than writing unpriced FLOW.
  const fallback = await wallet({ coinbaseFails: true }).client.fetchPositions({
    address: ADDRESS,
  });
  assert.equal(
    fallback.find((p) => p.sourceId === "flowwallet:wallet:FLOW")!.marketValue,
    40,
  );
  await assert.rejects(
    wallet({ coinbaseFails: true, coingeckoFails: true }).client.fetchPositions(
      {
        address: ADDRESS,
      },
    ),
    /FLOW 報價/,
  );

  // No FLOW and no tokens: no price or symbol lookups are needed.
  const empty = wallet({
    balances: { [FLOW]: "0.00000000" },
    staked: "0.00000000",
  });
  assert.deepEqual(await empty.client.fetchPositions({ address: ADDRESS }), []);
  assert.equal(empty.seen.length, 2);

  for (const accountStatus of [400, 404]) {
    await assert.rejects(
      wallet({ accountStatus }).client.fetchPositions({ address: ADDRESS }),
      CryptoExchangeAuthError,
    );
  }
  await assert.rejects(client.fetchPositions({}), CryptoExchangeAuthError);

  // Workers 的全域 fetch 以方法形式呼叫會丟出 Illegal invocation。
  const unbound = wallet();
  const strictFetcher = function (
    this: unknown,
    input: string,
    init?: RequestInit,
  ) {
    assert.equal(this, undefined);
    return unbound.fetcher(input, init);
  };
  assert.equal(
    (
      await new FlowwalletClient(strictFetcher, () => NOW).fetchPositions({
        address: ADDRESS,
      })
    ).length,
    6,
  );
});
