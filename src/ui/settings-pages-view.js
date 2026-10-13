import { resolveRecurringSchedule } from "../core/index.js";
import { categoryPresentation } from "./category-presentation.js";
import { el } from "./dom.js";
import { icon, iconButton } from "./icons.js";
import { displayAmount } from "./ledger-format.js";
import { recordPaymentMethodName } from "./payment-method-name.js";
import { screenDateFormatter } from "./screen-date-format.js";
import { attachPaymentMethodReorder } from "./payment-method-reorder.js";
import { automaticCaptureModel, LEDGERNOOK_ORGANISER_SHORTCUT_HREF, merchantRuleRows, parseClosingDay, reportingZonesAt } from "./settings-model.js";
import { WALLET_CAPTURE_SUSPENDED } from "./settings-flags.js";
import { button, categoryBadge, destructiveConfirmation, notice, section, segments, switchRow, switchTrack, textAction } from "./shared-controls.js";
export function settingsPage(title, back, gap = 16) {
    const page = el("div", undefined, "lk-settings-page lk-feature-view");
    page.style.gap = `${gap}px`;
    const heading = el("div", undefined, "lk-page-heading");
    const backButton = iconButton("arrow_back", "返回", back);
    backButton.classList.add("lk-page-back", "lk-edge-back");
    heading.append(backButton, el("h1", title));
    page.append(heading);
    return page;
}
export function recurringEntriesView(result, back, open) {
    const element = settingsPage("定期支出", back), card = el("div", undefined, "lk-card lk-settings-card");
    const dates = screenDateFormatter(result.asOf, [], { alwaysYear: true });
    for (const summary of result.recurringRules) {
        const row = button("", () => { if (summary.latestOccurrenceId)
            open(summary.latestOccurrenceId); }, "lk-settings-row lk-recurring-row");
        row.dataset.anchorId = summary.anchorId;
        const heading = el("span", undefined, "lk-recurring-heading");
        heading.append(el("span", summary.notes ?? categoryPresentation(result.categories, summary.categoryId).label), el("strong", `${summary.currency === "TWD" ? "" : `${summary.currency} `}${displayAmount(summary.amountMinor, summary.currency)}`, "lk-number"));
        const cadence = summary.cadence === "monthly" ? `每月 ${Number(summary.anchorOn.slice(8))} 日` : `每年 ${Number(summary.anchorOn.slice(5, 7))}/${Number(summary.anchorOn.slice(8))}`;
        let end = "";
        if (summary.end && !summary.ended) {
            if ("on" in summary.end)
                end = ` · 至 ${dates.date(summary.end.on)}`;
            else {
                const remaining = resolveRecurringSchedule({ rule: summary.rule, anchorOn: summary.anchorOn, amountMinor: summary.amountMinor, horizon: "9999-12-31" })
                    .occurrences.filter(item => item.on > result.asOf).length;
                end = ` · 還有 ${remaining} 次`;
            }
        }
        row.append(heading, el("span", `${cadence} · ${recordPaymentMethodName(summary.paymentMethod, result)} · ${summary.ended ? "已結束" : summary.next ? `下次 ${dates.date(summary.next.on)}` : ""}${end}`, "lk-setting-detail"));
        card.append(row);
    }
    element.append(result.recurringRules.length ? card : notice("還沒有定期支出。從一筆紀錄的「定期」開始。", "event_repeat"));
    return { element };
}
export function automaticCaptureView(result, picker, back, guide, walletCaptureSuspended = WALLET_CAPTURE_SUSPENDED) {
    const element = settingsPage("iPhone 自動記帳", back);
    const model = automaticCaptureModel(result, picker.methods, walletCaptureSuspended);
    const noBanks = model.apps.length === 0;
    const cards = el("div", undefined, "lk-auto-steps");
    // The installed app and setup cannot be detected; only capture evidence can complete this checklist.
    for (const [index, step] of model.steps.entries()) {
        const card = el("div", undefined, "lk-card lk-auto-step");
        const mark = el("span", undefined, "lk-auto-mark");
        mark.dataset.done = String(model.complete);
        mark.append(model.complete ? icon("check", 18) : el("span", String(index + 1), "lk-number"));
        const body = el("div", undefined, "lk-auto-step-copy");
        body.append(el("strong", step.title));
        if (step.detail && !(step.id === "automation" && noBanks))
            body.append(el("span", step.detail, "lk-auto-step-detail"));
        if (step.id === "capture") {
            if (model.banks.length) {
                const banks = el("div", undefined, "lk-auto-banks");
                for (const bank of model.banks) {
                    const row = el("div", undefined, "lk-auto-bank");
                    const name = el("span", bank.label + (bank.source ? " " : ""));
                    if (bank.source)
                        name.append(el("span", bank.source, "lk-auto-source"));
                    row.append(name, el("span", bank.last, "lk-muted"));
                    banks.append(row);
                }
                body.append(banks);
            }
            if (noBanks)
                card.dataset.inactive = "true";
        }
        if (step.id === "install") {
            const link = el("a", undefined, "lk-auto-action lk-guide-step-button");
            link.href = model.writerShortcutHref;
            link.download = "LedgerNook Writer.shortcut";
            link.setAttribute("data-guide-action", step.id);
            link.append(icon("download", 17), el("span", "LedgerNook Writer"));
            body.append(link);
        }
        else if (step.id === "writer") {
            const token = textAction("在 GitHub 建立權杖", () => guide("token", model.apps), "ink");
            token.classList.add("lk-guide-token-action");
            token.append(icon("open_in_new", 18));
            token.dataset.guideAction = "token";
            body.append(token);
            const permissions = el("div", undefined, "lk-guide-permissions");
            for (const [index, [name, value]] of [["Repository access", "只選帳本儲存庫"], ["Contents", "Read and write"], ["Expiration", "選一個到期日"]].entries()) {
                const row = el("div", undefined, "lk-permission-row");
                if (!index)
                    row.classList.add("lk-guide-permission-first");
                row.append(el("span", name), el("span", value));
                permissions.append(row);
            }
            body.append(permissions, notice("權杖存在這支 iPhone 的 LedgerNook 資料夾，可修改整個帳本儲存庫", "key"));
            const stop = el("div", undefined, "lk-guide-stop-line");
            const disclosure = el("span", undefined, "lk-guide-stop-copy");
            const keyOff = icon("key_off", 16);
            keyOff.style.color = "var(--mute)";
            disclosure.append(keyOff, el("span", "停用：刪除權杖檔，並在 GitHub 撤銷"));
            const revoke = button("", () => guide("revoke", model.apps), "lk-auto-action lk-guide-step-button lk-guide-revoke");
            revoke.dataset.guideAction = "revoke";
            revoke.append(el("span", "撤銷"), icon("open_in_new", 15));
            stop.append(disclosure, revoke);
            body.append(stop);
            body.append(el("span", "再到捷徑 App 執行一次 LedgerNook Writer，貼上權杖、選帳本儲存庫", "lk-auto-step-detail"));
            const shortcuts = button("", () => guide("shortcuts", model.apps), "lk-auto-action lk-guide-step-button");
            shortcuts.dataset.guideAction = "shortcuts";
            shortcuts.append(el("span", "開啟捷徑 App"), icon("open_in_new", 16));
            body.append(shortcuts);
        }
        else if (step.id === "automation" && noBanks) {
            const copy = "只有現金，現金不用自動記帳。先新增一家銀行，這裡就會列出要勾選的 App。";
            const state = el("div", undefined, "lk-auto-empty-state");
            state.append(el("span", copy, "lk-auto-empty-copy"));
            const row = el("div", undefined, "lk-auto-empty-bank");
            row.append(icon("account_balance", 18), el("span", "還沒有銀行"));
            const action = button("", () => guide("addPaymentMethod", model.apps), "lk-auto-action lk-auto-empty-action");
            const pill = el("span", undefined, "lk-auto-empty-action-pill");
            pill.append(icon("add", 17), el("span", "新增付款方式"));
            action.append(pill);
            state.append(row, action);
            body.append(state);
        }
        else if (step.id === "automation") {
            const instructions = el("div", undefined, "lk-guide-instruction-list");
            const rows = ["自動化 → ＋ → App 通知", `勾選 ${model.apps.join("、")}`, "不加篩選條件", "立即執行，關閉「執行時通知」", "執行捷徑「LedgerNook Writer」，輸入選「捷徑輸入」"];
            for (const [index, copy] of rows.entries()) {
                const row = el("div", undefined, "lk-guide-instruction-row");
                row.append(el("span", String(index + 1), "lk-guide-instruction-number"), el("span", copy));
                instructions.append(row);
            }
            body.append(instructions);
            const actions = el("div", undefined, "lk-guide-step-actions");
            const diagram = button("", () => guide("automation", model.apps), "lk-auto-action lk-guide-step-button");
            diagram.dataset.guideAction = "automation";
            diagram.append(icon("photo_library", 17), el("span", "看圖解"));
            const shortcuts = button("", () => guide("shortcuts", model.apps), "lk-auto-action lk-guide-step-button");
            shortcuts.dataset.guideAction = "shortcuts";
            shortcuts.append(el("span", "開啟捷徑 App"), icon("open_in_new", 16));
            actions.append(diagram, shortcuts);
            body.append(actions);
        }
        card.append(mark, body);
        cards.append(card);
    }
    element.append(cards);
    return { element };
}
export function automaticCaptureDiagramView(apps, openShortcuts) {
    const element = el("div", undefined, "lk-auto-diagram");
    const head = (number, title) => {
        const row = el("div", undefined, "lk-auto-diagram-head");
        row.append(el("span", number, "lk-auto-diagram-number"), el("span", title));
        return row;
    };
    const panel = () => el("div", undefined, "lk-auto-diagram-panel");
    const row = (label, options = {}) => {
        const node = el("div", undefined, `lk-auto-diagram-row${options.first ? " lk-auto-diagram-row-first" : ""}`);
        if (options.icon)
            node.append(icon(options.icon, 19));
        node.append(el("span", label, "lk-auto-diagram-label"));
        if (options.value)
            node.append(el("span", options.value, "lk-auto-diagram-value"));
        if (options.check !== undefined) {
            const mark = icon("check", 20);
            mark.style.color = options.check ? "var(--acc)" : "transparent";
            node.append(mark);
        }
        if (options.trailing)
            node.append(options.trailing);
        return node;
    };
    element.append(head("1", "自動化 → ＋ → App 通知"));
    const selectedApps = panel();
    for (const [index, app] of apps.entries())
        selectedApps.append(row(app, { first: index === 0, icon: app === "錢包" ? "wallet" : "account_balance", check: true }));
    selectedApps.append(row("篩選條件", { first: apps.length === 0, icon: "filter_alt_off", value: "無" }));
    element.append(selectedApps, head("2", "執行方式"));
    const execution = panel();
    execution.append(row("執行前確認", { first: true, check: false }), row("立即執行", { check: true }), row("執行時通知", { trailing: switchTrack(false) }));
    element.append(execution, head("3", "動作"));
    const action = panel();
    action.append(row("執行捷徑", { first: true, icon: "play_circle", value: "LedgerNook Writer" }), row("輸入", { icon: "input", value: "捷徑輸入" }));
    const shortcuts = textAction("開啟捷徑 App", openShortcuts, "secondary");
    shortcuts.append(icon("open_in_new", 18));
    shortcuts.classList.add("lk-auto-diagram-shortcuts");
    element.append(action, shortcuts);
    return { element };
}
export function categoriesSettingsView(result, back, editCategory, editRule) {
    const element = settingsPage("分類與規則", back, 18);
    const categories = el("div", undefined, "lk-card lk-settings-card");
    for (const category of result.categories.filter(item => !item.parentId)) {
        const row = button("", () => editCategory(category.id), "lk-category-setting-row");
        const copy = el("span", undefined, "lk-category-setting-copy");
        copy.append(el("span", category.label));
        const children = result.categories.filter(item => item.parentId === category.id);
        if (children.length)
            copy.append(el("span", children.map(item => item.label).join("、"), "lk-muted"));
        const scope = icon(category.includeInDaily === false ? "do_not_disturb_on" : "home", 18);
        scope.setAttribute("aria-label", category.includeInDaily === false ? "不計入日常" : "計入日常");
        row.append(categoryBadge(categoryPresentation(result.categories, category.id), 32, 17), copy, scope);
        categories.append(row);
    }
    element.append(section("分類", categories, true));
    const legend = el("div", undefined, "lk-daily-legend");
    for (const [glyph, text] of [["home", "計入日常"], ["do_not_disturb_on", "不計入"]]) {
        const item = el("span");
        item.append(icon(glyph, 15), el("span", text));
        legend.append(item);
    }
    element.append(legend);
    const rules = el("div", undefined, "lk-card lk-settings-card");
    for (const rule of merchantRuleRows(result.userRules)) {
        const row = button("", () => editRule(rule.id), "lk-rule-setting-row");
        const copy = el("span", undefined, "lk-category-setting-copy");
        copy.append(el("span", rule.label));
        if (rule.aliases.length > 1)
            copy.append(el("span", rule.aliases.join(" · "), "lk-muted"));
        const category = result.categories.find(item => item.id === rule.categoryId);
        const label = category?.parentId ? `${result.categories.find(item => item.id === category.parentId)?.label} › ${category.label}` : category?.label ?? "未分類";
        const target = el("span", undefined, "lk-rule-category");
        target.append(categoryBadge(categoryPresentation(result.categories, rule.categoryId), 22, 13), el("span", label));
        row.append(copy, target);
        rules.append(row);
    }
    if (rules.childNodes.length)
        element.append(section("商家規則", rules, true));
    return { element };
}
export function closingDayControls(day, range, change, disabled = false) {
    const set = day != null;
    const element = el("div", undefined, "lk-closing-controls");
    const copy = el("span", undefined, "lk-closing-copy");
    copy.append(el("span", "結帳日"));
    if (set && range)
        copy.append(el("span", range, "lk-number lk-muted"));
    element.append(copy);
    let committedDay = day ?? null;
    const field = el("label", undefined, disabled ? "lk-closing-field lk-closing-disabled" : "lk-closing-field");
    const value = el("input", undefined, "lk-closing-value");
    value.type = "text";
    value.inputMode = "numeric";
    value.pattern = "[0-9]*";
    value.enterKeyHint = "done";
    value.placeholder = "不設定";
    value.value = committedDay === null ? "" : String(committedDay);
    value.disabled = disabled;
    value.setAttribute("inputmode", "numeric");
    value.setAttribute("pattern", "[0-9]*");
    value.setAttribute("enterkeyhint", "done");
    value.setAttribute("aria-label", "結帳日");
    const suffix = el("span", "日", "lk-closing-suffix");
    suffix.hidden = committedDay === null;
    const commit = () => {
        const parsed = parseClosingDay(value.value);
        if (parsed === undefined) {
            value.value = committedDay === null ? "" : String(committedDay);
            suffix.hidden = committedDay === null;
            return;
        }
        const changed = parsed !== committedDay;
        committedDay = parsed;
        value.value = parsed === null ? "" : String(parsed);
        suffix.hidden = parsed === null;
        if (changed)
            change(parsed);
    };
    value.addEventListener("input", () => { suffix.hidden = value.value === ""; });
    value.addEventListener("blur", commit);
    value.addEventListener("keydown", event => {
        if (event.key === "Enter") {
            event.preventDefault();
            commit();
        }
    });
    field.append(value, suffix);
    element.append(field);
    return element;
}
export function paymentMethodsView(methods, back, actions, walletCaptureSuspended = WALLET_CAPTURE_SUSPENDED) {
    const element = settingsPage("付款方式", back);
    element.append(el("span", "開啟的會出現在記一筆", "lk-setting-hint"));
    const card = el("div", undefined, "lk-card lk-settings-card lk-payment-method-list");
    const count = methods.filter(item => item.enabled).length;
    const readonly = actions.writable === false;
    for (const method of methods) {
        const row = el("div", undefined, "lk-payment-setting");
        const last = method.enabled && count === 1;
        row.dataset.paymentMethodId = method.id;
        row.dataset.paymentEnabled = String(method.enabled);
        const heading = el("div", undefined, "lk-payment-heading");
        heading.append(switchRow(method.label, method.enabled, () => actions.toggle(method.id), { detail: method.kind === "bank" ? "銀行通知" : method.kind === "custom" ? "自訂" : "", disabled: last || readonly, className: "lk-payment-toggle" }));
        if (method.enabled) {
            const handle = iconButton("drag_indicator", "排序", () => { }, 20);
            handle.classList.add("lk-method-order-handle");
            handle.disabled = readonly || count < 2 || actions.reorderDisabled === true;
            handle.setAttribute("aria-description", `${method.label}，使用上下方向鍵排序，按 Enter 儲存`);
            heading.append(handle);
        }
        row.append(heading);
        if (method.kind === "bank") {
            if (!walletCaptureSuspended)
                row.append(segments(["bank-app", "wallet"].map(source => ({ label: source === "bank-app" ? "銀行 App" : "Wallet", selected: method.source === source,
                    disabled: readonly || !method.sources?.includes(source), run: () => actions.source(method.id, source) }))));
            row.append(closingDayControls(method.closingDay, method.range ?? "", day => actions.closing(method.id, day), readonly));
        }
        card.append(row);
    }
    const live = el("span", undefined, "lk-method-order-status");
    live.setAttribute("role", "status");
    live.setAttribute("aria-live", "polite");
    live.setAttribute("aria-atomic", "true");
    const add = button("", actions.add, "lk-new-payment-action");
    add.append(icon("add", 19), el("span", "新增付款方式"));
    add.disabled = readonly;
    element.append(card, add, live);
    return { element, dispose: readonly || actions.reorderDisabled ? () => { } : attachPaymentMethodReorder(card, live, actions.reorder) };
}
export function timeZoneView(zone, instant, back, select, writable = true) {
    const element = settingsPage("報表時區", back);
    const card = el("div", undefined, "lk-card lk-settings-card");
    for (const [value, label] of reportingZonesAt(instant)) {
        const row = button("", () => select(value), "lk-zone-row");
        row.disabled = !writable;
        row.setAttribute("aria-pressed", String(value === zone));
        row.append(icon(value === zone ? "radio_button_checked" : "radio_button_unchecked", 22, value === zone), el("span", label));
        card.append(row);
    }
    element.append(card, el("span", "紀錄歸在哪一天", "lk-setting-hint"));
    return { element };
}
const AI_MODEL_NOTE = {
    pcc: "整理分類時，商家名稱會送到 Apple Private Cloud Compute，需要網路；金額、時間、銀行不會送出",
    device: "在 iPhone 上執行，不用網路",
};
const AI_DAILY_STEPS = ["自動化 → ＋ → 特定時間 → 每天", "立即執行", "執行捷徑「LedgerNook 整理分類」"];
function aiModelControl(model, select) {
    const control = el("div", undefined, "lk-ai-model-control");
    control.append(segments([
        { label: "Private Cloud Compute", selected: model === "pcc", run: () => select("pcc") },
        { label: "裝置端", selected: model === "device", run: () => select("device") },
    ]), el("span", AI_MODEL_NOTE[model], "lk-ai-model-note"));
    return control;
}
function aiGuideList(items) {
    const list = el("div", undefined, "lk-ai-guide-list");
    items.forEach((item, index) => {
        const row = el("div", undefined, "lk-ai-guide-item");
        if (items.length > 1)
            row.append(el("span", String(index + 1), "lk-ai-guide-number"));
        row.append(el("span", item));
        list.append(row);
    });
    return list;
}
function aiStepLink(label, runOpen) {
    if (!runOpen) {
        const link = el("a", undefined, "lk-auto-action lk-ai-step-link");
        link.href = LEDGERNOOK_ORGANISER_SHORTCUT_HREF;
        link.download = "LedgerNook 整理分類.shortcut";
        link.append(icon("download", 17), el("span", label));
        return link;
    }
    const button = el("button", undefined, "lk-auto-action lk-ai-step-link");
    button.type = "button";
    button.addEventListener("click", runOpen);
    button.append(el("span", label), icon("open_in_new", 16));
    return button;
}
function aiGuideStep(number, title, body, action) {
    const card = el("div", undefined, "lk-card lk-auto-step lk-ai-guide-step");
    const mark = el("span", undefined, "lk-auto-mark");
    mark.append(el("span", number, "lk-number"));
    const copy = el("div", undefined, "lk-auto-step-copy");
    copy.append(typeof title === "string" ? el("strong", title) : title);
    copy.append(body, action);
    card.append(mark, copy);
    return card;
}
function aiDailyGuide(open, toggle, runOpen) {
    const card = el("div", undefined, "lk-card lk-ai-daily-guide");
    const mark = el("span", undefined, "lk-ai-daily-mark");
    mark.append(icon("event_repeat", 18));
    const content = el("div", undefined, "lk-ai-daily-content");
    const header = el("button", undefined, "lk-ai-daily-toggle");
    header.type = "button";
    header.setAttribute("aria-expanded", String(open));
    header.setAttribute("aria-controls", "lk-ai-daily-instructions");
    header.addEventListener("click", toggle);
    const title = el("span", undefined, "lk-ai-daily-title lk-ai-guide-title");
    title.append(el("span", "每天自動整理"), el("span", "可選", "lk-ai-daily-optional"));
    header.append(title, icon(open ? "expand_less" : "expand_more", 20));
    content.append(header);
    if (open) {
        const list = aiGuideList(AI_DAILY_STEPS);
        list.id = "lk-ai-daily-instructions";
        content.append(list, aiStepLink("開啟捷徑 App", runOpen));
    }
    card.append(mark, content);
    return card;
}
export function aiSettingsView(result, organization, skipped, state, back, actions, writable) {
    const element = settingsPage("AI 整理", back);
    const suggestions = organization.suggestions.filter(item => !skipped.has(item.hash));
    if (!organization.organiserConfigured) {
        const backlog = el("div", undefined, "lk-card lk-ai-unclassified");
        const heading = el("span");
        heading.append(icon("question_mark", 15), el("span", "未分類"));
        backlog.append(heading, el("span", String(organization.unclassified.length), "lk-number"));
        const installBody = el("span", "需要 Apple Intelligence", "lk-auto-step-detail");
        const steps = el("div", undefined, "lk-auto-steps");
        steps.append(aiGuideStep("1", "加入捷徑", installBody, aiStepLink("LedgerNook 整理分類")));
        const dailyTitle = el("span", undefined, "lk-ai-guide-title");
        dailyTitle.append(el("span", "每天自動整理"), el("span", "可選", "lk-ai-daily-optional"));
        const dailyBody = aiGuideList(AI_DAILY_STEPS);
        steps.append(aiGuideStep("2", dailyTitle, dailyBody, aiStepLink("開啟捷徑 App", actions.openShortcuts)));
        const modelCard = el("div", undefined, "lk-card lk-ai-model-card");
        modelCard.append(aiModelControl(state.model, actions.model));
        if (organization.unclassified.length)
            element.append(backlog);
        element.append(steps, section("模型", modelCard, true));
        return { element };
    }
    const card = el("div", undefined, "lk-card lk-ai-controls");
    const counts = el("div", undefined, "lk-ai-counts");
    for (const [glyph, label, count] of [["question_mark", "未分類", organization.unclassified.length], ["auto_awesome", "待確認", suggestions.reduce((count, item) => count + item.count, 0)]]) {
        if (!count)
            continue;
        const item = el("div");
        const heading = el("span");
        heading.append(icon(glyph, 15), el("span", label));
        item.append(heading, el("span", String(count), "lk-number"));
        counts.append(item);
    }
    if (counts.childNodes.length)
        card.append(counts);
    card.append(el("span", "接受後變成規則", "lk-ai-explanation"), aiModelControl(state.model, actions.model));
    const run = textAction("", actions.run);
    run.classList.add("lk-ai-run");
    run.append(icon("auto_awesome", 19), el("span", "立即整理"));
    card.append(run);
    element.append(card);
    element.append(aiDailyGuide(state.dailyOpen, actions.toggleDaily, actions.openShortcuts));
    if (suggestions.length) {
        const list = el("div", undefined, "lk-card lk-settings-card");
        for (const suggestion of suggestions) {
            const row = el("div", undefined, "lk-ai-suggestion");
            const title = el("div", undefined, "lk-ai-suggestion-title");
            title.append(el("span", suggestion.merchant), el("span", `${suggestion.count} 筆`, "lk-muted"));
            const category = categoryPresentation(result.categories, suggestion.categoryId);
            const target = el("div", undefined, "lk-ai-suggestion-target");
            target.append(icon("arrow_forward", 16), categoryBadge(category, 24, 14), el("span", category.label));
            const buttons = el("div", undefined, "lk-ai-suggestion-actions");
            const no = button("略過", () => actions.skip(suggestion.hash), "lk-auto-action");
            const yes = button("接受", () => actions.accept(suggestion.hash), "lk-auto-action lk-ai-accept");
            yes.disabled = !writable;
            buttons.append(no, yes);
            row.append(title, target, buttons);
            list.append(row);
        }
        element.append(section("AI 建議", list, true));
    }
    return { element };
}
export function deviceSettingsView(state, back, actions) {
    const element = settingsPage("這台裝置", back, 18);
    const appearance = el("div", undefined, "lk-card lk-device-appearance");
    appearance.append(icon("contrast", 20), segments(["system", "light", "dark"].map(value => ({ label: value === "system" ? "系統" : value === "light" ? "淺色" : "深色", selected: state.appearance === value, run: () => actions.appearance(value) }))));
    element.append(appearance);
    const retention = el("div", undefined, "lk-card lk-settings-card");
    retention.append(switchRow("記住權杖", state.credential, actions.credential, { glyph: "key", detail: "下次不用再貼權杖", disabled: state.busy || state.demo }), switchRow("離線保留帳本", state.ledger, actions.ledger, { glyph: "cloud_download", detail: "離線可看；修改需要保留帳本", disabled: state.busy || state.demo }));
    element.append(section("保留在這台裝置", retention, true));
    const program = el("div", undefined, "lk-card lk-settings-card");
    const version = el("div", undefined, "lk-switch-row");
    version.append(el("span", "程式版本", "lk-switch-copy"), el("span", state.buildId === "development" ? "開發版" : state.buildId.slice(0, 8), "lk-number"));
    const reset = button("", actions.reset, "lk-switch-row");
    reset.setAttribute("aria-label", "重設程式");
    reset.disabled = state.resetting || state.busy || state.demo;
    const resetCopy = el("span", undefined, "lk-switch-copy");
    resetCopy.append(el("span", "重設程式"), el("span", "重新載入程式，帳本與權杖不變，需要網路", "lk-muted"));
    reset.append(icon("refresh", 20), resetCopy);
    program.append(version, reset);
    element.append(section("程式", program, true));
    const forget = el("div", undefined, "lk-card lk-settings-card");
    if (state.ask)
        forget.append(destructiveConfirmation("忘記這台裝置的資料？", state.pendingCount
            ? `還有 ${state.pendingCount} 筆變更待同步，忘記後會捨棄。只清除這台裝置，GitHub 上的帳本不變`
            : "只清除這台裝置，GitHub 上的帳本不變", "忘記", actions.cancel, actions.forget));
    else {
        const control = button("", actions.ask, "lk-forget-action");
        control.append(icon("delete", 20), el("span", "忘記這台裝置的資料"));
        forget.append(control);
    }
    element.append(forget);
    return { element };
}
