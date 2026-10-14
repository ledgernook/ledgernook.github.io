import { el } from "./dom.js";
import { iconButton } from "./icons.js";
import { writingIndicator } from "./shared-controls.js";
/** Fixed-currency markup; the keypad owns focus and integer TWD input. */
export function twdEntryField(value, source, own, focused, pending, focus, restore, compact = false, approximate = false) {
    const field = el("div", undefined, `lk-twd-field${compact ? " lk-add-twd" : ""}`);
    field.dataset.own = String(own);
    field.dataset.focused = String(focused);
    const target = el("button", undefined, "lk-twd-target");
    target.type = "button";
    target.setAttribute("aria-label", "TWD 金額");
    target.addEventListener("click", focus);
    target.append(el("span", "TWD", "lk-twd-label lk-number"));
    if (compact)
        target.append(el("span", source, "lk-twd-source lk-number"));
    if (pending)
        target.append(writingIndicator(20));
    else {
        const amount = el("span", undefined, "lk-twd-value lk-number");
        if (approximate) {
            amount.dataset.approximate = "true";
            amount.append(el("span", "約 ", "lk-record-approx"), el("span", value, "lk-number"));
        }
        else
            amount.textContent = value;
        target.append(amount);
    }
    if (focused)
        target.append(el("span", undefined, "lk-entry-caret"));
    field.append(target);
    if (own) {
        const revert = iconButton("restart_alt", "還原", restore, 18);
        revert.classList.add("lk-twd-restore");
        field.append(revert);
    }
    return field;
}
