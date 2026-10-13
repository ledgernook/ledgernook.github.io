import { CURRENCIES } from "../core/index.js";
export function currencyChoices() {
    let names;
    try {
        names = new Intl.DisplayNames(["zh-Hant-TW"], { type: "currency" });
    }
    catch { /* Codes remain usable without Intl currency names. */ }
    return Object.keys(CURRENCIES).sort().map(code => {
        let name = code;
        try {
            name = names?.of(code) ?? code;
        }
        catch { /* An unavailable name falls back to its code. */ }
        return { code, name };
    });
}
export function filterCurrencyChoices(choices, query) {
    const term = query.trim().toLocaleLowerCase("zh-Hant-TW");
    return choices.filter(choice => choice.code.toLowerCase().includes(term) || choice.name.toLocaleLowerCase("zh-Hant-TW").includes(term));
}
