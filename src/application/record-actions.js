import { decimalToMinor, minorToDecimal, validateRecordSplit } from "../core/index.js";
export function enteredMinor(value, currency) {
    try {
        return decimalToMinor(value.trim().replaceAll(",", ""), currency);
    }
    catch {
        return null;
    }
}
/** Editor conservation is checked in the application; the persisted split is validated again by Core. */
export function splitDraftState(record, lines) {
    const amounts = lines.map(line => enteredMinor(line.amount, record.currency));
    const sum = amounts.reduce((sum, amount) => sum + BigInt(Math.max(0, amount ?? 0)), 0n);
    const overflow = sum > BigInt(Number.MAX_SAFE_INTEGER) || sum < BigInt(Number.MIN_SAFE_INTEGER);
    const sumMinor = overflow ? 0 : Number(sum);
    let split = null;
    try {
        split = validateRecordSplit({ currency: record.currency, totalMinor: record.amountMinor,
            lines: lines.map((line, i) => ({ id: line.id, amountMinor: amounts[i], categoryId: line.categoryId, ...(line.note.trim() ? { note: line.note.trim() } : {}) })) });
    }
    catch { /* An incomplete editor remains a draft. */ }
    const remainingMinor = overflow ? 0 : record.amountMinor - sumMinor;
    return { sumMinor, remainingMinor, remainingInput: minorToDecimal(Math.max(0, remainingMinor), record.currency), split, overflow };
}
export function refundableMinor(record, records) {
    return Math.max(0, record.amountMinor - records.filter(item => !item.voided && item.refundOf === record.id)
        .reduce((sum, item) => sum + (item.refundAllocation?.originalMinor ?? (item.currency === record.currency ? item.amountMinor : 0)), 0));
}
/** General corrections defer to split, installment and recurring revision paths. */
export function recordCorrectionAvailability(record, records) {
    if (record.voided || record.id !== record.source.id || record.recurring || record.details?.recurring || record.recurrence ||
        record.installment || record.details?.installmentPlan || record.evidenceOf)
        return { amount: false, date: false };
    let amount = !record.split && !record.details?.split && !record.details?.refundAllocation;
    const purchaseId = record.details?.refundOf ?? record.refundOf;
    const purchase = purchaseId ? records.find(item => item.id === purchaseId) : record;
    if (!purchase || purchase.voided || purchase.kind !== "expense" || purchase.recurring || purchase.details?.recurring) {
        return purchaseId ? { amount: false, date: false } : { amount, date: true };
    }
    if (purchaseId && purchase.currency !== record.currency)
        amount = false;
    // The edited refund replaces its own credit; only other refunds consume its available capacity.
    let refunded = 0;
    for (const refund of records) {
        if (refund.voided || (refund.details?.refundOf ?? refund.refundOf) !== purchase.id || purchaseId && refund.id === record.id)
            continue;
        const allocation = refund.details?.refundAllocation ?? refund.refundAllocation;
        if (allocation ? allocation.currency !== purchase.currency || refund.currency === purchase.currency && allocation.originalMinor !== refund.amountMinor
            : refund.currency !== purchase.currency) {
            amount = false;
            break;
        }
        refunded += allocation?.originalMinor ?? refund.amountMinor;
        if (!Number.isSafeInteger(refunded)) {
            amount = false;
            break;
        }
    }
    // There must be a positive, safe, different amount, rather than only the current no-op value.
    if (purchaseId ? purchase.amountMinor - refunded < 1 || purchase.amountMinor - refunded === 1 && record.amountMinor === 1
        : refunded === Number.MAX_SAFE_INTEGER && record.amountMinor === Number.MAX_SAFE_INTEGER)
        amount = false;
    return { amount, date: true };
}
/** Same exact decimal parser as the other record editors, restricted to positive money. */
export function recordCorrectionAmount(record, value) {
    const amount = enteredMinor(value, record.currency);
    return amount !== null && amount > 0 ? amount : null;
}
/** Insufficient same-currency purchases remain visible but disabled, as in the reference picker. */
export function refundCandidates(refund, records) {
    return records.filter(item => item.kind === "expense" && !item.voided && item.recurring === null && item.recurrence === null && !item.installment && !item.evidenceOf &&
        refundableMinor(item, records) > 0);
}
export function refundCandidateEnabled(refund, purchase, records) {
    return purchase.currency !== refund.currency || refundableMinor(purchase, records) >= refund.amountMinor;
}
/** Parse an explicit original-cost allocation in the purchase currency; no conversion is inferred. */
export function refundLinkInput(refund, records, purchaseId, originalAmount) {
    const purchase = refundCandidates(refund, records).find(item => item.id === purchaseId);
    if (!purchase || !refundCandidateEnabled(refund, purchase, records))
        return null;
    if (purchase.currency === refund.currency)
        return { purchaseId: purchase.id, originalMinor: null };
    const originalMinor = enteredMinor(originalAmount, purchase.currency);
    return originalMinor !== null && originalMinor > 0 && originalMinor <= refundableMinor(purchase, records)
        ? { purchaseId: purchase.id, originalMinor } : null;
}
export function merchantRuleCount(record, records) {
    return records.filter(item => (item.merchant === record.merchant || !!record.brand?.id && item.brand?.id === record.brand.id) && !item.voided && !item.split &&
        !["detail", "exception", "refund-link"].includes(item.categorySource)).length;
}
export function installmentEditorPreview(plan) {
    return { totalMinor: plan.totalMinor + (plan.fees?.reduce((sum, fee) => sum + fee.amountMinor, 0) ?? 0),
        periods: plan.periods.map(period => ({ ...period, amountMinor: period.amountMinor + (plan.fees?.filter(fee => fee.on === period.on).reduce((sum, fee) => sum + fee.amountMinor, 0) ?? 0) })) };
}
