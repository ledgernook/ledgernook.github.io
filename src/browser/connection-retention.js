import { connectionRetentionKey } from "../application/connection-retention.js";
export function createLedgerRetentionConsent(storage, origin) {
    return {
        load(connection) {
            try {
                return storage?.getItem(connectionRetentionKey(connection, origin)) === "yes";
            }
            catch {
                return false;
            }
        },
        save(connection) {
            try {
                if (!storage)
                    return false;
                storage.setItem(connectionRetentionKey(connection, origin), "yes");
                return this.load(connection);
            }
            catch {
                return false;
            }
        },
        clear(connection) {
            const key = connectionRetentionKey(connection, origin);
            try {
                storage?.removeItem(key);
                return storage?.getItem(key) == null;
            }
            catch {
                return false;
            }
        },
    };
}
