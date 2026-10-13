/** Observe local publications without adding a remote or persistence path to viewer queries. */
export function observeSnapshotPublications(source) {
    const listeners = new Set();
    // A stale write can still mark the local coverage for refresh; observers must see that state too.
    const notify = () => { for (const listener of listeners)
        listener(); };
    return {
        store: {
            read: () => source.read(),
            readState: () => source.readState(),
            async publish(publication) {
                const outcome = await source.publish(publication);
                notify();
                return outcome;
            },
            async publishSync(publication) {
                const outcome = await source.publishSync(publication);
                notify();
                return outcome;
            },
        },
        notify,
        subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    };
}
