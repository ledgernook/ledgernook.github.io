import { OUTBOX_DRAFT_KEY, validateOutbox } from "../application/outbox.js";
const tails = new WeakMap();
/** IndexedDB adapter via the snapshot's non-disposable, namespace-scoped draft transaction. */
export class LocalOutboxStore {
    drafts;
    constructor(drafts) {
        this.drafts = drafts;
    }
    async read() {
        const raw = await this.drafts.getDraft(OUTBOX_DRAFT_KEY);
        return raw === undefined ? [] : validateOutbox(raw);
    }
    async update(change) {
        if (this.drafts.updateDraft)
            return this.drafts.updateDraft(OUTBOX_DRAFT_KEY, raw => validateOutbox(change(raw === undefined ? [] : validateOutbox(raw))));
        const task = (tails.get(this.drafts) ?? Promise.resolve()).then(async () => {
            await this.drafts.putDraft(OUTBOX_DRAFT_KEY, validateOutbox(change(await this.read())));
        });
        tails.set(this.drafts, task.catch(() => { }));
        await task;
    }
}
/** Isolated namespace handles share only an explicitly supplied synthetic/session backing map. */
export class MemoryOutboxStore {
    namespace;
    values;
    constructor(namespace, values = new Map()) {
        this.namespace = namespace;
        this.values = values;
        if (!namespace)
            throw new TypeError("Missing outbox namespace");
    }
    async read() { return validateOutbox(structuredClone(this.values.get(this.namespace) ?? [])); }
    async update(change) {
        this.values.set(this.namespace, structuredClone(validateOutbox(change(validateOutbox(this.values.get(this.namespace) ?? [])))));
    }
}
