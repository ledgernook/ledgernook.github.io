import { isReferenceQuote } from "../application/reference-quote.js";
import { amountCorrectionInput, changeCorrectionCurrency, correctionCurrency, unchangedAmountCorrection } from "./amount-correction-model.js";
import { currencyPickerView } from "./currency-picker-view.js";
import { enteredMinor, recordCorrectionAvailability, refundLinkInput, splitDraftState } from "../application/record-actions.js";
import { isCurrencyCode, minorToDecimal, sourceTwdValue } from "../core/index.js";
import { recordRow } from "./record-list-model.js";
import { dateAt, recordDate } from "./ledger-format.js";
import { canSaveRecordAction, monthlyPlanInput, recordActionDraft, recurringEndInput, recurringOccurrenceAmount, recurringRevisionInput } from "./record-action-model.js";
import { recordActionTitle, recordActionView } from "./record-action-view.js";
import { el } from "./dom.js";
import { button } from "./shared-controls.js";
function confirmed(result) { return result.status === "confirmed" || result.status === "pending"; }
export function recordFailure(result, action) {
    if (result.status === "rejected" && result.code === "credential-rejected")
        return "權杖已失效，草稿已保留 · 請更換權杖";
    if (result.status === "rejected" && ["permission-denied", "write-denied"].includes(result.code))
        return "目前唯讀，草稿已保留";
    if (result.status === "rejected" && result.code === "incomplete-coverage")
        return "紀錄尚未載入完整，請先同步";
    if (result.status === "rejected" && result.code === "over-allocation")
        return "超過可退原始成本，草稿已保留";
    if (result.status === "rejected" && ["allocation-mismatch", "currency-mismatch"].includes(result.code))
        return "原始成本分攤不符，草稿已保留";
    if (result.status === "rejected" && result.code === "invalid-object" && action && ["recur", "occurrence-amount", "occurrence-skip"].includes(action))
        return "這筆無法設定定期，草稿已保留";
    return "未儲存，草稿已保留，請重試";
}
/** One operation identity and draft survive local persistence failure; durable local acceptance closes sheets. */
export async function openRecordAction(host, action, record, result, directDate) {
    if (action === "fx")
        action = "amount";
    if (host.session.capability.status !== "writable" || record.voided || result.localChanges?.records[record.id] === "failed")
        return;
    if ((action === "amount" || action === "date") && !recordCorrectionAvailability(record, result.report.records)[action])
        return;
    if (action === "date" && !directDate)
        return;
    const picker = action === "method" ? await host.session.preferences?.picker() : undefined;
    if (action === "method" && !picker)
        return;
    const key = `record-action:${record.id}:${action}`;
    const stored = await host.session.drafts.get(key);
    const packet = isStoredDraft(stored) ? stored : null;
    const recordId = record.recurrence?.anchorId ?? record.id, recurring = record.recurring !== null || record.recurrence !== null;
    const summary = result.recurringRules.find(item => item.anchorId === recordId);
    const defaults = recordActionDraft(record, result.report.records, dateAt(host.now(), result.timeZone), result.timeZone, packet?.draft.operationId ?? host.operationId(), summary);
    let draft = packet ? { ...defaults, ...packet.draft } : defaults;
    if (!packet && action === "amount")
        draft = { ...draft, amount: minorToDecimal(record.amountMinor, record.currency).replace(/\.00$/, "") };
    if (action === "date")
        draft = { ...draft, date: directDate.occurredOn };
    const currentMethodId = record.paymentMethod.id ?? record.paymentMethod.bankId ?? picker?.methods.find(method => method.label === record.paymentMethod.label)?.id ?? null;
    if (action === "method" && !packet)
        draft = { ...draft, paymentMethodId: currentMethodId };
    let state = { draft, busy: false, locked: false, message: "", preview: null, writable: true }, revision = 0, closed = false;
    let quoteRequest;
    let pending = packet?.pending ?? "save";
    const today = dateAt(host.now(), result.timeZone);
    const view = recordActionView(action, record, result, state, { change, save: rule => { void save(rule ? "rule" : state.locked ? pending : "save"); }, unsplit: () => { void save("unsplit"); },
        currency: () => {
            if (state.busy || state.locked || state.writable === false || closed)
                return;
            host.sheets.push({ title: "幣別", view: currencyPickerView(correctionCurrency(record, draft), result.frequentCurrencies, currency => {
                    host.sheets.pop();
                    change(changeCorrectionCurrency(record, currency));
                    update({ amountFocus: "amount" });
                    void loadQuote();
                }), close: () => host.sheets.pop() });
        }, focus: amountFocus => update({ amountFocus }), restore: () => {
            change({ twdMode: "restore", twd: "", quote: undefined });
            update({ amountFocus: "amount" });
            void loadQuote();
        }, recheck: host.recheck, newLineId: () => `line-${host.operationId()}`,
        cancel: () => { if (!state.busy) {
            closed = true;
            revision++;
            void host.session.drafts.delete(key);
            host.sheets.pop();
        } },
        selectMethod: id => {
            if (state.busy || state.quotePending || closed || host.session.capability.status !== "writable")
                return;
            if (id === currentMethodId) {
                closed = true;
                void host.session.drafts.delete(key);
                host.sheets.pop();
                return;
            }
            change({ paymentMethodId: id });
            void save("save");
        } }, today, picker);
    const unsubscribe = host.onCapabilityChange?.(() => {
        const writable = host.session.capability.status === "writable";
        if (state.writable !== writable)
            update({ writable });
    });
    view.dispose = () => { closed = true; revision++; quoteRequest?.abort(); unsubscribe?.(); };
    function update(patch) {
        state = { ...state, ...patch, draft };
        if (directDate) {
            directDate.busy = state.busy;
            directDate.input.disabled = state.busy || state.writable === false;
        }
        if (!closed)
            view.update(state);
    }
    function change(patch) {
        if (state.busy || state.locked || state.writable === false || closed)
            return;
        draft = { ...draft, ...patch };
        update({ message: "" });
        if (action === "inst" || action === "recur" && recurring)
            void preview();
    }
    async function loadQuote() {
        quoteRequest?.abort();
        const currency = correctionCurrency(record, draft);
        if (currency === "TWD" || sourceTwdValue(record.source, currency) || state.locked) {
            update({ quotePending: false });
            return;
        }
        const request = quoteRequest = new AbortController();
        update({ quotePending: true });
        try {
            const quote = await (host.commands ?? host.session.commands).readReferenceQuote(currency, recordDate(record, result.timeZone), request.signal);
            if (closed || request.signal.aborted)
                return;
            draft = { ...draft, quote: quote.status === "found" ? quote.quote : undefined };
            update({ quotePending: false });
        }
        catch {
            if (closed || request.signal.aborted)
                return;
            draft = { ...draft, quote: undefined };
            update({ quotePending: false });
        }
    }
    async function preview() {
        if (action === "recur") {
            const version = ++revision, input = recurringRevisionInput(draft, record, result.asOf, result.timeZone);
            update({ recurringPreview: null });
            if (!input)
                return;
            const outcome = await (host.commands ?? host.session.commands).previewRecurringRevision({ operationId: draft.operationId, now: draft.commandAt ?? host.now() }, recordId, input);
            if (closed || version !== revision)
                return;
            update(outcome.status === "ready" ? { recurringPreview: outcome.value } : { recurringPreview: null,
                message: recordFailure({ status: "rejected", operationId: draft.operationId, code: outcome.code }, action) });
            return;
        }
        const version = ++revision, input = monthlyPlanInput(draft, record);
        update({ preview: null });
        if (!input)
            return;
        const outcome = await (host.commands ?? host.session.commands).previewMonthlyInstallments({ operationId: draft.operationId, now: draft.commandAt ?? host.now() }, record.id, input);
        if (closed || version !== revision)
            return;
        update(outcome.status === "ready" ? { preview: outcome.value } : { preview: null, message: "無法建立分期，請檢查設定" });
    }
    async function execute(kind) {
        const path = (result.sourcePaths[recordId] ?? result.sourcePaths[record.id])?.replace(/^events\//, "details/");
        const purchasePath = action === "link" && draft.purchaseId ? result.sourcePaths[draft.purchaseId]?.replace(/^events\//, "details/") : undefined;
        const context = { operationId: draft.operationId, now: draft.commandAt ?? host.now(), expectedObjects: {
                ...(path && result.detailObjectIds ? { [path]: result.detailObjectIds[recordId] ?? result.detailObjectIds[record.id] ?? null } : {}),
                ...(purchasePath && draft.purchaseId && result.detailObjectIds ? { [purchasePath]: result.detailObjectIds[draft.purchaseId] ?? null } : {}),
                ...(kind === "rule" ? { "rules/user.json": result.ruleRevision } : {}),
            } }, commands = (host.commands ?? host.session.commands);
        if (kind === "unsplit")
            return commands.unsplit(context, recordId);
        switch (action) {
            case "amount": return commands.correctRecord(context, recordId, amountCorrectionInput(record, draft), today, result.timeZone);
            case "date": return commands.correctRecord(context, recordId, { occurredOn: draft.date }, today, result.timeZone);
            case "recat": {
                if (kind !== "rule" || recurring)
                    return commands.editDetails(context, recordId, { categoryId: draft.categoryId });
                if (!record.merchant || !draft.categoryId)
                    return { status: "rejected", operationId: draft.operationId, code: "invalid-object" };
                return commands.classifyMerchant(context, record.merchant, draft.categoryId, `b-${draft.operationId}`);
            }
            case "note": return commands.editDetails(context, recordId, { notes: draft.notes.trim() || null });
            case "method": return commands.editDetails(context, recordId, { paymentMethodId: draft.paymentMethodId });
            case "split": {
                const split = splitDraftState(record, draft.lines).split;
                return split ? commands.split(context, recordId, split) : { status: "rejected", operationId: draft.operationId, code: "invalid-object" };
            }
            case "refund": return commands.createManual(context, { kind: "refund", amountMinor: enteredMinor(draft.amount, record.currency), currency: record.currency,
                occurredOn: draft.date, ...(record.merchant ? { merchant: record.merchant } : {}), paymentMethodLabel: record.paymentMethod.label ?? record.paymentMethod.bankId ?? "現金" }, { refundOf: recordId });
            case "link": {
                const input = refundLinkInput(record, result.report.records, draft.purchaseId, draft.originalAmount);
                if (!input)
                    return { status: "rejected", operationId: draft.operationId, code: "allocation-mismatch" };
                return input.originalMinor === null ? commands.linkRefund(context, recordId, input.purchaseId)
                    : commands.allocateRefund(context, recordId, input.purchaseId, input.originalMinor);
            }
            case "inst": return commands.convertToInstallments(context, recordId, monthlyPlanInput(draft, record));
            case "proj": return commands.editDetails(context, recordId, { projectId: draft.projectId,
                subscription: draft.subscription ? { ...(draft.subscriptionNote.trim() ? { note: draft.subscriptionNote.trim() } : {}) } : null });
            case "fx": return { status: "rejected", operationId: draft.operationId, code: "invalid-command" };
            case "recur": {
                const end = recurringEndInput(draft);
                return recurring
                    ? commands.reviseRecurring(context, recordId, recurringRevisionInput(draft, record, result.asOf, result.timeZone))
                    : commands.startRecurring(context, recordId, { cadence: draft.cadence, ...(end ? { end } : {}) });
            }
            case "occurrence-amount": {
                const amountMinor = enteredMinor(draft.occurrenceAmount, record.currency);
                return commands.setRecurringOccurrence(context, recordId, record.recurrence.on, amountMinor === recurringOccurrenceAmount(record) ? null : { amountMinor });
            }
            case "occurrence-skip": return commands.setRecurringOccurrence(context, recordId, record.recurrence.on, { skipped: true });
        }
    }
    async function save(kind) {
        if (state.busy || state.quotePending || closed || host.session.capability.status !== "writable" ||
            !state.locked && kind !== "unsplit" && !canSaveRecordAction(action, draft, record, result.report.records, state.preview, state.recurringPreview, result.timeZone))
            return;
        if (action === "amount" && !state.locked && unchangedAmountCorrection(record, draft)) {
            closed = true;
            quoteRequest?.abort();
            void host.session.drafts.delete(key).catch(() => { });
            host.sheets.pop();
            return;
        }
        pending = kind;
        draft = { ...draft, commandAt: draft.commandAt ?? host.now() };
        update({ busy: true, message: "" });
        try {
            await host.session.drafts.put(key, { draft, pending });
            const outcome = await execute(kind);
            if (closed)
                return;
            if (outcome.status === "rejected" && outcome.code === "credential-rejected") {
                await host.afterFailure?.(outcome);
                update({ busy: false, message: recordFailure(outcome, action) });
                return;
            }
            if (confirmed(outcome)) {
                void host.session.drafts.delete(key).catch(() => { });
                if (action === "refund")
                    host.onFreshRecord?.(outcome.operationId);
                closed = true;
                host.sheets.dismiss();
                await host.afterWrite(["recat", "note", "split", "link"].includes(action), kind === "rule" ? "已建立規則" : kind === "unsplit" ? "已取消拆帳" : action === "recur" ? recurring ? "已更新定期" : "已開始定期"
                    : action === "occurrence-amount" ? "已改這次金額" : action === "occurrence-skip" ? "已跳過這一期"
                        : action === "refund" ? `已記退款 ${minorToDecimal(enteredMinor(draft.amount, record.currency), record.currency)}` : action === "link" ? "已連結" : action === "inst" ? "已設定分期" : "");
            }
            else {
                await host.session.drafts.put(key, { draft, pending });
                update({ busy: false, locked: false, message: recordFailure(outcome, action), writable: host.session.capability.status === "writable" });
                await host.afterFailure?.(outcome);
            }
        }
        catch {
            update({ busy: false, message: "未儲存，草稿已保留，請重試" });
        }
    }
    if (directDate) {
        directDate.element.replaceChildren(view.element);
        directDate.retain?.(view);
        await save("save");
        return;
    }
    host.sheets.push({ title: action === "amount" ? recordRow(record, result, true).title : recordActionTitle(action, record), swipe: action === "recat" ? "close" : "rubber-band", view, close: () => { if (state.busy)
            return; closed = true; revision++; if (!state.locked)
            void host.session.drafts.delete(key); host.sheets.pop(); } });
    if (action === "amount" && !state.locked && correctionCurrency(record, draft) !== "TWD" &&
        (draft.twdMode === "restore" || !record.reportingValue)) {
        if (!record.reportingValue && !packet)
            change({ twdMode: "restore" });
        if (!draft.quote)
            await loadQuote();
    }
    if (action === "inst" || action === "recur" && recurring)
        await preview();
}
function isStoredDraft(value) {
    if (!value || typeof value !== "object" || !("draft" in value) || !("pending" in value))
        return false;
    const draft = value.draft;
    return ["save", "rule", "unsplit"].includes(String(value.pending)) &&
        !!draft && typeof draft === "object" && "operationId" in draft && typeof draft.operationId === "string" &&
        ["planId", "notes", "amount", "date", "originalAmount", "firstOn", "fee", "subscriptionNote", "twd"].every(key => key in draft && typeof draft[key] === "string") &&
        ["endOn", "effectiveOn", "recurAmount", "occurrenceAmount"].every(key => !(key in draft) || typeof draft[key] === "string") &&
        (!("cadence" in draft) || ["monthly", "yearly"].includes(String(draft.cadence))) &&
        (!("endKind" in draft) || ["none", "date", "count"].includes(String(draft.endKind))) && (!("endCount" in draft) || Number.isInteger(draft.endCount)) &&
        (!("currency" in draft) || isCurrencyCode(draft.currency)) &&
        (!("twdMode" in draft) || ["follow", "actual", "restore"].includes(String(draft.twdMode))) &&
        (!("quote" in draft) || draft.quote === undefined || !!draft.quote && typeof draft.quote === "object" &&
            "currency" in draft.quote && isCurrencyCode(draft.quote.currency) && "requestedOn" in draft.quote && typeof draft.quote.requestedOn === "string" &&
            isReferenceQuote(draft.quote, draft.quote.currency, draft.quote.requestedOn)) &&
        "lines" in draft && Array.isArray(draft.lines) && draft.lines.every(line => line && typeof line.id === "string" && typeof line.amount === "string" && typeof line.note === "string") &&
        "count" in draft && Number.isInteger(draft.count) && "subscription" in draft && typeof draft.subscription === "boolean";
}
export async function showVoidConfirmation(host, record, element, result, cancelled) {
    if (host.session.capability.status !== "writable" || record.voided || record.recurrence || element.querySelector(".lk-void-confirmation"))
        return;
    const key = `record-void:${record.id}`, confirmation = el("div", undefined, "lk-void-confirmation");
    const operationId = host.operationId(), commandAt = host.now();
    let busy = false;
    const row = el("div");
    const message = el("span", "不再計入總額，GitHub 仍留有歷史");
    const cancel = button("取消", () => { if (!busy) {
        void host.session.drafts.delete(key);
        confirmation.remove();
        element.querySelector(".lk-void")?.removeAttribute("hidden");
        cancelled?.();
    } });
    const save = button("作廢", () => { void run(); }, "lk-destructive");
    confirmation.append(el("strong", `作廢「${record.merchant ?? record.notes ?? "單筆紀錄"}」？`), message, row);
    row.append(cancel, save);
    element.querySelector(".lk-void")?.setAttribute("hidden", "");
    element.append(confirmation);
    async function run() {
        if (busy || host.session.capability.status !== "writable")
            return;
        busy = true;
        cancel.disabled = true;
        save.disabled = true;
        const path = result.sourcePaths[record.id]?.replace(/^events\//, "details/");
        try {
            await host.session.drafts.put(key, { operationId, now: commandAt, voided: true });
            const outcome = await (host.commands ?? host.session.commands).void({ operationId, now: commandAt,
                expectedObjects: path && result.detailObjectIds ? { [path]: result.detailObjectIds[record.id] ?? null } : {} }, record.id);
            if (outcome.status === "rejected" && outcome.code === "credential-rejected") {
                await host.afterFailure?.(outcome);
                message.textContent = recordFailure(outcome);
                busy = false;
                cancel.disabled = false;
                return;
            }
            if (confirmed(outcome)) {
                void host.session.drafts.delete(key).catch(() => { });
                host.sheets.dismiss();
                await host.afterWrite(false, "已作廢");
            }
            else {
                message.textContent = recordFailure(outcome);
                save.disabled = host.session.capability.status !== "writable";
                await host.afterFailure?.(outcome);
            }
        }
        catch {
            message.textContent = "未儲存，草稿已保留，請重試";
        }
        busy = false;
        cancel.disabled = false;
        save.disabled = host.session.capability.status !== "writable";
    }
}
