import { categoryPresentation } from "./category-presentation.js";
import { manualCommand, manualDateLabel } from "./manual-entry-model.js";
import { shiftDate } from "./ledger-format.js";
import { currencyScale } from "../core/index.js";
import { el } from "./dom.js";
import { icon, saveCheckIcon } from "./icons.js";
import { button, categoryBadge, nativeDateInput, segments, writingIndicator } from "./shared-controls.js";
import { readOnlyReasonCopy } from "./readonly-reason-view.js";
export function manualEntryView(draft, categories, picker, today, state, actions, earliest = today) {
    const element = el("div", undefined, "lk-manual-entry lk-feature-view");
    if (!state.writable) {
        element.classList.add("lk-manual-readonly");
        const card = el("div", undefined, "lk-card lk-entry-readonly");
        const title = el("div");
        title.append(icon("lock", 21), el("span", "唯讀，無法新增"));
        const needsRetention = state.capability?.status === "read-only" && state.capability.reason === "ledger-not-retained";
        card.append(title);
        card.append(el("p", readOnlyReasonCopy(state.capability), "lk-readonly-copy"));
        card.append(button(needsRetention ? "開啟保留帳本" : "重新檢查寫入權限", () => actions.later(needsRetention ? "6i" : "6p"), "lk-text-action lk-action-secondary"));
        element.append(card);
        return { element };
    }
    if (draft.notification) {
        element.classList.add("lk-manual-from-unrecorded");
        const source = el("div", undefined, "lk-entry-source");
        source.setAttribute("aria-label", "從未記錄的通知補記");
        source.append(icon("notification_important", 17), el("span", draft.notification.merchant ?? draft.notification.source), el("span", draft.notification.meta, "lk-number"));
        element.append(source);
    }
    const amount = el("div", undefined, "lk-entry-amount");
    const currency = button(draft.currency, actions.currency, "lk-currency lk-number");
    currency.setAttribute("aria-label", "幣別");
    const value = el("input", undefined, "lk-entry-value lk-number");
    value.type = "text";
    value.inputMode = "none";
    value.readOnly = true;
    value.setAttribute("aria-label", "金額");
    const [whole, fraction] = draft.amount.split(".");
    value.value = `${Number(whole || 0).toLocaleString("en-US")}${draft.amount.includes(".") ? `.${fraction ?? ""}` : ""}`;
    value.dataset.zero = String(!Number(draft.amount));
    amount.append(currency, value, el("span", undefined, "lk-entry-caret"));
    element.append(amount);
    const grid = el("div", undefined, "lk-entry-categories");
    for (const category of categories.filter(item => item.parentId === undefined)) {
        const selected = draft.categoryId === category.id || categories.find(item => item.id === draft.categoryId)?.parentId === category.id;
        const item = button("", () => actions.change({ categoryId: selected ? null : category.id }), "lk-entry-category");
        item.setAttribute("aria-pressed", String(selected));
        const presentation = categoryPresentation(categories, category.id);
        item.append(categoryBadge({ ...presentation, color: selected ? presentation.color : "var(--cat-idle)" }, 32, 18), el("span", category.label));
        grid.append(item);
    }
    element.append(grid);
    const selectedCategory = grid.querySelector('.lk-entry-category[aria-pressed="true"]');
    if (selectedCategory)
        requestAnimationFrame(() => {
            if (!grid.isConnected)
                return;
            const gridBox = grid.getBoundingClientRect(), selectedBox = selectedCategory.getBoundingClientRect();
            if (selectedBox.top < gridBox.top)
                grid.scrollTop -= gridBox.top - selectedBox.top;
            else if (selectedBox.bottom > gridBox.bottom)
                grid.scrollTop += selectedBox.bottom - gridBox.bottom;
        });
    const subs = el("div", undefined, "lk-entry-subslot");
    const mainId = categories.find(item => item.id === draft.categoryId)?.parentId ?? draft.categoryId;
    const children = categories.filter(item => item.parentId === mainId);
    if (children.length)
        for (const category of [{ id: mainId, label: "不指定" }, ...children]) {
            const chip = button(category.label, () => actions.change({ categoryId: category.id }));
            chip.setAttribute("aria-pressed", String(category.id === draft.categoryId));
            subs.append(chip);
        }
    element.append(subs);
    element.append(paymentMethodChoices(picker, draft.paymentMethodId, id => actions.change({ paymentMethodId: id })));
    const dates = ["今天", "昨天", "前天"].map((label, index) => ({ label, selected: draft.date === shiftDate(today, -index), run: () => actions.change({ date: shiftDate(today, -index) }) }));
    const early = draft.date < shiftDate(today, -2), dateSegments = segments(dates);
    const earlier = el("label", early ? manualDateLabel(draft.date, today) : "更早", "lk-segment lk-segment-date");
    earlier.setAttribute("aria-pressed", String(early));
    const dateInput = nativeDateInput(draft.date, earliest <= today ? earliest : today, today, "更早", actions.date);
    dateInput.disabled = !!state.locked || state.saveState === "saving";
    earlier.append(dateInput);
    dateSegments.append(earlier);
    element.append(dateSegments);
    const extra = el("div", undefined, "lk-entry-extras");
    const note = button("", actions.note, "lk-entry-extra");
    note.setAttribute("aria-label", "備註");
    note.append(icon("edit_note", 18), el("span", draft.notes.split("\n")[0] || "備註"));
    extra.append(note);
    const project = button("", actions.project, "lk-entry-extra");
    project.setAttribute("aria-label", "專案");
    project.append(icon("luggage", 18), el("span", draft.projectId ? state.projectLabel ?? "專案" : "專案"));
    extra.append(project);
    element.append(extra);
    const keypad = el("div", undefined, "lk-keypad");
    const remove = button("", () => actions.key("delete"), "lk-key lk-key-delete");
    remove.setAttribute("aria-label", "刪除");
    remove.append(icon("backspace", 22));
    const save = button("", actions.save, "lk-key lk-key-save");
    const saveLabel = state.saveState === "saving" ? "寫入中" : state.saveState === "failed" ? "重試" : "記一筆";
    save.setAttribute("aria-label", saveLabel);
    save.dataset.state = state.saveState;
    save.disabled = state.saveState === "saving" || !draft.paymentMethodId || manualCommand(draft).input.amountMinor === 0;
    save.append(state.saveState === "saving" ? writingIndicator(44) : state.saveState === "failed" ? icon("refresh", 44) : saveCheckIcon());
    keypad.append(remove, save);
    for (const key of ["1", "2", "3", "4", "5", "6", "7", "8", "9", draft.currency !== "TWD" && currencyScale(draft.currency) ? "." : "", "0", ""]) {
        const node = button(key, () => actions.key(key), "lk-key");
        if (!key) {
            node.style.visibility = "hidden";
            node.tabIndex = -1;
        }
        keypad.append(node);
    }
    element.append(keypad);
    if (state.locked || state.saveState === "saving")
        element.querySelectorAll("button:not(.lk-key-save)").forEach(control => { control.disabled = true; });
    return { element };
}
/** The turned-on methods in preference order, shared by entry and correction. */
export function paymentMethodChoices(picker, selectedId, select) {
    const methods = el("div", undefined, "lk-entry-methods");
    methods.setAttribute("aria-label", "付款方式");
    for (const method of picker.methods) {
        const chip = button(method.label, () => select(method.id));
        chip.setAttribute("aria-pressed", String(method.id === selectedId));
        methods.append(chip);
    }
    return methods;
}
export function manualNoteSheet(initial, save) {
    const element = el("div", undefined, "lk-manual-note-editor");
    const value = el("input", undefined, "lk-manual-note-input");
    value.type = "text";
    value.value = initial;
    value.placeholder = "備註";
    value.setAttribute("aria-label", "備註");
    const confirm = button("", () => save(value.value.trim()), "lk-manual-sheet-check");
    confirm.setAttribute("aria-label", "儲存");
    confirm.append(saveCheckIcon());
    element.append(value, confirm);
    return { element };
}
export function manualProjectSheet(projects, selectedId, select) {
    const element = el("div", undefined, "lk-manual-project-list");
    const options = [
        { id: null, label: "無專案" }, ...projects.filter(project => !project.archived).map(project => ({ id: project.id, label: project.label })),
    ];
    for (const [index, option] of options.entries()) {
        const row = button("", () => select(option.id), "lk-manual-project-option");
        row.setAttribute("aria-pressed", String(option.id === selectedId));
        row.append(icon(option.id === selectedId ? "radio_button_checked" : "radio_button_unchecked", 20, option.id === selectedId), el("span", option.label));
        if (index < options.length - 1)
            row.classList.add("lk-manual-project-separated");
        element.append(row);
    }
    return { element };
}
