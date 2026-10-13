import { OUTBOX_DRAFT_KEY } from "../application/outbox.js";
/** Serializes storage handover with reads/writes so withdrawing consent cannot leak a late write. */
export class SwitchableLedgerStore {
    source;
    tail = Promise.resolve();
    draftIds = new Set(["ledger-outbox", "manual-entry"]);
    forgotten = false;
    constructor(source) {
        this.source = source;
    }
    serial(work) {
        const result = this.tail.then(work);
        this.tail = result.catch(() => { });
        return result;
    }
    read() { return this.serial(() => this.source.read()); }
    readPreferences() { return this.serial(() => this.source.readPreferences?.() ?? this.source.read()); }
    readState() { return this.serial(() => this.source.readState()); }
    publish(value) { return this.serial(() => this.forgotten ? Promise.resolve("stale-cursor") : this.source.publish(value)); }
    publishSync(value) { return this.serial(() => this.forgotten ? Promise.resolve("stale-cursor") : this.source.publishSync(value)); }
    putDraft(id, value) { this.draftIds.add(id); return this.serial(() => this.forgotten ? Promise.resolve() : this.source.putDraft(id, value)); }
    updateDraft(id, change) {
        this.draftIds.add(id);
        return this.serial(async () => {
            if (this.forgotten)
                throw new Error("Connection was forgotten");
            if (this.source.updateDraft)
                await this.source.updateDraft(id, change);
            else
                await this.source.putDraft(id, change(await this.source.getDraft(id)));
        });
    }
    getDraft(id) { this.draftIds.add(id); return this.serial(() => this.source.getDraft(id)); }
    deleteDraft(id) { return this.serial(() => this.source.deleteDraft(id)); }
    forget() { this.forgotten = true; return this.serial(() => this.source.forget()); }
    /** Rejection clears confirmed private data and other drafts, retaining the outbox atomically in its namespace. */
    rejectCredential() {
        this.forgotten = true;
        return this.serial(async () => {
            if (!this.source.rejectCredential)
                throw new Error("Confirmed data cannot be cleared separately");
            await this.source.rejectCredential();
        });
    }
    readLastView(request, buildId) { return this.serial(() => this.source.readLastView?.(request, buildId) ?? Promise.resolve(null)); }
    writeLastView(request, buildId, result) {
        return this.serial(() => this.forgotten ? Promise.resolve() : this.source.writeLastView?.(request, buildId, result) ?? Promise.resolve());
    }
    /** The destination is empty in the same namespace; the old retained copy is erased before success. */
    replace(destination, discardOutbox = false) {
        return this.serial(async () => {
            if (this.forgotten)
                throw new Error("Connection was forgotten");
            const state = await this.source.readState();
            await destination.forget();
            try {
                if (state.snapshot.cursor) {
                    const outcome = await destination.publishSync({ expectedCommit: null, cursor: state.snapshot.cursor,
                        upserts: state.snapshot.objects, deletions: [], coverage: state.snapshot.coverage,
                        trees: state.trees, covered: state.covered, knownMonths: state.knownMonths });
                    if (outcome !== "published")
                        throw new Error("Destination snapshot was not published");
                }
                for (const id of this.draftIds) {
                    if (discardOutbox && id === OUTBOX_DRAFT_KEY)
                        continue;
                    const draft = await this.source.getDraft(id);
                    if (draft !== undefined)
                        await destination.putDraft(id, draft);
                }
                await this.source.forget();
            }
            catch (error) {
                await destination.forget();
                throw error;
            }
            this.source = destination;
        });
    }
}
