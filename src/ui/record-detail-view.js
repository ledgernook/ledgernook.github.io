import { el } from "./dom.js";
import { icon, iconButton } from "./icons.js";
import { recordRow } from "./record-list-model.js";
import { capturedRecordMeta, recordChipItems, recordMoney } from "./record-sheet-model.js";
import { button, categoryBadge } from "./shared-controls.js";
import { recordSheetView } from "./record-sheet-view.js";
/** The regular-width record body; mutation views are retained in the same step host. */
export function recordDetailView(record, result, writable, actions, today = result.asOf) {
    const element = el("section", undefined, "lk-record-detail");
    element.dataset.recordId = record.id;
    element.setAttribute("aria-label", "單筆紀錄");
    const row = recordRow(record, result, writable), money = recordMoney(record);
    const title = el("div", undefined, "lk-record-detail-title");
    const dot = row.category.id === null && !record.split && record.kind !== "refund"
        ? el("span", undefined, "lk-record-detail-uncat") : categoryBadge(row.category, 30, 16);
    if (row.category.id === null && !record.split && record.kind !== "refund")
        dot.append(icon("question_mark", 22));
    title.append(dot, el("h2", row.title), iconButton("close", "關閉", actions.close, 20));
    const amount = el("div", money.amount, `lk-record-detail-amount lk-number${record.kind === "refund" ? " lk-refund" : ""}`);
    if (money.approximate) {
        amount.textContent = "";
        amount.append(el("span", "約", "lk-record-approx"), el("span", money.amount));
    }
    const meta = button(capturedRecordMeta(record, result), actions.history, "lk-record-detail-meta");
    meta.setAttribute("aria-label", "修訂紀錄");
    const sheet = recordSheetView(record, result, writable, { ...actions, open: actions.open ?? (() => { }), later: () => { } }, today);
    const body = el("div", undefined, "lk-record-detail-body");
    const bodyContent = [...sheet.view.element.children].filter(node => !node.classList.contains("lk-record-title") && !node.classList.contains("lk-void"));
    const fields = sheet.view.element.querySelector(".lk-record-detail-fields");
    const chips = sheet.view.element.querySelector(".lk-record-detail-actions");
    const voidItem = recordChipItems(record, result.report.records, true).find(item => item.action === "void");
    if (voidItem) {
        const control = button("", actions.void, "lk-record-detail-chip lk-void");
        control.setAttribute("aria-label", voidItem.label);
        control.disabled = !writable || row.syncState === "failed" || record.voided;
        control.append(icon(voidItem.icon, 17), el("span", voidItem.label));
        chips.append(control);
    }
    body.append(...bodyContent);
    element.append(title, amount);
    amount.append(el("span", money.currency, "lk-record-currency lk-number"));
    if (money.original)
        element.append(el("span", money.original, "lk-record-original"));
    element.append(meta);
    const zone = sheet.view.element.querySelector(".lk-record-time-zone");
    if (zone)
        element.append(zone);
    element.append(body);
    return { element, body, fields,
        showStep(step) {
            meta.hidden = !!step;
            if (zone)
                zone.hidden = !!step;
            if (!step) {
                body.replaceChildren(...bodyContent);
                return;
            }
            const card = el("div", undefined, "lk-record-detail-step");
            const heading = el("div", undefined, "lk-record-detail-back");
            heading.append(iconButton("arrow_back", "返回", step.close, 18), el("h3", step.title));
            card.append(heading, step.view.element);
            body.replaceChildren(card);
        } };
}
