import { LedgerPreferenceService } from "../application/preferences.js";
import { LocalOutboxStore } from "../local/outbox.js";
import { LedgerOutbox, OUTBOX_DRAFT_KEY } from "../application/outbox.js";
import { LedgerPush } from "../application/push.js";
import { unrecordedReader } from "./unrecorded-reader.js";
import { ConnectionCapability } from "../application/connection-capability.js";
import { hasClassicRepoScope } from "./remembered-connection.js";
import { createLocalViewerQuery, LedgerCommands, utcPartitions } from "../application/index.js";
import { LedgerSynchronizer } from "../application/sync.js";
import { IncrementalGitHubReader } from "../storage/incremental.js";
import { GitHubLedgerBatch } from "../storage/mutation.js";
import { createFrankfurterRates } from "../fx/frankfurter.js";
import { IndexedDbSnapshotStore, LOCAL_CALCULATION_VERSION, LOCAL_SCHEMA_VERSION } from "../local/index.js";
import { MemorySnapshotStore } from "../local/memory.js";
import { createLocalViewerSearch, createLocalViewerReportQuery, queryViewerOrganization } from "../application/viewer-query.js";
import { observeSnapshotPublications } from "./snapshot-publication.js";
import { SwitchableLedgerStore } from "./device-ledger-store.js";
import { createLedgerRetentionConsent } from "./connection-retention.js";
function namespaceFor(connection) {
    return {
        origin: location.origin,
        connectionId: connection.account.toLowerCase(),
        repositoryId: connection.repository.toLowerCase(),
        branch: connection.branch,
    };
}
function unavailableReason(error) {
    const code = error !== null && typeof error === "object" && "code" in error ? String(error.code) : "unknown";
    return code === "quota" ? "瀏覽器本機儲存空間已滿" : "瀏覽器未提供可用的本機資料庫";
}
async function retainedStore(scope) {
    try {
        const indexedStore = new IndexedDbSnapshotStore(scope, {
            schemaVersion: LOCAL_SCHEMA_VERSION, calculationVersion: LOCAL_CALCULATION_VERSION, localTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        });
        await indexedStore.ready();
        const store = indexedStore;
        let notice;
        try {
            const storage = navigator.storage;
            if (storage?.persisted && !(await storage.persisted()) && storage.persist) {
                const persisted = await storage.persist();
                if (!persisted)
                    notice = "瀏覽器未確認持久化；本機資料仍可能被系統清除。";
            }
        }
        catch {
            notice = "無法確認瀏覽器的本機資料持久化狀態。";
        }
        return { store, persistence: "retained", ...(notice ? { notice } : {}) };
    }
    catch (error) {
        return { store: new MemorySnapshotStore(), persistence: "session", notice: `${unavailableReason(error)}；改用目前分頁記憶體。` };
    }
}
/** No new consent: clear confirmed data and drafts, but never silently discard existing unsynced changes. */
async function clearRetained(scope) {
    if (typeof indexedDB === "undefined")
        return {};
    try {
        const databases = typeof indexedDB.databases === "function" ? await indexedDB.databases() : null;
        if (databases && !databases.some(database => database.name === "ledgernook-local"))
            return {};
        const retained = new IndexedDbSnapshotStore(scope, { schemaVersion: LOCAL_SCHEMA_VERSION, calculationVersion: LOCAL_CALCULATION_VERSION });
        const outbox = await retained.getDraft(OUTBOX_DRAFT_KEY);
        await retained.rejectCredential();
        return { ...(outbox === undefined ? {} : { outbox }) };
    }
    catch {
        return { notice: "無法清除先前保留的本機帳本資料；請在瀏覽器網站資料設定中清除此來源資料。" };
    }
}
/** Browser composition adapter: IndexedDB (only with consent), local query and incremental sync. */
export async function createPrivateMonthly(connection, retainLedger, buildId = "development", remembered, bankName = () => "", now = () => new Date().toISOString(), inboxReader = unrecordedReader) {
    const { account, repository, branch } = connection;
    const scope = namespaceFor(connection);
    const cleared = retainLedger ? undefined : await clearRetained(scope);
    const retained = retainLedger
        ? await retainedStore(scope) : { store: new MemorySnapshotStore(), persistence: "session", ...(cleared?.notice ? { notice: cleared.notice } : {}) };
    if (cleared?.outbox !== undefined)
        await retained.store.putDraft(OUTBOX_DRAFT_KEY, cleared.outbox);
    const store = new SwitchableLedgerStore(retained.store);
    let persistence = retained.persistence;
    let deviceStorage;
    try {
        deviceStorage = window.localStorage;
    }
    catch { /* Session-only storage. */ }
    const ledgerConsent = createLedgerRetentionConsent(deviceStorage, location.origin);
    const publications = observeSnapshotPublications(store);
    const localTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const capability = new ConnectionCapability({ writeDenied: connection.writeDenied === true, ledgerRetained: persistence === "retained" });
    let credential = connection.token;
    let retainedConnection = connection.writeDenied !== undefined;
    let credentialRejected = false;
    let released = false;
    const clearedListeners = new Set();
    let clearingReported = false;
    const pushControllers = new Set();
    const stopPushes = () => { for (const controller of pushControllers)
        controller.abort(); };
    const transport = async (url, init) => {
        const response = await fetch(url, init);
        capability.observeBroaderAccess(hasClassicRepoScope(response.headers));
        const rateLimited = response.status === 403 && (response.headers.get("x-ratelimit-remaining") === "0" || response.headers.has("retry-after"));
        if (response.status === 401 || init.method === "GET" && !rateLimited && (response.status === 403 ||
            response.status === 404 && new URL(url).pathname === `/repos/${encodeURIComponent(account)}/${encodeURIComponent(repository)}`)) {
            credentialRejected = true;
            clearConnection();
        }
        return response;
    };
    const adapterOptions = { owner: account, repo: repository, branch: branch, token: credential, fetch: transport };
    const reader = new IncrementalGitHubReader(adapterOptions);
    const mutation = new GitHubLedgerBatch({ ...adapterOptions, confirmed: publications.store });
    const outbox = new LedgerOutbox(new LocalOutboxStore(store), publications.store, inboxReader, publications.notify);
    const release = () => { released = true; stopPushes(); credential = ""; retainedConnection = false; preferences.dispose(); mutation.disconnect(); reader.disconnect(); capability.clear(); };
    const clearConnection = () => { const cleared = remembered?.clear() !== false; const consentCleared = ledgerConsent.clear(connection); retainedConnection = false; release(); return cleared && consentCleared; };
    const defaultConfirmation = count => typeof window !== "undefined" && typeof window.confirm === "function" && window.confirm(`還有 ${count} 筆變更待同步，繼續後會捨棄。GitHub 上的帳本不變。`);
    const allowDiscard = async (confirm = defaultConfirmation) => {
        let count = (await outbox.store.read()).length;
        while (count > 0) {
            if (!await confirm(count))
                return false;
            const current = (await outbox.store.read()).length;
            if (current <= count)
                return true;
            count = current;
        }
        return true;
    };
    const forget = async (confirmDiscard) => {
        if (!await allowDiscard(confirmDiscard))
            return false;
        let failed = !clearConnection();
        try {
            await store.forget();
        }
        catch {
            failed = true;
        }
        if (persistence === "session" && typeof indexedDB !== "undefined") {
            try {
                await new IndexedDbSnapshotStore(scope, {
                    schemaVersion: LOCAL_SCHEMA_VERSION, calculationVersion: LOCAL_CALCULATION_VERSION, localTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
                }).forget();
            }
            catch {
                failed = true;
            }
        }
        if (failed)
            throw new Error("local-forget-failed");
        return true;
    };
    const remember = () => {
        if (!credential)
            return false;
        retainedConnection = remembered?.save({ account: account, repository: repository, branch: branch, token: credential }, capability.writeDenied) ?? false;
        return retainedConnection;
    };
    const rejectConnection = async () => {
        let dataCleared = clearConnection();
        try {
            await store.rejectCredential();
        }
        catch {
            dataCleared = false;
        }
        if (!clearingReported) {
            clearingReported = true;
            for (const listener of clearedListeners)
                listener(dataCleared);
        }
    };
    const commands = new LedgerCommands({
        store: outbox.snapshotStore, outbox, capability: () => capability.state,
        rates: createFrankfurterRates({ fetch: (url, init) => fetch(url, init), now }),
    });
    const preferences = new LedgerPreferenceService({ store: publications.store, outbox,
        commands, capability: () => capability.state, localTimeZone, onChange: publications.notify, readPreferences: () => store.readPreferences() });
    const effectiveStore = { read: () => preferences.snapshot(), publish: publications.store.publish };
    const query = createLocalViewerQuery(effectiveStore, localTimeZone);
    const search = createLocalViewerSearch(effectiveStore, bankName, localTimeZone);
    const report = createLocalViewerReportQuery(effectiveStore, localTimeZone);
    const synchronizer = new LedgerSynchronizer(reader, publications.store, { now, throttleMs: 60_000 });
    const push = new LedgerPush({ synchronizer, local: publications.store, outbox, remote: mutation, now });
    return {
        label: `${account}/${repository} · ${branch}`,
        kind: "private", owner: account, repo: repository, branch: branch,
        get persistence() { return persistence; },
        ...(retained.notice ? { persistenceNotice: retained.notice } : {}),
        commands, preferences, outbox, report: request => report.query(request),
        async push(request) {
            if (credentialRejected)
                return { status: "credential-rejected" };
            if (released || capability.state.status === "read-only")
                return { status: "write-denied" };
            const controller = new AbortController();
            pushControllers.add(controller);
            const signal = request.signal ? AbortSignal.any([request.signal, controller.signal]) : controller.signal;
            let outcome;
            try {
                outcome = await push.push({ ...request, signal });
            }
            finally {
                pushControllers.delete(controller);
            }
            if (released && !credentialRejected)
                return { status: "temporary", reason: "offline" };
            capability.observePush(outcome);
            if (outcome.status === "write-denied" && retainedConnection)
                remember();
            if (credentialRejected || outcome.status === "credential-rejected") {
                await rejectConnection();
                return { status: "credential-rejected" };
            }
            return outcome;
        },
        organization: async (asOf) => queryViewerOrganization(await preferences.snapshot(), bankName, asOf),
        deviceRetention: {
            read: () => ({ credential: retainedConnection, ledger: persistence === "retained" }),
            async credential(value) {
                if (released)
                    return false;
                if (value)
                    return remember();
                if (remembered?.clear() === false)
                    return false;
                retainedConnection = false;
                return true;
            },
            async ledger(value, confirmDiscard) {
                if (released)
                    return false;
                if (value === (persistence === "retained"))
                    return true;
                if (!value && !await allowDiscard(confirmDiscard))
                    return false;
                if (released)
                    return false;
                if (value && !ledgerConsent.save(connection))
                    return false;
                if (!value) {
                    capability.setLedgerRetention(false);
                    stopPushes();
                }
                try {
                    const next = value ? await retainedStore(scope) : { store: new MemorySnapshotStore(), persistence: "session" };
                    if (value && next.persistence !== "retained") {
                        ledgerConsent.clear(connection);
                        return false;
                    }
                    await store.replace(next.store, !value);
                    persistence = next.persistence;
                    capability.setLedgerRetention(persistence === "retained");
                    if (!value && !ledgerConsent.clear(connection)) {
                        publications.notify();
                        return false;
                    }
                    publications.notify();
                    return true;
                }
                catch {
                    capability.setLedgerRetention(persistence === "retained");
                    if (value)
                        ledgerConsent.clear(connection);
                    return false;
                }
            },
        },
        get capability() { return capability.state; },
        get broaderAccess() { return capability.broaderAccess; },
        remember,
        recheckWriteCapability() { if (credential) {
            capability.recheck();
            if (retainedConnection)
                remember();
            publications.notify();
        } },
        query: (request) => query.query(request),
        search: request => search.search(request),
        listRecords: asOf => search.list(asOf),
        onPublication: listener => publications.subscribe(listener),
        onConnectionCleared(listener) { clearedListeners.add(listener); return () => { clearedListeners.delete(listener); }; },
        ...(retained.persistence === "retained" ? {
            restoreLastView: (request) => preferences.hasPending().then(pending => pending ? null : store.readLastView(request, buildId)),
            cacheLastView: (request, value) => preferences.hasPending().then(pending => pending ? undefined : store.writeLastView(request, buildId, value)),
        } : {}),
        async synchronize({ period, manual, signal }) {
            if (released || !period)
                return [];
            if (released)
                return [];
            const outcomes = [];
            for (const month of utcPartitions(period.start, period.end)) {
                const outcome = await synchronizer.sync({ requestedMonth: month, manual, ...(signal ? { signal } : {}) });
                if (credentialRejected || outcome.status === "forbidden" || credential && outcome.status === "unauthorized") {
                    await rejectConnection();
                    return [credentialRejected ? { status: "unauthorized", commit: null, complete: false } : outcome];
                }
                if (released)
                    return [];
                outcomes.push(outcome);
                if (["unauthorized", "forbidden", "offline", "storage-failed"].includes(outcome.status))
                    break;
            }
            return outcomes;
        },
        drafts: {
            put: (id, value) => store.putDraft(id, value),
            get: id => store.getDraft(id),
            delete: id => store.deleteDraft(id),
        },
        forget,
        disconnect: forget,
        release,
    };
}
