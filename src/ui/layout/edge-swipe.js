import { el } from "../dom.js";
export const EDGE_SWIPE_ZONE = 20, EDGE_SWIPE_SLOP = 10;
export function edgeSwipeClaim(dx, dy) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) < EDGE_SWIPE_SLOP)
        return "pending";
    return dx > 0 && dx > Math.abs(dy) * 1.5 ? "claim" : "release";
}
export function shouldPopPage(dx, width, velocity) {
    return dx > width / 3 || dx >= 24 && velocity >= 0.5;
}
export function edgeParallaxOffset(dx, width) {
    return -0.3 * width * (1 - Math.min(1, Math.max(0, dx) / width));
}
/** Focus eligibility is shared by phone pages, pushed panes and connection steps. */
export function edgeSwipeDisabled(root, sheetsOpen, active = document.activeElement) {
    const editingInput = active instanceof HTMLElement && active.tagName.toUpperCase() === "INPUT" &&
        !["checkbox", "radio", "range", "button", "submit", "reset", "image", "hidden"].includes(active.type);
    return sheetsOpen || !!root.querySelector(".lk-methods-reordering") ||
        editingInput || active instanceof HTMLElement && (active.isContentEditable ||
        ["TEXTAREA", "SELECT"].includes(active.tagName.toUpperCase()) || !!active.closest('[contenteditable="true"], [contenteditable=""]'));
}
function backButton(host) {
    return [...host.querySelectorAll(".lk-edge-back")].find(button => {
        if (button.disabled || button.hidden || button.closest('[hidden], [inert], [aria-hidden="true"]'))
            return false;
        const css = getComputedStyle(button), box = button.getBoundingClientRect();
        return css.display !== "none" && css.visibility === "visible" && box.width > 0 && box.height > 0;
    }) ?? null;
}
function horizontalScrollBlocks(target, host) {
    for (let node = target; node; node = node.parentElement) {
        if (node.scrollWidth > node.clientWidth && /auto|scroll/.test(getComputedStyle(node).overflowX) && node.scrollLeft > 0)
            return true;
        if (node === host)
            break;
    }
    return false;
}
function snapshot(host, scrolled) {
    const element = document.createElement("div");
    element.className = host.className;
    for (const name of host.getAttributeNames()) {
        if (name === "class" || name === "id" || name === "role" || name === "data-edge-swipe-state")
            continue;
        const value = host.getAttribute(name);
        if (value !== null)
            element.setAttribute(name, value);
    }
    element.append(...Array.from(host.childNodes, child => child.cloneNode(true)));
    element.inert = true;
    element.setAttribute("aria-hidden", "true");
    element.classList.add("lk-edge-snapshot");
    const originals = [host, ...host.querySelectorAll("*")];
    const copies = [element, ...element.querySelectorAll("*")];
    const scroll = [], sourceCopies = new WeakMap();
    for (let index = 0; index < copies.length; index++) {
        const node = copies[index], source = originals[index];
        // A static underlay must not create duplicate IDs or restart companion motion.
        node.removeAttribute("id");
        sourceCopies.set(source, node);
        if (scrolled.has(source)) {
            const top = source.scrollTop, left = source.scrollLeft;
            if (top !== 0 || left !== 0) {
                node.scrollTop = top;
                node.scrollLeft = left;
                scroll.push({ node, top, left, source });
            }
        }
    }
    return { element, scroll, sourceCopies };
}
/** Touch Events, with early cancellation of only eligible rightward moves, retain
 * vertical native scrolling on WebKit without giving up the edge to its scroll latch. */
export function attachEdgeSwipe(host, root, previous, enabled) {
    let drag = null;
    let layer = null, underlay = null, dim = null;
    let saved = null;
    let finishing = null, timer;
    let suppressClickUntil = 0;
    let outsideHost = false;
    const reset = () => {
        drag = null;
        finishing = null;
        outsideHost = false;
        clearTimeout(timer);
        timer = undefined;
        layer?.remove();
        layer = underlay = dim = null;
        if (saved) {
            Object.assign(host.style, saved);
            saved = null;
        }
        host.removeAttribute("data-edge-swipe-state");
    };
    const paint = (dx, width) => {
        const offset = Math.max(0, dx);
        host.style.transform = `translateX(${offset}px)`;
        // Clip a translated pane at its original right boundary, including during pop.
        host.style.clipPath = `inset(0px ${offset}px 0px -24px)`;
        if (underlay)
            underlay.style.transform = `translateX(${edgeParallaxOffset(offset, width)}px)`;
        if (dim)
            dim.style.opacity = String(0.1 * (1 - Math.min(1, offset / width)));
    };
    const mountUnderlay = () => {
        const bounds = host.getBoundingClientRect(), parent = root.getBoundingClientRect();
        layer = el("div", undefined, "lk-edge-underlay");
        layer.inert = true;
        layer.setAttribute("aria-hidden", "true");
        Object.assign(layer.style, { left: `${bounds.left - parent.left}px`, top: `${bounds.top - parent.top}px`,
            width: `${bounds.width}px`, height: `${bounds.height}px` });
        const copy = previous();
        if (copy) {
            underlay = copy.element;
            underlay.classList.add("lk-edge-snapshot");
            layer.append(underlay);
        }
        dim = el("div", undefined, "lk-edge-dim");
        layer.append(dim);
        root.append(layer);
        for (const position of copy?.scroll ?? []) {
            position.node.scrollTop = position.top;
            position.node.scrollLeft = position.left;
        }
        saved = { transform: host.style.transform, clipPath: host.style.clipPath, position: host.style.position,
            zIndex: host.style.zIndex, boxShadow: host.style.boxShadow, backgroundColor: host.style.backgroundColor };
        host.style.position = "relative";
        host.style.zIndex = "2";
        host.style.backgroundColor = "var(--bg)";
        host.style.boxShadow = "-8px 0 20px -10px rgba(0,0,0,.25)";
    };
    const settle = (commit) => {
        const active = drag;
        drag = null;
        const done = () => {
            if (!finishing)
                return;
            finishing = null;
            clearTimeout(timer);
            if (commit && enabled() && backButton(host) === active.back) {
                // Click is the single owner of feature navigation, busy guards and side effects.
                active.back.click();
                // Async routes can keep the departed page offscreen until their real page mounts.
                if (saved)
                    timer = setTimeout(reset, 500);
            }
            else
                reset();
        };
        finishing = done;
        if (active.reduced) {
            done();
            reset();
            return;
        }
        host.setAttribute("data-edge-swipe-state", commit ? "committing" : "returning");
        layer?.setAttribute("data-edge-swipe-state", "settling");
        paint(commit ? active.width : 0, active.width);
        // A transitionend is not guaranteed (hidden app, zero-duration custom skin).
        const durations = getComputedStyle(host).transitionDuration.split(",").map(value => parseFloat(value) * (value.trim().endsWith("ms") ? 1 : 1000));
        timer = setTimeout(done, Math.max(0, ...durations) + 50);
    };
    const start = (event) => {
        if (finishing || saved)
            return;
        suppressClickUntil = 0;
        if (!enabled() || event.touches.length !== 1)
            return;
        const back = backButton(host), touch = event.touches[0];
        const bounds = host.getBoundingClientRect();
        const edge = root.getAttribute("data-layout") === "phone" ? 0 : bounds.left;
        let target = event.target;
        while (target && !(target instanceof HTMLElement))
            target = target.parentElement;
        if (!back || !bounds.width || !(target instanceof HTMLElement) || touch.clientX < edge ||
            touch.clientX - edge > EDGE_SWIPE_ZONE || horizontalScrollBlocks(target, host))
            return;
        drag = { id: touch.identifier, x: touch.clientX, y: touch.clientY, width: bounds.width, back, claimed: false,
            reduced: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
            distance: 0, samples: [{ x: touch.clientX, time: event.timeStamp }] };
    };
    const move = (event) => {
        if (!drag)
            return;
        if (!enabled() || event.touches.length !== 1) {
            if (drag.claimed)
                settle(false);
            else
                drag = null;
            return;
        }
        const touch = [...event.touches].find(touch => touch.identifier === drag.id);
        if (!touch)
            return;
        const dx = touch.clientX - drag.x, dy = touch.clientY - drag.y;
        if (!drag.claimed) {
            const decision = edgeSwipeClaim(dx, dy);
            if (decision === "pending") {
                if (dx > 0 && dx > Math.abs(dy) * 1.5 && event.cancelable)
                    event.preventDefault();
                return;
            }
            if (decision === "release" || !event.cancelable) {
                drag = null;
                return;
            }
            drag.claimed = true;
            if (!drag.reduced) {
                mountUnderlay();
                host.setAttribute("data-edge-swipe-state", "dragging");
            }
        }
        if (event.cancelable)
            event.preventDefault();
        drag.distance = Math.max(0, dx);
        drag.samples.push({ x: touch.clientX, time: event.timeStamp });
        while (drag.samples.length > 1 && drag.samples[0].time < event.timeStamp - 100)
            drag.samples.shift();
        if (!drag.reduced)
            paint(dx, drag.width);
    };
    const end = (event) => {
        if (!drag)
            return;
        if (!drag.claimed) {
            drag = null;
            return;
        }
        const first = drag.samples[0], last = drag.samples.at(-1), elapsed = last.time - first.time;
        const velocity = elapsed > 0 && event.timeStamp - last.time <= 100 ? (last.x - first.x) / elapsed : 0;
        suppressClickUntil = event.timeStamp + 500;
        settle(enabled() && shouldPopPage(drag.distance, drag.width, velocity));
    };
    const cancel = () => { if (drag?.claimed)
        settle(false);
    else
        drag = null; };
    const click = (event) => {
        if (event.detail > 0 && event.timeStamp <= suppressClickUntil) {
            event.preventDefault();
            event.stopPropagation();
        }
    };
    const pointerDown = (event) => { if (event.pointerType === "mouse")
        suppressClickUntil = 0; };
    const settled = (event) => {
        if (event.target === host && event.propertyName === "transform")
            finishing?.();
    };
    // Landscape phones can have a centred, narrower shell. Its edge still belongs
    // to the viewport, including touches in the gutter outside the content host.
    const outsideStart = (event) => {
        if (root.getAttribute("data-layout") !== "phone" || host.contains(event.target))
            return;
        const touch = event.touches[0], box = host.getBoundingClientRect();
        if (!touch || touch.clientY < box.top || touch.clientY > box.bottom)
            return;
        start(event);
        outsideHost = drag !== null;
    };
    const outsideMove = (event) => { if (outsideHost)
        move(event); };
    const outsideEnd = (event) => { if (outsideHost) {
        end(event);
        outsideHost = false;
    } };
    const outsideCancel = () => { if (outsideHost) {
        cancel();
        outsideHost = false;
    } };
    host.addEventListener("touchstart", start, { passive: true });
    host.addEventListener("touchmove", move, { passive: false });
    host.addEventListener("touchend", end);
    host.addEventListener("touchcancel", cancel);
    host.addEventListener("click", click, true);
    host.addEventListener("pointerdown", pointerDown);
    host.addEventListener("transitionend", settled);
    document.addEventListener("touchstart", outsideStart, { passive: true });
    document.addEventListener("touchmove", outsideMove, { passive: false });
    document.addEventListener("touchend", outsideEnd);
    document.addEventListener("touchcancel", outsideCancel);
    return { reset, dispose() {
            reset();
            host.removeEventListener("touchstart", start);
            host.removeEventListener("touchmove", move);
            host.removeEventListener("touchend", end);
            host.removeEventListener("touchcancel", cancel);
            host.removeEventListener("click", click, true);
            host.removeEventListener("pointerdown", pointerDown);
            host.removeEventListener("transitionend", settled);
            document.removeEventListener("touchstart", outsideStart);
            document.removeEventListener("touchmove", outsideMove);
            document.removeEventListener("touchend", outsideEnd);
            document.removeEventListener("touchcancel", outsideCancel);
        } };
}
/** One static previous page per layout host. Same-page refreshes retain its underlay;
 * navigation and layout replacement dispose the old gesture before moving feature nodes. */
export class EdgeSwipeHost {
    root;
    content;
    sheetsOpen;
    #frames = new Map();
    #mounted = new Map();
    #gestures = [];
    #scrolled = new Map();
    #captureFrame;
    #captureTimer;
    #captureVersion = 0;
    // Schedule and cancel on the same owning window, including during teardown.
    #captureWindow = window;
    #onScroll = (event) => {
        const source = event.target;
        if (!(source instanceof HTMLElement))
            return;
        const host = this.#hosts().find(candidate => candidate === source || candidate.contains(source));
        if (!host)
            return;
        const scrolled = this.#scrolled.get(host) ?? new Set([host]);
        scrolled.add(source);
        this.#scrolled.set(host, scrolled);
        const copy = this.#mounted.get(host), node = copy?.sourceCopies?.get(source);
        if (copy && node && !copy.scroll.some(position => position.source === source))
            copy.scroll.push({ node, top: source.scrollTop, left: source.scrollLeft, source });
    };
    #navigationId;
    constructor(root, content, sheetsOpen = () => false) {
        this.root = root;
        this.content = content;
        this.sheetsOpen = sheetsOpen;
        content.addEventListener("scroll", this.#onScroll, { capture: true, passive: true });
    }
    #hosts() {
        return this.content.getAttribute("data-split") === "true"
            ? [...this.content.querySelectorAll(".lk-layout-primary, .lk-layout-secondary")] : [this.content];
    }
    #key(host, navigationId) {
        const back = host.querySelector(".lk-edge-back");
        return back ? navigationId ?? back.getAttribute("data-edge-back-key") ??
            back.parentElement?.querySelector("h1")?.textContent ?? host.querySelector("h1")?.textContent ?? "back" : null;
    }
    replace(render, incoming, navigationId) {
        this.#cancelCapture();
        this.#stop();
        this.#navigationId = navigationId;
        // Use the last post-frame capture. Refresh only elements that actually scrolled.
        const mounted = this.#mounted;
        const outgoing = incoming.querySelector(".lk-edge-back") ? mounted : new Map();
        for (const [host, copy] of mounted) {
            if (outgoing === mounted)
                for (const source of this.#scrolled.get(host) ?? [host]) {
                    const node = copy.sourceCopies?.get(source);
                    if (!node)
                        continue;
                    const top = source.scrollTop, left = source.scrollLeft;
                    const position = copy.scroll.find(item => item.node === node);
                    if (position) {
                        position.top = top;
                        position.left = left;
                    }
                    else if (top !== 0 || left !== 0)
                        copy.scroll.push({ node, top, left });
                }
            for (const position of copy.scroll)
                delete position.source;
            delete copy.sourceCopies;
        }
        this.#mounted = new Map();
        this.#scrolled = new Map();
        render();
        const next = new Map();
        for (const host of this.#hosts()) {
            const key = this.#key(host, navigationId), frame = this.#frames.get(host);
            let history = key ? frame?.history ?? [] : [];
            if (key && frame?.key !== key) {
                const previousIndex = history.map(entry => entry.key).lastIndexOf(key);
                const copy = outgoing.get(host);
                history = previousIndex >= 0 ? history.slice(0, previousIndex)
                    : [...history, { key: frame?.key ?? null, snapshot: copy ?? null }];
            }
            next.set(host, { key, history });
        }
        this.#frames = next;
        const hosts = this.#hosts();
        this.#scrolled = new Map(hosts.map(host => [host, new Set([host])]));
        this.refresh();
        this.#scheduleCapture();
    }
    #cancelCapture() {
        this.#captureVersion++;
        if (this.#captureFrame !== undefined)
            this.#captureWindow.cancelAnimationFrame(this.#captureFrame);
        if (this.#captureTimer !== undefined)
            this.#captureWindow.clearTimeout(this.#captureTimer);
        this.#captureFrame = this.#captureTimer = undefined;
    }
    #scheduleCapture() {
        const version = this.#captureVersion;
        this.#captureFrame = this.#captureWindow.requestAnimationFrame(() => {
            if (version !== this.#captureVersion)
                return;
            this.#captureFrame = undefined;
            this.#captureTimer = this.#captureWindow.setTimeout(() => {
                if (version !== this.#captureVersion)
                    return;
                this.#captureTimer = undefined;
                this.#mounted = new Map(this.#hosts().filter(host => host.children.length)
                    .map(host => [host, snapshot(host, this.#scrolled.get(host) ?? new Set([host]))]));
            }, 0);
        });
    }
    #stop() { for (const gesture of this.#gestures)
        gesture.dispose(); this.#gestures = []; }
    refresh() {
        this.#stop();
        const hosts = this.#hosts();
        // A differently shaped host after rotation has no matching static underlay.
        // Seed its current level so a refresh cannot mistake that page for a new push.
        for (const host of this.#frames.keys())
            if (!hosts.includes(host))
                this.#frames.delete(host);
        for (const host of this.#mounted.keys())
            if (!hosts.includes(host))
                this.#mounted.delete(host);
        for (const host of hosts) {
            if (!this.#frames.has(host))
                this.#frames.set(host, { key: this.#key(host, this.#navigationId), history: [] });
            this.#gestures.push(attachEdgeSwipe(host, this.root, () => this.#frames.get(host)?.history.at(-1)?.snapshot ?? null, () => !edgeSwipeDisabled(this.root, this.sheetsOpen())));
        }
    }
    dispose() {
        this.#cancelCapture();
        this.#stop();
        this.#frames.clear();
        this.#mounted.clear();
        this.#scrolled.clear();
        this.content.removeEventListener("scroll", this.#onScroll, true);
    }
}
