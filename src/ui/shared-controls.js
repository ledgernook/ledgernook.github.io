import { dayLabel } from "./ledger-format.js";
import { el } from "./dom.js";
import { icon, iconButton } from "./icons.js";
import { syncRecoveryCopy } from "./sync-recovery-copy.js";
/** The grouped period control shared with a payment method's spending page. */
export function periodStepRow(label, step, options) {
    const row = el("div", undefined, "lk-project-period-row lk-method-period-row");
    const previous = iconButton("chevron_left", "上一期", () => step(-1));
    previous.disabled = options.previousEnabled === false;
    const next = iconButton("chevron_right", "下一期", () => step(1));
    next.disabled = !options.nextEnabled;
    row.append(previous, el("span", label, "lk-project-period lk-project-total-period lk-method-period"), next);
    return row;
}
export function button(label, run, className = "lk-chip") {
    const node = el("button", label, className);
    node.type = "button";
    node.addEventListener("click", run);
    return node;
}
const deferredNativeDateRenders = new WeakMap();
const deferredNativeDateListeners = new WeakSet();
/** Keep a native date field mounted while its platform picker owns focus. */
export function deferNativeDateRender(container, render) {
    const focused = document.activeElement;
    if (!(focused instanceof HTMLInputElement) || focused.type !== "date" ||
        !focused.classList.contains("lk-native-date-input") || !container.contains(focused))
        return false;
    let renders = deferredNativeDateRenders.get(focused);
    if (!renders) {
        renders = new Map();
        deferredNativeDateRenders.set(focused, renders);
    }
    renders.set(container, render);
    if (!deferredNativeDateListeners.has(focused)) {
        deferredNativeDateListeners.add(focused);
        focused.addEventListener("blur", () => {
            queueMicrotask(() => {
                const pending = deferredNativeDateRenders.get(focused);
                if (!pending)
                    return;
                deferredNativeDateRenders.delete(focused);
                for (const [owner, rerender] of pending) {
                    if (focused.isConnected !== false && owner.contains(focused))
                        rerender();
                }
            });
        });
    }
    return true;
}
export function nativeDateInput(value, min, max, label, change) {
    const input = el("input");
    input.type = "date";
    input.value = value;
    input.min = min;
    input.max = max;
    input.className = "lk-native-date-input";
    input.setAttribute("aria-label", label);
    let applied = value, pending = value;
    const clampPending = () => {
        if (!input.value) {
            input.value = applied;
            pending = applied;
            return null;
        }
        pending = input.value < min ? min : input.value > max ? max : input.value;
        input.value = pending;
        return pending;
    };
    const applyPending = () => {
        const next = clampPending();
        if (next === null || next === applied)
            return;
        applied = next;
        change(next);
    };
    const track = () => {
        if (clampPending() === null)
            return;
        if (document.activeElement !== input)
            applyPending();
    };
    input.addEventListener("input", track);
    input.addEventListener("change", track);
    input.addEventListener("blur", applyPending);
    return input;
}
export function switchTrack(on) {
    const track = el("span", undefined, "lk-switch");
    track.dataset.on = String(on);
    track.setAttribute("aria-hidden", "true");
    track.append(el("span"));
    return track;
}
export function switchRow(label, on, run, options = {}) {
    const row = button("", run, options.className ?? "lk-switch-row");
    row.setAttribute("role", "switch");
    row.setAttribute("aria-label", label);
    row.setAttribute("aria-checked", String(on));
    row.disabled = options.disabled === true;
    if (options.glyph)
        row.append(icon(options.glyph, 20));
    const copy = el("span", undefined, "lk-switch-copy");
    copy.append(el("span", label));
    if (options.detail !== undefined)
        copy.append(el("span", options.detail, "lk-muted"));
    row.append(copy, switchTrack(on));
    return row;
}
/** Shared by category and project edit sheets; one consistent daily-scope row. */
export function dailyScopeRow(on, run, disabled = false) {
    return switchRow("計入日常", on, run, { glyph: "home", disabled, className: "lk-switch-row lk-daily-scope-row" });
}
export function saveCheck(run, disabled = false, label = "儲存", compact = false) {
    const control = button("", run, compact ? "lk-save-check lk-save-check-compact" : "lk-save-check");
    control.setAttribute("aria-label", label);
    control.disabled = disabled;
    control.append(icon("check", compact ? 20 : 24));
    return control;
}
export function writingIndicator(size) {
    const mark = icon("progress_activity", size);
    mark.classList.add("lk-writing-state");
    mark.removeAttribute("aria-hidden");
    mark.setAttribute("role", "status");
    mark.setAttribute("aria-label", "寫入中");
    return mark;
}
export function destructiveConfirmation(title, copy, action, cancel, confirm) {
    const node = el("div", undefined, "lk-destructive-confirmation");
    const heading = el("span", undefined, "lk-destructive-title");
    heading.append(icon("delete", 19), el("span", title));
    const actions = el("div", undefined, "lk-confirm-actions");
    actions.append(textAction("取消", cancel, "secondary"), button(action, confirm, "lk-text-action lk-action-danger"));
    node.append(heading, el("span", copy), actions);
    return node;
}
export function textAction(label, run, tone = "primary") {
    return button(label, run, `lk-text-action lk-action-${tone}`);
}
export function notice(copy, glyph) {
    const node = el("div", undefined, "lk-notice lk-icon-notice");
    node.setAttribute("role", "alert");
    node.append(icon(glyph, 17), el("span", copy));
    return node;
}
export function syncRecoveryNotice(copy, writable, actions) {
    const node = el("div", undefined, "lk-notice lk-sync-recovery");
    node.setAttribute("role", "alert");
    const message = el("div", undefined, "lk-sync-recovery-copy");
    message.append(icon("error", 17), el("span", copy));
    node.append(message);
    if (writable) {
        const controls = el("div", undefined, "lk-sync-recovery-actions");
        controls.append(button("重送", () => actions.resend?.(), "lk-chip"), button("捨棄", () => actions.discard?.(), "lk-chip"));
        node.append(controls);
    }
    return node;
}
export function aiPendingNotice(confirm, writable, busy = false) {
    const node = el("div", undefined, "lk-notice lk-icon-notice lk-ai-pending-notice");
    node.setAttribute("role", "note");
    node.append(icon("auto_fix_high", 17), el("span", "AI 記帳 · 待確認"));
    const action = button("確認", confirm, "lk-ai-confirm");
    action.disabled = !writable || busy;
    node.append(action);
    return node;
}
export function categoryBadge(category, size = 30, glyphSize = 17) {
    const badge = el("span", undefined, "lk-category-badge");
    badge.style.width = `${size}px`;
    badge.style.height = `${size}px`;
    badge.style.background = category.color;
    badge.append(icon(category.icon, glyphSize));
    return badge;
}
export function section(title, content, settings = false, aside) {
    const node = el("section", undefined, settings ? "lk-settings-section" : "lk-section");
    const heading = el("h2", title);
    if (aside) {
        const header = el("div", undefined, "lk-section-header");
        header.append(heading, aside);
        node.append(header);
    }
    else
        node.append(heading);
    node.append(content);
    return node;
}
export function segments(options) {
    const node = el("div", undefined, "lk-segments");
    for (const option of options) {
        const control = button(option.label, option.run, "lk-segment");
        control.setAttribute("aria-pressed", String(option.selected));
        control.disabled = option.disabled === true;
        control.setAttribute("aria-disabled", String(control.disabled));
        node.append(control);
    }
    return node;
}
/** The project-list segment pattern, shared by record lists without changing its skin. */
export function listSortControl(sort, run, label, dateLabel = "日期") {
    const control = segments([
        { label: dateLabel, selected: sort === "date", run: () => run("date") },
        { label: "金額", selected: sort === "amount", run: () => run("amount") },
    ]);
    control.setAttribute("role", "group");
    control.setAttribute("aria-label", label);
    control.classList.add("lk-project-sort");
    return control;
}
export function dayHeader(container, date, asOf, first, label = dayLabel(date, asOf)) {
    const header = el("div", label, "lk-date-group");
    header.setAttribute("role", "heading");
    header.setAttribute("aria-level", "3");
    const isFirst = first ?? (container.querySelector(".lk-date-group") === null);
    header.setAttribute("data-first", String(isFirst));
    container.append(header);
    return header;
}
export function recordList(rows, actions, options = {}) {
    const list = el("div", undefined, "lk-card lk-record-list");
    const hasNoteColumn = rows.some(row => row.quick);
    if (hasNoteColumn)
        list.setAttribute("data-note-column", "true");
    let previousDate = null;
    let hasDayHeader = false;
    for (const row of rows) {
        const newDate = options.grouped !== false && row.date !== previousDate;
        if (newDate) {
            dayHeader(list, row.date, options.asOf, !hasDayHeader, options.dateLabel?.(row.date));
            hasDayHeader = true;
        }
        const item = el("div", undefined, "lk-record-row");
        item.setAttribute("data-record-id", row.record.id);
        if (row.syncState)
            item.setAttribute("data-sync-state", row.syncState);
        if (row.fresh)
            item.setAttribute("data-fresh", "true");
        const openRecord = () => { item.removeAttribute("data-fresh"); actions.open(row.record.id); };
        const open = button("", openRecord, "lk-row-open");
        open.setAttribute("aria-label", `${row.title} ${row.amount}`);
        open.textContent = "";
        const dotSlot = el("span", undefined, "lk-row-dot-slot");
        const uncategorized = row.category.id === null && row.category.icon === "question_mark" && row.record.kind !== "refund" && !row.record.split;
        const dotVisual = el("span", undefined, `lk-row-dot-visual${uncategorized ? " lk-row-dot-uncategorized" : ""}`);
        if (uncategorized)
            dotVisual.append(icon("question_mark", 22));
        else {
            const category = row.record.kind === "refund" || row.record.split ? { ...row.category, color: "var(--c-none)" } : row.category;
            dotVisual.append(categoryBadge(category, 30, 16));
        }
        if (row.quick) {
            const dot = button("", () => actions.quick(row.record.id, "category"), `lk-row-dot-button${uncategorized ? " lk-row-dot-button-uncategorized" : ""}`);
            dot.setAttribute("aria-label", `分類：${row.category.label}`);
            dot.append(dotVisual);
            dotSlot.append(dot);
        }
        else {
            dotSlot.setAttribute("aria-hidden", "true");
            if (uncategorized)
                dotVisual.classList.add("lk-row-dot-plain-uncategorized");
            dotSlot.append(dotVisual);
        }
        const body = el("span", undefined, "lk-row-body");
        body.append(el("span", row.title, "lk-row-title"));
        const sub = el("div", undefined, "lk-row-sub");
        const meta = el("span", undefined, "lk-row-subline");
        if (row.aiPending) {
            const marker = icon("auto_fix_high", 13);
            marker.classList.add("lk-row-ai-pending");
            marker.removeAttribute("aria-hidden");
            marker.setAttribute("role", "img");
            marker.setAttribute("aria-label", "AI 記帳，待確認");
            meta.append(marker, el("span", row.subline));
        }
        else
            meta.textContent = row.subline;
        sub.append(meta);
        body.append(sub);
        if (options.showNote !== false && row.record.notes && row.record.merchant)
            body.append(el("span", row.record.notes, "lk-row-note"));
        if (row.badge) {
            const badge = el("span", undefined, "lk-record-badge");
            badge.append(icon(row.badgeIcon ?? "event_repeat", 13), el("span", row.badge));
            body.append(badge);
        }
        const money = el("div", undefined, "lk-row-money");
        const amount = el("span", row.amount, "lk-number");
        if (row.record.kind === "refund")
            amount.classList.add("lk-refund");
        if (row.record.currency !== "TWD" && row.record.reportingValue === null)
            amount.classList.add("lk-unconverted");
        if (row.syncState) {
            const mark = icon(row.syncState === "failed" ? "error" : "cloud_sync", 14);
            mark.classList.add("lk-row-sync-state");
            mark.dataset.state = row.syncState;
            mark.removeAttribute("aria-hidden");
            mark.setAttribute("role", "img");
            mark.setAttribute("aria-label", row.syncState === "failed" ? "未能同步" : "待同步");
            money.append(mark);
        }
        const secondary = options.grouped !== false && row.secondaryIncludesDate ? row.time : options.grouped === false && !row.secondaryIncludesDate
            ? [options.dateLabel?.(row.date) ?? dayLabel(row.date, options.asOf), row.secondary].filter(Boolean).join(" · ") : row.secondary;
        money.append(amount, el("span", secondary, "lk-row-time"));
        open.append(body, money);
        const noteSlot = el("span", undefined, "lk-row-note-slot");
        if (row.quick) {
            const note = button("", () => actions.quick(row.record.id, "note"), "lk-row-note-button");
            note.setAttribute("aria-label", "備註");
            const pill = el("span", undefined, "lk-row-note-pill");
            pill.append(icon("edit_note", 15));
            note.append(pill);
            noteSlot.append(note);
        }
        else if (hasNoteColumn)
            noteSlot.setAttribute("aria-hidden", "true");
        if (hasNoteColumn)
            item.append(dotSlot, open, noteSlot);
        else
            item.append(dotSlot, open);
        list.append(item);
        previousDate = row.date;
    }
    if (!rows.length && options.empty) {
        list.className = "lk-card lk-search-empty";
        list.append(icon(options.empty.icon, 26), el("span", options.empty.text, "lk-search-empty-text"));
    }
    else if (!rows.length && options.emptyText)
        list.append(el("p", options.emptyText, "lk-empty"));
    return list;
}
/** Editing controls share selection, disabled and busy semantics across sheets. */
export function saveButton(label, run, enabled = true, busy = false) {
    const control = button("", run, "lk-save-button");
    control.setAttribute("aria-label", label);
    control.disabled = !enabled || busy;
    control.append(icon(busy ? "progress_activity" : "check", 24));
    control.setAttribute("aria-busy", String(busy));
    return control;
}
export function textEntry(value, label, change, className = "lk-text-entry") {
    const control = el("input", undefined, className);
    control.value = value;
    control.placeholder = label;
    let composing = false;
    control.setAttribute("aria-label", label);
    control.dataset.field = label;
    control.addEventListener("compositionstart", () => { composing = true; });
    control.addEventListener("compositionend", () => { composing = false; change(control.value); });
    control.addEventListener("input", event => { if (composing || event.isComposing)
        return; change(control.value); });
    return control;
}
export function switchControl(label, on, change) {
    const control = button("", change, "lk-switch");
    control.setAttribute("role", "switch");
    control.setAttribute("aria-label", label);
    control.setAttribute("aria-checked", String(on));
    control.append(el("span"));
    return control;
}
/** Existing Notice and buttons for the explicit recovery of a retained intent. */
export function recordSyncNotice(state, writable, actions, copy) {
    if (state !== "failed")
        return null;
    return syncRecoveryNotice(copy ?? syncRecoveryCopy({ noticeKind: "record-edit" }), writable, actions);
}
