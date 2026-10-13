import { LedgerEventValidationError, TWD_MINOR_UNITS_PER_UNIT, validateLedgerEvent, decimalToMinor, isCurrencyCode, } from "../core/index.js";
export const BANK_DISPLAY_NAMES = Object.freeze({
    "cathay-united": "國泰世華",
    "dbs-taiwan": "星展",
    "taipei-fubon": "台北富邦",
});
export function bankDisplayName(bankId) {
    return Object.hasOwn(BANK_DISPLAY_NAMES, bankId) ? BANK_DISPLAY_NAMES[bankId] : bankId;
}
const SYNTHETIC_DESCRIPTION = "Synthetic fixture profile only; not a live bank format.";
export const cathayUnitedProfile = {
    bankId: "cathay-united",
    utcOffsetHours: 8,
};
const CATHAY_UNSUPPORTED_WORDS = /(?:退款|退刷|分期|取消|撤銷|撤销|作廢|作废|沖正|冲正|沖銷|冲销|撤回|cancel(?:led|ed|lation|ation)?|refund|revers(?:al|ed)|installments?)/iu;
const CATHAY_MERCHANT_MONEY = /(?:金額|[$¥€£￥]|\b(?:TWD|NTD|USD|HKD|JPY|EUR|CNY|RMB)\b|元|美元|日圓|歐元|港幣|人民幣)/iu;
const CATHAY_CHARGE_ENDING = /刷卡(?:。|，點擊查看消費明細)/u;
const CATHAY_MERCHANT = new RegExp(String.raw `在\s*(?<merchant>[\s\S]*?)\s*(?<chargeEnding>${CATHAY_CHARGE_ENDING.source})`, "u");
const CATHAY_CHARGE = new RegExp(String.raw `^【(?<heading>[^】]{1,48})】\s*金額\s*(?<approximate>約\s*)?(?<money>[\s\S]*?)元\s*卡號末四碼\s*(?<cardLastFour>\d{4})\s*於\s*(?<notifiedAt>\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2})\s*${CATHAY_MERCHANT.source}(?<tail>[\s\S]{0,200})$`, "u");
const CATHAY_CHARGE_HEADING = /^(?:(?:國泰世華)?(?:信用卡)?(?:網路|線上|實體|門市)?(?:刷卡(?:消費)?|消費|交易)通知)$/u;
export const syntheticBankAProfile = {
    bankId: "bank-a",
    description: SYNTHETIC_DESCRIPTION,
    chargePattern: /^SYNTHETIC BANK A CHARGE \| (?<money>[^|]+) \| (?<occurredAt>[^|]*)$/,
    nonChargePattern: /^SYNTHETIC BANK A REFUND \|/,
};
export const syntheticBankBProfile = {
    bankId: "bank-b",
    description: SYNTHETIC_DESCRIPTION,
    chargePattern: /^SYNTHETIC BANK B CHARGE \| (?<money>[^|]+) \| (?<occurredAt>[^|]*)$/,
    nonChargePattern: /^SYNTHETIC BANK B REFUND \|/,
};
export const syntheticBankCProfile = {
    bankId: "bank-c",
    description: SYNTHETIC_DESCRIPTION,
    chargePattern: /^SYNTHETIC BANK C PAYMENT \| (?<money>[^|]+) \| (?<occurredAt>[^|]*)$/,
    nonChargePattern: /^SYNTHETIC BANK C REFUND \|/,
};
export function parseSyntheticBankACharge(notification) {
    return parseSyntheticCharge(syntheticBankAProfile, notification);
}
export function parseSyntheticBankBCharge(notification) {
    return parseSyntheticCharge(syntheticBankBProfile, notification);
}
export function parseSyntheticBankCCharge(notification) {
    return parseSyntheticCharge(syntheticBankCProfile, notification);
}
/** Parse Cathay United charge notices with an explicit amount, notification time and merchant. */
export function parseCathayUnitedCharge(notification) {
    if ([...notification].length > 400) {
        return { ok: false, reason: "malformed-notification" };
    }
    const normalizedNotification = normalizeBankSpacing(notification).replace(/\s+/gu, " ").trim();
    if (CATHAY_UNSUPPORTED_WORDS.test(normalizedNotification)) {
        return { ok: false, reason: "not-a-charge" };
    }
    const normalized = normalizeBankSpacing(notification.trim());
    const chargeText = normalized.split(CATHAY_CHARGE_ENDING, 1)[0] ?? normalizedNotification;
    const primaryAmountCount = chargeText.match(/(?<![\p{L}\p{N}])金額/gu)?.length ?? 0;
    const currencyTaggedAmountCount = chargeText.match(/(?:NT\$|[A-Z]{3}\s*\$?|[$￥¥€£])\s*\d[\d,]*(?:\.\d+)?/giu)?.length ?? 0;
    if (primaryAmountCount > 1 || currencyTaggedAmountCount > 1) {
        return { ok: false, reason: "ambiguous-amount" };
    }
    const match = CATHAY_CHARGE.exec(normalized);
    if (!match?.groups) {
        return { ok: false, reason: "malformed-notification" };
    }
    if (!CATHAY_CHARGE_HEADING.test(match.groups.heading ?? "")) {
        return { ok: false, reason: "malformed-notification" };
    }
    const money = match.groups.money;
    const notifiedAt = match.groups.notifiedAt;
    const merchant = match.groups.merchant ?? "";
    if (money === undefined || notifiedAt === undefined) {
        return { ok: false, reason: "malformed-notification" };
    }
    if (match.groups.chargeEnding === "刷卡，點擊查看消費明細" && !/^[\s。！？!?，,、；;：:.…⋯]*$/u.test(match.groups.tail ?? "")) {
        return { ok: false, reason: "malformed-notification" };
    }
    const merchantAmountCount = merchant.match(/(?<![\p{L}\p{N}])金額/gu)?.length ?? 0;
    const merchantTaggedAmountCount = merchant.match(/(?:NT\$|[A-Z]{3}\s*\$?|[$￥¥€£])\s*\d[\d,]*(?:\.\d+)?/giu)?.length ?? 0;
    if (merchantAmountCount > 0 || merchantTaggedAmountCount > 0) {
        return { ok: false, reason: "ambiguous-amount" };
    }
    if (CATHAY_MERCHANT_MONEY.test(merchant)) {
        return { ok: false, reason: "unsupported-currency" };
    }
    const moneyParts = /^(?<currency>[^\d\s]+)\s*(?<amount>.*)$/u.exec(money.trim());
    if (!moneyParts?.groups) {
        return { ok: false, reason: "invalid-amount" };
    }
    if (moneyParts.groups.currency !== "NT$") {
        return { ok: false, reason: "unsupported-currency" };
    }
    const amountText = moneyParts.groups.amount;
    if (amountText === undefined) {
        return { ok: false, reason: "invalid-amount" };
    }
    const amountMinor = parseCathayTwdMinorUnits(amountText);
    if (amountMinor === "out-of-range") {
        return { ok: false, reason: "amount-out-of-range" };
    }
    if (amountMinor === null) {
        return { ok: false, reason: "invalid-amount" };
    }
    const occurredAt = taiwanNotificationTimeToUtc(notifiedAt, cathayUnitedProfile.utcOffsetHours);
    if (occurredAt === null) {
        return { ok: false, reason: "invalid-time" };
    }
    return {
        ok: true,
        event: {
            schemaVersion: 1,
            bankId: cathayUnitedProfile.bankId,
            amountMinor,
            currency: "TWD",
            occurredAt,
            timeProvenance: "notification",
            ...(match.groups.approximate ? { approximateAmount: true } : {}),
            ...merchantField(merchant),
        },
    };
}
/** Parse the bounded Wallet text candidate. */
export function parseWalletCharge(notification, profile, capturedAt) {
    if (profile.currency !== "TWD") {
        return { ok: false, reason: "unsupported-currency" };
    }
    if (typeof notification !== "string" || typeof capturedAt !== "string") {
        return { ok: false, reason: "malformed-notification" };
    }
    if (/(?:退款|退刷|退貨|退货|取消|撤銷|撤销|作廢|作废|沖正|冲正|沖銷|冲销|撤回|分期|refund|return|cancel(?:led|ed|lation|ation)?|revers(?:al|ed)|declined|rejected|\bvoid\b|\binstallments?\b)/iu.test(notification)) {
        return { ok: false, reason: "not-a-charge" };
    }
    const taggedAmounts = notification.match(/(?:[A-Z]{1,3}\$|[$€£¥￥])\s*\d[\d,]*(?:\.\d+)?/giu) ?? [];
    if (taggedAmounts.length > 1) {
        return { ok: false, reason: "ambiguous-amount" };
    }
    if (/(?:[A-Z]{1,3}\$|[€£¥￥]|\b(?:USD|EUR|JPY|CNY|RMB|TWD|NTD|HKD|CAD|AUD|GBP|CHF)\b)/iu.test(notification)) {
        return { ok: false, reason: "unsupported-currency" };
    }
    const lines = notification.replace(/\r\n/gu, "\n").split("\n");
    if (lines.length < 1 || lines.length > 2 || lines.some((line) => line.length === 0)) {
        return { ok: false, reason: "malformed-notification" };
    }
    const amountLine = lines.at(-1);
    if (amountLine === undefined) {
        return { ok: false, reason: "malformed-notification" };
    }
    const amountMatch = /^\$(?<amount>(?:0|[1-9]\d{0,13})\.\d{2})$/u.exec(amountLine);
    if (!amountMatch?.groups?.amount) {
        return { ok: false, reason: "malformed-notification" };
    }
    const amountMinor = parseTwdMinorUnits(amountMatch.groups.amount);
    if (amountMinor === "out-of-range") {
        return { ok: false, reason: "amount-out-of-range" };
    }
    if (amountMinor === null) {
        return { ok: false, reason: "invalid-amount" };
    }
    const draft = {
        schemaVersion: 1,
        bankId: profile.bankId,
        amountMinor,
        currency: "TWD",
        occurredAt: capturedAt,
        timeProvenance: "capture",
        ...(lines.length === 2 ? merchantField(lines[0]) : {}),
    };
    try {
        validateLedgerEvent({ ...draft, id: "00000000-0000-4000-8000-000000000000" });
    }
    catch (error) {
        if (error instanceof LedgerEventValidationError && error.code === "invalid-time") {
            return { ok: false, reason: "invalid-time" };
        }
        if (error instanceof LedgerEventValidationError) {
            return { ok: false, reason: "malformed-notification" };
        }
        throw error;
    }
    return { ok: true, event: draft };
}
function merchantField(value) {
    const merchant = value?.trim();
    return merchant && [...merchant].length <= 80 && !/[\u0000-\u001f\u007f-\u009f]/u.test(merchant)
        ? { merchant } : {};
}
const YEARLESS_UNSAFE = /(?:退款|退刷|分期|取消|撤銷|撤销|作廢|作废|沖正|冲正|沖銷|冲销|撤回|cancel|refund|reversal|installment|金額\s+|\$|[¥€£]|\b(?:TWD|USD|HKD|JPY|EUR|CNY|RMB)\b|元|美元|日圓|歐元|港幣|人民幣)/iu;
const BANK_UNSUPPORTED_WORDS = /(?:退款|退刷|分期|取消|撤銷|撤销|作廢|作废|沖正|冲正|沖銷|冲销|撤回|cancel(?:led|ed|lation|ation)?|refund|revers(?:al|ed)|installments?)/iu;
const SECOND_AMOUNT_WORDING = /(?:第二\s*(?:筆|筆交易|個)?\s*(?:金額|交易|款項)?|另\s*(?:一筆|一個金額)|second\s+(?:amount|charge|transaction))/iu;
const DBS_MERCHANT = /在\s*(?<merchant>[\s\S]*?)交易。/u;
const FUBON_MERCHANT = /(?<merchant>[\s\S]*?)消費/u;
const DBS_CHARGE = new RegExp(String.raw `^【星展信用卡(?<heading>[^】]{0,32}交易)】\s*(?<approximate>約\s*)?NT\$\s*(?<amount>[1-9]\d{0,9}|[1-9]\d{0,2}(?:,\d{3}){1,3})元\s*信用卡號末四碼\s*\d{4}\s*於\s*(?<month>\d{2})月(?<day>\d{2})日\s*(?<hour>\d{2}):(?<minute>\d{2})\s*${DBS_MERCHANT.source}\s*$`, "u");
const FUBON_CHARGE = new RegExp(String.raw `^【(?<heading>[^】]{1,40})】\s*您的信用卡末四碼\s*\d{4}\s*於\s*(?<month>\d{2})\/(?<day>\d{2})\s*(?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2})\s*${FUBON_MERCHANT.source}\s*臺幣\s*(?<approximate>約\s*)?(?<amount>[1-9]\d{0,9}|[1-9]\d{0,2}(?:,\d{3}){1,3})\s*元\s*$`, "u");
/** Read only a stated descriptor, using the same merchant sub-patterns as the bank parsers. */
export function readBestEffortNotificationMerchant(bankId, ingestionSource, rawText) {
    if (typeof rawText !== "string" || rawText.length > 4096)
        return undefined;
    let candidates;
    if (ingestionSource === "wallet") {
        const lines = rawText.replace(/\r\n/gu, "\n").split("\n");
        candidates = lines.length === 2 ? [lines[0]] : [];
    }
    else {
        const pattern = bankId === "cathay-united" ? CATHAY_MERCHANT
            : bankId === "dbs-taiwan" ? DBS_MERCHANT
                : bankId === "taipei-fubon" ? new RegExp(String.raw `\d{2}:\d{2}:\d{2}\s*${FUBON_MERCHANT.source}`, "u") : undefined;
        if (!pattern)
            return undefined;
        candidates = [...normalizeBankSpacing(rawText).matchAll(new RegExp(pattern.source, "gu"))].map(match => match.groups?.merchant);
    }
    if (candidates.length !== 1)
        return undefined;
    const merchant = merchantField(candidates[0]).merchant;
    // Four consecutive digits may be a leaked card suffix; absence is safer than a guessed merchant.
    return merchant && !/\d{4}|(?:卡號|末四碼|末四位)/u.test(merchant) ? merchant : undefined;
}
/** Parse the observed yearless DBS notification using the device capture for its year. */
export function parseDbsCharge(notification, capturedAt) {
    return parseYearlessCharge(notification, capturedAt, DBS_CHARGE, "dbs-taiwan");
}
/** Parse the observed yearless Fubon notification using the device capture for its year. */
export function parseFubonCharge(notification, capturedAt) {
    return parseYearlessCharge(notification, capturedAt, FUBON_CHARGE, "taipei-fubon");
}
function parseYearlessCharge(notification, capturedAt, pattern, bankId) {
    if (typeof notification !== "string" || notification.length > 320) {
        return { ok: false, reason: "malformed-notification" };
    }
    const normalized = normalizeBankSpacing(notification);
    if (BANK_UNSUPPORTED_WORDS.test(normalized))
        return { ok: false, reason: "not-a-charge" };
    if (SECOND_AMOUNT_WORDING.test(normalized))
        return { ok: false, reason: "ambiguous-amount" };
    const match = pattern.exec(normalized);
    const groups = match?.groups;
    if (!groups)
        return { ok: false, reason: "malformed-notification" };
    if (bankId === "taipei-fubon" && !FUBON_CHARGE_HEADING.test(groups.heading ?? "")) {
        return { ok: false, reason: "not-a-charge" };
    }
    const merchant = groups.merchant ?? "";
    if (countExplicitAmountTokens(normalized) > 1)
        return { ok: false, reason: "ambiguous-amount" };
    if (YEARLESS_UNSAFE.test(merchant))
        return { ok: false, reason: "malformed-notification" };
    const amount = groups.amount?.replaceAll(",", "");
    if (!amount)
        return { ok: false, reason: "invalid-amount" };
    const amountMinor = Number(BigInt(amount) * 100n);
    if (!Number.isSafeInteger(amountMinor))
        return { ok: false, reason: "amount-out-of-range" };
    const capture = new Date(capturedAt);
    if (!Number.isFinite(capture.valueOf()) || capture.toISOString() !== capturedAt) {
        return { ok: false, reason: "invalid-time" };
    }
    const localCapture = new Date(capture.valueOf() + 8 * 60 * 60 * 1000);
    const month = Number(groups.month);
    const day = Number(groups.day);
    const hour = Number(groups.hour);
    const minute = Number(groups.minute);
    const second = Number(groups.second ?? "0");
    const year = localCapture.getUTCFullYear() - (month > localCapture.getUTCMonth() + 1 ? 1 : 0);
    if (year < 2000 || year > 2099 || month < 1 || month > 12 || day < 1 ||
        day > daysInMonth(year, month) || hour > 23 || minute > 59 || second > 59) {
        return { ok: false, reason: "invalid-time" };
    }
    const occurredAt = new Date(Date.UTC(year, month - 1, day, hour - 8, minute, second)).toISOString();
    return { ok: true, event: { schemaVersion: 1, bankId, amountMinor, currency: "TWD",
            occurredAt, timeProvenance: "notification",
            ...(groups.approximate ? { approximateAmount: true } : {}), ...merchantField(merchant) } };
}
const FUBON_CHARGE_HEADING = /^(?=[^】]*(?:刷卡|消費|消费))[^】]*通知$/u;
const ONE_TIME_CODE_WORDS = /(?:驗證碼|認證碼|(?<![A-Za-z])OTP(?![A-Za-z])|動態密碼|一次性密碼|交易密碼)/iu;
const AMOUNT_NUMBER = String.raw `(?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)(?:\.\d+)?`;
const CURRENCY_TOKEN = String.raw `(?:NT\$|US\$|TWD|NTD|USD|JPY|KWD|EUR|HKD|CNY|RMB|CAD|AUD|GBP|CHF|€|£|¥|￥)`;
const EXPLICIT_CURRENCY_AMOUNT = new RegExp(String.raw `(?<![\p{L}\p{N}])(?:(?<prefixCurrency>${CURRENCY_TOKEN})\s*(?<prefixAmount>${AMOUNT_NUMBER})(?![\d,.])(?:元|圓|円)?(?![\p{L}\p{N}])|(?<suffixAmount>${AMOUNT_NUMBER})(?![\d,.])\s*(?<suffixCurrency>${CURRENCY_TOKEN})(?![\p{L}\p{N}]))`, "giu");
/** True when a rejected body must be discarded before fallback or unrecorded retention. */
export function shouldDropNotification(notification) {
    if (typeof notification !== "string" || ONE_TIME_CODE_WORDS.test(notification))
        return true;
    return !hasAmountLikeValue(notification);
}
/** Keep parser acceptance separate from the policy for retaining rejected notification text. */
export function classifyNotificationParse(notification, parsed) {
    if (parsed.ok)
        return { status: "parsed", event: parsed.event };
    if (shouldDropNotification(notification))
        return { status: "drop" };
    return { status: "rejected-but-keep", reason: parsed.reason };
}
/** Read one explicit, supported currency amount from rejected text; ambiguity stays absent. */
export function readBestEffortNotificationAmount(notification) {
    const matches = explicitCurrencyAmounts(notification);
    if (matches.length !== 1)
        return undefined;
    const [match] = matches;
    if (!match)
        return undefined;
    const rawCurrency = match.currency.toUpperCase();
    const currencyValue = rawCurrency === "NT$" || rawCurrency === "NTD"
        ? "TWD"
        : rawCurrency === "US$" ? "USD" : rawCurrency;
    if (!isCurrencyCode(currencyValue))
        return undefined;
    try {
        const amountMinor = decimalToMinor(match.amount.replaceAll(",", ""), currencyValue);
        return amountMinor > 0 ? { amountMinor, currency: currencyValue } : undefined;
    }
    catch {
        return undefined;
    }
}
function explicitCurrencyAmounts(notification) {
    const matcher = new RegExp(EXPLICIT_CURRENCY_AMOUNT.source, EXPLICIT_CURRENCY_AMOUNT.flags);
    return [...notification.matchAll(matcher)].map((match) => ({
        currency: match.groups?.prefixCurrency ?? match.groups?.suffixCurrency ?? "",
        amount: match.groups?.prefixAmount ?? match.groups?.suffixAmount ?? "",
    }));
}
function countExplicitAmountTokens(notification) {
    return explicitCurrencyAmounts(notification).length;
}
function hasAmountLikeValue(notification) {
    if (countExplicitAmountTokens(notification) > 0)
        return true;
    const residual = normalizeBankSpacing(notification)
        .replace(/20\d{2}[/-]\d{1,2}[/-]\d{1,2}(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?/gu, " ")
        .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/gu, " ")
        .replace(/\d{1,2}月\d{1,2}日/gu, " ")
        .replace(/(?:信用卡)?(?:號|末四碼|末四位)\s*\d{4}/gu, " ");
    return /\d/u.test(residual);
}
function normalizeBankSpacing(notification) {
    return notification.replace(/[\u00a0\u2000-\u200a\u202f\u205f\u3000]/gu, " ");
}
function parseCathayTwdMinorUnits(amountText) {
    const match = /^(?<whole>0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)$/u.exec(amountText);
    const wholeText = match?.groups?.whole;
    if (wholeText === undefined) {
        return null;
    }
    const whole = wholeText.replaceAll(",", "");
    if (whole.length > 14) {
        return "out-of-range";
    }
    const amountMinor = BigInt(whole) * BigInt(TWD_MINOR_UNITS_PER_UNIT);
    if (amountMinor === 0n) {
        return null;
    }
    if (amountMinor > BigInt(Number.MAX_SAFE_INTEGER)) {
        return "out-of-range";
    }
    return Number(amountMinor);
}
function taiwanNotificationTimeToUtc(value, utcOffsetHours) {
    const normalized = value.replace(/\s+/gu, " ").trim();
    const match = /^(?<year>\d{4})\/(?<month>\d{2})\/(?<day>\d{2}) (?<hour>\d{2}):(?<minute>\d{2})$/u.exec(normalized);
    if (!match?.groups) {
        return null;
    }
    const year = Number(match.groups.year);
    const month = Number(match.groups.month);
    const day = Number(match.groups.day);
    const hour = Number(match.groups.hour);
    const minute = Number(match.groups.minute);
    if (year < 1 || year > 9999 ||
        month < 1 || month > 12 ||
        day < 1 || day > daysInMonth(year, month) ||
        hour > 23 || minute > 59) {
        return null;
    }
    // Interpret the notification clock as UTC+08:00 explicitly; host timezone is never consulted.
    const localClockAsUtc = new Date(0);
    localClockAsUtc.setUTCFullYear(year, month - 1, day);
    localClockAsUtc.setUTCHours(hour, minute, 0, 0);
    const utc = new Date(localClockAsUtc.getTime() - utcOffsetHours * 60 * 60 * 1000);
    const utcYear = utc.getUTCFullYear();
    if (utcYear < 1 || utcYear > 9999) {
        return null;
    }
    return `${String(utcYear).padStart(4, "0")}-${String(utc.getUTCMonth() + 1).padStart(2, "0")}-${String(utc.getUTCDate()).padStart(2, "0")}T${String(utc.getUTCHours()).padStart(2, "0")}:${String(utc.getUTCMinutes()).padStart(2, "0")}:00.000Z`;
}
function daysInMonth(year, month) {
    if (month === 2) {
        return isLeapYear(year) ? 29 : 28;
    }
    return [4, 6, 9, 11].includes(month) ? 30 : 31;
}
function isLeapYear(year) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}
function parseSyntheticCharge(profile, notification) {
    const match = profile.chargePattern.exec(notification);
    if (!match?.groups) {
        if (profile.nonChargePattern.test(notification)) {
            return { ok: false, reason: "not-a-charge" };
        }
        return { ok: false, reason: "malformed-notification" };
    }
    const money = match.groups.money?.trim();
    const occurredAt = match.groups.occurredAt?.trim();
    if (!money || occurredAt === undefined) {
        return { ok: false, reason: "malformed-notification" };
    }
    const moneyParts = /^(?<currency>[A-Z]{3}) (?<amount>.+)$/.exec(money);
    if (!moneyParts?.groups) {
        return { ok: false, reason: "malformed-notification" };
    }
    if (moneyParts.groups.currency !== "TWD") {
        return { ok: false, reason: "unsupported-currency" };
    }
    const amountText = moneyParts.groups.amount;
    if (amountText === undefined) {
        return { ok: false, reason: "malformed-notification" };
    }
    if ((amountText.match(/TWD\s/g) ?? []).length > 0) {
        return { ok: false, reason: "ambiguous-amount" };
    }
    const amountMinor = parseTwdMinorUnits(amountText);
    if (amountMinor === "out-of-range") {
        return { ok: false, reason: "amount-out-of-range" };
    }
    if (amountMinor === null) {
        return { ok: false, reason: "invalid-amount" };
    }
    if ((occurredAt.match(/TWD\s/g) ?? []).length > 0) {
        return { ok: false, reason: "ambiguous-amount" };
    }
    try {
        const event = validateLedgerEvent({
            schemaVersion: 1,
            id: "00000000-0000-4000-8000-000000000000",
            bankId: profile.bankId,
            amountMinor,
            currency: "TWD",
            occurredAt,
            timeProvenance: "notification",
        });
        const { id: _id, ...draft } = event;
        return { ok: true, event: draft };
    }
    catch (error) {
        if (error instanceof LedgerEventValidationError && error.code === "invalid-time") {
            return { ok: false, reason: "invalid-time" };
        }
        throw error;
    }
}
function parseTwdMinorUnits(amountText) {
    const amountMatch = /^(?<whole>0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)(?:\.(?<fraction>\d{1,2}))?$/.exec(amountText);
    if (!amountMatch?.groups) {
        return null;
    }
    const wholeText = amountMatch.groups.whole;
    if (wholeText === undefined) {
        return null;
    }
    const whole = wholeText.replaceAll(",", "");
    if (whole.length > 14) {
        return "out-of-range";
    }
    const fraction = (amountMatch.groups.fraction ?? "").padEnd(2, "0");
    const amountMinorBigInt = BigInt(whole) * BigInt(TWD_MINOR_UNITS_PER_UNIT) + BigInt(fraction || "0");
    if (amountMinorBigInt === 0n) {
        return null;
    }
    if (amountMinorBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
        return "out-of-range";
    }
    return Number(amountMinorBigInt);
}
