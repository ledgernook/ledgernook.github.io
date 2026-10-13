import { el } from "./dom.js";
import { icon, iconButton } from "./icons.js";
import { button, listSortControl, recordList } from "./shared-controls.js";
import { recordsModel } from "./records-model.js";
const PAGE_SIZE = 40;
export function recordsView(initial, actions) {
    const element = el("div", undefined, "lk-feature-view lk-records-screen");
    let state = initial;
    let unclassifiedOnly = false;
    let sort = initial.sort ?? "date";
    let visibleRows = PAGE_SIZE;
    let previousQuery = initial.query;
    let previousFilter = unclassifiedOnly;
    let previousFresh = "";
    const searchRow = el("div", undefined, "lk-record-search-row");
    const searchField = el("div", undefined, "lk-record-search-field");
    searchField.append(icon("search", 20));
    const input = el("input");
    input.type = "search";
    input.id = "record-search";
    input.placeholder = "搜尋";
    input.setAttribute("aria-label", "搜尋紀錄");
    input.autocomplete = "off";
    input.spellcheck = false;
    const clear = button("", () => { input.value = ""; actions.search(""); input.focus(); }, "lk-record-search-clear");
    clear.id = "search-clear";
    clear.setAttribute("aria-label", "清除");
    clear.hidden = true;
    clear.append(icon("close", 18));
    searchField.append(input, clear);
    const unclassified = button("", () => {
        unclassifiedOnly = !unclassifiedOnly;
        unclassified.setAttribute("aria-pressed", String(unclassifiedOnly));
        render();
    }, "lk-records-unclassified");
    unclassified.id = "uncat-only";
    unclassified.setAttribute("aria-label", "只看未分類");
    unclassified.setAttribute("aria-pressed", "false");
    unclassified.append(icon("question_mark", 19));
    const unclassifiedCount = el("span", "0", "lk-number");
    unclassified.append(unclassifiedCount);
    searchRow.append(searchField, unclassified);
    const count = el("div", undefined, "lk-record-search-count");
    count.id = "record-count";
    count.hidden = true;
    count.setAttribute("aria-live", "polite");
    const notice = el("div", undefined, "lk-record-search-notice");
    notice.id = "search-notice";
    notice.hidden = true;
    notice.setAttribute("role", "status");
    notice.setAttribute("aria-live", "polite");
    const listHost = el("div");
    listHost.id = "record-list-host";
    const sortHost = el("div", undefined, "lk-project-period-row");
    if (actions.back) {
        const heading = el("div", undefined, "lk-page-heading lk-records-heading");
        const back = iconButton("arrow_back", "返回", actions.back, 20);
        back.classList.add("lk-edge-back");
        heading.append(back, el("h1", "紀錄"));
        element.append(heading);
    }
    element.append(searchRow, count, notice, sortHost, listHost);
    input.addEventListener("input", () => actions.search(input.value));
    function render() {
        const changed = state.query !== previousQuery || unclassifiedOnly !== previousFilter;
        if (changed)
            visibleRows = PAGE_SIZE;
        previousQuery = state.query;
        previousFilter = unclassifiedOnly;
        input.value = state.query;
        clear.hidden = state.query.trim().length === 0;
        unclassified.setAttribute("aria-pressed", String(unclassifiedOnly));
        sortHost.replaceChildren(listSortControl(sort, value => { sort = value; visibleRows = PAGE_SIZE; render(); }, "紀錄排序"));
        const model = recordsModel({ ...state, sort, unclassifiedOnly, limit: visibleRows });
        unclassifiedCount.textContent = String(model.unclassifiedCount);
        unclassifiedCount.hidden = model.unclassifiedCount === 0;
        count.hidden = model.countLabel === null;
        count.textContent = model.countLabel ?? "";
        notice.hidden = model.incompleteNotice === null;
        notice.replaceChildren();
        if (model.incompleteNotice)
            notice.append(icon("history", 17), el("span", model.incompleteNotice));
        const rows = model.rows;
        previousFresh = [...state.freshRecordIds].join(",");
        const asOf = state.asOf ?? `${state.currentMonth}-01`;
        const listOptions = model.countLabel === null && !unclassifiedOnly ? { showNote: false, asOf } : { empty: { icon: "search_off", text: "沒有符合的紀錄" }, showNote: false, asOf };
        const list = recordList(rows, { open: actions.open, quick: actions.quick }, { ...listOptions, grouped: sort === "date" });
        for (const row of list.querySelectorAll(".lk-record-row")) {
            if (row.getAttribute("data-record-id") === state.openRecordId)
                row.setAttribute("data-open", "true");
        }
        list.id = "record-list";
        const children = [list];
        if (model.count > visibleRows) {
            children.push(button("顯示更多", () => { visibleRows += PAGE_SIZE; render(); }, "lk-records-more"));
        }
        listHost.replaceChildren(...children);
    }
    render();
    return { element, get unclassifiedOnly() { return unclassifiedOnly; }, get sort() { return sort; }, update(next) {
            const unchanged = state.query === next.query && state.result === next.result && state.allRecords === next.allRecords &&
                state.writable === next.writable && previousFresh === [...next.freshRecordIds].join(",");
            state = next;
            if (!unchanged) {
                render();
                return;
            }
            for (const row of listHost.querySelectorAll(".lk-record-row")) {
                if (row.getAttribute("data-record-id") === state.openRecordId)
                    row.setAttribute("data-open", "true");
                else
                    row.removeAttribute("data-open");
            }
        },
        setUnclassifiedOnly(on) { unclassifiedOnly = on; render(); }, focusSearch() { input.focus(); } };
}
