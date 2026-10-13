const REJECTIONS = Object.freeze({
    "active-trip": "專案仍在旅行中 · 先結束旅行，再封存",
    "project-has-records": "專案仍有紀錄 · 先移出紀錄，再刪除專案",
    "project-current-trip": "這是目前的旅行專案 · 先結束旅行，再刪除",
    "local-storage": "變更沒存到這台裝置，草稿還在 · 再按一次儲存",
    "invalid-object": "內容和目前帳本不符 · 檢查分類、專案或紀錄後再儲存",
    "invalid-command": "變更和目前帳本不一致 · 先同步，再檢查並儲存",
    "path-not-allowed": "這項變更無法儲存 · 回到 LedgerNook 使用可用的功能",
    "permission-denied": "目前唯讀，變更沒存入，草稿還在 · 開啟寫入權限後再儲存",
    "write-denied": "權杖沒有寫入權限，已切換為唯讀，草稿還在 · 換用可寫入的權杖再儲存",
    "credential-rejected": "GitHub 拒絕了權杖，已清除記住的權杖和本機帳本 · 重新連線後再試",
    "incomplete-coverage": "帳本歷史尚未完整，變更沒有送出 · 先同步完成，再重試",
    "invalid-valuation": "金額、幣別或匯率無法換算，還沒儲存 · 檢查金額與幣別後再試",
    "rate-unavailable": "找不到這一天或更早的匯率 · 稍後再試或輸入實際台幣金額",
    "rate-limited": "匯率來源暫時限制查詢 · 稍後再試",
    "provider-error": "匯率來源發生錯誤 · 稍後再試",
    "rejected": "匯率來源拒絕這次查詢 · 檢查幣別與日期後再試",
    "network": "目前連不上匯率來源 · 連線後再試",
    "cancelled": "換算已取消，沒有儲存 · 需要時再試",
    "invalid-response": "匯率來源回覆無法使用，沒有儲存 · 稍後再試",
    "unsupported-request": "這個幣別或日期無法查詢匯率 · 改用可查詢的幣別或日期",
    "invalid-plan": "分期設定無效 · 檢查期數、日期和每期金額",
    "invalid-revision": "分期調整無效 · 檢查生效日期和期數順序",
    "allocation-mismatch": "退款分攤金額不符 · 讓分攤總額等於退款金額，取消的未到期金額須和分期調整相符",
    "over-allocation": "退款分攤超過可抵減金額 · 減少分攤金額",
    "currency-mismatch": "退款和分期幣別不同 · 改用相同幣別",
    "rule-conflict": "分類規則不符，這次沒有存入 · 檢查現有規則後再試",
});
/** Readable state for one command result; no remote value is called saved before confirmation. */
export function describeResult(result) {
    switch (result.status) {
        case "pending": return { text: "已存在這台裝置，待同步 · 連線後會自動送出", tone: "ok" };
        case "confirmed": return { tone: "ok", text: "已存到 GitHub · 可在其他裝置同步" };
        case "conflict":
            return { tone: "error", text: "GitHub 上的資料已變更，這次沒有存入 · 先同步、檢查後再儲存" };
        case "uncertain":
            return { tone: "error", text: "尚未確認有沒有存到 · 再儲存一次，不會重複記錄" };
        case "rejected": return { tone: "error", text: REJECTIONS[result.code] ?? "這項變更沒有存入 · 檢查內容後再試" };
    }
}
