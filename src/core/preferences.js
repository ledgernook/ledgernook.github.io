import { isCurrencyCode } from "./money.js";
import { hasOnlyKeys, isBoundedText, isPlainObject, STABLE_ID_PATTERN } from "./validation.js";
export const PREFERENCES_PATH = "preferences.json";
/** Reviewed notification sources; synthetic bank profiles are not selectable product banks. */
export const NOTIFICATION_BANKS = Object.freeze([
    { id: "cathay-united", label: "國泰世華", sources: ["bank-app", "wallet"] },
    { id: "dbs-taiwan", label: "星展", sources: ["bank-app", "wallet"] },
    { id: "taipei-fubon", label: "台北富邦", sources: ["bank-app", "wallet"] },
].map(bank => Object.freeze({ ...bank, sources: Object.freeze(bank.sources) })));
export class PreferenceValidationError extends Error {
    code;
    constructor(code) {
        super(`Invalid ledger preferences: ${code}`);
        this.code = code;
        this.name = "PreferenceValidationError";
    }
}
export function defaultLedgerPreferences() {
    return Object.freeze({ schemaVersion: 1, paymentMethods: Object.freeze([{ kind: "cash", id: "cash" }]),
        organiserModel: "pcc", notificationAiParsing: true, reportingTimeZone: null, pinnedCategoryIds: Object.freeze([]), currentTrip: null });
}
export function validateReportingTimeZone(zone) {
    if (typeof zone !== "string" || !isBoundedText(zone, 100) || /^[+-]/.test(zone))
        throw new PreferenceValidationError("time-zone");
    try {
        new Intl.DateTimeFormat("en", { timeZone: zone });
    }
    catch {
        throw new PreferenceValidationError("time-zone");
    }
    return zone;
}
/** Structural validation at the transport boundary; reference validation once dependencies are loaded. */
export function validateLedgerPreferences(raw, references) {
    const fail = (code) => { throw new PreferenceValidationError(code); };
    if (!isPlainObject(raw) || !hasOnlyKeys(raw, new Set(["schemaVersion", "paymentMethods", "organiserModel", "notificationAiParsing", "reportingTimeZone", "pinnedCategoryIds", "currentTrip"])))
        fail("object");
    const value = raw;
    if (value.schemaVersion !== 1)
        fail("schema-version");
    const organiserModel = value.organiserModel === undefined ? "pcc" : value.organiserModel;
    if (organiserModel !== "pcc" && organiserModel !== "device")
        fail("organiser-model");
    const notificationAiParsing = Object.hasOwn(value, "notificationAiParsing") ? value.notificationAiParsing : true;
    if (typeof notificationAiParsing !== "boolean")
        fail("notification-ai-parsing");
    if (!Array.isArray(value.paymentMethods) || value.paymentMethods.length === 0 || value.paymentMethods.length > 100)
        fail("payment-methods");
    const ids = new Set();
    const labels = new Set();
    const methods = value.paymentMethods.map(raw => {
        if (!isPlainObject(raw) || typeof raw.id !== "string" || !STABLE_ID_PATTERN.test(raw.id) || ids.has(raw.id))
            fail("payment-method");
        const item = raw;
        ids.add(item.id);
        if (item.kind === "cash" && item.id === "cash" && hasOnlyKeys(item, new Set(["kind", "id"]))) {
            if (labels.has("現金"))
                fail("payment-method");
            labels.add("現金");
            return Object.freeze({ kind: "cash", id: "cash" });
        }
        if (item.kind === "bank" && hasOnlyKeys(item, new Set(["kind", "id", "source", "closingDay"]))) {
            const bank = NOTIFICATION_BANKS.find(bank => bank.id === item.id);
            if (!bank || !bank.sources.includes(item.source))
                fail("bank-source");
            if (Object.hasOwn(item, "closingDay") && (typeof item.closingDay !== "number" || !Number.isInteger(item.closingDay) || item.closingDay < 1 || item.closingDay > 31))
                fail("closing-day");
            if (labels.has(bank.label))
                fail("payment-method");
            labels.add(bank.label);
            return Object.freeze({ kind: "bank", id: item.id, source: item.source,
                ...(Object.hasOwn(item, "closingDay") ? { closingDay: item.closingDay } : {}) });
        }
        if (item.kind === "custom" && hasOnlyKeys(item, new Set(["kind", "id", "label"])) && isBoundedText(item.label, 40) &&
            item.id !== "cash" && !NOTIFICATION_BANKS.some(bank => bank.id === item.id || bank.label === item.label) && item.label !== "現金" && !labels.has(item.label)) {
            labels.add(item.label);
            return Object.freeze({ kind: "custom", id: item.id, label: item.label });
        }
        return fail("payment-method");
    });
    const zone = value.reportingTimeZone === null ? null : validateReportingTimeZone(value.reportingTimeZone);
    if (!Array.isArray(value.pinnedCategoryIds) || value.pinnedCategoryIds.length > 3 ||
        value.pinnedCategoryIds.some(id => typeof id !== "string" || !STABLE_ID_PATTERN.test(id)) ||
        new Set(value.pinnedCategoryIds).size !== value.pinnedCategoryIds.length)
        fail("pins");
    const pins = value.pinnedCategoryIds;
    if (references && pins.some(id => !references.categories.some(category => category.id === id && category.parentId === undefined)))
        fail("main-category");
    let trip = null;
    if (value.currentTrip !== null) {
        const rawTrip = value.currentTrip;
        if (!isPlainObject(rawTrip) || !hasOnlyKeys(rawTrip, new Set(["projectId", "currency"])) || typeof rawTrip.projectId !== "string" ||
            !STABLE_ID_PATTERN.test(rawTrip.projectId) || !isCurrencyCode(rawTrip.currency))
            fail("trip");
        const item = rawTrip;
        if (references && !references.projects.some(project => project.id === item.projectId && !project.archived))
            fail("trip-project");
        trip = Object.freeze({ projectId: item.projectId, currency: item.currency });
    }
    return Object.freeze({ schemaVersion: 1, paymentMethods: Object.freeze(methods), organiserModel: organiserModel,
        notificationAiParsing: notificationAiParsing, reportingTimeZone: zone,
        pinnedCategoryIds: Object.freeze([...pins]), currentTrip: trip });
}
export function paymentMethodName(method) {
    return method.kind === "cash" ? "現金" : method.kind === "custom" ? method.label : NOTIFICATION_BANKS.find(bank => bank.id === method.id).label;
}
/** A missing/externally archived trip never prefills an invalid project; values stay editable. */
export function manualEntryDefaults(preferences, projects) {
    const trip = preferences.currentTrip;
    return Object.freeze(trip && projects.some(project => project.id === trip.projectId && !project.archived)
        ? { projectId: trip.projectId, currency: trip.currency } : { projectId: null, currency: "TWD" });
}
