import { changeReportRange, shiftMonth } from "./date-picker-model.js";
import { dateAt, shiftDate } from "./ledger-format.js";
import { reportModel, reportSubscriptionFilters, toggleComparisonYear } from "./report-model.js";
import { emptyReportPeriodMemory, rememberReportPeriod, reportBarLabel, reportPeriodBounds, reportPeriodRequest, startReportPeriodDraft, stepReportPeriod } from "./report-period-model.js";
import { reportPeriodSheetView } from "./report-period-view.js";
import { csvSheetView, reportPeriodControl, reportView } from "./report-view.js";
import { exportViewerCsv } from "./csv.js";
import { el } from "./dom.js";
import { button, notice, deferNativeDateRender, segments } from "./shared-controls.js";
function isInvalidComparisonSelection(error) {
    return error instanceof RangeError && error.message === "Select at least two years with records";
}
/** Report navigation and drafts stay here; all accounting uses the session's local queries. */
export function createReportFeature(session, shell, options) {
    let chart = options.chartPreference?.get() ?? "bar";
    let subscription = "all";
    const today = () => dateAt(options.now(), context?.timeZone ?? "UTC");
    let committed = { mode: "month", month: dateAt(options.now(), "UTC").slice(0, 7) };
    let memory = emptyReportPeriodMemory(), draft = null;
    let availableYears = [];
    let context, baseContext, revision = 0, categoryId;
    let category = null;
    const categorySorts = new Map();
    let comparison = null;
    let categoryComparison = null;
    let filteredComparison = null, subcategoryId;
    let comparisonScroll, restoreComparisonScroll = false, openingComparedCategory = false;
    const scroll = () => ({ primary: shell.content?.scrollTop ?? 0, secondary: shell.element?.querySelector(".lk-layout-secondary")?.scrollTop ?? 0 });
    function restoreScroll(position) {
        if (shell.content)
            shell.content.scrollTop = position.primary;
        const secondary = shell.element?.querySelector(".lk-layout-secondary");
        if (secondary)
            secondary.scrollTop = position.secondary;
    }
    let earliest = null;
    const mergedFilters = (filters) => {
        const merged = { ...filters, ...reportSubscriptionFilters(subscription) };
        return Object.keys(merged).length ? merged : undefined;
    };
    const label = () => reportBarLabel(committed, today(), earliest);
    function markPeriodOpen(open) {
        shell.element?.querySelectorAll(".lk-report-period-label").forEach(node => node.setAttribute("aria-expanded", String(open)));
    }
    function commit(value) {
        if ((value.mode === "yoy") !== (committed.mode === "yoy")) {
            categoryId = undefined;
            subcategoryId = undefined;
            comparisonScroll = undefined;
        }
        committed = value;
        memory = rememberReportPeriod(memory, value);
        if (draft)
            shell.sheets.dismiss();
        void load();
    }
    async function openPeriod() {
        if (!context || draft)
            return;
        const token = revision;
        try {
            if (session.report) {
                const filters = mergedFilters();
                const result = await session.report({ kind: "year-comparison", asOf: today(), scope: options.scope(), ...(filters ? { filters } : {}) });
                if (result.kind === "year-comparison")
                    availableYears = result.availableYears;
            }
        }
        catch { /* Month, year and range selection remain available if comparison cannot load. */ }
        if (!options.active() || token !== revision || draft)
            return;
        draft = startReportPeriodDraft(memory, committed, today(), earliest, availableYears);
        const element = el("div");
        function updateDraftView() {
            if (!draft || deferNativeDateRender(element, updateDraftView))
                return;
            const current = draft;
            const view = reportPeriodSheetView(current, today(), earliest, availableYears, {
                tab: tab => { current.tab = tab; updateDraftView(); },
                stepYear: direction => { current.month.year += direction; updateDraftView(); },
                month: month => commit({ mode: "month", month }), year: year => commit({ mode: "year", year }),
                comparisonYear: year => { current.comparison = { ...current.comparison, years: toggleComparisonYear(availableYears, current.comparison.years, year) }; updateDraftView(); },
                samePeriod: () => { current.comparison = { ...current.comparison, samePeriod: !current.comparison.samePeriod }; updateDraftView(); },
                date: (field, date) => { current.range = { ...changeReportRange(current.range, field, date), preset: null }; updateDraftView(); },
                preset: (preset, range) => { current.range = { ...range, preset }; updateDraftView(); },
                apply: () => {
                    if (current.tab === "yoy")
                        commit({ mode: "yoy", comparison: current.comparison });
                    else if (current.tab === "range")
                        commit({ mode: "range", range: current.range });
                },
            });
            element.replaceChildren(view.element);
        }
        updateDraftView();
        markPeriodOpen(true);
        shell.sheets.open({ title: "報表期間", origin: "left", swipe: "rubber-band", dismissOnBackdrop: true,
            view: { element, dispose() { draft = null; markPeriodOpen(false); } }, close: () => shell.sheets.dismiss() });
    }
    function present(view, arrangement) {
        const requestedRevision = revision;
        if (deferNativeDateRender(shell.content, () => {
            if (!options.active())
                return;
            if (requestedRevision === revision)
                present(view, arrangement);
            else
                render();
        }))
            return;
        const primary = arrangement?.parts?.primary[0] ?? view.element;
        if (options.connectionNotice)
            primary.prepend(notice(options.connectionNotice, "error"));
        shell.show(view, arrangement);
    }
    function render() {
        if (!context || !options.active())
            return;
        const position = scroll();
        const period = committed.mode;
        const view = reportView(reportModel(context, label()), { period, chart, subscription, category, comparison, categoryComparison, filteredComparison, subcategoryId,
            periodStep: reportPeriodBounds(committed, earliest, today()),
            recordSort: categorySorts.get(period === "yoy" ? `comparison:${categoryId}` : categoryId ?? null) ?? "amount",
            ...(baseContext ? { baseModel: reportModel(baseContext, label()) } : {}) }, {
            openPeriod: () => { void openPeriod(); }, scope: options.changeScope,
            step: direction => { const next = stepReportPeriod(committed, direction, earliest, today()); if (next !== committed)
                commit(next); },
            chart: value => { chart = value; options.chartPreference?.set(value); render(); },
            openSubscription,
            sort: value => { categorySorts.set(period === "yoy" ? `comparison:${categoryId}` : categoryId ?? null, value); render(); },
            category: id => { if (period === "yoy") {
                comparisonScroll = scroll();
                openingComparedCategory = true;
            } categoryId = id; subcategoryId = undefined; void load(); },
            subcategory: id => { subcategoryId = subcategoryId === id ? undefined : id; void load(); },
            back: () => { categoryId = undefined; subcategoryId = undefined; if (period === "yoy")
                restoreComparisonScroll = true; void load(); },
            open, csv: openCsv,
        });
        present(view, view.arrangement);
        if (draft)
            markPeriodOpen(true);
        if (restoreComparisonScroll && comparisonScroll) {
            restoreScroll(comparisonScroll);
            restoreComparisonScroll = false;
        }
        else if (categoryComparison)
            restoreScroll(openingComparedCategory ? { primary: shell.layout === "regular" ? position.primary : 0, secondary: 0 } : position);
        openingComparedCategory = false;
    }
    function open(id) {
        if (!context)
            return;
        const record = (filteredComparison ?? categoryComparison)?.records.find(item => item.record.id === id)?.record ?? context.report.records.find(item => item.id === id) ?? context.installmentBalances.plans.find(item => item.purchaseId === id)?.record;
        if (record)
            options.open(id, { ...context, report: { ...context.report, records: [...context.report.records.filter(item => item.id !== id), record] } });
    }
    async function load(base) {
        if (base) {
            if (!context) {
                const date = dateAt(options.now(), base.timeZone);
                committed = { mode: "month", month: date.slice(0, 7) };
            }
            context = base;
            baseContext = base;
        }
        if (!context || !options.active())
            return;
        const token = ++revision, asOf = today(), scope = options.scope(), period = committed.mode, request = reportPeriodRequest(committed, asOf, earliest);
        const comparisonValue = committed.mode === "yoy" ? committed.comparison : { years: [], samePeriod: false };
        const samePeriod = comparisonValue.samePeriod;
        try {
            const baseRequest = { period: request, asOf, scope };
            const baseFilters = mergedFilters();
            const queryFilters = mergedFilters(categoryId !== undefined ? { categoryId } : undefined);
            const [next, full] = await Promise.all([
                session.query({ ...baseRequest, ...(queryFilters ? { filters: queryFilters } : {}) }),
                categoryId !== undefined ? session.query({ ...baseRequest, ...(baseFilters ? { filters: baseFilters } : {}) }) : Promise.resolve(undefined),
            ]);
            let extra = null;
            if (session.report) {
                if (period !== "yoy" && categoryId !== undefined)
                    extra = await session.report({ kind: "category-records", period: request, categoryId, asOf, scope,
                        ...(baseFilters ? { filters: baseFilters } : {}) });
                else if (period === "yoy") {
                    const requestedYears = comparisonValue.years.length >= 2 ? comparisonValue.years : undefined;
                    const comparisonRequest = { kind: "year-comparison", asOf, scope, samePeriod, ...(requestedYears ? { years: requestedYears } : {}),
                        ...(baseFilters ? { filters: baseFilters } : {}) };
                    try {
                        extra = await session.report(comparisonRequest);
                    }
                    catch (error) {
                        if (!requestedYears || !isInvalidComparisonSelection(error))
                            throw error;
                        const available = await session.report({ kind: "year-comparison", asOf, scope, samePeriod, ...(baseFilters ? { filters: baseFilters } : {}) });
                        if (token !== revision || !options.active())
                            return;
                        if (available.kind !== "year-comparison")
                            throw error;
                        const retained = requestedYears.filter(year => available.availableYears.includes(year));
                        const reconciled = available.availableYears.length >= 2 && retained.length >= 2
                            ? retained : available.years.map(item => item.year);
                        committed = { mode: "yoy", comparison: { years: reconciled, samePeriod } };
                        memory = rememberReportPeriod(memory, committed);
                        const defaults = available.years.map(item => item.year);
                        extra = reconciled.length === defaults.length && reconciled.every((year, index) => year === defaults[index])
                            ? available : await session.report({ kind: "year-comparison", asOf, scope, samePeriod, years: reconciled,
                            ...(baseFilters ? { filters: baseFilters } : {}) });
                    }
                }
                else if (request.kind === "range")
                    extra = await session.report({ ...request, asOf, scope, ...(baseFilters ? { filters: baseFilters } : {}) });
                else
                    extra = await session.report({ kind: "range", from: `${request.month}-01`,
                        to: request.month === asOf.slice(0, 7) ? asOf : shiftDate(`${shiftMonth(request.month, 1)}-01`, -1), asOf, scope,
                        ...(baseFilters ? { filters: baseFilters } : {}) });
            }
            let nextCategoryComparison = null, nextFilteredComparison = null;
            if (extra?.kind === "year-comparison" && typeof categoryId === "string" && session.report) {
                const years = extra.years.map(item => item.year);
                const categoryRequest = { kind: "year-comparison", asOf, scope, samePeriod,
                    ...(years.length >= 2 ? { years } : {}), filters: mergedFilters({ categoryId }) };
                const detail = await session.report(categoryRequest);
                if (token !== revision || !options.active())
                    return;
                if (detail.kind === "year-comparison")
                    nextCategoryComparison = detail;
                if (subcategoryId !== undefined && !nextCategoryComparison?.subcategories.some(item => item.categoryId === subcategoryId && item.years.some(bucket => bucket.recordCount > 0)))
                    subcategoryId = undefined;
                if (subcategoryId !== undefined) {
                    const filtered = await session.report({ ...categoryRequest, filters: mergedFilters({ categoryId, subcategoryId }) });
                    if (filtered.kind === "year-comparison")
                        nextFilteredComparison = filtered;
                }
            }
            if (token !== revision || !options.active())
                return;
            categoryComparison = nextCategoryComparison;
            filteredComparison = nextFilteredComparison;
            context = next;
            baseContext = full ?? next;
            earliest = next.earliestRecordDate;
            category = extra?.kind === "category-records" ? extra : null;
            comparison = extra?.kind === "year-comparison" ? extra : null;
            if (comparison) {
                availableYears = comparison.availableYears;
                committed = { mode: "yoy", comparison: { years: comparison.years.map(item => item.year), samePeriod } };
                memory = rememberReportPeriod(memory, committed);
            }
            render();
        }
        catch {
            if (token !== revision || !options.active())
                return;
            const element = el("div", undefined, "lk-report lk-feature-view");
            const controls = el("div");
            controls.append(reportPeriodControl(label(), period === "yoy", scope, reportPeriodBounds(committed, earliest, today()), {
                openPeriod: () => { void openPeriod(); }, scope: options.changeScope, step: direction => commit(stepReportPeriod(committed, direction, earliest, today()))
            }));
            element.append(controls, el("p", "無法載入報表", "lk-notice"), button("重試", () => { void load(); }, "lk-report-export"));
            present({ element });
        }
    }
    function openCsv() {
        if (!context)
            return;
        const exportContext = context;
        shell.sheets.open({ title: "匯出 CSV", swipe: "close", origin: "left", view: csvSheetView(reportModel(exportContext, label()), { download: () => {
                    const csv = exportViewerCsv(exportContext, id => exportContext.billingCycleSpending.groups.find(group => group.bankId === id)?.label ?? id, session.kind === "private" ? { owner: session.owner, repo: session.repo, branch: session.branch } : undefined);
                    const url = URL.createObjectURL(new Blob([csv.content], { type: "text/csv;charset=utf-8" }));
                    const link = el("a");
                    link.href = url;
                    link.download = csv.filename;
                    document.body.append(link);
                    link.click();
                    link.remove();
                    setTimeout(() => URL.revokeObjectURL(url), 2000);
                    shell.sheets.dismiss();
                } }), close: () => shell.sheets.dismiss() });
    }
    function openSubscription() {
        const element = el("div", undefined, "lk-report-subscription-sheet");
        const choices = [["all", "全部"], ["only", "只看訂閱"], ["exclude", "不含訂閱"]];
        const control = segments(choices.map(([value, label]) => ({ label, selected: subscription === value, run: () => {
                const changed = subscription !== value;
                subscription = value;
                shell.sheets.dismiss();
                if (changed)
                    void load();
            } })));
        control.setAttribute("role", "group");
        control.setAttribute("aria-label", "訂閱");
        element.append(control);
        shell.sheets.open({ title: "訂閱", origin: "left", swipe: "close", dismissOnBackdrop: true,
            view: { element }, close: () => shell.sheets.dismiss() });
    }
    return { load, dispose() { revision++; },
        reset() {
            subscription = "all";
            categoryId = undefined;
            subcategoryId = undefined;
            category = null;
            categoryComparison = null;
            filteredComparison = null;
            comparisonScroll = undefined;
            restoreComparisonScroll = false;
            openingComparedCategory = false;
            commit({ mode: "month", month: today().slice(0, 7) });
        },
        // Invalidation also prevents a query completing after another tab was selected.
        leave() { revision++; },
    };
}
