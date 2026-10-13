export const COMPANION_SLEEP_AFTER_MS = 3 * 24 * 60 * 60 * 1000;
const HAPPY_DURATION_MS = 2_600;
const ATTENTION_DURATION_MS = 3_400;
function instant(value) {
    if (value === null)
        return null;
    const milliseconds = Date.parse(value);
    if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value)
        throw new RangeError("Invalid companion timestamp");
    return milliseconds;
}
function recent(now, event, duration) {
    if (event === null)
        return false;
    const elapsed = now - event;
    return elapsed >= 0 && elapsed < duration;
}
/** Select one design state from current viewer facts; spending amounts are not inputs. */
export function selectCompanion(input) {
    const now = instant(input.now);
    const lastOpened = instant(input.lastOpenedAt);
    const automaticCapture = instant(input.lastAutomaticCaptureAt);
    const manualSave = instant(input.lastManualSaveAt);
    const organization = instant(input.lastOrganizationAt);
    if (now === null || !Number.isFinite(input.sleepAfterMs) || input.sleepAfterMs <= 0 ||
        !Number.isSafeInteger(input.unclassifiedCount) || input.unclassifiedCount < 0 || typeof input.readOnly !== "boolean") {
        throw new RangeError("Invalid companion state input");
    }
    if (!["syncing", "incomplete", "offline", "failed", "synced"].includes(input.synchronization)) {
        throw new RangeError("Invalid synchronization state");
    }
    let state = "idle";
    // The prototype's order is sleep > wait > gaze > active mood > unclassified > idle.
    // Its mood is the most recent active pulse; when two pulses share an instant, attention wins.
    if (lastOpened !== null && now - lastOpened >= input.sleepAfterMs)
        state = "sleep";
    else if (input.synchronization === "syncing" || input.synchronization === "incomplete")
        state = "wait";
    else if (input.synchronization === "offline" || input.synchronization === "failed")
        state = "gaze";
    else {
        const activities = [];
        if (automaticCapture !== null && (lastOpened === null || automaticCapture > lastOpened) && recent(now, automaticCapture, ATTENTION_DURATION_MS)) {
            activities.push({ at: automaticCapture, state: "attention" });
        }
        if (recent(now, manualSave, ATTENTION_DURATION_MS))
            activities.push({ at: manualSave, state: "attention" });
        if (recent(now, organization, HAPPY_DURATION_MS))
            activities.push({ at: organization, state: "happy" });
        activities.sort((left, right) => right.at - left.at ||
            (left.state === right.state ? 0 : left.state === "attention" ? -1 : 1));
        const activity = activities[0];
        if (activity)
            state = activity.state;
        else if (input.unclassifiedCount > 0)
            state = "rummage";
    }
    return Object.freeze({ state, penVisible: !input.readOnly });
}
