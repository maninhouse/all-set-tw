import { describe, expect, it } from "vitest";
import { manualInvestmentRoutes } from "../../../src/features/manual-investments/route";
import type { Env } from "../../../src/platform/env";

const env = { DB: {} as D1Database } as Env;

function post(body: unknown) {
  return manualInvestmentRoutes.request(
    "/manual-investments",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    env,
  );
}

const valid = {
  broker: "fubon",
  market: "US",
  symbol: "AAPL",
  name: "Apple",
  assetType: "stock",
  quantity: 1,
};

describe("manual investment routes", () => {
  it.each([
    ["unknown broker", { ...valid, broker: "nope" }],
    ["unsupported market", { ...valid, market: "HK" }],
    ["symbol with spaces", { ...valid, symbol: "AA PL" }],
    ["non-positive quantity", { ...valid, quantity: 0 }],
    ["manual price without date", { ...valid, manualPrice: 100 }],
  ])("rejects %s", async (_name, body) => {
    const response = await post(body);
    expect(response.status).toBe(400);
  });
});
