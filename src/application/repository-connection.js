/** Typed repository-discovery failure. It contains no credential or response body. */
export class RepositoryCatalogError extends Error {
    code;
    constructor(code) {
        super(`GitHub repository listing: ${code}`);
        this.code = code;
        this.name = "RepositoryCatalogError";
    }
}
/** Lists repositories the token can reach and turns transport failures into safe, distinct outcomes. */
export async function inspectTokenRepositories(catalog, token) {
    try {
        const snapshot = await catalog.list(token);
        if (snapshot.repositories.length === 0)
            return { status: "no-repositories" };
        if (snapshot.broadAccessHint)
            return { status: "broad-access", account: snapshot.account, repositories: snapshot.repositories, broaderAccess: true,
                broadAccessReason: "classic-repo" };
        return { status: "ready", account: snapshot.account, repositories: snapshot.repositories, broaderAccess: false };
    }
    catch (error) {
        if (error instanceof RepositoryCatalogError) {
            if (error.code === "unauthorized")
                return { status: "invalid-token" };
            if (error.code === "network")
                return { status: "network-failure" };
            if (error.code === "forbidden")
                return { status: "access-denied" };
        }
        return { status: "unavailable" };
    }
}
/** Selects a listed repository; an omitted branch uses GitHub's default branch. */
export function selectRepository(inspection, fullName, branchOverride) {
    if (inspection.status !== "ready" && inspection.status !== "broad-access")
        return { status: "repository-unavailable" };
    const repository = inspection.repositories.find(item => item.fullName === fullName);
    if (!repository)
        return { status: "repository-unavailable" };
    const branch = branchOverride?.trim() || repository.defaultBranch;
    if (!isSupportedBranch(branch))
        return { status: "invalid-branch" };
    return { status: "selected", account: inspection.account, owner: repository.owner, repository: repository.name, branch };
}
function isSupportedBranch(branch) {
    return /^[A-Za-z0-9._/-]+$/.test(branch) && !branch.startsWith("/") && !branch.endsWith("/") &&
        !branch.includes("..") && !branch.includes("//");
}
