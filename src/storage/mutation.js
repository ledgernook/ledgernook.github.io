import { MAX_COMMAND_WRITES, RemoteReadError } from "../application/ports.js";
import { validateLedgerObjectAtPath, PROJECT_PATH_PATTERN, UNRECORDED_PATH_PATTERN, PREFERENCES_PATH, USER_RULES_PATH } from "../core/index.js";
import { encodedPath as encodePath } from "./incremental.js";
const SHA = /^[0-9a-f]{40}$/;
class PermissionError extends Error {
    code;
    constructor(code) {
        super(code);
        this.code = code;
    }
}
function record(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function sha(value) { return typeof value === "string" && SHA.test(value); }
async function json(response) {
    try {
        return await response.json();
    }
    catch {
        throw new RemoteReadError("incomplete");
    }
}
/** Git data batch adapter. No replay, retry, readback receipt or retained candidate commit. */
export class GitHubLedgerBatch {
    #base;
    #branch;
    #token;
    #fetch;
    #confirmed;
    #pinnedHead = "";
    #identities = new Map();
    constructor(options) {
        if (![options.owner, options.repo].every(part => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part) && part !== "." && part !== "..") ||
            !options.branch || options.branch.startsWith("/") || options.branch.endsWith("/") || options.branch.includes("..") ||
            options.branch.includes("//") || !/^[A-Za-z0-9._/-]+$/.test(options.branch) || !options.token || /[\r\n]/.test(options.token))
            throw new TypeError("Invalid edit connection");
        this.#base = `https://api.github.com/repos/${encodeURIComponent(options.owner)}/${encodeURIComponent(options.repo)}`;
        this.#branch = options.branch;
        this.#token = options.token;
        this.#fetch = options.fetch;
        this.#confirmed = options.confirmed;
    }
    disconnect() { this.#token = ""; this.#identities.clear(); }
    async #request(method, path, body, signal) {
        if (!this.#token)
            throw new PermissionError("credential-rejected");
        if (signal?.aborted)
            throw new RemoteReadError("cancelled");
        let response;
        try {
            response = await this.#fetch(this.#base + path, { method, headers: { Authorization: `Bearer ${this.#token}`,
                    Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }), ...(signal ? { signal } : {}) });
        }
        catch {
            throw new RemoteReadError("network");
        }
        if (response.status === 429 || response.status === 403 && (response.headers?.get("x-ratelimit-remaining") === "0" || response.headers?.get("retry-after") != null))
            throw new RemoteReadError("rate-limited");
        if (response.status === 401 || method === "GET" && response.status === 403)
            throw new PermissionError("credential-rejected");
        if (method !== "GET" && (response.status === 403 || response.status === 404))
            throw new PermissionError("write-denied");
        // A page suspended/aborted after delivery has an uncertain outcome, even with a response in flight.
        if (signal?.aborted)
            throw new RemoteReadError("cancelled");
        return response;
    }
    async readPaths(head, paths, signal) {
        if (!sha(head))
            throw new RemoteReadError("incomplete");
        try {
            const results = [];
            for (let offset = 0; offset < paths.length; offset += 32)
                results.push(...await Promise.all(paths.slice(offset, offset + 32).map(async (path) => {
                    // Validate the writable namespace before constructing a URL, including absent paths.
                    if (!(PREFERENCES_PATH === path || USER_RULES_PATH === path || PROJECT_PATH_PATTERN.test(path) || UNRECORDED_PATH_PATTERN.test(path) ||
                        /^(?:events|details)\/v1\/\d{4}\/(?:0[1-9]|1[0-2])\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/.test(path)))
                        throw new RemoteReadError("incomplete");
                    const response = await this.#request("GET", `/contents/${encodePath(path)}?ref=${head}`, undefined, signal);
                    if (response.status === 404)
                        return { path, object: null };
                    if (response.status !== 200)
                        throw new RemoteReadError("network");
                    const data = await json(response);
                    if (!record(data) || data.path !== path || data.type !== "file" || !sha(data.sha) || data.encoding !== "base64" ||
                        typeof data.content !== "string" || typeof data.size !== "number" || !Number.isSafeInteger(data.size) || data.size < 0 || data.size > 512 * 1024)
                        throw new RemoteReadError("incomplete");
                    try {
                        const bytes = Uint8Array.from(atob(data.content.replace(/\s/g, "")), character => character.charCodeAt(0));
                        const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
                        if (bytes.length !== data.size || await blobSha(content) !== data.sha)
                            throw new Error();
                        return { path, object: { ...validateLedgerObjectAtPath(path, JSON.parse(content)), objectId: data.sha } };
                    }
                    catch {
                        throw new RemoteReadError("incomplete");
                    }
                })));
            if (this.#pinnedHead !== head) {
                this.#identities.clear();
                this.#pinnedHead = head;
            }
            for (const entry of results)
                this.#identities.set(entry.path, entry.object?.objectId ?? null);
            return results;
        }
        catch (error) {
            if (error instanceof PermissionError)
                throw new RemoteReadError("unauthorized");
            throw error;
        }
    }
    async commit(batch, signal) {
        try {
            if (!this.#token)
                throw new PermissionError("credential-rejected");
            if (!sha(batch.head) || !batch.writes.length || batch.writes.length > MAX_COMMAND_WRITES || new Set(batch.writes.map(write => write.path)).size !== batch.writes.length)
                throw new RemoteReadError("incomplete");
            const writes = await Promise.all(batch.writes.map(async (write) => {
                if (write.expectedObjectId !== null && !sha(write.expectedObjectId))
                    throw new RemoteReadError("incomplete");
                if (write.value === null) {
                    if (write.expectedObjectId === null || !(PROJECT_PATH_PATTERN.test(write.path) || UNRECORDED_PATH_PATTERN.test(write.path)))
                        throw new RemoteReadError("incomplete");
                    return { path: write.path, content: null, sha: null };
                }
                let object;
                try {
                    object = validateLedgerObjectAtPath(write.path, write.value);
                }
                catch {
                    throw new RemoteReadError("incomplete");
                }
                if (object.kind === "ai-rule" || object.kind === "unrecorded" || object.kind === "source" && write.expectedObjectId !== null)
                    throw new RemoteReadError("incomplete");
                const content = JSON.stringify(object.value) + "\n";
                return { path: write.path, content, sha: await blobSha(content) };
            }));
            // base_tree overwrites silently. Shape-valid expected identities are claims, not authority.
            const state = await this.#confirmed?.readState();
            const current = state?.snapshot.cursor?.commit === batch.head ? state : undefined;
            if (this.#pinnedHead !== batch.head) {
                this.#identities.clear();
                this.#pinnedHead = batch.head;
            }
            for (const write of batch.writes) {
                const directory = write.path.slice(0, Math.max(0, write.path.lastIndexOf("/")));
                if (current?.covered.includes(directory))
                    this.#identities.set(write.path, current.snapshot.objects.find(object => object.path === write.path)?.objectId ?? null);
            }
            const missing = batch.writes.filter(write => !this.#identities.has(write.path)).map(write => write.path);
            if (missing.length)
                await this.readPaths(batch.head, missing, signal);
            if (batch.writes.some(write => this.#identities.get(write.path) !== write.expectedObjectId))
                throw new RemoteReadError("incomplete");
            let baseTree = batch.baseTree;
            const knownTree = current?.covered.includes("") ? current.trees.find(tree => tree.path === "")?.treeId : undefined;
            if (baseTree === undefined || baseTree !== knownTree) {
                const baseResponse = await this.#request("GET", `/git/commits/${batch.head}`, undefined, signal);
                if (baseResponse.status !== 200)
                    throw new RemoteReadError("network");
                const base = await json(baseResponse);
                if (!record(base) || base.sha !== batch.head || !record(base.tree) || !sha(base.tree.sha))
                    throw new RemoteReadError("incomplete");
                if (baseTree !== undefined && baseTree !== base.tree.sha)
                    throw new RemoteReadError("incomplete");
                baseTree = base.tree.sha;
            }
            if (!sha(baseTree))
                throw new RemoteReadError("incomplete");
            const treeResponse = await this.#request("POST", "/git/trees", { base_tree: baseTree,
                tree: writes.map(write => ({ path: write.path, mode: "100644", type: "blob", ...(write.content === null ? { sha: null } : { content: write.content }) })) }, signal);
            if (treeResponse.status !== 201)
                throw new RemoteReadError(treeResponse.status >= 500 ? "network" : "incomplete");
            const tree = await json(treeResponse);
            if (!record(tree) || !sha(tree.sha))
                throw new RemoteReadError("incomplete");
            const commitResponse = await this.#request("POST", "/git/commits", { message: `Sync ${writes.length} changes`, tree: tree.sha, parents: [batch.head] }, signal);
            if (commitResponse.status !== 201)
                throw new RemoteReadError(commitResponse.status >= 500 ? "network" : "incomplete");
            const commit = await json(commitResponse);
            if (!record(commit) || !sha(commit.sha))
                throw new RemoteReadError("incomplete");
            const response = await this.#request("PATCH", `/git/refs/heads/${encodePath(this.#branch)}`, { sha: commit.sha, force: false }, signal);
            if (response.status === 409 || response.status === 422)
                return { status: "stale-head" };
            if (response.status !== 200)
                throw new RemoteReadError(response.status >= 500 ? "network" : "incomplete");
            const acknowledgement = await json(response);
            if (!record(acknowledgement) || acknowledgement.ref !== `refs/heads/${this.#branch}` || !record(acknowledgement.object) ||
                acknowledgement.object.type !== "commit" || acknowledgement.object.sha !== commit.sha)
                throw new RemoteReadError("incomplete");
            return { status: "confirmed", commit: commit.sha, parentCommit: batch.head,
                objectIds: Object.fromEntries(writes.flatMap(write => write.sha === null ? [] : [[write.path, write.sha]])) };
        }
        catch (error) {
            if (error instanceof RemoteReadError && error.code === "unauthorized")
                return { status: "credential-rejected" };
            if (error instanceof PermissionError) {
                if (error.code === "write-denied") {
                    try {
                        const response = await this.#request("GET", `/git/ref/heads/${encodePath(this.#branch)}`, undefined, signal);
                        const data = await json(response);
                        if (response.status !== 200 || !record(data) || data.ref !== `refs/heads/${this.#branch}` || !record(data.object) || data.object.type !== "commit" || !sha(data.object.sha))
                            throw new RemoteReadError("incomplete");
                    }
                    catch (readError) {
                        if (readError instanceof PermissionError)
                            return { status: "credential-rejected" };
                        return temporary(readError);
                    }
                }
                return { status: error.code };
            }
            return temporary(error);
        }
    }
}
function temporary(error) {
    return { status: "temporary", reason: error instanceof RemoteReadError && error.code === "rate-limited" ? "rate-limited"
            : (error instanceof RemoteReadError && error.code === "incomplete") || error instanceof TypeError ? "incomplete" : "offline" };
}
export async function blobSha(content) {
    const bytes = new TextEncoder().encode(content);
    const prefix = new TextEncoder().encode(`blob ${bytes.length}\0`);
    const input = new Uint8Array(prefix.length + bytes.length);
    input.set(prefix);
    input.set(bytes, prefix.length);
    return [...new Uint8Array(await crypto.subtle.digest("SHA-1", input.buffer))].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
