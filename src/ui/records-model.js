import { incompleteHistoryNotice } from "./history-coverage-model.js";
import { recordRow, sortViewerRecords } from "./record-list-model.js";
export function isUnclassifiedRecord(record) {
    return !record.split && record.categoryId === null;
}
export function recordsModel(input) {
    const allRecords = input.allRecords?.records ?? [];
    const unclassifiedCount = allRecords.filter(isUnclassifiedRecord).length;
    const result = input.result;
    if (!result)
        return { rows: [], count: 0, countLabel: input.query.trim() ? "0 筆" : null, incompleteNotice: null, unclassifiedCount };
    const records = input.unclassifiedOnly ? result.records.filter(isUnclassifiedRecord) : result.records;
    // Sort before slicing; format only the visible page for large local searches.
    const freshRecordIds = input.freshRecordIds ?? new Set();
    const ordered = input.sort === "amount" ? sortViewerRecords(records, result.timeZone, "amount") : records;
    const rows = ordered.slice(0, input.limit).map(record => recordRow(record, result, input.writable, { fresh: freshRecordIds.has(record.id) }));
    const searching = input.query.trim().length > 0;
    let incompleteNotice = null;
    if (!result.coverage.complete) {
        const detail = incompleteHistoryNotice(result.coverage, input.allRecords?.earliestRecordDate ?? null, input.currentMonth ?? result.lastSynchronized?.synchronizedAt.slice(0, 7) ?? "")
            ?? "較早的紀錄可能尚未載入此裝置";
        incompleteNotice = result.rebuilding ? `重建中：${detail}` : detail;
    }
    return { rows, count: records.length, countLabel: searching ? `${records.length} 筆` : null, incompleteNotice, unclassifiedCount };
}
