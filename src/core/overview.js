import { periodForBillingCycle, periodForDates, periodForMonth, nextCalendarDate } from "./calendar.js";
import { NOTIFICATION_BANKS, paymentMethodName } from "./preferences.js";
import { buildPeriodReport, checkedReportScope } from "./report.js";
import { isCalendarDate } from "./validation.js";
/** All cards of a bank share one key; disabled methods remain visible only with current spending. */
export function buildBillingCycleSpending(ledger, request) {
    if (!isCalendarDate(request.asOf))
        throw new RangeError("Invalid as-of date");
    const scope = checkedReportScope(request.scope);
    const methods = new Map();
    for (const method of request.preferences.paymentMethods) {
        const key = method.kind === "bank" ? `bank:${method.id}` : `method:${method.id}`;
        methods.set(key, { key, label: paymentMethodName(method), ...(method.kind === "bank" ? { bankId: method.id } : {}) });
    }
    const enabledKeys = new Set(methods.keys());
    for (const record of ledger.records) {
        if (record.recurring !== null)
            continue;
        if (!methods.has(record.paymentMethod.key)) {
            const method = record.paymentMethod;
            methods.set(method.key, { ...method,
                ...(method.bankId ? { label: NOTIFICATION_BANKS.find(bank => bank.id === method.bankId)?.label ?? method.bankId } : {}) });
        }
    }
    const month = periodForMonth(Number(request.asOf.slice(0, 4)), Number(request.asOf.slice(5, 7)), request.timeZone);
    const groups = [...methods.values()].map(method => {
        const configured = request.preferences.paymentMethods.find(item => item.kind === "bank" && item.id === method.bankId);
        const closingDay = configured?.kind === "bank" ? configured.closingDay : undefined;
        const period = closingDay === undefined ? month : periodForBillingCycle(request.asOf, closingDay, request.timeZone);
        // Spending to date; the full cycle bounds remain available for the screen's label.
        const throughToday = nextCalendarDate(request.asOf);
        const report = buildPeriodReport(ledger, { period: periodForDates(period.from, throughToday < period.to ? throughToday : period.to, request.timeZone),
            asOf: request.asOf, scope, coverage: request.coverage, filters: { paymentMethod: method.key } });
        return Object.freeze({ ...method, basis: closingDay === undefined ? "calendar-month" : "billing-cycle", period, report });
    }).filter(group => enabledKeys.has(group.key) || group.report.total.byCurrency.some(bucket => bucket.expenseMinor > 0));
    return Object.freeze({ scope, asOf: request.asOf, coverage: request.coverage,
        complete: request.coverage.complete && groups.every(group => group.report.complete), groups: Object.freeze(groups) });
}
/** Pins are month-to-date main-category totals, including direct and child entries exactly once. */
export function buildPinnedCategoryTotals(ledger, request) {
    if (!isCalendarDate(request.asOf))
        throw new RangeError("Invalid as-of date");
    const scope = checkedReportScope(request.scope);
    const period = periodForDates(`${request.asOf.slice(0, 7)}-01`, nextCalendarDate(request.asOf), request.timeZone);
    const missingCategoryIds = [];
    const categories = request.preferences.pinnedCategoryIds.flatMap(categoryId => {
        const category = ledger.userRules.categories.find(item => item.id === categoryId && item.parentId === undefined);
        if (!category) {
            missingCategoryIds.push(categoryId);
            return [];
        }
        return [Object.freeze({ categoryId, label: category.label, report: buildPeriodReport(ledger, {
                    period, asOf: request.asOf, scope, coverage: request.coverage, filters: { categoryId },
                }) })];
    });
    return Object.freeze({ scope, asOf: request.asOf, period, coverage: request.coverage,
        complete: request.coverage.complete && missingCategoryIds.length === 0 && categories.every(category => category.report.complete),
        missingCategoryIds: Object.freeze(missingCategoryIds), categories: Object.freeze(categories) });
}
