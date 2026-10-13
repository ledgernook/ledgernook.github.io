/** CSS pixels; movement below this remains a tap. */
export const SHEET_DRAG_SLOP = 8;
/** A deliberate downward flick: at least 24px at 0.65 CSS px/ms. */
export function shouldCloseSheet(behavior, distance, height, velocity) {
    return behavior === "close" && distance > SHEET_DRAG_SLOP &&
        (distance > height / 4 || (distance >= 24 && velocity >= 0.65));
}
export function sheetDragOffset(behavior, distance) {
    const down = Math.max(0, distance);
    return behavior === "rubber-band" ? down / (1 + down / 80) : down;
}
/** Touch Events allow top-edge content drags to be claimed before native overscroll on iOS.
 * Cancel only early downward content moves; leave touchstart, upward movement and zoom alone. */
export function attachSheetSwipe(panel, handle, header, behavior, enabled, close) {
    let drag = null;
    let suppressClickUntil = 0;
    const reset = () => {
        drag = null;
        if (panel.getAttribute("data-swipe-state") !== null)
            panel.setAttribute("data-swipe-state", "idle");
        panel.style.transform = "";
    };
    const springBack = () => {
        drag = null;
        panel.setAttribute("data-swipe-state", "returning");
        panel.style.transform = "translateY(0px)";
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches)
            reset();
    };
    const start = (event) => {
        reset();
        suppressClickUntil = 0;
        if (!enabled() || event.touches.length !== 1)
            return;
        let target = event.target;
        while (target && !(target instanceof HTMLElement))
            target = target.parentElement;
        if (!(target instanceof HTMLElement))
            return;
        const onChrome = handle.contains(target) || header.contains(target);
        // Include nested scroll hosts (e.g. schedules and textareas), locking eligibility at touchstart.
        if (!onChrome)
            for (let node = target; node; node = node.parentElement) {
                if (node.scrollTop > 0)
                    return;
                if (node === panel)
                    break;
            }
        const touch = event.touches[0];
        drag = { id: touch.identifier, x: touch.clientX, y: touch.clientY, height: panel.getBoundingClientRect().height,
            content: !onChrome, claimed: false, samples: [{ y: touch.clientY, time: event.timeStamp }], distance: 0 };
    };
    const move = (event) => {
        if (!drag)
            return;
        if (!enabled() || event.touches.length !== 1) {
            if (drag.claimed)
                springBack();
            else
                drag = null;
            return;
        }
        const touch = [...event.touches].find(touch => touch.identifier === drag.id);
        if (!touch)
            return;
        const dy = touch.clientY - drag.y, dx = touch.clientX - drag.x;
        if (!drag.claimed) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) <= SHEET_DRAG_SLOP) {
                // WebKit decides native scrolling from the first uncancelled touchmove.
                if (drag.content && dy > 0 && Math.abs(dx) <= dy && event.cancelable)
                    event.preventDefault();
                return;
            }
            if (dy <= 0 || Math.abs(dx) >= dy || !event.cancelable) {
                drag = null;
                return;
            }
            drag.claimed = true;
            panel.setAttribute("data-swipe-state", "dragging");
        }
        event.preventDefault();
        drag.distance = Math.max(0, dy);
        drag.samples.push({ y: touch.clientY, time: event.timeStamp });
        // Keep a recent window: a drag followed by a pause is not a flick.
        while (drag.samples.length > 1 && drag.samples[0].time < event.timeStamp - 100)
            drag.samples.shift();
        panel.style.transform = `translateY(${sheetDragOffset(behavior, dy)}px)`;
    };
    const end = (event) => {
        if (!drag)
            return;
        if (!drag.claimed) {
            drag = null;
            return;
        }
        const touch = [...event.changedTouches].find(touch => touch.identifier === drag.id);
        const first = drag.samples[0], last = drag.samples.at(-1), elapsed = last.time - first.time;
        const velocity = touch && elapsed > 0 && event.timeStamp - last.time <= 100 ? (last.y - first.y) / elapsed : 0;
        const dismiss = enabled() && shouldCloseSheet(behavior, drag.distance, drag.height, velocity);
        suppressClickUntil = event.timeStamp + 500;
        springBack();
        // The frame callback owns pop/dismiss and any busy guard, exactly like its close control.
        if (dismiss)
            close();
    };
    const cancel = () => { if (drag?.claimed)
        springBack();
    else
        drag = null; };
    const click = (event) => {
        if (event.detail > 0 && event.timeStamp <= suppressClickUntil) {
            event.preventDefault();
            event.stopPropagation();
            suppressClickUntil = 0;
        }
    };
    const pointerDown = (event) => { if (event.pointerType === "mouse")
        suppressClickUntil = 0; };
    const settled = (event) => { if (event.target === panel && event.propertyName === "transform" && !drag)
        reset(); };
    panel.addEventListener("touchstart", start, { passive: true });
    panel.addEventListener("touchmove", move, { passive: false });
    panel.addEventListener("touchend", end);
    panel.addEventListener("touchcancel", cancel);
    panel.addEventListener("click", click, true);
    panel.addEventListener("pointerdown", pointerDown);
    panel.addEventListener("transitionend", settled);
    return { reset, dispose() {
            reset();
            panel.removeEventListener("touchstart", start);
            panel.removeEventListener("touchmove", move);
            panel.removeEventListener("touchend", end);
            panel.removeEventListener("touchcancel", cancel);
            panel.removeEventListener("click", click, true);
            panel.removeEventListener("transitionend", settled);
            panel.removeEventListener("pointerdown", pointerDown);
        } };
}
