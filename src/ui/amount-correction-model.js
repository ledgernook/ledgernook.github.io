import { convertToTwd, minorToDecimal, proportionalMinor, sourceTwdValue } from "../core/index.js";
import { enteredMinor } from "../application/record-actions.js";
import { exchangeRateRow, pairRateRow, referenceRateRow } from "./record-sheet-model.js";
export function correctionCurrency(record, draft) { return draft.currency ?? record.currency; }
export function actualTwdMinor(amount) {
    return /^\d+$/u.test(amount) ? enteredMinor(amount, "TWD") : null;
}
export function amountCorrectionInput(record, draft) {
    const currency = correctionCurrency(record, draft), amountMinor = enteredMinor(draft.amount.replace(/\.$/u, ""), currency);
    if (amountMinor === null || amountMinor <= 0)
        return null;
    const twdMinor = actualTwdMinor(draft.twd);
    if (currency !== "TWD" && draft.twdMode === "actual" && (twdMinor === null || twdMinor <= 0))
        return null;
    return { amountMinor, ...(currency !== record.currency ? { currency } : {}),
        ...(currency !== "TWD" ? { twdIntent: draft.twdMode === "actual" ? { kind: "actual", twdMinor: twdMinor }
                : { kind: draft.twdMode ?? "follow" }, ...(draft.quote ? { quote: draft.quote } : {}) } : {}) };
}
/** Mirrors correctRecord's basis selection, preserving exact arithmetic and an unscaled restore. */
export function amountCorrectionPreview(record, draft) {
    const currency = correctionCurrency(record, draft), input = amountCorrectionInput(record, draft);
    if (!input) {
        const stated = sourceTwdValue(record.source, currency);
        if (currency !== "TWD" && draft.twdMode !== "actual" && (draft.twdMode === "restore" || currency !== record.currency)) {
            if (stated)
                return { amountMinor: stated.amountMinor, approximate: stated.basis === "approximate", row: { kind: "unconverted" } };
            if (draft.quote)
                return { amountMinor: draft.amount ? null : 0, approximate: false, row: referenceRateRow(draft.quote) };
        }
        return { amountMinor: null, approximate: false, row: currency === "TWD" ? null : { kind: "unconverted" } };
    }
    const amount = input.amountMinor, stated = sourceTwdValue(record.source, currency);
    if (currency === "TWD")
        return { amountMinor: amount, approximate: false, row: null };
    if (draft.twdMode === "actual")
        return { amountMinor: input.twdIntent.kind === "actual" ? input.twdIntent.twdMinor : null,
            approximate: false, row: pairRateRow(currency, amount, actualTwdMinor(draft.twd), "自填") };
    if (draft.twdMode === "restore" || currency !== record.currency) {
        if (stated)
            return { amountMinor: stated.amountMinor, approximate: stated.basis === "approximate",
                row: pairRateRow(currency, amount, stated.amountMinor, stated.basis === "approximate" ? "銀行通知 約" : "銀行通知") };
        if (draft.quote)
            return { amountMinor: convertToTwd(amount, currency, draft.quote.rate), approximate: false, row: referenceRateRow(draft.quote) };
        return { amountMinor: null, approximate: false, row: { kind: "unconverted" } };
    }
    if (amount === record.amountMinor)
        return { amountMinor: record.reportingValue?.amountMinor ?? null,
            approximate: record.reportingValue?.basis === "stated-approximate", row: exchangeRateRow(record) };
    const value = record.valuation;
    if (value?.basis === "reference-rate")
        return { amountMinor: convertToTwd(amount, currency, value.rate), approximate: false, row: referenceRateRow(value) };
    if (value?.basis === "actual") {
        const pair = value.origin ?? value, origin = value.origin?.source;
        return { amountMinor: proportionalMinor(pair.twdMinor, pair.amountMinor, amount), approximate: origin === "stated-approximate",
            row: pairRateRow(currency, pair.amountMinor, pair.twdMinor, origin === "stated-approximate" ? "銀行通知 約" : origin ? "銀行通知" : "自填") };
    }
    if (stated)
        return { amountMinor: proportionalMinor(stated.amountMinor, record.amountMinor, amount), approximate: stated.basis === "approximate",
            row: pairRateRow(currency, record.amountMinor, stated.amountMinor, stated.basis === "approximate" ? "銀行通知 約" : "銀行通知") };
    return { amountMinor: null, approximate: false, row: { kind: "unconverted" } };
}
export function changeCorrectionCurrency(record, currency) {
    return { currency, amount: currency === record.source.currency ? minorToDecimal(record.source.amountMinor, currency).replace(/\.00$/u, "") : "",
        twd: "", twdMode: "restore", quote: undefined };
}
export function unchangedAmountCorrection(record, draft) {
    const input = amountCorrectionInput(record, draft);
    if (!input || input.amountMinor !== record.amountMinor || correctionCurrency(record, draft) !== record.currency)
        return false;
    if (!draft.twdMode || draft.twdMode === "follow" || record.currency === "TWD")
        return true;
    const value = record.valuation;
    if (draft.twdMode === "actual")
        return value?.basis === "actual" && !value.origin && value.twdMinor === actualTwdMinor(draft.twd);
    if (sourceTwdValue(record.source, record.currency))
        return value === null;
    return draft.quote ? value?.basis === "reference-rate" && ["rate", "provider", "requestedOn", "effectiveOn", "retrievedAt"].every(key => value[key] === draft.quote[key]) : value === null;
}
