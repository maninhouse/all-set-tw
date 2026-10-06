import type { ConnectorId } from "@/data/connectors/types";

const DEFAULT_HINT = "輸入完帳號密碼後，請先按「儲存憑證」，再按「同步」。";

const API_KEY_HINT =
  "請建立只有讀取權限的 API 金鑰，不要開啟交易、提現或 IP 白名單；貼上後先按「儲存憑證」，再按「同步」。";

const connectorHints: Partial<Record<ConnectorId, string>> = {
  nextbank:
    "將來銀行同步會嘗試辨識圖形驗證碼；需要時使用手動驗證。每次查詢後登出，投資持倉尚未接入。",
  sinopac:
    "永豐 session 失效時會由 Gemma 4 自動辨識並登入，連續三次失敗後才需人工驗證。",
  obank:
    "王道手動與排程同步都會在必要時接管其他登入中的裝置；同步會直接使用 App API，並由 Gemma 4 自動辨識四位英數驗證碼。",
  firstbank:
    "第一銀行網銀 session 失效時會自動辨識圖形驗證碼並登入；也可改用人工輸入。",
  kgibank:
    "凱基每次同步都會自動辨識 6 位數圖形驗證碼，連續失敗後可改用人工輸入。同一帳號僅允許單一登入，同步會登出行動銀行 App；同步完成後會自動登出網銀。",
  tdcc: "排程同步不會在背景寄送驗證碼；登入失效時會標記為需要重新驗證。",
  cathaybk: "首次驗證會加入信任裝置；信任失效時需在手動同步中重新取得驗證碼。",
  megabank:
    "兆豐同步直接使用 App API，以一般帳密登入並辨識五位數圖形驗證碼；也可改用人工輸入。",
  rakuten:
    "樂天網銀驗證碼會先以 Workers AI 自動辨識，失敗時改由人工輸入；每次同步都重新登入，結束時登出，不保留 session。",
  binance: API_KEY_HINT,
  bitfinex: API_KEY_HINT,
  flowwallet:
    "只需要公開的 Flow 錢包地址，不需要也請勿輸入私鑰或助記詞；填入後先按「儲存憑證」，再按「同步」。",
};

/** 連接器面板底部的說明；沒有專屬說明的來源使用帳密登入的通用提示。 */
export function connectorHint(connectorId: ConnectorId): string {
  return connectorHints[connectorId] ?? DEFAULT_HINT;
}
