/** Screen dates share a year policy. Scrolling timelines deliberately keep a per-date policy. */
export function screenDateFormatter(today, dates, options = {}) {
    const thisYear = today.slice(0, 4);
    const showYear = options.alwaysYear === true || dates.some(date => date.slice(0, 4) !== thisYear);
    const format = (date, year) => `${year ? `${date.slice(0, 4)}/` : ""}${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
    const date = (value) => format(value, showYear || value.slice(0, 4) !== thisYear);
    const day = (value) => `${date(value)} 週${"日一二三四五六"[new Date(`${value}T12:00:00Z`).getUTCDay()]}`;
    return {
        date,
        day,
        range: (from, to, compactYear = false) => `${date(from)}–${compactYear && from.slice(0, 4) === to.slice(0, 4) ? format(to, false) : date(to)}`,
        month: (value) => `${value.slice(0, 4)}/${Number(value.slice(5, 7))}`,
        /** A date whose enclosing label explicitly supplies its year, e.g. 2026（至 10/9）. */
        withinYear: (value) => format(value, false),
        timelineDate: (value) => format(value, options.alwaysYear === true || value.slice(0, 4) !== thisYear),
    };
}
