import { categoryPresentation } from "./category-presentation.js";
import { el } from "./dom.js";
import { icon, iconButton } from "./icons.js";
import { dayLabel, recordDate, timeLabel } from "./ledger-format.js";
import { recordRow } from "./record-list-model.js";
import { recordPaymentMethodName } from "./payment-method-name.js";
import { paymentMethodRevision, recordActionItems, recordMoney, recurringRuleLine } from "./record-sheet-model.js";
import { aiPendingNotice, button, categoryBadge, notice, recordSyncNotice } from "./shared-controls.js";
/** The regular-width record body; mutation views are retained in the same step host. */
export function recordDetailView(record, result, writable, actions) {
    const element = el("section", undefined, "lk-record-detail");
    element.dataset.recordId = record.id;
    element.setAttribute("aria-label", "單筆紀錄");
    const row = recordRow(record, result, writable), money = recordMoney(record);
    const editable = writable && row.syncState !== "failed";
    const title = el("div", undefined, "lk-record-detail-title");
    const dot = row.category.id === null && !record.split && record.kind !== "refund"
        ? el("span", undefined, "lk-record-detail-uncat") : categoryBadge(row.category, 30, 16);
    if (row.category.id === null && !record.split && record.kind !== "refund")
        dot.append(icon("question_mark", 22));
    title.append(dot, el("h2", row.title), iconButton("close", "關閉", actions.close, 20));
    const amount = el("div", money.amount, `lk-record-detail-amount lk-number${record.kind === "refund" ? " lk-refund" : ""}`);
    const methodName = recordPaymentMethodName(record.paymentMethod, result);
    const meta = button(`${dayLabel(recordDate(record, result.timeZone), result.asOf)}${timeLabel(record, result.timeZone) ? ` ${timeLabel(record, result.timeZone)}` : ""} · ${methodName}${money.original ? ` · ${money.original}` : ""}`, actions.history, "lk-record-detail-meta");
    meta.setAttribute("aria-label", "修訂紀錄");
    const methodRevision = paymentMethodRevision(record, result);
    if (methodRevision)
        meta.append(el("span", ` · ${methodRevision}`, "lk-payment-method-revision"));
    const body = el("div", undefined, "lk-record-detail-body");
    const fields = el("div", undefined, "lk-record-detail-fields");
    const available = recordActionItems(record);
    for (const [action, glyph, label, value] of [
        ["recat", "sell", "分類", record.split ? "拆帳" : categoryPresentation(result.categories, record.categoryId).label],
        ["note", "edit_note", "備註", record.notes ?? ""],
        ["method", "credit_card", "付款方式", methodName],
        ["proj", "luggage", "專案", result.projects.find(project => project.id === record.projectId)?.label ?? ""],
        ["inst", "event_repeat", "分期", record.installment ? `共 ${record.installment.schedule.length} 期` : ""],
        ["recur", "event_repeat", "定期", recurringRuleLine(record, result)],
    ]) {
        if (action === "inst" && record.recurrence || action === "recur" && !available.some(item => item.action === "recur"))
            continue;
        const control = button("", () => actions.action(action), "lk-record-detail-field");
        control.setAttribute("aria-label", label);
        control.disabled = !editable || record.voided || !available.some(item => item.action === action);
        control.append(icon(glyph, 20), el("span", label), el("span", value, "lk-record-detail-value"));
        fields.append(control);
    }
    const chips = el("div", undefined, "lk-record-detail-actions");
    for (const item of available.filter(item => !["recat", "note", "method", "proj", "inst", "recur"].includes(item.action))) {
        const control = button("", () => actions.action(item.action), "lk-record-detail-chip");
        control.disabled = !editable || record.voided;
        control.append(icon(item.icon, 17), el("span", item.label));
        chips.append(control);
    }
    const voidButton = button("", actions.void, "lk-record-detail-chip lk-void");
    voidButton.disabled = !editable || record.voided;
    voidButton.append(icon("block", 17), el("span", "作廢"));
    if (!record.recurrence)
        chips.append(voidButton);
    const pendingNotice = row.aiPending ? aiPendingNotice(actions.confirm ?? (() => { }), writable, actions.confirming) : null;
    const confirmationError = row.aiPending && actions.confirmationError ? notice(actions.confirmationError, "error") : null;
    const recovery = recordSyncNotice(row.syncState, writable, actions, row.recoveryCopy);
    const bodyContent = [...(recovery ? [recovery] : []), ...(pendingNotice ? [pendingNotice] : []), ...(confirmationError ? [confirmationError] : []), fields,
        ...(record.recurrence?.overridden ? [el("span", "這一期已改金額", "lk-muted")] : []),
        ...(record.recurrence || record.recurring ? [el("span", "影響每一期", "lk-muted")] : []), chips];
    const ruleLine = el("div", undefined, "lk-record-detail-meta");
    if (record.recurrence || record.recurring)
        ruleLine.append(icon("event_repeat", 18), el("span", recurringRuleLine(record, result)));
    body.append(...bodyContent);
    element.append(title, ...(ruleLine.childNodes.length ? [ruleLine] : []), amount, meta, body);
    return { element, body, fields,
        showStep(step) {
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
