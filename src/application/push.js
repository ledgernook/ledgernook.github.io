import { validateLedgerObjectAtPath } from "../core/index.js";
import { MAX_COMMAND_WRITES, RemoteReadError } from "./ports.js";
import { composeLocalLedger } from "./local-ledger.js";
import { valuesEqual } from "./replay.js";
import { afterConfirmedWrite } from "./sync.js";
const directory = (path) => path.slice(0, Math.max(0, path.lastIndexOf("/")));
const temporary = (reason) => ({ status: "temporary", reason });
function readFailure(error) {
    if (error instanceof RemoteReadError) {
        if (error.code === "unauthorized" || error.code === "forbidden")
            return { status: "credential-rejected" };
        if (error.code === "rate-limited")
            return temporary("rate-limited");
        if (error.code === "network" || error.code === "cancelled")
            return temporary("offline");
    }
    return temporary("incomplete");
}
function atHead(snapshot, pinned) {
    const objects = new Map(snapshot.objects.map(object => [object.path, object]));
    for (const entry of pinned) {
        if (entry.object)
            objects.set(entry.path, entry.object);
        else
            objects.delete(entry.path);
    }
    return { ...snapshot, objects: [...objects.values()] };
}
function differing(head, values) {
    const objects = new Map(head.objects.map(object => [object.path, object]));
    return [...values.values()].filter(write => !valuesEqual(objects.get(write.path)?.value ?? null, write.value))
        .map(write => ({ ...write, expectedObjectId: objects.get(write.path)?.objectId ?? null }));
}
/** Inbox source/removal pairs and command write sets are indivisible units. Later local values never leak into an earlier batch. */
function selectBatch(head, ledger) {
    const values = new Map();
    const entries = head.objects.filter(object => object.kind === "unrecorded");
    let inboxCount = 0;
    for (const entry of entries) {
        const deletion = ledger.inboxWrites.find(write => write.path === entry.path);
        if (!deletion || entry.kind !== "unrecorded")
            continue;
        const source = ledger.inboxWrites.find(write => write.value && "id" in write.value && write.value.id === entry.value.id && write.path.startsWith("events/"));
        const next = new Map(values);
        for (const write of source ? [source, deletion] : [deletion])
            next.set(write.path, write);
        if (differing(head, next).length > MAX_COMMAND_WRITES)
            return { writes: differing(head, values), intents: [], inboxCount };
        for (const [path, write] of next)
            values.set(path, write);
        inboxCount++;
    }
    const intents = [];
    for (const result of ledger.intents) {
        if (result.state !== "pending" || result.temporary)
            continue;
        const next = new Map(values);
        for (const write of result.writes)
            next.set(write.path, write);
        if (differing(head, next).length > MAX_COMMAND_WRITES)
            break;
        for (const [path, write] of next)
            values.set(path, write);
        intents.push(result.intent);
    }
    return { writes: differing(head, values), intents, inboxCount };
}
/** Connection-owned single flight. Concurrent requests share the flight and coalesce into one follow-up pull/push. */
export class LedgerPush {
    options;
    #running;
    #followup;
    constructor(options) {
        this.options = options;
    }
    push(request) {
        if (this.#running) {
            this.#followup = request;
            return this.#running;
        }
        this.#running = this.#drain(request).finally(() => { this.#running = undefined; });
        return this.#running;
    }
    async #drain(request) {
        let result = await this.#perform(request);
        while (this.#followup) {
            const next = this.#followup;
            this.#followup = undefined;
            const outcome = await this.#perform(next);
            result = result.status === "synced" && outcome.status === "synced"
                ? { status: "synced", pushed: result.pushed + outcome.pushed, done: result.done + outcome.done, failed: Math.max(result.failed, outcome.failed) }
                : result.status === "synced" && outcome.status === "nothing-to-push" ? result : outcome;
        }
        return result;
    }
    async #perform(request) {
        let pushed = 0, done = 0;
        const failures = new Set();
        let rejected = 0;
        try {
            for (;;) {
                if (request.signal?.aborted)
                    return temporary("offline");
                const pull = await this.options.synchronizer.sync({ ...request, manual: true, historyBudget: 0 });
                if (pull.status === "unauthorized" || pull.status === "forbidden")
                    return { status: "credential-rejected" };
                if (pull.status === "rate-limited")
                    return temporary("rate-limited");
                if (pull.status === "offline" || pull.status === "cancelled")
                    return temporary("offline");
                if (!["synced", "unchanged"].includes(pull.status) || !pull.commit)
                    return temporary("incomplete");
                const state = await this.options.local.readState();
                if (state.snapshot.cursor?.commit !== pull.commit)
                    return temporary("incomplete");
                const entries = await this.options.outbox.store.read();
                // Pin even a path whose initial replay failed: discovering an existing create must settle by value.
                const preliminary = composeLocalLedger(state.snapshot, entries, this.options.outbox.reader);
                const paths = [...new Set([...entries.flatMap(intent => intent.command.writes.map(write => write.path)),
                        ...preliminary.inboxWrites.map(write => write.path)])].filter(path => !state.covered.includes(directory(path)));
                const pinned = paths.length ? await this.options.remote.readPaths(pull.commit, paths, request.signal) : [];
                if (pinned.length !== paths.length || new Set(pinned.map(item => item.path)).size !== paths.length ||
                    pinned.some(item => !paths.includes(item.path) || item.object && item.object.path !== item.path))
                    return temporary("incomplete");
                if (request.signal?.aborted)
                    return temporary("offline");
                const head = atHead(state.snapshot, pinned);
                const ledger = composeLocalLedger(head, entries, this.options.outbox.reader);
                const selected = selectBatch(head, ledger);
                const settled = ledger.intents.filter(result => result.state === "done").map(result => result.intent);
                const failed = ledger.intents.filter(result => result.state === "failed");
                const publishPinned = { upserts: pinned.flatMap(item => item.object ? [item.object] : []), deletions: pinned.filter(item => !item.object).map(item => item.path) };
                if (!selected.writes.length) {
                    if (pinned.length) {
                        const fresh = await this.options.local.readState();
                        if (fresh.snapshot.cursor?.commit !== pull.commit)
                            return temporary("incomplete");
                        if (await this.options.local.publishSync({ expectedCommit: pull.commit, cursor: fresh.snapshot.cursor,
                            ...publishPinned, coverage: fresh.snapshot.coverage, trees: fresh.trees, covered: fresh.covered, knownMonths: fresh.knownMonths }) !== "published")
                            return temporary("incomplete");
                    }
                    await this.options.outbox.settle(settled, failed);
                    done += settled.length;
                    for (const result of failed)
                        failures.add(result.intent.command.operationId);
                    return pushed || done || failures.size ? { status: "synced", pushed, done, failed: failures.size }
                        : ledger.temporary ? temporary("incomplete") : { status: "nothing-to-push" };
                }
                const rootTree = state.covered.includes("") ? state.trees.find(tree => tree.path === "")?.treeId : undefined;
                const result = await this.options.remote.commit({ head: pull.commit, ...(rootTree ? { baseTree: rootTree } : {}), writes: selected.writes }, request.signal);
                if (result.status === "stale-head") {
                    if (++rejected >= 3)
                        return temporary("exhausted");
                    continue;
                }
                if (result.status !== "confirmed")
                    return result;
                // Publish before removing anything. A landed batch with failed local publication is repaired by the next pull/replay.
                const upserts = selected.writes.flatMap(write => write.value === null ? [] :
                    [{ ...validateLedgerObjectAtPath(write.path, write.value), objectId: result.objectIds[write.path] }]);
                const writtenPaths = new Set(selected.writes.map(write => write.path));
                const publication = { expectedCommit: pull.commit, parentCommit: result.parentCommit,
                    cursor: { commit: result.commit, synchronizedAt: this.options.now() }, upserts: [...publishPinned.upserts.filter(object => !writtenPaths.has(object.path)), ...upserts],
                    deletions: [...publishPinned.deletions, ...selected.writes.filter(write => write.value === null).map(write => write.path)], coverage: state.snapshot.coverage };
                if (result.parentCommit !== pull.commit || !/^[0-9a-f]{40}$/.test(result.commit) || upserts.some(object => !/^[0-9a-f]{40}$/.test(object.objectId)))
                    return temporary("incomplete");
                const fresh = await this.options.local.readState();
                if (fresh.snapshot.cursor?.commit !== pull.commit)
                    return temporary("incomplete");
                const freshPublication = { ...publication, coverage: fresh.snapshot.coverage };
                if (await this.options.local.publishSync({ ...freshPublication, ...afterConfirmedWrite(fresh, freshPublication) }) !== "published")
                    return temporary("incomplete");
                await this.options.outbox.settle([...settled, ...selected.intents], failed);
                pushed += selected.intents.length + selected.inboxCount;
                done += settled.length;
                for (const item of failed)
                    failures.add(item.intent.command.operationId);
                rejected = 0;
                // A full batch may leave later intents or inbox entries. No second history reload after publication.
                if (selected.intents.length === ledger.intents.filter(item => item.state === "pending" && !item.temporary).length &&
                    selected.inboxCount === ledger.inboxWrites.filter(write => write.value === null).length)
                    return { status: "synced", pushed, done, failed: failures.size };
            }
        }
        catch (error) {
            return readFailure(error);
        }
    }
}
