import { el } from "../dom.js";
import { svgNode } from "../view.js";
/** Category colors come from stored or read-resolved 1-based main-category slots. */
export function categoryColor(slot) {
    if (slot === null)
        return "var(--c-none)";
    if (!Number.isInteger(slot) || slot < 1 || slot > 16)
        throw new RangeError("Category color slot is out of range");
    return `var(--cat-${slot})`;
}
let artId = 0;
const point = (p) => p.map(v => v.toFixed(2)).join(" ");
const lerp = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
const distance = (p, q) => Math.hypot(q[0] - p[0], q[1] - p[1]);
function homeIcon(filled, size = 26) {
    const cx = 12, cy = 16.3, rx = 4.8, ry = 3.6;
    const ey = (x) => cy - ry * Math.sqrt(Math.max(0, 1 - ((x - cx) / rx) ** 2));
    const ear = (flip) => {
        const m = (p) => flip ? [24 - p[0], p[1]] : p;
        return `M${point(m([7.9, ey(7.9)]))}L${point(m([8.55, 12.3]))}L${point(m([10.1, ey(10.1)]))}Z`;
    };
    const cat = `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0Z${ear(false)}${ear(true)}`;
    const arch = "M4.2 11.8a7.8 7.8 0 0 1 15.6 0V19.7a1.3 1.3 0 0 1-1.3 1.3H5.5a1.3 1.3 0 0 1-1.3-1.3Z";
    const svg = svgNode("svg", { width: size, height: size, viewBox: "0 0 24 24", "aria-hidden": "true" });
    if (!filled)
        svg.append(svgNode("path", { d: arch, fill: "none", stroke: "currentColor", "stroke-width": 2, "stroke-linejoin": "round" }), svgNode("path", { d: cat, fill: "currentColor", stroke: "currentColor", "stroke-width": .9, "stroke-linejoin": "round" }));
    else {
        const id = `nkti${++artId}`;
        svg.append(svgNode("defs", {}, svgNode("mask", { id, maskUnits: "userSpaceOnUse", x: 0, y: 0, width: 24, height: 24 }, svgNode("path", { d: arch, fill: "#fff", stroke: "#fff", "stroke-width": 2, "stroke-linejoin": "round" }), svgNode("path", { d: cat, fill: "#000", stroke: "#000", "stroke-width": .9, "stroke-linejoin": "round" }))), svgNode("rect", { x: 0, y: 0, width: 24, height: 24, fill: "currentColor", mask: `url(#${id})` }));
    }
    return svg;
}
/** Connected ears (variant A), with the source's rounded tips and gradient. */
function ears() {
    const id = `nkg${++artId}`;
    const polar = (r, deg) => [36 + r * Math.sin(deg * Math.PI / 180), 36 - r * Math.cos(deg * Math.PI / 180)];
    const path = (flip, inner) => {
        const m = (p) => point(flip ? [72 - p[0], p[1]] : p);
        const base = inner ? 35 : 31, tip = [9.5, -3.5];
        const a = polar(base, inner ? -58 : -67), b = polar(base, inner ? -29 : -20);
        const center = [(a[0] + b[0] + tip[0]) / 3, (a[1] + b[1] + tip[1]) / 3];
        const t = inner ? lerp(tip, center, .38) : tip, radius = inner ? 3.5 : 8;
        return `M ${m(a)} L ${m(lerp(t, a, radius / distance(t, a)))} Q ${m(t)} ${m(lerp(t, b, radius / distance(t, b)))} L ${m(b)} Z`;
    };
    return svgNode("svg", { width: 72, height: 78, viewBox: "0 -20 72 78", class: "nk-ears", "aria-hidden": "true" }, svgNode("defs", {}, svgNode("radialGradient", { id, gradientUnits: "userSpaceOnUse", cx: 27.36, cy: 18.56, r: 59.57 }, svgNode("stop", { offset: 0, "stop-color": "var(--cat-core)" }), svgNode("stop", { offset: .4, "stop-color": "var(--cat-core)" }), svgNode("stop", { offset: 1, "stop-color": "var(--cat-rim)" }))), ...[false, true].map(flip => svgNode("path", { d: path(flip, false), fill: `url(#${id})`, stroke: `url(#${id})`, "stroke-width": 2.4, "stroke-linejoin": "round" })), ...[false, true].map(flip => svgNode("path", { d: path(flip, true), fill: "oklch(0.84 0.07 25)", opacity: .55 })));
}
function companion(state, { scale = .72 } = {}) {
    const frame = el("div", undefined, "nk-companion");
    frame.setAttribute("data-state", state);
    frame.style.width = `${72 * scale}px`;
    frame.style.height = `${60 * scale}px`;
    const scaled = el("div", undefined, "nk-scaled");
    scaled.style.transform = `scale(${scale})`;
    const shadow = el("div", undefined, "nk-shadow");
    const motion = el("div", undefined, "nk-motion");
    const glow = el("div", undefined, "nk-glow");
    const body = el("div", undefined, "nk-body");
    for (const side of ["left", "right"]) {
        const eye = el("div", undefined, `nk-eye nk-eye-${side}`);
        eye.append(el("div", undefined, "nk-eye-blink"));
        body.append(eye, el("div", undefined, `nk-cheek nk-cheek-${side}`));
    }
    glow.append(ears(), body);
    motion.append(glow);
    scaled.append(shadow, motion);
    const fx = el("div", undefined, "nk-effects");
    if (state === "rummage") {
        // Outline of the source's WenKai 700 question glyph; art contains no text node.
        const question = svgNode("svg", { width: 16, height: 26, viewBox: "0 0 800 1300", class: "nk-question" }, svgNode("path", { transform: "translate(0 1032) scale(1 -1)", fill: "currentColor",
            d: "M298 162Q261 162 254 181Q247 200 247 224Q247 247 252 281.5Q257 316 279 345.5Q301 375 328.5 399Q356 423 383 446Q443 500 443 568Q443 602 421.5 625Q400 648 353 648Q304 648 263.5 629.5Q223 611 198 585.5Q173 560 161 517Q155 500 137 500Q120 500 102 515Q84 530 84 544Q84 556 87 560Q177 719 350 719Q434 719 481 680.5Q528 642 528 581Q528 521 508 483Q480 430 402 369Q372 346 349 318.5Q326 291 326 254Q326 225 336 185Q336 162 298 162ZM294 -15Q267 -15 249.5 6Q232 27 232 51Q232 74 246.5 90.5Q261 107 287 107Q313 107 331 84.5Q349 62 349 39Q349 -15 294 -15Z" }));
        fx.append(question);
    }
    if (state === "attention")
        fx.append(el("div", undefined, "nk-ring"));
    if (["happy", "wait", "sleep"].includes(state)) {
        for (let i = 0; i < 3; i++) {
            const dot = el("div", undefined, "nk-particle");
            dot.style.setProperty("--particle", String(i));
            fx.append(dot);
        }
    }
    scaled.append(fx);
    frame.append(scaled);
    return frame;
}
function scene(art, { large = false, trip = false } = {}) {
    const frame = el("div", undefined, "nk-scene");
    frame.setAttribute("data-size", large ? "large" : "small");
    frame.setAttribute("data-trip", String(trip));
    const nook = el("div", undefined, "nk-nook");
    const occupant = el("div", undefined, "nk-occupant");
    occupant.append(art);
    if (trip) {
        const bag = el("div", undefined, "nk-suitcase");
        bag.setAttribute("aria-hidden", "true");
        bag.append(el("div", undefined, "nk-suitcase-handle"));
        occupant.append(bag);
    }
    // The frozen source uses a plain arch/floor; --win/--frame remain available skin tokens.
    nook.append(el("div", undefined, "nk-floor"), occupant);
    frame.append(nook);
    return frame;
}
export const nook = {
    id: "nook",
    icons: { home: "cottage", list: "receipt_long", add: "add", proj: "luggage", report: "donut_small", settings: "settings" },
    tabIcon: (id, filled, size) => id === "home" ? homeIcon(filled, size) : null,
    companion,
    scene,
};
