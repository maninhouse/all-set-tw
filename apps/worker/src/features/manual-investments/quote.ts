import {
  MANUAL_INVESTMENT_MARKETS,
  type ManualInvestmentMarket,
} from "@taiwan-fin-hub/shared";
import { z } from "zod";

export const QUOTE_API_BASE_URL =
  "https://query1.finance.yahoo.com/v8/finance/chart/";

const PROVIDER_TIMEOUT_MS = 10_000;

const chartResponseSchema = z.object({
  chart: z.object({
    result: z
      .array(
        z.object({
          meta: z.object({
            currency: z.string(),
            regularMarketPrice: z.number().finite().positive(),
          }),
        }),
      )
      .min(1),
  }),
});

export class QuoteProviderError extends Error {
  constructor(message = "Quote provider is unavailable.") {
    super(message);
    this.name = "QuoteProviderError";
  }
}

const YAHOO_SUFFIX: Record<ManualInvestmentMarket, string> = {
  US: "",
  JP: ".T",
  UK: ".L",
};

export function yahooSymbol(market: ManualInvestmentMarket, symbol: string) {
  return `${symbol}${YAHOO_SUFFIX[market]}`;
}

/** Fetches the latest regular-market price in the market's own currency. */
export async function fetchQuote(
  market: ManualInvestmentMarket,
  symbol: string,
  fetcher: typeof fetch = fetch,
): Promise<number> {
  const url = `${QUOTE_API_BASE_URL}${encodeURIComponent(yahooSymbol(market, symbol))}?range=1d&interval=1d`;
  let response: Response;
  try {
    response = await fetcher(url, {
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
  } catch {
    throw new QuoteProviderError();
  }
  if (!response.ok) {
    throw new QuoteProviderError(
      `Quote provider returned HTTP ${response.status}.`,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new QuoteProviderError("Quote provider returned invalid JSON.");
  }
  const parsed = chartResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new QuoteProviderError(
      "Quote provider returned an invalid response.",
    );
  }
  const meta = parsed.data.chart.result[0]!.meta;
  const expectedCurrency = MANUAL_INVESTMENT_MARKETS[market].currency;
  if (meta.currency !== expectedCurrency) {
    throw new QuoteProviderError(
      `Quote currency ${meta.currency} does not match ${expectedCurrency}.`,
    );
  }
  return meta.regularMarketPrice;
}
