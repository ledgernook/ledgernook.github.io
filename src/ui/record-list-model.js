import { isRecordAiPending } from "../core/index.js";
import { newestViewerRecords } from "../application/viewer-query.js";
import { categoryPresentation } from "./category-presentation.js";
import { displayAmount, recordDate, timeLabel } from "./ledger-format.js";
import { recordPaymentMethodName } from "./payment-method-name.js";
import { syncRecoveryCopy } from "./sync-recovery-copy.js";
/** Expenses precede refunds; each kind uses descending amounts, with missing FX last. */
export function compareReportingAmounts(left, right, leftKind = "expense", rightKind = "expense") {
    if (left === null)
        return right === null ? 0 : 1;
    if (right === null)
        return -1;
    if (leftKind !== rightKind)
        return leftKind === "refund" ? 1 : -1;
    return Math.abs(right) - Math.abs(left);
}
export function compareRecordRows(left, right, sort) {
    const amount = sort === "amount" ? compareReportingAmounts(left.reportingAmountMinor, right.reportingAmountMinor, left.record.kind, right.record.kind) : 0;
    if (amount)
        return amount;
    const date = right.date.localeCompare(left.date);
    if (date)
        return date;
    const a = left.record.occurrence, b = right.record.occurrence;
    if (a.precision !== b.precision)
        return a.precision === "instant" ? -1 : 1;
    if (a.precision === "instant" && b.precision === "instant" && a.at !== b.at)
        return a.at > b.at ? -1 : 1;
    return left.record.id.localeCompare(right.record.id);
}
export function sortRecordRows(rows, sort) {
    return [...rows].sort((left, right) => compareRecordRows(left, right, sort));
}
/** Order the full result before formatting/slicing a visible page. Amount ties retain date/id order. */
export function sortViewerRecords(records, timeZone, sort) {
    const dated = newestViewerRecords(records, timeZone);
    return sort === "date" ? dated : [...dated].sort((left, right) => compareReportingAmounts(left.reportingValue?.amountMinor ?? null, right.reportingValue?.amountMinor ?? null, left.kind, right.kind));
}
export function isAutomaticCaptureRecord(record) {
    return record.origin === "bank" && record.occurrence.precision === "instant" &&
        (record.occurrence.provenance === "capture" || record.occurrence.provenance === "notification");
}
export function recordRow(record, result, writable, options = {}) {
    const first = record.split?.[0];
    const category = categoryPresentation(result.categories, first?.mainCategoryId ?? record.categoryId);
    const title = record.merchant ?? record.notes ?? category.label;
    const purpose = record.merchant == null && record.notes == null ? null
        : record.split ? options.noCategory ? "拆帳" : `拆帳 · ${record.split.map(line => categoryPresentation(result.categories, line.mainCategoryId).label).join("、")}` : options.noCategory ? null : category.label;
    const project = result.projects.find(item => item.id === record.projectId)?.label;
    const minor = record.reportingValue?.amountMinor ?? record.amountMinor;
    const time = timeLabel(record, result.timeZone);
    const method = options.noMethod || (!record.paymentMethod.label && !record.paymentMethod.bankId && record.paymentMethod.key !== "method:cash")
        ? null : recordPaymentMethodName(record.paymentMethod, result);
    const secondary = record.reportingValue && record.currency !== "TWD"
        ? `${record.currency} ${displayAmount(record.amountMinor, record.currency)}` : time;
    const recovery = result.localChanges?.recoveryTargets?.find(target => target.kind === "record" && target.objectId === record.id);
    const row = { record, category: { ...category, icon: record.split ? "call_split" : record.kind === "refund" ? "undo" : category.icon },
        title,
        subline: [record.kind === "refund" ? "退款" : null, purpose, method, options.noProject ? null : project, record.subscription ? "訂閱" : null].filter(Boolean).join(" · "),
        amount: `${record.kind === "refund" ? "+" : ""}${record.reportingValue ? "" : record.currency === "TWD" ? "" : `${record.currency} `}${displayAmount(minor, record.reportingValue ? "TWD" : record.currency)}`,
        reportingAmountMinor: record.reportingValue?.amountMinor ?? null,
        date: recordDate(record, result.timeZone), time, secondary, syncState: result.localChanges?.records[record.id],
        ...(result.localChanges?.records[record.id] === "failed" ? { recoveryCopy: syncRecoveryCopy(recovery ?? { noticeKind: "record-edit" }) } : {}),
        quick: writable && result.localChanges?.records[record.id] !== "failed" && !record.voided && !record.split && record.kind !== "refund",
        fresh: options.fresh === true, aiPending: isRecordAiPending(record) };
    if (record.voided)
        return { ...row, badge: "已作廢", badgeIcon: "block" };
    if (record.recurrence !== null)
        return { ...row, badge: "定期", badgeIcon: "event_repeat" };
    if (record.kind === "refund" && !record.refundOf)
        return { ...row, badge: "待連結退款", badgeIcon: "link_off" };
    if (record.installment)
        return { ...row, badge: "分期計畫", badgeIcon: "event_repeat" };
    return record.currency !== "TWD" && record.reportingValue === null ? { ...row, badge: "未換算", badgeIcon: "currency_exchange" } : row;
}
/** Display order only: report totals and recognition entries remain untouched. */
export function recentRows(result, writable, limit, freshRecordIds = new Set(), options = {}) {
    return newestViewerRecords(result.report.records, result.timeZone).slice(0, limit)
        .map(record => recordRow(record, result, writable, { ...options, fresh: freshRecordIds.has(record.id) }));
}
