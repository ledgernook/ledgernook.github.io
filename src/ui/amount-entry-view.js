import { currencyScale } from "../core/index.js";
import { el } from "./dom.js";
import { icon, saveCheckIcon } from "./icons.js";
import { button, writingIndicator } from "./shared-controls.js";
/** Amount display and keypad shared with ＋; omitting the picker fixes the currency. */
export function amountEntryField(amount, currency, pickCurrency) {
    const field = el("div", undefined, "lk-entry-amount");
    const code = pickCurrency ? button(currency, pickCurrency, "lk-currency lk-number") : el("span", currency, "lk-currency lk-number");
    if (pickCurrency)
        code.setAttribute("aria-label", "幣別");
    const value = el("input", undefined, "lk-entry-value lk-number");
    value.type = "text";
    value.inputMode = "none";
    value.readOnly = true;
    value.setAttribute("aria-label", "金額");
    const [whole, fraction] = amount.split(".");
    value.value = `${Number(whole || 0).toLocaleString("en-US")}${amount.includes(".") ? `.${fraction ?? ""}` : ""}`;
    value.dataset.zero = String(!Number(amount));
    field.append(code, value, el("span", undefined, "lk-entry-caret"));
    return field;
}
export function amountEntryKeypad(currency, state, enabled, key, save, saveLabel = "記一筆", fractional = currency !== "TWD") {
    const keypad = el("div", undefined, "lk-keypad");
    const remove = button("", () => key("delete"), "lk-key lk-key-delete");
    remove.setAttribute("aria-label", "刪除");
    remove.append(icon("backspace", 22));
    const confirm = button("", save, "lk-key lk-key-save");
    confirm.setAttribute("aria-label", state === "saving" ? "寫入中" : state === "failed" ? "重試" : saveLabel);
    confirm.dataset.state = state;
    confirm.disabled = state === "saving" || !enabled;
    confirm.append(state === "saving" ? writingIndicator(44) : state === "failed" ? icon("refresh", 44) : saveCheckIcon());
    keypad.append(remove, confirm);
    for (const digit of ["1", "2", "3", "4", "5", "6", "7", "8", "9", fractional && currencyScale(currency) ? "." : "", "0", ""]) {
        const control = button(digit, () => key(digit), "lk-key");
        if (!digit) {
            control.style.visibility = "hidden";
            control.tabIndex = -1;
        }
        keypad.append(control);
    }
    return keypad;
}
