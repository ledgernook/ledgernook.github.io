import { el } from "./dom.js";
import { icon, iconButton } from "./icons.js";
import { button } from "./shared-controls.js";
export function tripSheetView(projects, trip, actions) {
    const header = el("div", undefined, "lk-sheet-header lk-trip-sheet-header");
    const luggage = icon("luggage", 22);
    luggage.style.color = "var(--acc)";
    header.append(luggage, el("h2", "旅行中", "lk-sheet-title"), iconButton("close", "關閉", actions.close));
    const element = el("div", undefined, "lk-trip-sheet");
    const projectChoices = el("div", undefined, "lk-chip-wrap");
    for (const project of projects.filter(item => !item.archived)) {
        const choice = button(project.label, () => actions.change({ projectId: project.id }), "lk-chip");
        choice.setAttribute("aria-pressed", String(project.id === trip.projectId));
        projectChoices.append(choice);
    }
    const currencyChoices = el("div", undefined, "lk-chip-wrap");
    const currency = button(trip.currency, actions.currency, "lk-chip lk-number");
    currency.setAttribute("aria-label", "旅行幣別");
    currency.setAttribute("aria-pressed", "true");
    currencyChoices.append(currency);
    const end = button("結束旅行", actions.end, "lk-trip-sheet-end");
    element.append(projectChoices, currencyChoices, end);
    return { view: { element }, header };
}
