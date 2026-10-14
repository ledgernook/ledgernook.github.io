import { isCalendarDate, isCanonicalUtcInstant, isExchangeRate } from "../core/index.js";
import { hasOnlyKeys, isPlainObject, STABLE_ID_PATTERN } from "../core/validation.js";
const QUOTE_FIELDS = new Set(["currency", "requestedOn", "effectiveOn", "rate", "provider", "retrievedAt"]);
/** Validate a draft's pinned quote without converting money or persisting anything. */
export function isReferenceQuote(value, currency, date) {
    return isPlainObject(value) && hasOnlyKeys(value, QUOTE_FIELDS) && currency !== "TWD" &&
        value.currency === currency && value.requestedOn === date && isCalendarDate(date) &&
        isCalendarDate(value.effectiveOn) && value.effectiveOn <= date && isExchangeRate(value.rate) &&
        typeof value.provider === "string" && STABLE_ID_PATTERN.test(value.provider) && isCanonicalUtcInstant(value.retrievedAt);
}
