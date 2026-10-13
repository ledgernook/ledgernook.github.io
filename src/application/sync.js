import { defaultUserRulesDocument, isCanonicalUtcInstant, validateLedgerObjectAtPath, validateLedgerPreferences, unrecordedCaptureSeed, unrecordedIdFromHash } from "../core/index.js";
import { RemoteReadError } from "./ports.js";
/** Coverage marker of a retained snapshot whose cursor cannot be related to the remote head; never complete. */
export const SCOPE_REBUILD = "scope-rebuild";
const MONTH = /^\d{4}\/(?:0[1-9]|1[0-2])$/;
const PARTITIONS = ["events", "details", "unrecorded"];
const GLOBAL = ["", "rules", "rules/ai", "projects"];
const BATCH = 32;
const MAX_PUBLICATIONS_PER_SYNC = 12;
function cancelled(signal) {
    if (signal?.aborted)
        throw new RemoteReadError("cancelled");
}
function children(listing, type) {
    if (!listing.complete || new Set(listing.entries.map(entry => entry.name)).size !== listing.entries.length) {
        throw new RemoteReadError("incomplete");
    }
    return listing.entries.filter(entry => entry.type === type).map(entry => entry.name);
}
function under(path, directory) { return directory === "" || path.startsWith(`${directory}/`); }
function codeFor(error) {
    if (error instanceof RemoteReadError) {
        switch (error.code) {
            case "unauthorized": return "unauthorized";
            case "forbidden": return "forbidden";
            case "rate-limited": return "rate-limited";
            case "cancelled": return "cancelled";
            case "incomplete":
            case "not-found": return "partial";
            default: return "offline";
        }
    }
    if (error instanceof LocalSnapshotError)
        return "storage-failed";
    return "partial";
}
function failed(error, commit) {
    return { status: codeFor(error), commit, complete: false };
}
/**
 * Sync metadata after a confirmed write whose parent is the snapshot cursor: coverage of untouched
 * directories carries forward, and each written directory loses its tree identity, so the next changed
 * head re-lists it (even if its tree returns to the pre-write identity) instead of trusting stale metadata.
 */
export function afterConfirmedWrite(state, publication) {
    const written = new Set([...publication.deletions, ...publication.upserts.map(item => item.path)]
        .map(path => path.slice(0, Math.max(0, path.lastIndexOf("/")))));
    return { trees: state.trees.filter(item => ![...written].some(path => item.path === "" || item.path === path || path.startsWith(`${item.path}/`))),
        covered: state.covered, knownMonths: state.knownMonths };
}
/** Typed local failure, with no private database detail in its message. */
export class LocalSnapshotError extends Error {
    code;
    constructor(code) {
        super(`Local snapshot: ${code}`);
        this.code = code;
        this.name = "LocalSnapshotError";
    }
}
/**
 * Serial foreground/manual sync. Complete listings at one pinned commit are the sole deletion
 * evidence. On a changed head all previously covered directories are reconciled before cursor
 * publication, so an interrupted attempt leaves the old consistent snapshot in place.
 */
export class LedgerSynchronizer {
    remote;
    local;
    options;
    running = Promise.resolve();
    lastCheck = -Infinity;
    constructor(remote, local, options) {
        this.remote = remote;
        this.local = local;
        this.options = options;
    }
    sync(request) {
        const result = this.running.then(() => this.perform(request));
        this.running = result.then(() => undefined, () => undefined);
        return result;
    }
    async perform(request) {
        if (!MONTH.test(request.requestedMonth))
            throw new RangeError("Invalid requested month");
        const monthsPerBatch = this.options.historyMonthsPerCall ?? 1;
        if (!Number.isSafeInteger(monthsPerBatch) || monthsPerBatch < 1)
            throw new RangeError("Invalid history batch size");
        const historyBudget = request.historyBudget ?? monthsPerBatch * MAX_PUBLICATIONS_PER_SYNC;
        if (!Number.isSafeInteger(historyBudget) || historyBudget < 0)
            throw new RangeError("Invalid history budget");
        const now = this.options.now();
        const timestamp = Date.parse(now);
        if (!isCanonicalUtcInstant(now) || !Number.isFinite(timestamp))
            throw new RangeError("Invalid clock");
        let state;
        try {
            state = await this.local.readState();
        }
        catch (error) {
            return failed(error, null);
        }
        const previous = state.snapshot.cursor?.commit ?? null;
        let publishedCommit = previous;
        const oldComplete = state.snapshot.coverage.complete;
        const requestedCovered = PARTITIONS.every(kind => state.covered.includes(`${kind}/v1/${request.requestedMonth}`));
        if (!request.manual && requestedCovered && timestamp >= this.lastCheck &&
            timestamp - this.lastCheck < (this.options.throttleMs ?? 60_000)) {
            return { status: "throttled", commit: previous, complete: oldComplete, remainingMonths: state.knownMonths.length -
                    state.knownMonths.filter(month => PARTITIONS.every(kind => state.covered.includes(`${kind}/v1/${month}`))).length };
        }
        let head = previous;
        try {
            cancelled(request.signal);
            head = (await this.remote.readHead(request.signal)).commit;
            cancelled(request.signal);
            const pinnedCommit = head;
            this.lastCheck = timestamp;
            if (head === previous && (oldComplete && state.knownMonths.includes(request.requestedMonth) ||
                historyBudget === 0 && requestedCovered && GLOBAL.every(path => state.covered.includes(path)))) {
                return { status: "unchanged", commit: head, complete: oldComplete, remainingMonths: state.knownMonths.filter(month => PARTITIONS.some(kind => !state.covered.includes(`${kind}/v1/${month}`))).length };
            }
            let rebuild = false;
            if (previous !== null && head !== previous && this.remote.relateBase !== undefined) {
                rebuild = await this.remote.relateBase(previous, head, request.signal) !== "ancestor";
            }
            const replaced = rebuild ? state.snapshot.objects.map(item => item.path) : [];
            if (rebuild) {
                // Unrelatable (rewritten, reset or recreated) history: the old snapshot stays readable, marked as
                // rebuilding and never complete, until the first rebuilt publication replaces it atomically.
                const marked = await this.local.publishSync({ expectedCommit: previous, cursor: state.snapshot.cursor, upserts: [],
                    deletions: [], coverage: { complete: false, missing: [SCOPE_REBUILD] }, trees: [], covered: [], knownMonths: [] });
                if (marked === "stale-cursor")
                    throw new LocalSnapshotError("unknown");
                state = { snapshot: { ...state.snapshot, objects: [] }, trees: [], covered: [], knownMonths: [] };
            }
            const trees = new Map(state.trees.map(item => [item.path, item.treeId]));
            let months;
            if (head === previous && state.knownMonths.length > 0)
                months = [...state.knownMonths];
            else
                months = await this.discover(head, trees, request.signal, historyBudget === 0);
            if (!months.includes(request.requestedMonth))
                months.push(request.requestedMonth);
            months.sort().reverse();
            const oldCovered = new Set(state.covered);
            const pending = months.filter(month => month !== request.requestedMonth &&
                PARTITIONS.some(kind => !oldCovered.has(`${kind}/v1/${month}`)));
            const covered = new Set(head === previous ? state.covered : []);
            const objects = new Map(state.snapshot.objects.map(item => [item.path, item]));
            let nextMonth = 0;
            let missing = [];
            for (let publicationIndex = 0; publicationIndex < MAX_PUBLICATIONS_PER_SYNC; publicationIndex++) {
                cancelled(request.signal);
                const selected = new Set();
                if (publicationIndex === 0) {
                    for (const kind of PARTITIONS)
                        selected.add(`${kind}/v1/${request.requestedMonth}`);
                    for (const path of GLOBAL)
                        selected.add(path);
                    for (const path of oldCovered)
                        selected.add(path);
                }
                const endMonth = Math.min(nextMonth + monthsPerBatch, historyBudget);
                for (const month of pending.slice(nextMonth, endMonth)) {
                    for (const kind of PARTITIONS)
                        selected.add(`${kind}/v1/${month}`);
                }
                nextMonth = endMonth;
                const { upserts, deletions } = await this.reconcile(pinnedCommit, [...selected], previous, oldCovered, trees, covered, objects, request.signal);
                cancelled(request.signal);
                missing = months.flatMap(month => PARTITIONS.map(kind => `${kind}/v1/${month}`))
                    .concat(GLOBAL).filter(path => !covered.has(path)).map(path => path === "" ? "preferences.json" : path);
                const preference = objects.get("preferences.json");
                if (preference?.kind === "preferences") {
                    const rules = objects.get("rules/user.json");
                    const projects = [...objects.values()].flatMap(item => item.kind === "project" ? [item.value] : []);
                    // An external project removal must not strand synchronization. Preserve the stored
                    // preference; entry defaults already ignore a trip whose project no longer exists.
                    const value = preference.value.currentTrip && !projects.some(project => project.id === preference.value.currentTrip.projectId)
                        ? { ...preference.value, currentTrip: null } : preference.value;
                    validateLedgerPreferences(value, { categories: rules?.kind === "user-rules" ? rules.value.categories : defaultUserRulesDocument().categories, projects });
                }
                const publication = {
                    expectedCommit: publishedCommit, cursor: { commit: head, synchronizedAt: now }, upserts,
                    deletions: publicationIndex === 0 ? [...replaced, ...deletions] : deletions,
                    coverage: { complete: missing.length === 0, missing, preferencesLoaded: covered.has("") }, trees: [...trees].map(([path, treeId]) => ({ path, treeId })),
                    covered: [...covered], knownMonths: months,
                };
                if (await this.local.publishSync(publication) === "stale-cursor") {
                    const fresh = await this.local.readState();
                    const cursor = fresh.snapshot.cursor?.commit ?? null;
                    if (cursor !== publishedCommit) {
                        // This connection's push may advance the local cursor while a history round is reading the old head.
                        return { status: "synced", commit: cursor, complete: fresh.snapshot.coverage.complete,
                            remainingMonths: fresh.knownMonths.filter(month => PARTITIONS.some(kind => !fresh.covered.includes(`${kind}/v1/${month}`))).length };
                    }
                    throw new LocalSnapshotError("unknown");
                }
                publishedCommit = head;
                if (missing.length === 0 || nextMonth >= pending.length || nextMonth >= historyBudget)
                    break;
            }
            const remainingMonths = months.filter(month => PARTITIONS.some(kind => !covered.has(`${kind}/v1/${month}`))).length;
            return { status: "synced", commit: head, complete: missing.length === 0, remainingMonths, ...(rebuild ? { rebuilt: true } : {}) };
        }
        catch (error) {
            return failed(error, publishedCommit);
        }
    }
    async reconcile(commit, paths, previous, oldCovered, trees, covered, objects, signal) {
        const upserts = [];
        const deletions = [];
        for (let index = 0; index < paths.length; index += BATCH) {
            cancelled(signal);
            const batch = paths.slice(index, index + BATCH);
            const candidates = batch.filter(path => !(commit === previous && oldCovered.has(path) && trees.has(path)));
            for (const path of batch)
                if (!candidates.includes(path))
                    covered.add(path);
            const prior = candidates.filter(path => oldCovered.has(path) && trees.has(path));
            const identities = new Map();
            if (this.remote.readTreeIds && prior.length > 0) {
                const ids = await this.remote.readTreeIds(commit, prior, signal);
                if (ids.length !== prior.length)
                    throw new RemoteReadError("incomplete");
                for (let item = 0; item < prior.length; item++)
                    identities.set(prior[item], ids[item]);
            }
            const listingPaths = candidates.filter(path => {
                if (identities.has(path) && identities.get(path) === trees.get(path)) {
                    covered.add(path);
                    return false;
                }
                return true;
            });
            const listings = listingPaths.length === 0 ? [] : this.remote.listTrees
                ? await this.remote.listTrees(commit, listingPaths, signal)
                : await Promise.all(listingPaths.map(path => this.remote.listTree(commit, path, signal)));
            if (listings.length !== listingPaths.length)
                throw new RemoteReadError("incomplete");
            for (let item = 0; item < listingPaths.length; item++) {
                cancelled(signal);
                const path = listingPaths[item];
                const listing = listings[item];
                if (!listing || listing.path !== path || !listing.complete ||
                    (identities.has(path) && identities.get(path) !== listing.treeId))
                    throw new RemoteReadError("incomplete");
                children(listing, "blob");
                const unchanged = oldCovered.has(path) && trees.get(path) === listing.treeId;
                trees.set(path, listing.treeId);
                if (!unchanged) {
                    const entries = listing.entries.filter(entry => entry.type === "blob" && relevant(path, entry.name));
                    const expected = new Set(entries.map(entry => path === "" ? entry.name : `${path}/${entry.name}`));
                    for (const priorPath of objects.keys())
                        if (under(priorPath, path) && directChild(priorPath, path) &&
                            relevant(path, priorPath.slice(path === "" ? 0 : path.length + 1)) && !expected.has(priorPath)) {
                            deletions.push(priorPath);
                            objects.delete(priorPath);
                        }
                    const needed = entries.map(entry => ({ path: path === "" ? entry.name : `${path}/${entry.name}`, objectId: entry.objectId }))
                        .filter(entry => objects.get(entry.path)?.objectId !== entry.objectId);
                    for (let offset = 0; offset < needed.length; offset += BATCH) {
                        cancelled(signal);
                        const requests = needed.slice(offset, offset + BATCH);
                        const response = await this.remote.readObjects(commit, requests, signal);
                        cancelled(signal);
                        if (response.length !== requests.length)
                            throw new RemoteReadError("incomplete");
                        const byPath = new Map(response.map(entry => [entry.path, entry]));
                        for (const entry of requests) {
                            const found = byPath.get(entry.path);
                            if (!found || found.status !== "found" || found.objectId !== entry.objectId)
                                throw new RemoteReadError("incomplete");
                            const value = validateLedgerObjectAtPath(entry.path, found.body);
                            if (value.kind === "ai-rule" && await sha256(value.value.merchant) !== value.merchantHash) {
                                throw new RemoteReadError("incomplete");
                            }
                            if (value.kind === "unrecorded" && unrecordedIdFromHash(await sha256(unrecordedCaptureSeed(value.value))) !== value.value.id) {
                                throw new RemoteReadError("incomplete");
                            }
                            const object = Object.freeze({ ...value, objectId: entry.objectId });
                            objects.set(entry.path, object);
                            upserts.push(object);
                        }
                    }
                }
                covered.add(path);
            }
        }
        return { upserts, deletions };
    }
    async discover(commit, trees, signal, batched = false) {
        // Push discovers partition names without reading history month entries/bodies. Batch the small
        // directory skeleton so its request count does not grow per year on the GraphQL path.
        if (batched && this.remote.listTrees) {
            const list = async (paths) => {
                const result = [];
                for (let index = 0; index < paths.length; index += BATCH) {
                    const batch = paths.slice(index, index + BATCH), listings = await this.remote.listTrees(commit, batch, signal);
                    if (listings.length !== batch.length || listings.some((listing, item) => listing.path !== batch[item]))
                        throw new RemoteReadError("incomplete");
                    for (const listing of listings) {
                        children(listing, "tree");
                        trees.set(listing.path, listing.treeId);
                        result.push(listing);
                    }
                }
                return result;
            };
            const roots = await list(PARTITIONS.map(kind => `${kind}/v1`));
            const years = await list(roots.flatMap(root => children(root, "tree").filter(year => /^\d{4}$/.test(year)).map(year => `${root.path}/${year}`)));
            return [...new Set(years.flatMap(year => children(year, "tree").filter(month => /^(?:0[1-9]|1[0-2])$/.test(month))
                    .map(month => `${year.path.slice(-4)}/${month}`)))];
        }
        const months = new Set();
        for (const kind of PARTITIONS) {
            const root = await this.remote.listTree(commit, `${kind}/v1`, signal);
            trees.set(root.path, root.treeId);
            for (const year of children(root, "tree")) {
                if (!/^\d{4}$/.test(year))
                    continue;
                const listing = await this.remote.listTree(commit, `${kind}/v1/${year}`, signal);
                trees.set(listing.path, listing.treeId);
                for (const month of children(listing, "tree")) {
                    if (/^(?:0[1-9]|1[0-2])$/.test(month))
                        months.add(`${year}/${month}`);
                }
            }
        }
        return [...months];
    }
}
function relevant(directory, name) {
    if (directory === "")
        return name === "preferences.json";
    if (directory === "rules")
        return name === "user.json";
    if (directory === "rules/ai")
        return /^[0-9a-f]{64}\.json$/.test(name);
    if (directory === "projects")
        return /^[a-z0-9][a-z0-9-]{0,39}\.json$/.test(name);
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/.test(name);
}
function directChild(path, parent) { return !path.slice(parent === "" ? 0 : parent.length + 1).includes("/"); }
async function sha256(text) {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
