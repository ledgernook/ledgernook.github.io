import { NOTIFICATION_BANKS } from "../core/index.js";
import { dateAt, dayLabel, displayAmount } from "./ledger-format.js";
import { screenDateFormatter } from "./screen-date-format.js";
import { syncRecoveryCopy } from "./sync-recovery-copy.js";
export function unrecordedNoticeModel(entries, timeZone, writable, asOf, picker, previews = new Map(), surface = "page", recoveryOperations = new Map(), recoveryCopies = new Map()) {
    const ordered = [...entries].sort((a, b) => b.capturedAt.localeCompare(a.capturedAt) || a.id.localeCompare(b.id));
    const dateFormatter = screenDateFormatter(asOf, []);
    const items = ordered.map(notification => {
        const recoveryOperationIds = recoveryOperations.get(notification.id) ?? [];
        const method = picker?.methods.find(method => method.id === notification.bankId);
        const source = notification.bankId ? method?.label ?? NOTIFICATION_BANKS.find(bank => bank.id === notification.bankId)?.label ?? notification.bankId : notification.application;
        const date = dateAt(notification.capturedAt, timeZone);
        const time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(notification.capturedAt)).replace(/^0/u, "");
        const preview = notification.bankId ? previews.get(notification.id) : undefined, event = preview?.event;
        const amount = notification.readableAmount;
        const parsedDate = event?.occurredAt ? dateAt(event.occurredAt, timeZone) : date;
        const parsedTime = event?.occurredAt ? new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(event.occurredAt)).replace(/^0/u, "") : time;
        return { notification, id: notification.id, source, capturedAt: `${dayLabel(date, asOf)} ${time}`,
            sourceMeta: `${source} · ${dateFormatter.timelineDate(date)} ${time}`,
            reason: "看不懂這則通知",
            amount: amount ? `${amount.currency === "TWD" ? "NT$" : `${amount.currency} `}${displayAmount(amount.amountMinor, amount.currency)}` : null,
            raw: notification.rawText, ...(preview?.merchant ? { merchant: preview.merchant } : {}),
            parsed: event ? { merchant: event.merchant ?? source, amount: displayAmount(event.amountMinor, event.currency), meta: `${source} · ${dayLabel(parsedDate, asOf)} ${parsedTime}` } : null,
            dismissDisabled: !writable || recoveryOperationIds.length > 0, fillDisabled: !writable || recoveryOperationIds.length > 0,
            ...(recoveryOperationIds.length ? { syncState: "failed" } : {}),
            recoveryCopy: recoveryCopies.get(notification.id) ?? syncRecoveryCopy({ noticeKind: "notification-dismiss" }), recoveryOperationIds };
    });
    return { items: surface === "page" ? items.slice(0, 2) : items, total: items.length, more: surface === "page" && items.length >= 3, surface, writable };
}
export function showFirstCaptureCard(hasNotificationEvidence) { return !hasNotificationEvidence; }
