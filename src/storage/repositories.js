import { RepositoryCatalogError, } from "../application/repository-connection.js";
const API = "https://api.github.com";
const PAGE_SIZE = 100;
const MAX_PAGES = 100;
/** Stateless GitHub repository discovery. Tokens are passed per call and never appear in URLs or results. */
export class GitHubRepositoryCatalog {
    fetcher;
    constructor(fetcher) {
        this.fetcher = fetcher;
    }
    async list(token) {
        if (!token || /[\r\n]/.test(token))
            throw new RepositoryCatalogError("unauthorized");
        const headers = {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${token}`,
            "X-GitHub-Api-Version": "2022-11-28",
        };
        const user = await this.get("/user", headers);
        const account = field(user.body, "login");
        if (!account)
            throw new RepositoryCatalogError("incomplete");
        let broadAccessHint = hasClassicRepoScope(user.headers);
        const repositories = [];
        const seen = new Set();
        for (let page = 1; page <= MAX_PAGES; page += 1) {
            const query = new URLSearchParams({
                visibility: "all",
                affiliation: "owner,collaborator,organization_member",
                per_page: String(PAGE_SIZE),
                page: String(page),
            });
            const response = await this.get(`/user/repos?${query.toString()}`, headers);
            broadAccessHint ||= hasClassicRepoScope(response.headers);
            if (!Array.isArray(response.body) || response.body.length > PAGE_SIZE)
                throw new RepositoryCatalogError("incomplete");
            for (const value of response.body) {
                const repository = parseRepository(value);
                if (!repository || seen.has(repository.fullName))
                    throw new RepositoryCatalogError("incomplete");
                seen.add(repository.fullName);
                repositories.push(repository);
            }
            if (response.body.length < PAGE_SIZE)
                return { account, repositories, broadAccessHint };
        }
        throw new RepositoryCatalogError("incomplete");
    }
    async get(path, headers) {
        let response;
        try {
            response = await this.fetcher(`${API}${path}`, { method: "GET", headers });
        }
        catch {
            throw new RepositoryCatalogError("network");
        }
        if (response.status !== 200) {
            throw new RepositoryCatalogError(response.status === 401 ? "unauthorized" : response.status === 403 ? "forbidden" : "remote-error");
        }
        try {
            return { body: await response.json(), headers: response.headers };
        }
        catch {
            throw new RepositoryCatalogError("incomplete");
        }
    }
}
function parseRepository(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return null;
    const item = value;
    const ownerValue = item.owner;
    if (!ownerValue || typeof ownerValue !== "object" || Array.isArray(ownerValue))
        return null;
    const owner = ownerValue.login;
    const name = item.name;
    const fullName = item.full_name;
    const branch = item.default_branch;
    if (typeof owner !== "string" || !owner.trim() || typeof name !== "string" || !name.trim() ||
        typeof fullName !== "string" || fullName !== `${owner}/${name}` || typeof item.private !== "boolean" ||
        typeof branch !== "string" || !branch.trim())
        return null;
    return { owner, name, fullName, isPrivate: item.private, defaultBranch: branch };
}
function field(value, key) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return null;
    const result = value[key];
    return typeof result === "string" && result.trim() ? result : null;
}
function hasClassicRepoScope(headers) {
    return (headers?.get("x-oauth-scopes") ?? "").split(/[\s,]+/).includes("repo");
}
