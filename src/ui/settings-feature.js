import { CURATED_CATEGORY_ICONS, isCuratedCategoryIcon, NOTIFICATION_BANKS } from "../core/index.js";
import { categoryPresentation, isUserAddedMainCategory } from "./category-presentation.js";
import { viewerTokenCreationUrl } from "./connection-model.js";
import { el } from "./dom.js";
import { icon, iconButton } from "./icons.js";
import { automaticCaptureDiagramView, automaticCaptureView, categoriesSettingsView, paymentMethodsView, recurringEntriesView, timeZoneView, aiSettingsView, deviceSettingsView, closingDayControls } from "./settings-pages-view.js";
import { failedSettingRecoveryCopy, merchantRuleRows, newPaymentMethod, paymentMethodOrderPatch, paymentMethodSettingsRows } from "./settings-model.js";
import { WALLET_CAPTURE_SUSPENDED } from "./settings-flags.js";
import { button, categoryBadge, dailyScopeRow, destructiveConfirmation, notice, saveCheck, section, segments, switchRow, syncRecoveryNotice, textAction, writingIndicator } from "./shared-controls.js";
import { cycleRange } from "./overview-model.js";
const settingsRoutes = { "5y": "auto", "5z": "auto", "6a": "cats", "6d": "ai", "6f": "pms", "6fb": "pms", "6fc": "recurring", "6h": "tz", "6i": "device" };
function categoryIconPicker(selected, change, disabled) {
    let active = selected;
    const group = el("div", undefined, "lk-category-icon-grid");
    group.setAttribute("role", "radiogroup");
    group.setAttribute("aria-label", "圖示");
    const options = [];
    const update = () => options.forEach((option, index) => {
        const value = option.dataset.categoryIcon;
        option.setAttribute("aria-checked", String(active === value));
        option.tabIndex = active === value || active === null && index === 0 ? 0 : -1;
    });
    for (const name of CURATED_CATEGORY_ICONS) {
        const option = button("", () => {
            active = active === name ? null : name;
            update();
            change(active);
        }, "lk-category-icon-option");
        option.dataset.categoryIcon = name;
        option.setAttribute("role", "radio");
        option.setAttribute("aria-label", name);
        option.disabled = disabled;
        option.append(icon(name, 20));
        option.addEventListener("keydown", event => {
            if (!(event instanceof KeyboardEvent) || !["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"].includes(event.key))
                return;
            event.preventDefault();
            const index = options.indexOf(option);
            const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1
                : (index + (["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1) + options.length) % options.length;
            active = CURATED_CATEGORY_ICONS[next];
            update();
            change(active);
            options[next].focus();
        });
        options.push(option);
        group.append(option);
    }
    update();
    return group;
}
export function createSettingsFeature(session, shell, options) {
    let page = "main", disposed = false, busy = false, feedback = "", forgetAsk = false;
    let forgetPendingCount = 0;
    let resetting = false;
    let aiDailyOpen = false;
    let methodOrderBusy = false;
    let paymentMethodFocus;
    let paymentMethodFocusRevision = 0;
    let lastWrittenMethods = null;
    const skipped = new Set();
    const aiAttempts = new Map();
    const knownMethods = new Map();
    const walletCaptureSuspended = options.walletCaptureSuspended ?? WALLET_CAPTURE_SUSPENDED;
    const external = options.external ?? (url => { window.location.href = url; });
    const context = () => ({ operationId: options.operationId(), now: options.now() });
    const samePaymentMethods = (left, right) => left.length === right.length &&
        left.every((method, index) => {
            const other = right[index];
            if (!other || method.kind !== other.kind || method.id !== other.id)
                return false;
            if (method.kind === "bank" && other.kind === "bank")
                return method.source === other.source && method.closingDay === other.closingDay;
            if (method.kind === "custom" && other.kind === "custom")
                return method.label === other.label;
            return method.kind === "cash" && other.kind === "cash";
        });
    const paymentMethodsForEdit = () => {
        const current = options.current().preferences.value.paymentMethods;
        if (lastWrittenMethods && samePaymentMethods(current, lastWrittenMethods))
            lastWrittenMethods = null;
        return lastWrittenMethods ?? current;
    };
    const changePaymentMethods = (paymentMethods) => {
        lastWrittenMethods = paymentMethods;
        const pending = options.changePreferences({ paymentMethods });
        const clear = () => { if (lastWrittenMethods === paymentMethods)
            lastWrittenMethods = null; };
        void pending.then(clear, clear);
        return pending;
    };
    const cancelPaymentMethodFocusRestore = () => { paymentMethodFocus = undefined; paymentMethodFocusRevision++; };
    function preservePaymentMethodFocus() {
        const revision = ++paymentMethodFocusRevision;
        if (page !== "pms") {
            paymentMethodFocus = undefined;
            return;
        }
        const active = document.activeElement;
        if (active instanceof HTMLInputElement && active.classList.contains("lk-closing-value")) {
            const row = [...shell.element.querySelectorAll(".lk-payment-setting")].find(item => item.contains(active));
            if (row?.dataset.paymentMethodId)
                paymentMethodFocus = { kind: "closing-day", id: row.dataset.paymentMethodId, source: active,
                    value: active.value, selectionStart: active.selectionStart, selectionEnd: active.selectionEnd };
        }
        else if (active instanceof HTMLElement && active.classList.contains("lk-method-order-handle")) {
            const row = [...shell.element.querySelectorAll(".lk-payment-setting")].find(item => item.contains(active));
            if (row?.dataset.paymentMethodId)
                paymentMethodFocus = { kind: "order", id: row.dataset.paymentMethodId, source: active };
        }
        else if (paymentMethodFocus && active !== paymentMethodFocus.source && active !== document.body && active !== null) {
            paymentMethodFocus = undefined;
        }
        const pending = paymentMethodFocus;
        if (!pending)
            return;
        queueMicrotask(() => {
            if (disposed || page !== "pms" || revision !== paymentMethodFocusRevision || paymentMethodFocus !== pending)
                return;
            const current = document.activeElement;
            if (current !== pending.source && current !== document.body && current !== null) {
                paymentMethodFocus = undefined;
                return;
            }
            const row = [...shell.element.querySelectorAll(".lk-payment-setting")].find(item => item.dataset.paymentMethodId === pending.id);
            paymentMethodFocus = undefined;
            if (pending.kind === "closing-day") {
                const input = row?.querySelector(".lk-closing-value");
                if (!input)
                    return;
                input.value = pending.value;
                const suffix = input.parentElement?.querySelector(".lk-closing-suffix");
                if (suffix)
                    suffix.hidden = pending.value === "";
                input.focus({ preventScroll: true });
                const start = Math.max(0, Math.min(pending.selectionStart ?? pending.value.length, pending.value.length));
                const end = Math.max(start, Math.min(pending.selectionEnd ?? start, pending.value.length));
                input.setSelectionRange(start, end);
            }
            else {
                row?.querySelector(".lk-method-order-handle")?.focus({ preventScroll: true });
            }
        });
    }
    const pushOnLeave = () => { options.push?.(); };
    const back = () => { pushOnLeave(); page = "main"; feedback = ""; forgetAsk = false; options.render(); };
    function notify(copy) { feedback = copy; options.render(); }
    async function resetProgram() {
        if (busy || resetting || session.kind === "demo")
            return;
        resetting = true;
        feedback = "";
        options.render();
        try {
            await options.flush?.();
            if (disposed)
                return;
            const outcome = await options.programReset?.() ?? "unavailable";
            if (outcome === "reloading")
                return;
            resetting = false;
            notify(outcome === "offline" ? "需要網路才能重設程式；帳本與權杖不變" : "這個瀏覽器無法重設程式");
        }
        catch {
            resetting = false;
            if (!disposed)
                notify("這個瀏覽器無法重設程式");
        }
    }
    async function mutate(run, saved, failed) {
        if (busy || session.capability.status !== "writable")
            return;
        busy = true;
        try {
            const outcome = await run();
            if (disposed)
                return;
            if (outcome.status === "confirmed" || outcome.status === "pending") {
                saved();
                await options.refresh();
            }
            else if (outcome.status === "rejected" && outcome.code === "credential-rejected") {
                await options.credentialRejected?.();
                notify("權杖已失效，請更換權杖");
            }
            else {
                failed?.();
                const copy = "沒存到，修改還在";
                const panel = shell.sheets.element.querySelector(".lk-settings-editor");
                if (panel) {
                    panel.querySelector(".lk-notice")?.remove();
                    panel.append(notice(copy, "error"));
                }
                else
                    notify(copy);
            }
        }
        catch {
            failed?.();
            const panel = shell.sheets.element.querySelector(".lk-settings-editor");
            if (panel)
                panel.append(notice("沒存到，修改還在", "error"));
            else
                notify("沒存到，修改還在");
        }
        finally {
            busy = false;
        }
    }
    function openCategory(id) {
        const { result } = options.current();
        const category = result.categories.find(item => item.id === id);
        if (!category)
            return;
        const editor = session.outbox ? session.outbox.ledger().then(ledger => session.commands.at(ledger.snapshot)) : Promise.resolve(session.commands);
        const operation = context();
        let submitted = false;
        let label = category.label, mergeTo = null;
        const iconEditable = isUserAddedMainCategory(result.categories, id);
        let selectedIcon = isCuratedCategoryIcon(category.icon) ? category.icon : null;
        const children = result.categories.filter(item => item.parentId === id);
        const daily = Object.fromEntries([category, ...children].map(item => [item.id, item.includeInDaily !== false]));
        const additions = [];
        let panel;
        const cancel = () => { if (panel && shell.sheets.element.contains(panel))
            shell.sheets.dismiss(); };
        const show = () => {
            const header = el("div", undefined, "lk-sheet-header");
            const name = el("input", undefined, "lk-category-name");
            name.value = label;
            name.setAttribute("aria-label", "名稱");
            name.maxLength = 120;
            name.disabled = submitted || session.capability.status !== "writable";
            name.addEventListener("input", () => { label = name.value; save.disabled = !label.trim() || busy || session.capability.status !== "writable"; });
            const headerBadge = categoryBadge(categoryPresentation(result.categories, id), 40, 21);
            const headerIcon = headerBadge.querySelector(".lk-icon");
            if (iconEditable && headerIcon)
                headerIcon.textContent = selectedIcon ?? "bookmark";
            header.append(headerBadge, name, iconButton("close", "關閉", cancel));
            const element = el("div", undefined, "lk-settings-editor");
            const writable = session.capability.status === "writable" && !submitted;
            if (iconEditable) {
                const icons = el("div", undefined, "lk-category-icon-picker");
                icons.append(el("span", "圖示", "lk-editor-label"), categoryIconPicker(selectedIcon, value => {
                    selectedIcon = value;
                    if (headerIcon)
                        headerIcon.textContent = selectedIcon ?? "bookmark";
                }, !writable));
                element.append(icons);
            }
            element.append(dailyScopeRow(daily[id], () => { daily[id] = !daily[id]; show(); }, !writable));
            if (children.length) {
                const list = el("div", undefined, "lk-category-subsettings");
                for (const child of children) {
                    const row = switchRow(child.label, daily[child.id], () => { daily[child.id] = !daily[child.id]; show(); }, { glyph: "subdirectory_arrow_right", disabled: !writable, className: "lk-category-subrow" });
                    row.insertBefore(icon("home", 16), row.lastChild);
                    list.append(row);
                }
                element.append(list);
            }
            for (const child of additions) {
                const input = el("input", undefined, "lk-settings-input");
                input.value = child.label;
                input.placeholder = "新的子分類";
                input.disabled = !writable;
                input.setAttribute("aria-label", "子分類名稱");
                input.addEventListener("input", () => { child.label = input.value; });
                element.append(input);
            }
            const add = button("", () => { additions.push({ id: `sub-${options.operationId()}`, label: "" }); show(); [...panel.querySelectorAll(".lk-settings-input")].at(-1)?.focus(); }, "lk-add-subcategory");
            add.disabled = !writable;
            add.append(icon("add", 17), el("span", "子分類"));
            element.append(add);
            const targets = el("div", undefined, "lk-chip-wrap");
            for (const target of result.categories.filter(item => item.id !== id && !item.parentId)) {
                const chip = button(target.label, () => { mergeTo = target.id; show(); });
                chip.disabled = !writable;
                chip.setAttribute("aria-pressed", String(mergeTo === target.id));
                targets.append(chip);
            }
            const merge = section("合併到", targets, true);
            merge.classList.add("lk-merge-section");
            merge.querySelector("h2")?.prepend(icon("merge", 17));
            element.append(merge);
            if (mergeTo)
                element.append(notice(`全部移到「${result.categories.find(item => item.id === mergeTo)?.label}」`, "merge"));
            const save = saveCheck(() => {
                if (busy)
                    return;
                submitted = true;
                const input = { id, label: label.trim(), daily: { ...daily }, additions: additions.filter(item => item.label.trim()).map(item => ({ ...item, label: item.label.trim() })), mergeTo,
                    ...(iconEditable ? { icon: selectedIcon } : {}), expectedObjectId: result.ruleRevision };
                show();
                void mutate(async () => (await editor).editCategory(operation, input), cancel, () => { submitted = false; show(); });
            }, session.capability.status !== "writable" || !label.trim(), "儲存", true);
            header.insertBefore(save, header.lastChild);
            panel = element;
            shell.sheets.open({ title: "編輯分類", swipe: "rubber-band", origin: "right", header, view: { element }, close: cancel });
        };
        show();
    }
    function openRule(id) {
        const { result } = options.current();
        const rule = merchantRuleRows(result.userRules).find(item => item.id === id);
        if (!rule)
            return;
        const editor = session.outbox ? session.outbox.ledger().then(ledger => session.commands.at(ledger.snapshot)) : Promise.resolve(session.commands);
        let selected = rule.categoryId, ask = false, writing = null, error = "";
        let panel;
        let attempt;
        const deletion = context(), cancel = () => { if (!busy && panel && shell.sheets.element.contains(panel))
            shell.sheets.dismiss(); };
        const save = async (categoryId) => {
            if (busy || categoryId === selected || session.capability.status !== "writable")
                return;
            const previous = selected;
            if (!attempt || attempt.categoryId !== categoryId)
                attempt = { categoryId, operation: context(), revision: options.current().result.ruleRevision };
            busy = true;
            writing = categoryId;
            selected = categoryId;
            error = "";
            show();
            try {
                const outcome = await (await editor).editUserRules(attempt.operation, { kind: "brandCategory", brandId: id, categoryId }, attempt.revision);
                if (disposed)
                    return;
                if (outcome.status === "confirmed" || outcome.status === "pending") {
                    attempt = undefined;
                    shell.sheets.dismiss();
                    await options.refresh();
                }
                else {
                    selected = previous;
                    if (outcome.status === "rejected" && outcome.code === "credential-rejected")
                        await options.credentialRejected?.();
                    error = outcome.status === "rejected" && outcome.code === "credential-rejected" ? "權杖已失效，請更換權杖" : "沒存到，修改還在";
                }
            }
            catch {
                selected = previous;
                error = "沒存到，修改還在";
            }
            finally {
                busy = false;
                writing = null;
                if (!disposed && panel && shell.sheets.element.contains(panel))
                    show();
            }
        };
        const show = () => {
            const element = el("div", undefined, "lk-settings-editor");
            const writable = session.capability.status === "writable" && !busy;
            const alias = el("span", undefined, "lk-rule-alias");
            alias.append(icon("notifications", 15), el("span", rule.aliases.join("、")));
            element.append(alias);
            const grid = el("div", undefined, "lk-rule-category-grid");
            for (const category of result.categories.filter(item => !item.parentId)) {
                const item = button("", () => { void save(category.id); }, "lk-rule-category-option");
                item.disabled = !writable || ask;
                item.setAttribute("aria-pressed", String(category.id === (result.categories.find(item => item.id === selected)?.parentId ?? selected)));
                item.setAttribute("aria-busy", String(writing === category.id));
                item.append(writing === category.id ? writingIndicator(32) : categoryBadge(categoryPresentation(result.categories, category.id), 32, 17), el("span", category.label));
                grid.append(item);
            }
            element.append(grid, el("span", `${result.merchantRuleImpact[id] ?? 0} 筆會改分類`, "lk-rule-impact"));
            const header = el("div", undefined, "lk-sheet-header");
            header.append(el("h2", rule.label, "lk-sheet-title"), iconButton("close", "關閉", cancel));
            if (ask)
                element.append(destructiveConfirmation("刪除這條規則？", "紀錄會依其他規則或 AI 建議分類", "刪除", () => { if (!busy) {
                    ask = false;
                    show();
                } }, () => {
                    if (busy)
                        return;
                    void mutate(() => session.commands.editUserRules(deletion, { kind: "brandCategoryDelete", brandId: id }, options.current().result.ruleRevision), () => shell.sheets.dismiss());
                }));
            else {
                const remove = button("", () => { ask = true; show(); }, "lk-forget-action lk-rule-delete");
                remove.disabled = !writable;
                remove.append(icon("delete", 18), el("span", "刪除"));
                element.append(remove);
            }
            if (error)
                element.append(notice(error, "error"));
            panel = element;
            shell.sheets.open({ title: rule.label, swipe: "close", origin: "right", header, view: { element }, close: cancel });
        };
        show();
    }
    function openNewMethod() {
        const { picker } = options.current();
        const added = new Set(picker.methods.map(method => method.id));
        const banks = NOTIFICATION_BANKS.filter(bank => !added.has(bank.id));
        let draft = { bankId: null, custom: "", source: "bank-app", closingDay: null };
        let panel;
        const operation = context();
        const cancel = () => { if (panel && shell.sheets.element.contains(panel)) {
            pushOnLeave();
            shell.sheets.dismiss();
        } };
        const show = (focusName = false) => {
            const element = el("div", undefined, "lk-settings-editor");
            if (banks.length) {
                const list = el("div", undefined, "lk-new-bank-list");
                for (const bank of banks) {
                    const row = button("", () => { draft = { ...draft, bankId: draft.bankId === bank.id ? null : bank.id, custom: "", source: bank.sources[0] }; show(); }, "lk-new-bank-option");
                    row.setAttribute("aria-pressed", String(bank.id === draft.bankId));
                    row.append(icon(bank.id === draft.bankId ? "radio_button_checked" : "radio_button_unchecked", 21, bank.id === draft.bankId), el("span", bank.label));
                    list.append(row);
                }
                const bankSection = section("可讀取通知的銀行", list, true);
                bankSection.querySelector("h2")?.prepend(icon("notifications", 16));
                if (draft.bankId) {
                    const bank = banks.find(item => item.id === draft.bankId);
                    const settings = el("div", undefined, "lk-new-bank-settings");
                    if (!walletCaptureSuspended)
                        settings.append(segments(["bank-app", "wallet"].map(source => ({ label: source === "bank-app" ? "銀行 App" : "Wallet", selected: draft.source === source, disabled: !bank.sources.includes(source),
                            run: () => { draft.source = source; show(); } }))));
                    settings.append(closingDayControls(draft.closingDay, "", day => { draft.closingDay = day; }, session.capability.status !== "writable"));
                    bankSection.append(settings);
                }
                element.append(bankSection);
            }
            const input = el("input", undefined, "lk-settings-input");
            input.placeholder = "名稱";
            input.setAttribute("aria-label", "名稱");
            input.maxLength = 40;
            input.value = draft.custom;
            input.addEventListener("input", () => { draft.custom = input.value; if (draft.bankId) {
                draft.bankId = null;
                show(true);
            } save.disabled = !newPaymentMethod(draft, `pm-${operation.operationId}`); });
            const suggestions = el("div", undefined, "lk-chip-wrap");
            for (const label of ["悠遊卡", "一卡通", "LINE Pay", "街口支付"].filter(label => !picker.methods.some(method => method.label === label))) {
                const chip = button(label, () => { draft.custom = label; draft.bankId = null; show(); });
                chip.setAttribute("aria-pressed", String(label === draft.custom));
                suggestions.append(chip);
            }
            const custom = el("div", undefined, "lk-new-custom");
            const title = el("span", undefined, "lk-editor-label");
            title.append(icon("edit", 16), el("span", "自訂"));
            custom.append(title, input, suggestions);
            element.append(custom);
            const save = saveCheck(() => {
                const method = newPaymentMethod(draft, `pm-${operation.operationId}`);
                if (!method || busy)
                    return;
                busy = true;
                void changePaymentMethods([...paymentMethodsForEdit(), method]).then(outcome => {
                    const status = outcome?.status;
                    if (["confirmed", "pending"].includes(status ?? ""))
                        cancel();
                    else
                        element.append(notice("沒存到，修改還在", "error"));
                }).finally(() => { busy = false; });
            }, !newPaymentMethod(draft, `pm-${operation.operationId}`), "新增");
            element.append(save);
            panel = element;
            shell.sheets.open({ title: "新增付款方式", swipe: "rubber-band", origin: "right", view: { element }, close: cancel });
            if (focusName) {
                input.focus();
                input.setSelectionRange(input.value.length, input.value.length);
            }
        };
        show();
    }
    async function retention(kind) {
        if (busy || !session.deviceRetention)
            return;
        const state = session.deviceRetention.read();
        if (!state[kind]) {
            const element = el("div", undefined, "lk-settings-editor");
            element.append(notice(kind === "credential" ? "這個網站和拿到這支解鎖手機的人都能使用權杖；權杖可寫入時也能修改整個儲存庫" : "這個網站和拿到這支解鎖手機的人都能讀取保留的帳本", kind === "credential" ? "key" : "cloud_download"), textAction("同意保留", () => { shell.sheets.dismiss(); void applyRetention(kind, true); }));
            shell.sheets.open({ title: kind === "credential" ? "記住權杖" : "離線保留帳本", swipe: "close", origin: "right", view: { element }, close: () => shell.sheets.dismiss() });
            return;
        }
        await applyRetention(kind, false);
    }
    async function applyRetention(kind, value) {
        busy = true;
        options.render();
        let cancelled = false;
        const confirmDiscard = (count) => new Promise(resolve => {
            const element = el("div", undefined, "lk-settings-editor");
            let settled = false;
            const settle = (accepted) => { if (settled)
                return; settled = true; cancelled = !accepted; resolve(accepted); };
            const finish = (accepted) => { settle(accepted); shell.sheets.dismiss(); };
            element.append(destructiveConfirmation("關閉保留帳本？", `還有 ${count} 筆變更待同步，關閉後會捨棄。GitHub 上的帳本不變`, "關閉並捨棄", () => finish(false), () => finish(true)));
            shell.sheets.open({ title: "關閉保留帳本", swipe: "close", origin: "right", view: { element, dispose: () => settle(false) }, close: () => finish(false) });
        });
        try {
            const applied = kind === "ledger" ? await session.deviceRetention.ledger(value, confirmDiscard) : await session.deviceRetention.credential(value);
            if (!applied && !cancelled)
                feedback = "無法變更保留設定，請在瀏覽器網站資料設定中檢查";
        }
        catch {
            feedback = "無法變更保留設定，請在瀏覽器網站資料設定中檢查";
        }
        finally {
            busy = false;
            if (!disposed)
                options.render();
        }
    }
    async function askForget() {
        if (busy)
            return;
        busy = true;
        try {
            forgetPendingCount = (await session.outbox?.store.read())?.length ?? 0;
            forgetAsk = true;
        }
        catch {
            feedback = "無法讀取待同步變更，請稍後再試";
        }
        finally {
            busy = false;
            if (!disposed)
                options.render();
        }
    }
    async function forget() {
        if (busy)
            return;
        busy = true;
        try {
            const forgotten = await session.forget(count => {
                if (count <= forgetPendingCount)
                    return true;
                forgetPendingCount = count;
                return false;
            });
            if (forgotten !== false)
                options.forgotten?.();
        }
        catch {
            feedback = "無法完整清除，請在瀏覽器網站資料設定中清除此來源資料";
        }
        finally {
            busy = false;
            if (!disposed)
                options.render();
        }
    }
    function openAutomationInstructions(apps) {
        shell.sheets.open({ title: "通知自動化", swipe: "close", origin: "right", dismissOnBackdrop: true,
            view: automaticCaptureDiagramView(apps, () => external("shortcuts://")), close: () => shell.sheets.dismiss() });
    }
    function view() {
        preservePaymentMethodFocus();
        if (page === "main")
            return null;
        const { result, preferences, picker, organization, failedSettings = [] } = options.current();
        let rendered;
        if (page === "auto")
            rendered = automaticCaptureView(result, picker, back, (step, apps) => {
                if (step === "token")
                    external(viewerTokenCreationUrl({ name: "LedgerNook Writer", description: "LedgerNook Writer on this iPhone" }));
                else if (step === "revoke")
                    external("https://github.com/settings/personal-access-tokens");
                else if (step === "shortcuts")
                    external("shortcuts://");
                else if (step === "automation")
                    openAutomationInstructions(apps);
                else if (step === "addPaymentMethod") {
                    page = "pms";
                    feedback = "";
                    options.render();
                    openNewMethod();
                }
            }, walletCaptureSuspended);
        else if (page === "cats")
            rendered = categoriesSettingsView(result, back, openCategory, openRule);
        else if (page === "recurring")
            rendered = recurringEntriesView(result, back, options.open);
        else if (page === "pms") {
            for (const method of picker.methods)
                knownMethods.set(method.id, method);
            const enabled = new Set(paymentMethodsForEdit().map(method => method.id));
            const methods = paymentMethodSettingsRows(picker.methods, [...knownMethods.values()]).map(method => {
                const group = result.billingCycleSpending.groups.find(group => group.bankId === method.id);
                return { ...method, enabled: enabled.has(method.id), sources: NOTIFICATION_BANKS.find(bank => bank.id === method.id)?.sources ?? [],
                    range: group && method.kind === "bank" && method.closingDay ? cycleRange(group.period.from, group.period.to, result.asOf) : "" };
            });
            const ledgerMethod = (method) => method.kind === "bank"
                ? { kind: "bank", id: method.id, source: method.source, ...(method.closingDay ? { closingDay: method.closingDay } : {}) }
                : method.kind === "cash" ? { kind: "cash", id: "cash" } : { kind: "custom", id: method.id, label: method.label };
            const patchMethod = (id, patch) => {
                const paymentMethods = paymentMethodsForEdit();
                const enabled = new Set(paymentMethods.map(method => method.id));
                const old = knownMethods.get(id);
                if (!old || old.kind !== "bank")
                    return;
                const current = paymentMethods.find(method => method.id === id);
                const base = current?.kind === "bank" ? current : old;
                const { closingDay: _oldClosingDay, ...rest } = old;
                const { closingDay: _currentClosingDay, ...baseWithoutClosingDay } = base;
                const next = { ...rest, ...baseWithoutClosingDay, ...patch };
                knownMethods.set(id, next);
                if (enabled.has(id))
                    void changePaymentMethods(paymentMethods.map(method => method.id === id ? ledgerMethod(next) : method));
                else
                    options.render();
            };
            rendered = paymentMethodsView(methods, back, {
                toggle: id => {
                    const paymentMethods = paymentMethodsForEdit();
                    const enabled = new Set(paymentMethods.map(method => method.id));
                    if (enabled.has(id) && enabled.size === 1)
                        return;
                    void changePaymentMethods(enabled.has(id) ? paymentMethods.filter(method => method.id !== id) : [...paymentMethods, ledgerMethod(knownMethods.get(id))]);
                },
                source: (id, source) => {
                    const current = paymentMethodsForEdit().find(method => method.id === id);
                    patchMethod(id, { source, ...(current?.kind === "bank" && current.closingDay ? { closingDay: current.closingDay } : {}) });
                },
                closing: (id, day) => patchMethod(id, day ? { closingDay: day } : {}), add: openNewMethod,
                reorderDisabled: methodOrderBusy, writable: session.capability.status === "writable",
                reorder: async (ids, focusId) => {
                    const patch = paymentMethodOrderPatch(paymentMethodsForEdit(), ids);
                    if (!patch || methodOrderBusy)
                        return;
                    const scrollHost = rendered.element.closest(".lk-layout-secondary, .lk-content");
                    const scrollTop = scrollHost?.scrollTop ?? 0;
                    methodOrderBusy = true;
                    try {
                        const outcome = await changePaymentMethods(patch.paymentMethods);
                        if (outcome?.code === "credential-rejected")
                            await options.credentialRejected?.();
                        if (!disposed && !["confirmed", "pending"].includes(outcome?.status ?? "")) {
                            feedback = outcome?.status === "conflict" ? "帳本已變更，請重新開啟確認"
                                : outcome?.code === "credential-rejected" ? "權杖已失效，請更換權杖" : "偏好未儲存";
                        }
                    }
                    catch {
                        if (!disposed)
                            feedback = "偏好未儲存";
                    }
                    finally {
                        methodOrderBusy = false;
                        if (!disposed) {
                            options.render();
                            if (page === "pms") {
                                if (scrollHost)
                                    scrollHost.scrollTop = scrollTop;
                                if (focusId)
                                    shell.element.querySelector(`[data-payment-method-id="${focusId}"] .lk-method-order-handle`)?.focus({ preventScroll: true });
                            }
                        }
                    }
                },
            }, walletCaptureSuspended);
        }
        else if (page === "tz")
            rendered = timeZoneView(preferences.reportingTimeZone, options.now(), back, zone => {
                if (zone !== preferences.reportingTimeZone)
                    void options.changePreferences({ reportingTimeZone: zone }).then(outcome => {
                        const status = outcome?.status;
                        notify(["confirmed", "pending"].includes(status ?? "") ? "報表已更新" : "偏好未儲存");
                    });
            }, session.capability.status === "writable");
        else if (page === "ai")
            rendered = aiSettingsView(result, organization, skipped, { model: preferences.value.organiserModel, dailyOpen: aiDailyOpen }, back, {
                model: value => { void options.changePreferences({ organiserModel: value }); },
                run: () => { external(`shortcuts://run-shortcut?name=${encodeURIComponent("LedgerNook 整理分類")}&input=text&text=${result.asOf.slice(0, 7)}`); notify("整理完成後同步帳本"); },
                toggleDaily: () => { aiDailyOpen = !aiDailyOpen; options.render(); }, openShortcuts: () => external("shortcuts://"),
                accept: hash => { const attempt = aiAttempts.get(hash) ?? context(); aiAttempts.set(hash, attempt); void mutate(() => session.commands.acceptAiSuggestion(attempt, hash), () => { skipped.add(hash); aiAttempts.delete(hash); }); },
                skip: hash => { skipped.add(hash); options.render(); },
            }, session.capability.status === "writable");
        else {
            const state = session.deviceRetention?.read() ?? { credential: false, ledger: session.persistence === "retained" };
            rendered = deviceSettingsView({ ...state, appearance: options.appearance?.get() ?? "system", ask: forgetAsk, pendingCount: forgetPendingCount, busy, demo: session.kind === "demo", buildId: options.buildId ?? "development", resetting }, back, {
                appearance: value => { options.appearance?.set(value); options.render(); }, credential: () => { void retention("credential"); }, ledger: () => { void retention("ledger"); },
                ask: () => { void askForget(); }, cancel: () => { forgetAsk = false; options.render(); }, forget: () => { void forget(); },
                reset: () => { void resetProgram(); },
            });
        }
        const pageTarget = {
            cats: "categoriesRules", pms: "paymentMethods", tz: "reportingTimeZone", ai: "organiserModel",
        };
        const target = pageTarget[page];
        const pageFailures = target ? failedSettings.filter(item => item.target === target) : [];
        if (pageFailures.length) {
            const children = Array.from(rendered.element.children);
            const recoveries = pageFailures.map(failure => syncRecoveryNotice(failedSettingRecoveryCopy(failure.target), session.capability.status === "writable", {
                resend: () => options.recover?.(failure.operationId, "resend"),
                discard: () => options.recover?.(failure.operationId, "discard"),
            }));
            rendered.element.replaceChildren(...children.slice(0, 1), ...recoveries, ...children.slice(1));
        }
        if (feedback)
            rendered.element.append(notice(feedback, "info"));
        return rendered;
    }
    function reset() { cancelPaymentMethodFocusRestore(); pushOnLeave(); page = "main"; forgetAsk = false; feedback = ""; }
    return { view, reset, get pageId() {
            return ({ main: null, auto: "5y", cats: "6a", ai: "6d", pms: "6f", recurring: "6fc", tz: "6h", device: "6i" })[page];
        }, handles(route) { return route in settingsRoutes; }, open(route) {
            const routes = settingsRoutes;
            if (!routes[route])
                return false;
            if (page !== routes[route]) {
                cancelPaymentMethodFocusRestore();
                pushOnLeave();
            }
            page = routes[route];
            if (route === "6d")
                aiDailyOpen = false;
            feedback = "";
            options.render();
            return true;
        }, leave: reset, dispose() { cancelPaymentMethodFocusRestore(); disposed = true; knownMethods.clear(); skipped.clear(); aiAttempts.clear(); } };
}
