import { LedgerPathError, validateLedgerObjectAtPath, UNRECORDED_PATH_PATTERN, PROJECT_PATH_PATTERN, } from "../core/index.js";
const OBJECT_ID = /^[0-9a-f]{40}$/;
const OPERATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Typed remote failure; carries no response bodies or credentials. */
export class RemoteReadError extends Error {
    code;
    constructor(code) {
        super(`Remote ledger read: ${code}`);
        this.code = code;
        this.name = "RemoteReadError";
    }
}
export const MAX_COMMAND_WRITES = 100;
/**
 * Validate a command before persistence: identities, allowed paths (source records create-only,
 * details, projects, `rules/user.json`; never AI rules), Core schemas and path relationships.
 * Detail writes carry the command's `operationId` as their revision identity.
 */
export function checkMutationCommand(command) {
    if (!command || typeof command !== "object" || typeof command.operationId !== "string" || !OPERATION_ID.test(command.operationId) ||
        typeof command.expectedBase?.commit !== "string" || !OBJECT_ID.test(command.expectedBase.commit) ||
        !Array.isArray(command.writes) || command.writes.length === 0 || command.writes.length > MAX_COMMAND_WRITES ||
        !command.writes.every(write => write && typeof write === "object" && typeof write.path === "string") ||
        new Set(command.writes.map(write => write.path)).size !== command.writes.length)
        return "invalid-command";
    if (command.ruleOperation !== undefined && (command.writes.length !== 1 || command.writes[0]?.path !== "rules/user.json"))
        return "invalid-command";
    for (const write of command.writes) {
        if (write.expectedObjectId !== null && (typeof write.expectedObjectId !== "string" || !OBJECT_ID.test(write.expectedObjectId))) {
            return "invalid-command";
        }
        if (write.strict !== undefined && write.strict !== true)
            return "invalid-command";
        if (write.value === null) {
            if (!UNRECORDED_PATH_PATTERN.test(write.path) && !PROJECT_PATH_PATTERN.test(write.path))
                return "path-not-allowed";
            if (write.expectedObjectId === null)
                return "invalid-command";
            continue;
        }
        let object;
        try {
            object = validateLedgerObjectAtPath(write.path, write.value);
        }
        catch (error) {
            return error instanceof LedgerPathError && error.code === "unknown-path" ? "path-not-allowed" : "invalid-object";
        }
        if (object.kind === "ai-rule" || object.kind === "unrecorded")
            return "path-not-allowed";
        if (object.kind === "source" && write.expectedObjectId !== null)
            return "path-not-allowed";
        if (object.kind === "detail" && object.value.operationId !== command.operationId)
            return "invalid-object";
    }
    return null;
}
