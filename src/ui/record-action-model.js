import { amountCorrectionInput } from "./amount-correction-model.js";
import { clampedMonthDate, isCalendarDate, minorToDecimal, NOTES_LIMIT, resolveRecurringSchedule, SUBSCRIPTION_NOTE_LIMIT } from "../core/index.js";
import { enteredMinor, refundableMinor, refundLinkInput, splitDraftState } from "../application/record-actions.js";
import { recordDate } from "./ledger-format.js";
import { recurringAnchorDate } from "./record-sheet-model.js";
export function recordActionDraft(record, records, today, zone, operationId, summary) {
    const rule = record.recurring?.rule ?? summary?.rule, terms = rule?.revisions?.at(-1) ?? rule, end = terms?.end;
    return { operationId, planId: operationId, commandAt: null, categoryId: record.categoryId, notes: record.notes ?? "",
        paymentMethodId: record.paymentMethod.id ?? record.paymentMethod.bankId ?? null,
        lines: record.split?.map(line => ({ id: line.id, amount: minorToDecimal(line.amountMinor, record.currency), categoryId: line.categoryId, note: line.note ?? "" })) ?? [
            { id: "line-1", amount: minorToDecimal(record.amountMinor, record.currency), categoryId: record.categoryId, note: "" },
            { id: "line-2", amount: "", categoryId: null, note: "" }
        ], picking: record.split ? null : 1,
        amount: minorToDecimal(refundableMinor(record, records), record.currency), date: today, purchaseId: null, originalAmount: "",
        count: 6, firstOn: recordDate(record, zone), fee: "", projectId: record.projectId,
        subscription: record.subscription !== null, subscriptionNote: record.subscription?.note ?? "", twd: "",
        cadence: terms?.cadence ?? "monthly", endKind: end ? "on" in end ? "date" : "count" : "none",
        endOn: end && "on" in end ? end.on : recurringAnchorDate(record, zone), endCount: end && "count" in end ? end.count : 12,
        effectiveOn: (record.recurring?.next ?? summary?.next)?.on ?? today,
        recurAmount: minorToDecimal(summary?.amountMinor ?? (terms && "amountMinor" in terms ? terms.amountMinor : record.amountMinor), record.currency),
        occurrenceAmount: minorToDecimal(record.amountMinor, record.currency) };
}
export function recurringDateLimit(anchorOn) { return clampedMonthDate(Math.min(9999, Number(anchorOn.slice(0, 4)) + 50), Number(anchorOn.slice(5, 7)), Number(anchorOn.slice(8))); }
export function recurringEndInput(draft) {
    return draft.endKind === "date" ? { on: draft.endOn } : draft.endKind === "count" ? { count: draft.endCount } : undefined;
}
function recurringDraftValid(draft, record, zone) {
    const anchorOn = recurringAnchorDate(record, zone);
    return ["monthly", "yearly"].includes(draft.cadence) && ["none", "date", "count"].includes(draft.endKind) &&
        (draft.endKind !== "date" || isCalendarDate(draft.endOn) && draft.endOn >= anchorOn && draft.endOn <= recurringDateLimit(anchorOn)) &&
        (draft.endKind !== "count" || Number.isInteger(draft.endCount) && draft.endCount >= 1 && draft.endCount <= 1200);
}
export function newRecurringPreview(draft, record, zone) {
    if (!recurringDraftValid(draft, record, zone))
        return null;
    const anchorOn = recurringAnchorDate(record, zone), end = recurringEndInput(draft);
    try {
        return resolveRecurringSchedule({ rule: { operationId: draft.operationId, cadence: draft.cadence, ...(end ? { end } : {}) },
            anchorOn, amountMinor: record.amountMinor, horizon: recurringDateLimit(anchorOn) }).occurrences.slice(0, 3);
    }
    catch {
        return null;
    }
}
export function recurringRevisionInput(draft, record, asOf, zone) {
    const amountMinor = enteredMinor(draft.recurAmount, record.currency), anchorOn = recurringAnchorDate(record, zone), end = recurringEndInput(draft);
    if (!recurringDraftValid(draft, record, zone) || amountMinor === null || amountMinor <= 0 || !isCalendarDate(draft.effectiveOn) ||
        draft.effectiveOn <= anchorOn || draft.effectiveOn > recurringDateLimit(anchorOn))
        return null;
    return { effectiveOn: draft.effectiveOn, cadence: draft.cadence, amountMinor, ...(end ? { end } : {}), asOf };
}
export function recurringOccurrenceAmount(record) {
    const rule = record.recurring?.rule ?? record.details?.recurring;
    const terms = rule?.revisions?.filter(item => item.effectiveOn <= (record.recurrence?.on ?? "")).at(-1);
    return terms?.amountMinor ?? record.details?.correction?.amountMinor ?? record.source.amountMinor;
}
export function monthlyPlanInput(draft, record) {
    const fee = enteredMinor(draft.fee || "0", record.currency);
    if (fee === null || fee < 0)
        return null;
    return { planId: draft.planId, count: draft.count, firstOn: draft.firstOn,
        ...(fee ? { fees: [{ id: "fee-1", on: draft.firstOn, amountMinor: fee, label: "手續費" }] } : {}) };
}
export function canSaveRecordAction(action, draft, record, records, preview, recurringPreview = null, zone = "UTC") {
    switch (action) {
        case "amount": return amountCorrectionInput(record, draft) !== null;
        case "date": return isCalendarDate(draft.date);
        case "recat": return draft.categoryId !== null;
        case "note": return [...draft.notes.trim()].length <= NOTES_LIMIT;
        case "method": return draft.paymentMethodId !== null;
        case "split": return splitDraftState(record, draft.lines).split !== null;
        case "refund": {
            const amount = enteredMinor(draft.amount, record.currency);
            return !record.installment && amount !== null && amount > 0 && amount <= refundableMinor(record, records) && draft.date.length === 10;
        }
        case "link": return refundLinkInput(record, records, draft.purchaseId, draft.originalAmount) !== null;
        case "inst": return preview !== null;
        case "proj": return [...draft.subscriptionNote.trim()].length <= SUBSCRIPTION_NOTE_LIMIT;
        case "fx": return false;
        case "recur": return record.recurring || record.recurrence ? recurringPreview !== null && recurringRevisionInput(draft, record, draft.effectiveOn, zone) !== null : newRecurringPreview(draft, record, zone) !== null;
        case "occurrence-amount": return record.recurrence !== null && (enteredMinor(draft.occurrenceAmount, record.currency) ?? 0) > 0;
        case "occurrence-skip": return record.recurrence !== null;
    }
}
