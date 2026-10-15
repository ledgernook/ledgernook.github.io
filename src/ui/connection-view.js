import { ConnectionModel, viewerTokenCreationUrl } from "./connection-model.js";
import { el } from "./dom.js";
import { icon, iconButton } from "./icons.js";
import { button, notice, textAction } from "./shared-controls.js";
import { observeWidthClass } from "./layout/width-class.js";
import { EdgeSwipeHost } from "./layout/edge-swipe.js";
export function connectionView(model, skin) {
    const state = model.state;
    const element = el("div", undefined, "lk-connection");
    element.dataset.connectionScreen = state.screen;
    if (state.screen === "welcome") {
        element.classList.add("lk-welcome");
        const intro = el("div", undefined, "lk-welcome-intro");
        intro.append(skin.scene(skin.companion("idle", { scale: 1.1 }), { large: true }), el("h1", "LedgerNook"), el("p", "帳本存在你的 GitHub 儲存庫"));
        const actions = el("div", undefined, "lk-welcome-actions");
        actions.append(textAction("連接我的帳本", () => model.begin()), textAction("看示範", () => { void model.demo(); }, "secondary"), el("span", "示範使用合成資料", "lk-welcome-synthetic"));
        element.append(intro, actions);
    }
    else {
        const header = el("div", undefined, "lk-connection-header");
        const back = iconButton("arrow_back", "返回", () => model.back(), 20);
        back.classList.add("lk-edge-back");
        back.disabled = state.busy;
        header.append(back);
        if (state.screen !== "declined" && !model.replacement)
            header.append(el("span", `${state.screen === "token" ? 1 : state.screen === "repository" ? 2 : 3} / 3`, "lk-connection-step lk-number"));
        element.append(header);
        if (state.screen === "token")
            tokenView(element, model);
        else if (state.screen === "repository")
            repositoryView(element, model);
        else if (state.screen === "device")
            deviceView(element, model);
        else {
            element.append(el("h1", "只在這次使用"), el("p", "關掉就要重新連接；未開啟「保留帳本」，這次只能唯讀", "lk-connection-body"), textAction(state.busy ? "連接中…" : "開始使用", () => { void model.finish(false); }), button("改為記住這台裝置", () => model.back(), "lk-connection-link"));
        }
    }
    if (state.notice && !["token", "repository"].includes(state.screen))
        element.append(notice(state.notice, "error"));
    if (state.busy)
        for (const control of element.querySelectorAll("button"))
            control.disabled = true;
    return { element };
}
function tokenView(element, model) {
    const state = model.state;
    element.append(el("h1", model.replacement ? "更換權杖" : "連接帳本"));
    if (model.replacement)
        element.append(el("p", `${model.replacement.account}/${model.replacement.repository} · ${model.replacement.branch}`, "lk-connection-account"));
    element.append(el("p", "建議用 fine-grained 權杖，只開放帳本儲存庫", "lk-connection-copy"));
    if (!model.replacement)
        element.append(el("p", "建議把帳本設為私人儲存庫", "lk-connection-copy"));
    const github = el("a", "在 GitHub 建立權杖", "lk-text-action lk-action-ink");
    github.href = viewerTokenCreationUrl();
    github.target = "_blank";
    github.rel = "noopener noreferrer";
    github.append(icon("open_in_new", 18));
    element.append(github);
    const permissions = el("div", undefined, "lk-card lk-connection-permissions");
    permissions.append(el("div", "權限", "lk-permission-title"));
    for (const [name, value] of [["Repository access", "只選帳本儲存庫"], ["Contents", "Read and write（只看選 Read-only）"], ["Metadata", "Read-only"]]) {
        const row = el("div", undefined, "lk-permission-row");
        row.append(el("span", name), el("span", value));
        permissions.append(row);
    }
    element.append(permissions);
    const entry = el("div", undefined, "lk-token-entry"), label = el("label", undefined, "lk-connection-field"), input = el("input");
    input.type = "password";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.value = model.token;
    input.placeholder = "貼上權杖";
    input.setAttribute("aria-label", "貼上權杖");
    label.addEventListener("click", () => input.focus());
    label.append(icon("key", 19), input);
    entry.append(label);
    element.append(entry);
    const check = textAction(state.busy ? "檢查中…" : "繼續", () => { void model.check(); });
    check.disabled = !model.token.trim() || state.busy;
    input.addEventListener("input", () => { model.setToken(input.value); });
    input.addEventListener("keydown", event => { if (event.key === "Enter") {
        event.preventDefault();
        void model.check();
    } });
    if (state.notice)
        element.append(notice(state.notice, "error"));
    if (state.broad) {
        const warning = el("div", undefined, "lk-broad-warning");
        const title = el("div", undefined, "lk-broad-title");
        title.append(icon("warning", 19), el("span", "權限太大"));
        // More than one visible repository does not prove access to every repository.
        const inspection = state.inspection;
        const all = inspection?.status === "broad-access" && inspection.broadAccessReason === "classic-repo";
        warning.append(title, el("span", all ? "能存取你所有的儲存庫，建議只開放帳本" : "能存取多個儲存庫，建議只開放帳本", "lk-connection-copy"));
        const actions = el("div", undefined, "lk-broad-actions");
        actions.append(textAction("重新建立", () => model.redo(), "ink"), textAction("仍然繼續", () => model.continueBroad(), "outline"));
        warning.append(actions);
        element.append(warning);
    }
    else
        element.append(check);
}
function repositoryView(element, model) {
    const state = model.state, inspection = state.inspection;
    element.append(el("h1", "選擇帳本"));
    if (!inspection || !["ready", "broad-access"].includes(inspection.status) || !("repositories" in inspection))
        return;
    const account = el("p", undefined, "lk-connection-account");
    account.append(icon("person", 17), el("span", inspection.account));
    element.append(account);
    const rows = el("div", undefined, "lk-card lk-repository-list");
    const privateRepositories = inspection.repositories.filter(repository => repository.isPrivate);
    const publicRepositories = inspection.repositories.filter(repository => !repository.isPrivate);
    const visibleRepositories = [...privateRepositories, ...(state.showPublicRepositories ? publicRepositories : [])];
    for (const repository of visibleRepositories) {
        const row = button("", () => model.chooseRepository(repository.fullName), "lk-repository-row");
        const selected = state.repository === repository.fullName;
        row.setAttribute("aria-pressed", String(selected));
        row.append(icon(selected ? "radio_button_checked" : "radio_button_unchecked", 22), el("span", repository.fullName, "lk-repository-name"));
        const privacy = el("span", undefined, "lk-repository-privacy");
        privacy.append(icon(repository.isPrivate ? "lock" : "public", 15), el("span", repository.isPrivate ? "私人" : "公開"));
        row.append(privacy);
        rows.append(row);
    }
    element.append(rows);
    if (privateRepositories.length > 0 && publicRepositories.length > 0 && !state.showPublicRepositories) {
        const reveal = button(`顯示公開儲存庫（${publicRepositories.length}）`, () => model.revealPublicRepositories(), "lk-connection-public-reveal");
        reveal.append(icon("expand_more", 18));
        element.append(reveal);
    }
    if (state.notice)
        element.append(notice(state.notice, "error"));
    const advanced = button("進階", () => model.toggleAdvanced(), "lk-connection-advanced");
    advanced.setAttribute("aria-expanded", String(state.advanced));
    advanced.append(icon(state.advanced ? "expand_less" : "expand_more", 18));
    element.append(advanced);
    if (state.advanced) {
        const label = el("label", undefined, "lk-connection-field lk-branch-field"), input = el("input");
        const branch = inspection.repositories.find(repo => repo.fullName === state.repository)?.defaultBranch ?? "main";
        input.value = state.branch;
        input.placeholder = `分支（預設 ${branch}）`;
        input.setAttribute("aria-label", "分支");
        input.addEventListener("input", () => model.setBranch(input.value));
        label.append(icon("fork_right", 19), input);
        element.append(label);
    }
    const next = textAction("繼續", () => model.continueRepository());
    next.disabled = model.selection.status !== "selected";
    element.append(next);
}
function deviceView(element, model) {
    element.append(el("h1", "這是你的裝置嗎？"));
    const card = el("div", undefined, "lk-card lk-device-choice"), title = el("div", undefined, "lk-device-title");
    title.append(icon("smartphone", 21), el("span", "這是我的裝置：記住連線並離線可用"));
    card.append(title);
    const disclosure = el("div", undefined, "lk-device-disclosure");
    for (const [glyph, copy] of [["key", "權杖和帳本會存在這台裝置"], ["lock_open", "這個網站和拿到這支解鎖手機的人，都能讀取帳本"], ["edit_document", "權杖可寫入時，也能修改整個儲存庫"], ["tune", "之後可在設定關閉"]]) {
        const row = el("div");
        row.append(icon(glyph, 17), el("span", copy));
        disclosure.append(row);
    }
    const accept = textAction(model.state.busy ? "連接中…" : "記住這台裝置", () => { void model.finish(true); });
    accept.setAttribute("aria-label", "這是我的裝置：記住連線並離線可用");
    card.append(disclosure, accept);
    element.append(card, textAction("不是，只在這次使用", () => model.decline(), "outline"));
}
/** Full-page connection presentation uses the same shell tokens and safe-area layout. */
export function mountConnectionApp(root, ports, skin, screen = "welcome") {
    const shell = el("div", undefined, "lk-app-shell lk-connection-shell"), content = el("main", undefined, "lk-connection-content");
    shell.append(content);
    const stopLayout = observeWidthClass(shell);
    const edgeSwipe = new EdgeSwipeHost(shell, content);
    const refreshEdge = () => edgeSwipe.refresh();
    window.addEventListener("resize", refreshEdge);
    const model = new ConnectionModel({ ...ports, changed: () => {
            const active = document.activeElement;
            const label = active instanceof HTMLInputElement ? active.getAttribute("aria-label") : null;
            const start = active instanceof HTMLInputElement ? active.selectionStart : null;
            const end = active instanceof HTMLInputElement ? active.selectionEnd : null;
            const view = connectionView(model, skin);
            edgeSwipe.replace(() => content.replaceChildren(view.element), view.element);
            if (label) {
                const input = [...content.querySelectorAll("input")].find(node => node.getAttribute("aria-label") === label);
                input?.focus();
                if (input && start !== null && end !== null)
                    input.setSelectionRange(start, end);
            }
            ports.changed();
        } }, screen);
    const view = connectionView(model, skin);
    edgeSwipe.replace(() => content.append(view.element), view.element);
    root.replaceChildren(shell);
    root.dataset.firstViewMounted = "true";
    return { model, dispose() { window.removeEventListener("resize", refreshEdge); edgeSwipe.dispose(); stopLayout(); model.dispose(); shell.remove(); } };
}
