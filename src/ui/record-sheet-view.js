import { categoryPresentation } from "./category-presentation.js";
import { displayAmount, recordDate, timeLabel } from "./ledger-format.js";
import { recordRow } from "./record-list-model.js";
import { screenDateFormatter } from "./screen-date-format.js";
import { el } from "./dom.js";
import { icon, iconButton } from "./icons.js";
import { recordPaymentMethodName } from "./payment-method-name.js";
import { aiPendingNotice, button, categoryBadge, notice, recordSyncNotice } from "./shared-controls.js";
import { classificationSource, paymentMethodRevision, recordActionItems, recordMoney, recurringRuleLine, valuationLabel } from "./record-sheet-model.js";
export function recordSheetView(record, result, writable, actions) {
    const row = recordRow(record, result, writable);
    const sessionWritable = writable;
    writable = writable && row.syncState !== "failed";
    const header = el("div", undefined, "lk-record-header");
    header.append(categoryBadge(record.kind === "refund" ? { ...row.category, icon: "undo" } : row.category, 42, 21), el("span", undefined, "lk-spacer"), iconButton("history", "修訂紀錄", actions.history), iconButton("close", "關閉", actions.close));
    const element = el("div", undefined, "lk-record-sheet-body");
    const recordOn = recordDate(record, result.timeZone);
    const original = result.report.records.find(item => item.id === record.refundOf);
    const refunds = result.report.records.filter(item => item.refundOf === record.id && !item.voided);
    const valuationOn = record.reportingValue && record.currency !== "TWD" && record.valuation?.basis === "reference-rate" ? record.valuation.effectiveOn : null;
    const screenDates = screenDateFormatter(result.asOf, [recordOn, ...(original ? [recordDate(original, result.timeZone)] : []),
        ...refunds.map(item => recordDate(item, result.timeZone)), ...(record.installment?.schedule.map(period => period.on) ?? []), ...(valuationOn ? [valuationOn] : [])]);
    const title = el("div", undefined, "lk-record-title");
    title.append(el("h2", row.title));
    const amount = recordMoney(record);
    const money = el("div", undefined, `lk-record-amount${record.reportingValue ? "" : " lk-money-missing"}`);
    money.append(el("span", amount.amount, `lk-number${record.kind === "refund" ? " lk-refund" : ""}`), el("span", amount.currency, "lk-record-currency lk-number"));
    title.append(money);
    if (amount.original)
        title.append(el("span", amount.original, "lk-record-original"));
    element.append(title);
    const recovery = recordSyncNotice(row.syncState, sessionWritable, actions, row.recoveryCopy);
    if (recovery)
        element.append(recovery);
    if (row.aiPending) {
        element.append(aiPendingNotice(actions.confirm ?? (() => { }), writable, actions.confirming));
        if (actions.confirmationError)
            element.append(notice(actions.confirmationError, "error"));
    }
    if (!record.reportingValue) {
        const notice = el("div", undefined, "lk-notice lk-icon-notice");
        notice.append(icon("currency_exchange", 17), el("span", `缺少 ${screenDates.date(recordOn)} 的 ${record.currency} 匯率，未計入總額`));
        element.append(notice);
    }
    if (record.kind === "refund" && !record.refundOf) {
        const notice = el("div", undefined, "lk-notice lk-icon-notice");
        notice.append(icon("link_off", 17), el("span", "未連結原消費"));
        element.append(notice);
    }
    if (record.split) {
        const lines = el("div", undefined, "lk-split-lines");
        for (const line of record.split) {
            const item = el("div", undefined, "lk-split-line");
            const category = categoryPresentation(result.categories, line.categoryId);
            const text = el("div", undefined, "lk-split-label");
            text.append(el("span", category.label));
            if (line.note)
                text.append(el("span", line.note, "lk-split-note"));
            item.append(categoryBadge(category, 26, 15), text, el("span", displayAmount(line.amountMinor, record.currency), "lk-number"));
            lines.append(item);
        }
        element.append(lines);
    }
    const facts = el("div", undefined, "lk-record-facts");
    function fact(glyph, body) { facts.append(icon(glyph, 18), typeof body === "string" ? el("span", body) : body); }
    if (record.recurrence || record.recurring)
        fact("event_repeat", recurringRuleLine(record, result));
    const purpose = el("span", undefined, "lk-record-purpose");
    purpose.append(el("span", record.split ? "拆帳" : categoryPresentation(result.categories, record.categoryId).label));
    if (record.categoryId || record.split) {
        const source = classificationSource(record);
        const provenance = el("span", undefined, "lk-classification-source");
        provenance.append(icon(source.icon, 14), el("span", source.text));
        purpose.append(provenance);
    }
    fact("sell", purpose);
    const date = el("span", undefined, "lk-record-date");
    date.append(el("span", `${screenDates.day(recordOn)}${timeLabel(record, result.timeZone) ? ` ${timeLabel(record, result.timeZone)}` : ""}`));
    let zone = "只有日期";
    if (record.occurrence.precision === "instant") {
        const offset = new Intl.DateTimeFormat("en", { timeZone: result.timeZone, timeZoneName: "shortOffset" }).formatToParts(new Date(record.occurrence.at)).find(part => part.type === "timeZoneName")?.value?.replace("GMT", "UTC") ?? result.timeZone;
        zone = `${record.occurrence.provenance === "notification" || record.occurrence.provenance === "capture" ? "通知截取時間 · " : "手動指定時間 · "}${offset}`;
    }
    date.append(el("span", zone, "lk-muted"));
    fact("event", date);
    const method = button(recordPaymentMethodName(record.paymentMethod, result), () => actions.action?.("method"), "lk-inline-link");
    method.setAttribute("aria-label", "付款方式");
    method.disabled = !writable || record.voided;
    fact("credit_card", method);
    const methodRevision = paymentMethodRevision(record, result);
    if (methodRevision)
        fact("history", button(methodRevision, actions.history, "lk-inline-link lk-payment-method-revision"));
    if (record.projectId)
        fact("luggage", result.projects.find(item => item.id === record.projectId)?.label ?? record.projectId);
    if (record.subscription) {
        const subscription = el("span", undefined, "lk-record-date");
        subscription.append(el("span", "訂閱"));
        if (record.subscription.note)
            subscription.append(el("span", record.subscription.note, "lk-muted"));
        fact("autorenew", subscription);
    }
    if (record.notes)
        fact("edit_note", record.notes);
    const valuation = valuationLabel(record, screenDates.date);
    if (valuation)
        fact("currency_exchange", valuation);
    if (original)
        fact("link", button(`${original.merchant ?? original.notes ?? "原消費"} · ${screenDates.date(recordDate(original, result.timeZone))} · ${recordMoney(original).amount}`, () => actions.open(original.id), "lk-inline-link"));
    for (const refund of refunds)
        fact("undo", button(`${screenDates.date(recordDate(refund, result.timeZone))} 退款 ${displayAmount(refund.amountMinor, refund.currency)}`, () => actions.open(refund.id), "lk-inline-link"));
    fact(record.source.source === "manual" ? "edit" : "notifications", record.source.source === "manual" ? "手動輸入" : "銀行通知");
    element.append(facts);
    if (record.recurrence?.overridden)
        element.append(el("span", "這一期已改金額", "lk-muted"));
    if (record.recurrence || record.recurring)
        element.append(el("span", "影響每一期", "lk-muted"));
    if (record.installment) {
        const plan = el("div", undefined, "lk-installment-summary");
        const balance = result.installmentBalances.plans.find(item => item.record.id === record.id);
        const heading = el("div", undefined, "lk-installment-heading");
        const first = record.installment.schedule[0]?.on ?? "";
        heading.append(el("strong", `共 ${record.installment.schedule.length} 期 · 首期 ${screenDates.date(first)}`));
        if (balance && balance.remainingCount > 0)
            heading.append(el("span", `剩 ${balance.remainingCount} 期 · ${displayAmount(balance.remainingMinor, record.currency)}`, "lk-muted"));
        const schedule = el("div", undefined, "lk-schedule");
        record.installment.schedule.forEach((period, i) => { const line = el("div", undefined, `lk-schedule-row${period.on > result.asOf ? " lk-future" : ""}`); line.append(icon(period.on > result.asOf ? "schedule" : "check", 15), el("span", `第 ${i + 1} 期`), el("span", screenDates.date(period.on), "lk-number"), el("strong", displayAmount(period.amountMinor, record.currency), "lk-number")); schedule.append(line); });
        plan.append(heading, schedule);
        element.append(plan);
    }
    const tiles = el("div", undefined, "lk-record-actions");
    for (const item of recordActionItems(record)) {
        const tile = button("", () => actions.action?.(item.action), "lk-action-tile");
        tile.setAttribute("aria-label", item.action === "link" ? "連結原始消費" : item.label);
        tile.disabled = !writable || record.voided;
        tile.append(icon(item.icon, 22), el("span", item.label));
        tiles.append(tile);
    }
    element.append(tiles);
    if (writable && !record.voided && !record.recurrence)
        element.append(button("作廢", () => actions.void?.(), "lk-void"));
    if (row.syncState === "failed" && sessionWritable)
        element.append(el("div", "先重送或捨棄才能再編輯", "lk-record-edit-hint"));
    else if (!sessionWritable) {
        const readOnly = el("div", undefined, "lk-record-readonly");
        readOnly.append(icon("lock", 16), el("span", "唯讀"));
        element.append(readOnly);
    }
    return { header, view: { element } };
}
