export * from "./recurring.js";
import { resolveEventCategory } from "./rules.js";
import { validateLedgerEvent } from "./event.js";
export * from "./preferences.js";
export * from "./money.js";
export * from "./event.js";
export * from "./unrecorded.js";
export * from "./rules.js";
export * from "./category-icons.js";
export * from "./records.js";
export * from "./calendar.js";
export * from "./report.js";
export * from "./overview.js";
export * from "./valuation.js";
export * from "./installments.js";
export * from "./splits.js";
export { isCalendarDate, isCanonicalUtcInstant } from "./validation.js";
export const TWD_MINOR_UNITS_PER_UNIT = 100;
export class LedgerAggregationError extends Error {
    code;
    constructor(code) {
        super(`Unable to aggregate ledger events: ${code}`);
        this.code = code;
        this.name = "LedgerAggregationError";
    }
}
/**
 * Legacy bank-only totals: validate every event and compute exact TWD subtotals in integer minor
 * units. Manual, refund and non-TWD records are rejected; use `buildPeriodReport` for those.
 */
export function aggregateLedgerEvents(values) {
    if (!Array.isArray(values)) {
        throw new LedgerAggregationError("invalid-record-list");
    }
    const bankTotals = new Map();
    let totalMinor = 0;
    for (const value of values) {
        const event = validateLedgerEvent(value);
        if (event.bankId === undefined || event.currency !== "TWD" || event.kind === "refund") {
            throw new LedgerAggregationError("unsupported-record");
        }
        const bankTotal = addSafe(bankTotals.get(event.bankId) ?? 0, event.amountMinor, "unsafe-bank-subtotal");
        const ledgerTotal = addSafe(totalMinor, event.amountMinor, "unsafe-overall-total");
        bankTotals.set(event.bankId, bankTotal);
        totalMinor = ledgerTotal;
    }
    const bankSubtotals = [...bankTotals]
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([bankId, amountMinor]) => Object.freeze({ bankId, amountMinor }));
    return Object.freeze({
        bankSubtotals: Object.freeze(bankSubtotals),
        totalMinor,
        eventCount: values.length,
    });
}
/** Aggregate a caller-selected period with read-time category resolution. */
export function aggregateCategorizedLedgerEvents(values, user, aiByMerchant) {
    const totals = aggregateLedgerEvents(values);
    const categoryTotals = new Map();
    let uncategorizedMinor = 0;
    for (const value of values) {
        const event = validateLedgerEvent(value);
        const categoryId = resolveEventCategory(event, user, aiByMerchant).categoryId;
        if (categoryId === null) {
            uncategorizedMinor = addSafe(uncategorizedMinor, event.amountMinor, "unsafe-category-subtotal");
        }
        else {
            categoryTotals.set(categoryId, addSafe(categoryTotals.get(categoryId) ?? 0, event.amountMinor, "unsafe-category-subtotal"));
        }
    }
    const categorySubtotals = [...categoryTotals]
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([categoryId, amountMinor]) => Object.freeze({ categoryId, amountMinor }));
    return Object.freeze({ ...totals, categorySubtotals: Object.freeze(categorySubtotals), uncategorizedMinor });
}
function addSafe(current, amountMinor, errorCode) {
    const total = current + amountMinor;
    if (!Number.isSafeInteger(total)) {
        throw new LedgerAggregationError(errorCode);
    }
    return total;
}
