import { movePaymentMethod } from "./settings-model.js";
const HOLD_MS = 350, SETTLE_MS = 160, SWIPE_SLOP = 8;
/** Pointer geometry stays separate from DOM order until the lifted row has settled. */
export function attachPaymentMethodReorder(list, announce, persist) {
    let pending;
    let drag, keyboard;
    let hold, settle;
    let frame, disposed = false, saving = false, suppressClickUntil = 0;
    const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    const enabledRows = () => [...list.querySelectorAll('[data-payment-enabled="true"]')];
    const snapshot = (id) => {
        const nodes = enabledRows(), firstTop = nodes[0].getBoundingClientRect().top;
        const rows = nodes.map(node => {
            const rect = node.getBoundingClientRect();
            return { node, id: node.dataset.paymentMethodId, top: rect.top - firstTop, height: rect.height };
        });
        const original = rows.map(row => row.id);
        return { id, rows, original, order: original };
    };
    const offsets = (preview) => {
        let top = 0;
        const result = new Map();
        for (const id of preview.order) {
            result.set(id, top);
            top += preview.rows.find(row => row.id === id).height;
        }
        return result;
    };
    function paint(preview, liftedTop) {
        const slots = offsets(preview);
        for (const row of preview.rows) {
            const lifted = liftedTop !== undefined && row.id === preview.id;
            const y = (lifted ? liftedTop : slots.get(row.id)) - row.top;
            row.node.style.transform = `translateY(${y}px)${lifted && !reduced() ? " scale(1.015)" : ""}`;
        }
    }
    function say(preview) {
        const label = preview.rows.find(row => row.id === preview.id).node.querySelector(".lk-payment-toggle")?.getAttribute("aria-label") ?? "";
        announce.textContent = `${label}，第 ${preview.order.indexOf(preview.id) + 1} 項，共 ${preview.order.length} 項`;
    }
    function clearPreview(preview) {
        for (const row of preview.rows) {
            row.node.style.transform = "";
            row.node.removeAttribute("data-reorder-state");
        }
        list.classList.remove("lk-methods-reordering");
    }
    function commit(preview) {
        if (disposed)
            return;
        const focused = document.activeElement;
        // Only enabled rows move. Disabled rows remain at the end, in their existing order.
        const firstDisabled = list.querySelector('[data-payment-enabled="false"]');
        for (const id of preview.order)
            list.insertBefore(preview.rows.find(row => row.id === id).node, firstDisabled);
        clearPreview(preview);
        if (focused instanceof HTMLElement && list.contains(focused))
            focused.focus({ preventScroll: true });
        if (preview.order.every((id, index) => id === preview.original[index]))
            return;
        const focusId = focused instanceof HTMLElement && focused.classList.contains("lk-method-order-handle") ? preview.id : undefined;
        saving = true;
        list.setAttribute("aria-busy", "true");
        list.inert = true;
        void persist(preview.order, focusId).finally(() => { saving = false; list.inert = false; list.removeAttribute("aria-busy"); });
    }
    function cancelHold() { if (hold !== undefined)
        clearTimeout(hold); hold = undefined; pending = undefined; }
    function stopFrame() { if (frame !== undefined)
        window.cancelAnimationFrame(frame); frame = undefined; }
    function releaseCapture(active) {
        if (active.node.hasPointerCapture(active.pointerId))
            active.node.releasePointerCapture(active.pointerId);
    }
    function finish(cancelled) {
        cancelHold();
        stopFrame();
        const active = drag;
        if (!active)
            return;
        drag = undefined;
        releaseCapture(active);
        suppressClickUntil = performance.now() + 500;
        if (cancelled) {
            clearPreview(active);
            return;
        }
        active.node.dataset.reorderState = "settling";
        paint(active);
        say(active);
        if (reduced())
            commit(active);
        else
            settle = setTimeout(() => { settle = undefined; commit(active); }, SETTLE_MS);
    }
    function updateDrag() {
        const active = drag;
        if (!active)
            return;
        const moving = active.rows.find(row => row.id === active.id);
        const top = Math.max(0, Math.min(active.total - moving.height, moving.top + active.y - active.startY + active.scroll.scrollTop - active.startScroll));
        let slotTop = 0, index = 0;
        for (const row of active.rows.filter(row => row.id !== active.id)) {
            if (top > slotTop + row.height / 2)
                index++;
            slotTop += row.height;
        }
        const order = movePaymentMethod(active.original, active.id, index);
        if (order.some((id, i) => id !== active.order[i])) {
            active.order = order;
            say(active);
        }
        paint(active, top);
    }
    function autoscroll(now) {
        const active = drag;
        if (!active)
            return;
        const bounds = active.scroll.getBoundingClientRect();
        const navigation = list.closest(".lk-app-shell")?.querySelector(".lk-navigation-host")?.getBoundingClientRect();
        // The floating tab bar covers the phone scroll host, but not iPad's right column.
        const bottom = navigation && navigation.right > bounds.left && navigation.left < bounds.right
            ? Math.min(bounds.bottom, navigation.top) : bounds.bottom;
        const edge = Math.min(56, (bottom - bounds.top) / 4);
        const speed = active.y < bounds.top + edge ? -Math.min(1, (bounds.top + edge - active.y) / edge)
            : active.y > bottom - edge ? Math.min(1, (active.y - bottom + edge) / edge) : 0;
        const elapsed = Math.min(32, now - active.frameTime);
        active.frameTime = now;
        if (speed)
            active.scroll.scrollTop += speed * elapsed * 0.6;
        updateDrag();
        frame = window.requestAnimationFrame(autoscroll);
    }
    function lift() {
        const start = pending;
        if (!start || disposed || saving)
            return;
        cancelHold();
        const preview = snapshot(start.id);
        let scroll = list.parentElement;
        while (scroll.parentElement && !/(auto|scroll)/.test(getComputedStyle(scroll).overflowY))
            scroll = scroll.parentElement;
        drag = { ...preview, pointerId: start.pointerId, node: start.node, startY: start.y, y: start.y,
            startScroll: scroll.scrollTop, scroll, total: preview.rows.reduce((sum, row) => sum + row.height, 0), frameTime: performance.now() };
        start.node.setPointerCapture(start.pointerId);
        start.node.dataset.reorderState = "lifted";
        list.classList.add("lk-methods-reordering");
        suppressClickUntil = performance.now() + 500;
        // iOS has no vibration API. Use an actual platform haptic only when exposed.
        if (typeof navigator.vibrate === "function")
            navigator.vibrate(10);
        updateDrag();
        say(drag);
        frame = window.requestAnimationFrame(autoscroll);
    }
    function down(event) {
        if (saving || settle !== undefined || drag || keyboard || !event.isPrimary || event.button !== 0)
            return;
        const target = event.target;
        const row = target.closest('[data-payment-enabled="true"]');
        if (!row || !list.contains(row) || enabledRows().length < 2)
            return;
        const handle = target.closest(".lk-method-order-handle");
        if (handle?.disabled)
            return;
        const control = target.closest("button, input, a, select, textarea");
        // Holding the row's text lifts it; switch tracks and bank controls keep their taps.
        if (!handle && (target.closest(".lk-switch") || control && !control.classList.contains("lk-payment-toggle")))
            return;
        pending = { id: row.dataset.paymentMethodId, node: row, pointerId: event.pointerId, x: event.clientX, y: event.clientY };
        if (handle) {
            event.preventDefault();
            handle.focus({ preventScroll: true });
            lift();
        }
        else
            hold = setTimeout(lift, HOLD_MS);
    }
    function move(event) {
        if (drag?.pointerId === event.pointerId) {
            event.preventDefault();
            drag.y = event.clientY;
            updateDrag();
        }
        else if (pending?.pointerId === event.pointerId && Math.hypot(event.clientX - pending.x, event.clientY - pending.y) > SWIPE_SLOP)
            cancelHold();
    }
    const up = (event) => { if (drag?.pointerId === event.pointerId)
        finish(false);
    else if (pending?.pointerId === event.pointerId)
        cancelHold(); };
    const cancel = (event) => { if (drag?.pointerId === event.pointerId)
        finish(true);
    else if (pending?.pointerId === event.pointerId)
        cancelHold(); };
    // touch-action is determined at pointerdown. A row hold must initially allow native
    // scrolling; a non-passive touchmove blocks that scroll only after the hold lifts.
    const touchmove = (event) => { if (drag && event.cancelable)
        event.preventDefault(); };
    const click = (event) => { if (performance.now() < suppressClickUntil) {
        event.preventDefault();
        event.stopImmediatePropagation();
    } };
    const contextmenu = (event) => { if (drag || pending)
        event.preventDefault(); };
    function finishKeyboard(cancelled = false) {
        const preview = keyboard;
        keyboard = undefined;
        if (!preview)
            return;
        if (cancelled)
            clearPreview(preview);
        else
            commit(preview);
    }
    function keydown(event) {
        const handle = event.target.closest(".lk-method-order-handle");
        if (!handle || handle.disabled || saving || drag || settle !== undefined)
            return;
        if (event.key === "Escape") {
            event.preventDefault();
            finishKeyboard(true);
            return;
        }
        if (event.key === "Enter") {
            event.preventDefault();
            finishKeyboard();
            return;
        }
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown")
            return;
        event.preventDefault();
        cancelHold();
        const id = handle.closest(".lk-payment-setting").dataset.paymentMethodId;
        keyboard ??= snapshot(id);
        list.classList.add("lk-methods-reordering");
        keyboard.order = movePaymentMethod(keyboard.order, id, keyboard.order.indexOf(id) + (event.key === "ArrowUp" ? -1 : 1));
        paint(keyboard);
        say(keyboard);
    }
    const blur = (event) => { if (keyboard && event.target.classList.contains("lk-method-order-handle"))
        finishKeyboard(); };
    list.addEventListener("pointerdown", down);
    list.addEventListener("touchmove", touchmove, { passive: false });
    list.addEventListener("click", click, true);
    list.addEventListener("contextmenu", contextmenu);
    list.addEventListener("keydown", keydown);
    list.addEventListener("blur", blur, true);
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    list.addEventListener("lostpointercapture", cancel);
    return () => {
        disposed = true;
        finish(true);
        cancelHold();
        stopFrame();
        finishKeyboard(true);
        if (settle !== undefined)
            clearTimeout(settle);
        list.removeEventListener("pointerdown", down);
        list.removeEventListener("touchmove", touchmove);
        list.removeEventListener("click", click, true);
        list.removeEventListener("contextmenu", contextmenu);
        list.removeEventListener("keydown", keydown);
        list.removeEventListener("blur", blur, true);
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", cancel);
        list.removeEventListener("lostpointercapture", cancel);
    };
}
