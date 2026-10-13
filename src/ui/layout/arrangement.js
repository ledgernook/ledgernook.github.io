import { el } from "../dom.js";
/** Hosts existing feature nodes; only this layer decides when to split them. */
export class ArrangementHost {
    element;
    primary = el("div", undefined, "lk-layout-primary");
    secondary = el("div", undefined, "lk-layout-secondary");
    #view;
    #arrangement;
    #split;
    constructor(element) {
        this.element = element;
    }
    get content() { return this.#split ? this.primary : this.element; }
    get rightEmpty() { return this.#arrangement !== undefined && !this.#arrangement.parts?.secondary.length; }
    get kind() { return this.#arrangement?.kind ?? "single"; }
    get pageId() { return this.#split ? this.#arrangement?.navigation?.pageId ?? null : null; }
    get recordId() { return this.#split ? this.#arrangement?.recordId : undefined; }
    show(view, arrangement, layout) {
        this.#view = view;
        this.#arrangement = arrangement;
        this.element.replaceChildren(view.element);
        this.#split = undefined;
        this.place(layout);
    }
    place(layout) {
        const split = layout === "regular" && this.#arrangement !== undefined;
        this.element.setAttribute("data-arrangement", layout === "phone" ? "single" : this.kind);
        this.element.setAttribute("data-split", String(split));
        for (const part of this.#arrangement?.parts?.secondary ?? []) {
            for (const back of part.querySelectorAll(".lk-page-back"))
                back.hidden = split && this.#arrangement?.navigation !== undefined;
        }
        if (!this.#view || split === this.#split)
            return;
        const parts = this.#arrangement?.parts;
        if (split) {
            // Notices prepended by the coordinator remain first in the primary column.
            const notices = [...this.element.children].filter(node => node !== this.#view.element);
            this.primary.replaceChildren(...notices, ...(parts?.primary ?? [this.#view.element]));
            this.secondary.replaceChildren(...(parts?.secondary ?? []));
            if (parts) {
                // Retain the feature root for delegated events and queries across its parts.
                this.#view.element.setAttribute("data-layout-parts", "true");
                this.#view.element.replaceChildren(this.primary, this.secondary);
                this.element.replaceChildren(this.#view.element);
            }
            else
                this.element.replaceChildren(this.primary, this.secondary);
        }
        else {
            const primaryParts = parts?.primary ?? [this.#view.element];
            const notices = this.#split ? [...this.primary.children].filter(node => !primaryParts.includes(node)) : [];
            if (parts) {
                this.#view.element.removeAttribute("data-layout-parts");
                const navigation = this.#arrangement?.navigation;
                this.#view.element.replaceChildren(...(navigation ? navigation.pageId === null ? parts.primary : parts.secondary : [...parts.primary, ...parts.secondary]));
            }
            this.element.replaceChildren(...notices, this.#view.element);
        }
        this.#split = split;
        const selectDefault = this.#arrangement?.navigation?.selectDefault;
        if (split && selectDefault && !parts?.secondary.length) {
            const view = this.#view;
            queueMicrotask(() => { if (this.#view === view && this.#split)
                selectDefault(); });
        }
    }
}
/** Existing views keep their content and events; arrangement owns their placement. */
export function pageColumns(primary, secondary, navigation) {
    const element = el("div");
    element.append(primary.element, ...(secondary ? [secondary.element] : []));
    return { view: { element, dispose() { primary.dispose?.(); secondary?.dispose?.(); } },
        arrangement: { kind: "columns", parts: { primary: [primary.element], secondary: secondary ? [secondary.element] : [] }, navigation } };
}
