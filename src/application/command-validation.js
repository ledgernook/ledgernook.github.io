import { allocationCreditMinor, effectivePaymentMethod, recurringMethodValid, assembleEffectiveLedger, canonicalCategoryId, defaultUserRulesDocument, detailPath, resolveInstallmentSchedule, validateLedgerDetails, validateLedgerObjectAtPath, validateLedgerPreferences, defaultLedgerPreferences, PREFERENCES_PATH, } from "../core/index.js";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Existing records can have earlier-dated refunds/evidence; unconfirmed sources cannot have remote dependents. */
export function detailNeedsHistory(confirmed, candidate, detail, previous) {
    // Recurring rules and refund allocation require full history, including local source/target pairs.
    if (detail.recurring || previous?.recurring || detail.refundAllocation || previous?.refundAllocation)
        return true;
    const event = sourceById(confirmed, detail.eventId)?.value;
    if (!event) {
        const references = [detail, previous].flatMap(value => {
            if (!value)
                return [];
            const plan = value.installmentPlan;
            return [...(value.refundOf ? [value.refundOf] : []),
                ...(plan ? resolveInstallmentSchedule(plan).periods.flatMap(period => period.evidence ?? []) : []),
                ...(plan?.revisions ?? []).flatMap(revision => revision.refundId ? [revision.refundId] : [])];
        });
        // Confirmed targets retain their own prior-credit/evidence coverage; local targets have no remote dependents.
        return references.some(id => sourceById(confirmed, id) !== undefined || !sourceById(candidate, id));
    }
    const moneyChanged = (previous?.correction?.amountMinor ?? event.amountMinor) !== (detail.correction?.amountMinor ?? event.amountMinor) ||
        (previous?.correction?.currency ?? event.currency) !== (detail.correction?.currency ?? event.currency);
    return !!(detail.refundOf || previous?.refundOf || detail.installmentPlan || previous?.installmentPlan || detail.split || previous?.split ||
        moneyChanged || previous?.voided !== detail.voided);
}
/** Command builders and replay use the same reference, split and economic checks. */
export class LedgerCommandValidation {
    // `before` includes earlier intents; `confirmed` excludes them when deciding which sources need history.
    validateReplay(before, candidate, writes, confirmed = before) {
        const partial = !candidate.coverage.complete || candidate.coverage.missing.length > 0;
        const ledger = validationLedger(candidate);
        for (const write of writes) {
            if (write.value === null) {
                if (!write.path.startsWith("projects/"))
                    continue;
                const reason = this.projectDeletionFailure(candidate, write.path.slice("projects/".length, -".json".length));
                if (reason === "incomplete-coverage")
                    return { status: "temporary", reason };
                if (reason)
                    return { status: "failed", reason };
                continue;
            }
            const object = validateLedgerObjectAtPath(write.path, write.value);
            if (object.kind === "user-rules") {
                const old = before.objects.find(item => item.kind === "user-rules");
                const previous = old?.kind === "user-rules" ? old.value : defaultUserRulesDocument();
                // Category merge/deletion validates references in source/detail history, including split lines.
                if (partial && previous.categories.some(category => !object.value.categories.some(item => item.id === category.id))) {
                    return { status: "temporary", reason: "incomplete-coverage" };
                }
            }
            if (object.kind === "preferences") {
                if (!candidate.coverage.preferencesLoaded && partial)
                    return { status: "temporary", reason: "incomplete-coverage" };
                if (object.value.currentTrip && candidate.coverage.missing.some(path => path.startsWith("projects")) ||
                    object.value.pinnedCategoryIds.length && candidate.coverage.missing.some(path => path.startsWith("rules")))
                    return { status: "temporary", reason: "incomplete-coverage" };
                const rules = candidate.objects.find(item => item.kind === "user-rules");
                try {
                    validateLedgerPreferences(object.value, { categories: rules?.kind === "user-rules" ? rules.value.categories : defaultUserRulesDocument().categories,
                        projects: candidate.objects.flatMap(item => item.kind === "project" ? [item.value] : []) });
                }
                catch {
                    return { status: "failed", reason: "invalid-object" };
                }
            }
            if (object.kind === "project" && object.value.archived) {
                const old = before.objects.find(item => item.path === write.path);
                // Archive's membership scope and the trip-end guard must be known before domain validation.
                if (partial && (old?.kind !== "project" || !old.value.archived))
                    return { status: "temporary", reason: "incomplete-coverage" };
                if (!candidate.coverage.preferencesLoaded && partial)
                    return { status: "temporary", reason: "incomplete-coverage" };
                const preferences = candidate.objects.find(item => item.kind === "preferences");
                if (preferences?.kind === "preferences" && preferences.value.currentTrip?.projectId === object.value.id)
                    return { status: "failed", reason: "active-trip" };
            }
            if (object.kind !== "detail")
                continue;
            const detail = object.value, event = sourceById(candidate, detail.eventId)?.value;
            if (!event)
                return partial ? { status: "temporary", reason: "incomplete-coverage" } : { status: "failed", reason: "invalid-object" };
            const previous = detailFor(before, event);
            if ((detail.recurring || previous?.recurring) && (candidate.coverage.preferencesLoaded === false ||
                candidate.coverage.missing.some(path => path.startsWith(PREFERENCES_PATH))))
                return { status: "temporary", reason: "incomplete-coverage" };
            // Refund capacity/prior credits, installment evidence, split evidence and purchase corrections
            // inspect other records across history, including removal of a former link or schedule.
            if (partial && detailNeedsHistory(confirmed, candidate, detail, previous))
                return { status: "temporary", reason: "incomplete-coverage" };
            if (partial && (candidate.coverage.missing.some(path => path.startsWith("rules")) && (detail.categoryId !== previous?.categoryId || detail.split) ||
                candidate.coverage.missing.some(path => path.startsWith("projects")) && detail.projectId !== previous?.projectId))
                return { status: "temporary", reason: "incomplete-coverage" };
            if (detail.paymentMethodId !== undefined && detail.paymentMethodId !== previous?.paymentMethodId &&
                (candidate.coverage.preferencesLoaded === false || !candidate.coverage.preferencesLoaded && !candidate.coverage.complete ||
                    candidate.coverage.missing.some(path => path.startsWith(PREFERENCES_PATH))))
                return { status: "temporary", reason: "incomplete-coverage" };
            if (!this.referencesValid(candidate, detail, previous) || !this.splitValid(candidate, event, detail) ||
                !detail.voided && detail.refundOf && !this.refundLinkValid(candidate, event, detail.refundOf, event.id, detail, !sourceById(confirmed, detail.refundOf)))
                return { status: "failed", reason: "invalid-object" };
            // Keep this record's previous detail for the correction guard, with every other write applied.
            const correctionBase = { ...candidate, objects: [...candidate.objects.filter(item => item.path !== write.path),
                    ...before.objects.filter(item => item.path === write.path)] };
            if (!this.purchaseCorrectionValid(correctionBase, event, detail, !sourceById(confirmed, event.id)) ||
                detail.installmentPlan && !this.planEvidenceValid(candidate, detail.installmentPlan))
                return { status: "failed", reason: "invalid-object" };
        }
        // Core assembly owns refund allocation, installment conservation/evidence and source/detail relationships.
        const oldLedger = validationLedger(before);
        const oldGaps = new Set(oldLedger.gaps.map(gap => JSON.stringify(gap)));
        const ids = new Set(writes.flatMap(write => write.value && "eventId" in write.value ? [write.value.eventId] : write.value && "id" in write.value ? [write.value.id] : []));
        if (ledger.gaps.some(gap => !oldGaps.has(JSON.stringify(gap)) || ids.has(gap.eventId) || gap.targetId && ids.has(gap.targetId))) {
            return partial ? { status: "temporary", reason: "incomplete-coverage" } : { status: "failed", reason: "invalid-object" };
        }
        return { status: "valid" };
    }
    projectDeletionFailure(snapshot, id) {
        if (!snapshot.coverage.complete || snapshot.coverage.missing.length)
            return "incomplete-coverage";
        const preferences = snapshot.objects.find(object => object.kind === "preferences");
        if (preferences?.kind === "preferences" && preferences.value.currentTrip?.projectId === id)
            return "project-current-trip";
        const sourceIds = new Set(snapshot.objects.flatMap(object => object.kind === "source" ? [object.value.id] : []));
        if (snapshot.objects.some(object => object.kind === "detail" && sourceIds.has(object.value.eventId) &&
            !object.value.voided && object.value.projectId === id))
            return "project-has-records";
        if (validationLedger(snapshot).records.some(record => !record.voided && record.projectId === id))
            return "project-has-records";
        return null;
    }
    referencesValid(snapshot, detail, previous = null) {
        const rules = snapshot.objects.find(object => object.kind === "user-rules");
        const user = rules?.kind === "user-rules" ? rules.value : defaultUserRulesDocument();
        if (detail.categoryId !== undefined && detail.categoryId !== previous?.categoryId && canonicalCategoryId(user, detail.categoryId) === null)
            return false;
        if (detail.split?.lines.some(line => canonicalCategoryId(user, line.categoryId) === null))
            return false;
        if (detail.projectId !== undefined && detail.projectId !== previous?.projectId &&
            !snapshot.objects.some(object => object.kind === "project" && object.value.id === detail.projectId))
            return false;
        const preferences = snapshot.objects.find(object => object.kind === "preferences");
        const methods = preferences?.kind === "preferences" ? preferences.value.paymentMethods : defaultLedgerPreferences().paymentMethods;
        if (detail.paymentMethodId !== undefined && detail.paymentMethodId !== previous?.paymentMethodId &&
            !methods.some(method => method.id === detail.paymentMethodId))
            return false;
        if (detail.recurring) {
            const source = sourceById(snapshot, detail.eventId)?.value;
            if (!source || source.source !== "manual" || (source.kind ?? "expense") !== "expense" || detail.installmentPlan || detail.split || detail.refundOf ||
                !recurringMethodValid(effectivePaymentMethod(source, detail, preferences?.kind === "preferences" ? preferences.value : undefined), preferences?.kind === "preferences" ? preferences.value : undefined))
                return false;
        }
        if (detail.refundOf) {
            const target = sourceById(snapshot, detail.refundOf)?.value;
            if (target && detailFor(snapshot, target)?.recurring)
                return false;
        }
        return true;
    }
    canonicalSplit(snapshot, detail) {
        if (!detail.split)
            return detail;
        const rules = snapshot.objects.find(object => object.kind === "user-rules");
        const user = rules?.kind === "user-rules" ? rules.value : defaultUserRulesDocument();
        return validateLedgerDetails({ ...detail, split: { ...detail.split,
                lines: detail.split.lines.map(line => ({ ...line, categoryId: canonicalCategoryId(user, line.categoryId) })) } });
    }
    splitValid(snapshot, event, detail) {
        if (!detail.split)
            return true;
        if (detail.split.currency !== (detail.correction?.currency ?? event.currency) ||
            detail.split.totalMinor !== (detail.correction?.amountMinor ?? event.amountMinor))
            return false;
        return !snapshot.objects.some(object => object.kind === "detail" && object.value.installmentPlan &&
            resolveInstallmentSchedule(object.value.installmentPlan).periods.some(period => period.evidence?.includes(event.id)));
    }
    planEvidenceValid(snapshot, plan) {
        return !resolveInstallmentSchedule(plan).periods.some(period => period.evidence?.some(id => {
            const source = sourceById(snapshot, id);
            const detail = source ? detailFor(snapshot, source.value) : null;
            return detail?.split !== undefined || detail?.recurring !== undefined;
        }));
    }
    refundLinkValid(snapshot, refund, purchaseId, selfId, proposed, allowIncomplete = false) {
        if (!snapshot.coverage.complete && !allowIncomplete || (refund.kind ?? "expense") !== "refund" || !UUID.test(purchaseId))
            return false;
        const purchase = sourceById(snapshot, purchaseId);
        if (!purchase || (purchase.value.kind ?? "expense") !== "expense")
            return false;
        const detail = detailFor(snapshot, purchase.value);
        if (detail?.voided || detail?.recurring)
            return false;
        const purchaseAmount = detail?.correction?.amountMinor ?? purchase.value.amountMinor;
        const purchaseCurrency = detail?.correction?.currency ?? purchase.value.currency;
        const refundDetail = proposed ?? (selfId ? detailFor(snapshot, refund) : null);
        const refundAmount = refundDetail?.correction?.amountMinor ?? refund.amountMinor;
        const refundCurrency = refundDetail?.correction?.currency ?? refund.currency;
        const allocation = refundDetail?.refundAllocation;
        if (purchaseCurrency !== refundCurrency && !allocation)
            return false;
        if (allocation && (allocation.currency !== purchaseCurrency ||
            (purchaseCurrency === refundCurrency && allocation.originalMinor !== refundAmount)))
            return false;
        return this.allocationFits(snapshot, purchaseId, purchaseAmount, allocation?.originalMinor ?? refundAmount, selfId);
    }
    purchaseCorrectionValid(snapshot, purchase, proposed, allowIncomplete = false) {
        if ((purchase.kind ?? "expense") !== "expense")
            return true;
        const old = detailFor(snapshot, purchase);
        const amountChanged = (old?.correction?.amountMinor ?? purchase.amountMinor) !== (proposed.correction?.amountMinor ?? purchase.amountMinor) ||
            (old?.correction?.currency ?? purchase.currency) !== (proposed.correction?.currency ?? purchase.currency);
        if (amountChanged && (old?.installmentPlan || old?.recurring))
            return false;
        if (old?.recurring && ((old.correction?.occurredOn ?? purchase.occurredOn) !== (proposed.correction?.occurredOn ?? purchase.occurredOn) ||
            (old.correction?.occurredAt ?? purchase.occurredAt) !== (proposed.correction?.occurredAt ?? purchase.occurredAt)))
            return false;
        if (!amountChanged && !proposed.voided && old?.voided !== true)
            return true;
        if (!snapshot.coverage.complete && !allowIncomplete)
            return false;
        const linked = snapshot.objects.filter(object => object.kind === "detail" && object.value.refundOf === purchase.id && !object.value.voided);
        if (proposed.voided)
            return linked.length === 0;
        const currency = proposed.correction?.currency ?? purchase.currency;
        const amount = proposed.correction?.amountMinor ?? purchase.amountMinor;
        let refunded = 0;
        for (const item of linked) {
            if (item.kind !== "detail")
                continue;
            const source = sourceById(snapshot, item.value.eventId);
            if (!source)
                return false;
            const refundCurrency = item.value.correction?.currency ?? source.value.currency;
            const refundAmount = item.value.correction?.amountMinor ?? source.value.amountMinor;
            const allocation = item.value.refundAllocation;
            if (refundCurrency !== currency && !allocation || allocation &&
                (allocation.currency !== currency || refundCurrency === currency && allocation.originalMinor !== refundAmount))
                return false;
            refunded += allocation?.originalMinor ?? refundAmount;
            if (!Number.isSafeInteger(refunded) || refunded > amount)
                return false;
        }
        return true;
    }
    purchaseLocks(snapshot, ids, operationId, confirms = true) {
        const writes = [];
        for (const id of new Set(ids)) {
            const purchase = sourceById(snapshot, id);
            if (!purchase)
                continue; // Association validation reports the missing source before this point.
            const path = detailPath(purchase.value);
            const old = snapshot.objects.find(object => object.path === path && object.kind === "detail");
            const detail = validateLedgerDetails({ ...(old?.kind === "detail" ? old.value : {}),
                schemaVersion: 1, eventId: id, operationId, ...(confirms && purchase.value.aiParsed ? { aiConfirmed: true } : {}) });
            writes.push({ path, expectedObjectId: old?.objectId ?? null, value: detail, strict: true });
        }
        return writes;
    }
    allocationFits(snapshot, purchaseId, total, proposed, selfId) {
        if (!Number.isSafeInteger(proposed) || proposed <= 0)
            return false;
        const purchase = sourceById(snapshot, purchaseId)?.value;
        if (!purchase)
            return false;
        const currency = detailFor(snapshot, purchase)?.correction?.currency ?? purchase.currency;
        let used = proposed;
        for (const object of snapshot.objects) {
            if (object.kind !== "detail" || object.value.refundOf !== purchaseId || object.value.eventId === selfId || object.value.voided)
                continue;
            const linked = sourceById(snapshot, object.value.eventId);
            if (!linked)
                return false;
            const refundCurrency = object.value.correction?.currency ?? linked.value.currency;
            const refundAmount = object.value.correction?.amountMinor ?? linked.value.amountMinor;
            const allocation = object.value.refundAllocation;
            if (allocation ? allocation.currency !== currency || refundCurrency === currency && allocation.originalMinor !== refundAmount :
                refundCurrency !== currency)
                return false;
            used += allocation?.originalMinor ?? refundAmount;
            if (!Number.isSafeInteger(used) || used > total)
                return false;
        }
        return used <= total;
    }
    priorCredits(snapshot, purchaseId, selfId) {
        const purchase = sourceById(snapshot, purchaseId)?.value;
        if (!purchase)
            return null;
        const currency = detailFor(snapshot, purchase)?.correction?.currency ?? purchase.currency;
        let credits = 0;
        for (const object of snapshot.objects) {
            if (object.kind !== "detail" || object.value.refundOf !== purchaseId || object.value.eventId === selfId || object.value.voided)
                continue;
            const source = sourceById(snapshot, object.value.eventId)?.value;
            if (!source)
                return null;
            const allocation = object.value.refundAllocation;
            const refundCurrency = object.value.correction?.currency ?? source.currency;
            const refundAmount = object.value.correction?.amountMinor ?? source.amountMinor;
            if (allocation ? allocation.currency !== currency || refundCurrency === currency && allocation.originalMinor !== refundAmount :
                refundCurrency !== currency)
                return null;
            credits += allocation ? allocationCreditMinor(allocation) : refundAmount;
            if (!Number.isSafeInteger(credits))
                return null;
        }
        return credits;
    }
}
export function sourceById(snapshot, id) {
    return snapshot.objects.find((object) => object.kind === "source" && object.value.id === id);
}
export function detailFor(snapshot, event) { return detailObject(snapshot, event)?.value ?? null; }
export function detailObject(snapshot, event) {
    return snapshot.objects.find((item) => item.path === detailPath(event) && item.kind === "detail");
}
function validationLedger(snapshot) {
    const rules = snapshot.objects.find(object => object.kind === "user-rules");
    const preferences = snapshot.objects.find(object => object.kind === "preferences");
    return assembleEffectiveLedger({
        sources: snapshot.objects.flatMap(object => object.kind === "source" ? [object.value] : []),
        details: snapshot.objects.flatMap(object => object.kind === "detail" ? [{ partition: object.partition, value: object.value }] : []),
        ...(preferences?.kind === "preferences" ? { preferences: preferences.value } : {}),
        projects: snapshot.objects.flatMap(object => object.kind === "project" ? [object.value] : []),
        userRules: rules?.kind === "user-rules" ? rules.value : defaultUserRulesDocument(), aiRules: new Map(),
    });
}
