import { el } from "./dom.js";
import { icon } from "./icons.js";
import { nativeDateInput } from "./shared-controls.js";
import { reportDateBounds } from "./date-picker-model.js";
import { screenDateFormatter } from "./screen-date-format.js";
/** Both pills directly own a native date input; the platform owns its picker UI. */
export function reportRangeFields(state, today, earliest, pick) {
    const fields = el("div", undefined, "lk-report-range-fields");
    const dates = screenDateFormatter(today, [state.from, state.to], { alwaysYear: true }), bounds = reportDateBounds(earliest, today);
    for (const field of ["from", "to"]) {
        if (field === "to")
            fields.append(el("span", "–", "lk-muted"));
        const control = el("label", undefined, "lk-range-field lk-number");
        control.append(icon("event", 17), el("span", dates.day(state[field])), nativeDateInput(state[field], bounds.min, bounds.max, field === "from" ? "起" : "迄", date => pick(field, date)));
        fields.append(control);
    }
    return fields;
}
