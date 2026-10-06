import type { SyncTrigger } from "../../db";
import type { Env } from "../../platform/env";
import { syncCryptoSource } from "../crypto/sync";
import { createFlowwalletConnector, parseFlowwalletConfig } from "./api";

// 非託管錢包沒有 API 金鑰，只以公開地址查詢鏈上持倉。
export const syncFlowwallet = (env: Env, trigger: SyncTrigger) =>
  syncCryptoSource(env, trigger, {
    connectorId: "flowwallet",
    missingMessage: "請先設定 Flow 錢包地址。",
    parse: parseFlowwalletConfig,
    isConfigured: (config) => Boolean(config.address),
    fetchPositions: (config) =>
      createFlowwalletConnector().fetchPositions(config),
  });
