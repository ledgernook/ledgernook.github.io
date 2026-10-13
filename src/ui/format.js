import { minorToDecimal } from "../core/index.js";
export function formatTwd(amountMinor) {
    const whole = BigInt(amountMinor) / 100n;
    const fraction = BigInt(amountMinor) % 100n;
    return `NT$ ${new Intl.NumberFormat("zh-TW").format(whole)}${fraction === 0n ? "" : `.${fraction.toString().padStart(2, "0")}`}`;
}
/** TWD keeps its existing display; other registry currencies show code plus exact decimal. */
export function formatMoney(amountMinor, currency) {
    return currency === "TWD" ? formatTwd(amountMinor) : `${currency} ${minorToDecimal(amountMinor, currency)}`;
}
