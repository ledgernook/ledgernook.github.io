export const REMEMBERED_CONNECTION_KEY = "ledgernook.viewer.connection.v1";
/** The credential's sole persistence seam; ledger retention has a separate consent. */
export function createRememberedConnection(storage) {
    const clear = () => { try {
        storage?.removeItem(REMEMBERED_CONNECTION_KEY);
        return storage?.getItem(REMEMBERED_CONNECTION_KEY) == null;
    }
    catch {
        return false;
    } };
    return {
        clear,
        load() {
            try {
                const raw = storage?.getItem(REMEMBERED_CONNECTION_KEY);
                if (raw == null)
                    return null;
                const value = JSON.parse(raw);
                if (!value || typeof value !== "object" || Array.isArray(value))
                    throw new Error();
                const entry = value;
                if (Object.keys(entry).sort().join(",") !== "account,branch,repository,token,writeDenied" ||
                    typeof entry.writeDenied !== "boolean" ||
                    ![entry.account, entry.repository, entry.branch, entry.token].every(item => typeof item === "string" && item.trim()))
                    throw new Error();
                return { account: entry.account.trim(), repository: entry.repository.trim(),
                    branch: entry.branch.trim(), token: entry.token.trim(), writeDenied: entry.writeDenied };
            }
            catch {
                clear();
                return null;
            }
        },
        save(connection, writeDenied) {
            try {
                if (!storage)
                    return false;
                const { account, repository, branch, token } = connection;
                storage.setItem(REMEMBERED_CONNECTION_KEY, JSON.stringify({ account, repository, branch, token, writeDenied }));
                return true;
            }
            catch {
                clear();
                return false;
            }
        },
    };
}
/** Only the exact classic-token repo scope signals broader repository access. No header is retained. */
export function hasClassicRepoScope(headers) {
    return (headers.get("x-oauth-scopes") ?? "").split(/[,\s]+/).includes("repo");
}
