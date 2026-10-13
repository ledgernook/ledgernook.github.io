export const RETENTION_CONSENT_PREFIX = "ledgernook.viewer.retention.v1:";
/** Separate device-ledger consent, scoped identically to the existing local namespace. */
export function connectionRetentionKey(connection, origin) {
    const scope = JSON.stringify([origin, connection.account.toLowerCase(), connection.repository.toLowerCase(), connection.branch]);
    return `${RETENTION_CONSENT_PREFIX}${encodeURIComponent(scope)}`;
}
