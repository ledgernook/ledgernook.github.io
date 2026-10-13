/** A bounded, cancellable UI sync flight. Abandoned results are stale and cannot update UI state. */
export function createSyncOperation(timeoutMs) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1)
        throw new RangeError("Invalid sync operation timeout");
    const controller = new AbortController();
    let end = "running";
    const timeout = setTimeout(() => {
        if (end !== "running")
            return;
        end = "timed-out";
        controller.abort();
    }, timeoutMs);
    return {
        signal: controller.signal,
        get end() { return end; },
        get current() { return end === "running" && !controller.signal.aborted; },
        abort() {
            if (end !== "running")
                return;
            end = "abandoned";
            clearTimeout(timeout);
            controller.abort();
        },
        finish() {
            clearTimeout(timeout);
            if (end === "running")
                end = "completed";
        },
    };
}
