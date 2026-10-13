import { screenDateFormatter } from "./screen-date-format.js";
/** Missing dependencies enumerate uncovered partitions, including failed reads.
 * Empty covered months need no record; dates alone cannot establish coverage. */
export function incompleteHistoryNotice(coverage, earliest, currentMonth) {
    if (coverage.complete || !earliest)
        return null;
    const from = earliest.slice(0, 7).replace("-", "/");
    const through = currentMonth.replace("-", "/");
    if (from > through)
        return null;
    let olderPending = false;
    for (const missing of coverage.missing) {
        if (missing === "history-pending") {
            olderPending = true;
            continue;
        }
        const partition = /^(?:events|details)\/v1\/(\d{4}\/(?:0[1-9]|1[0-2]))$/u.exec(missing)?.[1];
        if (!partition || partition >= from)
            return null;
        olderPending = true;
    }
    return olderPending ? `只載入 ${screenDateFormatter(`${currentMonth}-01`, []).timelineDate(earliest)} 起的紀錄，結果不完整` : null;
}
