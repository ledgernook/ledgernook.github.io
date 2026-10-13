/**
 * Explicit currency registry and exact integer money. Amounts are integer minor units of their
 * currency's scale (TWD 2 keeps existing `amountMinor` cents valid). Never floating-point money.
 */
// Frankfurter v2 provider list fetched 2026-10-11; ISO 4217 list one published 2026-09-17.
export const CURRENCIES = Object.freeze({
    AED: Object.freeze({ code: "AED", scale: 2 }),
    AFN: Object.freeze({ code: "AFN", scale: 2 }),
    ALL: Object.freeze({ code: "ALL", scale: 2 }),
    AMD: Object.freeze({ code: "AMD", scale: 2 }),
    AOA: Object.freeze({ code: "AOA", scale: 2 }),
    ARS: Object.freeze({ code: "ARS", scale: 2 }),
    AUD: Object.freeze({ code: "AUD", scale: 2 }),
    AWG: Object.freeze({ code: "AWG", scale: 2 }),
    AZN: Object.freeze({ code: "AZN", scale: 2 }),
    BAM: Object.freeze({ code: "BAM", scale: 2 }),
    BBD: Object.freeze({ code: "BBD", scale: 2 }),
    BDT: Object.freeze({ code: "BDT", scale: 2 }),
    BHD: Object.freeze({ code: "BHD", scale: 3 }),
    BIF: Object.freeze({ code: "BIF", scale: 0 }),
    BMD: Object.freeze({ code: "BMD", scale: 2 }),
    BND: Object.freeze({ code: "BND", scale: 2 }),
    BOB: Object.freeze({ code: "BOB", scale: 2 }),
    BRL: Object.freeze({ code: "BRL", scale: 2 }),
    BSD: Object.freeze({ code: "BSD", scale: 2 }),
    BTN: Object.freeze({ code: "BTN", scale: 2 }),
    BWP: Object.freeze({ code: "BWP", scale: 2 }),
    BYN: Object.freeze({ code: "BYN", scale: 2 }),
    BZD: Object.freeze({ code: "BZD", scale: 2 }),
    CAD: Object.freeze({ code: "CAD", scale: 2 }),
    CDF: Object.freeze({ code: "CDF", scale: 2 }),
    CHF: Object.freeze({ code: "CHF", scale: 2 }),
    CLP: Object.freeze({ code: "CLP", scale: 0 }),
    CNY: Object.freeze({ code: "CNY", scale: 2 }),
    COP: Object.freeze({ code: "COP", scale: 2 }),
    CRC: Object.freeze({ code: "CRC", scale: 2 }),
    CUP: Object.freeze({ code: "CUP", scale: 2 }),
    CVE: Object.freeze({ code: "CVE", scale: 2 }),
    CZK: Object.freeze({ code: "CZK", scale: 2 }),
    DJF: Object.freeze({ code: "DJF", scale: 0 }),
    DKK: Object.freeze({ code: "DKK", scale: 2 }),
    DOP: Object.freeze({ code: "DOP", scale: 2 }),
    DZD: Object.freeze({ code: "DZD", scale: 2 }),
    EGP: Object.freeze({ code: "EGP", scale: 2 }),
    ERN: Object.freeze({ code: "ERN", scale: 2 }),
    ETB: Object.freeze({ code: "ETB", scale: 2 }),
    EUR: Object.freeze({ code: "EUR", scale: 2 }),
    FJD: Object.freeze({ code: "FJD", scale: 2 }),
    FKP: Object.freeze({ code: "FKP", scale: 2 }),
    GBP: Object.freeze({ code: "GBP", scale: 2 }),
    GEL: Object.freeze({ code: "GEL", scale: 2 }),
    GHS: Object.freeze({ code: "GHS", scale: 2 }),
    GIP: Object.freeze({ code: "GIP", scale: 2 }),
    GMD: Object.freeze({ code: "GMD", scale: 2 }),
    GNF: Object.freeze({ code: "GNF", scale: 0 }),
    GTQ: Object.freeze({ code: "GTQ", scale: 2 }),
    GYD: Object.freeze({ code: "GYD", scale: 2 }),
    HKD: Object.freeze({ code: "HKD", scale: 2 }),
    HNL: Object.freeze({ code: "HNL", scale: 2 }),
    HTG: Object.freeze({ code: "HTG", scale: 2 }),
    HUF: Object.freeze({ code: "HUF", scale: 2 }),
    IDR: Object.freeze({ code: "IDR", scale: 2 }),
    ILS: Object.freeze({ code: "ILS", scale: 2 }),
    INR: Object.freeze({ code: "INR", scale: 2 }),
    IQD: Object.freeze({ code: "IQD", scale: 3 }),
    IRR: Object.freeze({ code: "IRR", scale: 2 }),
    ISK: Object.freeze({ code: "ISK", scale: 0 }),
    JMD: Object.freeze({ code: "JMD", scale: 2 }),
    JOD: Object.freeze({ code: "JOD", scale: 3 }),
    JPY: Object.freeze({ code: "JPY", scale: 0 }),
    KES: Object.freeze({ code: "KES", scale: 2 }),
    KGS: Object.freeze({ code: "KGS", scale: 2 }),
    KHR: Object.freeze({ code: "KHR", scale: 2 }),
    KMF: Object.freeze({ code: "KMF", scale: 0 }),
    KPW: Object.freeze({ code: "KPW", scale: 2 }),
    KRW: Object.freeze({ code: "KRW", scale: 0 }),
    KWD: Object.freeze({ code: "KWD", scale: 3 }),
    KYD: Object.freeze({ code: "KYD", scale: 2 }),
    KZT: Object.freeze({ code: "KZT", scale: 2 }),
    LAK: Object.freeze({ code: "LAK", scale: 2 }),
    LBP: Object.freeze({ code: "LBP", scale: 2 }),
    LKR: Object.freeze({ code: "LKR", scale: 2 }),
    LRD: Object.freeze({ code: "LRD", scale: 2 }),
    LSL: Object.freeze({ code: "LSL", scale: 2 }),
    LYD: Object.freeze({ code: "LYD", scale: 3 }),
    MAD: Object.freeze({ code: "MAD", scale: 2 }),
    MDL: Object.freeze({ code: "MDL", scale: 2 }),
    MGA: Object.freeze({ code: "MGA", scale: 2 }),
    MKD: Object.freeze({ code: "MKD", scale: 2 }),
    MMK: Object.freeze({ code: "MMK", scale: 2 }),
    MNT: Object.freeze({ code: "MNT", scale: 2 }),
    MOP: Object.freeze({ code: "MOP", scale: 2 }),
    MRU: Object.freeze({ code: "MRU", scale: 2 }),
    MUR: Object.freeze({ code: "MUR", scale: 2 }),
    MVR: Object.freeze({ code: "MVR", scale: 2 }),
    MWK: Object.freeze({ code: "MWK", scale: 2 }),
    MXN: Object.freeze({ code: "MXN", scale: 2 }),
    MYR: Object.freeze({ code: "MYR", scale: 2 }),
    MZN: Object.freeze({ code: "MZN", scale: 2 }),
    NAD: Object.freeze({ code: "NAD", scale: 2 }),
    NGN: Object.freeze({ code: "NGN", scale: 2 }),
    NIO: Object.freeze({ code: "NIO", scale: 2 }),
    NOK: Object.freeze({ code: "NOK", scale: 2 }),
    NPR: Object.freeze({ code: "NPR", scale: 2 }),
    NZD: Object.freeze({ code: "NZD", scale: 2 }),
    OMR: Object.freeze({ code: "OMR", scale: 3 }),
    PAB: Object.freeze({ code: "PAB", scale: 2 }),
    PEN: Object.freeze({ code: "PEN", scale: 2 }),
    PGK: Object.freeze({ code: "PGK", scale: 2 }),
    PHP: Object.freeze({ code: "PHP", scale: 2 }),
    PKR: Object.freeze({ code: "PKR", scale: 2 }),
    PLN: Object.freeze({ code: "PLN", scale: 2 }),
    PYG: Object.freeze({ code: "PYG", scale: 0 }),
    QAR: Object.freeze({ code: "QAR", scale: 2 }),
    RON: Object.freeze({ code: "RON", scale: 2 }),
    RSD: Object.freeze({ code: "RSD", scale: 2 }),
    RUB: Object.freeze({ code: "RUB", scale: 2 }),
    RWF: Object.freeze({ code: "RWF", scale: 0 }),
    SAR: Object.freeze({ code: "SAR", scale: 2 }),
    SBD: Object.freeze({ code: "SBD", scale: 2 }),
    SCR: Object.freeze({ code: "SCR", scale: 2 }),
    SDG: Object.freeze({ code: "SDG", scale: 2 }),
    SEK: Object.freeze({ code: "SEK", scale: 2 }),
    SGD: Object.freeze({ code: "SGD", scale: 2 }),
    SHP: Object.freeze({ code: "SHP", scale: 2 }),
    SLE: Object.freeze({ code: "SLE", scale: 2 }),
    SOS: Object.freeze({ code: "SOS", scale: 2 }),
    SRD: Object.freeze({ code: "SRD", scale: 2 }),
    SSP: Object.freeze({ code: "SSP", scale: 2 }),
    STN: Object.freeze({ code: "STN", scale: 2 }),
    SVC: Object.freeze({ code: "SVC", scale: 2 }),
    SYP: Object.freeze({ code: "SYP", scale: 2 }),
    SZL: Object.freeze({ code: "SZL", scale: 2 }),
    THB: Object.freeze({ code: "THB", scale: 2 }),
    TJS: Object.freeze({ code: "TJS", scale: 2 }),
    TMT: Object.freeze({ code: "TMT", scale: 2 }),
    TND: Object.freeze({ code: "TND", scale: 3 }),
    TOP: Object.freeze({ code: "TOP", scale: 2 }),
    TRY: Object.freeze({ code: "TRY", scale: 2 }),
    TTD: Object.freeze({ code: "TTD", scale: 2 }),
    TWD: Object.freeze({ code: "TWD", scale: 2 }),
    TZS: Object.freeze({ code: "TZS", scale: 2 }),
    UAH: Object.freeze({ code: "UAH", scale: 2 }),
    UGX: Object.freeze({ code: "UGX", scale: 0 }),
    USD: Object.freeze({ code: "USD", scale: 2 }),
    UYU: Object.freeze({ code: "UYU", scale: 2 }),
    UZS: Object.freeze({ code: "UZS", scale: 2 }),
    VES: Object.freeze({ code: "VES", scale: 2 }),
    VND: Object.freeze({ code: "VND", scale: 0 }),
    VUV: Object.freeze({ code: "VUV", scale: 0 }),
    WST: Object.freeze({ code: "WST", scale: 2 }),
    XAF: Object.freeze({ code: "XAF", scale: 0 }),
    XCD: Object.freeze({ code: "XCD", scale: 2 }),
    XCG: Object.freeze({ code: "XCG", scale: 2 }),
    XOF: Object.freeze({ code: "XOF", scale: 0 }),
    XPF: Object.freeze({ code: "XPF", scale: 0 }),
    YER: Object.freeze({ code: "YER", scale: 2 }),
    ZAR: Object.freeze({ code: "ZAR", scale: 2 }),
    ZMW: Object.freeze({ code: "ZMW", scale: 2 }),
    ZWG: Object.freeze({ code: "ZWG", scale: 2 }),
});
/** The initial reporting currency. */
export const REPORTING_CURRENCY = "TWD";
export class MoneyError extends Error {
    code;
    constructor(code) {
        super(`Invalid money: ${code}`);
        this.code = code;
        this.name = "MoneyError";
    }
}
export function isCurrencyCode(value) {
    return typeof value === "string" && Object.hasOwn(CURRENCIES, value);
}
/** Minor-unit decimal places for a registered currency; unknown codes are rejected, never guessed. */
export function currencyScale(value) {
    if (!isCurrencyCode(value))
        throw new MoneyError("unsupported-currency");
    return CURRENCIES[value].scale;
}
/** A non-negative (or, with `positive`, strictly positive) safe integer amount. */
export function checkedMinor(value, positive = false) {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || (positive ? value <= 0 : value < 0)) {
        throw new MoneyError("invalid-amount");
    }
    return value;
}
export function addMinor(left, right) {
    if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right))
        throw new MoneyError("invalid-amount");
    const total = left + right;
    if (!Number.isSafeInteger(total))
        throw new MoneyError("unsafe-total");
    return total;
}
export function subtractMinor(left, right) {
    if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right))
        throw new MoneyError("invalid-amount");
    const total = left - right;
    if (!Number.isSafeInteger(total))
        throw new MoneyError("unsafe-total");
    return total;
}
/**
 * Allocate a non-negative amount across positive integer weights exactly.
 * Remainder rule: each part first receives floor(amount * weight / totalWeight); the remaining
 * minor units (always fewer than the number of parts) are then given one each to the parts in
 * ascending index order, so the earliest parts absorb the remainder. Example: 10,000 JPY over
 * three equal parts is [3334, 3333, 3333]. The parts always sum to `amountMinor`.
 */
export function allocateMinor(amountMinor, weights) {
    checkedMinor(amountMinor);
    if (!Array.isArray(weights) || weights.length === 0 || weights.length > 100_000 ||
        weights.some(weight => !Number.isSafeInteger(weight) || weight <= 0))
        throw new MoneyError("invalid-allocation");
    const totalWeight = weights.reduce((sum, weight) => sum + BigInt(weight), 0n);
    const parts = weights.map(weight => Number(BigInt(amountMinor) * BigInt(weight) / totalWeight));
    let remainder = amountMinor - parts.reduce((sum, part) => sum + part, 0);
    for (let index = 0; remainder > 0; index++, remainder--)
        parts[index] += 1;
    return Object.freeze(parts);
}
/** Equal-weight allocation using the `allocateMinor` remainder rule. */
export function splitMinor(amountMinor, count) {
    if (!Number.isSafeInteger(count) || count < 1 || count > 100_000)
        throw new MoneyError("invalid-allocation");
    return allocateMinor(amountMinor, Array(count).fill(1));
}
/** Exact decimal text of a signed minor amount, e.g. 123 TWD -> "1.23", 5 KWD -> "0.005", 100 JPY -> "100". */
export function minorToDecimal(amountMinor, currency) {
    if (!Number.isSafeInteger(amountMinor))
        throw new MoneyError("invalid-amount");
    const scale = currencyScale(currency);
    const digits = Math.abs(amountMinor).toString().padStart(scale + 1, "0");
    const sign = amountMinor < 0 ? "-" : "";
    return scale === 0 ? `${sign}${digits}` : `${sign}${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}
/** Parse plain non-negative decimal text with at most the currency's scale into exact minor units. */
export function decimalToMinor(text, currency) {
    const scale = currencyScale(currency);
    if (typeof text !== "string")
        throw new MoneyError("invalid-decimal");
    const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/.exec(text);
    if (!match || (match[2] !== undefined && match[2].length > scale))
        throw new MoneyError("invalid-decimal");
    const value = BigInt(match[1]) * 10n ** BigInt(scale) + BigInt((match[2] ?? "").padEnd(scale, "0") || "0");
    if (value > BigInt(Number.MAX_SAFE_INTEGER))
        throw new MoneyError("invalid-amount");
    return Number(value);
}
