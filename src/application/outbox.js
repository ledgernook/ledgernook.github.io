import { detailPath, validateLedgerObjectAtPath } from "../core/index.js";
import { checkMutationCommand } from "./ports.js";
import { composeLocalLedger } from "./local-ledger.js";
import { resendWrite, valuesEqual } from "./replay.js";
export const OUTBOX_DRAFT_KEY = "ledger-outbox";
/** Recovery routes come from the retained command, never from visible overlay objects. */
export function recoveryTargetsFromIntents(intents, contexts = new Map()) {
    const targets = new Map();
    for (const { intent, state, reason } of intents) {
        if (state !== "failed")
            continue;
        const failure = reason ?? intent.failure;
        const recoveryContext = contexts.get(intent.command.operationId);
        const isDetail = (write) => write.path.startsWith("details/") && !!write.value &&
            typeof write.value === "object" && "eventId" in write.value;
        const detailWrites = intent.command.writes.filter(isDetail);
        const changedDetailField = (field, desiredValue) => detailWrites.some(write => {
            const before = intent.bases[write.path]?.value;
            const after = write.value;
            const changed = !valuesEqual(before?.[field], after[field]);
            return changed && (desiredValue === undefined || valuesEqual(after[field], desiredValue));
        });
        const recordAspects = (objectId) => {
            const labels = new Set();
            for (const write of detailWrites) {
                const after = write.value;
                if (after.eventId !== objectId)
                    continue;
                const before = intent.bases[write.path]?.value;
                const changed = (key) => !valuesEqual(before?.[key], after[key]);
                if (changed("categoryId") || changed("split"))
                    labels.add("分類");
                if (changed("notes"))
                    labels.add("備註");
                if (changed("projectId"))
                    labels.add("專案");
                if (changed("paymentMethodId") || changed("paymentMethodLabel"))
                    labels.add("付款方式");
                if (changed("subscription"))
                    labels.add("訂閱標記");
                if (changed("voided"))
                    labels.add("作廢");
                if (changed("refundOf") || changed("refundAllocation"))
                    labels.add("退款分攤");
                if (changed("installmentPlan"))
                    labels.add("分期");
                if (changed("valuation"))
                    labels.add("換算");
                if (changed("aiConfirmed"))
                    labels.add("AI 整理");
                if (changed("correction")) {
                    const oldCorrection = (before?.correction ?? {});
                    const newCorrection = (after.correction ?? {});
                    if (["amountMinor", "currency"].some(key => !valuesEqual(oldCorrection[key], newCorrection[key])))
                        labels.add("金額");
                    if (["occurredAt", "occurredOn"].some(key => !valuesEqual(oldCorrection[key], newCorrection[key])))
                        labels.add("日期");
                    if (["merchant", "description"].some(key => !valuesEqual(oldCorrection[key], newCorrection[key])))
                        labels.add("商家名稱");
                }
            }
            return [...labels];
        };
        const noticeFor = (kind, objectId) => {
            if (kind === "record") {
                const absentSource = Object.entries(intent.observedSources ?? {}).some(([path, source]) => source.value.id === objectId && recoveryContext?.absentPaths.has(path));
                if (failure === "conflict" && absentSource)
                    return { noticeKind: "record-edit-deleted" };
                if (intent.command.writes.some(write => write.path.startsWith("events/") && write.value && "id" in write.value && write.value.id === objectId)) {
                    return { noticeKind: "record-create" };
                }
                if (changedDetailField("voided", true))
                    return { noticeKind: "record-void" };
                if (changedDetailField("installmentPlan"))
                    return { noticeKind: "record-installment" };
                if (changedDetailField("refundAllocation"))
                    return { noticeKind: "record-refund-allocation" };
                const aspects = recordAspects(objectId);
                return { noticeKind: "record-edit", ...(aspects.length ? { aspects } : {}) };
            }
            if (kind === "project") {
                const path = `projects/${objectId}.json`, write = intent.command.writes.find(item => item.path === path);
                if (!write)
                    return { noticeKind: "project-edit" };
                if (write.value === null) {
                    if (failure === "project-has-records")
                        return { noticeKind: "project-delete-has-records" };
                    if (failure === "project-current-trip" || failure === "active-trip")
                        return { noticeKind: "project-delete-current-trip" };
                    if (failure === "conflict" && recoveryContext?.changedPaths.has(path))
                        return { noticeKind: "project-delete-conflict" };
                    return { noticeKind: "project-delete" };
                }
                if (failure === "conflict" && intent.bases[path] !== null && recoveryContext?.absentPaths.has(path)) {
                    return { noticeKind: "project-edit-deleted" };
                }
                const before = intent.bases[path]?.value;
                const after = write.value;
                if (!before)
                    return { noticeKind: "project-create" };
                if (!valuesEqual(before.label, after.label))
                    return { noticeKind: "project-rename" };
                if (!valuesEqual(before.archived, after.archived))
                    return { noticeKind: after.archived === true ? "project-archive" : "project-unarchive" };
                return { noticeKind: "project-edit" };
            }
            if (kind === "unrecorded")
                return { noticeKind: intent.descriptor.kind === "create" ? "notification-record" : "notification-dismiss" };
            return { noticeKind: "setting-change" };
        };
        const add = (kind, objectId) => {
            const key = `${intent.command.operationId}:${kind}:${objectId}`;
            const target = { operationId: intent.command.operationId, kind, objectId, ...noticeFor(kind, objectId) };
            targets.set(key, target);
        };
        for (const id of intent.descriptor.recordIds)
            add("record", id);
        for (const write of intent.command.writes) {
            if (write.path.startsWith("projects/"))
                add("project", write.path.slice("projects/".length, -".json".length));
            else if (write.path.startsWith("unrecorded/"))
                add("unrecorded", write.path.slice(write.path.lastIndexOf("/") + 1, -".json".length));
            else if (write.value && "eventId" in write.value)
                add("record", write.value.eventId);
            else if (write.value && "id" in write.value && write.path.startsWith("events/"))
                add("record", write.value.id);
            else
                add("setting", write.path);
        }
    }
    return [...targets.values()];
}
export class OutboxStorageError extends Error {
    constructor() { super("Local change could not be retained"); this.name = "OutboxStorageError"; }
}
export function describeCommand(command, seen) {
    const recordIds = new Set(), settingPaths = new Set();
    let kind = "editDetails";
    for (const write of command.writes) {
        if (write.value === null) {
            if (kind !== "create")
                kind = write.path.startsWith("projects/") ? "deleteProject" : "removeUnrecorded";
            settingPaths.add(write.path);
            continue;
        }
        const object = validateLedgerObjectAtPath(write.path, write.value);
        if (object.kind === "source") {
            recordIds.add(object.value.id);
            kind = "create";
        }
        else if (object.kind === "detail") {
            recordIds.add(object.value.eventId);
            if (kind !== "create")
                kind = object.value.installmentPlan ? "installment" : object.value.refundAllocation ? "allocateRefund" : object.value.voided ? "void" : "editDetails";
        }
        else if (!valuesEqual(seen?.objects.find(item => item.path === write.path)?.value, write.value))
            settingPaths.add(write.path);
    }
    if (recordIds.size === 0 && !command.writes.some(write => write.value === null))
        kind = command.ruleOperation?.kind ??
            (command.writes.some(write => write.path === "rules/user.json") ? "editCategory" : command.writes.some(write => write.path.startsWith("projects/")) ? "project" : "preferences");
    return { kind, recordIds: [...recordIds], settingPaths: [...settingPaths] };
}
export function createChangeIntent(command, seen, metadata = {}) {
    const invalid = checkMutationCommand(command);
    if (invalid)
        throw new TypeError(`Invalid change intent: ${invalid}`);
    // A retried/resend source stays create-only even when the observed ledger already contains its id.
    if (command.writes.some(write => !write.path.startsWith("events/") && write.expectedObjectId !== (seen.objects.find(object => object.path === write.path)?.objectId ?? null))) {
        throw new TypeError("Invalid change intent: object identity does not match the observed value");
    }
    const bases = Object.fromEntries(command.writes.map(write => {
        const object = seen.objects.find(object => object.path === write.path);
        return [write.path, object ? { objectId: object.objectId, value: object.value } : null];
    }));
    const observedSources = Object.fromEntries(seen.objects.flatMap(object => object.kind === "source" &&
        command.writes.some(write => write.path === detailPath(object.value)) ? [[object.path, { objectId: object.objectId, value: object.value }]] : []));
    return validateChangeIntent({ command, bases, ...(Object.keys(observedSources).length ? { observedSources } : {}),
        descriptor: metadata.descriptor ?? describeCommand(command, seen), ...(metadata.now ? { now: metadata.now } : {}) });
}
const FAILURES = new Set(["conflict", "invalid-object", "dependency-failed", "project-has-records", "project-current-trip", "active-trip"]);
/** Persisted local data is untrusted; malformed entries fail visibly instead of being dropped. */
export function validateChangeIntent(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
        throw new TypeError("Invalid outbox intent");
    const intent = raw;
    if (checkMutationCommand(intent.command) || !intent.bases || typeof intent.bases !== "object" || Array.isArray(intent.bases) ||
        !intent.descriptor || typeof intent.descriptor.kind !== "string" || !intent.descriptor.kind ||
        !Array.isArray(intent.descriptor.recordIds) || !intent.descriptor.recordIds.every(id => typeof id === "string") ||
        !Array.isArray(intent.descriptor.settingPaths) || !intent.descriptor.settingPaths.every(path => typeof path === "string") ||
        intent.failure !== undefined && !FAILURES.has(intent.failure) || intent.now !== undefined && (!Number.isFinite(Date.parse(intent.now)) || new Date(intent.now).toISOString() !== intent.now))
        throw new TypeError("Invalid outbox intent");
    const bases = {};
    if (Object.keys(intent.bases).length !== intent.command.writes.length)
        throw new TypeError("Invalid intent bases");
    for (const write of intent.command.writes) {
        const base = intent.bases[write.path];
        if (base === undefined)
            throw new TypeError("Missing intent base");
        if (!write.path.startsWith("events/") && write.expectedObjectId !== (base?.objectId ?? null))
            throw new TypeError("Invalid intent base identity");
        if (base === null)
            bases[write.path] = null;
        else {
            if (!/^[0-9a-f]{40}$/.test(base.objectId))
                throw new TypeError("Invalid intent base identity");
            bases[write.path] = { objectId: base.objectId, value: validateLedgerObjectAtPath(write.path, base.value).value };
        }
    }
    const observedSources = {};
    if (intent.observedSources !== undefined) {
        if (!intent.observedSources || typeof intent.observedSources !== "object" || Array.isArray(intent.observedSources))
            throw new TypeError("Invalid observed sources");
        for (const [path, source] of Object.entries(intent.observedSources)) {
            if (!source || typeof source.objectId !== "string" || !/^[0-9a-f]{40}$/.test(source.objectId))
                throw new TypeError("Invalid observed source identity");
            const object = validateLedgerObjectAtPath(path, source.value);
            if (object.kind !== "source" || !intent.command.writes.some(write => write.path === detailPath(object.value)))
                throw new TypeError("Invalid observed source target");
            observedSources[path] = { objectId: source.objectId, value: object.value };
        }
    }
    const command = { operationId: intent.command.operationId, expectedBase: { commit: intent.command.expectedBase.commit },
        writes: intent.command.writes.map(write => ({ path: write.path, expectedObjectId: write.expectedObjectId,
            value: write.value === null ? null : validateLedgerObjectAtPath(write.path, write.value).value,
            ...(write.strict ? { strict: true } : {}) })), ...(intent.command.ruleOperation ? { ruleOperation: intent.command.ruleOperation } : {}) };
    return structuredClone({ command, bases, ...(intent.observedSources !== undefined ? { observedSources } : {}),
        descriptor: { kind: intent.descriptor.kind, recordIds: intent.descriptor.recordIds, settingPaths: intent.descriptor.settingPaths },
        ...(intent.now ? { now: intent.now } : {}), ...(intent.failure ? { failure: intent.failure } : {}) });
}
export function validateOutbox(raw) {
    if (!Array.isArray(raw))
        throw new TypeError("Invalid outbox");
    const entries = raw.map(validateChangeIntent);
    if (new Set(entries.map(entry => entry.command.operationId)).size !== entries.length)
        throw new TypeError("Duplicate outbox identity");
    return entries;
}
/** Local orchestration only: no clock, scheduler, credential or transport. */
export class LedgerOutbox {
    store;
    confirmed;
    reader;
    notify;
    listeners = new Set();
    onChange(listener) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
    changed() { for (const listener of this.listeners)
        listener(); }
    cached;
    constructor(store, confirmed, reader, notify = () => { }) {
        this.store = store;
        this.confirmed = confirmed;
        this.reader = reader;
        this.notify = notify;
    }
    async update(change) {
        try {
            await this.store.update(change);
        }
        catch (error) {
            if (error instanceof TypeError)
                throw error;
            throw new OutboxStorageError();
        }
        this.notify();
    }
    async submit(command, seen, metadata) {
        const invalid = checkMutationCommand(command);
        if (invalid)
            throw new TypeError(`Invalid change intent: ${invalid}`);
        let intent;
        await this.update(entries => {
            const old = entries.find(entry => entry.command.operationId === command.operationId);
            if (old && !valuesEqual({ writes: old.command.writes.map(({ expectedObjectId: _id, ...write }) => write), ruleOperation: old.command.ruleOperation }, { writes: command.writes.map(({ expectedObjectId: _id, ...write }) => write), ruleOperation: command.ruleOperation }))
                throw new TypeError("Operation identity already used");
            intent = old ?? createChangeIntent(command, seen, metadata);
            return old ? entries : [...entries, intent];
        });
        this.changed();
        return intent;
    }
    async ledger() {
        const confirmed = await this.confirmed.read();
        let entries = await this.store.read();
        if (this.cached?.confirmed === confirmed && valuesEqual(this.cached.entries, entries))
            return this.cached.ledger;
        let ledger = composeLocalLedger(confirmed, entries, this.reader);
        const failures = ledger.intents.filter(result => result.state === "failed" && !result.intent.failure);
        if (failures.length) {
            await this.update(current => current.map(intent => {
                const failed = failures.find(result => result.intent.command.operationId === intent.command.operationId && valuesEqual(result.intent, intent));
                return failed ? { ...intent, failure: failed.reason } : intent;
            }));
            entries = await this.store.read();
            ledger = composeLocalLedger(confirmed, entries, this.reader);
        }
        this.cached = { confirmed, entries, ledger };
        return ledger;
    }
    async list() { return (await this.ledger()).intents; }
    async recoveryTargets() { return (await this.ledger()).recoveryTargets; }
    async countPending() { return (await this.ledger()).marks.pendingCount; }
    /** Dependency failures are derived from preceding failures; an explicit action must recalculate them. */
    replayDependencies(entries, start, confirmed) {
        const replayable = entries.map((intent, index) => {
            if (index < start || intent.failure !== "dependency-failed")
                return intent;
            const { failure: _failure, ...rest } = intent;
            return rest;
        });
        return composeLocalLedger(confirmed, replayable, this.reader).intents.map(result => result.state === "failed" && !result.intent.failure ? { ...result.intent, failure: result.reason } : result.intent);
    }
    /** Rebase against confirmed + preceding replayable intents, excluding the failed overlay itself. */
    async resend(target) {
        const operationId = typeof target === "string" ? target : target.operationId;
        const ledger = await this.ledger();
        const index = ledger.intents.findIndex(result => result.intent.command.operationId === operationId);
        const result = ledger.intents[index];
        if (!result || result.state !== "failed")
            return;
        const confirmed = await this.confirmed.read();
        const current = composeLocalLedger(confirmed, ledger.intents.slice(0, index).map(result => result.intent), this.reader).pushSnapshot;
        const { failure: _failure, ...old } = result.intent;
        const writes = [];
        const bases = {};
        // Only an explicit resend promotes a missing observed source into a create-only write.
        for (const [path, source] of Object.entries(old.observedSources ?? {})) {
            if (old.command.writes.some(write => write.path === path) || current.objects.some(object => object.kind === "source" && object.value.id === source.value.id))
                continue;
            writes.push({ path, expectedObjectId: null, value: source.value, strict: true });
            bases[path] = null;
        }
        for (const write of old.command.writes) {
            const object = current.objects.find(object => object.path === write.path);
            const replay = resendWrite(write, old.bases[write.path] ?? null, object?.value ?? null, old.command.ruleOperation);
            if (replay.status === "failed") {
                await this.update(entries => entries.map(intent => valuesEqual(intent, result.intent) ? { ...intent, failure: replay.reason } : intent));
                return;
            }
            // An absent deletion is already satisfied. Retain its admitted identity/base until settlement;
            // deletion commands require a blob identity, and replay settles absence by desired value.
            bases[write.path] = object ? { objectId: object.objectId, value: object.value } : write.value === null ? old.bases[write.path] ?? null : null;
            writes.push({ ...write, value: replay.value, expectedObjectId: write.path.startsWith("events/") ? null
                    : object?.objectId ?? (write.value === null ? write.expectedObjectId : null) });
        }
        const replacement = validateChangeIntent({ ...old, bases, command: { ...old.command,
                expectedBase: { commit: current.cursor?.commit ?? old.command.expectedBase.commit }, writes } });
        await this.update(entries => {
            const position = entries.findIndex(intent => valuesEqual(intent, result.intent));
            if (position < 0)
                return entries;
            return this.replayDependencies(entries.map((intent, index) => index === position ? replacement : intent), position + 1, confirmed);
        });
        this.changed();
    }
    async discard(target) {
        const operationId = typeof target === "string" ? target : target.operationId;
        const result = (await this.list()).find(result => result.intent.command.operationId === operationId);
        if (result?.state === "failed") {
            const confirmed = await this.confirmed.read();
            await this.update(entries => {
                const position = entries.findIndex(intent => valuesEqual(intent, result.intent));
                if (position < 0)
                    return entries;
                return this.replayDependencies(entries.filter((_, index) => index !== position), position, confirmed);
            });
        }
    }
    /** Caller supplies the exact intent versions included in a confirmed push; newer resends survive. */
    async removeSettled(settled) {
        if (settled.length)
            await this.update(entries => entries.filter(intent => !settled.some(item => valuesEqual(item, intent))));
    }
    /** Publish push settlements atomically, preserving newer resends and submissions. */
    async settle(done, failed) {
        if (!done.length && !failed.some(result => result.reason && !result.intent.failure))
            return;
        await this.update(current => current.flatMap(intent => {
            if (done.some(entry => valuesEqual(entry, intent)))
                return [];
            const result = failed.find(result => valuesEqual(result.intent, intent));
            return [result?.reason ? { ...intent, failure: result.reason } : intent];
        }));
    }
    snapshotStore = { read: async () => (await this.ledger()).snapshot, publish: publication => this.confirmed.publish(publication) };
}
