import { LOCAL_SCHEMA_VERSION } from "../local/index.js";
const UPDATE_CHECK_KEY = "ledgernook.viewer.update-check.v1";
const UPDATE_INTERVAL_MS = 60 * 60 * 1000;
let lastUpdateCheck = 0;
/** update() resolves before the install event finishes; bootstrap must wait for verification. */
async function waitForInstall(registration) {
    const worker = registration.installing;
    if (!worker)
        return;
    await new Promise((resolve, reject) => {
        const finish = (error) => {
            clearTimeout(timeout);
            worker.removeEventListener("statechange", changed);
            if (error)
                reject(error);
            else
                resolve();
        };
        const changed = () => {
            if (worker.state === "installed" || worker.state === "activated")
                finish();
            else if (worker.state === "redundant")
                finish(new Error("worker-install-failed"));
        };
        const timeout = setTimeout(() => finish(new Error("worker-install-timeout")), 15000);
        worker.addEventListener("statechange", changed);
        changed();
    });
}
export async function checkForUpdate(registration) {
    const now = Date.now();
    try {
        const saved = Number(sessionStorage.getItem(UPDATE_CHECK_KEY));
        if (Number.isFinite(saved) && saved <= now)
            lastUpdateCheck = Math.max(lastUpdateCheck, saved);
    }
    catch { /* In-memory throttling still works when storage is denied. */ }
    if (now - lastUpdateCheck < UPDATE_INTERVAL_MS)
        return;
    lastUpdateCheck = now;
    try {
        sessionStorage.setItem(UPDATE_CHECK_KEY, String(now));
    }
    catch { /* Session memory remains available. */ }
    try {
        await registration.update();
        await waitForInstall(registration);
    }
    catch { /* The running build remains available; retry on a later check. */ }
}
export async function activateWaitingBuild(registration) {
    const waiting = registration.waiting;
    if (!waiting)
        return false;
    const previous = navigator.serviceWorker.controller;
    return new Promise(resolve => {
        const finish = (changed) => {
            clearTimeout(timeout);
            navigator.serviceWorker.removeEventListener("controllerchange", changedController);
            resolve(changed);
        };
        const changedController = () => { if (navigator.serviceWorker.controller !== previous)
            finish(true); };
        const timeout = setTimeout(() => finish(false), 3000);
        navigator.serviceWorker.addEventListener("controllerchange", changedController);
        try {
            waiting.postMessage({ type: "activate-waiting" });
        }
        catch {
            finish(false);
        }
    });
}
export async function registerViewerServiceWorker() {
    if (!("serviceWorker" in navigator))
        return "離線程式快取不可用；程式需連線載入。";
    try {
        const response = await fetch("./precache-manifest.json", { cache: "no-store", credentials: "omit" });
        if (!response.ok)
            throw new Error("manifest-unavailable");
        const manifest = await response.json();
        if (manifest.localSchemaVersion !== LOCAL_SCHEMA_VERSION || typeof manifest.buildId !== "string" || !Array.isArray(manifest.assets)) {
            throw new Error("version-mismatch");
        }
        const workerUrl = new URL("./service-worker.js", location.href);
        const registration = await navigator.serviceWorker.register(workerUrl, { scope: new URL("./", location.href).pathname, updateViaCache: "none" });
        await waitForInstall(registration);
        await navigator.serviceWorker.ready;
        if (!registration.active)
            throw new Error("worker-inactive");
        return "離線程式快取已啟用；私人資料仍分開保存在本機資料庫。";
    }
    catch {
        return "離線程式快取無法使用；私人資料同步不受影響，但離線載入程式不可用。";
    }
}
