import { periodForBillingCycle, periodForMonth } from "../core/index.js";
import { displayAmount, shiftDate } from "./ledger-format.js";
import { cycleRange } from "./overview-model.js";
import { recentRows, sortRecordRows } from "./record-list-model.js";
import { coverageDisclosure, missingFxDisclosure } from "./states-model.js";
export function methodSpendingSelection(group, preferences, scope) {
    const method = preferences.paymentMethods.find(item => item.kind === "bank" && item.id === group.bankId);
    const closingDay = method?.kind === "bank" ? method.closingDay : undefined;
    return { key: group.key, label: group.label ?? group.bankId ?? "未指定", period: group.period, scope,
        ...(closingDay !== undefined ? { closingDay } : {}) };
}
export function currentMethodPeriod(selection, asOf) {
    return selection.closingDay === undefined
        ? periodForMonth(Number(asOf.slice(0, 4)), Number(asOf.slice(5, 7)), selection.period.timeZone)
        : periodForBillingCycle(asOf, selection.closingDay, selection.period.timeZone);
}
/** Step at the adjacent boundary so clamped closing days never drift across short months. */
export function stepMethodPeriod(selection, direction, asOf) {
    if (direction === 1 && selection.period.to >= currentMethodPeriod(selection, asOf).to)
        return selection;
    const anchor = direction === -1 ? shiftDate(selection.period.from, -1) : selection.period.to;
    const period = selection.closingDay === undefined
        ? periodForMonth(Number(anchor.slice(0, 4)), Number(anchor.slice(5, 7)), selection.period.timeZone)
        : periodForBillingCycle(anchor, selection.closingDay, selection.period.timeZone);
    return { ...selection, period };
}
/** Viewer range requests end inclusively; Core cycle bounds end exclusively. */
export function methodSpendingRequest(selection, asOf) {
    const lastDate = shiftDate(selection.period.to, -1);
    return { period: { kind: "range", from: selection.period.from, to: lastDate < asOf ? lastDate : asOf },
        filters: { paymentMethod: selection.key }, scope: selection.scope, asOf };
}
export function methodSpendingModel(selection, result, writable, freshRecordIds, sort = "date") {
    return { label: selection.label, asOf: result.asOf, sort,
        period: selection.closingDay === undefined ? `${selection.period.from.slice(0, 4)}/${Number(selection.period.from.slice(5, 7))}`
            : cycleRange(selection.period.from, selection.period.to, result.asOf),
        nextEnabled: selection.period.to < currentMethodPeriod(selection, result.asOf).to,
        net: displayAmount(result.report.total.twd.netMinor), complete: result.report.complete,
        coverageDisclosure: coverageDisclosure(result.report.complete, result.report.coverage.complete, { coverage: result.report.coverage, earliest: result.earliestRecordDate, currentMonth: result.asOf.slice(0, 7) }),
        conversionDisclosure: missingFxDisclosure(result.report.total.twd.unconverted),
        records: sortRecordRows(recentRows(result, writable, undefined, freshRecordIds, { noMethod: true }), sort) };
}
