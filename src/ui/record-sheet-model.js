import { effectivePaymentMethod, localDateOf } from "../core/index.js";
import { displayAmount } from "./ledger-format.js";
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
/** The history entry point describes the retained source and its current correction. */
export function paymentMethodRevision(record, result) {
    if (!record.details?.paymentMethodId)
        return null;
    const source = effectivePaymentMethod(record.source);
    if (source.key === record.paymentMethod.key)
        return null;
    return `付款方式：${recordPaymentMethodName(source, result)} → ${recordPaymentMethodName(record.paymentMethod, result)}`;
}
export function recordActionItems(record) {
    const items = [];
    if (record.recurrence !== null)
        return [
            { icon: "sell", label: "分類", action: "recat" }, { icon: "edit_note", label: "備註", action: "note" },
            { icon: "credit_card", label: "付款方式", action: "method" }, { icon: "luggage", label: "專案", action: "proj" },
            { icon: "edit", label: "這次金額", action: "occurrence-amount" }, { icon: "do_not_disturb_on", label: "跳過這次", action: "occurrence-skip" },
            { icon: "event_repeat", label: "定期", action: "recur" },
        ];
    if (!record.split && record.kind !== "refund")
        items.push({ icon: "sell", label: "分類", action: "recat" });
    items.push({ icon: "edit_note", label: "備註", action: "note" });
    items.push({ icon: "credit_card", label: "付款方式", action: "method" });
    if (record.kind !== "refund" && !record.installment && record.reportingValue && !record.evidenceOf)
        items.push({ icon: "call_split", label: record.split ? "編輯拆帳" : "拆帳", action: "split" });
    if (record.kind !== "refund" && record.reportingValue && !record.evidenceOf)
        items.push({ icon: "undo", label: "退款", action: "refund" });
    if (record.kind !== "refund" && !record.installment && !record.split && record.reportingValue && !record.evidenceOf)
        items.push({ icon: "event_repeat", label: "分期", action: "inst" });
    if (record.recurring !== null || record.source.source === "manual" && record.kind === "expense" && !record.installment && !record.split &&
        !record.refundOf && record.reportingValue && !record.evidenceOf && !record.voided && record.paymentMethod.key.startsWith("method:")) {
        items.push({ icon: "event_repeat", label: "定期", action: "recur" });
    }
    items.push({ icon: "luggage", label: "專案", action: "proj" });
    if (record.kind === "refund" && !record.refundOf)
        items.push({ icon: "link", label: "連結", action: "link" });
    if (!record.reportingValue)
        items.push({ icon: "currency_exchange", label: "換算", action: "fx" });
    return items;
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
    return "銀行通知金額";
}
export function recordMoney(record) {
    return { amount: record.reportingValue ? displayAmount(record.reportingValue.amountMinor) : "未換算", currency: record.reportingValue ? "TWD" : "",
        original: record.currency === "TWD" ? null : `原始 ${record.currency} ${displayAmount(record.amountMinor, record.currency)}` };
}
