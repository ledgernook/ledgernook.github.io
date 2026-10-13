import { entryClassification, eventPath } from "../core/index.js";
import { formatMoney, formatTwd } from "./format.js";
import { shiftDate } from "./ledger-format.js";
export const SOURCE_LABELS = Object.freeze({
    detail: "本筆指定", exception: "例外", split: "本筆拆分", "refund-link": "沿用原購買", user: "我的規則", ai: "AI 建議", none: "未分類",
});
export function localParts(utc, timeZone) {
    const parts = new Intl.DateTimeFormat("en-CA-u-ca-gregory-nu-latn", {
        timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(utc));
    const get = (key) => parts.find(part => part.type === key)?.value ?? "";
    return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}
export function occurrenceParts(record, timeZone) {
    return record.occurrence.precision === "instant" ? localParts(record.occurrence.at, timeZone) : { date: record.occurrence.on, time: "" };
}
export function provenanceLabel(record) {
    if (record.occurrence.precision === "date")
        return "僅日期";
    return record.occurrence.provenance === "capture" ? "記錄時間" : record.occurrence.provenance === "notification" ? "通知時間" : "手動輸入";
}
export function paymentLabel(record, bankName) {
    return record.paymentMethod.label ?? (record.paymentMethod.bankId !== undefined ? bankName(record.paymentMethod.bankId) : "未指定");
}
function cell(value) {
    const safe = /^[=+\-@\t\r]/u.test(value) ? `'${value}` : value;
    return `"${safe.replace(/"/g, '""')}"`;
}
/** Exports the currently visible report and its recognized entries without claiming missing data is zero. */
export function exportViewerCsv(result, bankName, repository) {
    const report = result.report;
    const categoryLabels = new Map(result.categories.map(category => [category.id, category.label]));
    const projectLabels = new Map(result.projects.map(project => [project.id, project.label]));
    const period = report.period;
    const scope = period ? `${period.from}–${period.to}（結束日不含）` : "全部日期";
    const lines = [
        ["計入範圍", report.scope === "daily" ? "日常" : "全部"],
        ["範圍", scope], ["報表時區", result.timeZone], ["覆蓋狀態", report.complete ? "完整" : "不完整"],
        ["缺少範圍", report.coverage.missing.join(" | ") || "無"],
        ["未換算 TWD 筆數", String(report.total.twd.unconvertedCount)],
        ["TWD 已換算部分", formatTwd(report.total.twd.netMinor)],
        ["匯率估算", report.total.twd.estimated ? "包含參考匯率估算" : "無"],
        ["分類篩選", report.filters.categoryId === undefined ? "全部" : report.filters.categoryId ?? "未分類"],
        ["訂閱篩選", report.filters.subscription === undefined ? "全部" : report.filters.subscription ? "只看訂閱" : "不含訂閱"],
        ["專案篩選", report.filters.projectId === undefined ? "全部" : report.filters.projectId ?? "沒有專案"],
        ["使用者規則 revision", result.ruleRevision ?? "無"],
    ].map(row => row.map(cell).join(","));
    lines.push([
        "record id", "record date", "local time", "date provenance", "entry role", "merchant / description", "payment method",
        "kind", "recognition state", "original currency", "original amount", "approximate amount", "period amount", "period TWD", "TWD basis",
        "category", "classification source", "project", "subscription", "refund of", "installment plan / period",
        "detail revision", "valuation revision", "rule revision", "line id", "line note", "GitHub link",
    ].map(cell).join(","));
    const entries = [
        ...report.entries.map(entry => ({ entry, recognition: "已認列" })),
        ...report.futureEntries.map(entry => ({ entry, recognition: "尚未認列" })),
    ];
    for (const { entry, recognition } of entries) {
        const record = entry.record;
        const { date, time } = occurrenceParts(record, result.timeZone);
        const twd = entry.reportingValue === null ? "" : formatTwd(entry.reportingValue.amountMinor);
        const twdBasis = entry.reportingValue === null ? "未換算" : entry.reportingValue.estimated ? "參考匯率估算" : entry.reportingValue.basis;
        const categoryId = entryClassification(entry).categoryId;
        const category = categoryId === null ? "未分類" : categoryLabels.get(categoryId) ?? "未分類";
        const project = record.projectId === null ? "" : projectLabels.get(record.projectId) ?? record.projectId;
        const installment = entry.planId === undefined ? "" : `${entry.role}:${entry.planId}/${entry.periodId ?? entry.feeId ?? ""}`;
        const description = record.merchant ?? record.description ?? "";
        const sourcePath = result.sourcePaths[record.id] ?? eventPath(record.source);
        lines.push([
            record.id, date, time, provenanceLabel(record), entry.role, description, paymentLabel(record, bankName), entry.kind,
            recognition, entry.currency, formatMoney(entry.role === "split-line" ? entry.amountMinor : record.amountMinor, record.currency), record.approximateAmount ? "是" : "否",
            formatMoney(entry.amountMinor, entry.currency), twd, twdBasis,
            category, SOURCE_LABELS[record.categorySource] ?? "未分類", project, record.subscription === null ? "否" : "是",
            record.refundOf ?? "", installment, result.detailRevisions[record.id] ?? "", record.valuation?.operationId ?? "",
            result.ruleRevision ?? "", entry.lineId ?? "", entry.note ?? "",
            repository ? `https://github.com/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/blob/${encodeURIComponent(repository.branch)}/${sourcePath.split("/").map(encodeURIComponent).join("/")}` : "",
        ].map(cell).join(","));
    }
    const inclusiveTo = period ? shiftDate(period.to, -1) : null;
    const fullMonth = period && period.from.endsWith("-01") && inclusiveTo?.slice(0, 7) === period.from.slice(0, 7) && period.to.endsWith("-01");
    const filenamePeriod = period ? fullMonth ? period.from.slice(0, 7) : `${period.from}_${inclusiveTo}` : "all-dates";
    return { filename: `LedgerNook-${filenamePeriod}.csv`, content: `\uFEFF${lines.join("\r\n")}\r\n` };
}
