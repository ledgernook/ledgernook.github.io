import { el } from "./dom.js";
import { icon, iconButton } from "./icons.js";
import { button, categoryBadge, listSortControl, recordList, section, segments } from "./shared-controls.js";
import { sortRecordRows } from "./record-list-model.js";
import { categoryRecordRows, comparisonModel, scopeLabel } from "./report-model.js";
import { categoryPresentation } from "./category-presentation.js";
import { displayAmount } from "./ledger-format.js";
import { screenDateFormatter } from "./screen-date-format.js";
export function reportPeriodControl(label, comparison, scope, bounds, actions) {
    const row = el("div", undefined, "lk-report-controls lk-report-period-row");
    row.dataset.reportBase = "true";
    const arrow = (direction) => {
        if (comparison)
            return el("span", undefined, "lk-report-arrow-slot");
        const control = iconButton(direction < 0 ? "chevron_left" : "chevron_right", direction < 0 ? "上一期" : "下一期", () => actions.step?.(direction));
        control.disabled = direction < 0 ? !bounds.previousEnabled : !bounds.nextEnabled;
        return control;
    };
    const pill = button(label, actions.openPeriod, "lk-report-period-label");
    pill.setAttribute("aria-label", "報表期間");
    pill.setAttribute("aria-expanded", "false");
    row.append(arrow(-1), pill, arrow(1), segments([["all", "全部"], ["daily", "日常"]]
        .map(([value, text]) => ({ label: text, selected: scope === value, run: () => actions.scope(value) }))));
    return row;
}
function money(amount) {
    const node = el("div", undefined, "lk-report-money");
    node.append(el("span", "NT$", "lk-report-prefix"), el("strong", amount, "lk-number"));
    return node;
}
export function reportNotices(warnings) {
    return warnings.map(text => { const node = el("div", undefined, "lk-notice lk-report-notice"); node.append(icon("error_outline", 17), el("span", text)); return node; });
}
function shareChart(model, chart) {
    const card = el("div", undefined, `lk-card lk-report-chart lk-chart-${chart}`);
    card.setAttribute("role", "img");
    card.setAttribute("aria-label", `分類比例${chart === "grid" ? "，每格 1%" : ""}：${model.categories.filter(item => !item.netRefund).map(item => `${item.label} ${item.percentage}`).join("、")}`);
    if (chart === "bar") {
        const bar = el("div", undefined, "lk-share-bar");
        for (const category of model.categories.filter(item => item.share > 0)) {
            const part = el("span");
            part.style.flex = `0 1 ${category.share * 100}%`;
            part.style.background = category.color;
            if (category.share >= .08)
                part.append(icon(category.icon, 18));
            bar.append(part);
        }
        card.append(bar);
    }
    else if (chart === "grid") {
        for (const category of model.categories)
            for (let index = 0; index < category.cells; index++) {
                const cell = el("span");
                cell.style.background = category.color;
                if (!index)
                    cell.append(icon(category.icon, 15));
                card.append(cell);
            }
        while (card.childNodes.length < 100)
            card.append(el("span", undefined, "lk-grid-empty"));
    }
    else {
        const host = el("div", undefined, "lk-ring-host");
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", "0 0 200 200");
        const circumference = 2 * Math.PI * 70;
        for (const category of model.categories.filter(item => item.share > 0)) {
            const arc = category.share * circumference, width = Math.min(30, Math.max(6, arc - 6));
            const circle = document.createElementNS(svg.namespaceURI, "circle");
            for (const [name, value] of Object.entries({ cx: "100", cy: "100", r: "70", fill: "none", stroke: category.color, "stroke-width": String(width),
                "stroke-linecap": "round", "stroke-dasharray": `${Math.max(.01, arc - width - 6)} ${circumference}`,
                transform: `rotate(${category.start * 360 + (width / 2 + 3) / 70 * 180 / Math.PI - 90} 100 100)` }))
                circle.setAttribute(name, value);
            svg.append(circle);
            if (category.share >= .06) {
                const glyph = icon(category.icon, 17), mid = (category.start + category.share / 2) * Math.PI * 2;
                glyph.style.left = `${50 + 35 * Math.sin(mid)}%`;
                glyph.style.top = `${50 - 35 * Math.cos(mid)}%`;
                host.append(glyph);
            }
        }
        host.prepend(svg);
        card.append(host);
    }
    return card;
}
function comparisonDifference(diff) {
    const node = el("span", undefined, "lk-comparison-difference");
    node.append(el("span", diff.label), el("strong", diff.amount, "lk-number"));
    return node;
}
function comparisonGrid(years, color) {
    const grid = el("div", undefined, "lk-comparison-grid");
    years.forEach((year, index) => {
        const line = el("div", undefined, "lk-comparison-bar");
        line.dataset.newest = String(index === 0);
        line.dataset.year = String(year.year);
        const track = el("span", undefined, "lk-comparison-track"), fill = el("span");
        fill.style.width = `${year.width}%`;
        fill.style.background = index === 0 ? color : "var(--mute)";
        track.append(fill);
        line.append(el("span", year.label, "lk-comparison-year-label lk-number"), track, el("strong", year.amount, "lk-comparison-amount lk-number"));
        grid.append(line);
    });
    return grid;
}
function comparisonTotals(comparison, subscription, openSubscription) {
    const totals = el("div", undefined, "lk-card lk-report-comparison-totals");
    const heading = el("div", undefined, "lk-comparison-total-heading");
    const title = el("span", undefined, "lk-comparison-total-title");
    title.append(el("span", "總額"), el("span", "NT$"));
    heading.append(title);
    if (subscription !== undefined && openSubscription) {
        const control = iconButton("autorenew", "訂閱篩選", openSubscription);
        control.classList.add("lk-report-subscription-button");
        control.setAttribute("aria-pressed", String(subscription !== "all"));
        heading.append(control);
    }
    totals.append(heading, comparisonGrid(comparison.years, "var(--ink)"));
    if (comparison.difference) {
        const footer = el("div", undefined, "lk-comparison-footer");
        footer.append(comparisonDifference(comparison.difference));
        totals.append(footer);
    }
    return totals;
}
export function reportView(model, state, actions) {
    const element = el("div", undefined, "lk-report lk-feature-view");
    element.dataset.reportReady = "true";
    const primary = el("div", undefined, "lk-report-column lk-report-column-primary");
    const secondary = el("div", undefined, "lk-report-column lk-report-column-secondary");
    const arrangement = { kind: "columns", parts: { primary: [primary], secondary: [secondary] } };
    const baseModel = state.baseModel ?? model;
    const reportDay = screenDateFormatter(model.result.asOf, [], { alwaysYear: true }).day;
    primary.append(reportPeriodControl(baseModel.label, state.period === "yoy", model.result.report.scope, state.periodStep ?? { previousEnabled: false, nextEnabled: false }, actions));
    const reportSummary = (source) => {
        const summary = el("div", undefined, "lk-report-summary");
        summary.dataset.reportBase = "true";
        const total = el("div", undefined, "lk-report-total");
        if (source.showNet)
            total.append(money(source.net));
        if (source.showBreakdown)
            total.append(el("span", `支出 ${source.expense}　退款 ${source.refund}`, "lk-report-breakdown lk-number"));
        const charts = el("div", undefined, "lk-chart-controls");
        for (const [chart, glyph, label] of [["bar", "bar_chart", "長條"], ["ring", "donut_large", "圓環"], ["grid", "grid_view", "百格"]]) {
            const control = iconButton(glyph, label, () => actions.chart(chart));
            control.setAttribute("aria-pressed", String(state.chart === chart));
            charts.append(control);
        }
        const subscription = iconButton("autorenew", "訂閱篩選", actions.openSubscription);
        subscription.classList.add("lk-report-subscription-button");
        subscription.setAttribute("aria-pressed", String(state.subscription !== "all"));
        charts.append(subscription);
        summary.append(total, charts);
        return summary;
    };
    const baseWarnings = reportNotices(baseModel.warnings);
    baseWarnings.forEach(node => { node.dataset.reportBase = "true"; });
    const summary = reportSummary(baseModel), chart = shareChart(baseModel, state.chart);
    chart.dataset.reportBase = "true";
    if (state.category) {
        element.dataset.category = "true";
        primary.append(...baseWarnings, summary);
        if (baseModel.categories.length)
            primary.append(chart);
        const category = categoryPresentation(model.result.categories, state.category.report.filters.categoryId ?? null);
        const heading = el("div", undefined, "lk-report-category-header");
        const back = iconButton("arrow_back", "返回", actions.back);
        back.classList.add("lk-edge-back");
        heading.append(back, el("h1", category.label));
        back.setAttribute("data-edge-back-key", `category:${category.id ?? "uncategorized"}`);
        if (model.showNet)
            heading.append(money(model.net));
        const sort = state.recordSort ?? "amount";
        const label = el("div", undefined, "lk-report-label lk-report-sort");
        label.append(el("span", [model.label, model.scope === "日常" ? model.scope : ""].filter(Boolean).join(" · ")), listSortControl(sort, value => actions.sort?.(value), "報表分類紀錄排序"));
        secondary.append(heading, label, ...reportNotices(model.warnings), recordList(sortRecordRows(categoryRecordRows(state.category, model.result), sort), { open: actions.open, quick: () => { } }, { grouped: sort === "date", showNote: false, asOf: model.result.asOf, dateLabel: reportDay }));
        element.append(primary, secondary);
        return { element, arrangement };
    }
    if (state.comparison) {
        element.dataset.comparison = "true";
        const comparison = comparisonModel(state.comparison, model.result);
        primary.append(...reportNotices(comparison.warnings));
        const totals = comparisonTotals(comparison, state.subscription, actions.openSubscription);
        primary.append(totals);
        const rows = el("div", undefined, "lk-card lk-report-categories lk-comparison-categories");
        for (const category of comparison.categories) {
            const row = button("", () => actions.category(category.id), "lk-comparison-row");
            row.setAttribute("aria-label", category.label);
            const title = el("div", undefined, "lk-comparison-heading"), name = el("span", undefined, "lk-comparison-name");
            name.append(categoryBadge(category, 24, 14), el("span", category.label));
            title.append(name);
            if (category.difference)
                title.append(comparisonDifference(category.difference));
            row.append(title, comparisonGrid(category.years, category.color));
            rows.append(row);
        }
        if (state.categoryComparison) {
            element.dataset.category = "true";
            element.dataset.comparedCategory = "true";
            const detail = state.filteredComparison ?? state.categoryComparison;
            const category = categoryPresentation(model.result.categories, state.categoryComparison.years[0]?.report.filters.categoryId ?? null);
            const categoryModel = comparisonModel(detail, model.result), breakdown = comparisonModel(state.categoryComparison, model.result);
            const comparisonDates = detail.years.flatMap(year => [year.from, year.to]);
            const heading = el("div", undefined, "lk-report-category-header");
            const back = iconButton("arrow_back", "返回", actions.back);
            back.classList.add("lk-edge-back");
            back.setAttribute("data-edge-back-key", `comparison:${category.id ?? "uncategorized"}`);
            heading.append(back, categoryBadge(category, 30, 16), el("h1", category.label));
            const context = el("div", [breakdown.years.map(year => year.label).join(" · "), ...(comparison.samePeriod ? ["同期比較"] : []), ...(model.scope === "日常" ? [model.scope] : [])].join(" · "), "lk-report-label lk-comparison-context");
            const subcategories = el("div", undefined, "lk-card lk-comparison-subcategories");
            for (const subcategory of breakdown.subcategories) {
                const row = button("", () => actions.subcategory?.(subcategory.id), "lk-comparison-row");
                row.dataset.subcategoryId = subcategory.id ?? "";
                row.setAttribute("aria-label", subcategory.label);
                row.setAttribute("aria-pressed", String(state.subcategoryId === subcategory.id));
                if (state.subcategoryId !== undefined && state.subcategoryId !== subcategory.id)
                    row.style.opacity = ".5";
                const title = el("div", undefined, "lk-comparison-heading");
                title.append(el("span", subcategory.label, "lk-comparison-name"));
                if (subcategory.difference)
                    title.append(comparisonDifference(subcategory.difference));
                row.append(title, comparisonGrid(subcategory.years, category.color));
                subcategories.append(row);
            }
            const sort = state.recordSort ?? "amount", recordsHeading = el("div", undefined, "lk-report-sort lk-comparison-records-heading");
            recordsHeading.append(el("h2", "紀錄"), listSortControl(sort, value => actions.sort?.(value), "對比分類紀錄排序"));
            secondary.append(heading, context, ...reportNotices(categoryModel.warnings), comparisonTotals(categoryModel));
            if (breakdown.subcategories.length)
                secondary.append(section("子分類", subcategories));
            secondary.append(recordsHeading, recordList(sortRecordRows(categoryRecordRows(detail, model.result, comparisonDates), sort), { open: actions.open, quick: () => { } }, { grouped: sort === "date", showNote: false, asOf: model.result.asOf, dateLabel: reportDay }));
            element.append(primary, secondary);
            // Keep 返回 visible because this page replaces the category list.
            return { element, arrangement: { ...arrangement, navigation: { pageId: category.id } } };
        }
        if (comparison.categories.length)
            secondary.append(rows);
        element.append(primary, secondary);
        return { element, arrangement };
    }
    primary.append(...baseWarnings, summary);
    if (baseModel.categories.length)
        primary.append(chart);
    const categories = el("div", undefined, "lk-card lk-report-categories");
    for (const category of baseModel.categories) {
        const row = button("", () => actions.category(category.id), "lk-report-category-row");
        row.append(categoryBadge(category, 30, 16), el("span", category.label, "lk-report-category-name"));
        if (category.percentage)
            row.append(el("span", category.percentage, "lk-report-percent lk-number"));
        if (category.netRefund)
            row.append(el("span", "淨退款", "lk-report-percent"));
        row.append(el("strong", category.amount, "lk-report-amount lk-number"));
        categories.append(row);
    }
    if (baseModel.categories.length)
        secondary.append(categories);
    if (baseModel.plans.length) {
        const plans = el("section", undefined, "lk-report-plans");
        plans.dataset.anchor = "plans";
        const heading = el("div", undefined, "lk-plans-heading");
        heading.append(el("h2", "未到期分期（不分期間）"), el("strong", displayAmount(baseModel.balances.twd.remainingMinor), "lk-number"));
        plans.append(heading, el("span", `還沒入帳的分期${baseModel.balances.scope === "daily" ? ` · ${scopeLabel(baseModel.balances.scope)}` : ""}`, "lk-plans-note"));
        if (!baseModel.balances.twd.complete)
            plans.append(...reportNotices([`${baseModel.balances.twd.unconvertedCount} 筆分期缺少匯率，餘額不完整`]));
        const rows = el("div", undefined, "lk-card lk-plan-list");
        for (const plan of baseModel.plans) {
            const row = button("", () => actions.open(plan.id), "lk-plan-row"), body = el("span", undefined, "lk-plan-body"), amount = el("span", undefined, "lk-plan-money");
            body.append(el("span", plan.title), el("span", plan.sub), el("span", plan.next));
            amount.append(el("strong", plan.remaining, "lk-number"), el("span", plan.count));
            row.append(icon("event_repeat", 19), body, amount);
            rows.append(row);
        }
        plans.append(rows);
        secondary.append(plans);
    }
    const csv = button("", actions.csv, "lk-report-export");
    csv.append(icon("download", 19), el("span", "CSV"));
    secondary.append(csv);
    element.append(primary, secondary);
    return { element, arrangement };
}
export function csvSheetView(model, actions) {
    const element = el("div", undefined, "lk-csv-sheet");
    const scope = el("div", undefined, "lk-csv-scope");
    scope.append(el("span", `${model.label} · ${model.scope}`), el("span", `${model.csvRecordCount} 筆紀錄`));
    element.append(scope, ...reportNotices(model.warnings));
    const details = el("div", undefined, "lk-csv-details");
    for (const [glyph, label] of [["call_split", "拆帳每一行一列"], ["description", "不完整或未換算的金額會在檔案中標註"], ["link", "每列附 GitHub 連結"]]) {
        const row = el("div");
        row.append(icon(glyph, 17), el("span", label));
        details.append(row);
    }
    if (model.result.report.futureEntries.length) {
        const row = el("div");
        row.append(icon("event_repeat", 17), el("span", "包含期間內尚未認列的分期"));
        details.append(row);
    }
    const download = button("", actions.download, "lk-report-primary lk-csv-download");
    download.append(icon("download", 19), el("span", "匯出"));
    element.append(details, download);
    return { element };
}
