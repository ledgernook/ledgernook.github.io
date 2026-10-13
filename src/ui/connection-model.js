import { inspectTokenRepositories, selectRepository } from "../application/repository-connection.js";
/** GitHub supports these three prefill fields; repository and expiry remain the user's choices. */
export function viewerTokenCreationUrl(prefill = {}) {
    const url = new URL("https://github.com/settings/personal-access-tokens/new");
    url.search = new URLSearchParams({
        name: prefill.name ?? "LedgerNook",
        description: prefill.description ?? "LedgerNook viewer access to my ledger",
        contents: "write",
    }).toString();
    return url.href;
}
/** Connection presentation state. Repository listing and token classification stay in application. */
export class ConnectionModel {
    ports;
    #token = "";
    #revision = 0;
    #disposed = false;
    #state;
    constructor(ports, screen = "welcome") {
        this.ports = ports;
        this.#state = { screen, inspection: null, repository: "", branch: "", showPublicRepositories: false, advanced: false, busy: false, notice: "", broad: false };
    }
    get state() { return this.#state; }
    get token() { return this.#token; }
    get selection() { return selectRepository(this.#state.inspection ?? { status: "unavailable" }, this.#state.repository, this.#state.branch); }
    #update(patch) {
        if (this.#disposed)
            return;
        this.#state = { ...this.#state, ...patch };
        this.ports.changed();
    }
    begin() { this.#update({ screen: "token", notice: "" }); }
    clearingFailed() { this.#update({ notice: "無法清除本機資料；請在瀏覽器網站資料設定中清除此網站資料" }); }
    setToken(value) {
        if (this.#disposed)
            return;
        this.#token = value;
        this.#revision++;
        this.#update({ inspection: null, busy: false, broad: false, showPublicRepositories: false, notice: "" });
    }
    back() {
        if (this.#state.busy)
            return;
        const screen = this.#state.screen;
        this.#revision++;
        if (screen === "token" && !this.#state.broad) {
            this.#token = "";
            this.#update({ screen: "welcome", inspection: null, notice: "", broad: false });
        }
        else
            this.#update({ screen: screen === "declined" ? "device" : screen === "device" ? "repository" : "token", broad: false, notice: "" });
    }
    async check() {
        if (this.#state.busy || !this.#token.trim())
            return;
        const revision = ++this.#revision;
        this.#update({ busy: true, notice: "", broad: false });
        const inspection = await inspectTokenRepositories(this.ports.catalog, this.#token.trim());
        if (this.#disposed || revision !== this.#revision)
            return;
        if (inspection.status === "ready" || inspection.status === "broad-access") {
            const firstPrivateRepository = inspection.repositories.find(repository => repository.isPrivate);
            this.#update({ inspection, busy: false, broad: inspection.status === "broad-access",
                screen: inspection.status === "broad-access" ? "token" : "repository", repository: firstPrivateRepository?.fullName ?? "", branch: "",
                showPublicRepositories: !firstPrivateRepository });
        }
        else {
            const notice = inspection.status === "network-failure" ? "連不上 GitHub，稍後再試" : inspection.status === "invalid-token" ? "權杖已失效"
                : inspection.status === "no-repositories" ? "找不到可用的儲存庫" : inspection.status === "access-denied" ? "無法讀取儲存庫，請檢查權杖權限" : "GitHub 暫時無法使用，稍後再試";
            this.#update({ inspection, busy: false, notice });
        }
    }
    redo() { this.setToken(""); this.#update({ screen: "token", repository: "", branch: "" }); }
    continueBroad() { if (this.#state.broad)
        this.#update({ screen: "repository", broad: false }); }
    chooseRepository(repository) {
        this.#update({ repository, branch: "", notice: "" });
    }
    revealPublicRepositories() { this.#update({ showPublicRepositories: true }); }
    toggleAdvanced() { this.#update({ advanced: !this.#state.advanced }); }
    setBranch(branch) { this.#update({ branch, notice: "" }); }
    continueRepository() {
        const selection = this.selection;
        if (selection.status === "selected")
            this.#update({ screen: "device", notice: "" });
        else
            this.#update({ notice: "請選擇可用的儲存庫與分支" });
    }
    decline() { this.#update({ screen: "declined" }); }
    async finish(remember) {
        const selected = this.selection;
        if (this.#state.busy || selected.status !== "selected" || !["device", "declined"].includes(this.#state.screen))
            return;
        this.#update({ busy: true, notice: "" });
        try {
            await this.ports.connect({ account: selected.owner, repository: selected.repository, branch: selected.branch, token: this.#token.trim() }, remember);
            this.#token = "";
        }
        catch {
            this.#update({ busy: false, notice: "無法開啟帳本，請重試" });
        }
    }
    async demo() {
        if (this.#disposed || this.#state.busy)
            return;
        this.#update({ busy: true });
        try {
            await this.ports.demo();
        }
        catch {
            this.#update({ busy: false, notice: "無法開啟示範，請重試" });
        }
    }
    dispose() { this.#disposed = true; this.#revision++; this.#token = ""; }
}
