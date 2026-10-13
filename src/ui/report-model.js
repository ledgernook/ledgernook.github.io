import { categoryPresentation } from "./category-presentation.js";
import { displayAmount } from "./ledger-format.js";
import { recordPaymentMethodName } from "./payment-method-name.js";
import { screenDateFormatter } from "./screen-date-format.js";
import { recordRow } from "./record-list-model.js";
export function reportSubscriptionFilters(choice) {
    if (choice === "all")
        return {};
    return { subscription: choice === "only" };
}
export const scopeLabel = (scope) => scope === "daily" ? "日常" : "全部";
export function reportDateLabel(date, today, screenDates = []) {
    return screenDateFormatter(today, screenDates, { alwaysYear: true }).date(date);
}
export function reportRangeLabel(range, today) {
    return screenDateFormatter(today, [range.from, range.to], { alwaysYear: true }).range(range.from, range.to, true);
}
export function reportYearLabel(year, today, firstRecordDate) {
    const formatter = screenDateFormatter(today, []);
    const parts = [firstRecordDate && firstRecordDate.slice(0, 4) === String(year) && firstRecordDate > `${year}-01-01`
            ? `自 ${formatter.withinYear(firstRecordDate)}` : "", year === Number(today.slice(0, 4)) ? `至 ${formatter.withinYear(today)}` : ""].filter(Boolean);
    return `${year}${parts.length ? `（${parts.join("，")}）` : ""}`;
}
export function reportWarnings(report) {
    const original = report.total.twd.unconverted.map(amount => `${amount.currency} ${displayAmount(amount.netMinor, amount.currency)}`).join("、");
    return [...(!report.complete ? ["紀錄未完整載入，總額不完整"] : []),
        ...(!report.total.twd.complete ? [`${report.total.twd.unconvertedCount} 筆缺少匯率${original ? `（${original}）` : ""}，未計入台幣總額`] : [])];
}
/** Shares and cell rounding are chart geometry only; money and rollups come from Core. */
export function reportModel(result, label) {
    const report = result.report;
    const categories = [...report.categories.filter(item => item.parentId === null).map(item => ({ id: item.categoryId, bucket: item.total })),
        { id: null, bucket: report.unclassified }].filter(item => item.bucket.recordCount > 0 &&
        (item.bucket.twd.netMinor !== 0 || !item.bucket.twd.complete || !report.complete))
        .sort((a, b) => b.bucket.twd.netMinor - a.bucket.twd.netMinor);
    const positive = categories.map(item => Math.max(0, item.bucket.twd.netMinor));
    const sum = positive.reduce((a, b) => a + b, 0);
    const raw = positive.map(value => sum ? value / sum * 100 : 0), cells = raw.map(Math.floor);
    let left = sum ? 100 - cells.reduce((a, b) => a + b, 0) : 0;
    raw.map((value, index) => ({ index, remainder: value - Math.floor(value) })).sort((a, b) => b.remainder - a.remainder)
        .forEach(item => { if (left-- > 0)
        cells[item.index]++; });
    let cumulative = 0;
    return { result, label, scope: scopeLabel(report.scope), warnings: reportWarnings(report),
        net: displayAmount(report.total.twd.netMinor), expense: displayAmount(report.total.twd.expenseMinor), refund: displayAmount(report.total.twd.refundMinor),
        showNet: report.total.twd.netMinor !== 0 || !report.complete,
        showBreakdown: report.total.twd.refundMinor !== 0,
        categories: categories.map((item, index) => {
            const share = raw[index] / 100, start = cumulative;
            cumulative += share;
            return { ...categoryPresentation(result.categories, item.id),
                amount: `${displayAmount(item.bucket.twd.netMinor)}${item.bucket.twd.complete ? "" : " · 未換算"}`,
                percentage: item.bucket.twd.netMinor > 0 ? `${cells[index]}%` : "", netRefund: item.bucket.twd.netMinor <= 0,
                share, start, cells: cells[index] };
        }),
        csvRecordCount: new Set([...report.entries, ...report.futureEntries].map(entry => entry.record.id)).size,
        balances: result.installmentBalances,
        plans: result.installmentBalances.plans.filter(plan => plan.remainingCount > 0)
            .sort((a, b) => recordRow(b.record, result, false).date.localeCompare(recordRow(a.record, result, false).date)).map(plan => {
            const next = plan.schedule.find(item => !item.recognized);
            const row = recordRow(plan.record, result, false);
            return { id: plan.purchaseId, title: row.title,
                sub: [plan.record.notes, recordPaymentMethodName(plan.record.paymentMethod, result), result.projects.find(item => item.id === plan.record.projectId)?.label].filter(Boolean).join(" · "),
                remaining: plan.remainingTwdMinor === null ? `${plan.currency} ${displayAmount(plan.remainingMinor, plan.currency)}` : displayAmount(plan.remainingTwdMinor),
                count: `剩 ${plan.remainingCount} 期`,
                next: next ? `下一期 ${reportDateLabel(next.on, result.asOf)} · ${next.reportingValue ? displayAmount(next.reportingValue.amountMinor) : `${plan.currency} ${displayAmount(next.amountMinor, plan.currency)}`}` : "" };
        }) };
}
export function comparisonYearChips(availableYears, selected) {
    return availableYears.map(year => ({ year, selected: selected.includes(year),
        disabled: selected.includes(year) && selected.length <= 2 }));
}
export function toggleComparisonYear(availableYears, selected, year) {
    const chip = comparisonYearChips(availableYears, selected).find(item => item.year === year);
    if (!chip || chip.disabled)
        return selected;
    return (chip.selected ? selected.filter(value => value !== year) : [...selected, year]).sort((a, b) => b - a);
}
export function comparisonModel(comparison, result) {
    const formatter = screenDateFormatter(result.asOf, comparison.years.flatMap(year => [year.from, year.to]), { alwaysYear: true });
    const labels = comparison.years.map(({ year, from, to }) => {
        if (comparison.samePeriod)
            return formatter.range(from, to);
        return reportYearLabel(year, result.asOf, comparison.firstRecordDate);
    });
    const complete = (bucket, index) => comparison.years[index].report.complete && bucket.twd.complete;
    const unavailable = (bucket, index) => !comparison.years[index].report.complete ? "不完整" : !bucket.twd.complete ? "未換算" : null;
    const cells = (buckets) => {
        const max = Math.max(1, ...buckets.map((bucket, index) => complete(bucket, index) ? bucket.twd.netMinor : 0));
        return buckets.map((bucket, index) => ({ year: comparison.years[index].year, label: labels[index],
            amount: unavailable(bucket, index) ?? displayAmount(bucket.twd.netMinor),
            width: complete(bucket, index) ? Math.max(0, bucket.twd.netMinor) / max * 100 : 0 }));
    };
    const difference = (buckets) => {
        if (buckets.length !== 2)
            return null;
        const reasons = buckets.map(unavailable);
        if (reasons.some(Boolean))
            return { label: `比 ${comparison.years[1].year}`, amount: reasons.includes("不完整") ? "不完整" : "未換算" };
        const delta = buckets[0].twd.netMinor - buckets[1].twd.netMinor;
        if (delta === 0)
            return null;
        return { label: `比 ${comparison.years[1].year}`, amount: `${delta >= 0 ? "+" : ""}${displayAmount(delta)}` };
    };
    const totals = comparison.years.map(year => year.report.total);
    const hasValue = (buckets) => buckets.some((bucket, index) => bucket.recordCount > 0 &&
        (bucket.twd.netMinor !== 0 || !complete(bucket, index)));
    const categories = comparison.categories.filter(item => hasValue(item.years))
        .sort((a, b) => (b.years[0]?.twd.netMinor ?? 0) - (a.years[0]?.twd.netMinor ?? 0));
    return { warnings: comparison.years.flatMap(({ year, report }) => reportWarnings(report).map(warning => `${year} · ${warning}`)),
        samePeriod: comparison.samePeriod, years: cells(totals), difference: difference(totals),
        subcategories: comparison.subcategories.filter(item => hasValue(item.years))
            .sort((a, b) => a.categoryId === null ? 1 : b.categoryId === null ? -1 : (b.years[0]?.twd.netMinor ?? 0) - (a.years[0]?.twd.netMinor ?? 0))
            .map(item => ({ ...categoryPresentation(result.categories, item.categoryId), label: item.label, years: cells(item.years), difference: difference(item.years) })),
        categories: categories.map(item => ({ ...categoryPresentation(result.categories, item.categoryId),
            years: cells(item.years), difference: difference(item.years) })) };
}
export function categoryRecordRows(category, result, screenDates = []) {
    const dates = screenDateFormatter(result.asOf, screenDates, { alwaysYear: true });
    return category.records.map(item => {
        const row = recordRow(item.record, result, false, { noCategory: true }), date = dates.day(row.date);
        return { ...row,
            reportingAmountMinor: item.amountTwdMinor,
            secondaryIncludesDate: !(item.record.reportingValue && item.record.currency !== "TWD"),
            ...(item.record.installment ? { badge: `第 ${item.record.installment.schedule.filter(period => period.on <= result.asOf).length}/${item.record.installment.schedule.length} 期` } : {}),
            amount: `${item.record.kind === "refund" ? "+" : ""}${item.amountTwdMinor === null ? `${item.currency} ${displayAmount(item.amountMinor, item.currency)} · 未換算` : displayAmount(item.amountTwdMinor)}`,
            secondary: item.record.reportingValue && item.record.currency !== "TWD" ? row.secondary : date };
    });
}
