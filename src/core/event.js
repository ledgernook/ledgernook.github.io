import { isCurrencyCode } from "./money.js";
import { hasOnlyKeys, isBoundedText, isCalendarDate, isCanonicalUtcInstant, isPlainObject, STABLE_ID_PATTERN, UUID_PATTERN } from "./validation.js";
/** Source TWD value, independent of effective amount corrections. */
export function sourceTwdValue(source, currency) {
    if (currency === source.currency)
        return source.statedTwdEquivalent;
    if (source.source !== "manual" && source.currency === "TWD" && currency !== "TWD")
        return {
            amountMinor: source.amountMinor, basis: source.approximateAmount ? "approximate" : "actual",
        };
    return undefined;
}
export class LedgerEventValidationError extends Error {
    code;
    constructor(code) {
        super(`Invalid ledger event: ${code}`);
        this.code = code;
        this.name = "LedgerEventValidationError";
    }
}
const EVENT_KEYS = new Set([
    "schemaVersion", "id", "source", "kind", "bankId", "aiParsed", "amountMinor", "currency", "occurredAt", "occurredOn",
    "timeProvenance", "merchant", "description", "paymentMethodLabel", "paymentMethodId", "enteredAt", "approximateAmount", "statedTwdEquivalent",
]);
const EQUIVALENT_KEYS = new Set(["amountMinor", "basis"]);
const BANK_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
export const MERCHANT_LIMIT = 80;
export const DESCRIPTION_LIMIT = 240;
export const PAYMENT_METHOD_LIMIT = 40;
export function validateLedgerEvent(value) {
    if (!isPlainObject(value))
        throw new LedgerEventValidationError("invalid-object");
    if (!hasOnlyKeys(value, EVENT_KEYS))
        throw new LedgerEventValidationError("unexpected-field");
    const record = value;
    if (record.schemaVersion !== 1)
        throw new LedgerEventValidationError("unsupported-schema-version");
    if (typeof record.id !== "string" || !UUID_PATTERN.test(record.id))
        throw new LedgerEventValidationError("invalid-id");
    const hasSource = Object.hasOwn(record, "source");
    if (hasSource && record.source !== "bank" && record.source !== "manual")
        throw new LedgerEventValidationError("invalid-source");
    const manual = record.source === "manual";
    if (Object.hasOwn(record, "aiParsed") && (manual || record.aiParsed !== true)) {
        throw new LedgerEventValidationError("invalid-ai-provenance");
    }
    if (Object.hasOwn(record, "kind") && record.kind !== "expense" && record.kind !== "refund") {
        throw new LedgerEventValidationError("invalid-kind");
    }
    if (manual ? Object.hasOwn(record, "bankId") : typeof record.bankId !== "string" || !BANK_ID_PATTERN.test(record.bankId)) {
        throw new LedgerEventValidationError("invalid-bank-id");
    }
    if (typeof record.amountMinor !== "number" || !Number.isSafeInteger(record.amountMinor) || record.amountMinor <= 0) {
        throw new LedgerEventValidationError("invalid-amount");
    }
    if (!isCurrencyCode(record.currency))
        throw new LedgerEventValidationError("unsupported-currency");
    const hasInstant = Object.hasOwn(record, "occurredAt");
    const hasDate = Object.hasOwn(record, "occurredOn");
    if (hasInstant === hasDate || (hasDate && !manual))
        throw new LedgerEventValidationError("invalid-date");
    if (hasInstant && !isCanonicalUtcInstant(record.occurredAt))
        throw new LedgerEventValidationError("invalid-time");
    if (hasDate && !isCalendarDate(record.occurredOn))
        throw new LedgerEventValidationError("invalid-date");
    const provenanceValid = hasDate
        ? !Object.hasOwn(record, "timeProvenance")
        : manual ? record.timeProvenance === "manual" || record.timeProvenance === "capture"
            : record.timeProvenance === "capture" || record.timeProvenance === "notification";
    if (!provenanceValid)
        throw new LedgerEventValidationError("invalid-time-provenance");
    if (Object.hasOwn(record, "merchant") && !isBoundedText(record.merchant, MERCHANT_LIMIT)) {
        throw new LedgerEventValidationError("invalid-merchant");
    }
    if (Object.hasOwn(record, "description") && !isBoundedText(record.description, DESCRIPTION_LIMIT)) {
        throw new LedgerEventValidationError("invalid-description");
    }
    if (Object.hasOwn(record, "paymentMethodLabel") && (!manual || !isBoundedText(record.paymentMethodLabel, PAYMENT_METHOD_LIMIT))) {
        throw new LedgerEventValidationError("invalid-payment-method");
    }
    if (Object.hasOwn(record, "paymentMethodId") && (!manual || typeof record.paymentMethodId !== "string" || !STABLE_ID_PATTERN.test(record.paymentMethodId)))
        throw new LedgerEventValidationError("invalid-payment-method");
    if (Object.hasOwn(record, "enteredAt") && (!manual || !isCanonicalUtcInstant(record.enteredAt)))
        throw new LedgerEventValidationError("invalid-time");
    if (Object.hasOwn(record, "approximateAmount") && typeof record.approximateAmount !== "boolean") {
        throw new LedgerEventValidationError("invalid-approximation");
    }
    let equivalent;
    if (Object.hasOwn(record, "statedTwdEquivalent")) {
        const stated = record.statedTwdEquivalent;
        if (!isPlainObject(stated) || !hasOnlyKeys(stated, EQUIVALENT_KEYS) || typeof stated.amountMinor !== "number" ||
            !Number.isSafeInteger(stated.amountMinor) || stated.amountMinor <= 0 ||
            (stated.basis !== "actual" && stated.basis !== "approximate"))
            throw new LedgerEventValidationError("invalid-equivalent");
        // A TWD record already states its TWD value; a different "equivalent" contradicts it.
        if (record.currency === "TWD" && stated.amountMinor !== record.amountMinor) {
            throw new LedgerEventValidationError("currency-contradiction");
        }
        equivalent = Object.freeze({ amountMinor: stated.amountMinor, basis: stated.basis });
    }
    return Object.freeze({
        schemaVersion: 1,
        id: record.id,
        ...(hasSource ? { source: record.source } : {}),
        ...(Object.hasOwn(record, "kind") ? { kind: record.kind } : {}),
        ...(manual ? {} : { bankId: record.bankId }),
        ...(Object.hasOwn(record, "aiParsed") ? { aiParsed: true } : {}),
        amountMinor: record.amountMinor,
        currency: record.currency,
        ...(hasInstant
            ? { occurredAt: record.occurredAt, timeProvenance: record.timeProvenance }
            : { occurredOn: record.occurredOn }),
        ...(Object.hasOwn(record, "merchant") ? { merchant: record.merchant } : {}),
        ...(Object.hasOwn(record, "description") ? { description: record.description } : {}),
        ...(Object.hasOwn(record, "paymentMethodLabel") ? { paymentMethodLabel: record.paymentMethodLabel } : {}),
        ...(Object.hasOwn(record, "paymentMethodId") ? { paymentMethodId: record.paymentMethodId } : {}),
        ...(Object.hasOwn(record, "enteredAt") ? { enteredAt: record.enteredAt } : {}),
        ...(Object.hasOwn(record, "approximateAmount") ? { approximateAmount: record.approximateAmount } : {}),
        ...(equivalent ? { statedTwdEquivalent: equivalent } : {}),
    });
}
/** The source occurrence as recorded; corrections in details never change it. */
export function eventOccurrence(event) {
    return event.occurredAt !== undefined
        ? Object.freeze({ precision: "instant", at: event.occurredAt, provenance: event.timeProvenance })
        : Object.freeze({ precision: "date", on: event.occurredOn });
}
/**
 * Immutable `YYYY/MM` storage anchor: the UTC month of `occurredAt` for timestamped records,
 * the stated year/month of `occurredOn` for date-only records. Details mirror this anchor.
 */
export function eventPartition(value) {
    const event = validateLedgerEvent(value);
    const date = event.occurredAt ?? event.occurredOn;
    return `${date.slice(0, 4)}/${date.slice(5, 7)}`;
}
export function eventPath(event) {
    return `events/v1/${eventPartition(event)}/${event.id}.json`;
}
/** The details path mirrors its source's immutable anchor. */
export function detailPath(event) {
    return `details/v1/${eventPartition(event)}/${event.id}.json`;
}
/** Exact equality of two validated source records; used for create-only retry comparison. */
export function ledgerEventsEqual(left, right) {
    try {
        return JSON.stringify(validateLedgerEvent(left)) === JSON.stringify(validateLedgerEvent(right));
    }
    catch {
        return false;
    }
}
