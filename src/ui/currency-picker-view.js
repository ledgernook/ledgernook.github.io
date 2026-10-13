import { currencyChoices, filterCurrencyChoices } from "./currency-picker-model.js";
import { el } from "./dom.js";
import { icon } from "./icons.js";
import { button, section } from "./shared-controls.js";
export function currencyPickerView(selected, frequent, choose) {
    const element = el("div", undefined, "lk-currency-picker");
    const search = el("input", undefined, "lk-currency-search");
    search.type = "search";
    search.placeholder = "搜尋幣別";
    search.setAttribute("aria-label", "搜尋幣別");
    const content = el("div", undefined, "lk-currency-results"), choices = currencyChoices();
    function render() {
        const filtered = filterCurrencyChoices(choices, search.value);
        if (!filtered.length) {
            content.replaceChildren(el("p", "找不到幣別", "lk-muted"));
            return;
        }
        const group = el("div", undefined, "lk-currency-groups");
        for (const [label, rows] of [["常用", frequent.flatMap(code => filtered.filter(choice => choice.code === code))], ["全部", filtered]]) {
            if (!rows.length)
                continue;
            const list = el("div", undefined, "lk-new-bank-list");
            list.setAttribute("data-currency-section", label);
            list.setAttribute("role", "radiogroup");
            list.setAttribute("aria-label", label);
            for (const choice of rows) {
                const active = choice.code === selected;
                const row = button("", () => choose(choice.code), "lk-new-bank-option lk-currency-option");
                row.dataset.currency = choice.code;
                row.setAttribute("role", "radio");
                row.setAttribute("aria-checked", String(active));
                row.setAttribute("aria-label", choice.name === choice.code ? choice.code : `${choice.code} ${choice.name}`);
                row.append(icon(active ? "radio_button_checked" : "radio_button_unchecked", 21, active), el("span", choice.code, "lk-number"));
                if (choice.name !== choice.code)
                    row.append(el("span", choice.name, "lk-currency-name"));
                list.append(row);
            }
            group.append(section(label, list));
        }
        content.replaceChildren(group);
    }
    search.addEventListener("input", render);
    element.append(search, content);
    render();
    return { element };
}
