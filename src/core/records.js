import { localDateOf } from "./calendar.js";
import { RecurringRuleError, resolveRecurringSchedule, validateRecurringRule } from "./recurring.js";
import { NOTIFICATION_BANKS, paymentMethodName, PREFERENCES_PATH, validateLedgerPreferences } from "./preferences.js";
import { DESCRIPTION_LIMIT, eventOccurrence, eventPartition, ledgerEventsEqual, MERCHANT_LIMIT, PAYMENT_METHOD_LIMIT, validateLedgerEvent, sourceTwdValue, } from "./event.js";
import { allocationCreditMinor, InstallmentPlanError, resolveInstallmentSchedule, validateInstallmentPlan, validateRefundAllocation, } from "./installments.js";
import { addMinor, isCurrencyCode } from "./money.js";
import { validateRecordSplit } from "./splits.js";
import { UNRECORDED_PATH_PATTERN, unrecordedPath, validateUnrecordedNotification } from "./unrecorded.js";
import { canonicalCategoryId, mainCategoryId, resolveEventCategory, validateAiRule, validateUserRulesDocument, } from "./rules.js";
import { hasOnlyKeys, isBoundedText, isCalendarDate, isCanonicalUtcInstant, isPlainObject, STABLE_ID_PATTERN, UUID_PATTERN, } from "./validation.js";
import { cumulativeShares, proportionalMinor, validateSavedValuation, ValuationError } from "./valuation.js";
/**
 * Details extension fields: `valuation` (saved TWD valuation, `src/core/valuation.ts`),
 * `refundAllocation` and `installmentPlan` (`src/core/installments.ts`), `split` (`src/core/splits.ts`), `recurring` (`src/core/recurring.ts`).
 */
export const DETAIL_EXTENSION_FIELDS = Object.freeze(["valuation", "refundAllocation", "installmentPlan", "split", "recurring"]);
export class LedgerDetailsValidationError extends Error {
    code;
    constructor(code) {
        super(`Invalid ledger details: ${code}`);
        this.code = code;
        this.name = "LedgerDetailsValidationError";
    }
}
const DETAIL_KEYS = new Set(["schemaVersion", "eventId", "operationId", "correction", "voided", "aiConfirmed", "categoryId",
    "subscription", "projectId", "notes", "paymentMethodId", "paymentMethodLabel", "refundOf", ...DETAIL_EXTENSION_FIELDS]);
const CORRECTION_KEYS = new Set(["amountMinor", "currency", "occurredAt", "occurredOn", "merchant", "description"]);
const SUBSCRIPTION_KEYS = new Set(["note"]);
export const NOTES_LIMIT = 500;
export const SUBSCRIPTION_NOTE_LIMIT = 120;
export function validateLedgerDetails(value) {
    const fail = (code) => { throw new LedgerDetailsValidationError(code); };
    if (!isPlainObject(value))
        fail("invalid-object");
    const record = value;
    if (!hasOnlyKeys(record, DETAIL_KEYS))
        fail("unexpected-field");
    if (record.schemaVersion !== 1)
        fail("unsupported-schema-version");
    if (typeof record.eventId !== "string" || !UUID_PATTERN.test(record.eventId))
        fail("invalid-event-id");
    if (typeof record.operationId !== "string" || !UUID_PATTERN.test(record.operationId))
        fail("invalid-operation-id");
    let correction;
    if (Object.hasOwn(record, "correction")) {
        const raw = record.correction;
        if (!isPlainObject(raw) || !hasOnlyKeys(raw, CORRECTION_KEYS) || Reflect.ownKeys(raw).length === 0)
            fail("invalid-correction");
        const item = raw;
        const has = (key) => Object.hasOwn(item, key);
        if (has("amountMinor") && (typeof item.amountMinor !== "number" || !Number.isSafeInteger(item.amountMinor) || item.amountMinor <= 0))
            fail("invalid-amount");
        if (has("currency") && !isCurrencyCode(item.currency))
            fail("unsupported-currency");
        if (has("currency") && !has("amountMinor"))
            fail("invalid-correction");
        if (has("occurredAt") && has("occurredOn"))
            fail("invalid-correction");
        if (has("occurredAt") && !isCanonicalUtcInstant(item.occurredAt))
            fail("invalid-time");
        if (has("occurredOn") && !isCalendarDate(item.occurredOn))
            fail("invalid-date");
        if (has("merchant") && !isBoundedText(item.merchant, MERCHANT_LIMIT))
            fail("invalid-merchant");
        if (has("description") && !isBoundedText(item.description, DESCRIPTION_LIMIT))
            fail("invalid-description");
        correction = Object.freeze({
            ...(has("amountMinor") ? { amountMinor: item.amountMinor } : {}),
            ...(has("currency") ? { currency: item.currency } : {}),
            ...(has("occurredAt") ? { occurredAt: item.occurredAt } : {}),
            ...(has("occurredOn") ? { occurredOn: item.occurredOn } : {}),
            ...(has("merchant") ? { merchant: item.merchant } : {}),
            ...(has("description") ? { description: item.description } : {}),
        });
    }
    if (Object.hasOwn(record, "voided") && record.voided !== true)
        fail("invalid-void");
    if (Object.hasOwn(record, "aiConfirmed") && record.aiConfirmed !== true)
        fail("invalid-ai-confirmation");
    if (Object.hasOwn(record, "categoryId") && !isStableId(record.categoryId))
        fail("invalid-category");
    let subscription;
    if (Object.hasOwn(record, "subscription")) {
        const raw = record.subscription;
        if (!isPlainObject(raw) || !hasOnlyKeys(raw, SUBSCRIPTION_KEYS) ||
            (Object.hasOwn(raw, "note") && !isBoundedText(raw.note, SUBSCRIPTION_NOTE_LIMIT)))
            fail("invalid-subscription");
        const marker = raw;
        subscription = Object.freeze(Object.hasOwn(marker, "note") ? { note: marker.note } : {});
    }
    if (Object.hasOwn(record, "projectId") && !isStableId(record.projectId))
        fail("invalid-project");
    if (Object.hasOwn(record, "notes") && !isBoundedText(record.notes, NOTES_LIMIT))
        fail("invalid-notes");
    if (Object.hasOwn(record, "paymentMethodId") && !isStableId(record.paymentMethodId))
        fail("invalid-payment-method");
    if (Object.hasOwn(record, "paymentMethodLabel") && !isBoundedText(record.paymentMethodLabel, PAYMENT_METHOD_LIMIT))
        fail("invalid-payment-method");
    if (Object.hasOwn(record, "refundOf") &&
        (typeof record.refundOf !== "string" || !UUID_PATTERN.test(record.refundOf) || record.refundOf === record.eventId))
        fail("invalid-refund-link");
    let valuation;
    if (Object.hasOwn(record, "valuation")) {
        try {
            valuation = validateSavedValuation(record.valuation);
        }
        catch (error) {
            if (error instanceof ValuationError)
                fail("invalid-valuation");
            throw error;
        }
    }
    let refundAllocation;
    if (Object.hasOwn(record, "refundAllocation")) {
        if (!Object.hasOwn(record, "refundOf"))
            fail("invalid-refund-allocation");
        try {
            refundAllocation = validateRefundAllocation(record.refundAllocation);
        }
        catch (error) {
            if (error instanceof InstallmentPlanError)
                fail("invalid-refund-allocation");
            throw error;
        }
    }
    let installmentPlan;
    if (Object.hasOwn(record, "installmentPlan")) {
        if (Object.hasOwn(record, "refundOf"))
            fail("invalid-installment-plan");
        try {
            installmentPlan = validateInstallmentPlan(record.installmentPlan);
        }
        catch (error) {
            if (error instanceof InstallmentPlanError)
                fail("invalid-installment-plan");
            throw error;
        }
        const plan = installmentPlan;
        const linked = [...plan.periods, ...(plan.revisions ?? []).flatMap(revision => revision.periods)].flatMap(period => period.evidence ?? []);
        if (linked.includes(record.eventId) || (plan.revisions ?? []).some(revision => revision.refundId === record.eventId)) {
            fail("invalid-installment-plan");
        }
    }
    let split;
    if (Object.hasOwn(record, "split")) {
        if (["categoryId", "installmentPlan", "refundOf"].some(key => Object.hasOwn(record, key)))
            fail("invalid-split");
        try {
            split = validateRecordSplit(record.split);
        }
        catch {
            fail("invalid-split");
        }
    }
    let recurring;
    if (Object.hasOwn(record, "recurring")) {
        if (["installmentPlan", "split", "refundOf"].some(key => Object.hasOwn(record, key)))
            fail("invalid-recurring");
        try {
            recurring = validateRecurringRule(record.recurring);
        }
        catch (error) {
            if (error instanceof RecurringRuleError)
                fail("invalid-recurring");
            throw error;
        }
    }
    return Object.freeze({
        schemaVersion: 1,
        eventId: record.eventId,
        operationId: record.operationId,
        ...(correction ? { correction } : {}),
        ...(Object.hasOwn(record, "voided") ? { voided: true } : {}),
        ...(Object.hasOwn(record, "aiConfirmed") ? { aiConfirmed: true } : {}),
        ...(Object.hasOwn(record, "categoryId") ? { categoryId: record.categoryId } : {}),
        ...(subscription ? { subscription } : {}),
        ...(Object.hasOwn(record, "projectId") ? { projectId: record.projectId } : {}),
        ...(Object.hasOwn(record, "notes") ? { notes: record.notes } : {}),
        ...(Object.hasOwn(record, "paymentMethodId") ? { paymentMethodId: record.paymentMethodId } : {}),
        ...(Object.hasOwn(record, "paymentMethodLabel") ? { paymentMethodLabel: record.paymentMethodLabel } : {}),
        ...(Object.hasOwn(record, "refundOf") ? { refundOf: record.refundOf } : {}),
        ...(valuation ? { valuation } : {}),
        ...(refundAllocation ? { refundAllocation } : {}),
        ...(installmentPlan ? { installmentPlan } : {}),
        ...(split ? { split } : {}),
        ...(recurring ? { recurring } : {}),
    });
}
export class ProjectValidationError extends Error {
    code;
    constructor(code) {
        super(`Invalid project: ${code}`);
        this.code = code;
        this.name = "ProjectValidationError";
    }
}
const PROJECT_KEYS = new Set(["schemaVersion", "id", "label", "archived", "includeInDaily"]);
export const PROJECT_LABEL_LIMIT = 40;
export function validateProject(value) {
    if (!isPlainObject(value))
        throw new ProjectValidationError("invalid-object");
    if (!hasOnlyKeys(value, PROJECT_KEYS))
        throw new ProjectValidationError("unexpected-field");
    if (value.schemaVersion !== 1)
        throw new ProjectValidationError("unsupported-schema-version");
    if (!isStableId(value.id))
        throw new ProjectValidationError("invalid-id");
    if (!isBoundedText(value.label, PROJECT_LABEL_LIMIT))
        throw new ProjectValidationError("invalid-label");
    if (typeof value.archived !== "boolean")
        throw new ProjectValidationError("invalid-archived");
    if (Object.hasOwn(value, "includeInDaily") && typeof value.includeInDaily !== "boolean")
        throw new ProjectValidationError("invalid-daily");
    return Object.freeze({ schemaVersion: 1, id: value.id, label: value.label, archived: value.archived,
        ...(Object.hasOwn(value, "includeInDaily") ? { includeInDaily: value.includeInDaily } : {}) });
}
export function projectPath(projectId) {
    if (!isStableId(projectId))
        throw new ProjectValidationError("invalid-id");
    return `projects/${projectId}.json`;
}
function isStableId(value) { return typeof value === "string" && STABLE_ID_PATTERN.test(value); }
// ---------------------------------------------------------------------------------------------
// Repository paths
// ---------------------------------------------------------------------------------------------
export const USER_RULES_PATH = "rules/user.json";
export class LedgerPathError extends Error {
    code;
    constructor(code) {
        super(`Ledger object path: ${code}`);
        this.code = code;
        this.name = "LedgerPathError";
    }
}
const RECORD_PATH = /^(events|details)\/v1\/(\d{4})\/(0[1-9]|1[0-2])\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.json$/;
const AI_PATH = /^rules\/ai\/([0-9a-f]{64})\.json$/;
export const PROJECT_PATH_PATTERN = /^projects\/([a-z0-9][a-z0-9-]{0,39})\.json$/;
/**
 * Validate a decoded repository object against the schema its path selects and check the
 * identity/path relationship. Detail anchors are checked against their source by assembly.
 */
export function validateLedgerObjectAtPath(path, body) {
    if (UNRECORDED_PATH_PATTERN.test(path)) {
        const value = validateUnrecordedNotification(body);
        if (unrecordedPath(value) !== path)
            throw new LedgerPathError("path-mismatch");
        return Object.freeze({ kind: "unrecorded", path, value });
    }
    const record = RECORD_PATH.exec(path);
    if (record) {
        const partition = `${record[2]}/${record[3]}`;
        if (record[1] === "events") {
            const value = validateLedgerEvent(body);
            if (value.id !== record[4] || eventPartition(value) !== partition)
                throw new LedgerPathError("path-mismatch");
            return Object.freeze({ kind: "source", path, value });
        }
        const value = validateLedgerDetails(body);
        if (value.eventId !== record[4])
            throw new LedgerPathError("path-mismatch");
        return Object.freeze({ kind: "detail", path, partition, value });
    }
    if (path === PREFERENCES_PATH)
        return Object.freeze({ kind: "preferences", path, value: validateLedgerPreferences(body) });
    if (path === USER_RULES_PATH)
        return Object.freeze({ kind: "user-rules", path, value: validateUserRulesDocument(body) });
    const ai = AI_PATH.exec(path);
    if (ai)
        return Object.freeze({ kind: "ai-rule", path, merchantHash: ai[1], value: validateAiRule(body) });
    const project = PROJECT_PATH_PATTERN.exec(path);
    if (project) {
        const value = validateProject(body);
        if (value.id !== project[1])
            throw new LedgerPathError("path-mismatch");
        return Object.freeze({ kind: "project", path, value });
    }
    throw new LedgerPathError("unknown-path");
}
/** Shared identity resolution for records and the manual-entry default. */
export function effectivePaymentMethod(source, details, preferences) {
    const label = details?.paymentMethodLabel ?? source.paymentMethodLabel;
    const methodId = details?.paymentMethodId ?? source.paymentMethodId;
    const selected = preferences?.paymentMethods.find(method => method.id === methodId);
    const selectedBank = NOTIFICATION_BANKS.find(bank => bank.id === methodId);
    return Object.freeze(details?.paymentMethodId === undefined && details?.paymentMethodLabel !== undefined ? { key: `label:${label}`, label: label }
        : methodId !== undefined ? {
            id: methodId, key: selectedBank ? `bank:${selectedBank.id}` : `method:${methodId}`,
            ...(selectedBank ? { bankId: selectedBank.id } : {}),
            label: selected ? paymentMethodName(selected) : selectedBank?.label ?? (details?.paymentMethodId === undefined ? label : undefined) ?? methodId,
        } : label !== undefined ? { key: `label:${label}`, label }
            : source.bankId !== undefined ? { key: `bank:${source.bankId}`, bankId: source.bankId } : { key: "none" });
}
/** Recurring methods require loaded preferences even for cash. */
export function recurringMethodValid(method, preferences) {
    return preferences !== undefined && (method.key === "method:cash" || preferences.paymentMethods.some(item => item.kind === "custom" && method.key === `method:${item.id}`));
}
/** Confirmation lives in details; voiding alone does not confirm AI parsing. */
export function isRecordAiPending(record) {
    return record.source.aiParsed === true && record.details?.aiConfirmed !== true;
}
/** Pure assembly of effective records. Inputs must already be validator outputs. */
export function assembleEffectiveLedger(input) {
    const gaps = [];
    const gap = (code, eventId, targetId) => gaps.push(Object.freeze(targetId === undefined ? { code, eventId } : { code, eventId, targetId }));
    // Same-source retry yields one record; same id with different facts is a visible conflict.
    const sources = new Map();
    const conflictedSources = new Set();
    for (const source of input.sources) {
        const existing = sources.get(source.id);
        if (existing === undefined)
            sources.set(source.id, source);
        else if (!ledgerEventsEqual(existing, source))
            conflictedSources.add(source.id);
    }
    for (const id of conflictedSources) {
        sources.delete(id);
        gap("conflicting-source", id);
    }
    const details = new Map();
    const conflictedDetails = new Set();
    for (const entry of input.details) {
        const existing = details.get(entry.value.eventId);
        if (existing === undefined)
            details.set(entry.value.eventId, entry);
        else if (existing.partition !== entry.partition || JSON.stringify(existing.value) !== JSON.stringify(entry.value)) {
            conflictedDetails.add(entry.value.eventId);
        }
    }
    for (const id of conflictedDetails) {
        details.delete(id);
        gap("conflicting-detail", id);
    }
    for (const [id, entry] of details) {
        const source = sources.get(id);
        if (source === undefined) {
            if (!conflictedSources.has(id))
                gap("detail-without-source", id);
        }
        else if (eventPartition(source) !== entry.partition)
            gap("detail-anchor-mismatch", id);
    }
    const projects = new Map();
    const conflictedProjects = new Set();
    for (const project of input.projects) {
        const existing = projects.get(project.id);
        if (existing === undefined)
            projects.set(project.id, project);
        else if (JSON.stringify(existing) !== JSON.stringify(project))
            conflictedProjects.add(project.id);
    }
    for (const id of conflictedProjects) {
        projects.delete(id);
        gap("conflicting-project", id);
    }
    const rules = input.userRules;
    const drafts = new Map();
    for (const id of [...sources.keys()].sort(compareText)) {
        if (conflictedDetails.has(id))
            continue;
        const source = sources.get(id);
        const detail = details.get(id);
        // A mis-anchored detail is not applied: the record keeps its source facts and the gap is reported.
        const applied = detail !== undefined && detail.partition === eventPartition(source) ? detail.value : null;
        drafts.set(id, baseRecord(source, applied, rules, input.aiRules, gap, input.preferences));
    }
    for (const record of drafts.values()) {
        const projectId = record.details?.projectId;
        if (projectId !== undefined && !projects.has(projectId)) {
            if (!record.voided)
                gap("unknown-project", record.id, projectId);
            // Deleted projects may remain named by retained details, but voided records show no project.
            record.projectId = null;
        }
    }
    // Later notifications explicitly linked to a period are evidence, not another expense.
    for (const record of drafts.values()) {
        for (const period of record.installment?.schedule ?? []) {
            for (const evidenceId of period.evidence ?? []) {
                const target = drafts.get(evidenceId);
                if (target === undefined || target.kind !== "expense" || target.installment !== null || target.split !== null || target.details?.recurring !== undefined || target.evidenceOf !== null) {
                    gap("installment-evidence-invalid", record.id, evidenceId);
                    continue;
                }
                target.evidenceOf = Object.freeze({ purchaseId: record.id, planId: record.installment.plan.planId, periodId: period.id });
            }
        }
    }
    // Refund links: validity, inherited category/project/subscription, allocation.
    const refundedBy = new Map();
    for (const record of drafts.values()) {
        const link = record.details?.refundOf;
        if (link === undefined)
            continue;
        if (record.kind !== "refund") {
            gap("refund-link-on-expense", record.id, link);
            continue;
        }
        const target = drafts.get(link);
        if (target === undefined) {
            gap("refund-target-missing", record.id, link);
            continue;
        }
        if (target.kind !== "expense") {
            gap("refund-target-not-expense", record.id, link);
            continue;
        }
        if (target.voided) {
            gap("refund-target-voided", record.id, link);
            continue;
        }
        if (target.details?.recurring) {
            gap("refund-target-recurring", record.id, link);
            continue;
        }
        record.refundOf = link;
        if (record.categorySource !== "detail" && record.categorySource !== "exception") {
            record.categoryId = target.categoryId;
            record.mainCategoryId = target.mainCategoryId;
            record.categorySource = "refund-link";
        }
        if (record.details?.projectId === undefined)
            record.projectId = target.projectId;
        if (record.details?.subscription === undefined)
            record.subscription = target.subscription;
        const sameCurrency = target.currency === record.currency;
        const allocation = record.details?.refundAllocation;
        if (allocation !== undefined) {
            const valid = allocation.currency === target.currency && (!sameCurrency || allocation.originalMinor === record.amountMinor) &&
                (allocation.futureMinor === undefined || (sameCurrency && target.installment !== null));
            if (valid)
                record.refundAllocation = allocation;
            else
                gap("refund-allocation-invalid", record.id, link);
        }
        if (record.refundAllocation !== null)
            record.refundCreditMinor = allocationCreditMinor(record.refundAllocation);
        else if (sameCurrency)
            record.refundCreditMinor = record.amountMinor;
        else
            gap("refund-currency-mismatch", record.id, link);
        if (!record.voided)
            refundedBy.set(link, [...refundedBy.get(link) ?? [], record]);
    }
    // Credits, over-refund and counted refund values on the purchase's saved basis (cumulative, no drift).
    const refundValues = new Map();
    for (const [purchaseId, unsorted] of refundedBy) {
        const purchase = drafts.get(purchaseId);
        const refunds = [...unsorted].sort(compareRecords);
        const credited = refunds.filter(refund => refund.refundCreditMinor !== null);
        const credits = credited.reduce((total, refund) => addMinor(total, refund.refundCreditMinor), 0);
        if (credits > (purchase.installment?.costMinor ?? purchase.amountMinor))
            gap("over-refund", purchaseId);
        const basis = purchase.reportingValue;
        const shares = basis === null ? null : cumulativeShares(basis.amountMinor, purchase.amountMinor, credited.map(refund => refund.refundCreditMinor));
        for (const refund of refunds) {
            const index = credited.indexOf(refund);
            const future = refund.refundAllocation?.futureMinor !== undefined;
            const amountMinor = refund.currency === purchase.currency && refund.refundCreditMinor !== null ? refund.refundCreditMinor : refund.amountMinor;
            const own = refund.reportingValue;
            let value;
            if (refund.currency === "TWD")
                value = Object.freeze({ amountMinor, basis: "native", estimated: false });
            else if (!future && own !== null && !own.estimated)
                value = own;
            else if (shares !== null && index >= 0)
                value = Object.freeze({ amountMinor: shares[index], basis: "purchase-basis", estimated: basis.estimated });
            else if (!future && own !== null)
                value = own;
            else
                value = null;
            refundValues.set(refund.id, { amountMinor, reportingValue: value });
            if (purchase.split !== null && refund.categorySource === "refund-link") {
                const parts = purchase.split.map(line => line.amountMinor);
                const amounts = cumulativeShares(amountMinor, purchase.amountMinor, parts);
                const values = value === null ? null : cumulativeShares(value.amountMinor, purchase.amountMinor, parts);
                refund.split = Object.freeze(purchase.split.map((line, index) => Object.freeze({
                    ...line, amountMinor: amounts[index],
                    reportingValue: value === null ? null : Object.freeze({ ...value, amountMinor: values[index] }),
                })));
            }
        }
    }
    // Installment revisions must match their linked refunds' confirmed allocations.
    for (const purchase of drafts.values()) {
        const installment = purchase.installment;
        if (installment === null)
            continue;
        const referenced = new Set();
        for (const step of installment.steps) {
            const refundId = step.revision.refundId;
            if (refundId === undefined)
                continue;
            referenced.add(refundId);
            const refund = drafts.get(refundId);
            const recognizedBefore = step.keptMinor + installment.fees.filter(fee => fee.on < step.revision.effectiveOn).reduce((total, fee) => total + fee.amountMinor, 0);
            const valid = refund !== undefined && refund.refundOf === purchase.id && !refund.voided && refund.currency === purchase.currency &&
                refund.refundCreditMinor !== null && (refund.refundAllocation?.futureMinor ?? 0) === step.canceledFutureMinor &&
                refund.refundCreditMinor <= recognizedBefore;
            if (!valid)
                gap("installment-revision-invalid", purchase.id, refundId);
        }
        for (const refund of refundedBy.get(purchase.id) ?? []) {
            if (refund.refundAllocation?.futureMinor !== undefined && !referenced.has(refund.id))
                gap("refund-allocation-invalid", refund.id, purchase.id);
        }
    }
    const derived = [];
    for (const anchor of drafts.values()) {
        const rule = anchor.details?.recurring;
        if (!rule || anchor.voided)
            continue;
        if (anchor.source.source !== "manual" || anchor.kind !== "expense" || anchor.details?.installmentPlan ||
            anchor.details?.split || anchor.details?.refundOf || anchor.evidenceOf !== null) {
            gap("recurring-rule-invalid", anchor.id);
            continue;
        }
        if (!recurringMethodValid(anchor.paymentMethod, input.preferences)) {
            gap("recurring-method-invalid", anchor.id);
            continue;
        }
        const anchorOn = anchor.occurrence.precision === "date" ? anchor.occurrence.on : localDateOf(anchor.occurrence.at, input.preferences.reportingTimeZone ?? "UTC");
        let resolved;
        try {
            resolved = resolveRecurringSchedule({ rule, anchorOn, amountMinor: anchor.amountMinor, ...(input.horizon !== undefined ? { horizon: input.horizon } : {}) });
        }
        catch (error) {
            if (!(error instanceof RecurringRuleError))
                throw error;
            gap("recurring-rule-invalid", anchor.id);
            continue;
        }
        anchor.recurring = Object.freeze({ rule, ...resolved });
        for (const occurrence of resolved.occurrences) {
            if (occurrence.skipped)
                continue;
            const basis = anchor.reportingValue;
            derived.push(Object.freeze({ ...anchor, id: `${anchor.id}#${occurrence.id}`, amountMinor: occurrence.amountMinor,
                occurrence: Object.freeze({ precision: "date", on: occurrence.on }),
                reportingValue: basis === null ? null : Object.freeze({ ...basis,
                    amountMinor: proportionalMinor(basis.amountMinor, anchor.amountMinor, occurrence.amountMinor) }),
                valuation: null, installment: null, evidenceOf: null, refundOf: null, refundAllocation: null, refundCreditMinor: null,
                split: null, recurring: null, recurrence: Object.freeze({ anchorId: anchor.id, index: occurrence.index, on: occurrence.on, overridden: occurrence.overridden }),
                voided: false, }));
        }
    }
    const records = [...drafts.values(), ...derived].map(record => Object.freeze(record)).sort(compareRecords);
    const entries = [];
    for (const record of records) {
        if (record.voided || record.evidenceOf !== null || record.recurring !== null)
            continue;
        if (record.split !== null) {
            for (const line of record.split)
                entries.push(Object.freeze({
                    id: `${record.id}#line:${line.id}`, role: "split-line", kind: record.kind, occurrence: record.occurrence,
                    amountMinor: line.amountMinor, currency: record.currency, reportingValue: line.reportingValue,
                    lineId: line.id, categoryId: line.categoryId, mainCategoryId: line.mainCategoryId,
                    ...(line.note !== undefined ? { note: line.note } : {}), record,
                }));
            continue;
        }
        const installment = record.installment;
        if (installment === null) {
            const counted = refundValues.get(record.id);
            entries.push(Object.freeze({
                id: record.id, role: record.recurrence === null ? "record" : "recurring-occurrence", kind: record.kind, occurrence: record.occurrence,
                amountMinor: counted?.amountMinor ?? record.amountMinor, currency: record.currency,
                reportingValue: counted === undefined ? record.reportingValue : counted.reportingValue, record,
            }));
            continue;
        }
        const basis = record.reportingValue;
        const planId = installment.plan.planId;
        const shares = basis === null ? null : cumulativeShares(basis.amountMinor, record.amountMinor, installment.schedule.map(period => period.amountMinor));
        const value = (amountMinor) => Object.freeze({ amountMinor, basis: basis.basis, estimated: basis.estimated });
        installment.schedule.forEach((period, index) => entries.push(Object.freeze({
            id: `${record.id}#${period.id}`, role: "installment-period", kind: "expense", occurrence: Object.freeze({ precision: "date", on: period.on }),
            amountMinor: period.amountMinor, currency: record.currency, reportingValue: shares === null ? null : value(shares[index]),
            planId, periodId: period.id, record,
        })));
        for (const fee of installment.fees)
            entries.push(Object.freeze({
                id: `${record.id}#fee:${fee.id}`, role: "installment-fee", kind: "expense", occurrence: Object.freeze({ precision: "date", on: fee.on }),
                amountMinor: fee.amountMinor, currency: record.currency,
                reportingValue: basis === null ? null : value(proportionalMinor(basis.amountMinor, record.amountMinor, fee.amountMinor)),
                planId, feeId: fee.id, record,
            }));
    }
    entries.sort((left, right) => compareText(occurrenceSortKey(left.occurrence), occurrenceSortKey(right.occurrence)) || compareText(left.id, right.id));
    gaps.sort((left, right) => compareText(left.eventId, right.eventId) || compareText(left.code, right.code) ||
        compareText(left.targetId ?? "", right.targetId ?? ""));
    return Object.freeze({
        records: Object.freeze(records),
        entries: Object.freeze(entries),
        gaps: Object.freeze(gaps),
        userRules: rules,
        projects: Object.freeze([...projects.values()].sort((left, right) => compareText(left.id, right.id))),
    });
}
function baseRecord(source, details, rules, ai, gap, preferences) {
    const correction = details?.correction;
    const amountMinor = correction?.amountMinor ?? source.amountMinor;
    const currency = correction?.currency ?? source.currency;
    const kind = source.kind ?? "expense";
    const occurrence = correction?.occurredAt !== undefined
        ? Object.freeze({ precision: "instant", at: correction.occurredAt, provenance: "manual" })
        : correction?.occurredOn !== undefined ? Object.freeze({ precision: "date", on: correction.occurredOn }) : eventOccurrence(source);
    const merchant = correction?.merchant ?? source.merchant;
    const description = correction?.description ?? source.description;
    const unchangedMoney = amountMinor === source.amountMinor && currency === source.currency;
    const stated = sourceTwdValue(source, currency);
    // A valuation applies only to the money it converted; a later amount/currency correction leaves it unapplied.
    let valuation = null;
    if (details?.valuation !== undefined) {
        if (details.valuation.currency === currency && details.valuation.amountMinor === amountMinor)
            valuation = details.valuation;
        else
            gap("valuation-mismatch", source.id);
    }
    // Source values apply unscaled. Amount follows save the applied pair and its provenance.
    const statedOrigin = valuation?.basis === "actual" ? valuation.origin?.source : undefined;
    const reportingValue = currency === "TWD"
        ? Object.freeze({ amountMinor, basis: "native", estimated: false })
        : valuation !== null
            ? Object.freeze({ amountMinor: valuation.twdMinor, basis: valuation.basis === "actual" ? statedOrigin ?? "saved-actual" : "saved-rate",
                estimated: valuation.basis !== "actual" || statedOrigin === "stated-approximate" })
            : stated ? Object.freeze({ amountMinor: stated.amountMinor,
                basis: stated.basis === "actual" ? "stated-actual" : "stated-approximate", estimated: stated.basis === "approximate" }) : null;
    let installment = null;
    const plan = details?.installmentPlan;
    if (plan !== undefined) {
        if (kind === "expense" && plan.currency === currency && plan.totalMinor === amountMinor) {
            const resolved = resolveInstallmentSchedule(plan);
            const fees = plan.fees ?? [];
            installment = Object.freeze({
                plan, schedule: resolved.periods, fees, steps: resolved.steps,
                costMinor: [...resolved.periods, ...fees].reduce((total, item) => addMinor(total, item.amountMinor), 0),
                canceled: resolved.steps.some(step => step.revision.kind === "cancellation"),
            });
        }
        else
            gap("installment-plan-mismatch", source.id);
    }
    const paymentMethod = effectivePaymentMethod(source, details, preferences);
    const resolution = resolveEventCategory(merchant === undefined ? { id: source.id } : { id: source.id, merchant }, rules, ai);
    let categoryId = resolution.categoryId;
    let categorySource = resolution.source;
    if (details?.categoryId !== undefined) {
        categoryId = canonicalCategoryId(rules, details.categoryId);
        categorySource = "detail";
        if (categoryId === null)
            gap("unknown-category", source.id, details.categoryId);
    }
    let split = null;
    if (details?.split !== undefined) {
        if (details.split.currency !== currency || details.split.totalMinor !== amountMinor)
            gap("split-mismatch", source.id);
        else {
            const shares = reportingValue === null ? null : cumulativeShares(reportingValue.amountMinor, amountMinor, details.split.lines.map(line => line.amountMinor));
            split = Object.freeze(details.split.lines.map((line, index) => {
                const resolved = canonicalCategoryId(rules, line.categoryId);
                if (resolved === null)
                    gap("unknown-category", source.id, line.categoryId);
                return Object.freeze({ id: line.id, amountMinor: line.amountMinor, categoryId: resolved,
                    mainCategoryId: resolved === null ? null : mainCategoryId(rules, resolved),
                    ...(line.note !== undefined ? { note: line.note } : {}),
                    reportingValue: reportingValue === null ? null : Object.freeze({ ...reportingValue, amountMinor: shares[index] }),
                });
            }));
            categoryId = null;
            categorySource = "split";
        }
    }
    return {
        id: source.id,
        kind,
        origin: source.source ?? "bank",
        ...(source.bankId !== undefined ? { bankId: source.bankId } : {}),
        amountMinor,
        currency,
        approximateAmount: source.approximateAmount === true && unchangedMoney,
        occurrence,
        ...(merchant !== undefined ? { merchant } : {}),
        ...(description !== undefined ? { description } : {}),
        paymentMethod,
        ...(stated !== undefined ? { statedTwdEquivalent: stated } : {}),
        reportingValue,
        valuation,
        categoryId,
        mainCategoryId: categoryId === null ? null : mainCategoryId(rules, categoryId),
        categorySource,
        split,
        brand: resolution.brand,
        subscription: details?.subscription ?? null,
        projectId: details?.projectId ?? null,
        ...(details?.notes !== undefined ? { notes: details.notes } : {}),
        refundOf: null,
        refundAllocation: null,
        refundCreditMinor: null,
        installment,
        recurring: null,
        recurrence: null,
        evidenceOf: null,
        voided: details?.voided === true,
        corrected: correction !== undefined,
        source,
        details,
    };
}
/** Sort key of an occurrence: instants by UTC time, dates at the start of their UTC day. */
export function occurrenceSortKey(occurrence) {
    return occurrence.precision === "instant" ? occurrence.at : `${occurrence.on}T00:00:00.000Z`;
}
function compareRecords(left, right) {
    return compareText(occurrenceSortKey(left.occurrence), occurrenceSortKey(right.occurrence)) || compareText(left.id, right.id);
}
function compareText(left, right) { return left < right ? -1 : left > right ? 1 : 0; }
