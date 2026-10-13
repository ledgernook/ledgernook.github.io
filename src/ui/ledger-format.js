import { currencyScale, minorToDecimal } from "../core/index.js";
export function displayAmount(minor, currency = "TWD") {
    const decimal = minorToDecimal(Math.abs(minor), currency);
    const digits = currency === "TWD" ? 0 : currencyScale(currency);
    return `${minor < 0 ? "−" : ""}${Number(decimal).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}
export function dateAt(now, timeZone) {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(now));
    const get = (type) => parts.find(part => part.type === type)?.value;
    return `${get("year")}-${get("month")}-${get("day")}`;
}
export function recordDate(record, zone) {
    return record.occurrence.precision === "date" ? record.occurrence.on : dateAt(record.occurrence.at, zone);
}
export function dayLabel(date, asOf) {
    const label = asOf && date.slice(0, 4) !== asOf.slice(0, 4)
        ? `${Number(date.slice(0, 4))}/${Number(date.slice(5, 7))}/${Number(date.slice(8))}`
        : `${Number(date.slice(5, 7))}/${Number(date.slice(8))}`;
    return `${label} 週${"日一二三四五六"[new Date(`${date}T12:00:00Z`).getUTCDay()]}`;
}
export function timeLabel(record, zone) {
    return record.occurrence.precision === "date" ? "" : new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(record.occurrence.at));
}
export function shiftDate(date, days) {
    const value = new Date(`${date}T12:00:00Z`);
    value.setUTCDate(value.getUTCDate() + days);
    return value.toISOString().slice(0, 10);
}
