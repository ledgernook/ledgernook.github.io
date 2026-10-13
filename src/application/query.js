import { snapshotPreferences } from "./preferences.js";
import { assembleEffectiveLedger, buildPeriodReport, checkedReportScope, defaultUserRulesDocument, isCalendarDate, periodForDates, } from "../core/index.js";
/** Pure query over one local snapshot; makes no remote request. */
export function queryLocalSnapshot(snapshot, query, localTimeZone = "UTC") {
    if (!isCalendarDate(query.asOf))
        throw new RangeError("Invalid as-of date");
    const timeZone = snapshotPreferences(snapshot, localTimeZone).reportingTimeZone;
    const period = query.period ? periodForDates(query.period.from, query.period.to, timeZone) : undefined;
    const sources = [];
    const details = [];
    const projects = [];
    const aiRules = new Map();
    let userRules = defaultUserRulesDocument();
    for (const object of snapshot.objects) {
        switch (object.kind) {
            case "source":
                sources.push(object.value);
                break;
            case "detail":
                details.push({ partition: object.partition, value: object.value });
                break;
            case "project":
                projects.push(object.value);
                break;
            case "ai-rule":
                if (!aiRules.has(object.value.merchant))
                    aiRules.set(object.value.merchant, object.value);
                break;
            case "user-rules":
                userRules = object.value;
                break;
        }
    }
    const ledger = assembleEffectiveLedger({ sources, details, userRules, aiRules, projects, preferences: snapshotPreferences(snapshot, "UTC").value });
    const report = buildPeriodReport(ledger, {
        scope: checkedReportScope(query.scope),
        ...(period ? { period } : {}),
        ...(query.filters ? { filters: query.filters } : {}),
        coverage: snapshot.coverage,
        asOf: query.asOf,
    });
    return Object.freeze({
        report,
        complete: report.complete,
        lastSynchronized: snapshot.cursor,
        integrityGaps: report.gaps,
        classificationGaps: Object.freeze({ unclassifiedCount: report.unclassifiedCount, organisableCount: report.organisableUnclassifiedCount }),
        conversionGaps: Object.freeze({
            complete: report.total.twd.complete, unconvertedCount: report.total.twd.unconvertedCount, unconverted: report.total.twd.unconverted,
        }),
        asOf: query.asOf,
        timeZone,
    });
}
/** Reference query port over a local snapshot store (no indexes; adapters may add them). */
export function createLocalLedgerQuery(store, localTimeZone = "UTC") {
    return { async query(query) { return queryLocalSnapshot(await store.read(), query, localTimeZone); } };
}
