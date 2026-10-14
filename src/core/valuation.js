import { checkedMinor, currencyScale, isCurrencyCode, MoneyError, REPORTING_CURRENCY } from "./money.js";
import { hasOnlyKeys, isCalendarDate, isCanonicalUtcInstant, isPlainObject, STABLE_ID_PATTERN, UUID_PATTERN } from "./validation.js";
// ---------------------------------------------------------------------------------------------
// Exact exchange rates and TWD conversion. A rate is decimal text (TWD per one major unit of the
// original currency), computed with BigInt; never a floating-point multiplication of money.
// ---------------------------------------------------------------------------------------------
/** Positive plain decimal text: at most 12 integer digits and 15 fractional digits, e.g. "0.21274". */
const RATE_PATTERN = /^(0|[1-9]\d{0,11})(?:\.(\d{1,15}))?$/;
/** The only rounding basis: half-up (away from zero for the non-negative amounts used here). */
export const VALUATION_ROUNDING = "half-up";
export function isExchangeRate(value) {
    return typeof value === "string" && RATE_PATTERN.test(value) && /[1-9]/.test(value);
}
/** Rate as an exact rational `numerator / 10^digits`. */
function rateRational(rate) {
    if (!isExchangeRate(rate))
        throw new MoneyError("invalid-decimal");
    const [whole, fraction = ""] = rate.split(".");
    return { numerator: BigInt(`${whole}${fraction}`), denominator: 10n ** BigInt(fraction.length) };
}
/** Half-up rounding of a non-negative rational to a safe integer. */
function roundHalfUp(numerator, denominator) {
    const value = (2n * numerator + denominator) / (2n * denominator);
    if (value > BigInt(Number.MAX_SAFE_INTEGER))
        throw new MoneyError("unsafe-total");
    return Number(value);
}
/**
 * Exact TWD minor units of `amountMinor` (in `currency` minor units) at `rate`, rounded half-up once:
 * round(amountMinor / 10^scale(currency) * rate * 10^scale(TWD)).
 * Examples: JPY 10,000 at "0.21274" -> 212,740 (TWD 2,127.40); KWD 1.234 at "106.27" -> 13,114.
 */
export function convertToTwd(amountMinor, currency, rate) {
    checkedMinor(amountMinor);
    const { numerator, denominator } = rateRational(rate);
    const twdScale = BigInt(currencyScale(REPORTING_CURRENCY));
    return roundHalfUp(BigInt(amountMinor) * numerator * 10n ** twdScale, denominator * 10n ** BigInt(currencyScale(currency)));
}
/**
 * Proportional share `round_half_up(valueMinor * partMinor / baseMinor)`. `partMinor` may exceed the
 * base (an explicitly increased schedule extends the saved basis; it never takes a fresh rate).
 */
export function proportionalMinor(valueMinor, baseMinor, partMinor) {
    checkedMinor(valueMinor);
    checkedMinor(baseMinor, true);
    checkedMinor(partMinor);
    return roundHalfUp(BigInt(valueMinor) * BigInt(partMinor), BigInt(baseMinor));
}
/**
 * Allocate a saved value across ordered parts of its base amount without cumulative drift
 * ("cumulative rounding"): part k receives share(C_k) - share(C_(k-1)), where C is the running sum
 * of parts and share = `proportionalMinor`. Parts summing to the base receive exactly `valueMinor`.
 * An earlier part's share never depends on later parts, so revising future parts keeps history.
 * Example: value 100 over base 3 in parts [1, 1, 1] -> [33, 34, 33] (per-part rounding would give 99).
 */
export function cumulativeShares(valueMinor, baseMinor, parts) {
    let cumulative = 0;
    let previous = 0;
    return Object.freeze(parts.map(part => {
        cumulative = checkedMinor(cumulative + checkedMinor(part));
        const share = proportionalMinor(valueMinor, baseMinor, cumulative);
        const result = share - previous;
        previous = share;
        return result;
    }));
}
export class ValuationError extends Error {
    code;
    constructor(code) {
        super(`Invalid valuation: ${code}`);
        this.code = code;
        this.name = "ValuationError";
    }
}
const VALUATION_KEYS = new Set(["basis", "currency", "amountMinor", "twdMinor", "operationId", "supersedes"]);
const ACTUAL_KEYS = new Set([...VALUATION_KEYS, "origin"]);
const RATE_KEYS = new Set([...VALUATION_KEYS, "rate", "provider", "requestedOn", "effectiveOn", "retrievedAt", "rounding"]);
const ORIGIN_KEYS = new Set(["amountMinor", "twdMinor", "source"]);
const isPositiveSafe = (value) => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const isUuid = (value) => typeof value === "string" && UUID_PATTERN.test(value);
/** Strict validator for a stored valuation; TWD records never carry one. Throws `ValuationError`. */
export function validateSavedValuation(value) {
    const fail = () => { throw new ValuationError("invalid-valuation"); };
    if (!isPlainObject(value))
        return fail();
    const item = value;
    if (item.basis !== "actual" && item.basis !== "reference-rate")
        fail();
    if (!hasOnlyKeys(item, item.basis === "actual" ? ACTUAL_KEYS : RATE_KEYS))
        fail();
    if (!isCurrencyCode(item.currency) || item.currency === REPORTING_CURRENCY)
        fail();
    if (!isPositiveSafe(item.amountMinor) || !isPositiveSafe(item.twdMinor) || !isUuid(item.operationId))
        fail();
    if (Object.hasOwn(item, "supersedes") && (!isUuid(item.supersedes) || item.supersedes === item.operationId))
        fail();
    const base = {
        currency: item.currency, amountMinor: item.amountMinor, twdMinor: item.twdMinor,
        operationId: item.operationId, ...(Object.hasOwn(item, "supersedes") ? { supersedes: item.supersedes } : {}),
    };
    if (item.basis === "actual") {
        if (!Object.hasOwn(item, "origin"))
            return Object.freeze({ basis: "actual", ...base });
        const origin = item.origin;
        if (!isPlainObject(origin))
            return fail();
        if (!hasOnlyKeys(origin, ORIGIN_KEYS))
            return fail();
        if (Object.hasOwn(origin, "source") && origin.source !== "stated-actual" && origin.source !== "stated-approximate")
            return fail();
        const originAmountMinor = origin.amountMinor;
        const originTwdMinor = origin.twdMinor;
        if (!isPositiveSafe(originAmountMinor) || !isPositiveSafe(originTwdMinor))
            return fail();
        let expectedTwdMinor;
        try {
            expectedTwdMinor = proportionalMinor(originTwdMinor, originAmountMinor, base.amountMinor);
        }
        catch {
            return fail();
        }
        if (expectedTwdMinor !== base.twdMinor)
            return fail();
        return Object.freeze({ basis: "actual", ...base, origin: Object.freeze({
                amountMinor: originAmountMinor, twdMinor: originTwdMinor,
                ...(Object.hasOwn(origin, "source") ? { source: origin.source } : {}),
            }) });
    }
    if (!isExchangeRate(item.rate) || typeof item.provider !== "string" || !STABLE_ID_PATTERN.test(item.provider) ||
        !isCalendarDate(item.requestedOn) || !isCalendarDate(item.effectiveOn) || item.effectiveOn > item.requestedOn ||
        !isCanonicalUtcInstant(item.retrievedAt) || item.rounding !== VALUATION_ROUNDING)
        fail();
    if (convertToTwd(base.amountMinor, base.currency, item.rate) !== base.twdMinor)
        fail();
    return Object.freeze({
        basis: "reference-rate", ...base, rate: item.rate, provider: item.provider,
        requestedOn: item.requestedOn, effectiveOn: item.effectiveOn, retrievedAt: item.retrievedAt,
        rounding: VALUATION_ROUNDING,
    });
}
/** Build a validated reference-rate valuation, computing `twdMinor` exactly. Throws `ValuationError`. */
export function createReferenceValuation(input) {
    let twdMinor;
    try {
        twdMinor = convertToTwd(input.amountMinor, input.currency, input.rate);
    }
    catch {
        throw new ValuationError("invalid-valuation");
    }
    return validateSavedValuation({
        basis: "reference-rate", currency: input.currency, amountMinor: input.amountMinor, twdMinor, operationId: input.operationId,
        ...(input.supersedes !== undefined ? { supersedes: input.supersedes } : {}),
        rate: input.rate, provider: input.provider, requestedOn: input.requestedOn, effectiveOn: input.effectiveOn,
        retrievedAt: input.retrievedAt, rounding: VALUATION_ROUNDING,
    });
}
/** Build a validated confirmed-actual valuation. Throws `ValuationError`. */
export function createActualValuation(input) {
    return validateSavedValuation({ basis: "actual", ...input });
}
