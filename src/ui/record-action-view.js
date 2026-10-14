import { amountCorrectionPreview, correctionCurrency } from "./amount-correction-model.js";
import { twdEntryField } from "./twd-entry-view.js";
import { sourceTwdValue } from "../core/index.js";
import { amountEntryField, amountEntryKeypad } from "./amount-entry-view.js";
import { keypadAmount } from "./manual-entry-model.js";
import { currencyScale, nextCalendarDate } from "../core/index.js";
import { enteredMinor, installmentEditorPreview, merchantRuleCount, refundableMinor, refundCandidateEnabled, refundCandidates, splitDraftState } from "../application/record-actions.js";
import { categoryPresentation } from "./category-presentation.js";
import { el } from "./dom.js";
import { dayLabel, displayAmount, recordDate } from "./ledger-format.js";
import { recordPaymentMethodName } from "./payment-method-name.js";
import { icon, iconButton } from "./icons.js";
import { button, categoryBadge, deferNativeDateRender, destructiveConfirmation, nativeDateInput, saveButton, segments, switchControl, textEntry } from "./shared-controls.js";
import { canSaveRecordAction, newRecurringPreview, recurringDateLimit } from "./record-action-model.js";
import { screenDateFormatter } from "./screen-date-format.js";
import { exchangeRateText, recurringAnchorDate, recurringRuleLine } from "./record-sheet-model.js";
import { paymentMethodChoices } from "./manual-entry-view.js";
export function recordActionTitle(action, record) {
    const title = record.merchant ?? record.notes ?? "單筆紀錄";
    if (action === "method")
        return "付款方式";
    const prefix = { split: "拆帳", refund: "退款", inst: "分期", recur: "定期", "occurrence-amount": "這次金額", "occurrence-skip": "跳過這次" }[action];
    return action === "link" ? "連結原始消費" : `${prefix ? `${prefix} · ` : ""}${title}`;
}
export function recordActionView(action, record, result, initial, actions, today = result.asOf, picker) {
    const element = el("div", undefined, "lk-record-editor");
    const timelineDates = screenDateFormatter(result.asOf, []);
    let state = initial;
    function chips(options, selected, choose) {
        const wrap = el("div", undefined, "lk-editor-chips");
        for (const option of options) {
            const chip = button(option.label, () => choose(option.id));
            chip.setAttribute("aria-pressed", String(option.id === selected));
            wrap.append(chip);
        }
        return wrap;
    }
    function hint(text, glyph = "link") { const node = el("div", undefined, "lk-editor-hint"); node.append(icon(glyph, 15), el("span", text)); return node; }
    function notice(text, glyph = "error") { const node = el("div", undefined, "lk-notice lk-icon-notice"); node.append(icon(glyph, 17), el("span", text)); return node; }
    function money(label, value, currency, change, suffix = "") {
        const group = el("div", undefined, "lk-editor-field");
        const heading = el("div", undefined, "lk-editor-field-heading");
        heading.append(el("span", label));
        if (suffix)
            heading.append(el("span", suffix, "lk-editor-hint"));
        const field = el("label", undefined, "lk-editor-money");
        const input = textEntry(formatInput(value.replace(/\.00$/, "")), label, change, "lk-editor-money-input");
        input.placeholder = "0";
        input.inputMode = currencyScale(currency) === 0 || currency === "TWD" ? "numeric" : "decimal";
        field.append(el("span", currency, "lk-number"), input);
        group.append(heading, field);
        return group;
    }
    function dateRow(label, value, field) {
        const row = el("div", undefined, "lk-editor-date"), control = el("label", undefined, "lk-date-button");
        control.append(icon("event", 17), el("span", dayLabel(value, today), "lk-number"));
        const earliest = result.earliestRecordDate ?? result.asOf;
        const anchorOn = recurringAnchorDate(record, result.timeZone), recurring = field === "endOn" || field === "effectiveOn";
        const minimum = recurring ? field === "effectiveOn" ? nextCalendarDate(anchorOn) : anchorOn
            : field === "date" ? recordDate(record, result.timeZone) : recordDate(record, result.timeZone) < earliest ? earliest : recordDate(record, result.timeZone);
        const maximum = recurring ? recurringDateLimit(anchorOn) : today;
        control.append(nativeDateInput(value, minimum, maximum, label, date => actions.change({ [field]: date })));
        row.append(el("span", label), control);
        return row;
    }
    function render() {
        if (deferNativeDateRender(element, render))
            return;
        const focus = document.activeElement instanceof HTMLInputElement && element.contains(document.activeElement) ? { field: document.activeElement.dataset.field, start: document.activeElement.selectionStart, end: document.activeElement.selectionEnd } : null;
        element.replaceChildren();
        const d = state.draft, save = () => actions.save();
        const recurring = record.recurring !== null || record.recurrence !== null;
        const enabled = state.writable !== false && canSaveRecordAction(action, d, record, result.report.records, state.preview, state.recurringPreview, result.timeZone) && !state.locked && !state.quotePending;
        if (recurring && ["recat", "note", "method", "proj"].includes(action))
            element.append(hint("影響每一期", "event_repeat"));
        if (action === "amount") {
            const entry = el("div", undefined, "lk-record-amount-editor");
            const currency = correctionCurrency(record, d), focused = state.amountFocus ?? "amount";
            const amount = amountEntryField(d.amount, currency, actions.currency);
            if (focused !== "amount")
                amount.classList.add("lk-entry-unfocused");
            amount.querySelector("input")?.addEventListener("click", () => actions.focus?.("amount"));
            entry.append(amount);
            if (currency !== "TWD") {
                const preview = amountCorrectionPreview(record, d), own = d.twdMode === "actual" ||
                    d.twdMode !== "restore" && currency === record.currency && record.valuation?.basis === "actual" && !record.valuation.origin?.source;
                const twd = d.twdMode === "actual" ? formatInput(d.twd || "0") : preview.amountMinor === null ? "—" : displayAmount(preview.amountMinor);
                entry.append(twdEntryField(twd, "", own, focused === "twd", !!state.quotePending, () => actions.focus?.("twd"), () => actions.restore?.(), false, preview.approximate));
                if (own && preview.row?.kind !== "rate")
                    entry.append(el("span", "自填", "lk-twd-rate lk-number"));
                if (preview.row?.kind === "rate")
                    entry.append(el("span", `1 ${currency} = ${exchangeRateText(preview.row, on => screenDateFormatter(result.asOf, [on]).date(on)).replace(" · ", " TWD · ")}`, "lk-twd-rate lk-number"));
                const stated = sourceTwdValue(record.source, currency);
                if (own && stated)
                    entry.append(el("span", `銀行通知${stated.basis === "approximate" ? " 約" : ""} ${displayAmount(stated.amountMinor)}`, "lk-twd-rate lk-number"));
            }
            entry.append(amountEntryKeypad(focused === "twd" ? "TWD" : currency, state.busy ? "saving" : state.message ? "failed" : "idle", enabled, key => actions.change(focused === "twd" ? { twd: keypadAmount(d.twdMode === "actual" ? d.twd : "", key, "TWD"), twdMode: "actual" }
                : { amount: keypadAmount(d.amount, key, currency, currencyScale(currency)) }), save, "儲存"));
            element.append(entry);
        }
        else if (action === "date") {
            if (state.busy || state.message)
                element.append(el("span", dayLabel(d.date, today), "lk-muted"), saveButton(state.message ? "重試" : "儲存", save, enabled, state.busy));
        }
        else if (action === "method") {
            if (recurring)
                element.append(hint("定期只能用現金或自訂付款方式", "event_repeat"));
            element.append(paymentMethodChoices({ methods: (picker?.methods ?? []).filter(method => !recurring || method.kind !== "bank") }, d.paymentMethodId, id => actions.selectMethod?.(id)));
            if (state.busy)
                element.append(saveButton("儲存", save, false, true));
        }
        else if (action === "recat") {
            const grid = el("div", undefined, "lk-editor-categories");
            const selected = result.categories.find(item => item.id === d.categoryId);
            const mainId = selected?.parentId ?? selected?.id;
            for (const category of result.categories.filter(item => !item.parentId)) {
                const control = button("", () => actions.change({ categoryId: category.id }), "lk-category-choice");
                control.setAttribute("aria-pressed", String(category.id === mainId));
                control.append(categoryBadge(categoryPresentation(result.categories, category.id), 32, 18), el("span", category.label));
                grid.append(control);
            }
            element.append(grid);
            const subs = mainId ? result.categories.filter(item => item.parentId === mainId) : [];
            if (subs.length)
                element.append(chips([{ id: mainId ?? null, label: "不指定" }, ...subs.map(item => ({ id: item.id, label: item.label }))], d.categoryId, id => actions.change({ categoryId: id })));
            const row = el("div", undefined, "lk-editor-two-actions");
            const one = button(recurring ? "儲存" : "只改這一筆", save, "lk-editor-primary");
            one.disabled = !enabled || state.busy;
            row.append(one);
            if (record.merchant && record.kind !== "refund" && !recurring) {
                const rule = button("", () => actions.save(true), "lk-editor-rule");
                rule.disabled = !enabled || state.busy;
                rule.append(icon("rule", 18), el("span", "同商家都改"));
                row.append(rule);
            }
            element.append(row);
            if (record.merchant && record.kind !== "refund" && !recurring)
                element.append(el("span", `「${record.merchant}」${merchantRuleCount(record, result.report.records)} 筆會改分類`, "lk-editor-rule-note"));
        }
        else if (action === "note") {
            const row = el("div", undefined, "lk-editor-note");
            row.append(textEntry(d.notes, "備註", value => actions.change({ notes: value })), saveButton("儲存", save, enabled, state.busy));
            element.append(row);
        }
        else if (action === "split") {
            const checked = splitDraftState(record, d.lines);
            const total = el("div", undefined, "lk-editor-total");
            const diff = el("span", undefined, !checked.overflow && checked.remainingMinor === 0 ? "lk-editor-ok" : "lk-editor-error");
            diff.append(icon(!checked.overflow && checked.remainingMinor === 0 ? "check_circle" : "error", 18), el("span", checked.overflow ? "金額超過可用範圍" : checked.remainingMinor === 0 ? "剛好" : `${checked.remainingMinor > 0 ? "還差" : "超過"} ${displayAmount(Math.abs(checked.remainingMinor), record.currency)}`));
            total.append(el("strong", `${checked.overflow ? "—" : displayAmount(checked.sumMinor, record.currency)} / ${displayAmount(record.amountMinor, record.currency)}`, "lk-number"), diff);
            element.append(total);
            const lines = el("div", undefined, "lk-editor-lines");
            d.lines.forEach((line, index) => {
                const patch = (change) => actions.change({ lines: d.lines.map((item, i) => i === index ? { ...item, ...change } : item) });
                const node = el("div", undefined, "lk-editor-line"), row = el("div", undefined, "lk-editor-line-top");
                const lineCategory = result.categories.find(item => item.id === line.categoryId);
                const category = categoryPresentation(result.categories, lineCategory?.parentId ?? line.categoryId);
                const control = button("", () => actions.change({ picking: d.picking === index ? null : index }), "lk-line-category");
                control.append(categoryBadge(category, 32, 17), el("span", category.label));
                const amount = textEntry(formatInput(line.amount.replace(/\.00$/, "")), `第 ${index + 1} 行金額`, value => patch({ amount: value }), "lk-line-amount lk-number");
                amount.placeholder = "0";
                amount.inputMode = "decimal";
                row.append(control, amount);
                if (d.lines.length > 2)
                    row.append(iconButton("close", `移除第 ${index + 1} 行`, () => actions.change({ lines: d.lines.filter((_, i) => i !== index), picking: null }), 18));
                node.append(row);
                if (d.picking === index) {
                    node.append(chips(result.categories.filter(item => !item.parentId).map(item => ({ id: item.id, label: item.label })), line.categoryId, id => { patch({ categoryId: id }); actions.change({ picking: null }); }));
                    const parent = result.categories.find(item => item.id === line.categoryId)?.parentId ?? line.categoryId;
                    const subs = result.categories.filter(item => item.parentId === parent);
                    if (subs.length)
                        node.append(chips(subs.map(item => ({ id: item.id, label: item.label })), line.categoryId, id => { patch({ categoryId: id }); actions.change({ picking: null }); }));
                }
                const note = textEntry(line.note, `第 ${index + 1} 行備註`, value => patch({ note: value }), "lk-line-note");
                note.placeholder = "備註";
                node.append(note);
                lines.append(node);
            });
            element.append(lines);
            const add = button("", () => actions.change({ lines: [...d.lines, { id: actions.newLineId(), amount: checked.remainingMinor > 0 ? checked.remainingInput : "", categoryId: null, note: "" }], picking: d.lines.length }), "lk-add-line");
            add.disabled = d.lines.length >= 30;
            add.setAttribute("aria-label", "再加一行");
            add.append(icon("add", 20));
            element.append(add, saveButton("儲存", save, enabled, state.busy));
            if (record.split)
                element.append(button("取消拆帳", actions.unsplit, "lk-remove-split"));
        }
        else if (action === "refund") {
            const max = refundableMinor(record, result.report.records), value = enteredMinor(d.amount, record.currency);
            element.append(money("退款金額", d.amount, record.currency, value => actions.change({ amount: value }), `${value && value <= max ? value === max ? "全額" : "部分退款" : ""} · 最多 ${displayAmount(max, record.currency)}`));
            if (value !== null && value > max)
                element.append(notice("超過可退金額"));
            if (record.installment)
                element.append(notice("先調整分期", "event_repeat"));
            element.append(dateRow("退款日期", d.date, "date"), hint("沿用原消費的分類與專案"), saveButton("儲存", save, enabled, state.busy));
        }
        else if (action === "link") {
            const candidates = el("div", undefined, "lk-refund-candidates");
            const date = recordDate(record, result.timeZone);
            const ordered = [...refundCandidates(record, result.report.records)].sort((a, b) => Number(recordDate(a, result.timeZone) > date) - Number(recordDate(b, result.timeZone) > date));
            for (const candidate of ordered) {
                const control = button("", () => actions.change({ purchaseId: candidate.id, originalAmount: d.purchaseId === candidate.id ? d.originalAmount : "" }), "lk-refund-candidate");
                control.setAttribute("aria-pressed", String(d.purchaseId === candidate.id));
                control.disabled = !refundCandidateEnabled(record, candidate, result.report.records);
                const text = el("span", undefined, "lk-candidate-label");
                text.append(el("span", candidate.merchant ?? candidate.notes ?? "單筆紀錄"), el("span", `${timelineDates.timelineDate(recordDate(candidate, result.timeZone))} · ${recordPaymentMethodName(candidate.paymentMethod, result)}${candidate.currency !== record.currency ? ` · ${candidate.currency} ${displayAmount(candidate.amountMinor, candidate.currency)}` : ""}`, "lk-muted"));
                control.append(icon(d.purchaseId === candidate.id ? "check_circle" : "radio_button_unchecked", 21), text, el("strong", displayAmount(candidate.reportingValue?.amountMinor ?? candidate.amountMinor, candidate.reportingValue ? "TWD" : candidate.currency), "lk-number"));
                candidates.append(control);
            }
            element.append(candidates);
            const purchase = ordered.find(item => item.id === d.purchaseId);
            if (purchase && purchase.currency !== record.currency) {
                const max = refundableMinor(purchase, result.report.records), value = enteredMinor(d.originalAmount, purchase.currency);
                element.append(money("原始成本分攤", d.originalAmount, purchase.currency, originalAmount => actions.change({ originalAmount }), `最多 ${displayAmount(max, purchase.currency)}`));
                if (d.originalAmount.trim() && (value === null || value <= 0 || value > max))
                    element.append(notice(value !== null && value > max ? "超過可退原始成本" : "請輸入有效的原幣金額"));
            }
            element.append(hint("沿用原消費的分類與專案", "sell"), saveButton("儲存", save, enabled, state.busy));
        }
        else if (action === "inst") {
            element.append(segments([3, 6, 12, 24].map(n => ({ label: `${n} 期`, selected: d.count === n, run: () => actions.change({ count: n }) }))));
            const count = el("div", undefined, "lk-editor-count");
            count.append(el("span", "期數", "lk-spacer"), iconButton("remove", "減少", () => actions.change({ count: Math.max(2, d.count - 1) }), 18), el("strong", `${d.count} 期`, "lk-number"), iconButton("add", "增加", () => actions.change({ count: Math.min(36, d.count + 1) }), 18));
            element.append(count, dateRow("首期認列", d.firstOn, "firstOn"), money("手續費", d.fee, record.currency, value => actions.change({ fee: value })));
            if (state.preview) {
                const list = el("div", undefined, "lk-schedule lk-editor-schedule");
                const summary = installmentEditorPreview(state.preview);
                summary.periods.forEach((period, i) => {
                    const row = el("div", undefined, `lk-schedule-row${period.on > result.asOf ? " lk-future" : ""}`);
                    row.append(icon(period.on > result.asOf ? "schedule" : "check", 15), el("span", `第 ${i + 1} 期`), el("span", `${period.on.slice(0, 4) !== result.asOf.slice(0, 4) ? `${period.on.slice(0, 4)}/` : ""}${Number(period.on.slice(5, 7))}/${Number(period.on.slice(8))}`, "lk-number"), el("strong", displayAmount(period.amountMinor, record.currency), "lk-number"));
                    list.append(row);
                });
                const amount = summary.totalMinor;
                const total = el("div", undefined, "lk-editor-total");
                const right = el("span", undefined, "lk-editor-ok");
                right.append(icon("check_circle", 17), el("span", `= ${displayAmount(amount, record.currency)}`));
                total.append(el("strong", displayAmount(amount, record.currency), "lk-number"), right);
                element.append(list, total);
                if (state.preview.fees?.length)
                    element.append(el("span", `手續費 ${displayAmount(state.preview.fees[0].amountMinor, record.currency)} 計入第 1 期`, "lk-editor-hint"));
            }
            element.append(saveButton("確認分期", save, enabled, state.busy));
        }
        else if (action === "recur") {
            if (recurring)
                element.append(hint(recurringRuleLine(record, result), "event_repeat"), dateRow("從這一期起", d.effectiveOn, "effectiveOn"));
            element.append(segments(["monthly", "yearly"].map(cadence => ({ label: cadence === "monthly" ? "每月" : "每年", selected: d.cadence === cadence, run: () => actions.change({ cadence }) }))));
            const end = el("div", undefined, "lk-editor-date");
            end.append(el("span", "結束"), segments(["none", "date", "count"].map(endKind => ({
                label: endKind === "none" ? "無" : endKind === "date" ? "日期" : "次數", selected: d.endKind === endKind, run: () => actions.change({ endKind })
            }))));
            element.append(end);
            if (d.endKind === "date")
                element.append(dateRow("結束日期", d.endOn, "endOn"));
            if (d.endKind === "count") {
                const count = el("div", undefined, "lk-editor-count");
                count.append(el("span", "次數", "lk-spacer"), iconButton("remove", "減少", () => actions.change({ endCount: Math.max(1, d.endCount - 1) }), 18), el("strong", `${d.endCount} 次`, "lk-number"), iconButton("add", "增加", () => actions.change({ endCount: Math.min(1200, d.endCount + 1) }), 18));
                element.append(count);
            }
            if (recurring)
                element.append(money("金額", d.recurAmount, record.currency, recurAmount => actions.change({ recurAmount })));
            const periods = recurring ? state.recurringPreview?.next : newRecurringPreview(d, record, result.timeZone);
            if (recurring && state.recurringPreview)
                element.append(el("span", `保留 ${state.recurringPreview.kept.length} 期`, "lk-editor-hint"));
            if (periods) {
                const list = el("div", undefined, "lk-schedule lk-editor-schedule"), dates = screenDateFormatter(result.asOf, periods.map(period => period.on));
                for (const period of periods) {
                    const row = el("div", undefined, `lk-schedule-row${period.on > result.asOf ? " lk-future" : ""}`);
                    row.append(icon(period.on > result.asOf ? "schedule" : "check", 15), el("span", `第 ${period.index} 期`), el("span", dates.date(period.on), "lk-number"), el("strong", displayAmount(period.amountMinor, record.currency), "lk-number"));
                    list.append(row);
                }
                element.append(list);
            }
            const footer = el("div", undefined, "lk-editor-two-actions"), discard = iconButton("close", "放棄", () => actions.cancel?.(), 24);
            discard.classList.add("lk-editor-rule");
            footer.append(saveButton(recurring ? "更新定期" : "開始定期", save, enabled, state.busy), discard);
            element.append(footer);
        }
        else if (action === "occurrence-amount") {
            element.append(money("這次金額", d.occurrenceAmount, record.currency, occurrenceAmount => actions.change({ occurrenceAmount })), saveButton("儲存", save, enabled, state.busy));
        }
        else if (action === "occurrence-skip") {
            element.append(destructiveConfirmation("跳過這次", "這一期不計入，之後的定期照常", "跳過", () => actions.cancel?.(), save));
        }
        else if (action === "proj") {
            const row = el("div", undefined, "lk-editor-projects");
            row.append(icon("luggage", 19), chips([{ id: null, label: "無專案" }, ...result.projects.filter(item => !item.archived || item.id === record.projectId).map(item => ({ id: item.id, label: item.label }))], d.projectId, id => actions.change({ projectId: id })));
            element.append(row);
            const subscription = el("div", undefined, "lk-editor-subscription");
            subscription.append(icon("autorenew", 20), el("span", "訂閱", "lk-spacer"), switchControl("訂閱", d.subscription, () => actions.change({ subscription: !d.subscription })));
            element.append(subscription);
            if (d.subscription)
                element.append(textEntry(d.subscriptionNote, "訂閱備註", value => actions.change({ subscriptionNote: value })));
            element.append(saveButton("儲存", save, enabled, state.busy));
        }
        if (state.message) {
            const message = el("p", state.message, "lk-editor-error lk-editor-message");
            message.setAttribute("role", "status");
            element.append(message);
        }
        if (state.busy || state.locked)
            for (const control of element.querySelectorAll("input,button"))
                control.disabled = true;
        if (state.writable === false)
            for (const control of element.querySelectorAll("button"))
                control.disabled = true;
        if (state.writable === false && actions.recheck)
            element.append(button("重新檢查寫入權限", actions.recheck, "lk-text-action"));
        if (state.locked && !state.busy && state.writable !== false)
            element.append(button("讀回確認並重試", save, "lk-editor-primary"));
        if (focus?.field) {
            const input = [...element.querySelectorAll("input")].find(item => item.dataset.field === focus.field);
            input?.focus();
            if (focus.start !== null)
                input?.setSelectionRange(focus.start, focus.end);
        }
    }
    render();
    return { element, update(next) { state = next; render(); } };
}
function formatInput(value) {
    const raw = value.replaceAll(",", "");
    if (!/^\d+(?:\.\d*)?$/.test(raw))
        return value;
    const [integer, decimal] = raw.split(".");
    return Number(integer).toLocaleString("en-US") + (decimal === undefined ? "" : `.${decimal}`);
}
