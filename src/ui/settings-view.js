import { categoryPresentation } from "./category-presentation.js";
import { el } from "./dom.js";
import { icon } from "./icons.js";
import { button, section, syncRecoveryNotice } from "./shared-controls.js";
import { failedSettingCopy, failedSettingRecoveryCopy, reportingZoneLabel } from "./settings-model.js";
import { readOnlyReasonCopy } from "./readonly-reason-view.js";
function syncErrorMark(label) {
    const mark = icon("error", 14);
    mark.classList.add("lk-setting-sync-error");
    mark.removeAttribute("aria-hidden");
    mark.setAttribute("role", "img");
    mark.setAttribute("aria-label", label);
    mark.dataset.syncState = "failed";
    return mark;
}
export function settingsView(session, result, preferences, status, trip, actions, failedSettings = []) {
    const element = el("div", undefined, "lk-settings lk-feature-view");
    const heading = el("div", undefined, "lk-page-heading");
    heading.append(el("h1", "設定"));
    element.append(heading);
    const connection = el("div", undefined, "lk-card lk-settings-card");
    const identity = el("div", undefined, "lk-connection-identity");
    identity.append(el("span", session.owner && session.repo ? `${session.owner}/${session.repo}` : session.label), el("span", `帳號 ${session.owner || "示範"} · ${session.branch || "main"} 分支`, "lk-muted"));
    connection.append(identity);
    if (session.capability.status === "read-only") {
        const reason = el("div", undefined, "lk-settings-readonly-reason");
        const label = el("span", undefined, "lk-settings-readonly-label");
        label.append(icon("lock", 18), el("span", "唯讀"));
        reason.append(label, el("span", readOnlyReasonCopy(session.capability), "lk-settings-readonly-copy"));
        if (session.capability.reason === "ledger-not-retained")
            reason.append(button("開啟保留帳本", () => actions.later("6i"), "lk-settings-recheck"));
        else if (session.capability.reason === "credential-needed")
            reason.append(button("更換權杖", () => actions.later("replace-token"), "lk-settings-recheck"));
        else
            reason.append(button("重新檢查寫入權限", () => actions.later("6p"), "lk-settings-recheck"));
        connection.append(reason);
    }
    const sync = el("div", undefined, "lk-settings-sync");
    const pendingCount = status.pendingCount ?? result.localChanges?.pendingCount ?? 0;
    const failedCount = result.localChanges?.failedCount ?? 0;
    const hasFailure = (target) => failedSettings.some(item => item.target === target);
    const recovery = (target) => failedSettings.filter(item => item.target === target).map(item => syncRecoveryNotice(failedSettingRecoveryCopy(target), session.capability.status === "writable", {
        resend: () => actions.recover(item.operationId, "resend"), discard: () => actions.recover(item.operationId, "discard"),
    }));
    const displayedStatus = session.capability.status === "read-only"
        ? `唯讀 · ${status.text}`
        : status.text;
    const syncMain = el("div", undefined, "lk-settings-sync-main");
    const syncStatus = el("span", undefined, "lk-settings-sync-status");
    syncStatus.append(icon(session.capability.status === "read-only" ? "lock" : status.icon, 18), el("span", displayedStatus, "lk-settings-sync-copy"));
    const synchronize = button("", actions.sync, "lk-settings-synchronize");
    synchronize.append(icon("refresh", 17), el("span", "同步"));
    syncMain.append(syncStatus, synchronize);
    sync.append(syncMain);
    if (failedCount > 0 || pendingCount > 0) {
        const counts = el("div", undefined, "lk-settings-sync-counts");
        if (failedCount > 0) {
            const failed = el("span", undefined, "lk-settings-failed-count");
            failed.dataset.failedCount = String(failedCount);
            failed.append(syncErrorMark("未能同步"), el("span", `未能同步 ${failedCount} 筆`));
            counts.append(failed, el("span", "需要重送或捨棄", "lk-muted lk-settings-sync-explanation"));
        }
        if (pendingCount > 0) {
            const pending = el("span", undefined, "lk-settings-pending-count");
            pending.dataset.pendingCount = String(pendingCount);
            pending.append(icon("cloud_sync", 14), el("span", `待同步 ${pendingCount} 筆`));
            counts.append(pending, el("span", "已存在這台裝置，連線後會自動送出", "lk-muted lk-settings-sync-explanation"));
        }
        sync.append(counts);
    }
    connection.append(sync);
    element.append(section("連線", connection, true));
    const accounting = el("div", undefined, "lk-card lk-settings-card");
    const zone = reportingZoneLabel(result.timeZone, `${result.asOf}T12:00:00Z`);
    for (const [glyph, label, description, route] of [
        ["bolt", "iPhone 自動記帳", result.captureEvidence.hasNotificationEvidence ? "已收到自動記帳" : "尚未收到第一筆", "5y"],
        ["sell", "分類與規則", "", "6a"], ["auto_awesome", "AI 整理", result.classificationGaps.unclassifiedCount ? `未分類 ${result.classificationGaps.unclassifiedCount} 筆` : "", "6d"],
        ["credit_card", "付款方式", "", "6f"], ["event_repeat", "定期支出", result.recurringRules.length ? `${result.recurringRules.length} 項` : "", "6fc"], ["schedule", "報表時區", zone, "6h"],
    ]) {
        const target = route === "6a" ? "categoriesRules" : route === "6d" ? "organiserModel" : route === "6f" ? "paymentMethods" : route === "6h" ? "reportingTimeZone" : null;
        const failed = target !== null && hasFailure(target);
        const item = button("", () => actions.later(route), "lk-settings-row");
        item.classList.add("lk-page-row");
        item.setAttribute("data-page-id", route);
        item.append(icon(glyph, 20), el("span", label), ...(failed ? [syncErrorMark(failedSettingCopy(target))] : []), el("span", description, "lk-setting-detail"));
        if (failed)
            item.dataset.settingSyncState = "failed";
        accounting.append(item);
    }
    element.append(section("記帳", accounting, true));
    const travel = el("div", undefined, "lk-card lk-settings-card");
    const toggle = button("", () => actions.trip({ on: !trip.on }), "lk-trip-toggle");
    toggle.disabled = session.capability.status !== "writable";
    toggle.setAttribute("role", "switch");
    toggle.setAttribute("aria-checked", String(trip.on));
    toggle.setAttribute("aria-label", "旅行中");
    const copy = el("span", undefined, "lk-trip-copy");
    copy.append(el("span", "旅行中"));
    if (trip.on)
        copy.append(el("span", `${result.projects.find(item => item.id === trip.projectId)?.label ?? "選擇專案"} · ${trip.currency}`, "lk-muted"));
    const track = el("span", undefined, "lk-switch");
    track.dataset.on = String(trip.on);
    track.append(el("span"));
    toggle.append(icon("luggage", 20), copy, ...(hasFailure("currentTrip") ? [syncErrorMark(failedSettingCopy("currentTrip"))] : []), track);
    travel.append(toggle);
    const choices = el("div", undefined, "lk-trip-choices");
    const projects = el("div", undefined, "lk-chip-wrap");
    for (const project of result.projects.filter(item => !item.archived)) {
        const chip = button(project.label, () => actions.trip({ projectId: project.id }));
        chip.disabled = session.capability.status !== "writable";
        chip.setAttribute("aria-pressed", String(project.id === trip.projectId));
        projects.append(chip);
    }
    const currencies = el("div", undefined, "lk-chip-wrap");
    const currency = button(trip.currency, actions.tripCurrency, "lk-number");
    currency.setAttribute("aria-label", "旅行幣別");
    currency.disabled = session.capability.status !== "writable";
    currency.setAttribute("aria-pressed", "true");
    currencies.append(currency);
    choices.append(projects, currencies);
    travel.append(choices);
    element.append(section("旅行中", travel, true), ...recovery("currentTrip"));
    const pins = el("div", undefined, "lk-card lk-settings-pins lk-chip-wrap");
    for (const category of result.categories.filter(item => !item.parentId)) {
        const chip = button("", () => actions.pin(category.id));
        chip.disabled = session.capability.status !== "writable";
        chip.setAttribute("aria-pressed", String(preferences.value.pinnedCategoryIds.includes(category.id)));
        chip.append(icon(categoryPresentation(result.categories, category.id).icon, 16), el("span", category.label));
        pins.append(chip);
    }
    element.append(section("總覽釘選 · 最多 3 個", pins, true, hasFailure("pinnedCategoryIds") ? syncErrorMark(failedSettingCopy("pinnedCategoryIds")) : undefined), ...recovery("pinnedCategoryIds"));
    const device = button("", () => actions.later("6i"), "lk-card lk-settings-row");
    device.classList.add("lk-page-row");
    device.setAttribute("data-page-id", "6i");
    device.append(icon("smartphone", 20), el("span", "這台裝置"));
    element.append(device);
    return { element };
}
