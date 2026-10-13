export const PUSH_IDLE_MS = 3_000;
export const PUSH_RETRY_MS = 60_000;
/** Browser/UI timing only. The connection's LedgerPush owns single flight and coalescing. */
export function createPushScheduler(options) {
    const schedule = options.schedule ?? ((run, delay) => { const id = setTimeout(run, delay); return () => clearTimeout(id); });
    let disposed = false, cancelIdle, cancelTick;
    let revision = 0;
    async function tick() {
        const current = ++revision;
        cancelTick?.();
        cancelTick = undefined;
        if (disposed || !options.canPush() || !options.visible())
            return;
        const pending = await options.pending().catch(() => true);
        if (current !== revision || disposed || !options.canPush() || !options.visible() || !pending)
            return;
        cancelTick = schedule(() => { cancelTick = undefined; void immediate(); }, PUSH_RETRY_MS);
    }
    async function immediate() {
        cancelIdle?.();
        cancelIdle = undefined;
        cancelTick?.();
        cancelTick = undefined;
        revision++;
        if (disposed || !options.canPush())
            return;
        try {
            if (await options.pending() && !disposed && options.canPush()) {
                const result = await options.push();
                if (!disposed)
                    await options.outcome(result);
            }
        }
        catch { /* A failed local read or UI refresh retries at the ordinary minute tick. */ }
        finally {
            if (!disposed)
                await tick();
        }
    }
    return {
        changed() {
            if (disposed || !options.canPush())
                return;
            cancelIdle?.();
            cancelIdle = schedule(() => { cancelIdle = undefined; void immediate(); }, PUSH_IDLE_MS);
            void tick();
        },
        immediate,
        visibilityChanged() {
            if (options.visible())
                void immediate();
            else {
                cancelTick?.();
                cancelTick = undefined;
                revision++;
                void immediate();
            }
        },
        /** A pull can discover inbox work, without manufacturing another edit/idle timer. */
        pendingChanged: tick,
        dispose() { disposed = true; revision++; cancelIdle?.(); cancelTick?.(); },
    };
}
