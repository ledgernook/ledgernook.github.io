import { createPushScheduler } from "./push-scheduler.js";
import { createSyncOperation } from "./sync-operation.js";
import { blankManualDraft, canSaveManualDraft, keypadAmount, manualCommand, restoreManualDraft, unrecordedManualDraft, shouldReplaceManualDraft } from "./manual-entry-model.js";
import { unrecordedNoticeModel, showFirstCaptureCard } from "./unrecorded-model.js";
import { unrecordedNotice } from "./unrecorded-view.js";
import { dateAt, shiftDate } from "./ledger-format.js";
import { overviewModel } from "./overview-model.js";
import { currentMethodPeriod, methodSpendingModel, methodSpendingRequest, methodSpendingSelection, stepMethodPeriod } from "./method-spending-model.js";
import { methodSpendingView } from "./method-spending-view.js";
import { COMPANION_SLEEP_AFTER_MS, selectCompanion } from "../application/companion.js";
import { snapshotPreferences } from "../application/preferences.js";
import { isRecordAiPending } from "../core/index.js";
import { el } from "./dom.js";
import { createAppShell } from "./layout/app-shell.js";
import { overviewRecentLimit, overviewSceneSize } from "./layout/width-class.js";
import { manualEntryView, manualNoteSheet, manualProjectSheet } from "./manual-entry-view.js";
import { overviewView } from "./overview-view.js";
import { recordSheetView } from "./record-sheet-view.js";
import { recordDetailView } from "./record-detail-view.js";
import { openRecordAction, recordFailure, showVoidConfirmation } from "./record-action-controller.js";
import { readOnlyReasonView } from "./readonly-reason-view.js";
import { recordsView } from "./records-view.js";
import { settingsView } from "./settings-view.js";
import { createSettingsFeature } from "./settings-feature.js";
import { failedSettingsFromIntents } from "./settings-model.js";
import { notice, destructiveConfirmation, deferNativeDateRender } from "./shared-controls.js";
import { tripSheetView } from "./trip-sheet-view.js";
import { currencyPickerView } from "./currency-picker-view.js";
import { defaultProjectId, projectBatchCandidates, projectPageModel, projectsListModel } from "./projects-model.js";
import { pageColumns } from "./layout/arrangement.js";
import { projectBatchSheetView, projectNameSheetView, projectPageView, projectsListView } from "./projects-view.js";
import { nook } from "./skins/nook.js";
import { describeResult } from "./command-result-model.js";
import { createReportFeature } from "./report-feature.js";
import { coverageDisclosure, synchronizationStatus } from "./states-model.js";
import { isAutomaticCaptureRecord } from "./record-list-model.js";
import { syncRecoveryCopy } from "./sync-recovery-copy.js";
const SYNC_OPERATION_TIMEOUT_MS = 120_000;
/** In-memory identity state for records that arrived or were saved during this session. */
export class FreshRecordTracker {
    loadedIds = new Set();
    freshIds = new Set();
    enabled = false;
    observe(records) {
        for (const record of records) {
            if (this.loadedIds.has(record.id))
                continue;
            if (this.enabled && isAutomaticCaptureRecord(record))
                this.freshIds.add(record.id);
            this.loadedIds.add(record.id);
        }
    }
    arm() { this.enabled = true; }
    markIfNew(id) { if (this.loadedIds.has(id))
        return false; this.mark(id); return true; }
    mark(id) { this.loadedIds.add(id); this.freshIds.add(id); }
    clear(id) { this.freshIds.delete(id); }
    get ids() { return this.freshIds; }
    reset() { this.loadedIds.clear(); this.freshIds.clear(); this.enabled = false; }
}
/** Feature coordinator: domain behavior is delegated to the session's queries, commands and preference service. */
export function mountViewerApp(root, session, options) {
    let tab = "home", settings = false, result;
    let preferences, picker, overviewResult;
    let failedSettings = [];
    let failedIntents = [];
    let organization = { organiserConfigured: false, unclassified: [], suggestions: [] };
    let recordsScreen = null, recordsPresented = false;
    let recordsScreenRegular = false;
    let recordsRoute = false;
    let openedRecord = null;
    let recordConfirmingId = null;
    let recordConfirmationError = null;
    let recordOpenRevision = 0;
    let overviewSummary = null, overviewSummaryKey = "";
    let recordsQuery = "", recordsSearchResult = null, allRecordsSearchResult = null;
    let allRecordsSearchPromise = null;
    let recordsSearchRevision = 0, recordsSnapshotRevision = 0, recordsSearchPending = false;
    let scope = "all";
    let methodSpending = null;
    let methodLoadRevision = 0, methodOverviewScroll = 0, methodPageScroll = 0;
    let projectSort = options.projectSortPreference?.get() ?? "date";
    const projectRecordSorts = new Map(), methodRecordSorts = new Map();
    let synchronization = "synced";
    let routineBackgroundSync = false;
    let pendingCountVisible = false;
    let pendingInboxCount = 0;
    let lastManualSaveAt = null, lastOrganizationAt = null, latestAutomatic = null;
    const freshRecords = new FreshRecordTracker();
    let lastOpenedAt = options.lastOpenedAt ?? null;
    let disposed = false, refreshRevision = 0, tripSheetOpen = false, companionTimer;
    let companionMotionGeneration = 0, companionMotionActive = false, companionOverviewVisible = false, lastCompanionState = null;
    let draft, saveState = "idle", message = "";
    const manualDraftKey = "manual-entry";
    let restoreCachedView = true;
    let manualRestored = false, manualLocked = false, manualAttemptAt = null;
    let draftWrites = Promise.resolve();
    let manualFocus = "amount", manualQuotePending = false, manualQuoteKey = "";
    let manualQuoteRequest;
    function ensureManualQuote() {
        if (!draft || manualLocked || saveState === "saving")
            return;
        const key = `${draft.operationId}/${draft.currency}/${draft.date}`;
        if (key === manualQuoteKey)
            return;
        manualQuoteRequest?.abort();
        manualQuoteKey = key;
        manualQuotePending = false;
        if (draft.currency === "TWD" || draft.quote)
            return;
        const request = manualQuoteRequest = new AbortController();
        manualQuotePending = true;
        void session.commands.readReferenceQuote(draft.currency, draft.date, request.signal).then(outcome => {
            if (disposed || request.signal.aborted || !draft || key !== `${draft.operationId}/${draft.currency}/${draft.date}`)
                return;
            draft = { ...draft, quote: outcome.status === "found" ? outcome.quote : undefined };
            manualQuotePending = false;
            void retainManualDraft();
            render();
        }).catch(() => { if (!disposed && !request.signal.aborted) {
            manualQuotePending = false;
            render();
        } });
    }
    const pushScheduler = createPushScheduler({
        canPush: () => !disposed && session.capability.status === "writable" && !!session.push && !!session.outbox,
        visible: () => document.visibilityState !== "hidden",
        pending: async () => { const ledger = await session.outbox.ledger(); return ledger.marks.pendingCount > 0 || ledger.inboxWrites.length > 0; },
        push: async () => {
            synchronization = "syncing";
            pendingCountVisible = false;
            render();
            const operation = createSyncOperation(SYNC_OPERATION_TIMEOUT_MS);
            activePushOperations.add(operation);
            let outcome;
            try {
                outcome = await session.push({ requestedMonth: dateAt(options.now(), result.timeZone).slice(0, 7).replace("-", "/"), manual: true,
                    signal: operation.signal });
            }
            catch {
                outcome = { status: "temporary", reason: "incomplete" };
            }
            finally {
                activePushOperations.delete(operation);
                operation.finish();
            }
            return outcome;
        },
        async outcome(outcome) {
            if (disposed)
                return;
            if (outcome.status === "credential-rejected") {
                historyContinuationPending = false;
                await clearRejectedConnection();
                return;
            }
            pendingCountVisible = outcome.status === "temporary" || outcome.status === "write-denied";
            await refresh();
            synchronization = outcome.status === "temporary" ? outcome.reason === "offline" ? "offline" : "failed"
                : result.report.coverage.complete ? "synced" : "incomplete";
            if (!result.report.coverage.complete && session.kind === "private")
                continueHistory();
            render();
            if (openedRecord && openedRecord.action === null)
                await openRecord(openedRecord.record.id);
        },
    });
    const unsubscribeChanges = session.outbox?.onChange(() => { pendingCountVisible = false; pushScheduler.changed(); });
    const expandedNotifications = new Set();
    let unrecordedSheetOpen = false;
    const notificationAttempts = new Map();
    function recoveryOperationIds(kind, objectId, source = result) {
        return (source?.localChanges?.recoveryTargets ?? []).filter(target => target.kind === kind && target.objectId === objectId)
            .map(target => target.operationId);
    }
    function failedTargetIntents(kind, objectId, source = result) {
        const operationIds = new Set(recoveryOperationIds(kind, objectId, source));
        return failedIntents.filter(item => operationIds.has(item.intent.command.operationId));
    }
    function recoveryProject(id, source) {
        const path = `projects/${id}.json`;
        for (const item of failedTargetIntents("project", id, source)) {
            const base = item.intent.bases[path];
            if (base?.value && typeof base.value === "object" && "id" in base.value && base.value.id === id)
                return base.value;
        }
        return undefined;
    }
    function recoveryProjects(source) {
        const ids = new Set((source.localChanges?.recoveryTargets ?? []).filter(target => target.kind === "project").map(target => target.objectId));
        return [...ids].flatMap(id => recoveryProject(id, source) ?? []);
    }
    function recoveredNotifications(source) {
        const operations = new Map();
        const copies = new Map();
        const entries = new Map((source.unrecorded ?? []).map(item => [item.id, item]));
        for (const target of source.localChanges?.recoveryTargets ?? []) {
            if (target.kind !== "unrecorded")
                continue;
            const intent = failedIntents.find(item => item.state === "failed" && item.intent.command.operationId === target.operationId);
            if (!intent)
                continue;
            for (const write of intent.intent.command.writes) {
                if (!write.path.startsWith("unrecorded/"))
                    continue;
                const base = intent.intent.bases[write.path];
                if (base?.value && typeof base.value === "object" && "id" in base.value && base.value.id === target.objectId) {
                    entries.set(target.objectId, base.value);
                    operations.set(target.objectId, [...(operations.get(target.objectId) ?? []), target.operationId]);
                    if (!copies.has(target.objectId))
                        copies.set(target.objectId, syncRecoveryCopy(target));
                }
            }
        }
        return { entries: [...entries.values()], operations, copies };
    }
    async function recoverObject(kind, objectId, action) {
        if (!session.outbox || session.capability.status !== "writable")
            return;
        const items = failedTargetIntents(kind, objectId);
        for (const item of items)
            await session.outbox[action](item.intent.command.operationId);
        if (!items.length)
            return;
        if (kind === "project") {
            projectIndex = undefined;
            projectDetail = undefined;
        }
        await refresh();
        if (action === "resend")
            await pushScheduler.immediate();
    }
    function notificationModel(surface = "page") {
        const recovered = recoveredNotifications(result);
        const previews = new Map(recovered.entries.map(entry => {
            const event = options.unrecordedReader?.reparse(entry), merchant = options.unrecordedReader?.merchant(entry);
            return [entry.id, { ...(event ? { event } : {}), ...(merchant ? { merchant } : {}) }];
        }));
        return unrecordedNoticeModel(recovered.entries, result.timeZone, session.capability.status === "writable", result.asOf, picker, previews, surface, recovered.operations, recovered.copies);
    }
    const notificationActions = { fill: fillNotification,
        dismiss: (item) => { void changeNotification(item); }, more: showUnrecorded,
        recover: (item, action) => { void recoverObject("unrecorded", item.id, action); } };
    function showUnrecorded() {
        unrecordedSheetOpen = true;
        const model = notificationModel("sheet");
        shell.sheets.open({ title: `未記錄 ${model.total} 則`, swipe: "close", origin: "left",
            view: unrecordedNotice(model, notificationActions, expandedNotifications),
            close: () => { unrecordedSheetOpen = false; shell.sheets.dismiss(); } });
    }
    function fillNotification(item) {
        const today = dateAt(options.now(), result.timeZone);
        const blank = blankManualDraft("", today, picker, result.manualEntryDefaults);
        const replace = () => {
            unrecordedSheetOpen = false;
            shell.sheets.dismiss();
            draft = unrecordedManualDraft(options.operationId(), item, result.timeZone, result.manualEntryDefaults, picker);
            manualLocked = false;
            manualAttemptAt = null;
            saveState = "idle";
            message = "";
            void retainManualDraft();
            shell.selectTab("add");
        };
        if (!shouldReplaceManualDraft(draft, blank, manualLocked)) {
            replace();
            return;
        }
        // Reuse the existing confirmation presentation; the current draft is untouched until acceptance.
        const view = { element: destructiveConfirmation("要換掉目前的草稿嗎？", "", "換掉", () => shell.sheets.pop(), replace) };
        shell.sheets.push({ title: "要換掉目前的草稿嗎？", swipe: "close", origin: "left", view, close: () => shell.sheets.pop() });
    }
    async function changeNotification(item) {
        if (session.capability.status !== "writable")
            return;
        const key = `dismiss:${item.id}`;
        let attempt = notificationAttempts.get(key);
        if (attempt?.busy)
            return;
        attempt ??= { operationId: options.operationId(), now: options.now(), busy: false };
        notificationAttempts.set(key, attempt);
        attempt.busy = true;
        let outcome;
        try {
            outcome = await session.commands.removeUnrecorded(attempt, item.id);
        }
        catch {
            outcome = { status: "rejected", operationId: attempt.operationId, code: "local-storage" };
        }
        attempt.busy = false;
        if (outcome.status === "confirmed" || outcome.status === "pending") {
            notificationAttempts.delete(key);
        }
        else if (outcome.status === "rejected" && outcome.code === "credential-rejected") {
            await clearRejectedConnection();
            return;
        }
        else {
            statusMessage = describeResult(outcome).text;
        }
        await refresh();
        if (unrecordedSheetOpen) {
            if (result.unrecorded.length)
                showUnrecorded();
            else {
                unrecordedSheetOpen = false;
                shell.sheets.dismiss();
            }
        }
    }
    function retainManualDraft() {
        if (!draft || disposed)
            return draftWrites;
        const packet = { draft, locked: manualLocked, now: manualAttemptAt };
        draftWrites = draftWrites.catch(() => { }).then(() => session.drafts.put(manualDraftKey, packet));
        return draftWrites;
    }
    function detachMissingNotification() {
        const notification = draft?.notification;
        if (!draft || !notification || manualLocked || saveState === "saving" || recoveredNotifications(result).entries.some(entry => entry.id === notification.id))
            return;
        const { notification: _notification, ...entered } = draft;
        draft = entered;
        void retainManualDraft();
    }
    function changeManual(patch) {
        if (!draft || manualLocked || saveState === "saving" || disposed)
            return;
        const rateChanged = patch.currency !== undefined && patch.currency !== draft.currency || patch.date !== undefined && patch.date !== draft.date;
        draft = { ...draft, ...patch, ...(rateChanged ? { quote: undefined } : {}) };
        message = "";
        manualAttemptAt = null;
        if (rateChanged) {
            manualQuoteKey = "";
            ensureManualQuote();
        }
        void retainManualDraft();
        render();
    }
    let firstLoad = false, statusMessage;
    let readOnlyCheck = "idle", readOnlySheetOpen = false;
    const capabilityListeners = new Set();
    let projectId = null, projectIndex;
    let projectDetail;
    let projectCategoryId = null;
    let projectFilteredDetail;
    let projectFilterLoadingKey = null, projectFilterRevision = 0;
    let projectIndexLoading = false, projectDetailLoading = null, projectLoadRevision = 0;
    let projectNotice = "", archiveConfirmation = false;
    let deleteConfirmation = false, projectDeleting = false, projectListOnly = false;
    let batch = null;
    let trip = { on: false, projectId: null, currency: "JPY" };
    const projectTripCurrencies = new Map();
    let organizationTimer;
    // Older history keeps loading in bounded batches while the app is visible; a hidden page resumes on return.
    let historyTimer, historyPaused = false, historyRemaining = Infinity;
    let historyRetries = 0, historyContinuationPending = false, historyRoundRunning = false;
    let syncGeneration = 0, activeSyncOperation;
    const activePushOperations = new Set();
    let pageWasHidden = false;
    function abandonActiveSync() {
        syncGeneration++;
        activeSyncOperation?.abort();
    }
    let clearing = false;
    async function clearRejectedConnection() {
        if (clearing || disposed)
            return;
        clearing = true;
        let dataCleared = true;
        if (!session.outbox) {
            try {
                await session.forget();
            }
            catch {
                dataCleared = false;
            }
        }
        if (!disposed)
            options.connectionCleared?.(dataCleared);
    }
    const shell = createAppShell(nook, { selectTab: value => {
            if (openedRecord) {
                closeRecord();
                if (openedRecord)
                    return;
            }
            clearOpenedRecord();
            recordsRoute = value === "list";
            reports.leave();
            settingPages.leave();
            tab = value === "list" && shell.layout === "regular" ? "home" : value;
            settings = false;
            if (value === "home") {
                companionOverviewVisible = false;
                lastCompanionState = null;
            }
            if (value !== "proj") {
                projectId = null;
                projectListOnly = false;
                clearProjectCategoryFilter();
            }
            clearMethodSpending();
            batch = null;
            tripSheetOpen = false;
            unrecordedSheetOpen = false;
            shell.sheets.dismiss();
            render();
        },
        resetCurrentTab,
        settings: () => { if (openedRecord) {
            closeRecord();
            if (openedRecord)
                return;
        } clearOpenedRecord(); clearMethodSpending(); clearProjectCategoryFilter(); recordsRoute = false; reports.leave(); settingPages.leave(); settings = true; tab = "settings"; render(); }, readOnlyReason: showReadOnlyReason, leave: pushOnLeave }, { tab, status: { text: "", icon: "cloud_done" }, readOnly: session.capability.status === "read-only" });
    const settingPages = createSettingsFeature(session, shell, { push: pushOnLeave, recover: (operationId, action) => { void recoverSetting(operationId, action); }, now: options.now, operationId: options.operationId,
        buildId: options.buildId ?? "development", flush: () => pushScheduler.immediate(), ...(options.programReset ? { programReset: options.programReset } : {}),
        current: () => ({ result, preferences, picker, organization, failedSettings }), render, refresh, changePreferences,
        open: id => {
            void loadAllRecords().then(all => {
                if (!disposed && settings)
                    openRecord(id, undefined, { ...result,
                        report: { ...result.report, records: all.records }, sourcePaths: { ...result.sourcePaths, ...all.sourcePaths } });
            });
        }, quick: (id, kind) => { void openRecord(id, kind === "category" ? "recat" : "note"); }, later,
        ...(options.appearance ? { appearance: options.appearance } : {}), ...(options.forgotten ? { forgotten: options.forgotten } : {}) });
    const reports = createReportFeature(session, shell, { now: options.now, active: () => !disposed && tab === "report" && !settings, scope: () => scope,
        changeScope: value => { scope = value; void refresh(); }, open: (id, context) => { void openRecord(id, undefined, context, "right"); }, ...(options.exitDemo ? { exitDemo: options.exitDemo } : {}),
        connectionNotice: options.connectionNotice || session.persistenceNotice || "", ...(options.chartPreference ? { chartPreference: options.chartPreference } : {}) });
    function resetOverview() {
        recordsRoute = false;
        tab = "home";
        recordsSearchRevision++;
        recordsSearchPending = false;
        recordsQuery = "";
        recordsSearchResult = allRecordsSearchResult;
        recordsScreen?.update(recordsViewState());
        recordsScreen?.setUnclassifiedOnly(false);
        companionOverviewVisible = false;
        lastCompanionState = null;
        clearMethodSpending();
    }
    function resetProjects() {
        projectId = null;
        projectListOnly = false;
        projectDetail = undefined;
        projectDetailLoading = null;
        projectNotice = "";
        archiveConfirmation = false;
        deleteConfirmation = false;
        clearProjectCategoryFilter();
    }
    function resetCurrentTab(value) {
        if (openedRecord) {
            closeRecord();
            if (openedRecord)
                return;
        }
        clearOpenedRecord();
        batch = null;
        tripSheetOpen = false;
        unrecordedSheetOpen = false;
        if (value === "home")
            resetOverview();
        else if (value === "proj")
            resetProjects();
        else if (value === "report") {
            reports.reset();
            return;
        }
        else if (value === "settings")
            settingPages.reset();
        render();
    }
    let recentLimit = overviewRecentLimit(shell.layout);
    let sceneSize = overviewSceneSize(shell.layout);
    const unsubscribeLayout = shell.onLayoutChange(layout => {
        const nextLimit = overviewRecentLimit(layout);
        const nextSceneSize = overviewSceneSize(layout);
        if (nextLimit === recentLimit && nextSceneSize === sceneSize && !openedRecord && !recordsRoute)
            return;
        recentLimit = nextLimit;
        sceneSize = nextSceneSize;
        if (layout === "regular" && tab === "list")
            tab = "home";
        if (layout !== "regular" && recordsRoute && tab === "home") {
            tab = "list";
            recordsPresented = false;
        }
        if (!disposed && result && !settings && (tab === "home" || tab === "list")) {
            render();
            if (openedRecord)
                presentOpenedRecord();
        }
    });
    root.replaceChildren(shell.element);
    // Keep the live region mounted across form renders; visible save feedback uses the banner/key.
    const manualFeedback = el("p", undefined, "lk-entry-message");
    manualFeedback.setAttribute("role", "status");
    manualFeedback.setAttribute("aria-live", "polite");
    manualFeedback.setAttribute("aria-atomic", "true");
    shell.element.append(manualFeedback);
    function openSettingsPage(route) {
        if (!settingPages.open(route))
            return false;
        settings = true;
        tab = "settings";
        render();
        shell.content.scrollTop = 0;
        return true;
    }
    function later(route) {
        if (!settings && settingPages.handles(route)) {
            shell.navigate(() => { openSettingsPage(route); });
            return;
        }
        if (openSettingsPage(route))
            return;
        if (route === "6p") {
            showReadOnlyReason();
            return;
        }
        const element = el("div", undefined, "lk-feature-view");
        element.dataset.placeholderRoute = route;
        element.append(el("p", "此功能尚未開放", "lk-muted"));
        shell.sheets.open({ title: "尚未開放", swipe: "close", origin: settings ? "right" : "left", view: { element }, close: () => shell.sheets.dismiss() });
    }
    function showReadOnlyReason() {
        if (!result || session.capability.status !== "read-only")
            return;
        render();
        openReadOnlyReasonSheet();
    }
    function openReadOnlyReasonSheet() {
        if (readOnlySheetOpen)
            shell.sheets.pop();
        readOnlySheetOpen = true;
        shell.sheets.push({ title: "唯讀", swipe: "close", origin: "top", view: readOnlyReasonView(readOnlyCheck, () => { void recheckWriteCapability(); }, session.capability), close: closeReadOnlyReason });
    }
    function closeReadOnlyReason() {
        readOnlyCheck = "idle";
        readOnlySheetOpen = false;
        shell.sheets.pop();
        render();
        shell.element.querySelector('[data-tab="add"]')?.focus();
    }
    async function recheckWriteCapability() {
        if (readOnlyCheck === "checking")
            return;
        readOnlyCheck = "checking";
        openReadOnlyReasonSheet();
        await new Promise(resolve => window.requestAnimationFrame(() => resolve()));
        try {
            session.recheckWriteCapability();
        }
        catch { /* A failed capability recheck keeps the read-only explanation visible. */ }
        if (session.capability.status === "writable") {
            readOnlyCheck = "idle";
            statusMessage = "已可編輯";
            readOnlySheetOpen = false;
            shell.sheets.pop();
            render();
        }
        else {
            readOnlyCheck = "still-read-only";
            openReadOnlyReasonSheet();
        }
    }
    function showTripSheet() {
        if (!trip.on || !trip.projectId)
            return;
        tripSheetOpen = true;
        const close = () => { tripSheetOpen = false; shell.sheets.dismiss(); pushOnLeave(); };
        const sheet = tripSheetView(result.projects, trip, {
            change: changeTrip,
            currency: () => openCurrencyPicker(trip.currency, currency => changeTrip({ currency }), true),
            end: () => {
                tripSheetOpen = false;
                shell.sheets.dismiss();
                void changePreferences({ currentTrip: null }).then(pushOnLeave);
            },
            close,
        });
        shell.sheets.open({ title: "旅行中", swipe: "close", origin: "left", view: sheet.view, header: sheet.header, close });
    }
    function changeTrip(patch) {
        trip = { ...trip, ...patch };
        if (trip.on && trip.projectId)
            void changePreferences({ currentTrip: { projectId: trip.projectId, currency: trip.currency } }).then(() => {
                if (tripSheetOpen)
                    showTripSheet();
            });
        else if (preferences.value.currentTrip)
            void changePreferences({ currentTrip: null });
        else
            render();
    }
    function openCurrencyPicker(current, apply, stacked = false) {
        if (session.capability.status !== "writable") {
            later("6p");
            return;
        }
        const close = () => stacked ? shell.sheets.pop() : shell.sheets.dismiss();
        const sheet = { title: "幣別", origin: "left", swipe: "close", dismissOnBackdrop: true,
            view: currencyPickerView(current, result.frequentCurrencies, currency => { close(); apply(currency); }), close };
        if (stacked)
            shell.sheets.push(sheet);
        else
            shell.sheets.open(sheet);
    }
    function companionActivity(state) {
        if (state === "happy")
            lastOrganizationAt = options.now();
        else
            lastManualSaveAt = options.now();
        render();
    }
    function wakeCompanion() {
        lastOpenedAt = options.now();
        companionOverviewVisible = false;
        lastCompanionState = null;
        render();
    }
    function clearOpenedRecord() {
        recordOpenRevision++;
        for (const step of openedRecord?.steps ?? [])
            step.view.dispose?.();
        openedRecord?.date?.view.dispose?.();
        openedRecord = null;
    }
    function closeRecord() {
        if (openedRecord?.date?.target.busy)
            return;
        const inline = recordIsInline();
        while (openedRecord?.steps.length) {
            const depth = openedRecord.steps.length;
            openedRecord.steps.at(-1).close();
            if (openedRecord && openedRecord.steps.length >= depth)
                return;
        }
        clearOpenedRecord();
        shell.sheets.dismiss();
        if (inline)
            render();
    }
    function recordIsInline() { return shell.layout === "regular" && !settings && (tab === "home" || tab === "list"); }
    // Keep real mutation views alive when they move between the inline body and C/N/phone sheets.
    function retainedSheet(options) { return { ...options, view: { element: options.view.element } }; }
    function restoreRecordDateFeedback(root) {
        if (!openedRecord?.date)
            return;
        const { target, view: dateView } = openedRecord.date;
        const feedback = root.querySelector(".lk-record-date-feedback");
        if (feedback && dateView.element.parentElement !== feedback)
            feedback.append(dateView.element);
        const input = root.querySelector(".lk-record-detail-fields")?.querySelector(".lk-record-date")?.querySelector("input");
        if (input) {
            input.disabled = target.input.disabled;
            input.value = target.input.value;
            target.input = input;
        }
    }
    function presentOpenedRecord() {
        if (!openedRecord)
            return;
        if (recordIsInline()) {
            shell.sheets.dismiss();
            render();
        }
        else {
            restoreRecordDateFeedback(openedRecord.base.view.element);
            shell.sheets.open(retainedSheet(openedRecord.base));
            for (const step of openedRecord.steps)
                shell.sheets.push(retainedSheet(step));
        }
    }
    const recordSheets = {
        push(step) {
            if (!openedRecord)
                return;
            openedRecord.steps.push(step);
            presentOpenedRecord();
        },
        pop() {
            if (!openedRecord)
                return;
            openedRecord.steps.pop()?.view.dispose?.();
            if (!openedRecord.steps.length)
                openedRecord.action = null;
            presentOpenedRecord();
        },
        dismiss() {
            if (!recordIsInline()) {
                clearOpenedRecord();
                shell.sheets.dismiss();
                return;
            }
            for (const step of openedRecord?.steps ?? [])
                step.view.dispose?.();
            if (openedRecord) {
                openedRecord.steps = [];
                openedRecord.action = null;
                openedRecord.date?.view.dispose?.();
                delete openedRecord.date;
            }
            render();
        },
    };
    const recordMutationHost = { session, sheets: recordSheets, now: options.now, operationId: options.operationId,
        recheck: showReadOnlyReason,
        onFreshRecord: id => freshRecords.mark(id),
        onCapabilityChange(listener) { capabilityListeners.add(listener); return () => { capabilityListeners.delete(listener); }; },
        async afterFailure(outcome) {
            if (outcome.status === "rejected" && outcome.code === "credential-rejected")
                await clearRejectedConnection();
            else
                await refresh();
        },
        async afterWrite(organized, text) {
            pushOnLeave();
            if (organized) {
                lastOrganizationAt = options.now();
                clearTimeout(organizationTimer);
                organizationTimer = setTimeout(() => { lastOrganizationAt = null; render(); }, 1200);
            }
            await refresh();
            if (openedRecord)
                await openRecord(openedRecord.record.id);
            if (text) {
                const toast = el("div", text, "lk-app-toast");
                toast.setAttribute("role", "status");
                shell.element.append(toast);
                setTimeout(() => toast.remove(), 2200);
            }
        } };
    async function confirmAiRecord(id) {
        const current = openedRecord;
        if (!current || current.record.id !== id || !isRecordAiPending(current.record) ||
            session.capability.status !== "writable" || recordConfirmingId)
            return;
        recordConfirmingId = id;
        recordConfirmationError = null;
        render();
        try {
            const outcome = await session.commands.confirm({ operationId: options.operationId(), now: options.now() }, id);
            if (outcome.status === "confirmed" || outcome.status === "pending") {
                await recordMutationHost.afterWrite(false, "");
            }
            else if (outcome.status === "rejected" && outcome.code === "credential-rejected") {
                await clearRejectedConnection();
            }
            else
                recordConfirmationError = { recordId: id, text: recordFailure(outcome) };
        }
        catch {
            recordConfirmationError = { recordId: id, text: "尚未確認，請重試" };
        }
        finally {
            recordConfirmingId = null;
            if (!disposed)
                render();
        }
    }
    function recordRecoveryActions(id) {
        const recover = async (kind) => {
            if (!session.outbox || session.capability.status !== "writable")
                return;
            const intents = (await session.outbox.list()).filter(item => item.state === "failed" && item.intent.descriptor.recordIds.includes(id));
            for (const item of intents)
                await session.outbox[kind](item.intent.command.operationId);
            closeRecord();
            await refresh();
            if (kind === "resend")
                await pushScheduler.immediate();
        };
        return { ...(session.capability.status === "writable" ? { resend: () => { void recover("resend"); } } : {}), discard: () => { void recover("discard"); } };
    }
    async function recoverSetting(operationId, action) {
        if (!session.outbox || session.capability.status !== "writable")
            return;
        const failed = (await session.outbox.list()).some(item => item.state === "failed" && item.intent.command.operationId === operationId);
        if (!failed)
            return;
        await session.outbox[action](operationId);
        await refresh();
        if (action === "resend")
            await pushScheduler.immediate();
    }
    async function openRecord(id, action, context, origin = tab === "list" && !settings ? "left" : "right") {
        const revision = ++recordOpenRevision;
        if (action === undefined)
            freshRecords.clear(id);
        const searchContext = tab === "list" ? recordsSearchResult : null;
        const all = await loadAllRecords();
        if (disposed || revision !== recordOpenRevision)
            return;
        const record = all.records.find(item => item.id === id) ?? searchContext?.records.find(item => item.id === id) ?? context?.report.records.find(item => item.id === id) ?? result.report.records.find(item => item.id === id);
        if (!record)
            return;
        const editorCommands = session.outbox ? session.commands.at((await session.outbox.ledger()).snapshot) : session.commands;
        const sheetResult = { ...(context ?? result), report: { ...result.report, records: all.records }, sourcePaths: all.sourcePaths, detailRevisions: all.detailRevisions, detailObjectIds: all.detailObjectIds ?? {}, userRules: all.userRules, ruleRevision: all.ruleRevision, localChanges: all.localChanges };
        clearOpenedRecord();
        const sheet = recordSheetView(record, sheetResult, session.capability.status === "writable", { close: closeRecord, open: value => { void openRecord(value, undefined, context, origin); }, history: () => options.history(sheetResult, id), later,
            confirm: () => { void confirmAiRecord(id); }, confirming: recordConfirmingId === id,
            ...(recordConfirmationError?.recordId === id ? { confirmationError: recordConfirmationError.text } : {}),
            ...recordRecoveryActions(id), date: target => { void openOpenedRecordAction("date", target); }, action: kind => { void openOpenedRecordAction(kind); }, void: () => { if (!openedRecord?.date?.target.busy)
                void showVoidConfirmation({ ...recordMutationHost, commands: editorCommands }, record, sheet.view.element, sheetResult); } }, dateAt(options.now(), sheetResult.timeZone));
        openedRecord = { record, result: sheetResult, commands: editorCommands, base: { title: "單筆紀錄", swipe: "close", origin, recordId: id, view: sheet.view, header: sheet.header, close: closeRecord }, steps: [], action: null };
        if (recordIsInline()) {
            recordsRoute = true;
            tab = "home";
        }
        presentOpenedRecord();
        if (action)
            await openOpenedRecordAction(action);
    }
    async function openOpenedRecordAction(action, directDate) {
        if (!openedRecord || openedRecord.result.localChanges?.records[openedRecord.record.id] === "failed")
            return;
        const current = openedRecord;
        if (current.date?.target.busy)
            return;
        if (directDate) {
            current.date?.view.dispose?.();
            directDate.retain = view => { if (openedRecord === current)
                current.date = { target: directDate, view };
            else
                view.dispose?.(); };
        }
        current.action = action;
        await openRecordAction({ ...recordMutationHost, sheets: {
                push(step) { if (openedRecord === current)
                    recordSheets.push(step);
                else
                    step.view.dispose?.(); },
                pop() { if (openedRecord === current)
                    recordSheets.pop(); },
                dismiss() {
                    if (openedRecord !== current)
                        return;
                    if (action === "recur" || action === "occurrence-skip") {
                        clearOpenedRecord();
                        shell.sheets.dismiss();
                        render();
                    }
                    else
                        recordSheets.dismiss();
                },
            }, commands: current.commands }, action, current.record, current.result, directDate);
    }
    function openRecords(entry) {
        shell.navigate(() => {
            clearOpenedRecord();
            clearMethodSpending();
            recordsRoute = true;
            reports.leave();
            settingPages.leave();
            settings = false;
            tab = shell.layout === "regular" ? "home" : "list";
            recordsSearchRevision++;
            recordsSearchPending = false;
            recordsQuery = "";
            recordsSearchResult = allRecordsSearchResult;
            render();
            recordsScreen?.setUnclassifiedOnly(entry === "unclassified");
            if (entry === "search")
                recordsScreen?.focusSearch();
        });
    }
    function recordsViewState() {
        return { query: recordsQuery, currentMonth: result.asOf.slice(0, 7), asOf: result.asOf, result: recordsSearchResult, allRecords: allRecordsSearchResult,
            writable: session.capability.status === "writable", freshRecordIds: freshRecords.ids,
            ...(shell.layout === "regular" && openedRecord ? { openRecordId: openedRecord.record.id } : {}) };
    }
    function ensureRecordsScreen(regular) {
        if (!recordsScreen || recordsScreenRegular !== regular) {
            const unclassifiedOnly = recordsScreen?.unclassifiedOnly ?? false;
            const sort = recordsScreen?.sort ?? "date";
            recordsScreenRegular = regular;
            recordsScreen = recordsView({ ...recordsViewState(), sort }, { ...(!regular ? { back: () => shell.selectTab("home") } : {}),
                search: query => { void searchRecords(query); }, open: openRecord,
                quick: (id, kind) => { void openRecord(id, kind === "category" ? "recat" : "note"); } });
            recordsScreen.setUnclassifiedOnly(unclassifiedOnly);
        }
        return recordsScreen;
    }
    function loadAllRecords() {
        if (allRecordsSearchResult)
            return Promise.resolve(allRecordsSearchResult);
        if (!allRecordsSearchPromise) {
            const revision = recordsSnapshotRevision;
            allRecordsSearchPromise = session.listRecords(result.asOf).then(found => {
                if (revision === recordsSnapshotRevision)
                    allRecordsSearchResult = found;
                return found;
            }).finally(() => { if (revision === recordsSnapshotRevision)
                allRecordsSearchPromise = null; });
        }
        return allRecordsSearchPromise;
    }
    async function searchRecords(query) {
        recordsQuery = query;
        const revision = ++recordsSearchRevision, snapshotRevision = recordsSnapshotRevision;
        recordsSearchPending = true;
        try {
            const all = await loadAllRecords();
            const found = query.trim() ? await session.search({ query, asOf: result.asOf }) : all;
            if (disposed || revision !== recordsSearchRevision || snapshotRevision !== recordsSnapshotRevision)
                return;
            allRecordsSearchResult = all;
            recordsSearchResult = found;
            recordsSearchPending = false;
            recordsScreen?.update(recordsViewState());
        }
        catch {
            if (disposed || revision !== recordsSearchRevision || snapshotRevision !== recordsSnapshotRevision)
                return;
            recordsSearchResult = null;
            recordsSearchPending = false;
            recordsScreen?.update(recordsViewState());
        }
    }
    function ensureProjectIndex() {
        if (!result || projectIndex || projectIndexLoading)
            return;
        projectIndexLoading = true;
        const revision = ++projectLoadRevision;
        const today = dateAt(options.now(), result.timeZone);
        void session.query({ period: { kind: "all" }, asOf: today }).then(next => {
            if (disposed || revision !== projectLoadRevision)
                return;
            projectIndex = next;
            projectIndexLoading = false;
            render();
        }).catch(() => {
            if (disposed || revision !== projectLoadRevision)
                return;
            projectIndexLoading = false;
            projectNotice = "專案暫時無法載入";
            render();
        });
    }
    function clearMethodSpending() { methodLoadRevision++; methodSpending = null; }
    function closeMethodSpending() {
        clearOpenedRecord();
        shell.sheets.dismiss();
        clearMethodSpending();
        render();
        shell.content.scrollTop = methodOverviewScroll;
    }
    function openMethodSpending(key) {
        const group = overviewResult.billingCycleSpending.groups.find(item => item.key === key);
        if (!group || !preferences)
            return;
        methodOverviewScroll = shell.content.scrollTop;
        methodPageScroll = 0;
        clearOpenedRecord();
        recordsRoute = false;
        methodSpending = { selection: methodSpendingSelection(group, preferences.value, scope),
            result: { ...overviewResult, report: group.report, complete: group.report.complete } };
        render();
        void loadMethodSpending(methodSpending.selection);
    }
    async function loadMethodSpending(selection) {
        const revision = ++methodLoadRevision;
        try {
            const next = await session.query(methodSpendingRequest(selection, overviewResult.asOf));
            if (disposed || revision !== methodLoadRevision || !methodSpending)
                return;
            methodSpending = { selection, result: next };
            render();
        }
        catch {
            // Retain the last valid period and its truthful coverage, as other local reads do.
        }
    }
    function stepMethodSpending(direction) {
        if (!methodSpending)
            return;
        const selection = stepMethodPeriod(methodSpending.selection, direction, overviewResult.asOf);
        if (selection === methodSpending.selection)
            return;
        void loadMethodSpending(selection);
    }
    function clearProjectCategoryFilter() {
        projectCategoryId = null;
        projectFilteredDetail = undefined;
        projectFilterLoadingKey = null;
        projectFilterRevision++;
    }
    function openProject(id) {
        clearProjectCategoryFilter();
        projectId = id;
        projectNotice = "";
        archiveConfirmation = false;
        deleteConfirmation = false;
        projectListOnly = false;
        projectDetail = undefined;
        projectDetailLoading = null;
        projectLoadRevision++;
        render();
    }
    function ensureProjectDetail(id) {
        if (!result || projectDetail?.id === id || projectDetailLoading === id)
            return;
        projectDetailLoading = id;
        const revision = ++projectLoadRevision;
        const today = dateAt(options.now(), result.timeZone);
        void session.query({ period: { kind: "all" }, filters: { projectId: id }, asOf: today }).then(next => {
            if (disposed || revision !== projectLoadRevision || projectId !== id)
                return;
            projectDetail = { id, result: next };
            projectDetailLoading = null;
            render();
        }).catch(() => {
            if (disposed || revision !== projectLoadRevision || projectId !== id)
                return;
            projectDetailLoading = null;
            projectNotice = "專案暫時無法載入";
            render();
        });
    }
    function loadProjectCategory(id, categoryId, selectOnLoad) {
        if (!result)
            return;
        const key = `${id}:${categoryId}`;
        if (projectFilteredDetail?.id === id && projectFilteredDetail.categoryId === categoryId) {
            if (selectOnLoad) {
                projectCategoryId = categoryId;
                render();
            }
            return;
        }
        if (projectFilterLoadingKey === key)
            return;
        projectFilterLoadingKey = key;
        const revision = ++projectFilterRevision;
        const today = dateAt(options.now(), result.timeZone);
        void session.query({ period: { kind: "all" }, filters: { projectId: id, categoryId }, asOf: today }).then(next => {
            if (disposed || revision !== projectFilterRevision || projectId !== id)
                return;
            projectFilteredDetail = { id, categoryId, result: next };
            projectFilterLoadingKey = null;
            if (selectOnLoad)
                projectCategoryId = categoryId;
            projectNotice = "";
            render();
        }).catch(() => {
            if (disposed || revision !== projectFilterRevision || projectId !== id)
                return;
            projectFilterLoadingKey = null;
            projectNotice = "專案暫時無法載入";
            render();
        });
    }
    function ensureProjectCategoryDetail(id, categoryId) {
        loadProjectCategory(id, categoryId, false);
    }
    function selectProjectCategory(categoryId) {
        if (!projectId)
            return;
        if (projectCategoryId === categoryId) {
            clearProjectCategoryFilter();
            projectNotice = "";
            render();
            return;
        }
        loadProjectCategory(projectId, categoryId, true);
    }
    function renderProjectBatchSheet() {
        if (deferNativeDateRender(shell.sheets.element, renderProjectBatchSheet))
            return;
        if (!batch || !projectIndex)
            return;
        const project = projectIndex.projects.find(item => item.id === batch.projectId);
        if (!project)
            return;
        const writable = session.capability.status === "writable";
        const rows = projectBatchCandidates(projectIndex, batch.from, batch.to, writable);
        const today = dateAt(options.now(), projectIndex.timeZone);
        const view = projectBatchSheetView({ rows, selected: batch.selected, from: batch.from, to: batch.to,
            today, earliest: projectIndex.earliestRecordDate, busy: batch.busy, message: batch.message,
            actions: {
                range: (from, to) => { if (batch) {
                    batch.from = from;
                    batch.to = to;
                    renderProjectBatchSheet();
                } },
                quick: which => {
                    if (!batch)
                        return;
                    const today = dateAt(options.now(), projectIndex.timeZone);
                    batch.from = which === "all" ? null : shiftDate(today, which === "week" ? -6 : -29);
                    batch.to = today;
                    renderProjectBatchSheet();
                },
                toggle: id => { if (!batch || batch.busy)
                    return; if (batch.selected.has(id))
                    batch.selected.delete(id);
                else
                    batch.selected.add(id); renderProjectBatchSheet(); },
                assign: ids => { void assignProjectBatch(ids); },
            } });
        shell.sheets.open({ title: `加入「${project.label}」`, swipe: "close", origin: "right", view, close: () => { batch = null; tripSheetOpen = false; shell.sheets.dismiss(); render(); } });
    }
    async function openProjectBatch() {
        if (session.capability.status !== "writable") {
            later("6p");
            return;
        }
        if (!projectId)
            return;
        const target = projectId;
        if (!projectIndex) {
            try {
                projectIndex = await session.query({ period: { kind: "all" }, asOf: dateAt(options.now(), result.timeZone) });
            }
            catch {
                projectNotice = "專案暫時無法載入";
                render();
                return;
            }
            if (disposed || projectId !== target)
                return;
        }
        const today = dateAt(options.now(), result.timeZone);
        batch = { projectId: target, from: shiftDate(today, -29), to: today, selected: new Set(), busy: false, message: "", contexts: new Map() };
        renderProjectBatchSheet();
    }
    async function assignProjectBatch(ids) {
        if (!batch || batch.busy || !ids.length)
            return;
        const target = batch.projectId;
        const contexts = new Map(batch.contexts);
        const items = ids.map(eventId => {
            let context = contexts.get(eventId);
            if (!context) {
                context = { operationId: options.operationId(), now: options.now() };
                contexts.set(eventId, context);
            }
            return { context, eventId, projectId: target };
        });
        batch.contexts = contexts;
        batch.busy = true;
        renderProjectBatchSheet();
        let outcomes;
        try {
            outcomes = await session.commands.assignBatch(items);
        }
        catch {
            if (batch) {
                batch.busy = false;
                batch.message = "加入失敗，請重試";
                renderProjectBatchSheet();
            }
            return;
        }
        if (disposed || !batch)
            return;
        const confirmed = new Set(outcomes.filter(item => item.result.status === "confirmed" || item.result.status === "pending").map(item => item.eventId));
        if (outcomes.some(item => item.result.status === "rejected" && item.result.code === "credential-rejected")) {
            await clearRejectedConnection();
            return;
        }
        batch.busy = false;
        if (confirmed.size === outcomes.length) {
            batch = null;
            shell.sheets.dismiss();
            projectIndex = undefined;
            projectDetail = undefined;
            await refresh();
            return;
        }
        for (const id of confirmed)
            batch.selected.delete(id);
        batch.message = `已加入 ${confirmed.size} 筆；其餘 ${outcomes.length - confirmed.size} 筆尚未確認`;
        projectIndex = undefined;
        projectDetail = undefined;
        await refresh();
        if (batch) {
            const today = dateAt(options.now(), result.timeZone);
            try {
                projectIndex = await session.query({ period: { kind: "all" }, asOf: today });
                if (batch?.projectId === target)
                    renderProjectBatchSheet();
            }
            catch {
                if (batch?.projectId === target) {
                    batch.message = "專案暫時無法載入";
                    renderProjectBatchSheet();
                }
            }
        }
    }
    function openProjectNameSheet(mode) {
        if (session.capability.status !== "writable") {
            later("6p");
            return;
        }
        const current = mode === "rename" && projectId ? projectDetail?.result.projects.find(item => item.id === projectId) : null;
        if (mode === "rename" && !current)
            return;
        const id = current?.id ?? crypto.randomUUID();
        const context = { operationId: options.operationId(), now: options.now() };
        const editor = session.outbox ? session.outbox.ledger().then(ledger => session.commands.at(ledger.snapshot)) : Promise.resolve(session.commands);
        const sheet = projectNameSheetView({ initialName: current?.label ?? "", note: mode === "new" ? "預設不計入日常" : "紀錄不變",
            saveLabel: mode === "new" ? "建立專案" : "儲存", save: (name, includeInDaily) => { void editor.then(commands => saveProjectName(mode, name, id, context, includeInDaily, commands)); },
            ...(current ? { dailyIncluded: current.includeInDaily === true } : {}) });
        shell.sheets.open({ title: mode === "new" ? "新專案" : "重新命名", swipe: "rubber-band", origin: mode === "new" ? "left" : "right", view: sheet, close: () => shell.sheets.dismiss() });
    }
    async function saveProjectName(mode, name, projectKey, context, includeInDaily, commands = session.commands) {
        if (!name.trim() || session.capability.status !== "writable")
            return;
        const outcome = mode === "new" ? await commands.createProject(context, projectKey, name.trim())
            : await commands.updateProject(context, projectKey, { label: name.trim(), ...(includeInDaily !== undefined ? { includeInDaily } : {}) });
        if (outcome.status !== "confirmed" && outcome.status !== "pending") {
            const form = shell.sheets.element.querySelector(".lk-project-name-sheet");
            form?.append(el("p", describeResult(outcome).text, "lk-notice"));
            return;
        }
        shell.sheets.dismiss();
        projectIndex = undefined;
        projectDetail = undefined;
        projectNotice = "";
        if (mode === "new")
            projectId = projectKey;
        await refresh();
    }
    async function updateProject(change) {
        if (!projectId || session.capability.status !== "writable") {
            if (session.capability.status !== "writable")
                later("6p");
            return false;
        }
        if (disposed)
            return false;
        const outcome = await session.commands.updateProject({ operationId: options.operationId(), now: options.now() }, projectId, change);
        archiveConfirmation = false;
        deleteConfirmation = false;
        if (outcome.status !== "confirmed" && outcome.status !== "pending") {
            projectNotice = describeResult(outcome).text;
            render();
            return false;
        }
        projectNotice = "";
        projectIndex = undefined;
        projectDetail = undefined;
        await refresh();
        return true;
    }
    async function toggleProjectTrip(id, currency) {
        if (session.capability.status !== "writable" || !session.preferences) {
            later("6p");
            return;
        }
        const current = preferences.value.currentTrip;
        if (current?.projectId === id)
            projectTripCurrencies.set(id, current.currency);
        projectDetail = undefined;
        projectIndex = undefined;
        if (current?.projectId === id && currency === undefined)
            await changePreferences({ currentTrip: null });
        else
            await changePreferences({ currentTrip: { projectId: id, currency: currency ?? (current?.currency ?? projectTripCurrencies.get(id) ?? "JPY") } });
    }
    async function changeProjectTripCurrency(id, currency) {
        if (session.capability.status !== "writable" || !session.preferences) {
            later("6p");
            return;
        }
        projectTripCurrencies.set(id, currency);
        if (preferences.value.currentTrip?.projectId === id) {
            projectDetail = undefined;
            projectIndex = undefined;
            await changePreferences({ currentTrip: { projectId: id, currency } });
        }
        else
            render();
    }
    function archiveProject() {
        if (!projectId)
            return;
        if (session.capability.status !== "writable") {
            later("6p");
            return;
        }
        const current = projectDetail?.result.projects.find(item => item.id === projectId);
        if (!current)
            return;
        if (current.archived) {
            void updateProject({ archived: false });
            return;
        }
        if (preferences.value.currentTrip?.projectId === projectId) {
            projectNotice = describeResult({ status: "rejected", operationId: options.operationId(), code: "active-trip" }).text;
            archiveConfirmation = false;
            render();
            return;
        }
        archiveConfirmation = true;
        deleteConfirmation = false;
        projectNotice = "";
        render();
    }
    function askDeleteProject() {
        if (!projectId || projectDeleting)
            return;
        if (session.capability.status !== "writable") {
            later("6p");
            return;
        }
        archiveConfirmation = false;
        deleteConfirmation = true;
        projectNotice = "";
        render();
    }
    async function deleteProject() {
        if (!projectId || projectDeleting)
            return;
        if (session.capability.status !== "writable") {
            later("6p");
            return;
        }
        projectDeleting = true;
        render();
        if (disposed)
            return;
        const outcome = await session.commands.deleteProject({ operationId: options.operationId(), now: options.now() }, projectId);
        projectDeleting = false;
        deleteConfirmation = false;
        if (outcome.status !== "confirmed" && outcome.status !== "pending") {
            projectNotice = describeResult(outcome).text;
            render();
            return;
        }
        projectId = null;
        projectListOnly = true;
        projectNotice = "";
        projectIndex = undefined;
        projectDetail = undefined;
        await refresh();
    }
    function stopCompanionMotion() {
        companionMotionGeneration++;
        companionMotionActive = false;
        root.querySelector(".nk-companion")?.classList.remove("nk-motion-active");
    }
    function startCompanionMotion() {
        companionMotionGeneration++;
        companionMotionActive = typeof window.matchMedia === "function" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    }
    function restartCompanionMotion(element) {
        startCompanionMotion();
        element.classList.remove("nk-motion-active");
        if (!companionMotionActive)
            return;
        void element.offsetWidth;
        element.classList.add("nk-motion-active");
        watchCompanionMotion(element);
    }
    function watchCompanionMotion(element, emptyFrames = 0) {
        if (!companionMotionActive)
            return;
        const generation = companionMotionGeneration;
        const animations = element.getAnimations({ subtree: true }).filter(animation => animation.playState !== "idle" && animation.playState !== "finished");
        if (animations.length === 0) {
            if (emptyFrames < 2) {
                requestAnimationFrame(() => {
                    if (!disposed && generation === companionMotionGeneration && element.isConnected)
                        watchCompanionMotion(element, emptyFrames + 1);
                });
                return;
            }
            companionMotionActive = false;
            element.classList.remove("nk-motion-active");
            return;
        }
        void Promise.allSettled(animations.map(animation => animation.finished)).then(() => {
            if (disposed || generation !== companionMotionGeneration || !element.isConnected)
                return;
            const active = element.getAnimations({ subtree: true }).some(animation => animation.playState !== "idle" && animation.playState !== "finished");
            if (active) {
                watchCompanionMotion(element);
                return;
            }
            companionMotionActive = false;
            element.classList.remove("nk-motion-active");
        });
    }
    function onVisibilityChange() {
        if (!result) {
            pageWasHidden = document.visibilityState === "hidden";
            pushScheduler.visibilityChanged();
            if (pageWasHidden)
                pushOnLeave();
            return;
        }
        if (document.visibilityState === "hidden") {
            pageWasHidden = true;
            if (!result.report.coverage.complete) {
                historyPaused = true;
                if (historyRoundRunning || activeSyncOperation?.current) {
                    syncGeneration++;
                    activeSyncOperation?.abort();
                }
            }
            pushScheduler.visibilityChanged();
            pushOnLeave();
            stopCompanionMotion();
            companionOverviewVisible = false;
            return;
        }
        pushScheduler.visibilityChanged();
        const resumeHistory = historyPaused || session.kind === "private" && !result.report.coverage.complete;
        historyPaused = false;
        if (resumeHistory) {
            historyRetries = 0;
            if (historyRoundRunning || activeSyncOperation?.current) {
                historyContinuationPending = true;
                synchronization = "syncing";
                statusMessage = undefined;
                render();
                abandonActiveSync();
            }
            else
                void sync(false, false, true).then(() => pushScheduler.immediate());
        }
        else if (!disposed && result && !settings && tab === "home") {
            const now = options.now();
            const lastOpened = lastOpenedAt === null ? NaN : Date.parse(lastOpenedAt);
            if (Number.isFinite(lastOpened) && Date.parse(now) - lastOpened >= COMPANION_SLEEP_AFTER_MS)
                lastOpenedAt = now;
            const nextState = currentCompanion().state;
            if (nextState !== lastCompanionState) {
                const scrollTop = shell.content.scrollTop;
                companionOverviewVisible = false;
                render();
                shell.content.scrollTop = scrollTop;
            }
            else {
                companionOverviewVisible = true;
                const motion = shell.content.querySelector(".nk-companion");
                if (motion)
                    restartCompanionMotion(motion);
            }
        }
        pageWasHidden = false;
        if (!disposed && !resumeHistory)
            void sync(false, false, true).then(() => pushScheduler.immediate());
    }
    function onPageShow() {
        if (disposed || !pageWasHidden || document.visibilityState === "hidden")
            return;
        onVisibilityChange();
    }
    const observesVisibilityChange = typeof document.addEventListener === "function";
    if (observesVisibilityChange)
        document.addEventListener("visibilitychange", onVisibilityChange);
    function pushOnLeave() { if (!disposed)
        void pushScheduler.immediate(); }
    function onPageHide() {
        pageWasHidden = true;
        if (result && !result.report.coverage.complete) {
            historyPaused = true;
            if (historyRoundRunning || activeSyncOperation?.current) {
                syncGeneration++;
                activeSyncOperation?.abort();
            }
        }
        pushOnLeave();
    }
    const observesPageHide = typeof window.addEventListener === "function";
    if (observesPageHide)
        window.addEventListener("pagehide", onPageHide);
    const observesPageShow = typeof window.addEventListener === "function";
    if (observesPageShow)
        window.addEventListener("pageshow", onPageShow);
    function render() {
        if (disposed || !result)
            return;
        if (tab !== "report" && deferNativeDateRender(shell.content, render))
            return;
        const overviewScroll = !settings && tab === "home" && !methodSpending && !openedRecord && shell.content.querySelector(".lk-overview")
            ? shell.content.scrollTop : null;
        const methodShown = methodSpending && shell.element.querySelector(".lk-method-spending");
        if (methodShown) {
            if (shell.layout === "regular" && !shell.element.querySelector(".lk-record-detail"))
                methodOverviewScroll = shell.content.scrollTop;
            else
                methodPageScroll = shell.content.scrollTop;
        }
        const methodDetailScroll = methodShown ? shell.element.querySelector(".lk-layout-secondary")?.scrollTop ?? 0 : 0;
        detachMissingNotification();
        if (settings || tab !== "home") {
            if (companionOverviewVisible || companionMotionActive)
                stopCompanionMotion();
            companionOverviewVisible = false;
            lastCompanionState = null;
        }
        const feedback = !settings && tab === "add" ? message : "";
        if (manualFeedback.textContent !== feedback)
            manualFeedback.textContent = feedback;
        // Cached Overview is usable before the full snapshot supplies entry/editor defaults.
        if (!picker && (settings || tab !== "home"))
            return;
        for (const listener of capabilityListeners)
            listener();
        const pendingCount = (result.localChanges?.pendingCount ?? 0) + pendingInboxCount;
        const visibleSynchronization = synchronization === "synced" && !result.report.coverage.complete ? "incomplete"
            : synchronization === "synced" && pendingCount > 0 ? "syncing" : synchronization;
        const statusInput = { now: options.now(), lastSynchronizedAt: result.lastSynchronized?.synchronizedAt ?? null, timeZone: result.timeZone,
            firstLoad, progressThroughDate: result.earliestRecordDate, ...(statusMessage ? { message: statusMessage } : {}) };
        const state = visibleSynchronization === "incomplete"
            ? synchronizationStatus({ ...statusInput, state: "incomplete", incompleteDisclosure: coverageDisclosure(false, result.report.coverage.complete, { coverage: result.report.coverage, earliest: result.earliestRecordDate, currentMonth: result.asOf.slice(0, 7) }) })
            : synchronizationStatus({ ...statusInput, state: visibleSynchronization });
        shell.update({ tab: settings ? "settings" : tab, readOnly: session.capability.status === "read-only", pendingCount, pendingCountVisible,
            ...(session.kind === "demo" ? { demo: { ...(options.exitDemo ? { exit: options.exitDemo } : {}) } } : {}),
            ...(!settings && tab === "add" && saveState === "failed" && session.capability.status === "writable"
                ? { saveFailure: { text: "沒存到，草稿還在", icon: "cloud_off" } } : {}),
            status: { text: state.text, icon: state.icon, tone: state.tone, ...(state.firstLoad ? { firstLoad: true } : {}), ...(state.retry ? { retry: () => { void sync(); } } : {}) } });
        const today = dateAt(options.now(), result.timeZone);
        if (settings) {
            recordsPresented = false;
            const pair = pageColumns(settingsView(session, result, preferences, { ...state, pendingCount }, trip, { back: () => shell.navigate(() => { settings = false; tab = "home"; settingPages.leave(); render(); }), sync: () => { void sync(); },
                recheck: showReadOnlyReason, later, ...(options.exitDemo ? { exitDemo: options.exitDemo } : {}),
                recover: (operationId, action) => { void recoverSetting(operationId, action); },
                trip: changeTrip, tripCurrency: () => openCurrencyPicker(trip.currency, currency => changeTrip({ currency })),
                pin: id => { const pins = preferences.value.pinnedCategoryIds; if (pins.includes(id) || pins.length < 3)
                    void changePreferences({ pinnedCategoryIds: pins.includes(id) ? pins.filter(pin => pin !== id) : [...pins, id] }); } }, failedSettings), settingPages.view(), { pageId: settingPages.pageId });
            shell.show(pair.view, pair.arrangement);
            if (options.connectionNotice || session.persistenceNotice)
                shell.content.prepend(notice(options.connectionNotice || session.persistenceNotice, "error"));
            return;
        }
        if (tab === "home") {
            recordsPresented = false;
            const companion = currentCompanion();
            const regular = shell.layout === "regular";
            if (document.visibilityState === "hidden") {
                if (companionMotionActive)
                    stopCompanionMotion();
                companionOverviewVisible = false;
            }
            else {
                if (!companionOverviewVisible || companion.state !== lastCompanionState)
                    startCompanionMotion();
                companionOverviewVisible = true;
            }
            lastCompanionState = companion.state;
            const model = overviewModel(overviewResult, result, session.capability.status === "writable", recentLimit, freshRecords.ids);
            const view = overviewView(model, nook, companion, sceneSize, {
                scope: value => { if (scope !== value) {
                    scope = value;
                    void refresh();
                } },
                method: openMethodSpending,
                open: id => { void openRecord(id, undefined, undefined, "right"); }, quick: (id, kind) => { void openRecord(id, kind === "category" ? "recat" : "note", undefined, "right"); },
                ...(trip.on ? { trip: { label: "旅行中", accessibleName: `旅行中 · ${result.projects.find(project => project.id === trip.projectId)?.label ?? "專案"} · ${trip.currency}`, run: showTripSheet } } : {}),
                ...(showFirstCaptureCard(result.captureEvidence.hasNotificationEvidence)
                    ? { firstCapture: { open: () => later("5y") } } : {}),
                ...(notificationModel().total ? { unrecorded: unrecordedNotice(notificationModel(), notificationActions, expandedNotifications) } : {}),
                emptyLedger: !result.captureEvidence.hasAnyRecord,
                records: { unclassifiedCount: result.classificationGaps.unclassifiedCount, open: openRecords },
            });
            if (regular) {
                const key = JSON.stringify([model.month, model.net, model.expense, model.refund, model.result.complete, companion.state, scope, trip, session.capability.status]);
                const summary = view.element.querySelector(".lk-overview-summary");
                if (overviewSummaryKey === key && overviewSummary)
                    view.element.replaceChildren(overviewSummary, ...Array.from(view.element.children).slice(1));
                else {
                    overviewSummary = summary;
                    overviewSummaryKey = key;
                }
            }
            let motion = view.element.querySelector(".nk-companion");
            const previousMotion = shell.content.querySelector(".nk-companion");
            if (motion && previousMotion && motion.getAttribute("data-state") === previousMotion.getAttribute("data-state") &&
                motion.style.width === previousMotion.style.width && motion.style.height === previousMotion.style.height) {
                if (typeof motion.replaceWith === "function")
                    motion.replaceWith(previousMotion);
                else {
                    const parent = motion.parentElement;
                    if (parent) {
                        const children = Array.from(parent.children);
                        previousMotion.remove();
                        parent.replaceChildren(...children.map(child => child === motion ? previousMotion : child));
                    }
                }
                motion = previousMotion;
            }
            if (motion && companionMotionActive)
                motion.classList.add("nk-motion-active");
            const parts = Array.from(view.element.children);
            const recentIndex = parts.findIndex(part => part.matches(".lk-overview-recent"));
            if (recentIndex < 0)
                throw new Error("Overview is missing its recent section");
            const methodPage = methodSpending ? methodSpendingView(methodSpendingModel(methodSpending.selection, methodSpending.result, session.capability.status === "writable", freshRecords.ids, methodRecordSorts.get(methodSpending.selection.key) ?? "date"), {
                back: closeMethodSpending, step: stepMethodSpending,
                sort: value => { methodRecordSorts.set(methodSpending.selection.key, value); render(); },
                open: id => { void openRecord(id, undefined, methodSpending?.result, "right"); },
                quick: (id, kind) => { void openRecord(id, kind === "category" ? "recat" : "note", methodSpending?.result, "right"); },
            }) : null;
            if (regular) {
                const records = ensureRecordsScreen(true);
                const primary = parts.slice(0, recentIndex);
                if (openedRecord) {
                    const { record, result: detailResult } = openedRecord;
                    const detail = recordDetailView(record, detailResult, session.capability.status === "writable", {
                        ...recordRecoveryActions(record.id), close: closeRecord, history: () => options.history(detailResult, record.id),
                        action: kind => { void openOpenedRecordAction(kind); }, date: target => { void openOpenedRecordAction("date", target); }, open: id => { void openRecord(id); },
                        confirm: () => { void confirmAiRecord(record.id); }, confirming: recordConfirmingId === record.id,
                        ...(recordConfirmationError?.recordId === record.id ? { confirmationError: recordConfirmationError.text } : {}),
                        void: () => {
                            if (openedRecord?.date?.target.busy)
                                return;
                            const confirmation = { element: el("div", undefined, "lk-record-detail-void") };
                            recordSheets.push({ title: "作廢", view: confirmation, close: () => recordSheets.pop() });
                            void showVoidConfirmation({ ...recordMutationHost, commands: openedRecord.commands }, record, confirmation.element, detailResult, () => recordSheets.pop());
                        },
                    }, dateAt(options.now(), detailResult.timeZone));
                    restoreRecordDateFeedback(detail.element);
                    const step = openedRecord.steps.at(-1);
                    const titles = { amount: "金額", recat: "分類", note: "備註", method: "付款方式", split: "拆帳", refund: "退款", link: "連結原始消費", inst: "分期", proj: "專案", fx: "換算" };
                    detail.showStep(step ? { ...step, title: openedRecord.steps.length === 1 && openedRecord.action ? titles[openedRecord.action] ?? step.title : step.title } : null);
                    primary.splice(1, primary.length - 1, detail.element);
                }
                view.element.classList.add("lk-overview-records");
                const secondary = methodPage?.element ?? records.element;
                view.element.replaceChildren(...primary, secondary);
                shell.show(view, { kind: "columns", ...(openedRecord ? { recordId: openedRecord.record.id } : {}), parts: { primary, secondary: [secondary] } });
                records.update(recordsViewState());
                if (!recordsSearchResult && !recordsSearchPending)
                    void searchRecords(recordsQuery);
            }
            else if (methodPage) {
                const pair = pageColumns(view, methodPage, { pageId: methodSpending.selection.key });
                shell.show(pair.view, pair.arrangement);
            }
            else
                shell.show(view, { kind: "columns", parts: { primary: parts.slice(0, recentIndex), secondary: parts.slice(recentIndex) } });
            if (methodPage) {
                shell.content.scrollTop = regular ? openedRecord ? 0 : methodOverviewScroll : methodPageScroll;
                const secondary = shell.element.querySelector(".lk-layout-secondary");
                if (secondary)
                    secondary.scrollTop = methodDetailScroll;
            }
            if (overviewScroll !== null)
                shell.content.scrollTop = overviewScroll;
            if (motion && companionMotionActive)
                watchCompanionMotion(motion);
            if (companion.state === "happy" || companion.state === "attention")
                scheduleCompanionExpiry(companion.state);
        }
        else if (tab === "add") {
            recordsPresented = false;
            draft ??= blankManualDraft(options.operationId(), today, picker, result.manualEntryDefaults);
            ensureManualQuote();
            shell.show(manualEntryView(draft, result.categories, picker, today, { writable: session.capability.status === "writable", capability: session.capability, saveState, locked: manualLocked, quotePending: manualQuotePending, amountFocus: manualFocus,
                projectLabel: result.projects.find(item => item.id === draft.projectId)?.label ?? "專案" }, {
                change: changeManual, key: key => changeManual(manualFocus === "twd"
                    ? { actualTwdAmount: keypadAmount(draft.actualTwdAmount ?? "", key, "TWD") }
                    : { amount: keypadAmount(draft.amount, key, draft.currency) }),
                focus: field => { if (manualLocked || saveState === "saving")
                    return; manualFocus = field; render(); },
                restore: () => { manualFocus = "amount"; changeManual({ actualTwdAmount: undefined }); },
                currency: () => {
                    if (!draft || manualLocked || saveState === "saving")
                        return;
                    openCurrencyPicker(draft.currency, currency => { if (currency === draft.currency)
                        return; manualFocus = "amount"; changeManual({ currency, amount: "", actualTwdAmount: undefined }); });
                },
                save: () => { void save(); }, note: openManualNote, project: openManualProject, date: selected => changeManual({ date: selected }), later
            }, result.earliestRecordDate ?? today), { kind: "entry" });
        }
        else if (tab === "list") {
            ensureRecordsScreen(false);
            if (!recordsPresented)
                shell.show(recordsScreen, { kind: "records" });
            recordsPresented = true;
            recordsScreen.update(recordsViewState());
            if (!recordsSearchResult && !recordsSearchPending)
                void searchRecords(recordsQuery);
        }
        else if (tab === "report") {
            recordsPresented = false;
            void reports.load(overviewResult);
            return;
        }
        else if (tab === "proj") {
            recordsPresented = false;
            ensureProjectIndex();
            const listModel = projectIndex ? projectsListModel(projectIndex, preferences, projectSort, recoveryProjects(projectIndex)) : { active: [], archived: [], sort: projectSort };
            const list = projectsListView(listModel, { create: () => openProjectNameSheet("new"), open: openProject,
                sort: value => { projectSort = value; options.projectSortPreference?.set(value); render(); } });
            let page = null;
            if (projectId && projectIndex && !projectIndex.projects.some(item => item.id === projectId) && !recoveryProject(projectId, projectIndex)) {
                projectId = null;
                projectListOnly = true;
                projectDetail = undefined;
                clearProjectCategoryFilter();
                archiveConfirmation = false;
                deleteConfirmation = false;
            }
            if (projectId !== null) {
                if (projectIndex)
                    ensureProjectDetail(projectId);
                if (projectIndex && projectCategoryId)
                    ensureProjectCategoryDetail(projectId, projectCategoryId);
                const detail = projectDetail?.id === projectId ? projectDetail.result : undefined;
                const filtered = projectFilteredDetail?.id === projectId && projectFilteredDetail.categoryId === projectCategoryId ? projectFilteredDetail.result : undefined;
                const categoryFilter = projectCategoryId && filtered ? { categoryId: projectCategoryId, result: filtered } : undefined;
                const recoveryProjectValue = detail ? recoveryProject(projectId, detail) : undefined;
                const model = detail ? projectPageModel(detail, projectId, preferences, session.capability.status === "writable", projectTripCurrencies.get(projectId) ?? "JPY", categoryFilter, recoveryProjectValue, projectRecordSorts.get(projectId) ?? "date") : null;
                if (!detail || !model)
                    page = { element: el("div", undefined, "lk-project-page lk-feature-view") };
                else
                    page = projectPageView(model, { writable: session.capability.status === "writable", confirmArchive: archiveConfirmation,
                        confirmDelete: deleteConfirmation, deleting: projectDeleting, notice: projectNotice,
                        ...(recoveryOperationIds("project", projectId, detail).length ? { recovery: {
                                copy: syncRecoveryCopy(detail?.localChanges?.recoveryTargets?.find(target => target.kind === "project" && target.objectId === projectId) ?? { noticeKind: "project-edit" }),
                                resend: () => { void recoverObject("project", projectId, "resend"); },
                                discard: () => { void recoverObject("project", projectId, "discard"); },
                            } } : {}),
                        actions: {
                            back: () => { projectId = null; projectNotice = ""; clearProjectCategoryFilter(); archiveConfirmation = false; deleteConfirmation = false; projectDetail = undefined; render(); },
                            rename: () => openProjectNameSheet("rename"), batch: openProjectBatch, archive: archiveProject,
                            confirmArchive: () => { void updateProject({ archived: true }); },
                            cancelArchive: () => { archiveConfirmation = false; render(); },
                            delete: askDeleteProject, confirmDelete: () => { void deleteProject(); },
                            cancelDelete: () => { deleteConfirmation = false; render(); },
                            trip: () => { void toggleProjectTrip(projectId, model.isTrip ? undefined : model.tripCurrency); },
                            tripCurrency: () => { const id = projectId; openCurrencyPicker(model.tripCurrency, currency => { void changeProjectTripCurrency(id, currency); }); },
                            category: selectProjectCategory,
                            sort: value => { projectRecordSorts.set(projectId, value); render(); },
                            openRecord: id => { void openRecord(id, undefined, detail); }, quick: (id, kind) => { void openRecord(id, kind === "category" ? "recat" : "note", detail); },
                        } });
            }
            const defaultId = defaultProjectId(listModel);
            const pair = pageColumns(list, page, { pageId: projectId,
                ...(defaultId && !projectListOnly ? { selectDefault: () => openProject(defaultId) } : {}) });
            shell.show(pair.view, pair.arrangement);
        }
        shell.content.querySelectorAll(":scope > .lk-demo-banner, :scope > .lk-notice").forEach(node => node.remove());
        if (options.connectionNotice || session.persistenceNotice)
            shell.content.prepend(notice(options.connectionNotice || session.persistenceNotice, "error"));
        shell.refreshLayout();
    }
    function currentCompanion() {
        const pendingCount = (result.localChanges?.pendingCount ?? 0) + pendingInboxCount;
        const visibleSynchronization = synchronization === "synced" && pendingCount > 0 ? "syncing" : synchronization;
        const selected = selectCompanion({ now: options.now(), lastOpenedAt, sleepAfterMs: COMPANION_SLEEP_AFTER_MS,
            synchronization: visibleSynchronization, readOnly: session.capability.status === "read-only", unclassifiedCount: result.classificationGaps.unclassifiedCount,
            lastAutomaticCaptureAt: latestAutomatic, lastManualSaveAt, lastOrganizationAt });
        // Routine foreground/network sync must not flicker the pose; first load and completed sync states stay expressive.
        const stable = routineBackgroundSync && visibleSynchronization === "syncing" && lastCompanionState !== null
            ? { ...selected, state: lastCompanionState } : selected;
        return shell.layout === "regular" && openedRecord && !openedRecord.record.categoryId && !openedRecord.record.split && stable.state !== "happy"
            ? { ...stable, state: "attention" } : stable;
    }
    function scheduleCompanionExpiry(state) {
        if (companionTimer !== undefined)
            clearTimeout(companionTimer);
        const activityAt = state === "happy" ? lastOrganizationAt : [latestAutomatic, lastManualSaveAt]
            .filter((value) => value !== null).sort().at(-1) ?? null;
        if (!activityAt)
            return;
        const duration = state === "happy" ? 2_600 : 3_400;
        const scheduledAt = Date.parse(options.now());
        const delay = Math.max(0, Date.parse(activityAt) + duration - scheduledAt + 1);
        companionTimer = setTimeout(() => {
            if (Date.parse(options.now()) !== scheduledAt)
                render();
        }, delay);
    }
    async function refresh() {
        if (disposed)
            return;
        const revision = ++refreshRevision;
        try {
            const model = session.preferences ? await session.preferences.read() : snapshotPreferences({ objects: [], cursor: null, coverage: { complete: true, missing: [] } }, options.localTimeZone);
            const today = dateAt(options.now(), model.reportingTimeZone);
            const request = { period: { kind: "month", month: today.slice(0, 7) }, asOf: today,
                captureBankIds: model.value.paymentMethods.flatMap(method => method.kind === "bank" ? [method.id] : []) };
            if (!manualRestored) {
                const stored = restoreManualDraft(await session.drafts.get(manualDraftKey));
                if (disposed || revision !== refreshRevision)
                    return;
                manualRestored = true;
                const queued = stored && session.outbox && (await session.outbox.store.read()).some(intent => intent.command.operationId === stored.draft.operationId);
                if (queued) {
                    await session.drafts.delete(manualDraftKey);
                }
                else if (stored) {
                    draft = stored.draft;
                    manualLocked = false;
                    manualAttemptAt = stored.now;
                    saveState = stored.now ? "failed" : "idle";
                }
            }
            if (restoreCachedView) {
                restoreCachedView = false;
                let cached = null;
                try {
                    cached = await session.restoreLastView?.(request) ?? null;
                }
                catch { /* A cache failure falls back to the validated snapshot. */ }
                if (disposed || revision !== refreshRevision)
                    return;
                if (cached) {
                    preferences = model;
                    result = overviewResult = cached;
                    const currentTrip = model.value.currentTrip;
                    trip = currentTrip ? { on: true, ...currentTrip } : { ...trip, on: false };
                    render();
                    root.dataset.firstViewMounted = "true";
                }
            }
            // Keep record lists and organization signals independent of the selected totals scope.
            const [next, nextOverview] = await Promise.all([session.query({ ...request, scope: "all" }),
                scope === "all" ? null : session.query({ ...request, scope })]);
            const nextPicker = session.preferences ? await session.preferences.picker() : { methods: [{ kind: "cash", id: "cash", label: "現金" }], defaultId: "cash", entryDefaults: next.manualEntryDefaults };
            const nextOrganization = session.organization ? await session.organization(next.asOf) : { organiserConfigured: false, unclassified: [], suggestions: [] };
            const nextIntents = session.outbox ? await session.outbox.list() : [];
            const nextFailedSettings = failedSettingsFromIntents(nextIntents);
            if (disposed || revision !== refreshRevision)
                return;
            const cachedProjects = projectIndex ?? projectDetail?.result;
            if (cachedProjects && (cachedProjects.publicationRevision !== next.publicationRevision ||
                cachedProjects.lastSynchronized?.commit !== next.lastSynchronized?.commit || cachedProjects.asOf !== next.asOf)) {
                projectIndex = undefined;
                projectDetail = undefined;
                projectFilteredDetail = undefined;
                projectFilterLoadingKey = null;
                projectFilterRevision++;
                projectLoadRevision++;
                projectIndexLoading = false;
                projectDetailLoading = null;
            }
            const tripChanged = preferences && JSON.stringify(preferences.value.currentTrip) !== JSON.stringify(model.value.currentTrip);
            if (tripChanged && draft && !draft.amount && !draft.categoryId && !draft.notes && draft.paymentMethodId === picker.defaultId &&
                draft.projectId === (preferences.value.currentTrip?.projectId ?? null) && draft.currency === (preferences.value.currentTrip?.currency ?? "TWD")) {
                draft = blankManualDraft(draft.operationId, today, nextPicker, next.manualEntryDefaults);
            }
            if (result && result.asOf !== next.asOf) {
                recordsSnapshotRevision++;
                recordsSearchRevision++;
                allRecordsSearchResult = null;
                allRecordsSearchPromise = null;
                recordsSearchResult = null;
                recordsSearchPending = false;
            }
            preferences = model;
            result = next;
            picker = nextPicker;
            overviewResult = nextOverview ?? next;
            organization = nextOrganization;
            failedSettings = nextFailedSettings;
            failedIntents = nextIntents.filter(item => item.state === "failed");
            if (methodSpending) {
                const current = methodSpending.selection;
                const group = overviewResult.billingCycleSpending.groups.find(item => item.key === current.key);
                if (group) {
                    const selection = methodSpendingSelection(group, model.value, scope);
                    // A current period follows the reporting date; a selected historical period stays selected.
                    const wasCurrent = current.period.to === currentMethodPeriod(current, methodSpending.result.asOf).to;
                    void loadMethodSpending({ ...selection, period: wasCurrent ? selection.period : current.period });
                }
            }
            if (session.outbox) {
                const localLedger = await session.outbox.ledger();
                pendingInboxCount = localLedger.inboxWrites.length;
                for (const write of localLedger.inboxWrites) {
                    if (write.value && "id" in write.value && write.path.startsWith("events/") && freshRecords.markIfNew(write.value.id))
                        lastManualSaveAt = options.now();
                }
            }
            freshRecords.observe(next.report.records);
            const currentTrip = model.value.currentTrip;
            if (currentTrip)
                projectTripCurrencies.set(currentTrip.projectId, currentTrip.currency);
            trip = currentTrip ? { on: true, ...currentTrip } : { ...trip, on: false, projectId: trip.projectId ?? next.projects.find(item => !item.archived)?.id ?? null };
            latestAutomatic = Object.values(next.captureEvidence.lastCapturedAtByBank).filter((value) => value !== null).sort().at(-1) ?? null;
            render();
            root.dataset.firstViewMounted = "true";
            if (session.cacheLastView)
                void session.cacheLastView(request, next).catch(() => undefined);
        }
        catch (error) {
            // Closing/replacing a session can abort an outstanding IndexedDB transaction.
            if (!disposed && revision === refreshRevision)
                throw error;
        }
    }
    async function changePreferences(patch) {
        const outcome = await session.preferences?.change({ operationId: options.operationId(), now: options.now() }, patch);
        if (outcome && !["confirmed", "pending"].includes(outcome.status)) {
            message = "偏好未儲存";
        }
        await refresh();
        return outcome;
    }
    function openManualNote() {
        if (!draft || manualLocked || saveState === "saving")
            return;
        shell.sheets.open({ title: "備註", swipe: "rubber-band", origin: "left", view: manualNoteSheet(draft.notes, value => {
                shell.sheets.dismiss();
                changeManual({ notes: value });
            }), close: () => shell.sheets.dismiss() });
    }
    function openManualProject() {
        if (!draft || manualLocked || saveState === "saving")
            return;
        shell.sheets.open({ title: "專案", swipe: "close", origin: "left", view: manualProjectSheet(result.projects, draft.projectId, projectId => {
                shell.sheets.dismiss();
                changeManual({ projectId });
            }), close: () => shell.sheets.dismiss() });
    }
    async function save() {
        detachMissingNotification();
        if (!draft || saveState === "saving" || session.capability.status !== "writable" || manualQuotePending || !canSaveManualDraft(draft))
            return;
        saveState = "saving";
        manualAttemptAt ??= options.now();
        render();
        try {
            await retainManualDraft();
        }
        catch {
            saveState = "failed";
            message = "無法保留草稿，請重試";
            render();
            return;
        }
        const command = manualCommand(draft);
        const context = { operationId: draft.operationId, now: manualAttemptAt };
        let outcome;
        try {
            if (disposed)
                return;
            outcome = (draft.notification ? await session.commands.createManualFromUnrecorded(context, draft.notification.id, command.input, command.details, result.timeZone)
                : await session.commands.createManual(context, command.input, command.details));
        }
        catch {
            outcome = { status: "rejected", code: "local-storage", operationId: draft.operationId };
        }
        if (disposed)
            return;
        message = describeResult(outcome).text;
        if (outcome.status === "rejected" && outcome.code === "credential-rejected") {
            await clearRejectedConnection();
            return;
        }
        if (outcome.status === "confirmed" || outcome.status === "pending") {
            freshRecords.mark(outcome.operationId);
            void draftWrites.then(() => session.drafts.delete(manualDraftKey)).catch(() => { });
            manualLocked = false;
            manualAttemptAt = null;
            lastManualSaveAt = options.now();
            manualFocus = "amount";
            draft = blankManualDraft(options.operationId(), dateAt(options.now(), result.timeZone), picker, result.manualEntryDefaults);
            tab = "home";
            settings = false;
            recordsRoute = false;
            saveState = "idle";
        }
        else {
            saveState = "failed";
            manualLocked = false;
            await retainManualDraft();
        }
        await refresh();
        if (outcome.status === "confirmed" || outcome.status === "pending")
            void pushScheduler.immediate();
    }
    async function sync(manual = true, pushPending = manual, keepCompanionSteady = false, abandonBusy = manual) {
        if (disposed)
            return;
        if (historyRoundRunning || activeSyncOperation?.current) {
            historyContinuationPending = true;
            synchronization = "syncing";
            statusMessage = undefined;
            pendingCountVisible = false;
            render();
            if (abandonBusy) {
                if (manual && pushPending)
                    historyRetries = 0;
                abandonActiveSync();
            }
            return;
        }
        if (synchronization === "syncing")
            synchronization = result.report.coverage.complete ? "synced" : "incomplete";
        if (manual && pushPending)
            historyRetries = 0;
        historyContinuationPending = false;
        historyRoundRunning = true;
        const generation = ++syncGeneration;
        const operation = createSyncOperation(SYNC_OPERATION_TIMEOUT_MS);
        activeSyncOperation = operation;
        let continueAfterRound = false;
        try {
            const establishingBaseline = !freshRecordsReady;
            firstLoad = result.lastSynchronized === null;
            routineBackgroundSync = keepCompanionSteady && !firstLoad && lastCompanionState !== null;
            statusMessage = undefined;
            synchronization = "syncing";
            pendingCountVisible = false;
            render();
            let outcomes = [];
            let successfulRound = false;
            const settleTimeout = async () => {
                firstLoad = false;
                await refresh();
                if (generation !== syncGeneration)
                    return;
                synchronization = result.report.coverage.complete ? "failed" : "incomplete";
                routineBackgroundSync = false;
                render();
                if (!result.report.coverage.complete) {
                    const missingMonths = new Set(result.report.coverage.missing.flatMap(path => {
                        const match = /^(?:events|details|unrecorded)\/v1\/(\d{4}\/\d{2})$/.exec(path);
                        return match ? [match[1]] : [];
                    })).size;
                    historyRemaining = missingMonths || Infinity;
                    continueAfterRound = ++historyRetries < 3;
                }
            };
            try {
                outcomes = await session.synchronize({ period: result.report.period, manual, signal: operation.signal });
                if (generation !== syncGeneration)
                    return;
                if (operation.end === "timed-out") {
                    await settleTimeout();
                    return;
                }
                operation.finish();
                if (outcomes.some(item => item.status === "unauthorized" || item.status === "forbidden")) {
                    routineBackgroundSync = false;
                    historyRemaining = Infinity;
                    historyRetries = 0;
                    historyContinuationPending = false;
                    await clearRejectedConnection();
                    return;
                }
                if (outcomes.some(item => item.status === "offline"))
                    synchronization = "offline";
                else if (outcomes.every(item => ["synced", "unchanged", "throttled"].includes(item.status)))
                    successfulRound = true;
                else if (outcomes.some(item => item.status === "partial"))
                    synchronization = "incomplete";
                else
                    synchronization = "failed";
            }
            catch {
                if (generation === syncGeneration)
                    synchronization = "failed";
            }
            if (generation !== syncGeneration)
                return;
            if (operation.end === "timed-out") {
                await settleTimeout();
                return;
            }
            operation.finish();
            firstLoad = false;
            await refresh();
            if (generation !== syncGeneration)
                return;
            void pushScheduler.pendingChanged();
            if (successfulRound)
                synchronization = result.report.coverage.complete ? "synced" : "incomplete";
            routineBackgroundSync = false;
            if (establishingBaseline && outcomes.length > 0 && outcomes.every(item => ["synced", "unchanged", "throttled"].includes(item.status))) {
                freshRecords.arm();
                freshRecordsReady = true;
            }
            if (synchronization === "synced" && !result.lastSynchronized)
                statusMessage = "已同步";
            render();
            if (pushPending)
                await pushScheduler.immediate();
            if (generation !== syncGeneration)
                return;
            if (tab === "list" || shell.layout === "regular" && tab === "home")
                void searchRecords(recordsQuery);
            const nonRetryable = outcomes.some(item => ["offline", "rate-limited", "unauthorized", "forbidden", "partial", "cancelled"].includes(item.status));
            const storageFailed = outcomes.some(item => item.status === "storage-failed");
            const progressOutcomes = outcomes.filter(item => "remainingMonths" in item);
            if (nonRetryable || outcomes.length === 0 || outcomes.some(item => !["synced", "throttled", "storage-failed"].includes(item.status))) {
                historyRemaining = Infinity;
                historyRetries = 0;
                historyContinuationPending = false;
            }
            else {
                const missingMonths = new Set(result.report.coverage.missing.flatMap(path => {
                    const match = /^(?:events|details|unrecorded)\/v1\/(\d{4}\/\d{2})$/.exec(path);
                    return match ? [match[1]] : [];
                })).size;
                const reportedRemaining = progressOutcomes.length ? Math.min(...progressOutcomes.map(item => item.remainingMonths)) : Infinity;
                const remaining = storageFailed
                    ? result.report.coverage.complete ? 0 : Math.max(missingMonths, Number.isFinite(historyRemaining) ? historyRemaining : 0, reportedRemaining === Infinity ? 0 : reportedRemaining)
                    : reportedRemaining;
                if (remaining === 0) {
                    historyRemaining = Infinity;
                    historyRetries = 0;
                    historyContinuationPending = false;
                }
                else {
                    const progressed = remaining < historyRemaining;
                    historyRemaining = remaining;
                    if (storageFailed)
                        historyRetries++;
                    else if (progressed)
                        historyRetries = 0;
                    else
                        historyRetries++;
                    continueAfterRound = historyRetries < 3;
                    if (!continueAfterRound)
                        historyContinuationPending = false;
                }
            }
        }
        finally {
            if (activeSyncOperation === operation)
                activeSyncOperation = undefined;
            operation.finish();
            historyRoundRunning = false;
            if (!disposed && (continueAfterRound || historyContinuationPending)) {
                historyContinuationPending = false;
                continueHistory();
            }
        }
    }
    function continueHistory() {
        if (disposed || historyTimer !== undefined)
            return;
        if (historyRoundRunning || activeSyncOperation?.current) {
            historyContinuationPending = true;
            return;
        }
        if (document.visibilityState === "hidden") {
            historyPaused = true;
            return;
        }
        // The next batch bypasses the foreground throttle like an explicit synchronization.
        historyTimer = setTimeout(() => { historyTimer = undefined; void sync(true, false, false, false); }, 0);
    }
    function onNetworkOnline() { void pushScheduler.immediate(); void sync(false, false, true).then(() => pushScheduler.immediate()); }
    const observesNetworkOnline = typeof window.addEventListener === "function";
    if (observesNetworkOnline)
        window.addEventListener("online", onNetworkOnline);
    const unsubscribe = session.onPublication?.(() => {
        recordsSnapshotRevision++;
        recordsSearchRevision++;
        allRecordsSearchResult = null;
        allRecordsSearchPromise = null;
        recordsSearchResult = null;
        recordsSearchPending = false;
        if (tab === "list" || shell.layout === "regular" && tab === "home")
            void searchRecords(recordsQuery);
        void refresh();
    });
    const unsubscribeCleared = session.onConnectionCleared?.(dataCleared => options.connectionCleared?.(dataCleared));
    // Show the local snapshot first, then let the existing synchronizer fill a newly connected ledger.
    let freshRecordsReady = false;
    const ready = refresh().then(async () => {
        if (session.kind === "private") {
            await sync(false);
            await pushScheduler.immediate();
        }
        else {
            freshRecords.arm();
            freshRecordsReady = true;
        }
    });
    return { shell, ready, refresh, openRecord, selectTab: shell.selectTab, showSettings() { shell.navigate(() => { clearOpenedRecord(); clearMethodSpending(); clearProjectCategoryFilter(); reports.leave(); settingPages.leave(); settings = true; tab = "settings"; render(); }); },
        openTripSettings: showTripSheet, recordOrganizationActivity: () => companionActivity("happy"), recordNewEntryActivity: () => companionActivity("attention"), wakeCompanion,
        flushPush: () => pushScheduler.immediate(),
        dispose() { if (disposed)
            return; disposed = true; manualQuoteRequest?.abort(); syncGeneration++; activeSyncOperation?.abort(); for (const operation of activePushOperations)
            operation.abort(); pushScheduler.dispose(); unsubscribeChanges?.(); clearOpenedRecord(); freshRecords.reset(); unsubscribeLayout(); stopCompanionMotion(); if (observesVisibilityChange && typeof document.removeEventListener === "function")
            document.removeEventListener("visibilitychange", onVisibilityChange); if (observesPageHide && typeof window.removeEventListener === "function")
            window.removeEventListener("pagehide", onPageHide); if (observesPageShow && typeof window.removeEventListener === "function")
            window.removeEventListener("pageshow", onPageShow); clearTimeout(organizationTimer); clearTimeout(historyTimer); tripSheetOpen = false; refreshRevision++; recordsSearchRevision++; reports.dispose(); settingPages.dispose(); if (companionTimer !== undefined)
            clearTimeout(companionTimer); unsubscribe?.(); unsubscribeCleared?.(); if (observesNetworkOnline && typeof window.removeEventListener === "function")
            window.removeEventListener("online", onNetworkOnline); shell.dispose(); session.release(); } };
}
