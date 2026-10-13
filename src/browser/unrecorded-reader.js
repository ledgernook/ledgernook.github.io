import { parseCathayUnitedCharge, parseDbsCharge, parseFubonCharge, parseWalletCharge, readBestEffortNotificationMerchant } from "../banks/index.js";
/** Browser composition of the reviewed source parsers for retained inbox entries. */
export const unrecordedReader = {
    reparse(entry) {
        if (!entry.bankId)
            return undefined;
        const parsed = entry.ingestionSource === "wallet"
            ? parseWalletCharge(entry.rawText, { bankId: entry.bankId, currency: "TWD" }, entry.capturedAt)
            : entry.bankId === "cathay-united" ? parseCathayUnitedCharge(entry.rawText)
                : entry.bankId === "dbs-taiwan" ? parseDbsCharge(entry.rawText, entry.capturedAt)
                    : entry.bankId === "taipei-fubon" ? parseFubonCharge(entry.rawText, entry.capturedAt) : undefined;
        return parsed?.ok ? parsed.event : undefined;
    },
    merchant: entry => entry.bankId ? readBestEffortNotificationMerchant(entry.bankId, entry.ingestionSource, entry.rawText) : undefined,
};
