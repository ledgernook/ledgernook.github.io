/** Screen geometry keeps a landscape phone in the phone arrangement. */
export function widthClass(windowWidth, screenShortSide) {
    if (screenShortSide < 600 || windowWidth < 600)
        return "phone";
    if (windowWidth < 754)
        return "narrow";
    return windowWidth < 900 ? "compact" : "regular";
}
/** Recent-row density follows the Overview's available layout class. */
export function overviewRecentLimit(layout) {
    return layout === "regular" ? 12 : layout === "phone" ? 6 : 8;
}
/** Overview uses the existing large Nook scene on every iPad layout class. */
export function overviewSceneSize(layout) {
    return layout === "phone" ? "small" : "large";
}
export function presentationFor(layout, origin, rightEmpty = false) {
    if (layout === "regular")
        return origin === "left" || (origin !== "top" && rightEmpty) ? "panel" : "drawer";
    return layout === "compact" ? "drawer" : "sheet";
}
export function drawerWidth(windowWidth) {
    return Math.max(320, Math.min(400, windowWidth - 434));
}
/** Standalone connection screens share the shell's window/screen classification. */
export function observeWidthClass(element) {
    const resize = () => element.setAttribute("data-layout", widthClass(window.innerWidth ?? 390, window.screen ? Math.min(window.screen.width, window.screen.height) : 390));
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
}
