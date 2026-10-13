import { LedgerCommandValidation, sourceById, detailFor, detailObject } from "./command-validation.js";
import { snapshotPreferences } from "./preferences.js";
import { canonicalCategoryId, createActualValuation, createMonthlyInstallmentPlan, createReferenceValuation, defaultUserRulesDocument, detailPath, eventPath, InstallmentPlanError, previewInstallmentRevision, projectPath, resolveEventCategory, localDateOf, effectivePaymentMethod, recurringMethodValid, resolveRecurringSchedule, validateRecurringRule, previewRecurringRevision, validateLedgerDetails, validateLedgerEvent, validateLedgerObjectAtPath, validateProject, validateRefundAllocation, USER_RULES_PATH, PREFERENCES_PATH, defaultLedgerPreferences, paymentMethodName, validateLedgerPreferences, } from "../core/index.js";
import { applyRuleOperation, RuleConflictError, ruleOperationSatisfied } from "../core/rule-operations.js";
import { checkMutationCommand, } from "./ports.js";
const DETAIL_FIELDS = new Set(["correction", "voided", "categoryId", "subscription", "projectId", "notes", "paymentMethodId", "paymentMethodLabel", "refundOf", "split"]);
const MANUAL_FIELDS = new Set(["kind", "amountMinor", "currency", "occurredAt", "occurredOn", "timeProvenance", "merchant", "description", "paymentMethodLabel", "paymentMethodId", "approximateAmount", "statedTwdEquivalent"]);
export function parseInboxEvent(notification, reader) {
    try {
        if (!notification.bankId)
            return undefined;
        const parsed = reader.reparse(notification);
        if (!parsed || parsed.bankId !== notification.bankId || parsed.source === "manual" || parsed.kind === "refund" || parsed.aiParsed)
            return undefined;
        return validateLedgerEvent({ ...parsed, id: notification.id });
    }
    catch {
        return undefined;
    }
}
/** Commands persist local intents. LedgerPush owns all remote transport and settlement. */
export class LedgerCommands extends LedgerCommandValidation {
    options;
    #valuationQuotes = new Map();
    constructor(options) {
        super();
        this.options = options;
    }
    /** Build against the values the editor showed; replay resolves later competing changes. */
    at(snapshot) {
        return new LedgerCommands({ ...this.options, store: { read: async () => snapshot, publish: this.options.store.publish.bind(this.options.store) } });
    }
    async createManual(context, input, initialDetails) {
        const snapshot = await this.options.store.read();
        return this.#createManual(context, snapshot, input, initialDetails);
    }
    /** Retain capture precision unless the draft chooses another date; remove the notification atomically.
     * The viewer supplies its effective zone, including the local default and deferred preferences. */
    async createManualFromUnrecorded(context, unrecordedId, input, initialDetails, timeZone) {
        const snapshot = await this.options.store.read();
        const notification = snapshot.objects.find(object => object.kind === "unrecorded" && object.value.id === unrecordedId);
        if (notification?.kind !== "unrecorded" || !plainWithKeys(input, MANUAL_FIELDS) || input.kind === "refund")
            return rejected(context, "invalid-object");
        const { occurredAt, occurredOn, timeProvenance, ...fields } = input;
        const captureDate = localDateOf(notification.value.capturedAt, timeZone ?? snapshotPreferences(snapshot, "UTC").reportingTimeZone);
        const date = occurredOn !== undefined && occurredOn !== captureDate
            ? { occurredOn } : { occurredAt: notification.value.capturedAt, timeProvenance: "capture" };
        return this.#createManual(context, snapshot, { ...fields, ...date }, initialDetails, [{ path: notification.path, expectedObjectId: notification.objectId, value: null, strict: true }]);
    }
    async removeUnrecorded(context, unrecordedId) {
        const snapshot = await this.options.store.read();
        const notification = snapshot.objects.find(object => object.kind === "unrecorded" && object.value.id === unrecordedId);
        if (notification?.kind !== "unrecorded")
            return rejected(context, "invalid-object");
        return this.#execute(context, snapshot, [{ path: notification.path, expectedObjectId: notification.objectId, value: null, strict: true }]);
    }
    /** Explicit one-tap acceptance: create-only source and notification removal share one revision. */
    async createParsedFromUnrecorded(context, unrecordedId, reader) {
        if (this.options.capability?.().status === "read-only" || !this.options.outbox)
            return rejected(context, "permission-denied");
        const snapshot = await this.options.store.read();
        const notification = snapshot.objects.find(object => object.kind === "unrecorded" && object.value.id === unrecordedId);
        if (notification?.kind !== "unrecorded")
            return rejected(context, "invalid-object");
        const event = parseInboxEvent(notification.value, reader);
        if (!event)
            return rejected(context, "invalid-object");
        return this.#execute(context, snapshot, [
            { path: eventPath(event), expectedObjectId: null, value: event },
            { path: notification.path, expectedObjectId: notification.objectId, value: null, strict: true },
        ]);
    }
    /** Strict removal for a retried upload whose source record is already present. */
    async removeRecordedInboxEntry(context, unrecordedId) {
        if (this.options.capability?.().status === "read-only" || !this.options.outbox)
            return rejected(context, "permission-denied");
        const snapshot = await this.options.store.read();
        const notification = snapshot.objects.find(object => object.kind === "unrecorded" && object.value.id === unrecordedId);
        if (notification?.kind !== "unrecorded" || !sourceById(snapshot, unrecordedId))
            return rejected(context, "invalid-object");
        return this.#execute(context, snapshot, [{ path: notification.path, expectedObjectId: notification.objectId, value: null, strict: true }]);
    }
    async confirm(context, eventId) {
        const snapshot = await this.options.store.read();
        const source = sourceById(snapshot, eventId)?.value;
        if (!source?.aiParsed)
            return rejected(context, "invalid-object");
        const old = detailObject(snapshot, source);
        const detail = validateLedgerDetails({ ...old?.value, schemaVersion: 1, eventId, operationId: context.operationId, aiConfirmed: true });
        return this.#execute(context, snapshot, [{ path: detailPath(source), expectedObjectId: old?.objectId ?? null, value: detail }]);
    }
    async #createManual(context, snapshot, input, initialDetails, additionalWrites = []) {
        if (!plainWithKeys(input, MANUAL_FIELDS))
            return rejected(context, "invalid-object");
        let event;
        try {
            event = validateLedgerEvent({ ...input, schemaVersion: 1, id: context.operationId, source: "manual", enteredAt: context.now });
        }
        catch {
            return rejected(context, "invalid-object");
        }
        if (event.paymentMethodId !== undefined) {
            const preferences = snapshot.objects.find(object => object.kind === "preferences");
            const enabled = preferences?.kind === "preferences" ? preferences.value.paymentMethods : defaultLedgerPreferences().paymentMethods;
            const method = enabled.find(method => method.id === event.paymentMethodId);
            if (!method)
                return rejected(context, "invalid-object");
            event = validateLedgerEvent({ ...event, paymentMethodLabel: paymentMethodName(method) });
        }
        const writes = [{ path: eventPath(event), expectedObjectId: null, value: event }, ...additionalWrites];
        if (initialDetails !== undefined) {
            if (!plainWithKeys(initialDetails, DETAIL_FIELDS))
                return rejected(context, "invalid-object");
            if (Object.keys(initialDetails).length === 0)
                return this.#execute(context, snapshot, writes);
            let detail;
            try {
                detail = validateLedgerDetails({ ...initialDetails, schemaVersion: 1, eventId: event.id, operationId: context.operationId });
            }
            catch {
                return rejected(context, "invalid-object");
            }
            if (!this.referencesValid(snapshot, detail))
                return rejected(context, "invalid-object");
            if (!this.splitValid(snapshot, event, detail) || detail.split && detail.voided)
                return rejected(context, "invalid-object");
            detail = this.canonicalSplit(snapshot, detail);
            if (detail.refundOf !== undefined && !this.refundLinkValid(snapshot, event, detail.refundOf, undefined, detail))
                return rejected(context, "invalid-object");
            writes.push({ path: detailPath(event), expectedObjectId: null, value: detail });
            if (detail.refundOf !== undefined)
                writes.push(...this.purchaseLocks(snapshot, [detail.refundOf], context.operationId));
        }
        return this.#execute(context, snapshot, writes);
    }
    async editDetails(context, eventId, patch) {
        const snapshot = await this.options.store.read();
        if (!plainWithKeys(patch, DETAIL_FIELDS))
            return rejected(context, "invalid-object");
        if (patch.paymentMethodLabel !== undefined && patch.paymentMethodLabel !== null)
            return rejected(context, "invalid-object");
        if (Object.keys(patch).length === 0)
            return rejected(context, "invalid-command");
        const source = sourceById(snapshot, eventId);
        if (!source)
            return rejected(context, "invalid-object");
        const path = detailPath(source.value);
        const old = snapshot.objects.find(object => object.path === path && object.kind === "detail");
        if (old?.kind === "detail" && old.value.recurring && ["installmentPlan", "split", "refundOf"].some(key => Object.hasOwn(patch, key))) {
            return rejected(context, "invalid-object");
        }
        const fields = old ? { ...old.value } : {};
        for (const [key, value] of Object.entries(patch)) {
            if (value === null)
                delete fields[key];
            else
                fields[key] = value;
        }
        if (patch.paymentMethodId !== undefined && patch.paymentMethodId !== null)
            delete fields.paymentMethodLabel;
        if (source.value.aiParsed && Object.keys(patch).some(key => key !== "voided"))
            fields.aiConfirmed = true;
        let detail;
        try {
            detail = validateLedgerDetails({ ...fields, schemaVersion: 1, eventId, operationId: context.operationId });
        }
        catch {
            return rejected(context, "invalid-object");
        }
        if (!this.referencesValid(snapshot, detail, old?.kind === "detail" ? old.value : null))
            return rejected(context, "invalid-object");
        const oldDetail = old?.kind === "detail" ? old.value : null;
        if (!this.splitValid(snapshot, source.value, detail) || Object.hasOwn(patch, "split") && (oldDetail?.voided || detail.voided)) {
            return rejected(context, "invalid-object");
        }
        detail = this.canonicalSplit(snapshot, detail);
        const linkChanged = oldDetail?.refundOf !== detail.refundOf || oldDetail?.voided !== detail.voided ||
            (oldDetail?.correction?.amountMinor ?? source.value.amountMinor) !== (detail.correction?.amountMinor ?? source.value.amountMinor) ||
            (oldDetail?.correction?.currency ?? source.value.currency) !== (detail.correction?.currency ?? source.value.currency);
        if (!detail.voided && linkChanged && detail.refundOf !== undefined &&
            !this.refundLinkValid(snapshot, source.value, detail.refundOf, eventId, detail))
            return rejected(context, "invalid-object");
        // Outbox edits validate loaded dependents now; replay enforces the confirmed source's required history.
        if (!this.purchaseCorrectionValid(snapshot, source.value, detail, !!this.options.outbox))
            return rejected(context, "invalid-object");
        const isPurchase = (source.value.kind ?? "expense") === "expense";
        const purchaseEconomicChange = isPurchase && (oldDetail?.voided !== detail.voided ||
            (oldDetail?.correction?.amountMinor ?? source.value.amountMinor) !== (detail.correction?.amountMinor ?? source.value.amountMinor) ||
            (oldDetail?.correction?.currency ?? source.value.currency) !== (detail.correction?.currency ?? source.value.currency));
        const writes = [{ path, expectedObjectId: old?.objectId ?? null, value: detail,
                ...(purchaseEconomicChange ? { strict: true } : {}) }];
        if (!isPurchase && linkChanged)
            writes.push(...this.purchaseLocks(snapshot, [oldDetail?.refundOf, detail.refundOf].filter((id) => id !== undefined), context.operationId, Object.keys(patch).some(key => key !== "voided")));
        return this.#execute(context, snapshot, writes);
    }
    void(context, eventId) { return this.editDetails(context, eventId, { voided: true }); }
    /** Split creation and replacement are one detail patch; line identities are retained by the caller. */
    split(context, eventId, split) {
        return this.editDetails(context, eventId, { categoryId: null, split });
    }
    editSplit(context, eventId, split) {
        return this.split(context, eventId, split);
    }
    unsplit(context, eventId) {
        return this.editDetails(context, eventId, { split: null });
    }
    linkRefund(context, refundId, purchaseId) {
        return this.editDetails(context, refundId, { refundOf: purchaseId });
    }
    /** Each valuation is an explicit edit; a failed rate lookup never writes that record. */
    async fillValuations(items) {
        const requests = new Map();
        if (this.options.capability?.().status === "read-only" || !this.options.outbox)
            return items.map(item => ({ eventId: item.eventId, result: rejected(item.context, "permission-denied") }));
        const snapshot = await this.options.store.read();
        for (const item of items) {
            if (item.actualTwdMinor !== undefined || item.quote || this.#valuationQuotes.has(item.context.operationId))
                continue;
            const source = sourceById(snapshot, item.eventId);
            if (!source)
                continue;
            const detail = detailFor(snapshot, source.value);
            const on = item.requestedOn ?? detail?.correction?.occurredOn ?? source.value.occurredOn;
            const currency = detail?.correction?.currency ?? source.value.currency;
            if (on && currency !== "TWD")
                requests.set(`${currency}/${on}`, { currency, date: on });
        }
        const rates = new Map();
        if (requests.size && this.options.rates) {
            try {
                for (const result of await this.options.rates.readRates([...requests.values()]))
                    rates.set(`${result.request.currency}/${result.request.date}`, result);
            }
            catch {
                for (const request of requests.values())
                    rates.set(`${request.currency}/${request.date}`, { status: "failed", request, code: "network" });
            }
        }
        const results = [];
        for (const item of items) {
            const current = await this.options.store.read();
            const source = sourceById(current, item.eventId);
            if (!source) {
                results.push({ eventId: item.eventId, result: rejected(item.context, "invalid-object") });
                continue;
            }
            const detail = detailFor(current, source.value);
            const on = item.requestedOn ?? detail?.correction?.occurredOn ?? source.value.occurredOn;
            const currency = detail?.correction?.currency ?? source.value.currency;
            const quote = item.quote ?? this.#valuationQuotes.get(item.context.operationId);
            const rate = quote && on ? { status: "found", request: { currency, date: on }, quote } :
                on ? rates.get(`${currency}/${on}`) : undefined;
            results.push({ eventId: item.eventId, result: await this.#saveValuation(item, current, source.value, rate) });
        }
        return Object.freeze(results);
    }
    async fillValuation(item) {
        return (await this.fillValuations([item]))[0].result;
    }
    async #saveValuation(item, snapshot, event, rate) {
        if (item.actualTwdMinor !== undefined && item.quote)
            return rejected(item.context, "invalid-command");
        const old = detailObject(snapshot, event);
        const previous = old?.value;
        if (previous?.voided)
            return rejected(item.context, "invalid-object");
        const currency = previous?.correction?.currency ?? event.currency;
        const amountMinor = previous?.correction?.amountMinor ?? event.amountMinor;
        if (currency === "TWD")
            return rejected(item.context, "invalid-valuation");
        const on = item.requestedOn ?? previous?.correction?.occurredOn ?? event.occurredOn;
        if (previous?.valuation?.operationId === item.context.operationId && previous.operationId === item.context.operationId) {
            if (previous.valuation.currency !== currency || previous.valuation.amountMinor !== amountMinor ||
                (item.actualTwdMinor === undefined ? previous.valuation.basis !== "reference-rate" || previous.valuation.requestedOn !== on :
                    previous.valuation.basis !== "actual" || previous.valuation.twdMinor !== item.actualTwdMinor)) {
                return rejected(item.context, "invalid-command");
            }
            const result = await this.#execute(item.context, snapshot, [{ path: detailPath(event), expectedObjectId: old.objectId, value: previous, strict: true }]);
            return previous.valuation.basis === "reference-rate" ? { ...result, quote: {
                    currency: previous.valuation.currency, requestedOn: previous.valuation.requestedOn,
                    effectiveOn: previous.valuation.effectiveOn, rate: previous.valuation.rate,
                    provider: previous.valuation.provider, retrievedAt: previous.valuation.retrievedAt
                } } : result;
        }
        let valuation;
        try {
            const supersedes = previous?.valuation?.operationId;
            if (item.actualTwdMinor !== undefined)
                valuation = createActualValuation({
                    currency, amountMinor, twdMinor: item.actualTwdMinor, operationId: item.context.operationId, ...(supersedes ? { supersedes } : {}),
                });
            else {
                if (!on || !rate)
                    return rejected(item.context, "rate-unavailable");
                if (rate.status === "failed")
                    return rejected(item.context, rate.code);
                if (rate.quote.currency !== currency || rate.quote.requestedOn !== on || rate.request.currency !== currency || rate.request.date !== on) {
                    return rejected(item.context, "invalid-response");
                }
                const pinned = this.#valuationQuotes.get(item.context.operationId);
                if (pinned && (pinned.currency !== rate.quote.currency || pinned.requestedOn !== rate.quote.requestedOn ||
                    pinned.effectiveOn !== rate.quote.effectiveOn || pinned.rate !== rate.quote.rate ||
                    pinned.provider !== rate.quote.provider || pinned.retrievedAt !== rate.quote.retrievedAt))
                    return rejected(item.context, "invalid-command");
                valuation = createReferenceValuation({ currency, amountMinor, operationId: item.context.operationId,
                    ...(supersedes ? { supersedes } : {}), rate: rate.quote.rate, provider: rate.quote.provider,
                    requestedOn: rate.quote.requestedOn, effectiveOn: rate.quote.effectiveOn, retrievedAt: rate.quote.retrievedAt });
            }
            const detail = validateLedgerDetails({ ...previous, schemaVersion: 1, eventId: event.id,
                operationId: item.context.operationId, valuation });
            if (item.actualTwdMinor === undefined && rate?.status === "found")
                this.#valuationQuotes.set(item.context.operationId, rate.quote);
            const result = await this.#execute(item.context, snapshot, [{ path: detailPath(event), expectedObjectId: old?.objectId ?? null, value: detail, strict: true }]);
            return item.actualTwdMinor === undefined && rate?.status === "found" ? { ...result, quote: rate.quote } : result;
        }
        catch {
            return rejected(item.context, "invalid-valuation");
        }
    }
    /** Link and allocate a non-installment refund against the purchase's original money. */
    async allocateRefund(context, refundId, purchaseId, originalMinor) {
        const snapshot = await this.options.store.read();
        const purchase = sourceById(snapshot, purchaseId)?.value;
        const refund = sourceById(snapshot, refundId)?.value;
        if (!snapshot.coverage.complete)
            return rejected(context, "incomplete-coverage");
        if (!purchase || !refund || (purchase.kind ?? "expense") !== "expense" || refund.kind !== "refund" ||
            detailFor(snapshot, purchase)?.voided || detailFor(snapshot, purchase)?.installmentPlan || detailFor(snapshot, purchase)?.recurring)
            return rejected(context, "invalid-object");
        const old = detailObject(snapshot, refund);
        if (old?.value.voided || old?.value.split || (old?.value.refundOf && old.value.refundOf !== purchaseId))
            return rejected(context, "invalid-object");
        const currency = detailFor(snapshot, purchase)?.correction?.currency ?? purchase.currency;
        const amount = detailFor(snapshot, purchase)?.correction?.amountMinor ?? purchase.amountMinor;
        const refundCurrency = old?.value.correction?.currency ?? refund.currency;
        const refundAmount = old?.value.correction?.amountMinor ?? refund.amountMinor;
        let allocation;
        try {
            allocation = validateRefundAllocation({ currency, originalMinor, operationId: context.operationId });
        }
        catch {
            return rejected(context, "allocation-mismatch");
        }
        if (currency === refundCurrency && originalMinor !== refundAmount)
            return rejected(context, "allocation-mismatch");
        if (old?.value.refundAllocation?.operationId === context.operationId && old.value.operationId === context.operationId) {
            if (old.value.refundOf !== purchaseId || old.value.refundAllocation.originalMinor !== originalMinor ||
                detailFor(snapshot, purchase)?.operationId !== context.operationId)
                return rejected(context, "invalid-command");
            return this.#execute(context, snapshot, [{ path: detailPath(refund), expectedObjectId: old.objectId, value: old.value, strict: true },
                ...this.purchaseLocks(snapshot, [purchaseId], context.operationId)]);
        }
        if (!this.allocationFits(snapshot, purchaseId, amount, originalMinor, refundId))
            return rejected(context, "over-allocation");
        const detail = validateLedgerDetails({ ...old?.value, schemaVersion: 1, eventId: refundId,
            operationId: context.operationId, refundOf: purchaseId, refundAllocation: allocation });
        return this.#execute(context, snapshot, [{ path: detailPath(refund), expectedObjectId: old?.objectId ?? null, value: detail, strict: true },
            ...this.purchaseLocks(snapshot, [purchaseId], context.operationId)]);
    }
    async previewMonthlyInstallments(context, purchaseId, input) {
        const snapshot = await this.options.store.read();
        const purchase = sourceById(snapshot, purchaseId)?.value;
        const detail = purchase ? detailFor(snapshot, purchase) : null;
        if (!snapshot.coverage.complete)
            return { status: "rejected", code: "incomplete-coverage" };
        if (!purchase || (purchase.kind ?? "expense") !== "expense" || detail?.voided || detail?.refundOf || detail?.installmentPlan || detail?.split || detail?.recurring ||
            snapshot.objects.some(object => object.kind === "detail" && object.value.refundOf === purchaseId && !object.value.voided)) {
            return { status: "rejected", code: "invalid-object" };
        }
        try {
            return { status: "ready", value: createMonthlyInstallmentPlan({ ...input, operationId: context.operationId,
                    currency: detail?.correction?.currency ?? purchase.currency, totalMinor: detail?.correction?.amountMinor ?? purchase.amountMinor }) };
        }
        catch {
            return { status: "rejected", code: "invalid-plan" };
        }
    }
    async convertToInstallments(context, purchaseId, input) {
        const snapshot = await this.options.store.read();
        const purchase = sourceById(snapshot, purchaseId)?.value;
        if (!purchase)
            return rejected(context, "invalid-object");
        const old = detailObject(snapshot, purchase);
        if (old?.value.installmentPlan?.operationId === context.operationId && old.value.operationId === context.operationId) {
            const plan = old.value.installmentPlan;
            try {
                const expected = createMonthlyInstallmentPlan({ ...input, operationId: context.operationId,
                    currency: old.value.correction?.currency ?? purchase.currency, totalMinor: old.value.correction?.amountMinor ?? purchase.amountMinor });
                if (JSON.stringify(expected) !== JSON.stringify(plan))
                    return rejected(context, "invalid-command");
            }
            catch {
                return rejected(context, "invalid-command");
            }
            return this.#execute(context, snapshot, [{ path: detailPath(purchase), expectedObjectId: old.objectId, value: old.value, strict: true }]);
        }
        const preview = await this.previewMonthlyInstallments(context, purchaseId, input);
        if (preview.status === "rejected")
            return rejected(context, preview.code);
        const detail = validateLedgerDetails({ ...old?.value, schemaVersion: 1, eventId: purchaseId,
            operationId: context.operationId, installmentPlan: preview.value });
        return this.#execute(context, snapshot, [{ path: detailPath(purchase), expectedObjectId: old?.objectId ?? null, value: detail, strict: true }]);
    }
    /** Preview and commit use the same preparation path; no forecast or rate is fetched here. */
    async previewPlanRevision(context, purchaseId, input) {
        const prepared = await this.#preparePlanRevision(context, purchaseId, input);
        return prepared.status === "ready" ? { status: "ready", value: prepared.preview } : prepared;
    }
    async reviseInstallment(context, purchaseId, input) {
        const prepared = await this.#preparePlanRevision(context, purchaseId, input);
        if (prepared.status === "rejected")
            return rejected(context, prepared.code);
        return this.#execute(context, prepared.snapshot, prepared.writes);
    }
    async #preparePlanRevision(context, purchaseId, input) {
        const snapshot = await this.options.store.read();
        if (!snapshot.coverage.complete)
            return { status: "rejected", code: "incomplete-coverage" };
        const purchase = sourceById(snapshot, purchaseId)?.value;
        if (!purchase || (purchase.kind ?? "expense") !== "expense")
            return { status: "rejected", code: "invalid-object" };
        const old = detailObject(snapshot, purchase);
        const plan = old?.value.installmentPlan;
        if (!plan || old.value.voided)
            return { status: "rejected", code: "invalid-object" };
        const revision = { ...input.revision, operationId: context.operationId };
        const refundId = revision.refundId;
        const refund = refundId ? sourceById(snapshot, refundId)?.value : undefined;
        const refundOld = refund ? detailObject(snapshot, refund) : undefined;
        if (refundId && (!refund || refund.kind !== "refund" || refundOld?.value.voided || refundOld?.value.split ||
            (refundOld?.value.refundOf && refundOld.value.refundOf !== purchaseId) || !input.allocation)) {
            return { status: "rejected", code: "invalid-object" };
        }
        if (!refundId && input.allocation)
            return { status: "rejected", code: "allocation-mismatch" };
        if (plan.revisions?.some(item => item.operationId === context.operationId)) {
            const saved = plan.revisions.at(-1);
            if (saved?.operationId !== context.operationId ||
                (refundId && (refundOld?.value.refundAllocation?.originalMinor !== input.allocation?.originalMinor ||
                    refundOld?.value.refundAllocation?.futureMinor !== input.allocation?.futureMinor))) {
                return { status: "rejected", code: "invalid-revision" };
            }
            if (old.value.operationId !== context.operationId || (refundId && refundOld?.value.operationId !== context.operationId)) {
                return { status: "rejected", code: "invalid-revision" };
            }
            // A local replay uses the stored bodies, avoiding a second appended revision.
            const writes = [{ path: detailPath(purchase), expectedObjectId: old.objectId, value: old.value, strict: true }];
            if (refund && refundOld)
                writes.push({ path: detailPath(refund), expectedObjectId: refundOld.objectId, value: refundOld.value, strict: true });
            try {
                const { revisions, ...base } = plan;
                const previous = revisions.length === 1 ? base : { ...base, revisions: revisions.slice(0, -1) };
                const preview = previewInstallmentRevision({ plan: previous, revision,
                    ...(refund ? { refund: { amountMinor: refundOld?.value.correction?.amountMinor ?? refund.amountMinor,
                            currency: refundOld?.value.correction?.currency ?? refund.currency,
                            ...(refundOld?.value.refundAllocation ? { allocation: refundOld.value.refundAllocation } : {}) } } : {}),
                    priorCreditMinor: this.priorCredits(snapshot, purchaseId, refundId) ?? 0, asOf: input.asOf });
                if (JSON.stringify(preview.plan.revisions?.at(-1)) !== JSON.stringify(saved)) {
                    return { status: "rejected", code: "invalid-revision" };
                }
                return { status: "ready", preview, snapshot, writes };
            }
            catch {
                return { status: "rejected", code: "invalid-revision" };
            }
        }
        let allocation;
        try {
            if (refund && input.allocation)
                allocation = validateRefundAllocation({ currency: plan.currency,
                    ...input.allocation, operationId: context.operationId });
            const priorCredit = this.priorCredits(snapshot, purchaseId, refundId);
            if (priorCredit === null)
                return { status: "rejected", code: "allocation-mismatch" };
            const preview = previewInstallmentRevision({ plan, revision, asOf: input.asOf, priorCreditMinor: priorCredit,
                ...(refund ? { refund: { amountMinor: refundOld?.value.correction?.amountMinor ?? refund.amountMinor,
                        currency: refundOld?.value.correction?.currency ?? refund.currency, ...(allocation ? { allocation } : {}) } } : {}) });
            if (!preview.conservation.holds)
                return { status: "rejected", code: "allocation-mismatch" };
            if (!this.planEvidenceValid(snapshot, preview.plan))
                return { status: "rejected", code: "invalid-object" };
            const purchaseDetail = validateLedgerDetails({ ...old.value, operationId: context.operationId, installmentPlan: preview.plan });
            const writes = [{ path: detailPath(purchase), expectedObjectId: old.objectId, value: purchaseDetail, strict: true }];
            if (refund && allocation) {
                if (!this.allocationFits(snapshot, purchaseId, plan.totalMinor, allocation.originalMinor, refund.id)) {
                    return { status: "rejected", code: "over-allocation" };
                }
                const refundDetail = validateLedgerDetails({ ...refundOld?.value, schemaVersion: 1, eventId: refund.id,
                    operationId: context.operationId, refundOf: purchaseId, refundAllocation: allocation });
                writes.push({ path: detailPath(refund), expectedObjectId: refundOld?.objectId ?? null, value: refundDetail, strict: true });
            }
            return { status: "ready", preview, snapshot, writes };
        }
        catch (error) {
            return { status: "rejected", code: error instanceof InstallmentPlanError ? error.code : "invalid-revision" };
        }
    }
    async startRecurring(context, recordId, input) {
        const snapshot = await this.options.store.read();
        if (!this.#recurringCoverage(snapshot))
            return rejected(context, "incomplete-coverage");
        const source = sourceById(snapshot, recordId)?.value;
        if (!source)
            return rejected(context, "invalid-object");
        const old = detailObject(snapshot, source);
        if (!plainWithKeys(input, new Set(["cadence", "end"])))
            return rejected(context, "invalid-object");
        let rule;
        try {
            rule = validateRecurringRule({ ...input, operationId: context.operationId });
        }
        catch {
            return rejected(context, "invalid-object");
        }
        if (old?.value.recurring?.operationId === context.operationId && old.value.operationId === context.operationId) {
            if (JSON.stringify(rule) !== JSON.stringify(old.value.recurring))
                return rejected(context, "invalid-command");
            return this.#execute(context, snapshot, [{ path: detailPath(source), expectedObjectId: old.objectId, value: old.value, strict: true }]);
        }
        if (!this.#recurringEligible(snapshot, source, old?.value ?? null) || old?.value.recurring)
            return rejected(context, "invalid-object");
        const detail = validateLedgerDetails({ ...old?.value, schemaVersion: 1, eventId: recordId, operationId: context.operationId, recurring: rule });
        return this.#execute(context, snapshot, [{ path: detailPath(source), expectedObjectId: old?.objectId ?? null, value: detail, strict: true }]);
    }
    async previewRecurringRevision(context, recordId, input) {
        const prepared = await this.#prepareRecurringRevision(context, recordId, input);
        return prepared.status === "ready" ? { status: "ready", value: prepared.preview } : prepared;
    }
    async reviseRecurring(context, recordId, input) {
        const prepared = await this.#prepareRecurringRevision(context, recordId, input);
        return prepared.status === "rejected" ? rejected(context, prepared.code) : this.#execute(context, prepared.snapshot, prepared.writes);
    }
    async #prepareRecurringRevision(context, recordId, input) {
        const snapshot = await this.options.store.read();
        if (!this.#recurringCoverage(snapshot))
            return { status: "rejected", code: "incomplete-coverage" };
        const source = sourceById(snapshot, recordId)?.value;
        const old = source ? detailObject(snapshot, source) : undefined;
        if (!source || !old?.value.recurring || !this.#recurringEligible(snapshot, source, old.value))
            return { status: "rejected", code: "invalid-object" };
        if (!plainWithKeys(input, new Set(["effectiveOn", "cadence", "amountMinor", "end", "asOf"])))
            return { status: "rejected", code: "invalid-revision" };
        const { asOf, ...terms } = input;
        const revision = { ...terms, operationId: context.operationId };
        const rule = old.value.recurring;
        const saved = rule.revisions?.find(item => item.operationId === context.operationId);
        try {
            const previous = saved ? { ...rule, revisions: rule.revisions.slice(0, -1) } : rule;
            const preview = previewRecurringRevision({ rule: previous, anchorOn: this.#recurringAnchorOn(snapshot, source, old.value),
                amountMinor: old.value.correction?.amountMinor ?? source.amountMinor, revision, horizon: asOf });
            if (saved && (old.value.operationId !== context.operationId || saved !== rule.revisions?.at(-1) ||
                JSON.stringify(preview.rule) !== JSON.stringify(rule)))
                return { status: "rejected", code: "invalid-revision" };
            const detail = saved ? old.value : validateLedgerDetails({ ...old.value, operationId: context.operationId, recurring: preview.rule });
            return { status: "ready", preview, snapshot, writes: [{ path: detailPath(source), expectedObjectId: old.objectId, value: detail, strict: true }] };
        }
        catch {
            return { status: "rejected", code: "invalid-revision" };
        }
    }
    async setRecurringOccurrence(context, recordId, on, override) {
        const snapshot = await this.options.store.read();
        if (!this.#recurringCoverage(snapshot))
            return rejected(context, "incomplete-coverage");
        const source = sourceById(snapshot, recordId)?.value;
        const old = source ? detailObject(snapshot, source) : undefined;
        if (!source || !old?.value.recurring || !this.#recurringEligible(snapshot, source, old.value))
            return rejected(context, "invalid-object");
        try {
            const rule = old.value.recurring;
            const resolved = resolveRecurringSchedule({ rule, anchorOn: this.#recurringAnchorOn(snapshot, source, old.value),
                amountMinor: old.value.correction?.amountMinor ?? source.amountMinor, horizon: on });
            if (!resolved.occurrences.some(occurrence => occurrence.on === on))
                return rejected(context, "invalid-object");
            const overrides = { ...rule.overrides };
            if (override === null)
                delete overrides[on];
            else
                overrides[on] = override;
            const recurring = validateRecurringRule({ ...rule, overrides });
            if (old.value.operationId === context.operationId && JSON.stringify(recurring) !== JSON.stringify(rule))
                return rejected(context, "invalid-command");
            const detail = validateLedgerDetails({ ...old.value, operationId: context.operationId, recurring });
            return this.#execute(context, snapshot, [{ path: detailPath(source), expectedObjectId: old.objectId, value: detail, strict: true }]);
        }
        catch {
            return rejected(context, "invalid-object");
        }
    }
    #recurringCoverage(snapshot) {
        return snapshot.coverage.complete && snapshot.coverage.missing.length === 0 && snapshot.coverage.preferencesLoaded !== false &&
            snapshot.objects.some(object => object.kind === "preferences");
    }
    #recurringEligible(snapshot, source, detail) {
        const preferences = snapshot.objects.find(object => object.kind === "preferences");
        return source.source === "manual" && (source.kind ?? "expense") === "expense" && !detail?.voided &&
            !detail?.refundOf && !detail?.installmentPlan && !detail?.split &&
            !snapshot.objects.some(object => object.kind === "detail" && (object.value.refundOf === source.id || object.value.installmentPlan &&
                [...object.value.installmentPlan.periods, ...object.value.installmentPlan.revisions?.flatMap(revision => revision.periods) ?? []]
                    .some(period => period.evidence?.includes(source.id)))) &&
            recurringMethodValid(effectivePaymentMethod(source, detail, preferences?.kind === "preferences" ? preferences.value : undefined), preferences?.kind === "preferences" ? preferences.value : undefined);
    }
    #recurringAnchorOn(snapshot, source, detail) {
        return detail.correction?.occurredOn ?? (detail.correction?.occurredAt ? localDateOf(detail.correction.occurredAt, snapshotPreferences(snapshot, "UTC").reportingTimeZone)
            : source.occurredOn ?? localDateOf(source.occurredAt, snapshotPreferences(snapshot, "UTC").reportingTimeZone));
    }
    /** Each item is its own confirmed command and outcome; no batch atomicity is claimed. */
    async assignBatch(items) {
        const results = [];
        for (const item of items) {
            const patch = {};
            if (Object.hasOwn(item, "categoryId"))
                patch.categoryId = item.categoryId ?? null;
            if (Object.hasOwn(item, "projectId"))
                patch.projectId = item.projectId ?? null;
            results.push({ eventId: item.eventId, result: await this.editDetails(item.context, item.eventId, patch) });
        }
        return results;
    }
    async createProject(context, id, label) {
        const snapshot = await this.options.store.read();
        let project;
        try {
            project = validateProject({ schemaVersion: 1, id, label, archived: false });
        }
        catch {
            return rejected(context, "invalid-object");
        }
        return this.#execute(context, snapshot, [{ path: projectPath(id), expectedObjectId: null, value: project }]);
    }
    async updateProject(context, id, change) {
        const snapshot = await this.options.store.read();
        if (!plainWithKeys(change, new Set(["label", "archived", "includeInDaily"])) ||
            !(Object.keys(change).length === 1 || Object.keys(change).length === 2 && Object.hasOwn(change, "label") && Object.hasOwn(change, "includeInDaily")))
            return rejected(context, "invalid-object");
        const old = snapshot.objects.find(object => object.kind === "project" && object.value.id === id);
        if (!old || old.kind !== "project")
            return rejected(context, "invalid-object");
        let project;
        try {
            project = validateProject({ ...old.value, ...change });
        }
        catch {
            return rejected(context, "invalid-object");
        }
        const writes = [{ path: projectPath(id), expectedObjectId: old.objectId, value: project }];
        if (project.archived && change.archived === true) {
            if (!snapshot.coverage.preferencesLoaded && !snapshot.coverage.complete)
                return rejected(context, "incomplete-coverage");
            const preferences = snapshot.objects.find(object => object.kind === "preferences");
            const value = preferences?.kind === "preferences" ? preferences.value : defaultLedgerPreferences();
            // The user ends a trip explicitly before archiving it. Guard against another device starting it concurrently.
            if (value.currentTrip?.projectId === id)
                return rejected(context, "active-trip");
            writes.push({ path: PREFERENCES_PATH, expectedObjectId: preferences?.objectId ?? null, value, strict: true });
        }
        return this.#execute(context, snapshot, writes);
    }
    async setProjectDaily(context, id, includeInDaily) {
        return this.updateProject(context, id, { includeInDaily });
    }
    async setCategoryDaily(context, id, includeInDaily) {
        return this.editUserRules(context, { kind: "categoryDaily", id, includeInDaily });
    }
    /** One validated preference document, with the same blob CAS and confirmation path as details. */
    async editPreferences(context, input) {
        const snapshot = await this.options.store.read();
        if (!snapshot.coverage.preferencesLoaded && !snapshot.coverage.complete)
            return rejected(context, "incomplete-coverage");
        const old = snapshot.objects.find(object => object.kind === "preferences");
        const rules = snapshot.objects.find(object => object.kind === "user-rules");
        let next;
        try {
            next = validateLedgerPreferences(input, {
                categories: rules?.kind === "user-rules" ? rules.value.categories : defaultUserRulesDocument().categories,
                projects: snapshot.objects.flatMap(object => object.kind === "project" ? [object.value] : []),
            });
        }
        catch {
            return rejected(context, "invalid-object");
        }
        const writes = [{ path: PREFERENCES_PATH,
                expectedObjectId: old?.objectId ?? null, value: next }];
        if (next.currentTrip) {
            const project = snapshot.objects.find(object => object.kind === "project" && object.value.id === next.currentTrip.projectId);
            // Trip selection and archive checks share CAS dependencies, so neither can leave an archived current trip.
            writes.push({ path: project.path, expectedObjectId: project.objectId, value: project.value, strict: true });
        }
        return this.#execute(context, snapshot, writes);
    }
    /** Restore an archived project; its records and reports remain attached throughout. */
    async unarchiveProject(context, id) {
        return this.updateProject(context, id, { archived: false });
    }
    /** Delete only after checking every record and the ledger trip preference at one revision. */
    async deleteProject(context, id) {
        const snapshot = await this.options.store.read();
        const project = snapshot.objects.find(object => object.kind === "project" && object.value.id === id);
        if (!project || project.kind !== "project")
            return rejected(context, "invalid-object");
        const failure = this.projectDeletionFailure(snapshot, id);
        if (failure && !(this.options.outbox && failure === "incomplete-coverage"))
            return rejected(context, failure);
        const preferences = snapshot.objects.find(object => object.kind === "preferences");
        const writes = [{ path: project.path, expectedObjectId: project.objectId, value: null, strict: true }];
        if (preferences?.kind === "preferences") {
            writes.push({ path: PREFERENCES_PATH, expectedObjectId: preferences.objectId, value: preferences.value, strict: true });
        }
        return this.#execute(context, snapshot, writes);
    }
    async editUserRules(context, operation, expectedObjectId) {
        const snapshot = await this.options.store.read();
        const old = snapshot.objects.find(object => object.kind === "user-rules");
        const current = old?.kind === "user-rules" ? old.value : defaultUserRulesDocument();
        if (expectedObjectId !== undefined && (old?.objectId ?? null) !== expectedObjectId && !ruleOperationSatisfied(current, operation))
            return { status: "conflict",
                operationId: context.operationId, currentCommit: snapshot.cursor?.commit ?? "", paths: [USER_RULES_PATH] };
        let next;
        try {
            next = applyRuleOperation(current, operation);
        }
        catch (error) {
            return rejected(context, error instanceof RuleConflictError ? "rule-conflict" : "invalid-object");
        }
        return this.#execute(context, snapshot, [{ path: USER_RULES_PATH, expectedObjectId: old?.objectId ?? null, value: next,
                ...(expectedObjectId !== undefined ? { strict: true } : {}) }], expectedObjectId === undefined ? operation : undefined);
    }
    /** Commit an editor draft once; a stale sheet cannot overwrite a newer rules document. */
    async editCategory(context, input) {
        const snapshot = await this.options.store.read();
        const old = snapshot.objects.find(object => object.kind === "user-rules");
        if ((old?.objectId ?? null) !== input.expectedObjectId)
            return { status: "conflict", operationId: context.operationId,
                currentCommit: snapshot.cursor?.commit ?? "", paths: [USER_RULES_PATH] };
        let next = old?.kind === "user-rules" ? old.value : defaultUserRulesDocument();
        const category = next.categories.find(item => item.id === input.id);
        if (!category)
            return rejected(context, "invalid-object");
        try {
            next = applyRuleOperation(next, { kind: "categoryRename", id: input.id, label: input.label });
            if (Object.hasOwn(input, "icon"))
                next = applyRuleOperation(next, { kind: "categoryIcon", id: input.id, icon: input.icon ?? null });
            for (const [id, includeInDaily] of Object.entries(input.daily)) {
                if (!next.categories.some(item => item.id === id && (id === input.id || item.parentId === input.id)))
                    return rejected(context, "invalid-object");
                next = applyRuleOperation(next, { kind: "categoryDaily", id, includeInDaily });
            }
            for (const addition of input.additions)
                next = applyRuleOperation(next, { kind: "categoryAdd", ...addition, parentId: input.id });
            if (input.mergeTo)
                next = applyRuleOperation(next, { kind: "categoryMerge", id: input.id, targetId: input.mergeTo });
        }
        catch {
            return rejected(context, "invalid-object");
        }
        const writes = [{ path: USER_RULES_PATH, expectedObjectId: input.expectedObjectId, value: next, strict: true }];
        const preferences = snapshot.objects.find(object => object.kind === "preferences");
        if (input.mergeTo && preferences?.kind === "preferences" && preferences.value.pinnedCategoryIds.includes(input.id)) {
            const pinnedCategoryIds = [...new Set(preferences.value.pinnedCategoryIds.map(id => id === input.id ? input.mergeTo : id))];
            const value = validateLedgerPreferences({ ...preferences.value, pinnedCategoryIds }, { categories: next.categories,
                projects: snapshot.objects.flatMap(object => object.kind === "project" ? [object.value] : []) });
            writes.push({ path: PREFERENCES_PATH, expectedObjectId: preferences.objectId, value, strict: true });
        }
        return this.#execute(context, snapshot, writes);
    }
    /** Remove a brand's category rule; explicit per-record details remain untouched. */
    async deleteUserRule(context, brandId) {
        return this.editUserRules(context, { kind: "brandCategoryDelete", brandId });
    }
    /** Create/update the merchant mapping and its brand category in one rules-document CAS. Explicit record assignments remain intact. */
    async classifyMerchant(context, merchant, categoryId, newBrandId) {
        const snapshot = await this.options.store.read();
        const stored = snapshot.objects.find((object) => object.kind === "user-rules");
        let rules = stored?.value ?? defaultUserRulesDocument();
        const suggestion = snapshot.objects.find((object) => object.kind === "ai-rule" && object.value.merchant === merchant);
        const resolved = resolveEventCategory({ id: context.operationId, merchant }, rules, new Map(suggestion ? [[merchant, suggestion.value]] : [])).brand;
        const existing = rules.brands.find(brand => !!resolved?.id && brand.id === resolved.id) ?? rules.brands.find(brand => brand.label === merchant || brand.aliases.includes(merchant));
        const brandId = existing?.id ?? newBrandId;
        try {
            rules = applyRuleOperation(rules, existing ? { kind: "brandCategory", brandId, categoryId } :
                { kind: "brandAdd", id: brandId, label: [...merchant].slice(0, 40).join(""), categoryId });
            rules = applyRuleOperation(rules, { kind: "assignMerchant", merchant, brandId });
        }
        catch {
            return rejected(context, "invalid-object");
        }
        return this.#execute(context, snapshot, [{ path: USER_RULES_PATH, expectedObjectId: stored?.objectId ?? null, value: rules }]);
    }
    /** Convert an existing AI suggestion into a user rule without replacing merchant coverage. */
    async acceptAiSuggestion(context, merchantHash) {
        if (!/^[0-9a-f]{64}$/.test(merchantHash))
            return rejected(context, "invalid-object");
        const snapshot = await this.options.store.read();
        const suggestion = snapshot.objects.find((object) => object.kind === "ai-rule" && object.merchantHash === merchantHash && object.path === `rules/ai/${merchantHash}.json`);
        if (!suggestion)
            return rejected(context, "invalid-object");
        const storedRules = snapshot.objects.find((object) => object.kind === "user-rules");
        const userRules = storedRules?.value ?? defaultUserRulesDocument();
        const categoryId = canonicalCategoryId(userRules, suggestion.value.categoryId);
        if (categoryId === null)
            return rejected(context, "invalid-object");
        const existingBrand = userRules.brands.find(brand => brand.label === suggestion.value.brand || brand.aliases.includes(suggestion.value.brand));
        let brandId;
        if (existingBrand) {
            const existingCategory = userRules.brandCategories[existingBrand.id];
            if (existingCategory === undefined || canonicalCategoryId(userRules, existingCategory) !== categoryId) {
                return rejected(context, "rule-conflict");
            }
            brandId = existingBrand.id;
        }
        else {
            // Stable across a retried command and derived only from the AI object's opaque path identity.
            brandId = `ai-${merchantHash.slice(0, 36)}`;
            if (userRules.brands.some(brand => brand.id === brandId))
                return rejected(context, "rule-conflict");
        }
        return this.editUserRules(context, { kind: "acceptSuggestion", brandId, merchant: suggestion.value.merchant,
            brandLabel: suggestion.value.brand, categoryId });
    }
    async #execute(context, snapshot, writes, ruleOperation) {
        if (this.options.capability?.().status === "read-only" || !this.options.outbox)
            return rejected(context, "permission-denied");
        if (!snapshot.cursor || !Number.isFinite(Date.parse(context.now)) || new Date(context.now).toISOString() !== context.now)
            return rejected(context, "invalid-command");
        const changed = Object.entries(context.expectedObjects ?? {}).filter(([path, objectId]) => (snapshot.objects.find(object => object.path === path)?.objectId ?? null) !== objectId).map(([path]) => path);
        if (changed.length)
            return { status: "conflict", operationId: context.operationId, currentCommit: snapshot.cursor.commit, paths: changed };
        // Every explicit correction path (including monetary commands) confirms AI parsing. Revision
        // identity and void-only changes are excluded; confirmation already present is never removed.
        writes = writes.map(write => {
            if (write.value === null)
                return write;
            const object = validateLedgerObjectAtPath(write.path, write.value);
            if (object.kind !== "detail" || !sourceById(snapshot, object.value.eventId)?.value.aiParsed)
                return write;
            const old = snapshot.objects.find(item => item.path === write.path);
            const previous = old?.kind === "detail" ? old.value : undefined;
            const changed = [...new Set([...Object.keys(object.value), ...Object.keys(previous ?? {})])].some(key => !["schemaVersion", "eventId", "operationId", "voided", "aiConfirmed"].includes(key) &&
                JSON.stringify(object.value[key]) !== JSON.stringify(previous?.[key]));
            return previous?.aiConfirmed || changed ? { ...write, value: validateLedgerDetails({ ...object.value, aiConfirmed: true }) } : write;
        });
        // Share project CAS dependencies with deletion. A stale assignment cannot recreate membership
        // after another device deletes the project, even when its detail blob itself is unchanged.
        const projectLocks = new Map();
        for (const write of writes) {
            if (write.value === null)
                continue;
            const object = validateLedgerObjectAtPath(write.path, write.value);
            if (object.kind !== "detail" || object.value.voided || !object.value.projectId)
                continue;
            const project = snapshot.objects.find(item => item.kind === "project" && item.value.id === object.value.projectId);
            if (project?.kind === "project" && !writes.some(item => item.path === project.path)) {
                projectLocks.set(project.path, { path: project.path, expectedObjectId: project.objectId, value: project.value, strict: true });
            }
        }
        writes = [...writes, ...projectLocks.values()];
        const command = { operationId: context.operationId, expectedBase: { commit: snapshot.cursor.commit }, writes,
            ...(ruleOperation ? { ruleOperation } : {}) };
        const invalid = checkMutationCommand(command);
        if (invalid)
            return rejected(context, invalid);
        await this.options.outbox.submit(command, snapshot, { now: context.now });
        return { status: "pending", operationId: context.operationId };
    }
}
function plainWithKeys(value, keys) {
    return value !== null && typeof value === "object" && !Array.isArray(value) &&
        (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) &&
        Reflect.ownKeys(value).every(key => typeof key === "string" && keys.has(key));
}
function rejected(context, code) {
    return { status: "rejected", operationId: context.operationId, code };
}
