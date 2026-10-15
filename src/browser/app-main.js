import { attachViewerPageLifecycle } from "./page-lifecycle.js";
import { bankDisplayName } from "../banks/index.js";
import { mountViewerApp } from "../ui/viewer-app.js";
import { installAppearanceSetting } from "./appearance.js";
import { createDevicePresentation } from "./device-presentation.js";
import { createMonthlyDemo } from "./monthly-demo.js";
import { createPrivateMonthly } from "./monthly-connection.js";
import { activateWaitingBuild, checkForUpdate, registerViewerServiceWorker } from "./service-worker.js";
import { createRememberedConnection } from "./remembered-connection.js";
import { createLedgerRetentionConsent } from "./connection-retention.js";
import { GitHubRepositoryCatalog } from "../storage/repositories.js";
import { mountConnectionApp } from "../ui/connection-view.js";
import { nook } from "../ui/skins/nook.js";
import { installReportChartSetting } from "./report-chart-setting.js";
import { installProjectSortSetting } from "./project-sort-setting.js";
import { COMPANION_SLEEP_AFTER_MS } from "../application/companion.js";
import { unrecordedReader } from "./unrecorded-reader.js";
import { createProgramReset } from "./program-reset.js";
const root = document.getElementById("app");
if (!root)
    throw new Error("App root is missing");
export const appearanceSetting = installAppearanceSetting();
const devicePresentation = createDevicePresentation();
export const reportChartSetting = installReportChartSetting();
export const projectSortSetting = installProjectSortSetting();
const clock = () => new Date().toISOString();
const buildId = globalThis.__LEDGERNOOK_BUILD_ID__ ?? "development";
const programReset = createProgramReset({ fetch: (url, init) => fetch(url, init), reload: () => location.reload(),
    ...("serviceWorker" in navigator ? { serviceWorker: navigator.serviceWorker } : {}),
    ...("caches" in globalThis ? { caches: globalThis.caches } : {}) });
export let app;
export let appShell;
let connectionApp;
let viewerStorage;
try {
    viewerStorage = window.localStorage;
}
catch { /* Session memory remains available. */ }
const savedConnection = createRememberedConnection(viewerStorage);
const retention = createLedgerRetentionConsent(viewerStorage, location.origin);
const remembered = savedConnection;
const catalog = new GitHubRepositoryCatalog((url, init) => fetch(url, init));
const defaultPorts = { catalog, demo: () => createMonthlyDemo(bankDisplayName, clock), connect: openConnection, now: clock };
let connectionPorts = defaultPorts;
/** Injected ports are also used by synthetic journeys, with no alternative screen markup. */
export function showWelcome(ports = defaultPorts) {
    app?.dispose();
    connectionApp?.dispose();
    connectionPorts = ports;
    connectionApp = mountConnectionApp(root, { catalog: ports.catalog, connect: ports.connect,
        demo: async () => { await startSession(await ports.demo(), ports.now, null, true); }, changed: () => { } }, nook);
    return connectionApp.model;
}
/** One injectable composition root for device sessions and deterministic synthetic captures. */
export function startSession(session, now = clock, lastOpenedAt, demoJourney = false, connectionNotice = "") {
    connectionApp?.dispose();
    connectionApp = undefined;
    app?.dispose();
    const previousOpen = lastOpenedAt === undefined ? devicePresentation.lastOpenedAt : lastOpenedAt;
    const openedAt = now();
    if (!demoJourney)
        devicePresentation.recordOpenedAt(openedAt);
    app = mountViewerApp(root, session, { now, operationId: () => crypto.randomUUID(), localTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", lastOpenedAt: previousOpen,
        connectionNotice, chartPreference: reportChartSetting, projectSortPreference: projectSortSetting, unrecordedReader, buildId, programReset: programReset.reset,
        appearance: appearanceSetting, forgotten: () => showWelcome(connectionPorts),
        ...(demoJourney ? { exitDemo: () => {
                void session.disconnect();
                showWelcome(connectionPorts);
            } } : {}),
        repositoryCatalog: connectionPorts.catalog,
        history: (result, id) => {
            const source = result.sourcePaths[id];
            if (!source || !session.owner || !session.repo || session.kind === "demo")
                return;
            const record = result.report.records.find(item => item.id === id);
            const path = record?.details ? source.replace(/^events\//u, "details/") : source;
            window.open(`https://github.com/${encodeURIComponent(session.owner)}/${encodeURIComponent(session.repo)}/commits/${encodeURIComponent(session.branch)}/${path.split("/").map(encodeURIComponent).join("/")}`, "_blank", "noopener");
        } });
    appShell = app.shell;
    const wakeAfterAbsence = lastOpenedAt === undefined && previousOpen !== null && Date.parse(openedAt) - Date.parse(previousOpen) >= COMPANION_SLEEP_AFTER_MS;
    const mounted = app;
    return mounted.ready.then(() => { if (wakeAfterAbsence)
        mounted.wakeCompanion(); });
}
/** The connection screen supplies its validated connection and explicit retention choice. */
export async function openConnection(connection, remember, now = clock) {
    remembered.clear();
    retention.clear(connection);
    const retainLedger = remember && retention.save(connection);
    const session = await createPrivateMonthly(connection, retainLedger, buildId, remembered, bankDisplayName, now, unrecordedReader);
    const credentialRetained = remember ? session.remember?.() === true : false;
    const notice = remember && (!retainLedger || !credentialRetained) ? "無法完整記住連線與帳本；關閉後可能需要重新連接" : "";
    return startSession(session, now, null, false, notice);
}
async function openInitial() {
    const connection = remembered.load();
    if (!connection) {
        showWelcome();
        return;
    }
    try {
        await startSession(await createPrivateMonthly(connection, retention.load(connection), buildId, remembered, bankDisplayName, clock, unrecordedReader), clock);
    }
    catch {
        remembered.clear();
        showWelcome();
    }
}
const UPDATE_RELOAD_KEY = "ledgernook.viewer.update-reload.v1";
let workerRegistration;
async function boot() {
    const repeatOpen = "serviceWorker" in navigator && !!navigator.serviceWorker.controller;
    await registerViewerServiceWorker();
    try {
        workerRegistration = await navigator.serviceWorker?.getRegistration();
    }
    catch { /* Offline/session-only use remains available. */ }
    if (workerRegistration && repeatOpen)
        await checkForUpdate(workerRegistration);
    if (workerRegistration?.waiting && !app) {
        let canReload = false;
        try {
            canReload = sessionStorage.getItem(UPDATE_RELOAD_KEY) !== "1";
            if (canReload)
                sessionStorage.setItem(UPDATE_RELOAD_KEY, "1");
        }
        catch {
            canReload = false; /* Leave activation to the next open if a reload cannot be guarded. */
        }
        if (canReload && await activateWaitingBuild(workerRegistration)) {
            location.reload();
            await new Promise(() => { });
        }
    }
    await openInitial();
    try {
        sessionStorage.removeItem(UPDATE_RELOAD_KEY);
    }
    catch { /* Storage may be denied. */ }
}
export const appReady = boot();
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && workerRegistration)
        void checkForUpdate(workerRegistration);
});
attachViewerPageLifecycle(window, () => {
    appearanceSetting.dispose();
    connectionApp?.dispose();
    app?.dispose();
}, () => location.reload(), () => app?.flushPush() ?? Promise.resolve());
