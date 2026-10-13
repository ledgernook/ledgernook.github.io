/** Connection-scoped state; neither credentials nor transport metadata belong here. */
export class ConnectionCapability {
    #state;
    #broaderAccess = false;
    #ledgerRetained;
    constructor(input = {}) {
        this.#ledgerRetained = input.ledgerRetained !== false;
        this.#state = input.writeDenied ? { status: "read-only", reason: "write-denied" }
            : input.evidence === "read-only" ? { status: "read-only", reason: "evidence-read-only" } : { status: "writable" };
    }
    get state() {
        return !this.#ledgerRetained && !(this.#state.status === "read-only" && this.#state.reason === "demo-none")
            ? { status: "read-only", reason: "ledger-not-retained" } : this.#state;
    }
    setLedgerRetention(retained) { this.#ledgerRetained = retained; }
    get writeDenied() { return this.#state.status === "read-only" && this.#state.reason === "write-denied"; }
    get broaderAccess() { return this.#broaderAccess; }
    observeMutation(outcome) {
        if (outcome.status === "rejected" && outcome.code === "write-denied")
            this.#state = { status: "read-only", reason: "write-denied" };
    }
    observePush(outcome) {
        if (outcome.status === "write-denied")
            this.#state = { status: "read-only", reason: "write-denied" };
    }
    observeBroaderAccess(broader) { this.#broaderAccess ||= broader; }
    recheck() { this.#state = { status: "writable" }; }
    clear() { this.#state = { status: "read-only", reason: "demo-none" }; this.#broaderAccess = false; }
}
