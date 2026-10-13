import { clampedMonthDate } from "./calendar.js";
import { checkedMinor, isCurrencyCode, splitMinor } from "./money.js";
import { hasOnlyKeys, isBoundedText, isCalendarDate, isPlainObject, STABLE_ID_PATTERN, UUID_PATTERN } from "./validation.js";
export class InstallmentPlanError extends Error {
    code;
    constructor(code) {
        super(`Installment plan: ${code}`);
        this.code = code;
        this.name = "InstallmentPlanError";
    }
}
export const MAX_INSTALLMENT_PERIODS = 360;
export const MAX_INSTALLMENT_FEES = 60;
export const MAX_INSTALLMENT_REVISIONS = 60;
export const MAX_PERIOD_EVIDENCE = 12;
export const FEE_LABEL_LIMIT = 40;
const PLAN_KEYS = new Set(["planId", "operationId", "currency", "totalMinor", "periods", "fees", "revisions"]);
const PERIOD_KEYS = new Set(["id", "on", "amountMinor", "evidence"]);
const FEE_KEYS = new Set(["id", "on", "amountMinor", "label"]);
const REVISION_KEYS = new Set(["operationId", "kind", "effectiveOn", "refundId", "periods"]);
const KINDS = new Set(["correction", "cancellation", "refund", "early-settlement"]);
const isUuid = (value) => typeof value === "string" && UUID_PATTERN.test(value);
const isStableId = (value) => typeof value === "string" && STABLE_ID_PATTERN.test(value);
const isPositiveSafe = (value) => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
function sumMinor(items) {
    return items.reduce((total, item) => checkedMinor(total + item.amountMinor), 0);
}
function periodList(value, allowEmpty, code, evidenceSeen) {
    const fail = () => { throw new InstallmentPlanError(code); };
    if (!Array.isArray(value) || value.length > MAX_INSTALLMENT_PERIODS || (!allowEmpty && value.length === 0))
        fail();
    const ids = new Set();
    let previous = "";
    return Object.freeze(value.map(raw => {
        if (!isPlainObject(raw) || !hasOnlyKeys(raw, PERIOD_KEYS))
            fail();
        const item = raw;
        if (!isStableId(item.id) || ids.has(item.id) || !isCalendarDate(item.on) || item.on <= previous || !isPositiveSafe(item.amountMinor))
            fail();
        ids.add(item.id);
        previous = item.on;
        let evidence;
        if (Object.hasOwn(item, "evidence")) {
            const list = item.evidence;
            if (!Array.isArray(list) || list.length === 0 || list.length > MAX_PERIOD_EVIDENCE)
                fail();
            for (const eventId of list) {
                if (!isUuid(eventId) || evidenceSeen.has(eventId))
                    fail();
                evidenceSeen.add(eventId);
            }
            evidence = Object.freeze([...list]);
        }
        return Object.freeze({ id: item.id, on: item.on, amountMinor: item.amountMinor, ...(evidence ? { evidence } : {}) });
    }));
}
function applyRevision(current, revision) {
    const fail = () => { throw new InstallmentPlanError("invalid-revision"); };
    const kept = current.filter(period => period.on < revision.effectiveOn);
    const previous = current.filter(period => period.on >= revision.effectiveOn);
    const keptIds = new Set(kept.map(period => period.id));
    if (revision.periods.some(period => period.on < revision.effectiveOn || keptIds.has(period.id)))
        fail();
    const previousFutureMinor = sumMinor(previous);
    const revisedFutureMinor = sumMinor(revision.periods);
    const hasRefund = revision.refundId !== undefined;
    switch (revision.kind) {
        case "cancellation":
            if (revision.periods.length !== 0 || previous.length === 0)
                fail();
            break;
        case "early-settlement":
            if (previous.length === 0 || revision.periods.length !== 1 || revision.periods[0].on !== revision.effectiveOn ||
                (hasRefund ? revisedFutureMinor > previousFutureMinor : revisedFutureMinor !== previousFutureMinor))
                fail();
            break;
        case "refund":
            if (!hasRefund || revisedFutureMinor > previousFutureMinor)
                fail();
            break;
        case "correction":
            if (hasRefund)
                fail();
            break;
    }
    return {
        periods: Object.freeze([...kept, ...revision.periods]),
        step: Object.freeze({
            revision, keptMinor: sumMinor(kept), previousFutureMinor, revisedFutureMinor,
            canceledFutureMinor: previousFutureMinor - revisedFutureMinor,
        }),
    };
}
/** Apply a structurally valid plan's revisions in order. Throws `InstallmentPlanError("invalid-revision")`. */
export function resolveInstallmentSchedule(plan) {
    let periods = plan.periods;
    const steps = [];
    for (const revision of plan.revisions ?? []) {
        const applied = applyRevision(periods, revision);
        periods = applied.periods;
        steps.push(applied.step);
    }
    return Object.freeze({ periods, steps: Object.freeze(steps) });
}
/** Strict validator for a stored plan, including revision simulation. Throws `InstallmentPlanError`. */
export function validateInstallmentPlan(value) {
    const fail = (code = "invalid-plan") => { throw new InstallmentPlanError(code); };
    if (!isPlainObject(value) || !hasOnlyKeys(value, PLAN_KEYS))
        return fail();
    const item = value;
    if (!isUuid(item.planId) || !isUuid(item.operationId) || !isCurrencyCode(item.currency) || !isPositiveSafe(item.totalMinor))
        fail();
    const evidence = new Set();
    const periods = periodList(item.periods, false, "invalid-plan", evidence);
    if (sumMinor(periods) !== item.totalMinor)
        fail();
    let fees;
    if (Object.hasOwn(item, "fees")) {
        if (!Array.isArray(item.fees) || item.fees.length === 0 || item.fees.length > MAX_INSTALLMENT_FEES)
            fail();
        const ids = new Set();
        fees = Object.freeze(item.fees.map(raw => {
            if (!isPlainObject(raw) || !hasOnlyKeys(raw, FEE_KEYS))
                fail();
            const fee = raw;
            if (!isStableId(fee.id) || ids.has(fee.id) || !isCalendarDate(fee.on) || !isPositiveSafe(fee.amountMinor) ||
                (Object.hasOwn(fee, "label") && !isBoundedText(fee.label, FEE_LABEL_LIMIT)))
                fail();
            ids.add(fee.id);
            return Object.freeze({ id: fee.id, on: fee.on, amountMinor: fee.amountMinor,
                ...(Object.hasOwn(fee, "label") ? { label: fee.label } : {}) });
        }));
    }
    let revisions;
    if (Object.hasOwn(item, "revisions")) {
        if (!Array.isArray(item.revisions) || item.revisions.length === 0 || item.revisions.length > MAX_INSTALLMENT_REVISIONS)
            fail();
        const operations = new Set();
        const refunds = new Set();
        let previous = "";
        revisions = Object.freeze(item.revisions.map(raw => {
            if (!isPlainObject(raw) || !hasOnlyKeys(raw, REVISION_KEYS))
                fail("invalid-revision");
            const revision = raw;
            if (!isUuid(revision.operationId) || operations.has(revision.operationId) || typeof revision.kind !== "string" ||
                !KINDS.has(revision.kind) || !isCalendarDate(revision.effectiveOn) || revision.effectiveOn < previous)
                fail("invalid-revision");
            if (Object.hasOwn(revision, "refundId") && (!isUuid(revision.refundId) || refunds.has(revision.refundId)))
                fail("invalid-revision");
            operations.add(revision.operationId);
            if (Object.hasOwn(revision, "refundId"))
                refunds.add(revision.refundId);
            previous = revision.effectiveOn;
            return Object.freeze({
                operationId: revision.operationId, kind: revision.kind, effectiveOn: revision.effectiveOn,
                ...(Object.hasOwn(revision, "refundId") ? { refundId: revision.refundId } : {}),
                periods: periodList(revision.periods, true, "invalid-revision", evidence),
            });
        }));
    }
    const plan = Object.freeze({
        planId: item.planId, operationId: item.operationId, currency: item.currency,
        totalMinor: item.totalMinor, periods, ...(fees ? { fees } : {}), ...(revisions ? { revisions } : {}),
    });
    resolveInstallmentSchedule(plan);
    return plan;
}
/**
 * `count` monthly dates from `firstOn`, keeping its day of month and clamping to each month's last
 * day (2028-01-31 -> 2028-02-29 -> 2028-03-31; 2027-01-31 -> 2027-02-28). Pure calendar arithmetic.
 */
export function monthlyScheduleDates(firstOn, count) {
    if (!isCalendarDate(firstOn) || !Number.isSafeInteger(count) || count < 1 || count > MAX_INSTALLMENT_PERIODS) {
        throw new InstallmentPlanError("invalid-plan");
    }
    const [year, month, day] = firstOn.split("-").map(Number);
    const dates = [];
    for (let index = 0; index < count; index++) {
        const monthIndex = month - 1 + index;
        const targetYear = year + Math.floor(monthIndex / 12);
        const targetMonth = (monthIndex % 12) + 1;
        if (targetYear > 9999)
            throw new InstallmentPlanError("invalid-plan");
        dates.push(clampedMonthDate(targetYear, targetMonth, day));
    }
    return Object.freeze(dates);
}
/**
 * Purchase-to-plan conversion: an equal monthly schedule with ids `p1..pN`. Remainder placement
 * follows `splitMinor`: the earliest periods absorb the leftover minor units, one each
 * (JPY 10,000 / 3 -> 3,334, 3,333, 3,333). Store the result in the purchase's own details.
 */
export function createMonthlyInstallmentPlan(input) {
    const dates = monthlyScheduleDates(input.firstOn, input.count);
    const amounts = splitMinor(checkedMinor(input.totalMinor, true), input.count);
    if (amounts.some(amount => amount === 0))
        throw new InstallmentPlanError("invalid-plan");
    return validateInstallmentPlan({
        planId: input.planId, operationId: input.operationId, currency: input.currency, totalMinor: input.totalMinor,
        periods: dates.map((on, index) => ({ id: `p${index + 1}`, on, amountMinor: amounts[index] })),
        ...(input.fees !== undefined ? { fees: input.fees } : {}),
    });
}
const ALLOCATION_KEYS = new Set(["currency", "originalMinor", "futureMinor", "operationId"]);
/** Strict validator; throws `InstallmentPlanError("allocation-mismatch")`. */
export function validateRefundAllocation(value) {
    const fail = () => { throw new InstallmentPlanError("allocation-mismatch"); };
    if (!isPlainObject(value) || !hasOnlyKeys(value, ALLOCATION_KEYS))
        return fail();
    if (!isCurrencyCode(value.currency) || !isPositiveSafe(value.originalMinor) || !isUuid(value.operationId))
        fail();
    if (Object.hasOwn(value, "futureMinor") && (!isPositiveSafe(value.futureMinor) || value.futureMinor > value.originalMinor))
        fail();
    return Object.freeze({
        currency: value.currency, originalMinor: value.originalMinor,
        ...(Object.hasOwn(value, "futureMinor") ? { futureMinor: value.futureMinor } : {}), operationId: value.operationId,
    });
}
/** Credit against recognized cost: `originalMinor - futureMinor`. */
export function allocationCreditMinor(allocation) {
    return allocation.originalMinor - (allocation.futureMinor ?? 0);
}
/**
 * Preview a correction/cancellation/refund/early-settlement revision and check conservation.
 * Refuses (throws `InstallmentPlanError`) a structurally invalid revision, a refund in another
 * currency, an allocation whose `futureMinor` differs from the canceled future or whose
 * `originalMinor` differs from the stated refund amount, and a credit exceeding cost recognized
 * before `effectiveOn` (kept periods and fees) less prior credits. A canceled future amount is
 * never also credited as a recognized refund.
 */
export function previewInstallmentRevision(input) {
    if (!isCalendarDate(input.asOf))
        throw new InstallmentPlanError("invalid-revision");
    const plan = validateInstallmentPlan({ ...input.plan, revisions: [...input.plan.revisions ?? [], input.revision] });
    const { periods, steps } = resolveInstallmentSchedule(plan);
    const step = steps[steps.length - 1];
    const fees = plan.fees ?? [];
    const priorCredit = checkedMinor(input.priorCreditMinor ?? 0);
    let creditMinor = 0;
    if ((input.revision.refundId !== undefined) !== (input.refund !== undefined))
        throw new InstallmentPlanError("invalid-revision");
    if (input.refund !== undefined) {
        const refund = input.refund;
        if (refund.currency !== plan.currency || (refund.allocation !== undefined && refund.allocation.currency !== plan.currency)) {
            throw new InstallmentPlanError("currency-mismatch");
        }
        const allocation = refund.allocation;
        if ((allocation?.originalMinor ?? refund.amountMinor) !== refund.amountMinor ||
            (allocation?.futureMinor ?? 0) !== step.canceledFutureMinor)
            throw new InstallmentPlanError("allocation-mismatch");
        creditMinor = refund.amountMinor - step.canceledFutureMinor;
        const recognizedBefore = step.keptMinor + sumMinor(fees.filter(fee => fee.on < input.revision.effectiveOn));
        if (creditMinor + priorCredit > recognizedBefore)
            throw new InstallmentPlanError("over-allocation");
    }
    const credits = priorCredit + creditMinor;
    const adjustedCostMinor = plan.totalMinor + sumMinor(fees) - steps.reduce((total, item) => total + item.canceledFutureMinor, 0) - credits;
    const dated = [...periods, ...fees];
    const recognizedNetMinor = sumMinor(dated.filter(item => item.on <= input.asOf)) - credits;
    const futureMinor = sumMinor(dated.filter(item => item.on > input.asOf));
    return Object.freeze({
        plan, schedule: periods, step, creditMinor,
        conservation: Object.freeze({ adjustedCostMinor, recognizedNetMinor, futureMinor, holds: recognizedNetMinor + futureMinor === adjustedCostMinor }),
    });
}
