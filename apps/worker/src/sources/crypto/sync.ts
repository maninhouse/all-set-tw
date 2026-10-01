import type { ConnectorId } from "@taiwan-fin-hub/shared";
import type { SyncTrigger } from "../../db";
import { requireConnectorSettings } from "../../features/sync/config";
import { parsePublicConnectorConfig } from "../../features/sync/connector-state";
import { NeedsUserActionError } from "../../features/sync/errors";
import { persistStagedSyncWrite } from "../../features/sync/persistence";
import { investmentPositionRecord } from "../../features/sync/record-mapper";
import type { SyncOutcome } from "../../features/sync/types";
import { configEncryptionKey } from "../../platform/config";
import { decryptJson } from "../../platform/crypto";
import type { Env } from "../../platform/env";
import { CryptoExchangeAuthError, type CryptoPosition } from "./exchange";

export interface CryptoSource<TConfig> {
  connectorId: ConnectorId;
  missingMessage: string;
  parse: (config: unknown) => TConfig;
  isConfigured: (config: TConfig) => boolean;
  fetchPositions: (config: TConfig) => Promise<CryptoPosition[]>;
}

export const API_KEYS_MISSING = "請先設定 API Key 與 API Secret。";

export const hasApiKeys = (config: { apiKey?: string; apiSecret?: string }) =>
  Boolean(config.apiKey && config.apiSecret);

export async function syncCryptoSource<TConfig>(
  env: Env,
  trigger: SyncTrigger,
  source: CryptoSource<TConfig>,
): Promise<SyncOutcome> {
  const { connectorId } = source;
  const scope = "all";
  const settings = await requireConnectorSettings(env.DB, connectorId);
  const stored = await decryptJson<Record<string, unknown>>(
    settings.encrypted_config,
    configEncryptionKey(env),
  );
  const config = source.parse({
    ...stored,
    ...parsePublicConnectorConfig(connectorId, settings.public_config),
  });
  if (!source.isConfigured(config)) {
    throw new NeedsUserActionError(source.missingMessage);
  }

  console.log(`[sync] ${connectorId}/${scope}: starting trigger=${trigger}`);
  let positions: CryptoPosition[];
  try {
    positions = await source.fetchPositions(config);
  } catch (error) {
    if (error instanceof CryptoExchangeAuthError) {
      throw new NeedsUserActionError(error.message);
    }
    throw error;
  }
  console.log(`[sync] ${connectorId}/${scope}: positions=${positions.length}`);

  const now = new Date().toISOString();
  const newRecords = await persistStagedSyncWrite(env.DB, {
    records: positions.map((position) =>
      investmentPositionRecord(connectorId, position, now),
    ),
  });

  return {
    success: true,
    connectorId,
    scope,
    records: positions.length,
    newRecords,
    cursorUpdated: false,
  };
}
