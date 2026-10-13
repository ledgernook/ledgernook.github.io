import { clampedMonthDate } from "./calendar.js";
import { checkedMinor } from "./money.js";
import { hasOnlyKeys, isCalendarDate, isPlainObject, UUID_PATTERN } from "./validation.js";
export class RecurringRuleError extends Error {
    code;
    constructor(code) {
        super(`Recurring rule: ${code}`);
        this.code = code;
        this.name = "RecurringRuleError";
    }
}
export const MAX_RECURRING_OCCURRENCES = 1200;
const RULE_KEYS = new Set(["operationId", "cadence", "end", "overrides", "revisions"]);
const REVISION_KEYS = new Set(["operationId", "effectiveOn", "cadence", "amountMinor", "end"]);
const END_KEYS = new Set(["on", "count"]);
const OVERRIDE_KEYS = new Set(["amountMinor", "skipped"]);
const isUuid = (value) => typeof value === "string" && UUID_PATTERN.test(value);
const isCadence = (value) => value === "monthly" || value === "yearly";
const isMinor = (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
function fail(code) { throw new RecurringRuleError(code); }
function endValue(value, code) {
    if (!isPlainObject(value) || !hasOnlyKeys(value, END_KEYS) || Reflect.ownKeys(value).length !== 1)
        return fail(code);
    if (Object.hasOwn(value, "on") && isCalendarDate(value.on))
        return Object.freeze({ on: value.on });
    if (Object.hasOwn(value, "count") && typeof value.count === "number" && Number.isSafeInteger(value.count) &&
        value.count >= 1 && value.count <= MAX_RECURRING_OCCURRENCES)
        return Object.freeze({ count: value.count });
    return fail(code);
}
/** Strict stored-rule validation; anchor-dependent revision dates are checked by resolution. */
export function validateRecurringRule(value) {
    if (!isPlainObject(value) || !hasOnlyKeys(value, RULE_KEYS) || !isUuid(value.operationId) || !isCadence(value.cadence))
        return fail("invalid-rule");
    const end = Object.hasOwn(value, "end") ? endValue(value.end, "invalid-rule") : undefined;
    let overrides;
    if (Object.hasOwn(value, "overrides")) {
        if (!isPlainObject(value.overrides) || Reflect.ownKeys(value.overrides).length > MAX_RECURRING_OCCURRENCES)
            return fail("invalid-override");
        const items = {};
        for (const on of Reflect.ownKeys(value.overrides)) {
            if (!isCalendarDate(on))
                return fail("invalid-override");
            const raw = value.overrides[on];
            if (!isPlainObject(raw) || !hasOnlyKeys(raw, OVERRIDE_KEYS) || Reflect.ownKeys(raw).length !== 1)
                return fail("invalid-override");
            if (Object.hasOwn(raw, "amountMinor") && isMinor(raw.amountMinor))
                items[on] = Object.freeze({ amountMinor: raw.amountMinor });
            else if (raw.skipped === true)
                items[on] = Object.freeze({ skipped: true });
            else
                return fail("invalid-override");
        }
        overrides = Object.freeze(items);
    }
    let revisions;
    if (Object.hasOwn(value, "revisions")) {
        if (!Array.isArray(value.revisions) || value.revisions.length > 60)
            return fail("invalid-revision");
        const operations = new Set([value.operationId]);
        let previous = "";
        revisions = Object.freeze(value.revisions.map(raw => {
            if (!isPlainObject(raw) || !hasOnlyKeys(raw, REVISION_KEYS) || !isUuid(raw.operationId) || operations.has(raw.operationId) ||
                !isCalendarDate(raw.effectiveOn) || raw.effectiveOn <= previous || !isCadence(raw.cadence) || !isMinor(raw.amountMinor))
                return fail("invalid-revision");
            operations.add(raw.operationId);
            previous = raw.effectiveOn;
            return Object.freeze({ operationId: raw.operationId, effectiveOn: raw.effectiveOn, cadence: raw.cadence, amountMinor: raw.amountMinor,
                ...(Object.hasOwn(raw, "end") ? { end: endValue(raw.end, "invalid-revision") } : {}) });
        }));
    }
    return Object.freeze({ operationId: value.operationId, cadence: value.cadence, ...(end ? { end } : {}),
        ...(overrides ? { overrides } : {}), ...(revisions ? { revisions } : {}) });
}
function schedule(input) {
    const rule = validateRecurringRule(input.rule);
    if (!isCalendarDate(input.anchorOn) || !isMinor(input.amountMinor) || input.horizon !== undefined && !isCalendarDate(input.horizon))
        return fail("invalid-rule");
    if (rule.revisions?.some(revision => revision.effectiveOn <= input.anchorOn))
        return fail("invalid-revision");
    const [year, month, day] = input.anchorOn.split("-").map(Number);
    const anchorMonth = year * 12 + month - 1;
    const terms = [{ effectiveOn: input.anchorOn, cadence: rule.cadence, amountMinor: checkedMinor(input.amountMinor), end: rule.end }, ...rule.revisions ?? []];
    const occurrences = [];
    for (let index = 0; index < terms.length; index++) {
        const term = terms[index];
        const before = terms[index + 1]?.effectiveOn;
        const [fromYear, fromMonth] = term.effectiveOn.split("-").map(Number);
        const step = term.cadence === "monthly" ? 1 : 12;
        let offset = Math.max(0, fromYear * 12 + fromMonth - 1 - anchorMonth);
        offset = Math.ceil(offset / step) * step;
        let count = 0;
        while (occurrences.length < MAX_RECURRING_OCCURRENCES) {
            const target = anchorMonth + offset;
            const targetYear = Math.floor(target / 12);
            if (targetYear > 9999)
                break;
            const on = clampedMonthDate(targetYear, target % 12 + 1, day);
            offset += step;
            if (on < term.effectiveOn)
                continue;
            if (before !== undefined && on >= before || term.end && ("on" in term.end ? on > term.end.on : count >= term.end.count))
                break;
            count++;
            const override = rule.overrides?.[on];
            const occurrenceIndex = occurrences.length + 1;
            occurrences.push(Object.freeze({ id: `r${occurrenceIndex}`, index: occurrenceIndex, on,
                amountMinor: override?.amountMinor ?? term.amountMinor, overridden: override?.amountMinor !== undefined, skipped: override?.skipped === true }));
        }
        if (occurrences.length === MAX_RECURRING_OCCURRENCES)
            break;
    }
    return Object.freeze(occurrences);
}
/** Bounded local expansion. Without a horizon only the anchor date is listed. */
export function resolveRecurringSchedule(input) {
    const all = schedule(input), horizon = input.horizon ?? input.anchorOn;
    const next = all.find(occurrence => occurrence.on > horizon && !occurrence.skipped) ?? null;
    return Object.freeze({ occurrences: Object.freeze(all.filter(occurrence => occurrence.on <= horizon)), next, ended: next === null });
}
export function nextRecurringOccurrence(rule, anchorOn, amountMinor, asOf) {
    return resolveRecurringSchedule({ rule, anchorOn, amountMinor, horizon: asOf }).next;
}
/** Append complete terms and remove edits in the replaced future; history and its ids stay fixed. */
export function previewRecurringRevision(input) {
    if (!isCalendarDate(input.horizon) || !isCalendarDate(input.revision.effectiveOn) || input.revision.effectiveOn <= input.anchorOn ||
        input.revision.effectiveOn <= (input.rule.revisions?.at(-1)?.effectiveOn ?? ""))
        return fail("invalid-revision");
    const overrides = Object.fromEntries(Object.entries(input.rule.overrides ?? {}).filter(([on]) => on < input.revision.effectiveOn));
    const rule = validateRecurringRule({ ...input.rule, overrides, revisions: [...input.rule.revisions ?? [], input.revision] });
    const all = schedule({ ...input, rule });
    return Object.freeze({ kept: Object.freeze(all.filter(occurrence => occurrence.on < input.revision.effectiveOn)),
        next: Object.freeze(all.filter(occurrence => occurrence.on >= input.revision.effectiveOn).slice(0, 3)), rule });
}
