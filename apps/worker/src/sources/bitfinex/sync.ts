import type { SyncTrigger } from "../../db";
import type { Env } from "../../platform/env";
import { API_KEYS_MISSING, hasApiKeys, syncCryptoSource } from "../crypto/sync";
import { createBitfinexConnector, parseBitfinexConfig } from "./api";

export const syncBitfinex = (env: Env, trigger: SyncTrigger) =>
  syncCryptoSource(env, trigger, {
    connectorId: "bitfinex",
    missingMessage: API_KEYS_MISSING,
    parse: parseBitfinexConfig,
    isConfigured: hasApiKeys,
    fetchPositions: (config) =>
      createBitfinexConnector().fetchPositions(config),
  });
