import { RemoteReadError } from "../application/ports.js";
const SHA = /^[0-9a-f]{40}$/;
const MAX_TREE_ENTRIES = 10_000;
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const MAX_BLOB_BYTES = 1024 * 1024;
const GRAPH_BATCH = 32;
const REST_CONCURRENCY = 4;
class GraphFallback extends Error {
}
export function record(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function requireSha(value) {
    if (typeof value !== "string" || !SHA.test(value))
        throw new RemoteReadError("incomplete");
    return value;
}
export function encodedPath(path) { return path.split("/").map(encodeURIComponent).join("/"); }
async function digest(body) {
    const prefix = new TextEncoder().encode(`blob ${body.length}\0`);
    const input = new Uint8Array(prefix.length + body.length);
    input.set(prefix);
    input.set(body, prefix.length);
    const result = await crypto.subtle.digest("SHA-1", input);
    return [...new Uint8Array(result)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
function interrupted(signal) { if (signal?.aborted)
    throw new RemoteReadError("cancelled"); }
function wait(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new RemoteReadError("cancelled"));
            return;
        }
        const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, ms);
        const abort = () => { clearTimeout(timer); reject(new RemoteReadError("cancelled")); };
        signal?.addEventListener("abort", abort, { once: true });
    });
}
function responseError(response) {
    if (response.status === 401)
        return new RemoteReadError("unauthorized");
    if (response.status === 403 && (response.headers.get("x-ratelimit-remaining") === "0" ||
        response.headers.has("retry-after")))
        return new RemoteReadError("rate-limited");
    if (response.status === 403)
        return new RemoteReadError("forbidden");
    if (response.status === 429)
        return new RemoteReadError("rate-limited");
    if (response.status === 404)
        return new RemoteReadError("not-found");
    return new RemoteReadError("network");
}
async function json(response) {
    const size = Number(response.headers.get("content-length"));
    if (Number.isFinite(size) && size > MAX_RESPONSE_BYTES)
        throw new RemoteReadError("incomplete");
    const text = await response.text();
    if (new TextEncoder().encode(text).length > MAX_RESPONSE_BYTES)
        throw new RemoteReadError("incomplete");
    try {
        return JSON.parse(text);
    }
    catch {
        throw new RemoteReadError("incomplete");
    }
}
function entryList(value) {
    if (!Array.isArray(value) || value.length > MAX_TREE_ENTRIES)
        throw new RemoteReadError("incomplete");
    const result = [];
    const seen = new Set();
    for (const raw of value) {
        const item = record(raw);
        const name = item?.name ?? item?.path;
        if (typeof name !== "string" || name.length === 0 || name.includes("/") || name === "." || name === ".." ||
            seen.has(name))
            throw new RemoteReadError("incomplete");
        const type = item?.type;
        if (type !== "blob" && type !== "tree")
            throw new RemoteReadError("incomplete");
        seen.add(name);
        result.push({ name, type, objectId: requireSha(item?.oid ?? item?.sha) });
    }
    return result;
}
/** Reads Git objects at a pinned commit; GraphQL batches fall back to nonrecursive REST trees/blobs. */
export class IncrementalGitHubReader {
    token;
    base;
    fetcher;
    owner;
    repo;
    branch;
    graphEnabled;
    rootTrees = new Map();
    restTrees = new Map();
    constructor(options) {
        if (![options.owner, options.repo].every(value => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) &&
            value !== "." && value !== "..") || !/^[A-Za-z0-9._/-]+$/.test(options.branch) ||
            options.branch.includes("..") || options.branch.includes("//") || !options.token || /[\r\n]/.test(options.token)) {
            throw new TypeError("Invalid GitHub connection");
        }
        this.token = options.token;
        this.owner = options.owner;
        this.repo = options.repo;
        this.branch = options.branch;
        this.base = `https://api.github.com/repos/${encodeURIComponent(options.owner)}/${encodeURIComponent(options.repo)}`;
        this.fetcher = options.fetch ?? fetch;
        this.graphEnabled = options.graphql !== false;
    }
    disconnect() { this.token = ""; this.restTrees.clear(); this.rootTrees.clear(); }
    async request(url, init, signal) {
        if (!this.token)
            throw new RemoteReadError("unauthorized");
        for (let attempt = 0; attempt < 3; attempt++) {
            interrupted(signal);
            let response;
            try {
                response = await this.fetcher(url, { ...init, ...(signal ? { signal } : {}), headers: {
                        Accept: "application/vnd.github+json", Authorization: `Bearer ${this.token}`,
                        "X-GitHub-Api-Version": "2022-11-28", ...init.headers,
                    } });
            }
            catch {
                if (signal?.aborted)
                    throw new RemoteReadError("cancelled");
                throw new RemoteReadError("network");
            }
            const error = responseError(response);
            if (error.code !== "rate-limited" || attempt === 2)
                return response;
            const retry = Number(response.headers.get("retry-after"));
            await wait(Number.isFinite(retry) && retry >= 0 ? Math.min(retry * 1000, 2000) : 250 * (attempt + 1), signal);
        }
        throw new RemoteReadError("rate-limited");
    }
    async rest(url, signal) {
        const response = await this.request(url, { method: "GET" }, signal);
        if (!response.ok)
            throw responseError(response);
        return json(response);
    }
    async graph(query, signal) {
        let response;
        try {
            response = await this.request("https://api.github.com/graphql", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ query, variables: { owner: this.owner, repo: this.repo } }),
            }, signal);
        }
        catch (error) {
            if (error instanceof RemoteReadError && error.code === "cancelled")
                throw error;
            throw new GraphFallback();
        }
        if (!response.ok)
            throw new GraphFallback();
        const payload = record(await json(response));
        if (!payload || Array.isArray(payload.errors) && payload.errors.length > 0)
            throw new GraphFallback();
        const data = record(payload.data);
        if (!data)
            throw new GraphFallback();
        return data;
    }
    async readHead(signal) {
        const data = record(await this.rest(`${this.base}/git/ref/heads/${encodedPath(this.branch)}`, signal));
        return { commit: requireSha(record(data?.object)?.sha) };
    }
    async relateBase(base, head, signal) {
        requireSha(base);
        requireSha(head);
        if (base === head)
            return "ancestor";
        try {
            const data = record(await this.rest(`${this.base}/compare/${base}...${head}`, signal));
            if (data?.status === "ahead" || data?.status === "identical")
                return "ancestor";
            if (data?.status === "behind" || data?.status === "diverged")
                return "unrelated";
            return "unknown";
        }
        catch (error) {
            if (error instanceof RemoteReadError && error.code !== "not-found")
                throw error;
            return "unknown";
        }
    }
    async listTree(commit, path, signal) {
        return (await this.listTrees(commit, [path], signal))[0];
    }
    /** Read directory identities without downloading their entries. A caller may skip a listing only
     * when it has already published a complete listing for the same tree identity. */
    async readTreeIds(commit, paths, signal) {
        requireSha(commit);
        if (paths.length > GRAPH_BATCH)
            throw new RangeError("Tree batch too large");
        for (const path of paths)
            if (path !== "" && !/^(?:[a-z0-9.-]+)(?:\/[a-z0-9.-]+)*$/.test(path))
                throw new TypeError("Invalid tree path");
        if (paths.length === 0)
            return [];
        if (this.graphEnabled) {
            try {
                const aliases = paths.map((path, index) => `i${index}:object(expression:${JSON.stringify(`${commit}:${path}`)}){... on Tree{oid}}`);
                const data = await this.graph(`query($owner:String!,$repo:String!){repository(owner:$owner,name:$repo){${aliases.join(" ")}}}`, signal);
                const repository = record(data.repository);
                if (!repository)
                    throw new GraphFallback();
                return paths.map((_, index) => {
                    const tree = repository[`i${index}`];
                    if (tree === null)
                        return null;
                    try {
                        return requireSha(record(tree)?.oid);
                    }
                    catch {
                        throw new GraphFallback();
                    }
                });
            }
            catch (error) {
                if (!(error instanceof GraphFallback))
                    throw error;
                this.graphEnabled = false;
            }
        }
        const output = Array(paths.length);
        let next = 0;
        await Promise.all(Array.from({ length: Math.min(REST_CONCURRENCY, paths.length) }, async () => {
            for (;;) {
                const index = next++;
                if (index >= paths.length)
                    return;
                const path = paths[index];
                if (path === "") {
                    output[index] = await this.rootTree(commit, signal);
                    continue;
                }
                const slash = path.lastIndexOf("/");
                const parent = await this.restTree(commit, slash < 0 ? "" : path.slice(0, slash), signal);
                if (!parent.complete)
                    throw new RemoteReadError("incomplete");
                output[index] = parent.entries.find(entry => entry.name === path.slice(slash + 1) && entry.type === "tree")?.objectId ?? null;
            }
        }));
        return output;
    }
    async listTrees(commit, paths, signal) {
        requireSha(commit);
        if (paths.length > GRAPH_BATCH)
            throw new RangeError("Tree batch too large");
        for (const path of paths)
            if (path !== "" && !/^(?:[a-z0-9.-]+)(?:\/[a-z0-9.-]+)*$/.test(path))
                throw new TypeError("Invalid tree path");
        if (paths.length === 0)
            return [];
        if (this.graphEnabled) {
            try {
                return await this.graphTrees(commit, paths, signal);
            }
            catch (error) {
                if (!(error instanceof GraphFallback))
                    throw error;
                this.graphEnabled = false;
            }
        }
        const output = Array(paths.length);
        let next = 0;
        await Promise.all(Array.from({ length: Math.min(REST_CONCURRENCY, paths.length) }, async () => {
            for (;;) {
                const index = next++;
                if (index >= paths.length)
                    return;
                output[index] = await this.restTree(commit, paths[index], signal);
            }
        }));
        return output;
    }
    async graphTrees(commit, paths, signal) {
        const aliases = paths.map((path, index) => `t${index}:object(expression:${JSON.stringify(`${commit}:${path}`)}){... on Tree{oid entries{name oid type}}}`);
        const data = await this.graph(`query($owner:String!,$repo:String!){repository(owner:$owner,name:$repo){${aliases.join(" ")}}}`, signal);
        const repository = record(data.repository);
        if (!repository)
            throw new GraphFallback();
        return paths.map((path, index) => {
            const tree = record(repository[`t${index}`]);
            if (!tree)
                return { path, treeId: null, entries: [], complete: true };
            try {
                const entries = entryList(tree.entries);
                return { path, treeId: requireSha(tree.oid), entries, complete: true };
            }
            catch {
                throw new GraphFallback();
            }
        });
    }
    async rootTree(commit, signal) {
        const cached = this.rootTrees.get(commit);
        if (cached)
            return cached;
        const data = record(await this.rest(`${this.base}/git/commits/${commit}`, signal));
        const id = requireSha(record(data?.tree)?.sha);
        this.rootTrees.set(commit, id);
        return id;
    }
    async restTree(commit, path, signal) {
        let treeId = await this.rootTree(commit, signal);
        const parts = path === "" ? [] : path.split("/");
        let current = "";
        for (let i = 0; i <= parts.length; i++) {
            // Git trees are immutable by identity: an unchanged subtree survives a moved head.
            let listing = this.restTrees.get(treeId);
            if (!listing) {
                const body = record(await this.rest(`${this.base}/git/trees/${treeId}`, signal));
                if (!body || !Array.isArray(body.tree))
                    throw new RemoteReadError("incomplete");
                let entries;
                let complete = body.truncated === false;
                try {
                    entries = entryList(body.tree);
                }
                catch {
                    entries = [];
                    complete = false;
                }
                listing = { path: current, treeId, entries, complete };
                if (complete)
                    this.restTrees.set(treeId, listing);
            }
            if (i === parts.length)
                return { ...listing, path };
            if (!listing.complete)
                return { path, treeId: null, entries: [], complete: false };
            const child = listing.entries.find(entry => entry.name === parts[i] && entry.type === "tree");
            if (!child)
                return { path, treeId: null, entries: [], complete: true };
            treeId = child.objectId;
            current = current ? `${current}/${parts[i]}` : parts[i];
        }
        throw new RemoteReadError("incomplete");
    }
    async readObjects(commit, requests, signal) {
        requireSha(commit);
        if (requests.length > GRAPH_BATCH)
            throw new RangeError("Object batch too large");
        for (const request of requests)
            requireSha(request.objectId);
        if (requests.length === 0)
            return [];
        if (this.graphEnabled) {
            try {
                return await this.graphObjects(requests, signal);
            }
            catch (error) {
                if (!(error instanceof GraphFallback))
                    throw error;
                this.graphEnabled = false;
            }
        }
        const output = Array(requests.length);
        let next = 0;
        await Promise.all(Array.from({ length: Math.min(REST_CONCURRENCY, requests.length) }, async () => {
            for (;;) {
                const index = next++;
                if (index >= requests.length)
                    return;
                output[index] = await this.restObject(requests[index], signal);
            }
        }));
        return output;
    }
    async graphObjects(requests, signal) {
        const aliases = requests.map((item, index) => `b${index}:object(oid:${JSON.stringify(item.objectId)}){... on Blob{oid text byteSize isTruncated}}`);
        const data = await this.graph(`query($owner:String!,$repo:String!){repository(owner:$owner,name:$repo){${aliases.join(" ")}}}`, signal);
        const repository = record(data.repository);
        if (!repository)
            throw new GraphFallback();
        const output = [];
        for (let index = 0; index < requests.length; index++) {
            const request = requests[index];
            const blob = record(repository[`b${index}`]);
            if (!blob) {
                output.push({ ...request, status: "missing" });
                continue;
            }
            if (blob.isTruncated || typeof blob.text !== "string" || typeof blob.byteSize !== "number")
                throw new GraphFallback();
            const bytes = new TextEncoder().encode(blob.text);
            if (bytes.length !== blob.byteSize || bytes.length > MAX_BLOB_BYTES || await digest(bytes) !== request.objectId)
                throw new GraphFallback();
            try {
                output.push({ ...request, status: "found", body: JSON.parse(blob.text) });
            }
            catch {
                throw new RemoteReadError("incomplete");
            }
        }
        return output;
    }
    async restObject(request, signal) {
        const response = await this.request(`${this.base}/git/blobs/${request.objectId}`, { method: "GET" }, signal);
        if (response.status === 404)
            return { ...request, status: "missing" };
        if (!response.ok)
            throw responseError(response);
        const data = record(await json(response));
        if (data?.encoding !== "base64" || typeof data.content !== "string" ||
            typeof data.size !== "number" || !Number.isSafeInteger(data.size) || data.size < 0 ||
            data.size > MAX_BLOB_BYTES)
            throw new RemoteReadError("incomplete");
        let bytes;
        try {
            bytes = Uint8Array.from(atob(data.content.replace(/\s/g, "")), character => character.charCodeAt(0));
        }
        catch {
            throw new RemoteReadError("incomplete");
        }
        if (bytes.length !== data.size || await digest(bytes) !== request.objectId)
            throw new RemoteReadError("incomplete");
        try {
            return { ...request, status: "found", body: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) };
        }
        catch {
            throw new RemoteReadError("incomplete");
        }
    }
}
