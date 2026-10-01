import { describe, expect, it } from "vitest";
import type { ApiClient } from "@/shared/api/client";
import { investmentsQuery } from "./queries";

function apiWith(responses: Record<string, unknown>): ApiClient {
  const get = async (path: string) => {
    const value = responses[path];
    if (value instanceof Error) throw value;
    return value;
  };
  return { get } as unknown as ApiClient;
}

const synced = {
  id: "0050",
  assetType: "etf",
  symbol: "0050",
  name: "元大台灣50",
  currency: "TWD",
  asOfDate: "2026-10-01",
};

async function run(api: ApiClient) {
  const queryFn = investmentsQuery(() => api).queryFn as () => Promise<
    unknown[]
  >;
  return queryFn();
}

describe("investmentsQuery", () => {
  it("keeps synced positions when manual holdings fail to load", async () => {
    await expect(
      run(
        apiWith({
          "/api/investments": [synced],
          "/api/manual-investments": new Error("no such table"),
        }),
      ),
    ).resolves.toEqual([synced]);
  });

  it("still fails when synced positions fail to load", async () => {
    await expect(
      run(
        apiWith({
          "/api/investments": new Error("down"),
          "/api/manual-investments": [],
        }),
      ),
    ).rejects.toThrow("down");
  });
});
