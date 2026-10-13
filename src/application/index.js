import { eventPartition, ledgerEventsEqual, periodForMonth, validateLedgerEvent, } from "../core/index.js";
export * from "./preferences.js";
export * from "./ports.js";
export * from "./query.js";
export * from "./sync.js";
export * from "./commands.js";
export * from "./companion.js";
export * from "./viewer-query.js";
export * from "./repository-connection.js";
export function prepareEvent(draft, idGenerator) {
    return Object.freeze(validateLedgerEvent({ ...draft, id: idGenerator.next() }));
}
/**
 * Persist a prepared event and verify it by ID. After an uncertain write failure,
 * call this again with the same prepared event so the immutable ID is reused.
 */
export async function recordEvent(preparedEvent, writer) {
    const event = Object.freeze(validateLedgerEvent(preparedEvent));
    const writeResult = await writer.createIfAbsent(event);
    const readBackValue = await writer.readById(event.id, event);
    const readBack = readBackValue === null
        ? null
        : Object.freeze(validateLedgerEvent(readBackValue));
    const readBackStatus = readBack === null
        ? "missing"
        : ledgerEventsEqual(event, readBack)
            ? "match"
            : "mismatch";
    return { event, writeResult, readBack, readBackStatus };
}
/** Kept as the original application entry point for callers using the probe name. */
export const probeEvent = recordEvent;
/** UTC half-open bounds of a month in the requested IANA time zone. */
export function monthRange(year, month, timeZone) {
    const period = periodForMonth(year, month, timeZone);
    return { start: period.start, end: period.end };
}
/** UTC year/month folders intersecting a nonempty half-open instant range. */
export function utcPartitions(start, end) {
    const first = Date.parse(start);
    const lastExclusive = Date.parse(end);
    if (!Number.isFinite(first) || !Number.isFinite(lastExclusive) || first >= lastExclusive) {
        throw new RangeError("Invalid instant range");
    }
    const firstDate = new Date(first);
    const lastDate = new Date(lastExclusive - 1);
    const partitions = [];
    let year = firstDate.getUTCFullYear();
    let month = firstDate.getUTCMonth() + 1;
    const lastYear = lastDate.getUTCFullYear();
    const lastMonth = lastDate.getUTCMonth() + 1;
    while (year < lastYear || (year === lastYear && month <= lastMonth)) {
        partitions.push(`${String(year).padStart(4, "0")}/${String(month).padStart(2, "0")}`);
        month += 1;
        if (month === 13) {
            month = 1;
            year += 1;
        }
    }
    return partitions;
}
/** The immutable storage partition of a source record (see Core `eventPartition`). */
export function eventMonthPartition(event) {
    return eventPartition(event);
}
export * from "./outbox.js";
export * from "./push.js";
export * from "./local-ledger.js";
export * from "./replay.js";
