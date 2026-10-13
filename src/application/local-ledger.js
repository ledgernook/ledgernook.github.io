import { defaultUserRulesDocument, eventPath, validateLedgerObjectAtPath } from "../core/index.js";
import { parseInboxEvent } from "./commands.js";
import { detailNeedsHistory, LedgerCommandValidation } from "./command-validation.js";
import { recoveryTargetsFromIntents } from "./outbox.js";
import { replayWrite, overlayLocalWrite, valuesEqual } from "./replay.js";
function apply(objects, writes, operationId) {
    for (const write of writes) {
        if (write.value === null)
            objects.delete(write.path);
        else if (!valuesEqual(objects.get(write.path)?.value, write.value))
            objects.set(write.path, { ...validateLedgerObjectAtPath(write.path, write.value),
                objectId: operationId ? `${operationId.replaceAll("-", "")}00000000` : objects.get(write.path)?.objectId ?? write.expectedObjectId ?? "0".repeat(40) });
    }
}
function missingCoverage(confirmed, intent, available = confirmed) {
    if (!confirmed.cursor || confirmed.coverage.missing.some(path => path === "initial" || path === "mutation-refresh" || path === "scope-rebuild" ||
        intent.command.writes.some(write => write.path === path || write.path.startsWith(`${path}/`))))
        return true;
    if (confirmed.coverage.complete && !confirmed.coverage.missing.length)
        return false;
    const objects = new Map(available.objects.map(object => [object.path, object]));
    apply(objects, intent.command.writes);
    const candidate = { ...confirmed, objects: [...objects.values()] };
    // A composite category editor has no ruleOperation. Inspect its retained base as well so a
    // missing historical reference cannot turn a removal into a pass (or a durable replay failure).
    return intent.command.ruleOperation?.kind === "categoryMerge" || intent.command.writes.some(write => {
        if (!write.value)
            return write.path.startsWith("projects/");
        const object = validateLedgerObjectAtPath(write.path, write.value), base = intent.bases[write.path]?.value;
        if (object.kind === "detail")
            return detailNeedsHistory(confirmed, candidate, object.value, base && "eventId" in base ? base : null);
        if (object.kind === "project")
            return object.value.archived && (!base || !("archived" in base) || !base.archived);
        if (object.kind !== "user-rules")
            return false;
        const previous = base && "categories" in base ? base.categories : defaultUserRulesDocument().categories;
        return previous.some(category => !object.value.categories.some(item => item.id === category.id));
    });
}
/** Definitions touched by a waiting/failed intent, and identities another intent reads. */
function intentIdentities(intent) {
    const changed = new Set(), referenced = new Set();
    const reference = (kind, id) => { if (id)
        referenced.add(`${kind}:${id}`); };
    function definitions(kind, before, after) {
        const old = new Map(before.map(item => [item.id, item])), desired = new Map(after.map(item => [item.id, item]));
        for (const id of new Set([...old.keys(), ...desired.keys()]))
            if (!valuesEqual(old.get(id), desired.get(id)))
                changed.add(`${kind}:${id}`);
    }
    for (const id of intent.descriptor.recordIds)
        changed.add(`record:${id}`);
    for (const write of intent.command.writes) {
        const base = intent.bases[write.path]?.value;
        if (write.path.startsWith("projects/"))
            changed.add(`project:${write.path.slice("projects/".length, -".json".length)}`);
        if (write.value === null)
            continue;
        const object = validateLedgerObjectAtPath(write.path, write.value);
        if (object.kind === "source")
            reference("payment-method", object.value.paymentMethodId);
        if (object.kind === "detail") {
            reference("record", object.value.eventId);
            reference("record", object.value.refundOf);
            reference("category", object.value.categoryId);
            reference("project", object.value.projectId);
            reference("payment-method", object.value.paymentMethodId);
            for (const line of object.value.split?.lines ?? [])
                reference("category", line.categoryId);
        }
        if (object.kind === "preferences") {
            definitions("payment-method", base && "paymentMethods" in base ? base.paymentMethods : [], object.value.paymentMethods);
            reference("project", object.value.currentTrip?.projectId);
            for (const id of object.value.pinnedCategoryIds)
                reference("category", id);
        }
        if (object.kind === "user-rules") {
            const previous = base && "categories" in base ? base : defaultUserRulesDocument();
            definitions("category", previous.categories, object.value.categories);
            definitions("brand", previous.brands, object.value.brands);
            for (const category of object.value.categories)
                reference("category", category.parentId);
            for (const id of Object.values(object.value.merchants))
                reference("brand", id);
            for (const [id, category] of Object.entries(object.value.brandCategories)) {
                reference("brand", id);
                reference("category", category);
            }
            for (const category of Object.values(object.value.exceptions))
                reference("category", category);
            for (const category of Object.values(object.value.mergedCategories ?? {}))
                reference("category", category);
        }
    }
    return { changed, referenced };
}
/** Pure three-layer composition: confirmed objects, accepted inbox entries, ordered intents. */
export function composeLocalLedger(confirmed, intents, reader) {
    const objects = new Map(confirmed.objects.map(object => [object.path, object]));
    const sourceIds = new Set(confirmed.objects.flatMap(object => object.kind === "source" ? [object.value.id] : []));
    const inboxWrites = [];
    for (const entry of confirmed.objects) {
        if (entry.kind !== "unrecorded")
            continue;
        if (!sourceIds.has(entry.value.id)) {
            const event = reader && parseInboxEvent(entry.value, reader);
            if (!event)
                continue;
            inboxWrites.push({ path: eventPath(event), expectedObjectId: null, value: event, strict: true });
            sourceIds.add(event.id);
        }
        inboxWrites.push({ path: entry.path, expectedObjectId: entry.objectId, value: null, strict: true });
    }
    apply(objects, inboxWrites);
    const pushObjects = new Map(objects), blocked = new Set(), blockedRecords = new Set();
    const waiting = new Set(), waitingRecords = new Set();
    const blockedIdentities = new Set(), waitingIdentities = new Set();
    const results = [];
    const recoveryContexts = new Map();
    const records = {}, settings = {};
    const validator = new LedgerCommandValidation();
    const snapshotOf = (values) => ({ ...confirmed, objects: [...values.values()] });
    for (const [index, intent] of intents.entries()) {
        const identities = intentIdentities(intent);
        const successors = (path) => {
            const later = [];
            for (const next of intents.slice(index + 1)) {
                const write = next.command.writes.find(write => write.path === path);
                if (!write)
                    continue;
                if (next.failure)
                    break;
                later.push({ write, base: next.bases[path] ?? null });
            }
            return later;
        };
        const writes = [];
        let reason = intent.failure;
        let temporary;
        if (intent.command.writes.some(write => blocked.has(write.path)) || intent.descriptor.recordIds.some(id => blockedRecords.has(id)) ||
            [...identities.referenced].some(id => blockedIdentities.has(id)))
            reason = "dependency-failed";
        if (!reason && (intent.command.writes.some(write => waiting.has(write.path)) || intent.descriptor.recordIds.some(id => waitingRecords.has(id)) ||
            [...identities.referenced].some(id => waitingIdentities.has(id))))
            temporary = "incomplete-coverage";
        if (!reason && missingCoverage(confirmed, intent, snapshotOf(pushObjects)))
            temporary = "incomplete-coverage";
        if (!reason && !temporary) {
            for (const write of intent.command.writes) {
                const replay = replayWrite(write, intent.bases[write.path] ?? null, pushObjects.get(write.path)?.value ?? null, intent.command.ruleOperation, successors(write.path));
                if (replay.status === "failed") {
                    reason = replay.reason;
                    break;
                }
                writes.push({ ...write, expectedObjectId: pushObjects.get(write.path)?.objectId ?? null, value: replay.value });
            }
        }
        if (!reason && !temporary) {
            const candidate = new Map(pushObjects);
            apply(candidate, writes);
            const validation = validator.validateReplay(snapshotOf(pushObjects), snapshotOf(candidate), writes, confirmed);
            if (validation.status === "failed")
                reason = validation.reason;
            if (validation.status === "temporary")
                temporary = validation.reason;
            if (!reason && !temporary)
                apply(pushObjects, writes, intent.command.operationId);
        }
        // State "done" describes GitHub's confirmed values, never an earlier device-local overlay.
        const isReflected = !reason && !temporary && intent.command.writes.every(write => {
            const replay = replayWrite(write, intent.bases[write.path] ?? null, confirmed.objects.find(object => object.path === write.path)?.value ?? null, intent.command.ruleOperation, successors(write.path));
            return replay.status === "done";
        });
        const state = reason ? "failed" : isReflected ? "done" : "pending";
        if (reason) {
            const absentPaths = new Set(), changedPaths = new Set();
            for (const [path, source] of Object.entries(intent.observedSources ?? {})) {
                if (![...pushObjects.values()].some(object => object.kind === "source" && object.value.id === source.value.id))
                    absentPaths.add(path);
            }
            for (const write of intent.command.writes) {
                const current = pushObjects.get(write.path)?.value ?? null, base = intent.bases[write.path]?.value ?? null;
                if (write.path.startsWith("projects/") && write.value !== null && intent.bases[write.path] !== null && current === null)
                    absentPaths.add(write.path);
                if (write.path.startsWith("projects/") && write.value === null && !valuesEqual(base, current))
                    changedPaths.add(write.path);
            }
            if (absentPaths.size || changedPaths.size)
                recoveryContexts.set(intent.command.operationId, { absentPaths, changedPaths });
        }
        if (reason) {
            for (const write of intent.command.writes)
                blocked.add(write.path);
            for (const id of intent.descriptor.recordIds)
                blockedRecords.add(id);
        }
        if (temporary) {
            for (const write of intent.command.writes)
                waiting.add(write.path);
            for (const id of intent.descriptor.recordIds)
                waitingRecords.add(id);
        }
        if (reason)
            for (const id of identities.changed)
                blockedIdentities.add(id);
        if (temporary)
            for (const id of identities.changed)
                waitingIdentities.add(id);
        const localWrites = reason || temporary ? intent.command.writes.map(write => overlayLocalWrite(write, intent.bases[write.path] ?? null, objects.get(write.path)?.value ?? null)) : writes;
        // A failed edit retains its last known record in local queries, without adding push writes.
        if (reason)
            for (const [path, source] of Object.entries(intent.observedSources ?? {})) {
                if (![...objects.values()].some(object => object.kind === "source" && object.value.id === source.value.id)) {
                    objects.set(path, { ...validateLedgerObjectAtPath(path, source.value), objectId: source.objectId });
                }
            }
        apply(objects, localWrites, intent.command.operationId);
        results.push({ intent, state, ...(reason ? { reason } : {}), ...(temporary ? { temporary } : {}), writes: reason || temporary ? [] : writes });
        if (state === "done")
            continue;
        for (const id of intent.descriptor.recordIds)
            records[id] = records[id] === "failed" ? "failed" : state;
        for (const path of intent.descriptor.settingPaths)
            settings[path] = settings[path] === "failed" ? "failed" : state;
    }
    const recoveryTargets = recoveryTargetsFromIntents(results, recoveryContexts);
    const marks = { pendingCount: results.filter(result => result.state === "pending").length,
        failedCount: results.filter(result => result.state === "failed").length, records, settings, recoveryTargets };
    const local = intents.length > 0 || inboxWrites.length > 0;
    return { snapshot: local ? { ...snapshotOf(objects),
            revision: `${confirmed.revision ?? confirmed.cursor?.commit ?? "initial"}:local:${JSON.stringify([inboxWrites.map(write => write.path), results.map(result => [result.intent.command.operationId, result.state, result.reason, result.temporary])])}`, localChanges: marks } : confirmed,
        pushSnapshot: snapshotOf(pushObjects), intents: results, marks, recoveryTargets, inboxWrites,
        temporary: results.some(result => result.temporary) ? "incomplete-coverage" : null };
}
