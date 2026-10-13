import { defaultUserRulesDocument } from "../core/index.js";
import { ConnectionCapability } from "../application/connection-capability.js";
import { LedgerCommands } from "../application/commands.js";
import { LedgerPreferenceService } from "../application/preferences.js";
import { createLocalViewerQuery, createLocalViewerReportQuery, createLocalViewerSearch, queryViewerOrganization } from "../application/viewer-query.js";
import { validateLedgerObjectAtPath } from "../core/index.js";
import { MemorySnapshotStore } from "../local/memory.js";
import { LocalOutboxStore } from "../local/outbox.js";
import { LedgerOutbox } from "../application/outbox.js";
import { LedgerPush } from "../application/push.js";
import { unrecordedReader } from "./unrecorded-reader.js";
import { observeSnapshotPublications } from "./snapshot-publication.js";
/** Session-memory adapter for synthetic ledgers. It exercises the same commands, preferences and local queries as GitHub. */
export function createMemoryViewerSession(options) {
    const objects = options.snapshot.objects.map(object => ({ ...validateLedgerObjectAtPath(object.path, object.value), objectId: object.objectId }));
    const store = new MemorySnapshotStore({ snapshot: Object.freeze({ ...options.snapshot, objects: Object.freeze(objects) }) });
    const publications = observeSnapshotPublications(store);
    const capability = new ConnectionCapability({ evidence: options.readOnly ? "read-only" : "writable",
        ...(options.ledgerRetained === undefined ? {} : { ledgerRetained: options.ledgerRetained }) });
    async function hash(value) {
        const buffer = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(value));
        return [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, "0")).join("");
    }
    const outbox = new LedgerOutbox(new LocalOutboxStore(store), publications.store, unrecordedReader, publications.notify);
    const commands = new LedgerCommands({ store: outbox.snapshotStore, outbox, capability: () => capability.state,
        ...(options.rates ? { rates: options.rates } : {}) });
    const synchronize = async () => {
        const snapshot = await store.read();
        return { status: "unchanged",
            commit: snapshot.cursor?.commit ?? "", complete: snapshot.coverage.complete, remainingMonths: 0 };
    };
    const push = new LedgerPush({ local: publications.store, outbox, now: () => new Date().toISOString(),
        synchronizer: { sync: synchronize }, remote: {
            async readPaths(_head, paths) { const snapshot = await store.read(); return paths.map(path => ({ path, object: snapshot.objects.find(item => item.path === path) ?? null })); },
            async commit(batch) {
                const objectIds = {};
                for (const write of batch.writes)
                    if (write.value !== null)
                        objectIds[write.path] = await hash(JSON.stringify(write.value));
                return { status: "confirmed", parentCommit: batch.head, commit: await hash(`${batch.head}:${JSON.stringify(objectIds)}`), objectIds };
            },
        } });
    const preferences = new LedgerPreferenceService({ store: publications.store, outbox, commands,
        capability: () => capability.state, localTimeZone: options.localTimeZone, onChange: publications.notify });
    const effective = { read: () => preferences.snapshot(), publish: publications.store.publish };
    const query = createLocalViewerQuery(effective, options.localTimeZone);
    const search = createLocalViewerSearch(effective, options.bankName ?? (() => ""), options.localTimeZone);
    const report = createLocalViewerReportQuery(effective, options.localTimeZone);
    const retention = { credential: false, ledger: false, ...options.deviceRetention };
    // Synthetic bank names are a presentation profile over validated bank identities.
    const displayRecord = (record) => record.paymentMethod.bankId && options.bankName
        ? { ...record, paymentMethod: { ...record.paymentMethod, label: options.bankName(record.paymentMethod.bankId) } } : record;
    if (options.bankName) {
        const readPicker = preferences.picker.bind(preferences);
        preferences.picker = async () => {
            const picker = await readPicker();
            return { ...picker,
                methods: picker.methods.map(method => method.kind === "bank" ? { ...method, label: options.bankName(method.id) } : method) };
        };
    }
    return { label: options.label, kind: options.kind ?? "demo", owner: options.owner ?? "", repo: options.repo ?? "", branch: options.branch ?? "main", persistence: "session",
        async query(request) {
            const result = await query.query(request);
            return options.bankName ? { ...result,
                report: { ...result.report, records: result.report.records.map(displayRecord) },
                installmentBalances: { ...result.installmentBalances, plans: result.installmentBalances.plans.map(plan => ({ ...plan, record: displayRecord(plan.record) })) },
                billingCycleSpending: { ...result.billingCycleSpending, groups: result.billingCycleSpending.groups.map(group => group.bankId
                        ? { ...group, label: options.bankName(group.bankId) } : group) } } : result;
        },
        async search(request) { const result = await search.search(request); return { ...result, records: result.records.map(displayRecord) }; },
        async listRecords(asOf) { const result = await search.list(asOf); return { ...result, records: result.records.map(displayRecord) }; },
        async report(request) {
            const result = await report.query(request);
            return result.kind === "category-records" ? { ...result, report: { ...result.report, records: result.report.records.map(displayRecord) },
                records: result.records.map(item => ({ ...item, record: displayRecord(item.record) })) }
                : result.kind === "year-comparison" ? { ...result, records: result.records.map(item => ({ ...item, record: displayRecord(item.record) })) } : result;
        }, commands, preferences, outbox,
        push: request => capability.state.status === "read-only" ? Promise.resolve({ status: "write-denied" }) : push.push(request),
        organization: async (asOf) => queryViewerOrganization(await preferences.snapshot(), options.bankName, asOf),
        deviceRetention: { read: () => ({ ...retention }), async credential(value) { retention.credential = value; return true; },
            async ledger(value) { retention.ledger = value; return true; } },
        get capability() { return capability.state; }, broaderAccess: false, recheckWriteCapability() { capability.recheck(); },
        onPublication: listener => publications.subscribe(listener),
        async synchronize() { return [await synchronize()]; },
        drafts: { put: (id, draft) => store.putDraft(id, draft), get: id => store.getDraft(id), delete: id => store.deleteDraft(id) },
        release() { preferences.dispose(); capability.clear(); }, async forget() { capability.clear(); await preferences.discard(); await store.forget(); },
        async disconnect() { capability.clear(); await preferences.discard(); await store.forget(); } };
}
const IDS = [
    "10000000-0000-4000-8000-000000000001", "10000000-0000-4000-8000-000000000002", "10000000-0000-4000-8000-000000000003",
];
const OPS = [
    "20000000-0000-4000-8000-000000000001", "20000000-0000-4000-8000-000000000002", "20000000-0000-4000-8000-000000000003",
];
const PROJECT_ID = "synthetic-weekend";
function demoObjects(now) {
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, "0");
    const partition = `${year}/${month}`;
    const events = [
        { schemaVersion: 1, id: IDS[0], bankId: "cathay-united", amountMinor: 12_800, currency: "TWD", occurredAt: `${year}-${month}-12T04:30:00.000Z`, timeProvenance: "notification", merchant: "合成咖啡店" },
        { schemaVersion: 1, id: IDS[1], bankId: "dbs-taiwan", amountMinor: 950, currency: "JPY", occurredAt: `${year}-${month}-13T08:00:00.000Z`, timeProvenance: "capture", merchant: "合成電車" },
        { schemaVersion: 1, id: IDS[2], bankId: "taipei-fubon", amountMinor: 2_480, currency: "TWD", occurredAt: `${year}-${month}-14T05:15:00.000Z`, timeProvenance: "capture", merchant: "合成市場" },
    ];
    const categories = defaultUserRulesDocument().categories;
    const details = [
        { schemaVersion: 1, eventId: IDS[0], operationId: OPS[0], categoryId: "dining", subscription: { note: "合成資料" } },
        { schemaVersion: 1, eventId: IDS[1], operationId: OPS[1], categoryId: "transport", projectId: PROJECT_ID },
        { schemaVersion: 1, eventId: IDS[2], operationId: OPS[2], categoryId: "shopping" },
    ];
    const objects = [
        ...events.map((value, index) => ({ kind: "source", path: `events/v1/${partition}/${value.id}.json`, value, objectId: (index + 1).toString(16).padStart(40, "0") })),
        ...details.map((value, index) => ({ kind: "detail", path: `details/v1/${partition}/${value.eventId}.json`, partition, value, objectId: (index + 10).toString(16).padStart(40, "0") })),
        { kind: "user-rules", path: "rules/user.json", value: { ...defaultUserRulesDocument(), categories }, objectId: "a".repeat(40) },
        { kind: "project", path: `projects/${PROJECT_ID}.json`, value: { schemaVersion: 1, id: PROJECT_ID, label: "合成週末小旅行", archived: false }, objectId: "b".repeat(40) },
    ];
    return objects;
}
/** Fixed synthetic reference rates for the demo; clearly labeled by provider, never fetched. */
const DEMO_RATES = Object.freeze({ JPY: "0.2127", USD: "32.15", KWD: "105.2" });
function demoRates(now) {
    return {
        async readRates(requests) {
            return requests.map(request => {
                const rate = DEMO_RATES[request.currency];
                return rate ? { status: "found", request, quote: { currency: request.currency, requestedOn: request.date, effectiveOn: request.date,
                        rate, provider: "synthetic-demo", retrievedAt: now() } } : { status: "failed", request, code: "rate-unavailable" };
            });
        },
    };
}
export function createMonthlyDemo(bankName = () => "", clock = () => new Date().toISOString()) {
    const now = new Date(clock());
    return createMemoryViewerSession({ snapshot: { cursor: { commit: "c".repeat(40), synchronizedAt: now.toISOString() },
            coverage: { complete: true, missing: [] }, objects: demoObjects(now) }, localTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        label: "合成示範資料", bankName, rates: demoRates(clock) });
}
