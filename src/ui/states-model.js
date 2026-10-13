import { incompleteHistoryNotice } from "./history-coverage-model.js";
import { dateAt, displayAmount } from "./ledger-format.js";
import { screenDateFormatter } from "./screen-date-format.js";
export function synchronizationStatus(input) {
    if (input.state === "syncing") {
        const date = input.progressThroughDate;
        const progress = input.firstLoad && date ? ` · 已到 ${screenDateFormatter(dateAt(input.now, input.timeZone || "Asia/Taipei"), []).timelineDate(date)}` : "";
        return { text: input.firstLoad ? `載入中${progress}` : "同步中", icon: input.firstLoad ? "downloading" : "cloud_sync",
            tone: "normal", firstLoad: input.firstLoad === true, retry: false };
    }
    if (input.state === "offline" || input.state === "failed") {
        const label = input.state === "offline" ? "離線" : "同步失敗";
        const age = input.lastSynchronizedAt ? synchronizationAge(input.now, input.lastSynchronizedAt) : null;
        return { text: age ? `${label} · ${age}的資料` : label, icon: input.state === "offline" ? "cloud_off" : "sync_problem",
            tone: input.state === "offline" ? "attention" : "error", firstLoad: false, retry: true };
    }
    if (input.state === "incomplete")
        return { text: input.incompleteDisclosure, icon: input.lastSynchronizedAt ? "cloud_done" : "cloud_sync", tone: "normal", firstLoad: false, retry: false };
    if (input.message)
        return { text: input.message, icon: input.lastSynchronizedAt ? "cloud_done" : "cloud_sync", tone: "normal", firstLoad: false, retry: false };
    if (!input.lastSynchronizedAt)
        return { text: "尚未同步", icon: "cloud_sync", tone: "normal", firstLoad: false, retry: false };
    const time = new Intl.DateTimeFormat("en-GB", { timeZone: input.timeZone || "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false })
        .format(new Date(input.lastSynchronizedAt));
    return { text: `已同步 ${time}`, icon: "cloud_done", tone: "normal", firstLoad: false, retry: false };
}
function synchronizationAge(now, lastSynchronizedAt) {
    const elapsed = Date.parse(now) - Date.parse(lastSynchronizedAt);
    if (!Number.isFinite(elapsed) || elapsed < 0)
        return null;
    const minutes = Math.floor(elapsed / 60_000);
    if (minutes < 1)
        return "剛才";
    if (minutes < 60)
        return `${minutes} 分鐘前`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24)
        return `${hours} 小時前`;
    return `${Math.floor(hours / 24)} 天前`;
}
export function coverageDisclosure(complete, coverageComplete, history) {
    if (complete)
        return null;
    if (history) {
        const notice = incompleteHistoryNotice(history.coverage, history.earliest, history.currentMonth);
        if (notice)
            return notice;
    }
    const notice = coverageComplete ? "紀錄有缺漏，總額不完整" : "較早的紀錄可能尚未載入，總額不完整";
    return history?.coverage.missing.includes("scope-rebuild") ? `重建中：${notice}` : notice;
}
export function missingFxDisclosure(unconverted) {
    const amounts = unconverted.map(item => ({ ...item, amount: item.expenseMinor + item.refundMinor }))
        .filter(item => item.amount > 0)
        .map(item => `${item.currency} ${displayAmount(item.amount, item.currency)}`);
    return amounts.length ? `另有 ${amounts.join("、")} 未換算，未計入總額` : null;
}
