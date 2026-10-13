import { shiftDate } from "./ledger-format.js";
export function shiftMonth(month, offset) {
    const date = new Date(`${month}-01T12:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + offset);
    return date.toISOString().slice(0, 7);
}
export function quickReportRanges(today) {
    const month = shiftMonth(today.slice(0, 7), -1);
    return [{ label: "上個月", range: { from: `${month}-01`, to: shiftDate(`${today.slice(0, 7)}-01`, -1) } },
        { label: "近 30 天", range: { from: shiftDate(today, -29), to: today } }, { label: "近 90 天", range: { from: shiftDate(today, -89), to: today } }];
}
export function reportDateBounds(earliest, today) {
    return { min: earliest && earliest <= today ? earliest : today, max: today };
}
export function changeReportRange(range, field, date) {
    if (field === "from" ? date > range.to : date < range.from)
        return { from: date, to: date };
    return { ...range, [field]: date };
}
export function clampReportRange(range, earliest, today) {
    const min = earliest && earliest <= today ? earliest : today;
    const from = range.from < min ? min : range.from > today ? today : range.from;
    const requestedTo = range.to < min ? min : range.to > today ? today : range.to;
    return { from, to: requestedTo < from ? from : requestedTo };
}
