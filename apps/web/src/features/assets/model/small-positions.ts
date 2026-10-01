import type { InvestmentRow } from "@/data/investments/types";

/** 加密資產市值低於此 USD 金額視為零碎餘額，可在持倉清單隱藏。 */
export const SMALL_CRYPTO_THRESHOLD_USD = 1;

/**
 * 只針對 USD 計價的加密資產；沒有報價（市值未知）的持倉不算零碎餘額，
 * 以免把有數量但查不到價格的幣種藏起來。
 */
export function isSmallCryptoPosition(position: InvestmentRow) {
  return (
    position.assetType === "crypto" &&
    position.currency === "USD" &&
    position.marketValue != null &&
    position.marketValue + (position.cashBalance ?? 0) <
      SMALL_CRYPTO_THRESHOLD_USD
  );
}
