const BUILD_ID = "3f2770a94be7845cb768";
const LOCAL_SCHEMA_VERSION = "1";
const CACHE_PREFIX = "ledgernook-public-"; // Mirrors PROGRAM_CACHE_PREFIX in src/browser/program-reset.ts.
const CACHE_NAME = `${CACHE_PREFIX}${BUILD_ID}-schema-${LOCAL_SCHEMA_VERSION}`;
const MANIFEST_PATH = "./precache-manifest.json";
let shellAssets = new Set();

async function loadShellAssets(cache) {
  if (shellAssets.size > 0) return shellAssets;
  const cached = await cache.match(new URL(MANIFEST_PATH, self.registration.scope).href);
  if (!cached) return shellAssets;
  const manifest = await cached.json();
  if (manifest.buildId === BUILD_ID && manifest.localSchemaVersion === LOCAL_SCHEMA_VERSION && Array.isArray(manifest.assets)) {
    shellAssets = new Set(manifest.assets.map(path => new URL(path, self.registration.scope).href));
  }
  return shellAssets;
}

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    try {
      const response = await fetch(MANIFEST_PATH, { cache: "no-store", credentials: "omit" });
      if (!response.ok) throw new Error("Viewer asset manifest unavailable");
      const cachedManifest = response.clone();
      const manifest = await response.json();
      if (manifest.buildId !== BUILD_ID || manifest.localSchemaVersion !== LOCAL_SCHEMA_VERSION || !Array.isArray(manifest.assets)) {
        throw new Error("Viewer asset version mismatch");
      }
      const verified = await Promise.all(manifest.assets.map(async asset => {
        const expected = manifest.hashes?.[asset];
        if (typeof expected !== "string" || !/^[a-f0-9]{64}$/.test(expected)) throw new Error("Viewer asset hash missing");
        const url = new URL(asset, self.registration.scope).href;
        const assetResponse = await fetch(url, { cache: "reload", credentials: "omit" });
        if (!assetResponse.ok) throw new Error("Viewer asset unavailable");
        const digest = await crypto.subtle.digest("SHA-256", await assetResponse.clone().arrayBuffer());
        const actual = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
        if (actual !== expected) throw new Error("Viewer asset hash mismatch");
        return [url, assetResponse];
      }));
      const cache = await caches.open(CACHE_NAME);
      for (const [url, assetResponse] of verified) await cache.put(url, assetResponse);
      await cache.put(new URL(MANIFEST_PATH, self.registration.scope).href, cachedManifest);
      shellAssets = new Set(verified.map(([url]) => url));
    } catch (error) {
      await caches.delete(CACHE_NAME);
      throw error;
    }
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await loadShellAssets(cache);
    for (const name of await caches.keys()) {
      if (name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("message", event => {
  if (event.data?.type === "activate-waiting") event.waitUntil(self.skipWaiting());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET" || request.headers.has("authorization")) return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.hostname === "api.github.com") return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const assets = await loadShellAssets(cache);
    if (!assets.has(url.href)) return fetch(request);
    return await cache.match(request) ?? fetch(request);
  })());
});
