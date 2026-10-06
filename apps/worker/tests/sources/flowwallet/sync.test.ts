import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestD1 } from "../../helpers/d1";
import { encryptJson } from "../../../src/platform/crypto";
import type { Env } from "../../../src/platform/env";
import { NeedsUserActionError } from "../../../src/features/sync/errors";
import { syncFlowwallet } from "../../../src/sources/flowwallet/sync";

let harness: Awaited<ReturnType<typeof createTestD1>>;
let env: Env;
const key = "synthetic-test-encryption-key";
const ADDRESS = "0xabcdef0123456789";
const FLOW = "A.1654653399040a61.FlowToken.Vault";
const USDC = "A.f1ab99c82dee3526.USDCFlow.Vault";

async function saveSettings(config: Record<string, unknown>) {
  await env.DB.prepare(
    "INSERT INTO connector_settings(id, connector_id, encrypted_config, created_at, updated_at) VALUES(?, ?, ?, ?, ?)",
  )
    .bind(
      "flowwallet",
      "flowwallet",
      await encryptJson(config, key),
      "2026-10-06",
      "2026-10-06",
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

const cadence = (value: unknown) =>
  Response.json(Buffer.from(JSON.stringify(value)).toString("base64"));
const dictionary = (entries: Record<string, string>, valueType: string) => ({
  type: "Dictionary",
  value: Object.entries(entries).map(([entryKey, value]) => ({
    key: { type: "String", value: entryKey },
    value: { type: valueType, value },
  })),
});

function chain(accountStatus = 200) {
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
    if (url.hostname === "api.coinbase.com") {
      return Response.json({ data: { amount: "0.5" } });
    }
    if (url.origin !== "https://rest-mainnet.onflow.org")
      return realFetch(input, init);
    requests.push(url.pathname);
    if (url.pathname === `/v1/accounts/${ADDRESS}`) {
      return Response.json({}, { status: accountStatus });
    }
    if (url.pathname !== "/v1/scripts")
      throw new Error("Unexpected synthetic Flow operation");
    const { script } = JSON.parse(String(init?.body)) as { script: string };
    return Buffer.from(script, "base64").toString().includes("struct Holdings")
      ? cadence({
          type: "Struct",
          value: {
            id: "s.x.Holdings",
            fields: [
              {
                name: "balances",
                value: dictionary(
                  { [FLOW]: "100.00000000", [USDC]: "25.40000000" },
                  "UFix64",
                ),
              },
              {
                name: "staked",
                value: { type: "UFix64", value: "2000.00000000" },
              },
            ],
          },
        })
      : cadence(dictionary({ [USDC]: "USDC.e" }, "String"));
  });
  return requests;
}

const positions = () =>
  env.DB.prepare(
    "SELECT source_id, asset_type, symbol, quantity, market_value, currency FROM investment_positions WHERE connector_id = 'flowwallet' ORDER BY source_id",
  ).all();

describe("Flow Wallet sync", () => {
  it("writes on-chain holdings once and keeps state untouched", async () => {
    await saveSettings({ address: ADDRESS });
    chain();
    const before = await env.DB.prepare(
      "SELECT encrypted_config, sync_cursor FROM connector_settings WHERE connector_id = 'flowwallet'",
    ).first<{ encrypted_config: string; sync_cursor: string | null }>();

    const first = await syncFlowwallet(env, "manual");
    await syncFlowwallet(env, "scheduled");

    expect(first).toMatchObject({ records: 3, cursorUpdated: false });
    expect((await positions()).results).toEqual([
      {
        source_id: "flowwallet:staking:FLOW",
        asset_type: "crypto",
        symbol: "FLOW",
        quantity: 2000,
        market_value: 1000,
        currency: "USD",
      },
      {
        source_id: `flowwallet:token:${USDC}`,
        asset_type: "crypto",
        symbol: "USDC.e",
        quantity: 25.4,
        market_value: 25,
        currency: "USD",
      },
      {
        source_id: "flowwallet:wallet:FLOW",
        asset_type: "crypto",
        symbol: "FLOW",
        quantity: 100,
        market_value: 50,
        currency: "USD",
      },
    ]);
    expect(
      await env.DB.prepare(
        "SELECT encrypted_config, sync_cursor FROM connector_settings WHERE connector_id = 'flowwallet'",
      ).first(),
    ).toEqual(before);
    expect(before?.sync_cursor).toBeNull();
    const stored = await env.DB.prepare(
      "SELECT raw_payload FROM investment_positions WHERE connector_id = 'flowwallet'",
    ).all<{ raw_payload: string }>();
    expect(JSON.stringify(stored.results)).not.toContain(ADDRESS.slice(2));
  }, 30000);

  it("asks for user action when the address is missing", async () => {
    await saveSettings({});
    const requests = chain();

    await expect(syncFlowwallet(env, "manual")).rejects.toBeInstanceOf(
      NeedsUserActionError,
    );
    expect(requests).toHaveLength(0);
  }, 30000);

  it("asks for user action when the chain does not know the address", async () => {
    await saveSettings({ address: ADDRESS });
    const requests = chain(404);

    await expect(syncFlowwallet(env, "scheduled")).rejects.toBeInstanceOf(
      NeedsUserActionError,
    );
    expect(requests).toEqual([`/v1/accounts/${ADDRESS}`]);
    expect((await positions()).results).toEqual([]);
  }, 30000);
});
