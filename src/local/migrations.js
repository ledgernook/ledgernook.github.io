export const DB_VERSION = 2;
/** Append row migrations here when DB_VERSION advances; shipped steps remain ordered. */
export const DATABASE_MIGRATIONS = [
    { version: 1, migrate(db) {
            const objects = db.createObjectStore("objects", { keyPath: "key" });
            objects.createIndex("namespace", "namespace");
            for (const field of ["effectiveDate", "project", "category", "subscription"])
                objects.createIndex(field, ["namespace", field]);
            db.createObjectStore("snapshots", { keyPath: "namespace" });
            const drafts = db.createObjectStore("drafts", { keyPath: "key" });
            drafts.createIndex("namespace", "namespace");
        } },
    // The current database version adds a disposable view store; object rows need no changes.
    { version: 2, migrate(db) { db.createObjectStore("views", { keyPath: "namespace" }); } },
];
