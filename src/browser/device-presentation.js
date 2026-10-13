const LAST_OPENED_KEY = "ledgernook.viewer.last-opened-at.v1";
function browserStorage() {
    try {
        return window.localStorage;
    }
    catch {
        return null;
    }
}
/** Stores device-only presentation state; ledger preferences remain in the application service. */
export function createDevicePresentation(storage = browserStorage()) {
    let lastOpenedAt = null;
    try {
        const saved = storage?.getItem(LAST_OPENED_KEY) ?? null;
        if (saved !== null && Number.isFinite(Date.parse(saved)) && new Date(saved).toISOString() === saved)
            lastOpenedAt = saved;
    }
    catch { /* Device state is optional when browser storage is unavailable. */ }
    return {
        get lastOpenedAt() { return lastOpenedAt; },
        recordOpenedAt(value) {
            if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value)
                throw new RangeError("Invalid viewer open time");
            lastOpenedAt = value;
            try {
                storage?.setItem(LAST_OPENED_KEY, value);
            }
            catch { /* Keep the timestamp for this session. */ }
        },
    };
}
