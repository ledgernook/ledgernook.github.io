import { el } from "./dom.js";
export function icon(name, size = 20, filled = false) {
    const node = el("span", name, "lk-icon");
    node.setAttribute("aria-hidden", "true");
    node.style.fontSize = `${size}px`;
    node.style.fontVariationSettings = `'FILL' ${filled ? 1 : 0}, 'wght' 400, 'opsz' ${Math.max(20, Math.min(48, size))}, 'GRAD' 0`;
    return node;
}
export function iconButton(name, label, run, size = 20) {
    const button = el("button", undefined, "lk-icon-button");
    button.type = "button";
    button.setAttribute("aria-label", label);
    button.append(icon(name, size));
    button.addEventListener("click", run);
    return button;
}
/** Exact Material Symbols check at the design's wght 600 / opsz 44; the shared offline font is fixed at 400. */
export function saveCheckIcon() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "44");
    svg.setAttribute("height", "44");
    svg.setAttribute("viewBox", "0 0 960 960");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("fill", "currentColor");
    path.setAttribute("transform", "translate(0 960) scale(1 -1)");
    path.setAttribute("d", "M378.667 351.117 729.847 701.826Q742.362 714.341 759.920 714.341Q777.478 714.341 789.993 701.826Q802.508 689.312 802.508 671.717Q802.508 654.123 789.993 641.608L408.559 260.572Q396.044 248.057 378.667 248.057Q361.290 248.057 348.775 260.572L169.572 439.775Q157.057 452.289 157.275 469.884Q157.492 487.479 170.007 499.993Q182.522 512.508 200.116 512.508Q217.711 512.508 230.226 499.993Z");
    svg.append(path);
    return svg;
}
