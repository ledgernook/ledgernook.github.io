import { categoryPresentation } from "./category-presentation.js";
import { el } from "./dom.js";
import { icon } from "./icons.js";
import { displayAmount, recordDate } from "./ledger-format.js";
import { recordPaymentMethodName } from "./payment-method-name.js";
import { exchangeRateRow, exchangeRateText, recordChipItems, recordFieldItems, recurringRowValue } from "./record-sheet-model.js";
import { recordCorrectionAvailability } from "../application/record-actions.js";
import { screenDateFormatter } from "./screen-date-format.js";
import { button, nativeDateInput } from "./shared-controls.js";
export function recordFieldsView(record, result, editable, actions, today = result.asOf) {
    const fields = el("div", undefined, "lk-record-detail-fields"), chips = el("div", undefined, "lk-record-detail-actions");
    const feedback = el("div", undefined, "lk-record-date-feedback");
    const on = recordDate(record, result.timeZone);
    const values = {
        recat: categoryPresentation(result.categories, record.categoryId).label,
        note: record.notes ?? "", method: recordPaymentMethodName(record.paymentMethod, result),
        amount: `${record.currency === "TWD" ? "" : `${record.currency} `}${displayAmount(record.amountMinor, record.currency)}`,
        date: screenDateFormatter(result.asOf, [on]).day(on),
        fx: exchangeRateText(exchangeRateRow(record), date => screenDateFormatter(result.asOf, [date]).date(date)),
        proj: result.projects.find(project => project.id === record.projectId)?.label ?? "",
        recur: recurringRowValue(record, result),
    };
    for (const item of recordFieldItems(record, result.report.records)) {
        const value = values[item.action] ?? "";
        const control = item.action === "date" ? el("label", undefined, "lk-record-detail-field lk-record-date")
            : button("", () => actions.action?.(item.action), "lk-record-detail-field");
        const display = el("span", value || "—", `lk-record-detail-value${value ? "" : " lk-record-empty"}`);
        if (item.action === "fx" && !record.reportingValue)
            display.classList.add("lk-record-empty");
        if (item.action === "recat" && !record.categoryId)
            display.dataset.strong = "true";
        control.append(icon(item.icon, 20), el("span", item.label), display);
        if (item.action === "date") {
            const earliest = result.earliestRecordDate ?? today;
            const minimum = on < earliest ? on : earliest;
            const input = nativeDateInput(on, minimum, today, item.label, occurredOn => actions.date?.({ occurredOn, element: feedback, input }));
            input.disabled = !editable || record.voided;
            control.dataset.disabled = String(input.disabled);
            control.append(input);
        }
        else {
            control.setAttribute("aria-label", item.ariaLabel ?? item.label);
            control.disabled = !editable || record.voided || item.action === "fx" && !recordCorrectionAvailability(record, result.report.records).amount;
        }
        fields.append(control);
    }
    for (const item of recordChipItems(record, result.report.records)) {
        const control = button("", () => { if (item.action !== "void")
            actions.action?.(item.action); }, "lk-record-detail-chip");
        control.setAttribute("aria-label", item.ariaLabel ?? item.label);
        control.disabled = !editable || record.voided;
        control.append(icon(item.icon, 17), el("span", item.label));
        chips.append(control);
    }
    return { fields, chips, feedback };
}
