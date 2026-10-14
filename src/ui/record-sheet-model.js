import { currencyScale, effectivePaymentMethod, localDateOf, sourceTwdValue } from "../core/index.js";
import { recordCorrectionAvailability } from "../application/record-actions.js";
import { dayLabel, displayAmount, timeLabel } from "./ledger-format.js";
import { recordPaymentMethodName } from "./payment-method-name.js";
import { screenDateFormatter } from "./screen-date-format.js";
export function recurringAnchorDate(record, zone) {
    const correction = record.details?.correction;
    return correction?.occurredOn ?? (correction?.occurredAt ? localDateOf(correction.occurredAt, zone)
        : record.source.occurredOn ?? localDateOf(record.source.occurredAt, zone));
}
export function recurringRuleLine(record, result) {
    const summary = result.recurringRules.find(item => item.anchorId === (record.recurrence?.anchorId ?? record.id));
    const recurring = record.recurring ?? summary;
    if (!recurring)
        return "";
    const cadence = recurring.rule.revisions?.at(-1)?.cadence ?? recurring.rule.cadence, on = recurringAnchorDate(record, result.timeZone);
    const schedule = cadence === "monthly" ? `每月 ${Number(on.slice(8))} 日` : `每年 ${Number(on.slice(5, 7))}/${Number(on.slice(8))}`;
    const next = recurring.next;
    return `定期 · ${schedule}${next ? ` · 下次 ${screenDateFormatter(result.asOf, [next.on]).date(next.on)}` : recurring.ended ? " · 已結束" : ""}`;
}
export function recurringRowValue(record, result) {
    const summary = result.recurringRules.find(item => item.anchorId === (record.recurrence?.anchorId ?? record.id));
    const recurring = record.recurring ?? summary;
    if (!recurring)
        return "";
    const schedule = recurringRuleLine(record, result).split(" · ")[1] ?? "";
    const amountMinor = summary?.amountMinor ?? recurring.rule.revisions?.at(-1)?.amountMinor ?? record.amountMinor;
    return `${schedule} · ${displayAmount(amountMinor, record.currency)}${recurring.ended ? " · 已結束" : ""}`;
}
/** The history entry point describes the retained source and its current correction. */
export function paymentMethodRevision(record, result) {
    if (!record.details?.paymentMethodId)
        return null;
    const source = effectivePaymentMethod(record.source);
    if (source.key === record.paymentMethod.key)
        return null;
    return `付款方式：${recordPaymentMethodName(source, result)} → ${recordPaymentMethodName(record.paymentMethod, result)}`;
}
/** One ordered label/icon list for both record presentations. */
const RECORD_ACTIONS = [
    { icon: "sell", label: "分類", action: "recat", placement: "row" },
    { icon: "edit_note", label: "備註", action: "note", placement: "row" },
    { icon: "credit_card", label: "付款方式", action: "method", placement: "row" },
    { icon: "payments", label: "金額", action: "amount", placement: "row" },
    { icon: "currency_exchange", label: "匯率", action: "fx", placement: "row" },
    { icon: "event", label: "日期", action: "date", placement: "row" },
    { icon: "autorenew", label: "定期", action: "recur", placement: "row" },
    { icon: "luggage", label: "專案", action: "proj", placement: "row" },
    { icon: "call_split", label: "拆帳", action: "split", placement: "chip" },
    { icon: "undo", label: "退款", action: "refund", placement: "chip" },
    { icon: "event_repeat", label: "分期", action: "inst", placement: "chip" },
    { icon: "link", label: "連結", ariaLabel: "連結原始消費", action: "link", placement: "chip" },
    { icon: "payments", label: "這次金額", action: "occurrence-amount", placement: "chip" },
    { icon: "do_not_disturb_on", label: "跳過這次", action: "occurrence-skip", placement: "chip" },
    { icon: "block", label: "作廢", action: "void", placement: "chip" },
];
export function recordActionItems(record, records = [record]) {
    const correction = recordCorrectionAvailability(record, records);
    const occurrence = record.recurrence !== null;
    const purchase = record.kind !== "refund" && !!record.reportingValue && !record.evidenceOf;
    const recurring = record.paymentMethod.key.startsWith("method:") && (record.recurring !== null || occurrence || record.source.source === "manual" && purchase && !record.installment && !record.split &&
        !record.refundOf && !record.voided);
    return RECORD_ACTIONS.filter((item) => {
        switch (item.action) {
            case "void": return false;
            case "recat": return !record.split;
            case "amount": return correction.amount;
            case "date": return correction.date;
            case "split": return !occurrence && purchase && !record.installment;
            case "refund": return !occurrence && purchase;
            case "inst": return !occurrence && purchase && !record.installment && !record.split;
            case "recur": return !!recurring;
            case "link": return !occurrence && record.kind === "refund" && !record.refundOf;
            case "occurrence-amount":
            case "occurrence-skip": return occurrence;
            case "fx": return !occurrence && !record.split && record.currency !== "TWD";
            default: return true;
        }
    }).map(item => item.action === "split" && record.split ? { ...item, label: "編輯拆帳" } : item);
}
export function recordFieldItems(record, records = [record]) {
    return recordActionItems(record, records).filter(item => item.placement === "row");
}
export function recordChipItems(record, records = [record], includeVoid = false) {
    return [...recordActionItems(record, records).filter(item => item.placement === "chip"),
        ...(includeVoid && !record.recurrence ? [RECORD_ACTIONS.find(item => item.action === "void")] : [])];
}
export function classificationSource(record) {
    if (record.split || ["detail", "exception"].includes(record.categorySource))
        return { icon: "person", text: "本筆指定" };
    if (record.categorySource === "ai")
        return { icon: "auto_awesome", text: "AI 建議" };
    if (record.categorySource === "refund-link")
        return { icon: "link", text: "依原始消費" };
    return record.categoryId ? { icon: "rule", text: "我的規則" } : { icon: "question_mark", text: "未分類" };
}
export function valuationLabel(record, formatDate) {
    if (!record.reportingValue || record.currency === "TWD")
        return null;
    const value = record.valuation;
    if (value?.basis === "reference-rate")
        return `參考匯率 ${value.rate}（${formatDate(value.effectiveOn)}）`;
    if (value?.basis === "actual")
        return "實際台幣金額";
    if (record.reportingValue.basis === "stated-approximate")
        return "銀行通知 約";
    return "銀行通知金額";
}
export function exchangeRateRow(record) {
    if (record.currency === "TWD")
        return null;
    if (!record.reportingValue)
        return { kind: "unconverted" };
    const value = record.valuation;
    if (value?.basis === "reference-rate") {
        return referenceRateRow(value);
    }
    const stated = sourceTwdValue(record.source, record.currency);
    const pair = value?.basis === "actual" ? value.origin ?? value : { amountMinor: record.amountMinor, twdMinor: stated.amountMinor };
    const source = value?.basis === "actual" ? value.origin?.source : stated?.basis === "approximate" ? "stated-approximate" : "stated-actual";
    return pairRateRow(record.currency, pair.amountMinor, pair.twdMinor, source === "stated-approximate" ? "銀行通知 約" : source === "stated-actual" ? "銀行通知" : "自填");
}
export function referenceRateRow(value) {
    const [whole, fraction = ""] = value.rate.split(".");
    return { kind: "rate", rate: displayRate(BigInt(`${whole}${fraction}`), 10n ** BigInt(fraction.length)), source: "參考", on: value.effectiveOn };
}
export function pairRateRow(currency, amountMinor, twdMinor, source) {
    return { kind: "rate", rate: displayRate(BigInt(twdMinor) * 10n ** BigInt(currencyScale(currency)), BigInt(amountMinor) * 10n ** BigInt(currencyScale("TWD"))), source };
}
export function exchangeRateText(row, formatDate) {
    return !row || row.kind === "unconverted" ? "未換算" : `${row.rate} · ${row.source}${row.on ? ` ${formatDate(row.on)}` : ""}`;
}
/** Half-up directly from the exact pair or stored decimal, without intermediate rounding. */
function displayRate(numerator, denominator) {
    const scale = 10000n;
    const rounded = (2n * numerator * scale + denominator) / (2n * denominator);
    return `${rounded / scale}.${(rounded % scale).toString().padStart(4, "0")}`;
}
export function recordMoney(record) {
    return { amount: record.reportingValue ? displayAmount(record.reportingValue.amountMinor) : displayAmount(record.amountMinor, record.currency), currency: record.reportingValue ? "TWD" : record.currency,
        approximate: record.reportingValue?.basis === "stated-approximate",
        original: record.currency === "TWD" || !record.reportingValue ? null : `原始 ${record.currency} ${displayAmount(record.amountMinor, record.currency)}` };
}
export function capturedRecordMeta(record, result) {
    const source = record.source, on = record.recurrence?.on ?? source.occurredOn ?? localDateOf(source.occurredAt, result.timeZone);
    const captured = { ...record, occurrence: source.occurredOn ? { precision: "date", on } : { precision: "instant", at: source.occurredAt } };
    const time = timeLabel(captured, result.timeZone), method = effectivePaymentMethod(source);
    const name = result.billingCycleSpending.groups.find(item => item.key === method.key)?.label;
    const capturedMethod = method.key === "method:cash" ? { ...method, label: "現金" } : name && !method.bankId ? { ...method, label: name } : method;
    return [record.kind === "refund" ? "退款" : null, `${dayLabel(on, result.asOf)}${time ? ` ${time}` : ""}`,
        recordPaymentMethodName(capturedMethod, result), !record.reportingValue ? "未換算" : null,
        record.recurrence || record.recurring ? "定期" : null].filter(Boolean).join(" · ");
}
