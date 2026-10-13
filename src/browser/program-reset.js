// The standalone service-worker.js template mirrors this prefix.
export const PROGRAM_CACHE_PREFIX = "ledgernook-public-";
export function createProgramReset(deps) {
    return { async reset() {
            if (!deps.serviceWorker || !deps.caches)
                return "unavailable";
            try {
                const response = await deps.fetch("./precache-manifest.json", { cache: "no-store", credentials: "omit" });
                if (!response.ok)
                    return "offline";
            }
            catch {
                return "offline";
            }
            try {
                for (const registration of await deps.serviceWorker.getRegistrations())
                    await registration.unregister();
                for (const name of await deps.caches.keys()) {
                    if (name.startsWith(PROGRAM_CACHE_PREFIX))
                        await deps.caches.delete(name);
                }
                deps.reload();
                return "reloading";
            }
            catch {
                return "unavailable";
            }
        } };
}
