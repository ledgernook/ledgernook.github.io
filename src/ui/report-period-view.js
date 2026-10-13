import { el } from "./dom.js";
import { iconButton } from "./icons.js";
import { button, saveCheck, segments, switchRow } from "./shared-controls.js";
import { reportRangeFields } from "./date-picker-view.js";
import { clampReportRange, quickReportRanges } from "./date-picker-model.js";
const PERIOD_CHOICES = [["month", "月"], ["year", "年"], ["yoy", "對比"], ["range", "期間"]];
export function reportPeriodSegments(period, choose) {
    return segments(PERIOD_CHOICES.map(([choice, label]) => ({ label, selected: period === choice, run: () => choose(choice) })));
}
export function reportPeriodSheetView(draft, today, earliest, availableYears, actions) {
    const element = el("div", undefined, "lk-report-period-sheet");
    element.append(reportPeriodSegments(draft.tab, actions.tab));
    const first = earliest && earliest < today ? earliest : today, firstYear = Number(first.slice(0, 4)), lastYear = Number(today.slice(0, 4));
    if (draft.tab === "month") {
        const stepper = el("div", undefined, "lk-report-year-stepper");
        const previous = iconButton("chevron_left", "上一年", () => actions.stepYear(-1)), next = iconButton("chevron_right", "下一年", () => actions.stepYear(1));
        previous.disabled = draft.month.year <= firstYear;
        next.disabled = draft.month.year >= lastYear;
        stepper.append(previous, el("span", String(draft.month.year), "lk-number"), next);
        const grid = el("div", undefined, "lk-report-month-grid");
        for (let month = 1; month <= 12; month++) {
            const value = `${draft.month.year}-${String(month).padStart(2, "0")}`, chip = button(`${month}月`, () => actions.month(value));
            chip.setAttribute("aria-pressed", String(value === draft.month.selected));
            chip.disabled = value < first.slice(0, 7) || value > today.slice(0, 7);
            grid.append(chip);
        }
        element.append(stepper, grid);
    }
    else if (draft.tab === "year" || draft.tab === "yoy") {
        const chips = el("div", undefined, "lk-comparison-years");
        chips.setAttribute("aria-label", draft.tab === "year" ? "年份" : "比較年份");
        const years = draft.tab === "yoy" && availableYears.length === 1 ? [...availableYears]
            : Array.from({ length: lastYear - firstYear + 1 }, (_, index) => lastYear - index);
        for (const year of years) {
            const selected = draft.tab === "year" ? draft.year === year : draft.comparison.years.includes(year);
            const chip = button(String(year), () => draft.tab === "year" ? actions.year(year) : actions.comparisonYear(year));
            chip.setAttribute("aria-pressed", String(selected));
            chip.disabled = draft.tab === "yoy" && (!availableYears.includes(year) || selected && draft.comparison.years.length <= 2);
            if (selected)
                chip.dataset.locked = String(chip.disabled);
            chips.append(chip);
        }
        element.append(chips);
        if (draft.tab === "yoy")
            element.append(switchRow("同期比較", draft.comparison.samePeriod, actions.samePeriod, { glyph: "date_range" }), saveCheck(actions.apply, !draft.comparison.years.length, "套用"));
    }
    else {
        element.append(reportRangeFields(draft.range, today, earliest, actions.date), segments(quickReportRanges(today).map(({ label, range }) => ({
            label, selected: draft.range.preset === label, run: () => actions.preset(label, clampReportRange(range, earliest, today))
        }))), saveCheck(actions.apply, false, "套用"));
    }
    return { element };
}
