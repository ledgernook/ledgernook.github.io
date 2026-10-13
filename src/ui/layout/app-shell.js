import { el } from "../dom.js";
import { icon, iconButton } from "../icons.js";
import { ArrangementHost } from "./arrangement.js";
import { drawerWidth, presentationFor, widthClass } from "./width-class.js";
import { attachSheetSwipe } from "./sheet-swipe.js";
import { EdgeSwipeHost } from "./edge-swipe.js";
const tabs = [["home", "總覽"], ["proj", "專案"], ["add", "新增"], ["report", "報表"], ["settings", "設定"]];
/** Replaceable navigation presentation; callbacks belong to the feature router. */
export function tabBar(skin, selected, select, readOnly = false) {
    if (selected === "list")
        selected = "home";
    const bar = el("nav", undefined, "lk-tab-bar");
    bar.setAttribute("aria-label", "分頁");
    for (const [id, label] of tabs) {
        const button = el("button", undefined, "lk-tab");
        button.type = "button";
        button.setAttribute("aria-label", id === "add" && readOnly ? "唯讀" : label);
        button.setAttribute("aria-current", id === selected ? "page" : "false");
        button.setAttribute("data-tab", id);
        if (id === "add" && readOnly)
            button.setAttribute("data-readonly", "true");
        button.append(id === "add" && readOnly ? icon("lock", 26)
            : skin.tabIcon(id, id === selected, 26) ?? icon(skin.icons[id] ?? id, 26, id === selected && id !== "add"));
        button.addEventListener("click", () => select(id));
        bar.append(button);
    }
    return bar;
}
export class SheetHost {
    background;
    content;
    right;
    changed;
    leave;
    element = el("div", undefined, "lk-sheet-host");
    #returnFocus = null;
    #close;
    #stack = [];
    #layout = "phone";
    #origin = "left";
    #presentation = "sheet";
    #rightEmpty = false;
    constructor(background, content = background, right, changed = () => { }, leave = () => { }) {
        this.background = background;
        this.content = content;
        this.right = right;
        this.changed = changed;
        this.leave = leave;
        this.element.hidden = true;
        this.element.addEventListener("keydown", event => {
            // Keep keyboard focus inside the active sheet.
            if (event.key !== "Tab" || this.#presentation !== "sheet")
                return;
            const controls = [...(this.#stack.at(-1)?.layer ?? this.element).querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]')];
            const first = controls[0], last = controls.at(-1);
            if (!first || !last) {
                event.preventDefault();
                return;
            }
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            }
            else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        });
    }
    get presentation() { return this.#presentation; }
    get origin() { return this.#origin; }
    get recordId() { return this.#stack[0]?.options.recordId; }
    place(layout, width, rightEmpty, active = document.activeElement) {
        this.#layout = layout;
        this.#rightEmpty = rightEmpty;
        this.element.style.setProperty("--drawer-width", `${drawerWidth(width)}px`);
        this.#place(active);
    }
    #place(active = document.activeElement) {
        this.#presentation = presentationFor(this.#layout, this.#origin, this.#rightEmpty);
        this.element.setAttribute("data-presentation", this.#presentation);
        const open = !this.element.hidden;
        this.background.inert = open && this.#presentation === "sheet";
        if (this.content !== this.background)
            this.content.inert = open && this.#presentation === "drawer";
        if (this.right) {
            this.right.inert = open && this.#presentation === "panel";
            this.right.hidden = open && this.#presentation === "panel";
        }
        this.#stack.forEach((frame, index) => {
            frame.swipe.reset();
            const panel = frame.layer.querySelector(".lk-sheet");
            panel.setAttribute("aria-modal", String(this.#presentation === "sheet"));
            if (this.#presentation === "sheet") {
                frame.tabletClose?.remove();
                if (frame.options.dismissal === "backdrop")
                    frame.header.remove();
            }
            else {
                if (frame.options.dismissal === "backdrop" && !panel.contains(frame.header))
                    panel.insertBefore(frame.header, frame.options.view.element);
                if (frame.tabletClose && !frame.header.contains(frame.tabletClose))
                    frame.header.append(frame.tabletClose);
            }
            // A non-modal dock never exposes an inert previous step to pointer input.
            frame.layer.hidden = this.#presentation !== "sheet" && index < this.#stack.length - 1;
        });
        const panel = this.#stack.at(-1)?.layer.querySelector(".lk-sheet");
        if (open && panel && ((this.#presentation === "sheet" && !panel.contains(active)) ||
            (this.#presentation === "drawer" && this.content.contains(active))))
            panel.focus({ preventScroll: true });
        this.changed();
    }
    /** Tab navigation cancels each nested step, then the originating presentation. */
    closeForTab(includeSheet = false) {
        if (this.element.hidden || this.#presentation === "sheet" && !includeSheet)
            return "none";
        while (this.#stack.length) {
            const depth = this.#stack.length;
            this.#close?.();
            if (this.#stack.length >= depth)
                return "blocked";
        }
        return "closed";
    }
    open(options) {
        if (this.element.hidden)
            this.#returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        for (const frame of this.#stack) {
            frame.swipe.dispose();
            frame.options.view.dispose?.();
        }
        this.#stack = [];
        this.element.replaceChildren();
        this.#origin = options.origin ?? "left";
        this.push(options);
    }
    /** An action sheet keeps its originating record visible and inert underneath. */
    push(options) {
        const previous = this.#stack.at(-1);
        if (!previous)
            this.#origin = options.origin ?? "left";
        if (previous) {
            previous.layer.inert = true;
            previous.layer.setAttribute("aria-hidden", "true");
        }
        this.#close = options.close;
        const layer = el("div", undefined, "lk-sheet-layer");
        const scrim = el("div", undefined, "lk-scrim");
        scrim.addEventListener("click", () => {
            if (this.#presentation === "drawer" || options.dismissal === "backdrop" || options.dismissOnBackdrop)
                options.close();
        });
        const panel = el("section", undefined, "lk-sheet");
        panel.setAttribute("role", "dialog");
        panel.setAttribute("aria-modal", "true");
        panel.setAttribute("aria-label", options.title);
        panel.tabIndex = -1;
        const handle = el("div", undefined, "lk-sheet-handle");
        handle.setAttribute("aria-hidden", "true");
        const header = options.header ?? el("div", undefined, "lk-sheet-header");
        header.setAttribute("data-sheet-header", "true");
        if (!options.header) {
            header.append(el("h2", options.title, "lk-sheet-title"), iconButton("close", "關閉", () => this.#close?.()));
        }
        panel.append(handle);
        if (options.dismissal !== "backdrop")
            panel.append(header);
        panel.append(options.view.element);
        layer.append(scrim, panel);
        const hasClose = [...header.querySelectorAll("button")].some(button => button.getAttribute("aria-label") === "關閉");
        const tabletClose = hasClose ? null : iconButton("close", "關閉", options.close);
        const swipe = attachSheetSwipe(panel, handle, header, options.swipe ?? "close", () => this.#presentation === "sheet" && this.#stack.at(-1)?.layer === layer, options.close);
        this.#stack.push({ layer, options, header, tabletClose, swipe });
        this.element.append(layer);
        this.element.hidden = false;
        this.#place();
        panel.focus({ preventScroll: true });
    }
    pop() {
        if (this.#stack.length < 2) {
            this.dismiss();
            return;
        }
        this.leave();
        const frame = this.#stack.pop();
        frame.swipe.dispose();
        frame.options.view.dispose?.();
        frame.layer.remove();
        const previous = this.#stack.at(-1);
        previous.layer.inert = false;
        previous.layer.removeAttribute("aria-hidden");
        this.#close = previous.options.close;
        this.#place();
        previous.layer.querySelector(".lk-sheet")?.focus({ preventScroll: true });
    }
    dismiss() {
        if (this.#stack.length)
            this.leave();
        for (const frame of this.#stack) {
            frame.swipe.dispose();
            frame.options.view.dispose?.();
        }
        this.#stack = [];
        this.#close = undefined;
        this.element.replaceChildren();
        this.element.hidden = true;
        this.#place();
        this.#returnFocus?.focus({ preventScroll: true });
        this.#returnFocus = null;
    }
}
export function createAppShell(skin, actions, initial) {
    const element = el("div", undefined, "lk-app-shell");
    const background = el("div", undefined, "lk-shell-background");
    const banner = el("div", undefined, "lk-save-failure-banner");
    const shelf = el("div", undefined, "lk-status-shelf");
    shelf.hidden = true;
    banner.hidden = true;
    const content = el("main", undefined, "lk-content");
    const navigation = el("div", undefined, "lk-navigation-host");
    const arrangement = new ArrangementHost(content);
    const sheets = new SheetHost(background, content, arrangement.secondary, updateOpenRow, () => actions.leave?.());
    const edgeSwipe = new EdgeSwipeHost(element, content, () => !sheets.element.hidden);
    background.append(banner, content, navigation);
    navigation.append(shelf);
    element.append(background, sheets.element);
    let shelfKind = null;
    let current;
    let layout = "phone", selected = initial.tab;
    const layoutListeners = new Set();
    function updateOpenRow() {
        element.setAttribute("data-presentation", sheets.presentation);
        shelf.hidden = !shelfKind || !sheets.element.hidden;
        element.setAttribute("data-status-shelf", String(!shelf.hidden));
        element.setAttribute("data-panel-arrangement", arrangement.kind);
        for (const row of content.querySelectorAll(".lk-record-row")) {
            const open = row.getAttribute("data-record-id") === (sheets.element.hidden ? arrangement.recordId : sheets.presentation === "panel" ? sheets.recordId : undefined);
            if (open)
                row.setAttribute("data-open", "true");
            else
                row.removeAttribute("data-open");
        }
        for (const row of content.querySelectorAll(".lk-page-row")) {
            const open = sheets.element.hidden && arrangement.pageId !== null && row.getAttribute("data-page-id") === arrangement.pageId;
            if (open)
                row.setAttribute("data-open", "true");
            else
                row.removeAttribute("data-open");
        }
    }
    function resize() {
        const width = window.innerWidth ?? 390;
        const active = document.activeElement;
        const previousLayout = layout;
        layout = widthClass(width, window.screen ? Math.min(window.screen.width, window.screen.height) : 390);
        element.setAttribute("data-layout", layout);
        arrangement.place(layout);
        edgeSwipe.refresh();
        sheets.place(layout, width, arrangement.rightEmpty, active);
        if (layout !== previousLayout)
            for (const listener of layoutListeners)
                listener(layout);
    }
    function guardNavigation(action, reset = false, closeOnly = false) {
        const cancellation = sheets.closeForTab(reset);
        if (cancellation === "blocked" || cancellation === "closed" && closeOnly)
            return;
        actions.leave?.();
        action();
    }
    function selectTab(tab) {
        const reset = tab !== "add" && tab !== "list" && (tab === selected || tab === "home" && selected === "list");
        guardNavigation(() => {
            if (reset && actions.resetCurrentTab)
                actions.resetCurrentTab(tab);
            else if (tab === "settings")
                actions.settings();
            else
                actions.selectTab(tab);
            if (reset) {
                arrangement.content.scrollTop = 0;
                element.querySelectorAll(".lk-layout-primary, .lk-layout-secondary").forEach(column => { column.scrollTop = 0; });
            }
        }, reset, !reset && tab === selected);
    }
    function navigate(action) { guardNavigation(action); }
    function update(state) {
        selected = state.tab;
        element.setAttribute("data-sync-icon", state.status.icon);
        element.setAttribute("data-active-tab", state.tab === "list" ? "home" : state.tab ?? "");
        const failure = state.saveFailure ?? (state.status.banner ? state.status : null);
        banner.hidden = failure === null;
        banner.replaceChildren();
        if (failure)
            banner.append(icon(failure.icon, 18), el("span", failure.text));
        const pendingCount = Math.max(0, state.pendingCount ?? 0);
        const readOnlyPending = state.readOnly && pendingCount > 0;
        const showPendingCount = state.pendingCountVisible === true || readOnlyPending;
        shelfKind = state.demo ? "demo" : state.status.banner ? null : state.status.icon === "sync_problem" ? "failed"
            : state.status.icon === "cloud_off" ? "offline" : readOnlyPending ? "readonly" : state.status.firstLoad ? "loading" : null;
        // Preserve the shelf node across refreshes so background updates do not restart its rise.
        const previousKind = shelf.getAttribute("data-state");
        shelf.setAttribute("data-state", shelfKind ?? "");
        shelf.setAttribute("role", "status");
        shelf.replaceChildren();
        if (shelfKind) {
            const row = el("div", undefined, "lk-status-shelf-row");
            const shelfIcon = state.demo ? "science" : shelfKind === "readonly" ? "lock" : state.status.icon;
            const shelfText = state.demo ? "示範帳本 · 合成資料" : shelfKind === "readonly" ? `唯讀 · 待同步 ${pendingCount} 筆`
                : state.status.text + (showPendingCount && pendingCount > 0 && (shelfKind === "offline" || shelfKind === "failed") ? ` · 待同步 ${pendingCount} 筆` : "");
            row.append(icon(shelfIcon, 18), el("span", shelfText, "lk-status-shelf-copy"));
            if (state.demo?.exit) {
                const exit = el("button", "離開", "lk-status-shelf-exit");
                exit.type = "button";
                exit.addEventListener("click", state.demo.exit);
                row.append(exit);
            }
            else if (state.status.retry) {
                const retry = iconButton("refresh", "重試", state.status.retry, 17);
                retry.classList.add("lk-status-shelf-retry");
                row.append(retry);
            }
            shelf.append(row);
            if (shelfKind === "loading") {
                const progress = el("div", undefined, "lk-load-progress");
                progress.setAttribute("aria-hidden", "true");
                progress.append(el("div"));
                shelf.append(progress);
            }
        }
        if (previousKind !== (shelfKind ?? ""))
            shelf.setAttribute("data-rise", String(shelfKind !== null));
        navigation.querySelector(".lk-tab-bar")?.remove();
        navigation.append(tabBar(skin, state.tab, selectTab, state.readOnly));
        updateOpenRow();
    }
    update(initial);
    resize();
    window.addEventListener("resize", resize);
    return { element, get content() { return arrangement.content; }, sheets, get layout() { return layout; }, update, navigate, selectTab,
        onLayoutChange(listener) { layoutListeners.add(listener); return () => layoutListeners.delete(listener); }, refreshLayout: resize,
        show(view, spec) {
            const replacing = current !== undefined;
            edgeSwipe.replace(() => { current?.dispose?.(); current = view; arrangement.show(view, spec, layout); }, view.element, spec?.navigation?.pageId);
            sheets.place(layout, window.innerWidth ?? 390, arrangement.rightEmpty);
            // A new content container is already at the top; setting scrollTop here
            // would force its first layout while the initial view is still mounting.
            if (replacing)
                arrangement.content.scrollTop = 0;
        },
        dispose() { window.removeEventListener("resize", resize); layoutListeners.clear(); edgeSwipe.dispose(); sheets.dismiss(); current?.dispose?.(); element.remove(); },
    };
}
