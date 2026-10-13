import { isCurrencyCode } from "./money.js";
import { hasOnlyKeys, isBoundedText, isPlainObject, STABLE_ID_PATTERN } from "./validation.js";
export const SPLIT_LINE_LIMIT = 30;
export const SPLIT_NOTE_LIMIT = 120;
const SPLIT_KEYS = new Set(["currency", "totalMinor", "lines"]);
const LINE_KEYS = new Set(["id", "amountMinor", "categoryId", "note"]);
export class SplitValidationError extends Error {
    constructor() { super("Invalid record split"); this.name = "SplitValidationError"; }
}
/** Self-contained shape and exact-sum validation; effective money/references require a snapshot. */
export function validateRecordSplit(value) {
    const fail = () => { throw new SplitValidationError(); };
    if (!isPlainObject(value) || !hasOnlyKeys(value, SPLIT_KEYS) || !isCurrencyCode(value.currency) ||
        typeof value.totalMinor !== "number" || !Number.isSafeInteger(value.totalMinor) || value.totalMinor <= 0 ||
        !Array.isArray(value.lines) || value.lines.length < 2 || value.lines.length > SPLIT_LINE_LIMIT)
        return fail();
    const ids = new Set();
    let total = 0n;
    const lines = Array.from(value.lines, (line) => {
        if (!isPlainObject(line) || !hasOnlyKeys(line, LINE_KEYS) || typeof line.id !== "string" ||
            !STABLE_ID_PATTERN.test(line.id) || ids.has(line.id) || typeof line.categoryId !== "string" ||
            !STABLE_ID_PATTERN.test(line.categoryId) || typeof line.amountMinor !== "number" ||
            !Number.isSafeInteger(line.amountMinor) || line.amountMinor <= 0 ||
            (Object.hasOwn(line, "note") && !isBoundedText(line.note, SPLIT_NOTE_LIMIT)))
            return fail();
        ids.add(line.id);
        total += BigInt(line.amountMinor);
        return Object.freeze({ id: line.id, amountMinor: line.amountMinor, categoryId: line.categoryId,
            ...(Object.hasOwn(line, "note") ? { note: line.note } : {}) });
    });
    if (total !== BigInt(value.totalMinor))
        fail();
    return Object.freeze({ currency: value.currency, totalMinor: value.totalMinor, lines: Object.freeze(lines) });
}
