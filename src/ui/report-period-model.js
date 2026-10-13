import { clampReportRange, shiftMonth } from "./date-picker-model.js";
import { screenDateFormatter } from "./screen-date-format.js";
import { shiftDate } from "./ledger-format.js";
import { reportRangeLabel, reportYearLabel } from "./report-model.js";
export const emptyReportPeriodMemory = () => ({ month: null, year: null, comparison: null, range: null });
export function reportPeriodRequest(value, today, earliest) {
    if (value.mode === "month")
        return { kind: "month", month: value.month };
    if (value.mode === "range")
        return { kind: "range", from: value.range.from, to: value.range.to };
    const year = value.mode === "year" ? value.year : (value.comparison.years.length ? Math.max(...value.comparison.years) : Number(today.slice(0, 4)));
    return { kind: "range", ...clampReportRange({ from: `${year}-01-01`, to: `${year}-12-31` }, earliest, today) };
}
export function startReportPeriodDraft(memory, value, today, earliest, availableYears) {
    const year = value.mode === "month" ? Number(value.month.slice(0, 4)) : value.mode === "year" ? value.year
        : value.mode === "range" ? Number(value.range.to.slice(0, 4)) : (value.comparison.years.length ? Math.max(...value.comparison.years) : Number(today.slice(0, 4)));
    const request = reportPeriodRequest(value, today, earliest);
    const span = request.kind === "month" ? clampReportRange({ from: `${request.month}-01`, to: shiftDate(`${shiftMonth(request.month, 1)}-01`, -1) }, earliest, today) : request;
    return { tab: value.mode,
        month: { year: memory.month ? Number(memory.month.slice(0, 4)) : year, selected: memory.month ?? (value.mode === "month" ? value.month : null) },
        year: memory.year ?? year,
        comparison: memory.comparison ? { ...memory.comparison, years: [...memory.comparison.years] }
            : { years: [...availableYears].sort((a, b) => b - a).slice(0, 2), samePeriod: false },
        range: memory.range ? { ...memory.range } : { from: span.from, to: span.to, preset: null } };
}
export function rememberReportPeriod(memory, value) {
    return value.mode === "month" ? { ...memory, month: value.month } : value.mode === "year" ? { ...memory, year: value.year }
        : value.mode === "yoy" ? { ...memory, comparison: { ...value.comparison, years: [...value.comparison.years] } }
            : { ...memory, range: { ...value.range } };
}
export function reportBarLabel(value, today, earliest) {
    if (value.mode === "month")
        return screenDateFormatter(today, []).month(value.month);
    if (value.mode === "year")
        return reportYearLabel(value.year, today, earliest);
    if (value.mode === "range")
        return reportRangeLabel(value.range, today);
    const years = [...value.comparison.years].sort((a, b) => b - a);
    return years.length > 3 ? `${years.slice(0, 2).join("、")} 等 ${years.length} 年` : years.join("、");
}
export function reportPeriodBounds(value, earliest, today) {
    const first = earliest && earliest < today ? earliest : today;
    if (value.mode === "yoy")
        return { previousEnabled: false, nextEnabled: false };
    if (value.mode === "month")
        return { previousEnabled: value.month > first.slice(0, 7), nextEnabled: value.month < today.slice(0, 7) };
    if (value.mode === "year")
        return { previousEnabled: value.year > Number(first.slice(0, 4)), nextEnabled: value.year < Number(today.slice(0, 4)) };
    return { previousEnabled: value.range.from > first, nextEnabled: value.range.to < today };
}
/** Inclusive whole-day windows keep their length when the final step pins to F or T. */
export function stepReportRange(range, direction, first, today) {
    const length = Math.round((Date.parse(`${range.to}T12:00:00Z`) - Date.parse(`${range.from}T12:00:00Z`)) / 86400000) + 1;
    if (direction < 0) {
        const candidate = shiftDate(range.from, -length), from = candidate < first ? first : candidate;
        return { from, to: shiftDate(from, length - 1) };
    }
    const candidate = shiftDate(range.to, length), to = candidate > today ? today : candidate;
    return { from: shiftDate(to, 1 - length), to };
}
export function stepReportPeriod(value, direction, earliest, today) {
    const bounds = reportPeriodBounds(value, earliest, today);
    if (direction < 0 ? !bounds.previousEnabled : !bounds.nextEnabled)
        return value;
    return value.mode === "month" ? { mode: "month", month: shiftMonth(value.month, direction) }
        : value.mode === "year" ? { mode: "year", year: value.year + direction }
            : value.mode === "range" ? { mode: "range", range: { ...stepReportRange(value.range, direction, earliest ?? today, today), preset: null } } : value;
}
