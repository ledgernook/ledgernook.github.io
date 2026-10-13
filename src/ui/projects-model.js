import { categoryPresentation } from "./category-presentation.js";
import { displayAmount, recordDate } from "./ledger-format.js";
import { recordRow, sortRecordRows } from "./record-list-model.js";
import { screenDateFormatter } from "./screen-date-format.js";
/** Regular layout opens the trip project, otherwise the first visible project. */
export function defaultProjectId(model) {
    const rows = [...model.active, ...model.archived];
    return (rows.find(row => row.trip) ?? rows[0])?.project.id ?? null;
}
export function projectDateRange(dates, dateFormatter) {
    if (!dates.length)
        return "";
    const ordered = [...dates].sort();
    const first = ordered[0];
    const last = ordered.at(-1);
    return first === last ? dateFormatter.date(first) : dateFormatter.range(first, last);
}
function projectItem(result, project, preferences, dateFormatter) {
    const cost = result.projectCosts.find(item => item.projectId === project.id);
    const records = result.report.records.filter(record => record.projectId === project.id);
    const dates = records.map(record => recordDate(record, result.timeZone));
    const startDate = dates.length ? [...dates].sort()[0] : null;
    const recognizedComplete = cost?.recognized.twd.complete ?? true;
    const futureComplete = cost?.future.twd.complete ?? true;
    const warnings = [!result.complete || (cost !== undefined && !cost.complete) ? "資料不完整" : "",
        recognizedComplete && futureComplete ? "" : "含未換算"].filter(Boolean);
    return {
        project, startDate, amountMinor: cost?.recognized.twd.netMinor ?? 0,
        span: projectDateRange(dates, dateFormatter), count: records.length ? `${records.length} 筆` : "",
        recognized: !recognizedComplete ? "未換算" : cost?.recognized.twd.netMinor ? displayAmount(cost.recognized.twd.netMinor) : "",
        future: !cost ? "" : futureComplete ? displayAmount(cost.future.twd.netMinor) : "未換算",
        hasFuture: (cost?.future.twd.netMinor ?? 0) > 0,
        trip: preferences.value.currentTrip?.projectId === project.id, warning: warnings.join(" · "),
    };
}
function compareProjectItems(left, right, sort) {
    if (left.startDate === null || right.startDate === null) {
        if (left.startDate === null && right.startDate === null)
            return left.project.id.localeCompare(right.project.id);
        if (left.startDate === null && right.startDate !== null)
            return 1;
        if (left.startDate !== null && right.startDate === null)
            return -1;
    }
    if (sort === "amount")
        return right.amountMinor - left.amountMinor || left.project.id.localeCompare(right.project.id);
    return right.startDate.localeCompare(left.startDate) || left.project.id.localeCompare(right.project.id);
}
export function projectsListModel(result, preferences, sort = "date", recoveredProjects = []) {
    const projectDates = result.report.records.filter(record => record.projectId !== null).map(record => recordDate(record, result.timeZone));
    const dateFormatter = screenDateFormatter(result.asOf, projectDates);
    const projects = new Map(result.projects.map(project => [project.id, project]));
    for (const project of recoveredProjects)
        if (!projects.has(project.id))
            projects.set(project.id, project);
    const recoveryIds = new Set((result.localChanges?.recoveryTargets ?? []).filter(target => target.kind === "project").map(target => target.objectId));
    const items = [...projects.values()].map(project => ({ ...projectItem(result, project, preferences, dateFormatter),
        ...(recoveryIds.has(project.id) ? { syncState: "failed" } : {}) }));
    const order = (rows) => rows.sort((left, right) => compareProjectItems(left, right, sort));
    return { active: order(items.filter(item => !item.project.archived)), archived: order(items.filter(item => item.project.archived)), sort };
}
export function projectPageModel(result, projectId, preferences, writable, selectedTripCurrency = "JPY", categoryFilter, recoveryProject, sort = "date") {
    const project = result.projects.find(item => item.id === projectId) ?? recoveryProject;
    const cost = result.projectCosts.find(item => item.projectId === projectId);
    if (!project)
        return null;
    if (!cost) {
        if (!recoveryProject)
            return null;
        const records = sortRecordRows(result.report.records.filter(record => record.projectId === projectId)
            .map(record => recordRow(record, result, writable, { noProject: true })), sort);
        return { project, sort, asOf: result.asOf, recognized: "", expense: "", refund: "", showBreakdown: false, future: "", hasFuture: false, overall: "",
            warning: [], dailyIncluded: project.includeInDaily === true, isTrip: preferences.value.currentTrip?.projectId === projectId,
            tripCurrency: preferences.value.currentTrip?.projectId === projectId ? preferences.value.currentTrip.currency : selectedTripCurrency,
            selectedCategoryId: null, categories: [], installments: [], records };
    }
    const recognizedComplete = cost.recognized.twd.complete;
    const futureComplete = cost.future.twd.complete;
    const overallComplete = cost.overall.twd.complete;
    const mainCategories = result.report.categories.filter(category => category.parentId === null && category.total.recordCount > 0 &&
        (category.total.twd.netMinor !== 0 || !category.total.twd.complete || !result.report.complete))
        .sort((left, right) => right.total.twd.netMinor - left.total.twd.netMinor);
    const largest = Math.max(1, ...mainCategories.map(category => category.total.twd.netMinor));
    const selectedCategoryId = categoryFilter?.categoryId ?? null;
    const categoryReport = categoryFilter?.result.report;
    const categories = mainCategories.map(category => {
        const selected = category.categoryId === selectedCategoryId;
        const categoryModel = { id: category.categoryId, label: category.label, amount: category.total.twd.complete ? displayAmount(category.total.twd.netMinor) : "未換算",
            width: `${Math.max(0, category.total.twd.netMinor / largest * 100).toFixed(1)}%`,
            presentation: categoryPresentation(result.categories, category.categoryId), selected,
            subcategories: [] };
        if (!selected || !categoryReport)
            return categoryModel;
        const selectedRollups = categoryReport.categories;
        const selectedMain = selectedRollups.find(item => item.categoryId === category.categoryId && item.parentId === null);
        const visible = (bucket) => bucket.recordCount > 0 &&
            (bucket.twd.netMinor !== 0 || !bucket.twd.complete || !categoryReport.complete);
        const subtotals = selectedRollups.filter(item => item.parentId === category.categoryId && visible(item.direct))
            .map(item => ({ label: item.label, amount: item.direct.twd.complete ? displayAmount(item.direct.twd.netMinor) : "未換算", amountMinor: item.direct.twd.netMinor, unspecified: false }));
        if (selectedMain && visible(selectedMain.direct))
            subtotals.push({ label: "不指定", amount: selectedMain.direct.twd.complete ? displayAmount(selectedMain.direct.twd.netMinor) : "未換算",
                amountMinor: selectedMain.direct.twd.netMinor, unspecified: true });
        subtotals.sort((left, right) => Number(left.unspecified) - Number(right.unspecified) || right.amountMinor - left.amountMinor || left.label.localeCompare(right.label));
        categoryModel.subcategories = subtotals.map(({ label, amount }) => ({ label, amount }));
        return categoryModel;
    });
    const recordResult = categoryFilter?.result ?? result;
    const records = sortRecordRows(recordResult.report.records.filter(record => record.projectId === projectId)
        .map(record => recordRow(record, recordResult, writable, { noProject: true, noCategory: selectedCategoryId !== null })), sort);
    const timelineDate = screenDateFormatter(result.asOf, []).timelineDate;
    const installments = result.installmentBalances.plans.filter(plan => plan.record.projectId === projectId && plan.remainingCount > 0)
        .map(plan => {
        const next = plan.schedule.find(item => !item.recognized);
        return { title: plan.record.merchant ?? plan.record.notes ?? "分期", next: next ? `${timelineDate(next.on)} · ${displayAmount(next.amountMinor, plan.currency)}` : "",
            remaining: plan.remainingTwdMinor === null ? "未換算" : displayAmount(plan.remainingTwdMinor), count: `剩 ${plan.remainingCount} 期` };
    });
    const warning = [!result.complete || !cost.complete ? "資料不完整" : "",
        recognizedComplete && futureComplete && overallComplete ? "" : "含未換算金額"].filter(Boolean);
    return {
        project, asOf: result.asOf, sort,
        recognized: !recognizedComplete ? "未換算" : cost.recognized.twd.netMinor !== 0 || !cost.complete ? displayAmount(cost.recognized.twd.netMinor) : "",
        expense: recognizedComplete ? displayAmount(cost.recognized.twd.expenseMinor) : "未換算",
        refund: recognizedComplete ? displayAmount(cost.recognized.twd.refundMinor) : "未換算",
        showBreakdown: cost.recognized.twd.refundMinor !== 0,
        future: futureComplete ? displayAmount(cost.future.twd.netMinor) : "未換算",
        hasFuture: cost.future.twd.netMinor > 0,
        overall: overallComplete ? displayAmount(cost.overall.twd.netMinor) : "未換算",
        warning, dailyIncluded: project.includeInDaily === true,
        isTrip: preferences.value.currentTrip?.projectId === project.id,
        tripCurrency: preferences.value.currentTrip?.projectId === project.id ? preferences.value.currentTrip.currency : selectedTripCurrency,
        selectedCategoryId, categories,
        installments, records,
    };
}
/** Candidate presentation only; project membership and reporting values remain owned by Core. */
export function projectBatchCandidates(result, from, to, writable) {
    return result.report.records.filter(record => record.projectId === null && record.kind === "expense" && !record.voided)
        .map(record => ({ record, row: recordRow(record, result, writable, { noProject: true }) }))
        .filter(item => (!from || item.row.date >= from) && item.row.date <= to)
        .sort((left, right) => right.row.date.localeCompare(left.row.date) || right.row.time.localeCompare(left.row.time) || left.record.id.localeCompare(right.record.id));
}
