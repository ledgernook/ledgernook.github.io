import { defaultUserRulesDocument, LedgerDetailsValidationError, validateLedgerObjectAtPath, validateUserRulesDocument } from "../core/index.js";
import { applyRuleOperation, ruleOperationSatisfied, ruleOperationTargetValue } from "../core/rule-operations.js";
export const ATOMIC_DETAIL_FIELDS = new Set(["correction", "subscription", "valuation", "refundAllocation", "installmentPlan", "split", "recurring"]);
export function valuesEqual(left, right) {
    if (left === right)
        return true;
    if (Array.isArray(left) && Array.isArray(right))
        return left.length === right.length && left.every((value, index) => valuesEqual(value, right[index]));
    if (isRecord(left) && isRecord(right)) {
        const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
        return [...keys].every(key => valuesEqual(left[key], right[key]));
    }
    return false;
}
function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
/** Only a continuous chain of this device's retained bases can supersede a desired value. */
function desiredIsPresent(desired, current, successors) {
    if (valuesEqual(desired, current))
        return true;
    let previous = desired;
    for (const successor of successors) {
        if (!valuesEqual(previous, successor.base))
            break;
        previous = successor.desired;
        if (valuesEqual(previous, current))
            return true;
    }
    return false;
}
function childSuccessors(successors, key) {
    return successors.map(value => ({ base: isRecord(value.base) ? value.base[key] : undefined,
        desired: isRecord(value.desired) ? value.desired[key] : undefined }));
}
/** One conservative leaf merge. Arrays and the economic/detail groups are atomic values. */
export function mergeObject(base, desired, current, revisionKey, acceptDesired = true, successors = []) {
    const absent = Symbol("absent"), conflict = Symbol("conflict");
    const equal = acceptDesired ? valuesEqual : (left, right) => JSON.stringify(left) === JSON.stringify(right);
    if (revisionKey === "operationId" && isRecord(base) && isRecord(desired) && isRecord(current) && !equal(base.split, desired.split)) {
        if (["split", "categoryId", "installmentPlan", "voided", "refundOf"].some(key => !equal(base[key], current[key]) &&
            !(acceptDesired && desiredIsPresent(desired[key], current[key], childSuccessors(successors, key)))))
            return null;
        const money = (value) => isRecord(value.correction)
            ? [value.correction.amountMinor, value.correction.currency] : [undefined, undefined];
        if (!equal(money(base), money(current)) && !(acceptDesired && desiredIsPresent(money(desired), money(current), successors.map(value => ({ base: isRecord(value.base) ? money(value.base) : undefined, desired: isRecord(value.desired) ? money(value.desired) : undefined })))))
            return null;
    }
    function merge(oldValue, newValue, liveValue, top, later) {
        if (equal(oldValue, newValue))
            return liveValue === undefined ? absent : liveValue;
        if (acceptDesired && desiredIsPresent(newValue, liveValue, later))
            return liveValue === undefined ? absent : liveValue;
        if (isRecord(oldValue) && isRecord(newValue) && isRecord(liveValue)) {
            const result = { ...liveValue };
            let changed = false;
            for (const key of new Set([...Object.keys(oldValue), ...Object.keys(newValue)])) {
                if (top && key === revisionKey)
                    continue;
                let next;
                if (top && revisionKey === "operationId" && ATOMIC_DETAIL_FIELDS.has(key)) {
                    if (equal(oldValue[key], newValue[key]))
                        continue;
                    const present = acceptDesired && desiredIsPresent(newValue[key], liveValue[key], childSuccessors(later, key));
                    if (!equal(oldValue[key], liveValue[key]) && !present)
                        return conflict;
                    const value = present ? liveValue[key] : newValue[key];
                    next = value === undefined ? absent : value;
                }
                else
                    next = merge(oldValue[key], newValue[key], liveValue[key], false, childSuccessors(later, key));
                if (next === conflict || !acceptDesired && next === null)
                    return conflict;
                if (!equal(next === absent ? undefined : next, liveValue[key]))
                    changed = true;
                if (next === absent)
                    delete result[key];
                else
                    result[key] = next;
            }
            // No new semantic leaf means the live revision already contains this change.
            if (revisionKey && top && (!acceptDesired || changed))
                result[revisionKey] = newValue[revisionKey];
            return result;
        }
        if (!equal(oldValue, liveValue))
            return conflict;
        return newValue === undefined ? absent : newValue;
    }
    const result = merge(base, desired, current, true, successors);
    return result === absent || result === conflict ? null : result;
}
/** Replay one path against the cumulative ledger; decoded values decide, never synthetic identities. */
export function replayWrite(write, base, current, ruleOperation, successors = []) {
    const desired = write.value;
    const later = successors.map(value => ({ base: value.base?.value ?? null, desired: value.write.value }));
    if (ruleOperation && write.path === "rules/user.json") {
        try {
            const live = (current ?? defaultUserRulesDocument());
            const target = (value) => ruleOperationTargetValue(validateUserRulesDocument(value ?? defaultUserRulesDocument()), ruleOperation);
            if (desiredIsPresent(target(desired), target(live), later.map(value => ({ base: target(value.base), desired: target(value.desired) })))) {
                return { status: "done", value: live };
            }
            if (ruleOperationSatisfied(live, ruleOperation))
                return { status: "done", value: live };
            const value = applyRuleOperation(live, ruleOperation, (base?.value ?? defaultUserRulesDocument()));
            return { status: valuesEqual(live, value) ? "done" : "applied", value };
        }
        catch {
            return { status: "failed", reason: "conflict" };
        }
    }
    if (desiredIsPresent(desired, current, later))
        return { status: "done", value: current };
    if (write.path.startsWith("events/") && current !== null)
        return { status: "failed", reason: "conflict" };
    if (valuesEqual(current, base?.value ?? null) && !successors.length)
        return { status: "applied", value: desired };
    if (valuesEqual(current, base?.value ?? null) && (desired === null || current === null || base === null || write.strict || write.path.startsWith("events/"))) {
        return { status: "applied", value: desired };
    }
    if (desired === null || current === null || base === null || write.strict || write.path.startsWith("events/"))
        return { status: "failed", reason: "conflict" };
    const merged = mergeObject(base.value, desired, current, write.path.startsWith("details/") ? "operationId" : null, true, later);
    if (merged === null)
        return { status: "failed", reason: "conflict" };
    try {
        const value = validateLedgerObjectAtPath(write.path, merged).value;
        return { status: valuesEqual(current, value) ? "done" : "applied", value };
    }
    catch {
        return { status: "failed", reason: "invalid-object" };
    }
}
/** Failed intents keep their changed local leaves while unrelated current leaves remain visible. */
export function overlayLocalWrite(write, base, current) {
    if (write.value === null || base === null || current === null)
        return valuesEqual(base?.value ?? null, write.value) ? { ...write, value: current } : write;
    const detail = write.path.startsWith("details/");
    function overlay(old, desired, live, top = false) {
        if (valuesEqual(old, desired))
            return live;
        if (!isRecord(old) || !isRecord(desired) || !isRecord(live))
            return desired;
        const result = { ...live };
        for (const key of new Set([...Object.keys(old), ...Object.keys(desired)])) {
            if (top && detail && key === "operationId") {
                result[key] = desired[key];
                continue;
            }
            const value = top && detail && ATOMIC_DETAIL_FIELDS.has(key) && !valuesEqual(old[key], desired[key])
                ? desired[key] : overlay(old[key], desired[key], live[key]);
            if (value === undefined)
                delete result[key];
            else
                result[key] = value;
        }
        return result;
    }
    let value = overlay(base.value, write.value, current, true);
    for (let attempt = 0;; attempt++) {
        try {
            return { ...write, value: validateLedgerObjectAtPath(write.path, value).value };
        }
        catch (error) {
            if (!detail || !isRecord(value) || !isRecord(write.value) || !(error instanceof LedgerDetailsValidationError) || attempt >= 3)
                return write;
            // Restore only groups that cannot coexist, keeping unrelated current leaves.
            const fields = error.code === "invalid-split" ? ["split", "categoryId", "installmentPlan", "refundOf", "refundAllocation"]
                : error.code === "invalid-installment-plan" ? ["installmentPlan", "refundOf", "refundAllocation"]
                    : error.code === "invalid-refund-allocation" ? ["refundOf", "refundAllocation"] : null;
            if (!fields)
                return write;
            const preview = { ...value };
            for (const key of fields) {
                if (write.value[key] === undefined)
                    delete preview[key];
                else
                    preview[key] = write.value[key];
            }
            value = preview;
        }
    }
}
/** Composite edits force changed identities/keys, preserving all unrelated remote additions. */
function overlayUserRules(base, desired, current) {
    function items(old, next, live) {
        const before = new Map(old.map(item => [item.id, item])), after = new Map(next.map(item => [item.id, item]));
        const changed = new Set([...before.keys(), ...after.keys()].filter(id => !valuesEqual(before.get(id), after.get(id))));
        const result = live.flatMap(item => changed.has(item.id) ? after.has(item.id) ? [after.get(item.id)] : [] : [item]);
        const present = new Set(live.map(item => item.id));
        return [...result, ...next.filter(item => changed.has(item.id) && !present.has(item.id))];
    }
    function map(old = {}, next = {}, live = {}) {
        const result = { ...live };
        for (const key of new Set([...Object.keys(old), ...Object.keys(next)])) {
            if (valuesEqual(old[key], next[key]))
                continue;
            if (!Object.hasOwn(next, key))
                delete result[key];
            else
                result[key] = next[key];
        }
        return result;
    }
    const mergedCategories = map(base.mergedCategories, desired.mergedCategories, current.mergedCategories);
    return validateUserRulesDocument({ ...current, categories: items(base.categories, desired.categories, current.categories),
        brands: items(base.brands, desired.brands, current.brands), merchants: map(base.merchants, desired.merchants, current.merchants),
        brandCategories: map(base.brandCategories, desired.brandCategories, current.brandCategories),
        exceptions: map(base.exceptions, desired.exceptions, current.exceptions),
        ...(base.mergedCategories || desired.mergedCategories || current.mergedCategories ? { mergedCategories } : {}) });
}
/** Explicit resend forces only this intent's changes on the current value, then normal replay validates them. */
export function resendWrite(write, base, current, ruleOperation) {
    if (write.value === null || write.path.startsWith("events/"))
        return { status: "applied", value: write.value };
    if (write.path === "rules/user.json") {
        try {
            const live = validateUserRulesDocument(current);
            const value = ruleOperation ? applyRuleOperation(live, ruleOperation)
                : overlayUserRules(validateUserRulesDocument(base?.value), validateUserRulesDocument(write.value), live);
            return { status: "applied", value };
        }
        catch {
            return { status: "failed", reason: ruleOperation ? "conflict" : "invalid-object" };
        }
    }
    return { status: "applied", value: overlayLocalWrite(write, base, current).value };
}
