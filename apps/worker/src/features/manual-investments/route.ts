import type { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  MANUAL_INVESTMENT_BROKERS,
  MANUAL_INVESTMENT_MARKETS,
  type ManualInvestmentBroker,
  type ManualInvestmentMarket,
} from "@taiwan-fin-hub/shared";
import type { AppBindings } from "../../platform/env";
import { honoFactory } from "../../platform/hono";
import { isDemoMode, jsonError } from "../../platform/http";
import { validationHook } from "../../platform/validation";
import {
  addManualInvestment,
  editManualInvestment,
  getManualInvestments,
  ManualInvestmentConflictError,
  ManualInvestmentNotFoundError,
  removeManualInvestment,
} from "./service";

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const brokerSchema = z.enum(
  Object.keys(MANUAL_INVESTMENT_BROKERS) as [
    ManualInvestmentBroker,
    ...ManualInvestmentBroker[],
  ],
);
const marketSchema = z.enum(
  Object.keys(MANUAL_INVESTMENT_MARKETS) as [
    ManualInvestmentMarket,
    ...ManualInvestmentMarket[],
  ],
);
const symbolSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9.\-]{1,16}$/, "symbol must be a ticker without suffix.");
const fields = {
  broker: brokerSchema,
  market: marketSchema,
  symbol: symbolSchema,
  name: z.string().trim().min(1).max(120),
  assetType: z.enum(["stock", "etf"]),
  quantity: z.number().finite().positive(),
  manualPrice: z.number().finite().positive().nullable(),
  manualPriceDate: isoDateSchema.nullable(),
  note: z.string().max(1_000).nullable(),
};
const createSchema = z
  .object({
    ...fields,
    manualPrice: fields.manualPrice.optional(),
    manualPriceDate: fields.manualPriceDate.optional(),
    note: fields.note.optional(),
  })
  .refine(
    (body) => body.manualPrice == null || body.manualPriceDate != null,
    "manualPriceDate is required with manualPrice.",
  );
const updateSchema = z
  .object(fields)
  .partial()
  .refine((body) => Object.keys(body).length > 0)
  .refine(
    (body) => body.manualPrice == null || body.manualPriceDate != null,
    "manualPriceDate is required with manualPrice.",
  );

export const manualInvestmentRoutes = honoFactory.createApp();
registerManualInvestmentRoutes(manualInvestmentRoutes);

function registerManualInvestmentRoutes(api: Hono<AppBindings>) {
  api.get("/manual-investments", async (c) =>
    c.json(
      await getManualInvestments(c.env.DB, { persist: !isDemoMode(c.env) }),
    ),
  );

  api.post("/manual-investments/quotes/refresh", async (c) =>
    c.json(await getManualInvestments(c.env.DB, { force: true })),
  );

  api.post(
    "/manual-investments",
    zValidator(
      "json",
      createSchema,
      validationHook("INVALID_REQUEST", "Manual holding is invalid."),
    ),
    async (c) => {
      try {
        return c.json({
          id: await addManualInvestment(c.env.DB, c.req.valid("json")),
        });
      } catch (error) {
        return mapError(error);
      }
    },
  );

  api.put(
    "/manual-investments/:id",
    zValidator(
      "json",
      updateSchema,
      validationHook("INVALID_REQUEST", "Manual holding update is invalid."),
    ),
    async (c) => {
      try {
        await editManualInvestment(
          c.env.DB,
          c.req.param("id"),
          c.req.valid("json"),
        );
        return c.json({ success: true });
      } catch (error) {
        return mapError(error);
      }
    },
  );

  api.delete("/manual-investments/:id", async (c) => {
    await removeManualInvestment(c.env.DB, c.req.param("id"));
    return c.json({ success: true });
  });
}

function mapError(error: unknown) {
  if (error instanceof ManualInvestmentConflictError) {
    return jsonError(
      "MANUAL_INVESTMENT_EXISTS",
      "同一券商與市場已有此代號的手動持倉。",
      409,
    );
  }
  if (error instanceof ManualInvestmentNotFoundError) {
    return jsonError("NOT_FOUND", "找不到此手動持倉。", 404);
  }
  throw error;
}
