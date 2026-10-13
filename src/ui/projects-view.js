import { el } from "./dom.js";
import { icon, iconButton } from "./icons.js";
import { button, dailyScopeRow, categoryBadge, dayHeader, listSortControl, nativeDateInput, recordList, section, segments, syncRecoveryNotice } from "./shared-controls.js";
import { screenDateFormatter } from "./screen-date-format.js";
import { shiftDate } from "./ledger-format.js";
export function projectsListView(model, actions) {
    const element = el("div", undefined, "lk-projects lk-feature-view");
    const heading = el("div", undefined, "lk-projects-heading");
    heading.append(el("h1", "專案"), iconButton("add", "新專案", actions.create));
    const period = el("div", undefined, "lk-project-period-row");
    period.append(el("span", "全部期間", "lk-project-period"));
    const sort = listSortControl(model.sort, actions.sort, "專案排序", "開始日");
    period.append(sort);
    element.append(heading, period);
    element.append(projectListCard(model.active, false, actions.open));
    if (model.archived.length) {
        const archived = el("section", undefined, "lk-project-archived");
        archived.append(el("h2", "已封存"), projectListCard(model.archived, true, actions.open));
        element.append(archived);
    }
    return { element };
}
function projectListCard(items, archived, open) {
    const card = el("div", undefined, `lk-card lk-project-list${archived ? " lk-project-list-archived" : ""}`);
    for (const item of items) {
        const row = button("", () => open(item.project.id), "lk-project-row");
        row.classList.add("lk-page-row");
        row.setAttribute("data-page-id", item.project.id);
        const info = el("span", undefined, "lk-project-row-info");
        const name = el("span", undefined, "lk-project-row-name");
        name.append(el("span", item.project.label));
        if (item.trip) {
            const tag = el("span", undefined, "lk-project-trip-tag");
            tag.setAttribute("aria-label", "旅行中");
            tag.append(icon("luggage", 13));
            name.append(tag);
        }
        const meta = [item.span, item.count].filter(Boolean).join(" · ");
        info.append(name);
        if (meta)
            info.append(el("span", meta, "lk-project-meta"));
        if (item.warning)
            info.append(el("span", item.warning, "lk-project-warning"));
        const amount = el("span", undefined, "lk-project-row-amount");
        if (item.recognized)
            amount.append(el("span", item.recognized, "lk-number"));
        if (item.syncState === "failed") {
            const mark = icon("error", 14);
            mark.classList.add("lk-row-sync-state");
            mark.dataset.state = "failed";
            mark.removeAttribute("aria-hidden");
            mark.setAttribute("role", "img");
            mark.setAttribute("aria-label", "未能同步");
            amount.prepend(mark);
        }
        if (item.hasFuture)
            amount.append(el("span", `另有分期 ${item.future}`, "lk-project-future lk-number"));
        row.append(info);
        if (item.recognized || item.hasFuture || item.syncState === "failed")
            row.append(amount);
        card.append(row);
    }
    return card;
}
export function projectPageView(model, options) {
    const { actions } = options;
    const element = el("div", undefined, "lk-project-page lk-feature-view");
    const heading = el("div", undefined, "lk-project-page-heading");
    const back = iconButton("arrow_back", "返回", actions.back);
    back.classList.add("lk-page-back", "lk-edge-back");
    heading.append(back, el("h1", model.project.label), iconButton("edit", "編輯", actions.rename), iconButton("playlist_add", "加入紀錄", actions.batch), iconButton(model.project.archived ? "unarchive" : "inventory_2", model.project.archived ? "取消封存" : "封存", actions.archive), iconButton("delete", "刪除專案", actions.delete));
    element.append(heading);
    if (options.recovery)
        element.append(syncRecoveryNotice(options.recovery.copy, options.writable, options.recovery));
    if (options.notice)
        element.append(el("p", options.notice, "lk-notice"));
    if (options.confirmArchive) {
        const confirm = el("div", undefined, "lk-project-archive-confirm");
        confirm.append(el("span", "移到已封存"));
        const actionsRow = el("div", undefined, "lk-project-confirm-actions");
        actionsRow.append(button("取消", actions.cancelArchive, "lk-project-secondary"), button("封存", actions.confirmArchive, "lk-project-primary"));
        confirm.append(actionsRow);
        element.append(confirm);
    }
    if (options.confirmDelete) {
        const confirm = el("div", undefined, "lk-project-archive-confirm lk-project-delete-confirm");
        confirm.append(el("span", "刪除這個專案？"));
        const actionsRow = el("div", undefined, "lk-project-confirm-actions");
        const cancel = button("取消", actions.cancelDelete, "lk-project-secondary");
        const remove = button("刪除專案", actions.confirmDelete, "lk-project-primary");
        cancel.disabled = options.deleting;
        remove.disabled = options.deleting;
        actionsRow.append(cancel, remove);
        confirm.append(actionsRow);
        element.append(confirm);
    }
    if (model.project.archived) {
        const archived = el("div", undefined, "lk-project-archived-notice");
        archived.append(icon("inventory_2", 17), el("span", "已封存"));
        element.append(archived);
    }
    const totals = el("div", undefined, "lk-project-totals");
    totals.append(el("span", "全部期間", "lk-project-period lk-project-total-period"));
    const money = el("div", undefined, "lk-project-total-money");
    money.append(el("span", "NT$", "lk-money-prefix"), el("span", model.recognized, "lk-number"));
    if (model.recognized)
        totals.append(money);
    if (model.showBreakdown) {
        const breakdown = el("div", undefined, "lk-project-total-breakdown lk-number");
        breakdown.append(el("span", `支出 ${model.expense}`), el("span", `退款 ${model.refund}`));
        totals.append(breakdown);
    }
    if (model.hasFuture)
        totals.append(el("span", `未到期分期 ${model.future} · 全部到期共 ${model.overall}`, "lk-project-total-future lk-number"));
    element.append(totals);
    for (const warning of model.warning)
        element.append(el("p", warning, "lk-notice"));
    if (!model.project.archived) {
        element.append(projectTripRow(model, actions.trip, actions.tripCurrency));
    }
    if (model.categories.length) {
        const categoryCard = el("div", undefined, "lk-card lk-project-category-list");
        for (const category of model.categories) {
            const row = button("", () => actions.category(category.id), "lk-project-category-row");
            row.setAttribute("data-category-id", category.id);
            row.setAttribute("aria-pressed", String(category.selected));
            row.setAttribute("aria-expanded", String(category.selected));
            const summary = el("span", undefined, "lk-project-category-summary");
            summary.style.opacity = model.selectedCategoryId !== null && !category.selected ? "0.5" : "1";
            const values = el("span", undefined, "lk-project-category-values");
            values.append(el("span", category.label), el("span", category.amount, "lk-number"));
            const track = el("span", undefined, "lk-project-category-track");
            const fill = el("span");
            fill.style.width = category.width;
            fill.style.background = category.presentation.color;
            track.append(fill);
            const copy = el("span", undefined, "lk-project-category-copy");
            copy.append(values, track);
            summary.append(categoryBadge(category.presentation, 30, 16), copy);
            row.append(summary);
            if (category.selected && category.subcategories.length) {
                const subtotals = el("span", undefined, "lk-project-category-subtotals");
                for (const subtotal of category.subcategories) {
                    const line = el("span", undefined, "lk-project-category-subtotal");
                    line.append(el("span", subtotal.label), el("span", subtotal.amount, "lk-number"));
                    subtotals.append(line);
                }
                row.append(subtotals);
            }
            categoryCard.append(row);
        }
        element.append(section("主分類", categoryCard));
    }
    for (const plan of model.installments) {
        const card = el("div", undefined, "lk-card lk-project-installment");
        const copy = el("span", undefined, "lk-project-installment-copy");
        copy.append(el("span", `剩餘分期 · ${plan.title}`), el("span", `下一期 ${plan.next}`, "lk-project-meta"));
        const amount = el("span", undefined, "lk-project-installment-amount");
        amount.append(el("span", plan.remaining, "lk-number"), el("span", plan.count, "lk-project-meta"));
        card.append(icon("event_repeat", 20), copy, amount);
        element.append(card);
    }
    if (model.records.length) {
        const rows = recordList(model.records, { open: actions.openRecord, quick: actions.quick }, { emptyText: false, asOf: model.asOf, grouped: model.sort === "date" });
        element.append(section("紀錄", rows, false, listSortControl(model.sort, value => actions.sort?.(value), "專案紀錄排序")));
    }
    return { element };
}
function projectTripRow(model, toggle, changeCurrency) {
    const row = el("div", undefined, "lk-project-trip-card");
    row.append(icon("luggage", 20), el("span", "旅行中", "lk-project-trip-label"));
    const currency = button(model.tripCurrency, changeCurrency, "lk-project-trip-currency");
    currency.setAttribute("aria-label", "旅行幣別");
    row.append(currency);
    const control = button("", toggle, "lk-project-trip-toggle");
    control.setAttribute("role", "switch");
    control.setAttribute("aria-label", "旅行中");
    control.setAttribute("aria-checked", String(model.isTrip));
    const track = el("span", undefined, "lk-switch");
    track.dataset.on = String(model.isTrip);
    track.append(el("span"));
    control.append(track);
    row.append(control);
    return row;
}
export function projectNameSheetView(options) {
    const element = el("div", undefined, "lk-project-name-sheet");
    const input = el("input");
    input.type = "text";
    input.maxLength = 40;
    input.autocomplete = "off";
    input.placeholder = "專案名稱";
    input.value = options.initialName;
    input.setAttribute("aria-label", "專案名稱");
    let dailyIncluded = options.dailyIncluded;
    const save = button("", () => options.save(input.value.trim(), dailyIncluded), "lk-project-save");
    save.setAttribute("aria-label", options.saveLabel);
    save.append(icon("check", 22));
    save.disabled = !input.value.trim();
    input.addEventListener("input", () => { save.disabled = !input.value.trim(); });
    const row = el("div", undefined, "lk-project-name-row");
    row.append(input, save);
    element.append(row);
    if (dailyIncluded !== undefined) {
        let currentRow = dailyScopeRow(dailyIncluded, toggle);
        function toggle() {
            dailyIncluded = !dailyIncluded;
            const next = dailyScopeRow(dailyIncluded, toggle);
            currentRow.replaceWith(next);
            currentRow = next;
        }
        element.append(currentRow);
    }
    element.append(el("span", options.note, "lk-project-meta"));
    return { element };
}
export function projectBatchSheetView(options) {
    const element = el("div", undefined, "lk-project-batch-sheet");
    const rangeDates = screenDateFormatter(options.today, [...(options.from ? [options.from] : []), options.to]);
    const earliest = options.earliest && options.earliest <= options.today ? options.earliest : options.today;
    const fromButton = dateButton("開始日期", options.from, earliest, options.to, rangeDates, date => options.actions.range(date, date > options.to ? date : options.to));
    const toButton = dateButton("結束日期", options.to, options.from && options.from > earliest ? options.from : earliest, options.today, rangeDates, date => options.actions.range(options.from && options.from > date ? date : options.from, date));
    const range = el("div", undefined, "lk-project-batch-range");
    range.append(fromButton, el("span", "–", "lk-project-range-separator"), toButton);
    element.append(range);
    element.append(segments([
        { label: "近 7 天", selected: options.from === shiftDate(options.today, -6) && options.to === options.today, run: () => options.actions.quick("week") },
        { label: "近 30 天", selected: options.from === shiftDate(options.today, -29) && options.to === options.today, run: () => options.actions.quick("month") },
        { label: "全部", selected: options.from === null && options.to === options.today, run: () => options.actions.quick("all") },
    ]));
    const card = el("div", undefined, "lk-card lk-project-batch-list");
    let previous = "";
    let hasDayHeader = false;
    for (const item of options.rows) {
        const newDate = item.row.date !== previous;
        if (newDate) {
            dayHeader(card, item.row.date, options.today, !hasDayHeader);
            hasDayHeader = true;
        }
        const checked = options.selected.has(item.record.id);
        const row = button("", () => options.actions.toggle(item.record.id), "lk-project-batch-row");
        row.setAttribute("aria-pressed", String(checked));
        row.setAttribute("aria-label", `${checked ? "已選取" : "選取"} ${item.row.title} ${item.row.amount}`);
        row.disabled = options.busy;
        const check = el("span", undefined, "lk-project-check");
        check.dataset.selected = String(checked);
        if (checked)
            check.append(icon("check", 15));
        const body = el("span", undefined, "lk-project-batch-copy");
        body.append(el("span", item.row.title, "lk-project-batch-title"), el("span", item.row.subline, "lk-project-meta"));
        const money = el("span", undefined, "lk-project-batch-amount");
        money.append(el("span", item.row.amount, "lk-number"), el("span", item.row.secondary, "lk-project-meta lk-number"));
        row.append(check, categoryBadge(item.row.category, 30, 16), body, money);
        card.append(row);
        previous = item.row.date;
    }
    element.append(card);
    if (options.message)
        element.append(el("p", options.message, "lk-notice"));
    const action = el("div", undefined, "lk-project-batch-action");
    const selectedIds = options.rows.filter(item => options.selected.has(item.record.id)).map(item => item.record.id);
    const count = selectedIds.length;
    const add = button(count ? `加入 ${count} 筆` : "加入", () => options.actions.assign(selectedIds), "lk-project-primary");
    add.disabled = count === 0 || options.busy;
    action.append(add);
    element.append(action);
    return { element };
}
function dateButton(label, value, min, max, dates, change) {
    const wrap = el("div", undefined, "lk-project-date-control");
    const control = el("label", undefined, "lk-project-date-button");
    control.setAttribute("aria-label", label);
    control.append(icon("event", 17), el("span", value ? dates.day(value) : "最早", "lk-number"));
    control.append(nativeDateInput(value ?? "", min, max, label, change));
    wrap.append(control);
    return wrap;
}
