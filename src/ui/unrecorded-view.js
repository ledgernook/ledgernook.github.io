import { el } from "./dom.js";
import { icon } from "./icons.js";
import { button, syncRecoveryNotice } from "./shared-controls.js";
export function unrecordedNotice(model, actions, expanded = new Set()) {
    const element = el("div", undefined, "lk-unrecorded");
    element.dataset.surface = model.surface;
    element.setAttribute("role", "region");
    element.setAttribute("aria-label", "未記錄的通知");
    if (model.total === 0) {
        element.hidden = true;
        return { element };
    }
    if (model.surface === "page") {
        const header = el("div", undefined, "lk-unrecorded-header");
        header.append(icon("notification_important", 18), el("span", "未記錄"), el("span", String(model.total), "lk-number"), el("span", "則"));
        element.append(header);
    }
    for (const item of model.items) {
        const row = el("div", undefined, "lk-unrecorded-item");
        row.dataset.unrecordedId = item.id;
        const source = el("div", undefined, "lk-unrecorded-source");
        source.append(el("span", item.source), el("span", item.capturedAt, "lk-number"));
        if (item.syncState === "failed") {
            const mark = icon("error", 14);
            mark.classList.add("lk-row-sync-state");
            mark.dataset.state = "failed";
            mark.removeAttribute("aria-hidden");
            mark.setAttribute("role", "img");
            mark.setAttribute("aria-label", "未能同步");
            source.append(mark);
        }
        row.append(source);
        const reason = el("div", undefined, "lk-unrecorded-reason");
        if (item.parsed) {
            reason.classList.add("lk-unrecorded-parsed");
            reason.append(icon("task_alt", 15), el("span", "現在看得懂了"));
            row.append(reason);
            const preview = el("div", undefined, "lk-unrecorded-preview");
            const top = el("div");
            top.append(el("span", item.parsed.merchant), el("span", item.parsed.amount, "lk-number"));
            preview.append(top, el("span", item.parsed.meta));
            row.append(preview);
        }
        else {
            reason.append(el("span", item.reason));
            if (item.amount)
                reason.append(el("span", "·"), el("span", item.amount, "lk-number"));
            row.append(reason);
        }
        const raw = el("div", undefined, "lk-unrecorded-raw");
        const text = el("span", item.raw);
        const toggle = button("", () => { expanded.has(item.id) ? expanded.delete(item.id) : expanded.add(item.id); update(); }, "lk-unrecorded-expand");
        function update() {
            const open = expanded.has(item.id);
            text.dataset.expanded = String(open);
            toggle.setAttribute("aria-expanded", String(open));
            toggle.setAttribute("aria-label", open ? "收起" : "顯示全文");
            toggle.replaceChildren(icon(open ? "expand_less" : "expand_more", 20));
        }
        update();
        raw.append(text, toggle);
        row.append(raw);
        if (item.syncState === "failed")
            row.append(syncRecoveryNotice(item.recoveryCopy, model.writable, {
                resend: () => actions.recover?.(item, "resend"), discard: () => actions.recover?.(item, "discard"),
            }));
        const controls = el("div", undefined, "lk-unrecorded-actions");
        const dismiss = button("不用記", () => actions.dismiss(item), "lk-unrecorded-action");
        dismiss.disabled = item.dismissDisabled;
        const primary = button("補記", () => actions.fill(item), "lk-unrecorded-action");
        primary.disabled = item.fillDisabled;
        controls.append(dismiss, primary);
        row.append(controls);
        element.append(row);
    }
    if (model.more)
        element.append(button(`全部 ${model.total} 則`, actions.more, "lk-unrecorded-more"));
    return { element };
}
