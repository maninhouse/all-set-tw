import forge from "node-forge";
import type {
  BankAccount,
  BankBalanceSnapshot,
  BankTransaction,
} from "@taiwan-fin-hub/shared";
import { z } from "zod";
import {
  LinebankApiError,
  LinebankClient,
  type LinebankDepositPayloads,
  type LinebankFetch,
} from "./api";
import { BANK_SYNC_MONTHS } from "../sync-window";

export const linebankConfigSchema = z.object({
  userId: z.string().min(1).optional(),
  account: z.string().min(1).optional(),
  password: z.string().min(1).optional(),
});
export type LinebankConfig = z.infer<typeof linebankConfigSchema>;
export function parseLinebankConfig(value: unknown): LinebankConfig {
  return linebankConfigSchema.parse(value);
}

// 90 days is the longest history window confirmed against the real bank.
const HISTORY_DAYS = BANK_SYNC_MONTHS * 30;
const INSTITUTION_NAME = "LINE Bank";
const DEPOSIT = "1";
const WITHDRAWAL = "2";

const compactDate = z.string().regex(/^\d{8}$/);
const optionalText = z
  .string()
  .nullish()
  .transform((value) => value?.trim() || undefined);

const accountsSchema = z.object({
  acctList: z.array(
    z.object({
      acctNbr: z.string().regex(/^\d{6,20}$/),
      acctNick: optionalText,
      pdNm: optionalText,
      acctBal: z.number().finite(),
      acctStsCd: optionalText,
      arrOpnDt: compactDate.nullish(),
      arrMatDt: compactDate.nullish(),
      ccyCd: z.string().regex(/^[A-Za-z]{3}$/),
    }),
  ),
});

const transactionSchema = z.object({
  acctNbr: z.string().regex(/^\d{6,20}$/),
  dpstWdrwDsCd: z.enum([DEPOSIT, WITHDRAWAL]),
  cnclYn: optionalText,
  txCaseCd: optionalText,
  bizTxFuncTpCd: optionalText,
  bizTxFuncTpCdNm: optionalText,
  txRmkCont: optionalText,
  ctptBnkCd: optionalText,
  ctptAcctNbr: optionalText,
  ctptAcctNick: optionalText,
  ctptCustNm: optionalText,
  txAmt: z.number().finite().nonnegative(),
  txDt: compactDate,
  txTm: z.string().regex(/^\d{6}$/),
});

export type LinebankData = {
  bankAccounts: Array<Omit<BankAccount, "id" | "connectorId">>;
  bankBalanceSnapshots: Array<Omit<BankBalanceSnapshot, "id" | "connectorId">>;
  bankTransactions: Array<Omit<BankTransaction, "id" | "connectorId">>;
  /** Counts only, for logs: rows the bank returned that were not imported. */
  skipped: { cancelled: number; unknownAccount: number };
};

function hash(value: string): string {
  return forge.md.sha256.create().update(value, "utf8").digest().toHex();
}

function isoDate(value: string): string {
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function last4(value: string): string {
  return value.replace(/\D/g, "").slice(-4);
}

/** Any unparsable account or transaction fails the whole sync (no partial data). */
export function parseLinebankDeposits(
  payloads: LinebankDepositPayloads,
): LinebankData {
  const accounts = accountsSchema.safeParse(payloads.accounts);
  const transactions = z
    .array(transactionSchema)
    .safeParse(payloads.transactions);
  if (
    !accounts.success ||
    !transactions.success ||
    !/^\d{8}$/.test(payloads.balanceDate)
  ) {
    throw new LinebankApiError("protocol");
  }

  const balanceDate = isoDate(payloads.balanceDate);
  const accountSourceIds = new Map<string, { id: string; currency: string }>();
  const bankAccounts: LinebankData["bankAccounts"] = [];
  const bankBalanceSnapshots: LinebankData["bankBalanceSnapshots"] = [];
  for (const account of accounts.data.acctList) {
    const currency = account.ccyCd.toUpperCase();
    const sourceId = `bank:linebank:${account.acctNbr}:${currency}`;
    if (accountSourceIds.has(account.acctNbr)) {
      throw new LinebankApiError("protocol");
    }
    accountSourceIds.set(account.acctNbr, { id: sourceId, currency });
    const accountType = account.arrMatDt ? "time_deposit" : "savings";
    bankAccounts.push({
      sourceId,
      institutionName: INSTITUTION_NAME,
      accountName: account.acctNick ?? account.pdNm ?? "LINE Bank 存款",
      accountType,
      currency,
      openedDate: account.arrOpnDt ? isoDate(account.arrOpnDt) : undefined,
      maturityDate: account.arrMatDt ? isoDate(account.arrMatDt) : undefined,
      raw: {
        accountType,
        product: account.pdNm,
        status: account.acctStsCd,
        accountLast4: last4(account.acctNbr),
      },
    });
    // The bank reports the balance as of the end of `balanceDate` (yesterday).
    bankBalanceSnapshots.push({
      accountId: sourceId,
      sourceId: `snapshot:linebank:${account.acctNbr}:${currency}:${balanceDate}`,
      balance: account.acctBal,
      availableBalance: account.acctBal,
      currency,
      asOfAt: `${balanceDate}T23:59:59+08:00`,
      raw: { balanceDate },
    });
  }

  const skipped = { cancelled: 0, unknownAccount: 0 };
  const occurrences = new Map<string, number>();
  const bankTransactions: LinebankData["bankTransactions"] = [];
  for (const tx of transactions.data) {
    if (tx.cnclYn === "Y") {
      skipped.cancelled++;
      continue;
    }
    const account = accountSourceIds.get(tx.acctNbr);
    if (!account) {
      skipped.unknownAccount++;
      continue;
    }
    const amount = tx.dpstWdrwDsCd === DEPOSIT ? tx.txAmt : -tx.txAmt;
    // The history has no transaction number; identical rows within the same
    // second are told apart by their occurrence count.
    const key = hash(
      [
        tx.acctNbr,
        tx.txDt,
        tx.txTm,
        amount,
        tx.bizTxFuncTpCd ?? "",
        tx.txCaseCd ?? "",
        tx.ctptBnkCd ?? "",
        tx.ctptAcctNbr ?? "",
      ].join("|"),
    ).slice(0, 32);
    const occurrence = occurrences.get(key) ?? 0;
    occurrences.set(key, occurrence + 1);
    const date = isoDate(tx.txDt);
    const time = `${tx.txTm.slice(0, 2)}:${tx.txTm.slice(2, 4)}:${tx.txTm.slice(4, 6)}`;
    const counterpartyLast4 = tx.ctptAcctNbr ? last4(tx.ctptAcctNbr) : "";
    bankTransactions.push({
      accountId: account.id,
      sourceId: `tx:linebank:${key}:${occurrence}`,
      postedDate: date,
      authorizedAt: `${date}T${time}+08:00`,
      amount,
      currency: account.currency,
      description: tx.txRmkCont ?? tx.bizTxFuncTpCdNm ?? "LINE Bank 交易",
      counterparty:
        tx.ctptAcctNick ??
        tx.ctptCustNm ??
        (counterpartyLast4 ? `****${counterpartyLast4}` : undefined),
      status: "posted",
      raw: {
        type: tx.bizTxFuncTpCdNm,
        typeCode: tx.bizTxFuncTpCd,
        caseCode: tx.txCaseCd,
        counterpartyBankCode: tx.ctptBnkCd,
        counterpartyLast4: counterpartyLast4 || undefined,
      },
    });
  }

  return { bankAccounts, bankBalanceSnapshots, bankTransactions, skipped };
}

export function createLinebankConnector(fetchImpl?: LinebankFetch) {
  return {
    /** One login attempt, read-only queries, and always a logout. */
    async sync(
      credentials: { userId: string; account: string; password: string },
      now = new Date(),
    ): Promise<LinebankData> {
      const client = new LinebankClient(fetchImpl);
      await client.login(credentials);
      try {
        return parseLinebankDeposits(
          await client.fetchDeposits(HISTORY_DAYS, now),
        );
      } finally {
        await client.logout().catch(() => undefined);
      }
    },
  };
}
