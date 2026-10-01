import { queryOptions } from "@tanstack/svelte-query";
import type { CreateQueryOptions } from "@tanstack/svelte-query";
import type { ApiClient } from "@/shared/api/client";
import { queryKeys } from "@/shared/api/query-keys";
import type { MonthRange } from "@/shared/date-range";
import { toInvestmentRows } from "./manual";
import type {
  InvestmentRow,
  InvestmentTransactionRow,
  ManualInvestmentRow,
} from "./types";

type ApiProvider = () => ApiClient;

/**
 * Synced positions plus manual holdings not yet covered by a connector.
 * A manual-holdings failure must not hide synced data; the manual section
 * reports its own error through `manualInvestmentsQuery`.
 */
export const investmentsQuery = (getApi: ApiProvider) =>
  queryOptions({
    queryKey: queryKeys.investments,
    queryFn: async () => {
      const [synced, manual] = await Promise.all([
        getApi().get<InvestmentRow[]>("/api/investments"),
        getApi()
          .get<ManualInvestmentRow[]>("/api/manual-investments")
          .catch(() => []),
      ]);
      return [...synced, ...toInvestmentRows(manual)];
    },
  });

export const manualInvestmentsQuery = (getApi: ApiProvider) =>
  queryOptions({
    queryKey: queryKeys.manualInvestments,
    queryFn: () =>
      getApi().get<ManualInvestmentRow[]>("/api/manual-investments"),
  });

export const investmentTransactionsRangeQuery = (
  getApi: ApiProvider,
  range: MonthRange,
) =>
  queryOptions({
    queryKey: queryKeys.investmentTransactionsRange(range.from, range.to),
    queryFn: () =>
      getApi().get<InvestmentTransactionRow[]>(
        `/api/investment-transactions?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`,
      ),
  });

export const investmentTransactionsQuery = (
  getApi: ApiProvider,
  range?: MonthRange,
): CreateQueryOptions<InvestmentTransactionRow[]> => ({
  queryKey: range
    ? queryKeys.investmentTransactionsRange(range.from, range.to)
    : queryKeys.investmentTransactions,
  queryFn: () =>
    getApi().get<InvestmentTransactionRow[]>(
      range
        ? `/api/investment-transactions?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`
        : "/api/investment-transactions",
    ),
});
