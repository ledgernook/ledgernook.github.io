const key = "ledgernook.viewer.report-chart.v1";
/** Only the device's chart choice is retained, with an in-memory fallback when storage is denied. */
export function installReportChartSetting() {
    let chart = "bar";
    try {
        const saved = localStorage.getItem(key);
        if (saved === "ring" || saved === "grid")
            chart = saved;
    }
    catch { /* Session-only fallback. */ }
    return { get: () => chart, set(value) { chart = value; try {
            localStorage.setItem(key, value);
        }
        catch { /* Session-only fallback. */ } } };
}
