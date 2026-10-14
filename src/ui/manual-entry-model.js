import { CURRENCIES, convertToTwd, decimalToMinor, isCalendarDate, currencyScale, minorToDecimal } from "../core/index.js";
import { isReferenceQuote } from "../application/reference-quote.js";
import { dateAt } from "./ledger-format.js";
import { enteredMinor } from "../application/record-actions.js";
import { actualTwdMinor } from "./amount-correction-model.js";
export function blankManualDraft(operationId, today, picker, defaults) {
    return { operationId, amount: "", currency: defaults.currency, categoryId: null, paymentMethodId: picker.defaultId,
        date: today, notes: "", projectId: defaults.projectId };
}
export function unrecordedManualDraft(operationId, item, timeZone, defaults, picker) {
    const amount = item.notification.readableAmount;
    return { operationId, amount: amount ? minorToDecimal(amount.amountMinor, amount.currency).replace(/\.00$/u, "") : "", currency: amount?.currency ?? defaults.currency,
        date: dateAt(item.notification.capturedAt, timeZone), paymentMethodId: item.notification.bankId && picker.methods.some(method => method.id === item.notification.bankId) ? item.notification.bankId : "",
        categoryId: null, notes: "", projectId: defaults.projectId,
        notification: { id: item.id, ...(item.merchant ? { merchant: item.merchant } : {}), source: item.source, meta: item.sourceMeta } };
}
export function shouldReplaceManualDraft(draft, blank, locked = false) {
    return !!draft && (locked || !!draft.notification || !!draft.amount || !!draft.categoryId || !!draft.notes || !!draft.actualTwdAmount ||
        draft.date !== blank.date || draft.currency !== blank.currency || draft.paymentMethodId !== blank.paymentMethodId || draft.projectId !== blank.projectId);
}
export function manualDateLabel(date, today) {
    const [year, month, day] = date.split("-");
    const short = `${Number(month)}/${Number(day)}`;
    return date.slice(0, 4) === today.slice(0, 4) ? short : `${year}/${short}`;
}
export function keypadAmount(current, key, currency, scale = currency === "TWD" ? 0 : currencyScale(currency)) {
    const fractionScale = currency === "TWD" ? 0 : scale;
    if (key === "delete")
        return current.slice(0, -1);
    if (key === ".")
        return fractionScale && !current.includes(".") ? `${current || "0"}.` : current;
    if (!/^\d$/u.test(key) || current.replace(".", "").length >= 9 || current.includes(".") && current.split(".")[1].length >= fractionScale)
        return current;
    return current === "0" ? key : current + key;
}
export function trimManualAmount(amount, currency) {
    const scale = currencyScale(currency), [whole, fraction] = amount.split(".");
    return scale === 0 || fraction === undefined ? whole : `${whole}.${fraction.slice(0, scale)}`;
}
export function manualCommand(draft) {
    const amountMinor = decimalToMinor(draft.amount.replace(/\.$/u, "") || "0", draft.currency);
    const valuation = draft.currency === "TWD" ? {} : draft.actualTwdAmount?.trim()
        ? { actualTwdMinor: decimalToMinor(draft.actualTwdAmount.trim().replace(/\.$/u, ""), "TWD") } : draft.quote ? { quote: draft.quote } : {};
    return { input: { kind: "expense", amountMinor, currency: draft.currency, occurredOn: draft.date, ...(draft.paymentMethodId ? { paymentMethodId: draft.paymentMethodId } : {}),
            ...(draft.notification?.merchant ? { merchant: draft.notification.merchant } : {}), ...valuation },
        details: { ...(draft.categoryId ? { categoryId: draft.categoryId } : {}), ...(draft.notes ? { notes: draft.notes } : {}), ...(draft.projectId ? { projectId: draft.projectId } : {}) } };
}
export function manualTwdPreview(draft) {
    if (draft.currency === "TWD")
        return null;
    if (draft.actualTwdAmount !== undefined)
        return actualTwdMinor(draft.actualTwdAmount);
    const amount = enteredMinor(draft.amount.replace(/\.$/u, "") || "0", draft.currency);
    if (!draft.quote || amount === null)
        return null;
    try {
        return convertToTwd(amount, draft.currency, draft.quote.rate);
    }
    catch {
        return null;
    }
}
export function canSaveManualDraft(draft) {
    const amount = enteredMinor(draft.amount.replace(/\.$/u, ""), draft.currency);
    return !!draft.paymentMethodId && amount !== null && amount > 0 && (draft.currency === "TWD" || draft.actualTwdAmount === undefined || (actualTwdMinor(draft.actualTwdAmount) ?? 0) > 0);
}
/** Only the credential-free, current manual draft shape is admitted on reopen. */
export function restoreManualDraft(value) {
    if (!value || typeof value !== "object" || !("draft" in value))
        return null;
    const packet = value, d = packet.draft;
    if (!d || typeof d !== "object")
        return null;
    const draft = d;
    if (typeof draft.operationId !== "string" || typeof draft.amount !== "string" || !/^(?:\d{1,9}(?:\.\d{0,3})?)?$/u.test(draft.amount) ||
        typeof draft.currency !== "string" || !Object.hasOwn(CURRENCIES, draft.currency) || typeof draft.date !== "string" || !isCalendarDate(draft.date) ||
        typeof draft.paymentMethodId !== "string" || typeof draft.notes !== "string" ||
        !(draft.categoryId === null || typeof draft.categoryId === "string") || !(draft.projectId === null || typeof draft.projectId === "string"))
        return null;
    const currency = draft.currency;
    if ((draft.amount.split(".")[1]?.length ?? 0) > currencyScale(currency))
        return null;
    if (draft.quote !== undefined && !isReferenceQuote(draft.quote, currency, draft.date))
        return null;
    if (draft.actualTwdAmount !== undefined && (typeof draft.actualTwdAmount !== "string" ||
        !/^(?:\d{1,9}(?:\.\d{0,2})?)?$/u.test(draft.actualTwdAmount)))
        return null;
    const n = draft.notification;
    if (n !== undefined && (!n || typeof n !== "object" || !("id" in n) || typeof n.id !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(n.id) ||
        !("source" in n) || typeof n.source !== "string" || !("meta" in n) || typeof n.meta !== "string" ||
        "merchant" in n && (typeof n.merchant !== "string" || [...n.merchant].length > 80)))
        return null;
    const notification = n;
    return { draft: { operationId: draft.operationId, amount: draft.amount, currency, date: draft.date,
            paymentMethodId: draft.paymentMethodId, notes: draft.notes, categoryId: draft.categoryId, projectId: draft.projectId,
            ...(draft.quote ? { quote: { ...draft.quote } } : {}),
            ...(typeof draft.actualTwdAmount === "string" ? { actualTwdAmount: draft.actualTwdAmount } : {}),
            ...(notification ? { notification: { id: notification.id, source: notification.source, meta: notification.meta, ...(notification.merchant ? { merchant: notification.merchant } : {}) } } : {}) },
        locked: packet.locked === true, now: typeof packet.now === "string" ? packet.now : null, retry: packet.retry ?? null };
}
