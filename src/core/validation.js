/** Pure validation primitives shared by the Core schema validators. */
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Stable user-maintained identifiers: categories, brands and projects. */
export const STABLE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;
const CANONICAL_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
export function isPlainObject(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value))
        return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}
/** True when every own key is a string listed in `allowed`. */
export function hasOnlyKeys(value, allowed) {
    return Reflect.ownKeys(value).every(key => typeof key === "string" && allowed.has(key));
}
/** One to `limit` code points, no surrounding whitespace and no control characters. */
export function isBoundedText(value, limit) {
    return typeof value === "string" && [...value].length >= 1 && [...value].length <= limit &&
        value.trim() === value && !CONTROL_PATTERN.test(value);
}
/** A real proleptic Gregorian `YYYY-MM-DD` date. */
export function isCalendarDate(value) {
    if (typeof value !== "string" || !DATE_PATTERN.test(value))
        return false;
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(0);
    date.setUTCFullYear(year, month - 1, day);
    date.setUTCHours(0, 0, 0, 0);
    return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
}
/** A canonical `Date#toISOString()` UTC instant with milliseconds. */
export function isCanonicalUtcInstant(value) {
    if (typeof value !== "string" || !CANONICAL_UTC_PATTERN.test(value))
        return false;
    const milliseconds = Date.parse(value);
    return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}
