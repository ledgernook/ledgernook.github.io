import { categoryPresentation } from "./category-presentation.js";
import { displayAmount, shiftDate } from "./ledger-format.js";
import { recentRows } from "./record-list-model.js";
import { coverageDisclosure, missingFxDisclosure } from "./states-model.js";
import { screenDateFormatter } from "./screen-date-format.js";
export function cycleRange(from, exclusiveTo, asOf) {
    const to = shiftDate(exclusiveTo, -1);
    return screenDateFormatter(asOf, [from, to]).range(from, to);
}
/** Formats application projections; the independent all-scope result supplies recent records. */
export function overviewModel(result, recentResult, writable, recentLimit = 6, freshRecordIds) {
    return { result, scope: result.report.scope, month: `${result.asOf.slice(0, 4)}/${Number(result.asOf.slice(5, 7))}`,
        net: displayAmount(result.report.total.twd.netMinor), expense: displayAmount(result.report.total.twd.expenseMinor), refund: displayAmount(result.report.total.twd.refundMinor),
        showNet: result.report.total.twd.netMinor !== 0 || !result.report.complete,
        showBreakdown: result.report.total.twd.refundMinor !== 0,
        pins: result.pinnedCategoryTotals.categories.filter(pin => pin.report.total.twd.netMinor !== 0 || !pin.report.complete).map(pin => ({ ...categoryPresentation(result.categories, pin.categoryId),
            amount: displayAmount(pin.report.total.twd.netMinor), complete: pin.report.complete })),
        billingRows: result.billingCycleSpending.groups.map(group => ({ id: group.key, label: group.label ?? group.bankId ?? "未指定",
            range: group.basis === "calendar-month" ? null : cycleRange(group.period.from, group.period.to, result.asOf),
            amount: displayAmount(group.report.total.twd.netMinor),
            complete: group.report.complete })),
        coverageDisclosure: coverageDisclosure(result.complete, result.report.coverage.complete, { coverage: result.report.coverage, earliest: result.earliestRecordDate, currentMonth: result.asOf.slice(0, 7) }),
        conversionDisclosure: missingFxDisclosure(result.conversionGaps.unconverted),
        recent: recentRows(recentResult, writable, recentLimit, freshRecordIds) };
}
