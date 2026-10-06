/** USD 計價項目低於此金額（含 0）視為小額，可在清冊隱藏。 */
export const SMALL_USD_THRESHOLD = 1;

/** TWD 計價項目低於此金額（含 0）視為小額；其他幣別折合台幣比照。 */
export const SMALL_TWD_THRESHOLD = 10;

// Key predates hiding non-crypto items; kept so the saved choice survives.
const HIDE_SMALL_KEY = "taiwan-fin-hub-hide-small-crypto";

/** 是否隱藏小額項目；預設隱藏，讀不到偏好時也維持預設。 */
export function readHideSmallItems() {
  try {
    return localStorage.getItem(HIDE_SMALL_KEY) !== "0";
  } catch {
    return true;
  }
}

export function writeHideSmallItems(value: boolean) {
  try {
    localStorage.setItem(HIDE_SMALL_KEY, value ? "1" : "0");
  } catch {
    // Preference is a convenience only.
  }
}

/**
 * 依計價幣別判斷是否為小額：USD 低於 1 USD、TWD 低於 NT$10；
 * 其他幣別需有匯率，折合台幣低於 NT$10。缺匯率時金額未知，一律不算小額。
 */
export function isSmallAmount(
  amount: number,
  currency: string,
  rates: Readonly<Record<string, number>>,
) {
  if (currency === "USD") return Math.abs(amount) < SMALL_USD_THRESHOLD;
  if (currency === "TWD") return Math.abs(amount) < SMALL_TWD_THRESHOLD;
  const rate = rates[currency];
  return rate != null && Math.abs(amount * rate) < SMALL_TWD_THRESHOLD;
}
