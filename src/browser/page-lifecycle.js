/** Ordinary page closing releases session authority; only a released BFCache page reloads. */
export function attachViewerPageLifecycle(host, release, reload, beforeRelease) {
    let released = false;
    const hide = () => { if (!released) {
        released = true;
        if (beforeRelease)
            void beforeRelease().catch(() => { }).finally(release);
        else
            release();
    } };
    const show = (event) => { if (released && event.persisted)
        reload(); };
    host.addEventListener("pagehide", hide);
    host.addEventListener("pageshow", show);
    return () => { host.removeEventListener("pagehide", hide); host.removeEventListener("pageshow", show); };
}
