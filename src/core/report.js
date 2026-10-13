import { localDateOf, nextCalendarDate, occursInPeriod, periodForDates } from "./calendar.js";
import { addMinor, subtractMinor } from "./money.js";
import { canonicalCategoryId } from "./rules.js";
import { isCalendarDate } from "./validation.js";
export function checkedReportScope(scope) {
    if (scope !== undefined && scope !== "all" && scope !== "daily")
        throw new RangeError("Invalid report scope");
    return scope ?? "all";
}
const GLOBAL_GAPS = new Set(["conflicting-source", "conflicting-detail", "detail-without-source", "conflicting-project"]);
class BucketAccumulator {
    scope;
    constructor(scope = "all") {
        this.scope = scope;
    }
    count = 0;
    native = new Map();
    unconverted = new Map();
    twdExpense = 0;
    twdRefund = 0;
    estimated = false;
    add(entry) {
        this.count += 1;
        addTo(this.native, entry.currency, entry.kind, entry.amountMinor);
        if (entry.reportingValue === null)
            addTo(this.unconverted, entry.currency, entry.kind, entry.amountMinor);
        else {
            if (entry.reportingValue.estimated)
                this.estimated = true;
            if (entry.kind === "expense")
                this.twdExpense = addMinor(this.twdExpense, entry.reportingValue.amountMinor);
            else
                this.twdRefund = addMinor(this.twdRefund, entry.reportingValue.amountMinor);
        }
    }
    get size() { return this.count; }
    result() {
        const unconverted = amounts(this.unconverted);
        return Object.freeze({
            scope: this.scope,
            recordCount: this.count,
            byCurrency: amounts(this.native),
            twd: Object.freeze({
                expenseMinor: this.twdExpense,
                refundMinor: this.twdRefund,
                netMinor: subtractMinor(this.twdExpense, this.twdRefund),
                complete: unconverted.length === 0,
                estimated: this.estimated,
                unconvertedCount: unconverted.reduce((sum, item) => sum + item.expenseCount + item.refundCount, 0),
                unconverted,
            }),
        });
    }
}
function addTo(target, currency, kind, amountMinor) {
    const sums = target.get(currency) ?? { expense: 0, refund: 0, expenseCount: 0, refundCount: 0 };
    if (kind === "expense") {
        sums.expense = addMinor(sums.expense, amountMinor);
        sums.expenseCount += 1;
    }
    else {
        sums.refund = addMinor(sums.refund, amountMinor);
        sums.refundCount += 1;
    }
    target.set(currency, sums);
}
function amounts(source) {
    return Object.freeze([...source].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([currency, sums]) => Object.freeze({
        currency, expenseMinor: sums.expense, refundMinor: sums.refund, netMinor: subtractMinor(sums.expense, sums.refund),
        expenseCount: sums.expenseCount, refundCount: sums.refundCount,
    })));
}
function bucketOf(map, key, scope) {
    let bucket = map.get(key);
    if (bucket === undefined) {
        bucket = new BucketAccumulator(scope);
        map.set(key, bucket);
    }
    return bucket;
}
/** Split/refund lines own their classification; other entries inherit their record. */
export function entryClassification(entry) {
    return {
        categoryId: entry.categoryId === undefined ? entry.record.categoryId : entry.categoryId,
        mainCategoryId: entry.mainCategoryId === undefined ? entry.record.mainCategoryId : entry.mainCategoryId,
    };
}
function recordFilter(ledger, filters, scope = "all") {
    const excludedCategories = new Set(ledger.userRules.categories.filter(category => category.includeInDaily === false).map(category => category.id));
    const includedProjects = new Set(ledger.projects.filter(project => project.includeInDaily === true).map(project => project.id));
    const categoryFilter = filters.categoryId === undefined || filters.categoryId === null
        ? filters.categoryId : canonicalCategoryId(ledger.userRules, filters.categoryId) ?? `\u0000unknown:${filters.categoryId}`;
    const subcategoryFilter = typeof filters.subcategoryId === "string"
        ? canonicalCategoryId(ledger.userRules, filters.subcategoryId) ?? `\u0000unknown:${filters.subcategoryId}` : filters.subcategoryId;
    return (record, assignment = record) => {
        if (scope === "daily" && (assignment.categoryId !== null && excludedCategories.has(assignment.categoryId) ||
            assignment.mainCategoryId !== null && excludedCategories.has(assignment.mainCategoryId) ||
            record.projectId !== null && !includedProjects.has(record.projectId)))
            return false;
        if (categoryFilter === null && assignment.categoryId !== null)
            return false;
        if (typeof categoryFilter === "string" && assignment.categoryId !== categoryFilter && assignment.mainCategoryId !== categoryFilter)
            return false;
        if (subcategoryFilter === null && assignment.categoryId !== assignment.mainCategoryId)
            return false;
        if (typeof subcategoryFilter === "string" && assignment.categoryId !== subcategoryFilter)
            return false;
        if (filters.subscription !== undefined && (record.subscription !== null) !== filters.subscription)
            return false;
        if (filters.projectId !== undefined && record.projectId !== filters.projectId)
            return false;
        if (filters.paymentMethod !== undefined && record.paymentMethod.key !== filters.paymentMethod)
            return false;
        return true;
    };
}
function checkedAsOf(asOf) {
    if (asOf !== undefined && !isCalendarDate(asOf))
        throw new RangeError("Invalid as-of date");
    return asOf ?? null;
}
/** A derived dated entry is recognized when dated on/before the as-of date; ordinary records always are. */
function recognized(entry, asOf) {
    return entry.role === "record" || entry.role === "split-line" || (asOf !== null && entry.occurrence.precision === "date" && entry.occurrence.on <= asOf);
}
/** Pure period/project/category report over recognition entries. */
export function buildPeriodReport(ledger, request) {
    const reportScope = checkedReportScope(request.scope);
    const filters = request.filters ?? {};
    const period = request.period ?? null;
    const asOf = checkedAsOf(request.asOf);
    const rules = ledger.userRules;
    const matches = recordFilter(ledger, filters, reportScope);
    const scope = new Set();
    let voidedCount = 0;
    for (const record of ledger.records) {
        if (record.recurring !== null || !record.voided || (period !== null && !occursInPeriod(record.occurrence, period)) ||
            !(record.split === null ? matches(record) : record.split.some(line => matches(record, line))))
            continue;
        scope.add(record.id);
        voidedCount += 1;
    }
    const selected = [];
    const futureEntries = [];
    for (const entry of ledger.entries) {
        if (period !== null && !occursInPeriod(entry.occurrence, period))
            continue;
        const assignment = entryClassification(entry);
        if (!matches(entry.record, assignment))
            continue;
        if (entry.role === "recurring-occurrence" && !recognized(entry, asOf))
            continue;
        scope.add(entry.record.id);
        if (entry.record.recurrence !== null)
            scope.add(entry.record.recurrence.anchorId);
        if (recognized(entry, asOf))
            selected.push(entry);
        else
            futureEntries.push(entry);
    }
    const total = new BucketAccumulator(reportScope);
    const future = new BucketAccumulator(reportScope);
    const direct = new Map();
    const main = new Map();
    const unclassified = new BucketAccumulator(reportScope);
    const payments = new Map();
    const paymentInfo = new Map();
    const subscriptions = new BucketAccumulator(reportScope);
    const projects = new Map();
    const withoutProject = new BucketAccumulator(reportScope);
    const records = new Set();
    const unclassifiedRecords = new Set();
    let organisable = 0;
    let unlinkedRefundCount = 0;
    for (const entry of selected) {
        const record = entry.record;
        if (!records.has(record)) {
            records.add(record);
            if (record.kind === "refund" && record.refundOf === null)
                unlinkedRefundCount += 1;
        }
        total.add(entry);
        const { categoryId, mainCategoryId } = entryClassification(entry);
        if (categoryId === null || mainCategoryId === null) {
            unclassified.add(entry);
            if (!unclassifiedRecords.has(record)) {
                unclassifiedRecords.add(record);
                if (record.merchant !== undefined && record.categorySource === "none")
                    organisable += 1;
            }
        }
        else {
            bucketOf(direct, categoryId, reportScope).add(entry);
            bucketOf(main, mainCategoryId, reportScope).add(entry);
        }
        bucketOf(payments, record.paymentMethod.key, reportScope).add(entry);
        paymentInfo.set(record.paymentMethod.key, record.paymentMethod);
        if (record.subscription !== null)
            subscriptions.add(entry);
        if (record.projectId === null)
            withoutProject.add(entry);
        else
            bucketOf(projects, record.projectId, reportScope).add(entry);
    }
    for (const entry of futureEntries)
        future.add(entry);
    const categories = [];
    for (const category of rules.categories) {
        const own = direct.get(category.id);
        const rollup = category.parentId === undefined ? main.get(category.id) : own;
        if (rollup === undefined)
            continue;
        categories.push(Object.freeze({
            categoryId: category.id, label: category.label, parentId: category.parentId ?? null,
            direct: (own ?? new BucketAccumulator(reportScope)).result(), total: rollup.result(),
        }));
    }
    const projectLabels = new Map(ledger.projects.map(project => [project.id, project]));
    const projectSubtotals = [...projects].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([projectId, bucket]) => {
        const project = projectLabels.get(projectId);
        return Object.freeze({ projectId, label: project.label, archived: project.archived, bucket: bucket.result() });
    });
    const paymentSubtotals = [...payments].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, bucket]) => Object.freeze({ ...paymentInfo.get(key), bucket: bucket.result() }));
    const gaps = ledger.gaps.filter(gap => GLOBAL_GAPS.has(gap.code) || scope.has(gap.eventId) ||
        (gap.targetId !== undefined && scope.has(gap.targetId)));
    return Object.freeze({
        scope: reportScope,
        period,
        filters,
        coverage: request.coverage,
        asOf,
        complete: request.coverage.complete && gaps.length === 0,
        total: total.result(),
        future: future.result(),
        categories: Object.freeze(categories),
        unclassified: unclassified.result(),
        paymentMethods: Object.freeze(paymentSubtotals),
        subscriptions: subscriptions.result(),
        projects: Object.freeze(projectSubtotals),
        withoutProject: withoutProject.result(),
        records: Object.freeze([...records]),
        entries: Object.freeze(selected),
        futureEntries: Object.freeze(futureEntries),
        unlinkedRefundCount,
        voidedCount,
        unclassifiedCount: unclassifiedRecords.size,
        organisableUnclassifiedCount: organisable,
        gaps: Object.freeze(gaps),
    });
}
/** Calendar-year comparison; selection and every amount use the same effective ledger. */
export function buildYearComparison(ledger, request) {
    if (!isCalendarDate(request.asOf))
        throw new RangeError("Invalid as-of date");
    const dates = ledger.records.filter(record => !record.voided && record.evidenceOf === null && record.recurring === null)
        .map(record => record.occurrence.precision === "date" ? record.occurrence.on : localDateOf(record.occurrence.at, request.timeZone))
        .filter(date => date <= request.asOf).sort();
    // A recognized installment can supply spending in a year without a new purchase record.
    const entryDates = ledger.entries.map(entry => entry.occurrence.precision === "date" ? entry.occurrence.on : localDateOf(entry.occurrence.at, request.timeZone))
        .filter(date => date <= request.asOf);
    const availableYears = [...new Set([...dates, ...entryDates].map(date => Number(date.slice(0, 4))))].sort((a, b) => b - a);
    const selected = request.years ?? availableYears.slice(0, 2);
    if (request.years && (selected.length < 2 || new Set(selected).size !== selected.length ||
        selected.some(year => !availableYears.includes(year))))
        throw new RangeError("Select at least two years with records");
    const currentYear = Number(request.asOf.slice(0, 4));
    const samePeriod = request.samePeriod === true;
    const years = [...selected].sort((a, b) => b - a).map(year => {
        const prefix = String(year).padStart(4, "0"), from = `${prefix}-01-01`;
        const month = Number(request.asOf.slice(5, 7)), day = Number(request.asOf.slice(8));
        const lastDay = new Date(0);
        lastDay.setUTCFullYear(year, month, 0);
        const to = samePeriod ? `${prefix}-${request.asOf.slice(5, 7)}-${String(Math.min(day, lastDay.getUTCDate())).padStart(2, "0")}`
            : year === currentYear ? request.asOf : `${prefix}-12-31`;
        // Missing partitions can contain cross-year corrections or schedules. Their year alone
        // cannot prove another year's dependency coverage; preserve the caller's coverage contract.
        const report = buildPeriodReport(ledger, { period: periodForDates(from, nextCalendarDate(to), request.timeZone),
            asOf: to, coverage: request.coverage, scope: checkedReportScope(request.scope), ...(request.filters ? { filters: request.filters } : {}) });
        return Object.freeze({ year, from, to, report });
    });
    const scope = checkedReportScope(request.scope);
    const empty = () => new BucketAccumulator(scope).result();
    const categoryId = typeof request.filters?.categoryId === "string" ? canonicalCategoryId(ledger.userRules, request.filters.categoryId) : null;
    return Object.freeze({ availableYears: Object.freeze(availableYears),
        firstRecordDate: request.coverage.complete && ledger.gaps.length === 0 ? dates[0] ?? null : null,
        samePeriod, years: Object.freeze(years),
        subcategories: Object.freeze(categoryId !== null ? [
            ...ledger.userRules.categories.filter(category => category.parentId === categoryId).map(category => Object.freeze({
                categoryId: category.id, label: category.label,
                years: Object.freeze(years.map(({ report }) => report.categories.find(item => item.categoryId === category.id)?.direct ?? empty())),
            })),
            Object.freeze({ categoryId: null, label: "未指定子分類",
                years: Object.freeze(years.map(({ report }) => report.categories.find(item => item.categoryId === categoryId)?.direct ?? empty())) }),
        ] : []),
        categories: Object.freeze(ledger.userRules.categories.filter(category => category.parentId === undefined).map(category => Object.freeze({
            categoryId: category.id, label: category.label,
            years: Object.freeze(years.map(({ report }) => report.categories.find(item => item.categoryId === category.id)?.total ?? empty())),
        }))),
    });
}
/** Project recognized / future / overall cost. Membership comes only from explicit/inherited project ids, never dates. */
export function projectCost(ledger, request) {
    if (!isCalendarDate(request.asOf))
        throw new RangeError("Invalid as-of date");
    const report = buildPeriodReport(ledger, { ...request, filters: { projectId: request.projectId } });
    const overall = new BucketAccumulator(report.scope);
    for (const entry of [...report.entries, ...report.futureEntries])
        overall.add(entry);
    return Object.freeze({
        scope: report.scope,
        projectId: request.projectId, asOf: request.asOf, recognized: report.total, future: report.future, overall: overall.result(),
        complete: report.complete, gaps: report.gaps,
    });
}
/** Lifetime net cost of one purchase across periods; null when it is not a counted expense. */
export function purchaseNet(ledger, purchaseId) {
    const purchase = ledger.records.find(record => record.id === purchaseId);
    if (purchase === undefined || purchase.kind !== "expense" || purchase.voided || purchase.recurring !== null)
        return null;
    const costMinor = purchase.installment?.costMinor ?? purchase.amountMinor;
    let refundedMinor = 0;
    let complete = true;
    const refundIds = [];
    for (const record of ledger.records) {
        if (record.refundOf !== purchaseId || record.voided)
            continue;
        refundIds.push(record.id);
        if (record.refundCreditMinor === null)
            complete = false;
        else
            refundedMinor = addMinor(refundedMinor, record.refundCreditMinor);
    }
    if (refundedMinor > costMinor)
        complete = false;
    return Object.freeze({
        purchaseId, currency: purchase.currency, purchaseMinor: costMinor, refundedMinor,
        netMinor: subtractMinor(costMinor, refundedMinor), refundIds: Object.freeze(refundIds), complete,
    });
}
/** Remaining-cost query over applied, non-voided plans. Recomputes from the as-of date alone (no new data needed). */
export function installmentBalances(ledger, request) {
    if (!isCalendarDate(request.asOf))
        throw new RangeError("Invalid as-of date");
    const asOf = request.asOf;
    const month = asOf.slice(0, 7);
    const scope = checkedReportScope(request.scope);
    const matches = recordFilter(ledger, request.filters ?? {}, scope);
    const byPurchase = new Map();
    for (const entry of ledger.entries)
        if (entry.role === "installment-period" || entry.role === "installment-fee") {
            byPurchase.set(entry.record.id, [...byPurchase.get(entry.record.id) ?? [], entry]);
        }
    const credits = new Map();
    for (const record of ledger.records) {
        if (record.refundOf !== null && !record.voided && record.refundCreditMinor !== null) {
            credits.set(record.refundOf, addMinor(credits.get(record.refundOf) ?? 0, record.refundCreditMinor));
        }
    }
    const plans = [];
    const totals = new Map();
    const twd = { currentMinor: 0, remainingMinor: 0, complete: true, estimated: false, unconvertedCount: 0 };
    for (const record of ledger.records) {
        const installment = record.installment;
        if (installment === null || record.voided || record.evidenceOf !== null || !matches(record))
            continue;
        const entries = byPurchase.get(record.id) ?? [];
        const evidence = new Map(installment.schedule.map(period => [period.id, period.evidence ?? []]));
        const schedule = entries.map(entry => Object.freeze({
            entryId: entry.id, role: entry.role, id: (entry.periodId ?? entry.feeId),
            on: entry.occurrence.on, amountMinor: entry.amountMinor, reportingValue: entry.reportingValue,
            recognized: recognized(entry, asOf), evidence: Object.freeze([...(entry.periodId !== undefined ? evidence.get(entry.periodId) ?? [] : [])]),
        }));
        const sum = (items, value) => items.reduce((total, item) => addMinor(total, value(item)), 0);
        const remaining = schedule.filter(item => !item.recognized);
        const current = schedule.filter(item => item.on.slice(0, 7) === month);
        const converted = record.reportingValue !== null;
        const remainingTwdMinor = converted ? sum(remaining, item => item.reportingValue.amountMinor) : null;
        const currentTwdMinor = converted ? sum(current, item => item.reportingValue.amountMinor) : null;
        const balance = Object.freeze({
            purchaseId: record.id, planId: installment.plan.planId, currency: record.currency, totalMinor: installment.plan.totalMinor,
            costMinor: installment.costMinor, creditMinor: credits.get(record.id) ?? 0,
            status: installment.canceled ? "canceled" : remaining.length === 0 ? "completed" : "active",
            currentMinor: sum(current, item => item.amountMinor), recognizedMinor: sum(schedule.filter(item => item.recognized), item => item.amountMinor),
            remainingMinor: sum(remaining, item => item.amountMinor), remainingCount: remaining.length,
            remainingTwdMinor, currentTwdMinor, estimated: record.reportingValue?.estimated ?? false,
            schedule: Object.freeze(schedule), record,
        });
        plans.push(balance);
        const total = totals.get(record.currency) ?? { currentMinor: 0, remainingMinor: 0, remainingCount: 0 };
        total.currentMinor = addMinor(total.currentMinor, balance.currentMinor);
        total.remainingMinor = addMinor(total.remainingMinor, balance.remainingMinor);
        total.remainingCount += balance.remainingCount;
        totals.set(record.currency, total);
        if (remainingTwdMinor === null || currentTwdMinor === null) {
            twd.complete = false;
            twd.unconvertedCount += 1;
        }
        else {
            twd.currentMinor = addMinor(twd.currentMinor, currentTwdMinor);
            twd.remainingMinor = addMinor(twd.remainingMinor, remainingTwdMinor);
            if (balance.estimated)
                twd.estimated = true;
        }
    }
    return Object.freeze({
        scope,
        asOf,
        plans: Object.freeze(plans),
        byCurrency: Object.freeze([...totals].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
            .map(([currency, total]) => Object.freeze({ currency, ...total }))),
        twd: Object.freeze(twd),
    });
}
