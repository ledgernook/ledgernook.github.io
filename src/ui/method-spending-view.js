import { el } from "./dom.js";
import { icon, iconButton } from "./icons.js";
import { listSortControl, notice, periodStepRow, recordList, section } from "./shared-controls.js";
/** The existing project page chrome over the shared RecordRow list. */
export function methodSpendingView(model, actions) {
    const element = el("div", undefined, "lk-project-page lk-method-spending lk-feature-view");
    const heading = el("div", undefined, "lk-project-page-heading");
    const back = iconButton("arrow_back", "返回", actions.back);
    back.classList.add("lk-page-back", "lk-edge-back");
    heading.append(back, el("h1", model.label));
    element.append(heading);
    const totals = el("div", undefined, "lk-project-totals");
    const period = periodStepRow(model.period, actions.step, { nextEnabled: model.nextEnabled });
    const money = el("div", undefined, "lk-project-total-money");
    money.append(el("span", "NT$", "lk-money-prefix"), el("span", model.net, "lk-number"));
    if (!model.complete) {
        money.style.color = "var(--mute)";
        const marker = el("span", undefined, "lk-incomplete-marker");
        marker.setAttribute("aria-label", "不完整");
        marker.append(icon("hourglass_bottom", 16));
        money.append(marker);
    }
    totals.append(period, money);
    element.append(totals);
    if (model.coverageDisclosure)
        element.append(notice(model.coverageDisclosure, "error_outline"));
    if (model.conversionDisclosure)
        element.append(notice(model.conversionDisclosure, "error_outline"));
    if (model.records.length)
        element.append(section("紀錄", recordList(model.records, actions, { emptyText: false, asOf: model.asOf, grouped: model.sort === "date" }), false, listSortControl(model.sort, value => actions.sort?.(value), "付款方式紀錄排序")));
    return { element };
}
