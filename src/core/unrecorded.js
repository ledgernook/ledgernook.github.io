import { isCurrencyCode } from "./money.js";
import { hasOnlyKeys, isCanonicalUtcInstant, isPlainObject, UUID_PATTERN } from "./validation.js";
export class UnrecordedValidationError extends Error {
    code;
    constructor(code) {
        super(`Invalid unrecorded notification: ${code}`);
        this.code = code;
        this.name = "UnrecordedValidationError";
    }
}
const KEYS = new Set(["schemaVersion", "id", "bankId", "application", "ingestionSource", "capturedAt", "rawText", "reason", "readableAmount"]);
// Shared with the Writer: whitespace separators, next-line and Unicode format characters.
const EMPTY_APPLICATION = /^[\t\n\f\r\x0b\x85\p{Z}\p{Cf}]*$/u;
export const UNRECORDED_PATH_PATTERN = /^unrecorded\/v1\/\d{4}\/(?:0[1-9]|1[0-2])\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/;
export function validateUnrecordedNotification(raw) {
    const fail = (code) => { throw new UnrecordedValidationError(code); };
    if (!isPlainObject(raw) || !hasOnlyKeys(raw, KEYS))
        fail("object");
    const value = raw;
    if (value.schemaVersion !== 1)
        fail("schema-version");
    if (typeof value.id !== "string" || !UUID_PATTERN.test(value.id))
        fail("id");
    if (Object.hasOwn(value, "bankId") && (typeof value.bankId !== "string" || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value.bankId)))
        fail("bank-id");
    const application = Object.hasOwn(value, "application") ? value.application : "";
    if (typeof application !== "string" || [...application].length > 320)
        fail("application");
    if (value.ingestionSource !== "bank-app" && value.ingestionSource !== "wallet")
        fail("source");
    if (!isCanonicalUtcInstant(value.capturedAt))
        fail("capture-time");
    if (typeof value.rawText !== "string")
        fail("text");
    if (value.reason !== "received" && value.reason !== "unreadable" && value.reason !== "model-unavailable")
        fail("reason");
    if (!Object.hasOwn(value, "bankId") && (typeof application !== "string" || EMPTY_APPLICATION.test(application) || value.ingestionSource !== "bank-app" ||
        value.reason !== "unreadable" && value.reason !== "received"))
        fail("unattributed-source");
    let readableAmount;
    if (Object.hasOwn(value, "readableAmount")) {
        const amount = value.readableAmount;
        if (!isPlainObject(amount) || !hasOnlyKeys(amount, new Set(["amountMinor", "currency"])) ||
            typeof amount.amountMinor !== "number" || !Number.isSafeInteger(amount.amountMinor) || amount.amountMinor <= 0 ||
            !isCurrencyCode(amount.currency))
            fail("amount");
        const item = amount;
        readableAmount = Object.freeze({ amountMinor: item.amountMinor, currency: item.currency });
    }
    return Object.freeze({ schemaVersion: 1, id: value.id, ...(Object.hasOwn(value, "bankId") ? { bankId: value.bankId } : {}), application: application,
        ingestionSource: value.ingestionSource, capturedAt: value.capturedAt,
        rawText: value.rawText, reason: value.reason,
        ...(readableAmount ? { readableAmount } : {}) });
}
/**
 * SHA-256 input is exact UTF-8 of bankId + "|" + ingestionSource + "|" + rawText, or
 * "app:" + application code-point count + ":" + application + "|" + ingestionSource + "|" + rawText.
 * Capture time and reason/model output are not identity; identical source/text retries collapse.
 * Hashing belongs to the caller's platform. Like the native Writer's event IDs, format the first
 * 32 lowercase digest hex characters as 8-4-4-4-12, replacing positions 12 and 16 with "4" and "8".
 */
export function unrecordedCaptureSeed(capture) {
    validateUnrecordedNotification({ ...capture, schemaVersion: 1, id: "00000000-0000-4000-8000-000000000000", reason: "unreadable" });
    const application = capture.application ?? "";
    return `${capture.bankId ?? `app:${[...application].length}:${application}`}|${capture.ingestionSource}|${capture.rawText}`;
}
export function unrecordedIdFromHash(sha256) {
    if (!/^[0-9a-f]{64}$/.test(sha256))
        throw new UnrecordedValidationError("hash");
    return `${sha256.slice(0, 8)}-${sha256.slice(8, 12)}-4${sha256.slice(13, 16)}-8${sha256.slice(17, 20)}-${sha256.slice(20, 32)}`;
}
export function unrecordedPath(notification) {
    const value = validateUnrecordedNotification(notification);
    return `unrecorded/v1/${value.capturedAt.slice(0, 4)}/${value.capturedAt.slice(5, 7)}/${value.id}.json`;
}
