import { el } from "./dom.js";
import { icon } from "./icons.js";
import { button, categoryBadge, notice, recordList, section, segments } from "./shared-controls.js";
export function overviewView(model, skin, companion, sceneSize, actions) {
    const element = el("div", undefined, "lk-overview lk-feature-view");
    if (actions.unrecorded)
        element.classList.add("lk-overview-with-unrecorded");
    const summary = el("div", undefined, "lk-overview-summary");
    const totals = el("div", undefined, "lk-overview-totals");
    const scope = segments([{ label: "全部", selected: model.scope === "all", run: () => actions.scope("all") },
        { label: "日常", selected: model.scope === "daily", run: () => actions.scope("daily") }]);
    scope.setAttribute("aria-label", "記帳範圍");
    totals.append(scope, el("span", model.month, "lk-month-label"));
    const money = el("div", undefined, "lk-overview-money");
    money.append(el("span", "NT$", "lk-money-prefix"), el("span", model.net, "lk-number"));
    if (!model.result.complete) {
        money.style.color = "var(--mute)";
        const marker = el("span", undefined, "lk-incomplete-marker");
        marker.setAttribute("aria-label", "不完整");
        marker.append(icon("hourglass_bottom", 16));
        money.append(marker);
    }
    const breakdown = el("div", undefined, "lk-overview-breakdown lk-number");
    breakdown.append(el("span", `支出 ${model.expense}`), el("span", `退款 ${model.refund}`));
    if (model.showNet)
        totals.append(money);
    if (model.showBreakdown)
        totals.append(breakdown);
    const sceneHost = el("div", undefined, "lk-scene-host");
    const largeScene = sceneSize === "large";
    const companionArt = skin.companion(companion.state, { scale: largeScene ? 1.1 : .72 });
    companionArt.setAttribute("role", "img");
    companionArt.setAttribute("aria-label", "帳本小窩");
    const scene = skin.scene(companionArt, { large: largeScene, trip: !!actions.trip });
    if (actions.trip) {
        const pill = button("", actions.trip.run, "nk-trip-pill");
        pill.setAttribute("aria-label", actions.trip.accessibleName);
        const label = el("span", actions.trip.label);
        label.setAttribute("aria-hidden", "true");
        pill.append(icon("luggage", 16), label);
        pill.addEventListener("click", event => event.stopPropagation());
        scene.append(pill);
        // Do not nest interactive controls inside another button.
        const host = el("div", undefined, "lk-scene-host");
        host.append(scene);
        summary.append(totals, host);
    }
    else {
        sceneHost.append(scene);
        summary.append(totals, sceneHost);
    }
    element.append(summary);
    if (model.coverageDisclosure)
        element.append(notice(model.coverageDisclosure, "error_outline"));
    if (model.conversionDisclosure)
        element.append(notice(model.conversionDisclosure, "error_outline"));
    if (actions.unrecorded)
        element.append(actions.unrecorded.element);
    if (actions.firstCapture) {
        const card = el("div", undefined, "lk-card lk-capture-card");
        const open = button("", actions.firstCapture.open, "lk-capture-open");
        const glyph = el("span", undefined, "lk-capture-glyph");
        glyph.append(icon("bolt", 19));
        const copy = el("span", undefined, "lk-capture-copy");
        copy.append(el("span", "設定 iPhone 自動記帳"), el("span", "尚未收到第一筆", "lk-muted"));
        open.append(glyph, copy);
        card.append(open);
        element.append(card);
    }
    const pins = el("div", undefined, "lk-pins");
    for (const pin of model.pins) {
        const card = el("div", undefined, "lk-card lk-pin");
        const amount = el("span", undefined, "lk-number lk-pin-amount");
        if (pin.complete)
            amount.append(el("span", pin.amount));
        else {
            const marker = el("span", undefined, "lk-incomplete-marker");
            marker.setAttribute("aria-label", "不完整");
            marker.append(icon("hourglass_bottom", 14));
            amount.append(marker, el("span", pin.amount));
        }
        card.append(categoryBadge(pin), el("span", pin.label, "lk-pin-label"), amount);
        pins.append(card);
    }
    if (model.pins.length)
        element.append(pins);
    const billing = el("div", undefined, "lk-card lk-billing");
    for (const row of model.billingRows) {
        const item = button("", () => actions.method?.(row.id), "lk-billing-row");
        item.setAttribute("data-payment-method-key", row.id);
        const rangeText = row.range ? `${row.range}${row.complete ? "" : " · 不完整"}` : row.complete ? "" : "不完整";
        const range = el("span", rangeText, "lk-billing-range lk-number");
        item.setAttribute("aria-label", [row.label, rangeText, row.amount].filter(Boolean).join(" "));
        const amount = el("span", undefined, "lk-billing-amount lk-number");
        if (row.complete)
            amount.append(el("span", row.amount));
        else {
            const marker = el("span", undefined, "lk-incomplete-marker");
            marker.setAttribute("aria-label", "不完整");
            marker.append(icon("hourglass_bottom", 13));
            amount.append(marker, el("span", row.amount));
        }
        item.append(el("span", row.label), range, amount);
        billing.append(item);
    }
    if (model.billingRows.length)
        element.append(section("帳單週期", billing));
    const aside = actions.records ? el("aside", undefined, "lk-recent-aside") : undefined;
    if (aside && actions.records) {
        if (actions.records.unclassifiedCount > 0) {
            const unclassified = button("", () => actions.records.open("unclassified"), "lk-recent-unclassified");
            unclassified.setAttribute("aria-label", "只看未分類");
            unclassified.append(icon("question_mark", 17), el("span", String(actions.records.unclassifiedCount), "lk-number"));
            aside.append(unclassified);
        }
        const search = button("", () => actions.records.open("search"), "lk-recent-search");
        search.setAttribute("aria-label", "紀錄");
        search.append(icon("search", 19));
        aside.append(search);
    }
    if (actions.emptyLedger && model.recent.length === 0) {
        const empty = el("div", undefined, "lk-card lk-overview-empty");
        empty.append(icon("receipt_long", 26));
        const recent = section("最近", empty, false, aside);
        recent.classList.add("lk-overview-recent");
        element.append(recent);
    }
    else {
        const recent = section("最近", recordList(model.recent, actions, { asOf: model.result.asOf }), false, aside);
        recent.classList.add("lk-overview-recent");
        element.append(recent);
    }
    return { element };
}
