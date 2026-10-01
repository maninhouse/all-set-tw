import type { SyncTrigger } from "../../db";
import type { Env } from "../../platform/env";
import { API_KEYS_MISSING, hasApiKeys, syncCryptoSource } from "../crypto/sync";
import { createBinanceConnector, parseBinanceConfig } from "./api";

export const syncBinance = (env: Env, trigger: SyncTrigger) =>
  syncCryptoSource(env, trigger, {
    connectorId: "binance",
    missingMessage: API_KEYS_MISSING,
    parse: parseBinanceConfig,
    isConfigured: hasApiKeys,
    fetchPositions: (config) => createBinanceConnector().fetchPositions(config),
  });
