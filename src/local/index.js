import { assembleEffectiveLedger, defaultUserRulesDocument, validateLedgerObjectAtPath } from "../core/index.js";
import { afterConfirmedWrite, LocalSnapshotError } from "../application/sync.js";
import { OUTBOX_DRAFT_KEY } from "../application/outbox.js";
import { viewerResultCacheKey } from "../application/viewer-query.js";
export * from "./outbox.js";
export { MemorySnapshotStore } from "./memory.js";
export const LOCAL_SCHEMA_VERSION = "1";
export const LOCAL_CALCULATION_VERSION = "2";
const DB_VERSION = 2;
const SOURCE_KEY = /^events\/v1\/\d{4}\/(?:0[1-9]|1[0-2])\/([0-9a-f-]+)\.json$/;
const DETAIL_KEY = /^details\/v1\/\d{4}\/(?:0[1-9]|1[0-2])\/([0-9a-f-]+)\.json$/;
const EMPTY = Object.freeze({ cursor: null, coverage: { complete: false, missing: ["initial"] }, objects: [] });
export function namespaceKey(scope) {
    if (!scope.origin || !scope.connectionId || !scope.repositoryId || !scope.branch)
        throw new TypeError("Incomplete namespace");
    return JSON.stringify([scope.origin, scope.connectionId, scope.repositoryId, scope.branch]);
}
function failure(cause) {
    const name = cause && typeof cause === "object" && "name" in cause ? String(cause.name) : "";
    return new LocalSnapshotError(name === "QuotaExceededError" ? "quota" :
        name === "SecurityError" || name === "InvalidStateError" || name === "NotAllowedError" ? "denied" : "unknown");
}
function result(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(failure(request.error));
    });
}
function completed(tx) {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(failure(tx.error));
        tx.onerror = () => reject(failure(tx.error));
    });
}
function newRevision() {
    return [...crypto.getRandomValues(new Uint8Array(16))].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
function byPath(left, right) { return left.path < right.path ? -1 : left.path > right.path ? 1 : 0; }
function indexRows(objects) {
    const sources = [], details = [], projects = [];
    const aiRules = new Map();
    let rules = defaultUserRulesDocument();
    for (const object of objects) {
        switch (object.kind) {
            case "source":
                sources.push(object.value);
                break;
            case "detail":
                details.push({ partition: object.partition, value: object.value });
                break;
            case "project":
                projects.push(object.value);
                break;
            case "user-rules":
                rules = object.value;
                break;
            case "ai-rule":
                aiRules.set(object.value.merchant, object.value);
                break;
        }
    }
    const preferences = objects.find(object => object.kind === "preferences");
    const records = assembleEffectiveLedger({ sources, details, projects, userRules: rules, aiRules,
        ...(preferences?.kind === "preferences" ? { preferences: preferences.value } : {}) }).records;
    const byId = new Map(records.map(record => [record.id, record]));
    const rows = new Map();
    for (const object of objects) {
        const id = SOURCE_KEY.exec(object.path)?.[1] ?? DETAIL_KEY.exec(object.path)?.[1];
        if (!id)
            continue;
        const record = byId.get(id);
        if (!record)
            continue;
        rows.set(object.path, {
            effectiveDate: record.occurrence.precision === "date" ? record.occurrence.on : record.occurrence.at.slice(0, 10),
            ...(record.projectId === null ? {} : { project: record.projectId }),
            ...(record.categoryId === null ? {} : { category: record.categoryId }),
            subscription: record.subscription === null ? 0 : 1,
        });
    }
    return rows;
}
/** One database, isolated namespace keys. Drafts are deliberately outside disposable snapshots. */
export class IndexedDbSnapshotStore {
    namespace;
    factory;
    databaseName;
    schemaVersion;
    calculationVersion;
    localTimeZone;
    database;
    /** Last validated state with its publication revision; reused only while the stored revision is unchanged. */
    cached;
    constructor(scope, options = {}) {
        this.namespace = namespaceKey(scope);
        this.localTimeZone = options.localTimeZone ?? "UTC";
        if (!options.factory && typeof indexedDB === "undefined")
            throw new LocalSnapshotError("denied");
        this.factory = options.factory ?? indexedDB;
        this.databaseName = options.databaseName ?? "ledgernook-local";
        this.schemaVersion = options.schemaVersion ?? "1";
        this.calculationVersion = options.calculationVersion ?? LOCAL_CALCULATION_VERSION;
    }
    open() {
        if (!this.database)
            this.database = new Promise((resolve, reject) => {
                let request;
                try {
                    request = this.factory.open(this.databaseName, DB_VERSION);
                }
                catch (error) {
                    reject(failure(error));
                    return;
                }
                request.onupgradeneeded = () => {
                    const db = request.result;
                    const objects = db.objectStoreNames.contains("objects") ? request.transaction.objectStore("objects") : db.createObjectStore("objects", { keyPath: "key" });
                    if (!objects.indexNames.contains("namespace"))
                        objects.createIndex("namespace", "namespace");
                    for (const field of ["effectiveDate", "project", "category", "subscription"]) {
                        if (!objects.indexNames.contains(field))
                            objects.createIndex(field, ["namespace", field]);
                    }
                    if (!db.objectStoreNames.contains("snapshots"))
                        db.createObjectStore("snapshots", { keyPath: "namespace" });
                    if (!db.objectStoreNames.contains("views"))
                        db.createObjectStore("views", { keyPath: "namespace" });
                    const drafts = db.objectStoreNames.contains("drafts") ? request.transaction.objectStore("drafts") : db.createObjectStore("drafts", { keyPath: "key" });
                    if (!drafts.indexNames.contains("namespace"))
                        drafts.createIndex("namespace", "namespace");
                };
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(failure(request.error));
                request.onblocked = () => reject(new LocalSnapshotError("denied"));
            });
        return this.database;
    }
    /** Opens/upgrades the store without materializing or validating its full object set. */
    async ready() { await this.open(); }
    async read() { return (await this.readState()).snapshot; }
    /** Preference first paint needs one validated document, not every historical object. */
    async readPreferences() {
        try {
            const db = await this.open();
            const tx = db.transaction(["objects", "snapshots"], "readonly");
            const done = completed(tx);
            const [meta, row] = await Promise.all([
                result(tx.objectStore("snapshots").get(this.namespace)),
                result(tx.objectStore("objects").get(`${this.namespace}\u0000preferences.json`)),
            ]);
            await done;
            if (!meta || meta.schemaVersion !== this.schemaVersion || meta.calculationVersion !== this.calculationVersion)
                return EMPTY;
            const objects = [];
            if (row) {
                const object = validateLedgerObjectAtPath(row.path, row.object.value);
                if (object.kind !== "preferences" || row.object.kind !== object.kind || !/^[0-9a-f]{40}$/.test(row.object.objectId))
                    throw new LocalSnapshotError("invalid-data");
                objects.push(Object.freeze({ ...object, objectId: row.object.objectId }));
            }
            return Object.freeze({ cursor: meta.cursor, coverage: meta.coverage, objects: Object.freeze(objects), ...(meta.revision ? { revision: meta.revision } : {}) });
        }
        catch (error) {
            throw error instanceof LocalSnapshotError ? error : failure(error);
        }
    }
    async readState() {
        try {
            const db = await this.open();
            const cached = this.cached;
            if (cached) {
                // Meta-only read: an unchanged revision means no publication or erase happened (in any tab) since validation.
                const tx = db.transaction("snapshots", "readonly");
                const done = completed(tx);
                const meta = await result(tx.objectStore("snapshots").get(this.namespace));
                await done;
                if (this.cached === cached && meta?.revision === cached.revision && meta.schemaVersion === this.schemaVersion &&
                    meta.calculationVersion === this.calculationVersion)
                    return cached.state;
                if (this.cached === cached)
                    this.cached = undefined;
            }
            const tx = db.transaction(["objects", "snapshots"], "readonly");
            const done = completed(tx);
            const metaPromise = result(tx.objectStore("snapshots").get(this.namespace));
            const rowsPromise = result(tx.objectStore("objects").index("namespace").getAll(this.namespace));
            const [meta, rows] = await Promise.all([metaPromise, rowsPromise]);
            await done;
            if (meta && (meta.schemaVersion !== this.schemaVersion || meta.calculationVersion !== this.calculationVersion)) {
                await this.clearNamespace();
                return { snapshot: EMPTY, trees: [], covered: [], knownMonths: [] };
            }
            const objects = rows.map(row => {
                try {
                    const value = validateLedgerObjectAtPath(row.path, row.object.value);
                    if (value.kind !== row.object.kind || !/^[0-9a-f]{40}$/.test(row.object.objectId))
                        throw Error();
                    return Object.freeze({ ...value, objectId: row.object.objectId });
                }
                catch {
                    throw new LocalSnapshotError("invalid-data");
                }
            });
            const state = {
                snapshot: Object.freeze({ cursor: meta?.cursor ?? null, coverage: meta?.coverage ?? EMPTY.coverage,
                    objects: Object.freeze(objects), ...(meta?.revision ? { revision: meta.revision } : {}) }),
                trees: meta?.trees ?? [], covered: meta?.covered ?? [], knownMonths: meta?.knownMonths ?? [],
            };
            if (meta?.revision)
                this.cached = { revision: meta.revision, state };
            return state;
        }
        catch (error) {
            throw error instanceof LocalSnapshotError ? error : failure(error);
        }
    }
    async publish(publication) {
        const state = await this.readState();
        if ((state.snapshot.cursor?.commit ?? null) !== publication.expectedCommit)
            return "stale-cursor";
        const parentCommit = publication.parentCommit === undefined ? publication.expectedCommit : publication.parentCommit;
        if (parentCommit !== publication.expectedCommit) {
            await this.markMutationRefresh(publication.expectedCommit);
            return "stale-cursor";
        }
        return this.publishSync({ ...publication, ...afterConfirmedWrite(state, publication),
            coverage: state.snapshot.coverage.complete ? state.snapshot.coverage : { complete: false, missing: ["mutation-refresh"] } });
    }
    async markMutationRefresh(expectedCommit) {
        const db = await this.open();
        const tx = db.transaction(["snapshots", "views"], "readwrite");
        const done = completed(tx);
        const snapshots = tx.objectStore("snapshots");
        const existing = await result(snapshots.get(this.namespace));
        if ((existing?.cursor?.commit ?? null) !== expectedCommit || !existing) {
            tx.abort();
            try {
                await done;
            }
            catch { /* Stale publication leaves the newer snapshot untouched. */ }
            return;
        }
        const revision = newRevision();
        snapshots.put({ ...existing, coverage: { complete: false, missing: ["mutation-refresh"] }, revision });
        tx.objectStore("views").delete(this.namespace);
        this.cached = undefined;
        await done;
    }
    async publishSync(publication) {
        const state = await this.readState();
        if ((state.snapshot.cursor?.commit ?? null) !== publication.expectedCommit)
            return "stale-cursor";
        const objects = new Map(state.snapshot.objects.map(item => [item.path, item]));
        for (const path of publication.deletions)
            objects.delete(path);
        for (const object of publication.upserts) {
            const validated = validateLedgerObjectAtPath(object.path, object.value);
            if (validated.kind !== object.kind || !/^[0-9a-f]{40}$/.test(object.objectId))
                throw new LocalSnapshotError("invalid-data");
            objects.set(object.path, Object.freeze({ ...validated, objectId: object.objectId }));
        }
        const changedPaths = [...publication.deletions, ...publication.upserts.map(item => item.path)];
        const indexes = changedPaths.length ? indexRows([...objects.values()]) : null;
        const reindexAll = changedPaths.some(path => path === "preferences.json" || path.startsWith("rules/") || path.startsWith("projects/"));
        const affectedIds = new Set(changedPaths.map(path => SOURCE_KEY.exec(path)?.[1] ?? DETAIL_KEY.exec(path)?.[1])
            .filter((value) => value !== undefined));
        if (!reindexAll && affectedIds.size > 0) {
            for (const object of objects.values())
                if (object.kind === "detail" && object.value.refundOf &&
                    affectedIds.has(object.value.refundOf))
                    affectedIds.add(object.value.eventId);
        }
        try {
            const db = await this.open();
            const tx = db.transaction(["objects", "snapshots", "views"], "readwrite");
            const done = completed(tx);
            const snapshots = tx.objectStore("snapshots");
            const existing = await result(snapshots.get(this.namespace));
            if ((existing?.cursor?.commit ?? null) !== publication.expectedCommit) {
                tx.abort();
                try {
                    await done;
                }
                catch { }
                return "stale-cursor";
            }
            const store = tx.objectStore("objects");
            for (const path of publication.deletions)
                store.delete(`${this.namespace}\u0000${path}`);
            // Rebuilding affected indexes is done in this same transaction as data and cursor.
            const writePaths = reindexAll ? [...objects.keys()] : [...new Set([
                    ...publication.upserts.map(item => item.path),
                    ...[...objects.keys()].filter(path => {
                        const id = SOURCE_KEY.exec(path)?.[1] ?? DETAIL_KEY.exec(path)?.[1];
                        return id !== undefined && affectedIds.has(id);
                    }),
                ])];
            for (const path of writePaths) {
                const object = objects.get(path);
                store.put({ key: `${this.namespace}\u0000${path}`, namespace: this.namespace, path, object,
                    ...(indexes?.get(path) ?? {}) });
            }
            const revision = newRevision();
            snapshots.put({ namespace: this.namespace, schemaVersion: this.schemaVersion,
                calculationVersion: this.calculationVersion, cursor: publication.cursor, coverage: publication.coverage,
                reportingTimeZone: objects.get("preferences.json")?.kind === "preferences" ?
                    objects.get("preferences.json").value.reportingTimeZone : null,
                trees: publication.trees, covered: publication.covered, knownMonths: publication.knownMonths, revision });
            tx.objectStore("views").delete(this.namespace);
            this.cached = undefined;
            await done;
            // Same contents and path order a fresh read of the committed rows returns.
            this.cached = { revision, state: {
                    snapshot: Object.freeze({ cursor: publication.cursor, coverage: publication.coverage,
                        objects: Object.freeze([...objects.values()].sort(byPath)), revision }),
                    trees: publication.trees, covered: publication.covered, knownMonths: publication.knownMonths,
                } };
            return "published";
        }
        catch (error) {
            throw error instanceof LocalSnapshotError ? error : failure(error);
        }
    }
    async readLastView(request, buildId) {
        if (!buildId)
            return null;
        try {
            const db = await this.open();
            const tx = db.transaction(["snapshots", "views"], "readonly");
            const done = completed(tx);
            const metaPromise = result(tx.objectStore("snapshots").get(this.namespace));
            const rowPromise = result(tx.objectStore("views").get(this.namespace));
            const [meta, row] = await Promise.all([metaPromise, rowPromise]);
            await done;
            const timeZone = meta?.reportingTimeZone ?? this.localTimeZone;
            if (!meta?.revision || !row || row.revision !== meta.revision || meta.schemaVersion !== this.schemaVersion ||
                meta.calculationVersion !== this.calculationVersion ||
                row.cacheKey !== viewerResultCacheKey(request, buildId, meta.revision, this.schemaVersion, this.calculationVersion, timeZone) ||
                !validCachedView(row.result, request, meta.revision, timeZone))
                return null;
            return row.result;
        }
        catch (error) {
            throw error instanceof LocalSnapshotError ? error : failure(error);
        }
    }
    async writeLastView(request, buildId, value) {
        const revision = value.publicationRevision;
        if (!buildId || !revision)
            return;
        try {
            const db = await this.open();
            const tx = db.transaction(["snapshots", "views"], "readwrite");
            const done = completed(tx);
            const meta = await result(tx.objectStore("snapshots").get(this.namespace));
            const timeZone = meta?.reportingTimeZone ?? this.localTimeZone;
            if (meta?.revision === revision && meta.schemaVersion === this.schemaVersion && meta.calculationVersion === this.calculationVersion &&
                validCachedView(value, request, revision, timeZone)) {
                tx.objectStore("views").put({ namespace: this.namespace, revision,
                    cacheKey: viewerResultCacheKey(request, buildId, revision, this.schemaVersion, this.calculationVersion, timeZone), result: value });
            }
            await done;
        }
        catch (error) {
            throw error instanceof LocalSnapshotError ? error : failure(error);
        }
    }
    async clearNamespace() { await this.erase(false); }
    async forget() { await this.erase(true); }
    /** One namespace transaction clears private data and drafts except the non-disposable outbox. */
    async rejectCredential() { await this.erase(true, true); }
    async erase(drafts, preserveOutbox = false) {
        this.cached = undefined;
        try {
            const db = await this.open();
            const names = drafts ? ["objects", "snapshots", "drafts", "views"] : ["objects", "snapshots", "views"];
            const tx = db.transaction(names, "readwrite");
            const done = completed(tx);
            tx.objectStore("snapshots").delete(this.namespace);
            tx.objectStore("views").delete(this.namespace);
            for (const name of drafts ? ["objects", "drafts"] : ["objects"]) {
                const index = tx.objectStore(name).index("namespace");
                index.openKeyCursor(IDBKeyRange.only(this.namespace)).onsuccess = event => {
                    const cursor = event.target.result;
                    if (cursor) {
                        if (!(preserveOutbox && name === "drafts" && cursor.primaryKey === `${this.namespace}\u0000${OUTBOX_DRAFT_KEY}`))
                            tx.objectStore(name).delete(cursor.primaryKey);
                        cursor.continue();
                    }
                };
            }
            await done;
        }
        catch (error) {
            throw error instanceof LocalSnapshotError ? error : failure(error);
        }
    }
    async putDraft(id, value) {
        if (!id)
            throw new TypeError("Missing draft id");
        const db = await this.open();
        const tx = db.transaction("drafts", "readwrite");
        const done = completed(tx);
        tx.objectStore("drafts").put({ key: `${this.namespace}\u0000${id}`, namespace: this.namespace, value });
        await done;
    }
    async getDraft(id) {
        const db = await this.open();
        const tx = db.transaction("drafts", "readonly");
        const done = completed(tx);
        const row = await result(tx.objectStore("drafts").get(`${this.namespace}\u0000${id}`));
        await done;
        return row?.value;
    }
    async updateDraft(id, change) {
        if (!id)
            throw new TypeError("Missing draft id");
        const db = await this.open();
        const tx = db.transaction("drafts", "readwrite");
        const done = completed(tx);
        try {
            const store = tx.objectStore("drafts"), key = `${this.namespace}\u0000${id}`;
            const row = await result(store.get(key));
            store.put({ key, namespace: this.namespace, value: change(row?.value) });
            await done;
        }
        catch (error) {
            try {
                tx.abort();
            }
            catch { }
            await done.catch(() => { });
            throw error;
        }
    }
    async deleteDraft(id) {
        if (!id)
            throw new TypeError("Missing draft id");
        const db = await this.open();
        const tx = db.transaction("drafts", "readwrite");
        const done = completed(tx);
        tx.objectStore("drafts").delete(`${this.namespace}\u0000${id}`);
        await done;
    }
}
function validCachedView(value, request, revision, timeZone) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return false;
    const result = value;
    return !result.localChanges && result.publicationRevision === revision && result.asOf === request.asOf && result.timeZone === timeZone &&
        !!result.report && Array.isArray(result.report.records) && result.report.period?.timeZone === timeZone &&
        result.report.scope === (request.scope ?? "all") && !!result.billingCycleSpending && !!result.pinnedCategoryTotals &&
        result.report.total !== undefined && Array.isArray(result.categories) && Array.isArray(result.projects) &&
        Array.isArray(result.projectCosts) && !!result.installmentBalances && Array.isArray(result.unrecorded);
}
