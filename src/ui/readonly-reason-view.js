import { el } from "./dom.js";
import { button } from "./shared-controls.js";
export function readOnlyReasonCopy(capability) {
    if (capability?.status === "read-only" && capability.reason === "credential-needed")
        return "權杖已失效";
    return capability?.status === "read-only" && capability.reason === "ledger-not-retained"
        ? "尚未開啟「保留帳本」；開啟後才能修改，讓待同步變更保留在這台裝置"
        : "目前只能讀取。要修改，請換一個可寫入的權杖";
}
export function readOnlyReasonView(state, recheck, capability, replace) {
    const element = el("div", undefined, "lk-readonly-reason");
    element.append(el("p", readOnlyReasonCopy(capability), "lk-readonly-copy"));
    if (capability?.status === "read-only" && capability.reason === "credential-needed") {
        element.append(button("更換權杖", () => replace?.(), "lk-text-action lk-action-ink lk-readonly-recheck"));
        return { element };
    }
    if (capability?.status === "read-only" && capability.reason === "ledger-not-retained")
        return { element };
    if (state === "still-read-only")
        element.append(el("p", "目前仍是唯讀。", "lk-readonly-result"));
    const action = button(state === "checking" ? "檢查中…" : "重新檢查寫入權限", recheck, "lk-text-action lk-action-ink lk-readonly-recheck");
    action.disabled = state === "checking";
    element.append(action);
    return { element };
}
