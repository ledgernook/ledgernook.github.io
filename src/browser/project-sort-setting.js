const key = "ledgernook.viewer.project-sort.v1";
/** Only the device's project-list choice is retained, with an in-memory fallback when storage is denied. */
export function installProjectSortSetting() {
    let sort = "date";
    try {
        const saved = localStorage.getItem(key);
        if (saved === "amount")
            sort = saved;
    }
    catch { /* Session-only fallback. */ }
    return { get: () => sort, set(value) { sort = value; try {
            localStorage.setItem(key, value);
        }
        catch { /* Session-only fallback. */ } } };
}
