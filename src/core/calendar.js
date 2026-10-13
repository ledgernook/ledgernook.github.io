import { isCalendarDate } from "./validation.js";
function dateFormatter(timeZone) {
    return new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
}
function localDateNumber(formatter, milliseconds) {
    const parts = formatter.formatToParts(milliseconds);
    const number = (type) => Number(parts.find(part => part.type === type)?.value);
    return number("year") * 10000 + number("month") * 100 + number("day");
}
/** UTC instant at which local date `date` begins in `timeZone`. */
export function localDateStart(date, timeZone) {
    if (!isCalendarDate(date))
        throw new RangeError("Invalid calendar date");
    const [year, month, day] = date.split("-").map(Number);
    if (year < 1 || year > 9999)
        throw new RangeError("Invalid calendar date");
    const formatter = dateFormatter(timeZone);
    const reference = new Date(0);
    reference.setUTCFullYear(year, month - 1, day);
    reference.setUTCHours(0, 0, 0, 0);
    const target = year * 10000 + month * 100 + day;
    let low = reference.getTime() - 36 * 60 * 60 * 1000;
    let high = reference.getTime() + 36 * 60 * 60 * 1000;
    while (low < high) {
        const middle = low + Math.floor((high - low) / 2);
        if (localDateNumber(formatter, middle) < target)
            low = middle + 1;
        else
            high = middle;
    }
    return new Date(low).toISOString();
}
/** Local `YYYY-MM-DD` of a UTC instant in `timeZone`. */
export function localDateOf(instant, timeZone) {
    const value = localDateNumber(dateFormatter(timeZone), Date.parse(instant));
    if (!Number.isFinite(value))
        throw new RangeError("Invalid instant");
    const text = String(value).padStart(8, "0");
    return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
}
export function periodForDates(from, to, timeZone) {
    if (!isCalendarDate(from) || !isCalendarDate(to) || from >= to)
        throw new RangeError("Invalid date range");
    return Object.freeze({ from, to, timeZone, start: localDateStart(from, timeZone), end: localDateStart(to, timeZone) });
}
export function periodForMonth(year, month, timeZone) {
    if (!Number.isInteger(year) || year < 1 || year > 9998 || !Number.isInteger(month) || month < 1 || month > 12) {
        throw new RangeError("Invalid calendar month");
    }
    const pad = (value, width) => String(value).padStart(width, "0");
    const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
    return periodForDates(`${pad(year, 4)}-${pad(month, 2)}-01`, `${pad(next.year, 4)}-${pad(next.month, 2)}-01`, timeZone);
}
export function occursInPeriod(occurrence, period) {
    return occurrence.precision === "instant"
        ? occurrence.at >= period.start && occurrence.at < period.end
        : occurrence.on >= period.from && occurrence.on < period.to;
}
/** Calendar arithmetic on a stated date, independent of the host time zone. */
export function nextCalendarDate(date) {
    if (!isCalendarDate(date))
        throw new RangeError("Invalid calendar date");
    const [year, month, day] = date.split("-").map(Number);
    const value = new Date(0);
    value.setUTCFullYear(year, month - 1, day + 1);
    value.setUTCHours(0, 0, 0, 0);
    const next = `${String(value.getUTCFullYear()).padStart(4, "0")}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
    if (!isCalendarDate(next))
        throw new RangeError("Date out of range");
    return next;
}
/** Current inclusive closing day: the next close on/after asOf, clamped in each month. */
export function periodForBillingCycle(asOf, closingDay, timeZone) {
    if (!isCalendarDate(asOf) || !Number.isInteger(closingDay) || closingDay < 1 || closingDay > 31)
        throw new RangeError("Invalid billing cycle");
    const close = (offset) => {
        const value = new Date(0);
        value.setUTCFullYear(Number(asOf.slice(0, 4)), Number(asOf.slice(5, 7)) - 1 + offset + 1, 0);
        value.setUTCHours(0, 0, 0, 0);
        return `${String(value.getUTCFullYear()).padStart(4, "0")}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(closingDay, value.getUTCDate())).padStart(2, "0")}`;
    };
    const offset = asOf <= close(0) ? 0 : 1;
    return periodForDates(nextCalendarDate(close(offset - 1)), nextCalendarDate(close(offset)), timeZone);
}
/** Anchor day clamped to a Gregorian month's last day, shared by periodic schedules. */
export function clampedMonthDate(year, month, day) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const lastDay = month === 2 ? (leap ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31;
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}
