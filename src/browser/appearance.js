const key = "ledgernook.viewer.appearance.v1";
/** Device preference only. No connection or ledger data enters this store. */
export function installAppearanceSetting() {
    const system = matchMedia("(prefers-color-scheme: dark)");
    let appearance = "system";
    try {
        const saved = localStorage.getItem(key);
        if (saved === "light" || saved === "dark")
            appearance = saved;
    }
    catch { /* Storage denial keeps the preference in this session. */ }
    const apply = () => {
        document.documentElement.dataset.appearance = appearance;
        const color = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
        if (color)
            document.querySelector('meta[name="theme-color"]')?.setAttribute("content", color);
    };
    apply();
    system.addEventListener("change", apply);
    return {
        get: () => appearance,
        set(value) {
            appearance = value;
            try {
                localStorage.setItem(key, value);
            }
            catch { /* Session-only fallback. */ }
            apply();
        },
        dispose() { system.removeEventListener("change", apply); },
    };
}
