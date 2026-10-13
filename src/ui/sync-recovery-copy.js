/** Names the retained change and the effect of each available recovery choice. */
export function syncRecoveryCopy({ noticeKind, aspects = [] }) {
    switch (noticeKind) {
        case "record-create": return "新增紀錄未能同步 · 重送＝再送出新增 · 捨棄＝移除這筆紀錄";
        case "record-edit": return `${aspects.length ? aspects.join("／") : "這筆紀錄的"}變更未能同步 · 重送＝用你的修改覆蓋 · 捨棄＝改用其他裝置的內容`;
        case "record-edit-deleted": return "這筆已在其他裝置刪除 · 重送＝重新建立並套用修改 · 捨棄＝一併移除";
        case "record-void": return "作廢紀錄未能同步 · 重送＝再作廢一次 · 捨棄＝恢復目前內容";
        case "record-refund-allocation": return "退款分攤未能同步 · 重送＝再分攤一次 · 捨棄＝恢復目前內容";
        case "record-installment": return "分期設定未能同步 · 重送＝再套用分期 · 捨棄＝恢復目前安排";
        case "notification-record": return "補記通知未能同步 · 重送＝再補記一次 · 捨棄＝保留這則通知";
        case "notification-dismiss": return "略過通知未能同步 · 重送＝再略過一次 · 捨棄＝保留這則通知";
        case "project-create": return "新增專案未能同步 · 重送＝重新建立 · 捨棄＝移除專案";
        case "project-rename": return "專案改名未能同步 · 重送＝再改一次 · 捨棄＝保留原名";
        case "project-archive": return "封存專案未能同步 · 重送＝再封存 · 捨棄＝保留未封存";
        case "project-unarchive": return "取消封存專案未能同步 · 重送＝再取消封存 · 捨棄＝保留封存";
        case "project-edit": return "專案設定變更未能同步 · 重送＝用你的設定覆蓋 · 捨棄＝改用目前的設定";
        case "project-edit-deleted": return "這個專案已在其他裝置刪除 · 重送＝重新建立 · 捨棄＝不再保留";
        case "project-delete": return "刪除專案未能同步 · 重送＝再刪一次 · 捨棄＝保留專案";
        case "project-delete-conflict": return "刪除專案未能同步：專案已在其他裝置變更 · 重送＝再刪一次 · 捨棄＝保留專案";
        case "project-delete-has-records": return "刪除專案未能同步：專案還有紀錄 · 重送＝再刪一次 · 捨棄＝保留專案";
        case "project-delete-current-trip": return "刪除專案未能同步：目前是旅行專案 · 重送＝再刪一次 · 捨棄＝保留專案";
        case "setting-change": return "設定變更未能同步 · 重送＝用你的設定覆蓋 · 捨棄＝改用目前的設定";
        case "setting-categories-rules": return "分類與規則變更未能同步 · 重送＝用你的設定覆蓋 · 捨棄＝改用目前的設定";
        case "setting-payment-methods": return "付款方式變更未能同步 · 重送＝用你的設定覆蓋 · 捨棄＝改用目前的設定";
        case "setting-ai-organiser": return "AI 整理設定未能同步 · 重送＝用你的設定覆蓋 · 捨棄＝改用目前的設定";
        case "setting-reporting-time-zone": return "報表時區變更未能同步 · 重送＝用你的設定覆蓋 · 捨棄＝改用目前的設定";
        case "setting-current-trip": return "旅行中設定未能同步 · 重送＝用你的設定覆蓋 · 捨棄＝改用目前的設定";
        case "setting-overview-pins": return "總覽釘選變更未能同步 · 重送＝用你的設定覆蓋 · 捨棄＝改用目前的設定";
    }
}
