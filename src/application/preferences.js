import { defaultLedgerPreferences, effectivePaymentMethod, eventOccurrence, occurrenceSortKey, paymentMethodName, validateReportingTimeZone, manualEntryDefaults, } from "../core/index.js";
import { LedgerCommands } from "./commands.js";
export function snapshotPreferences(snapshot, localTimeZone) {
    const object = snapshot.objects.find(object => object.kind === "preferences");
    const value = object?.kind === "preferences" ? object.value : defaultLedgerPreferences();
    return { value, remoteState: object ? "present" : snapshot.coverage.preferencesLoaded || snapshot.coverage.complete ? "absent" : "not-loaded",
        objectId: object?.objectId ?? null, reportingTimeZone: value.reportingTimeZone ?? validateReportingTimeZone(localTimeZone),
        notice: null };
}
export function selectManualEntryDefaults(snapshot) {
    return manualEntryDefaults(snapshotPreferences(snapshot, "UTC").value, snapshot.objects.flatMap(object => object.kind === "project" ? [object.value] : []));
}
/** Preference API adapter: every patch is an intent; push timing belongs to the sync scheduler. */
export class LedgerPreferenceService {
    options;
    outbox;
    commands;
    running = Promise.resolve();
    disposed = false;
    constructor(options) {
        this.options = options;
        validateReportingTimeZone(options.localTimeZone);
        this.outbox = options.outbox;
        this.commands = new LedgerCommands({ ...options.commands.options, store: this.outbox.snapshotStore, outbox: this.outbox, capability: options.capability });
    }
    async hasPending() { return (await this.outbox.list()).some(result => result.state !== "done"); }
    async read() {
        const entries = await this.outbox.store.read();
        const snapshot = entries.length ? await this.snapshot() : await (this.options.readPreferences?.() ?? this.options.store.read());
        const model = snapshotPreferences(snapshot, this.options.localTimeZone);
        const state = snapshot.localChanges?.settings["preferences.json"];
        return { ...model, ...(state ? { syncState: state } : {}),
            notice: state === "failed" ? "未能同步" : null };
    }
    async snapshot() { return (await this.outbox.ledger()).snapshot; }
    async picker() {
        const model = await this.read();
        const snapshot = await this.snapshot();
        const methods = model.value.paymentMethods.map(method => ({ ...method, label: paymentMethodName(method) }));
        // Prefer creation time over the expenditure date (which can be backdated).
        const details = new Map(snapshot.objects.flatMap(object => object.kind === "detail" ? [[object.value.eventId, object.value]] : []));
        let latest;
        let latestKey = "";
        for (const object of snapshot.objects) {
            if (object.kind !== "source" || object.value.source !== "manual" || (object.value.kind ?? "expense") !== "expense" || details.get(object.value.id)?.voided)
                continue;
            const key = `${object.value.enteredAt ?? occurrenceSortKey(eventOccurrence(object.value))}:${object.value.id}`;
            if (key > latestKey) {
                latest = object.value;
                latestKey = key;
            }
        }
        const effective = latest ? effectivePaymentMethod(latest, details.get(latest.id), model.value) : undefined;
        const selected = effective && methods.find(method => effective.id !== undefined ? method.id === effective.id : method.label === effective.label);
        return { methods, defaultId: selected?.id ?? methods.find(method => method.kind === "cash")?.id ?? methods[0].id,
            entryDefaults: manualEntryDefaults(model.value, snapshot.objects.flatMap(object => object.kind === "project" ? [object.value] : [])) };
    }
    async entryDefaults() { return selectManualEntryDefaults(await this.snapshot()); }
    startTrip(context, projectId, currency) {
        return this.change(context, { currentTrip: { projectId, currency } });
    }
    endTrip(context) { return this.change(context, { currentTrip: null }); }
    change(context, patch) {
        const work = this.running.then(async () => {
            if (this.disposed || this.options.capability().status === "read-only")
                return { status: "rejected", operationId: context.operationId, code: "permission-denied" };
            if (!patch || typeof patch !== "object" || Array.isArray(patch) || !Object.keys(patch).length ||
                Object.keys(patch).some(key => !["paymentMethods", "organiserModel", "reportingTimeZone", "pinnedCategoryIds", "currentTrip"].includes(key)))
                return { status: "rejected", operationId: context.operationId, code: "invalid-command" };
            const snapshot = await this.snapshot();
            const model = snapshotPreferences(snapshot, this.options.localTimeZone);
            return this.commands.editPreferences(context, { ...model.value, ...patch });
        });
        this.running = work.catch(() => { });
        return work;
    }
    /** Called by the existing explicit-forget path; normal release keeps every intent. */
    async discard() { this.disposed = true; await this.running; await this.outbox.removeSettled(await this.outbox.store.read()); }
    dispose() { this.disposed = true; }
}
