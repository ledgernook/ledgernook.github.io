import { NOTIFICATION_BANKS, PREFERENCES_PATH, USER_RULES_PATH } from "../core/index.js";
import { dateAt } from "./ledger-format.js";
import { WALLET_CAPTURE_SUSPENDED } from "./settings-flags.js";
import { syncRecoveryCopy } from "./sync-recovery-copy.js";
/** Names the Settings row affected by each failed retained intent. */
export function failedSettingsFromIntents(intents) {
    const failures = new Map();
    for (const { intent, state } of intents) {
        if (state !== "failed")
            continue;
        const targets = new Set();
        for (const write of intent.command.writes) {
            if (write.path === USER_RULES_PATH)
                targets.add("categoriesRules");
            if (write.path !== PREFERENCES_PATH || write.value === null)
                continue;
            const before = (intent.bases[write.path]?.value ?? {});
            const after = write.value;
            for (const target of ["paymentMethods", "organiserModel", "reportingTimeZone", "currentTrip", "pinnedCategoryIds"]) {
                if (JSON.stringify(before[target]) !== JSON.stringify(after[target]))
                    targets.add(target);
            }
        }
        for (const target of targets)
            failures.set(`${target}:${intent.command.operationId}`, { target, operationId: intent.command.operationId });
    }
    return [...failures.values()];
}
export function failedSettingCopy(target) {
    switch (target) {
        case "categoriesRules": return "分類與規則變更未能同步。";
        case "paymentMethods": return "付款方式變更未能同步。";
        case "organiserModel": return "AI 整理設定未能同步。";
        case "reportingTimeZone": return "報表時區變更未能同步。";
        case "currentTrip": return "旅行中設定未能同步。";
        case "pinnedCategoryIds": return "總覽釘選變更未能同步。";
    }
}
export function failedSettingRecoveryCopy(target) {
    const kinds = {
        categoriesRules: "setting-categories-rules",
        paymentMethods: "setting-payment-methods",
        organiserModel: "setting-ai-organiser",
        reportingTimeZone: "setting-reporting-time-zone",
        currentTrip: "setting-current-trip",
        pinnedCategoryIds: "setting-overview-pins",
    };
    return syncRecoveryCopy({ noticeKind: kinds[target] });
}
export const LEDGERNOOK_WRITER_SHORTCUT_HREF = "./shortcuts/LedgerNook%20Writer.shortcut";
export const LEDGERNOOK_ORGANISER_SHORTCUT_HREF = "./shortcuts/LedgerNook%20整理分類.shortcut";
export const automaticCaptureSteps = [
    { id: "install", title: "加入捷徑", detail: "位置選「我的 iPhone」，不要選 iCloud 雲碟；資料夾會自動建立", action: "LedgerNook Writer" },
    { id: "writer", title: "設定連線", detail: "先為 Writer 建立自己的權杖，和這個 App 的權杖分開", action: "開啟捷徑 App" },
    { id: "automation", title: "設定銀行通知自動化", detail: "一個自動化涵蓋所有銀行", action: "看圖解" },
    { id: "capture", title: "等第一筆自動記帳", detail: "", action: "" },
];
export function automaticCaptureApps(methods) {
    const bankApps = methods.flatMap(method => method.kind === "bank" && method.source === "bank-app" ? [method.label] : []);
    return [...bankApps, ...(methods.some(method => method.kind === "bank" && method.source === "wallet") ? ["錢包"] : [])];
}
export const reportingZones = [
    ["Asia/Taipei", "台北時間 UTC+8"], ["Asia/Tokyo", "東京時間 UTC+9"],
    ["Europe/London", "倫敦時間 UTC+1"], ["America/Los_Angeles", "洛杉磯時間 UTC−7"],
];
export function reportingZonesAt(instant) {
    return reportingZones.map(([zone, label]) => {
        const offset = new Intl.DateTimeFormat("en", { timeZone: zone, timeZoneName: "shortOffset" }).formatToParts(new Date(instant)).find(part => part.type === "timeZoneName").value.replace("GMT", "UTC").replace("-", "−").replace("UTC+0", "UTC");
        return [zone, `${label.split(" ")[0]} ${offset}`];
    });
}
export function reportingZoneLabel(zone, instant) { return reportingZonesAt(instant).find(item => item[0] === zone)?.[1] ?? zone; }
export function automaticCaptureModel(result, methods, walletCaptureSuspended = WALLET_CAPTURE_SUSPENDED) {
    const apps = automaticCaptureApps(methods);
    const banks = methods.flatMap((method) => {
        if (method.kind !== "bank")
            return [];
        const instant = result.captureEvidence.lastCapturedAtByBank[method.id];
        const date = instant ? dateAt(instant, result.timeZone) : null;
        const time = instant ? new Intl.DateTimeFormat("en-GB", { timeZone: result.timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(instant)) : "";
        return [{ label: method.label, ...(walletCaptureSuspended ? {} : { source: method.source === "wallet" ? "Wallet" : "銀行 App" }), last: date ? `${date.slice(0, 4) === result.asOf.slice(0, 4) ? "" : `${date.slice(0, 4)}/`}${Number(date.slice(5, 7))}/${Number(date.slice(8))} ${time}` : "尚未收到" }];
    });
    return { complete: result.captureEvidence.hasNotificationEvidence, apps, banks, steps: automaticCaptureSteps, writerShortcutHref: LEDGERNOOK_WRITER_SHORTCUT_HREF };
}
export function merchantRuleRows(rules) {
    return rules.brands.flatMap(brand => {
        const categoryId = rules.brandCategories[brand.id];
        return categoryId ? [{ id: brand.id, label: brand.label, aliases: [...new Set([brand.label, ...brand.aliases])], categoryId }] : [];
    });
}
/** Enabled rows follow the ledger; remembered disabled rows retain their relative placement. */
export function paymentMethodSettingsRows(enabled, known) {
    const ids = new Set(enabled.map(method => method.id));
    return [...enabled.map(method => ({ ...method, enabled: true })),
        ...known.filter(method => !ids.has(method.id)).map(method => ({ ...method, enabled: false }))];
}
export function movePaymentMethod(ids, id, index) {
    const from = ids.indexOf(id), to = Math.max(0, Math.min(ids.length - 1, index));
    if (from < 0 || from === to)
        return ids;
    const next = ids.filter(value => value !== id);
    next.splice(to, 0, id);
    return next;
}
/** A reorder can only permute enabled methods, preserving every source/closing-day field. */
export function paymentMethodOrderPatch(methods, ids) {
    if (ids.length !== methods.length || new Set(ids).size !== ids.length || ids.some(id => !methods.some(method => method.id === id)) ||
        ids.every((id, index) => methods[index].id === id))
        return null;
    const byId = new Map(methods.map(method => [method.id, method]));
    return { paymentMethods: ids.map(id => byId.get(id)) };
}
/** Parse the uncommitted text in a closing-day field; undefined marks invalid input. */
export function parseClosingDay(value) {
    if (value === "")
        return null;
    if (!/^\d+$/u.test(value))
        return undefined;
    const day = Number(value);
    return Number.isInteger(day) && day >= 1 && day <= 31 ? day : undefined;
}
export function newPaymentMethod(draft, id) {
    if (draft.bankId) {
        const bank = NOTIFICATION_BANKS.find(item => item.id === draft.bankId);
        if (!bank || !bank.sources.includes(draft.source))
            return null;
        return { kind: "bank", id: bank.id, source: draft.source, ...(draft.closingDay ? { closingDay: draft.closingDay } : {}) };
    }
    const label = draft.custom.trim();
    return label ? { kind: "custom", id, label } : null;
}
