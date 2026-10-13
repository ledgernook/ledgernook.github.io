import { validateLedgerObjectAtPath } from "../core/index.js";
import { afterConfirmedWrite, LocalSnapshotError } from "../application/sync.js";
import { OUTBOX_DRAFT_KEY } from "../application/outbox.js";
const EMPTY = Object.freeze({ cursor: null, coverage: Object.freeze({ complete: false, missing: Object.freeze(["initial"]) }), objects: Object.freeze([]) });
/** Session-only snapshot store used when the user has not consented to cross-session retention. */
export class MemorySnapshotStore {
    snapshot;
    trees;
    covered;
    knownMonths;
    drafts = new Map();
    constructor(initial) {
        this.snapshot = initial?.snapshot ?? EMPTY;
        this.trees = initial?.trees ?? [];
        this.covered = initial?.covered ?? [];
        this.knownMonths = initial?.knownMonths ?? [];
    }
    async read() { return this.snapshot; }
    async readState() {
        return { snapshot: this.snapshot, trees: this.trees, covered: this.covered, knownMonths: this.knownMonths };
    }
    async publish(publication) {
        if ((this.snapshot.cursor?.commit ?? null) !== publication.expectedCommit)
            return "stale-cursor";
        const parentCommit = publication.parentCommit === undefined ? publication.expectedCommit : publication.parentCommit;
        if (parentCommit !== publication.expectedCommit) {
            this.snapshot = Object.freeze({ ...this.snapshot, coverage: Object.freeze({ complete: false, missing: Object.freeze(["mutation-refresh"]) }) });
            return "stale-cursor";
        }
        return this.publishSync({ ...publication, ...afterConfirmedWrite(await this.readState(), publication),
            coverage: this.snapshot.coverage.complete ? this.snapshot.coverage : { complete: false, missing: ["mutation-refresh"] } });
    }
    async publishSync(publication) {
        if ((this.snapshot.cursor?.commit ?? null) !== publication.expectedCommit)
            return "stale-cursor";
        const objects = new Map(this.snapshot.objects.map(item => [item.path, item]));
        for (const path of publication.deletions)
            objects.delete(path);
        for (const object of publication.upserts)
            objects.set(object.path, validate(object));
        this.snapshot = Object.freeze({ cursor: publication.cursor, coverage: publication.coverage, objects: Object.freeze([...objects.values()]) });
        this.trees = Object.freeze([...publication.trees]);
        this.covered = Object.freeze([...publication.covered]);
        this.knownMonths = Object.freeze([...publication.knownMonths]);
        return "published";
    }
    async clearNamespace() { this.clear(false); }
    async forget() { this.clear(true); }
    async rejectCredential() {
        const outbox = this.drafts.get(OUTBOX_DRAFT_KEY);
        this.clear(true);
        if (outbox !== undefined)
            this.drafts.set(OUTBOX_DRAFT_KEY, outbox);
    }
    async putDraft(id, value) {
        if (!id)
            throw new TypeError("Missing draft id");
        this.drafts.set(id, value);
    }
    async updateDraft(id, change) {
        if (!id)
            throw new TypeError("Missing draft id");
        this.drafts.set(id, structuredClone(change(structuredClone(this.drafts.get(id)))));
    }
    async getDraft(id) { return this.drafts.get(id); }
    async deleteDraft(id) { this.drafts.delete(id); }
    clear(drafts) {
        this.snapshot = EMPTY;
        this.trees = [];
        this.covered = [];
        this.knownMonths = [];
        if (drafts)
            this.drafts.clear();
    }
}
function validate(object) {
    try {
        const value = validateLedgerObjectAtPath(object.path, object.value);
        if (value.kind !== object.kind || !/^[0-9a-f]{40}$/.test(object.objectId))
            throw new Error();
        return Object.freeze({ ...value, objectId: object.objectId });
    }
    catch {
        throw new LocalSnapshotError("invalid-data");
    }
}
