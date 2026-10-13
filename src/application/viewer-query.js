import { selectManualEntryDefaults, snapshotPreferences } from "./preferences.js";
import { assembleEffectiveLedger, buildPeriodReport, buildYearComparison, CURRENCIES, currencyScale, eventPath, installmentBalances, periodForDates, periodForMonth, projectCost, isCalendarDate, buildBillingCycleSpending, buildPinnedCategoryTotals, checkedReportScope, } from "../core/index.js";
import { defaultUserRulesDocument } from "../core/rules.js";
import { SCOPE_REBUILD } from "./sync.js";
/** Organization covers the available local history; explicit assignments and user rules win. */
export function queryViewerOrganization(snapshot, bankDisplayName, asOf) {
    const ledger = assembled(snapshot, asOf).ledger;
    const eligible = ledger.records.filter(record => !record.voided && record.kind !== "refund" && !record.split && record.recurring === null);
    const userRules = snapshot.objects.find(object => object.kind === "user-rules");
    const organiserConfigured = snapshot.objects.some(object => object.kind === "ai-rule") ||
        (userRules?.kind === "user-rules" && userRules.value.brands.some(brand => brand.id.startsWith("ai-")));
    return { organiserConfigured, unclassified: eligible.filter(record => record.categoryId === null).map(record => record.paymentMethod.bankId && bankDisplayName
            ? { ...record, paymentMethod: { ...record.paymentMethod, label: bankDisplayName(record.paymentMethod.bankId) } } : record),
        suggestions: snapshot.objects.flatMap(object => {
            if (object.kind !== "ai-rule")
                return [];
            const matches = eligible.filter(record => record.merchant === object.value.merchant && record.categorySource === "ai");
            return matches.length && matches[0].categoryId ? [{ hash: object.merchantHash, merchant: object.value.merchant,
                    categoryId: matches[0].categoryId, count: matches.length }] : [];
        }) };
}
/** Stable key for one derived view. The namespace is supplied by the store, never by the request. */
export function viewerResultCacheKey(request, buildId, revision, schemaVersion, calculationVersion, timeZone) {
    const period = request.period.kind === "all" ? ["all", timeZone] : request.period.kind === "month"
        ? ["month", request.period.month, timeZone]
        : ["range", request.period.from, request.period.to, timeZone];
    const filters = {
        categoryId: request.filters?.categoryId,
        subscription: request.filters?.subscription,
        projectId: request.filters?.projectId,
        paymentMethod: request.filters?.paymentMethod,
    };
    return JSON.stringify([revision, schemaVersion, calculationVersion, buildId, period, filters, request.asOf, timeZone,
        request.captureBankIds ?? [], checkedReportScope(request.scope)]);
}
function nextDate(date) {
    const [year, month, day] = date.split("-").map(Number);
    const value = new Date(0);
    value.setUTCFullYear(year, month - 1, day + 1);
    value.setUTCHours(0, 0, 0, 0);
    return `${String(value.getUTCFullYear()).padStart(4, "0")}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}
function requestedPeriod(request, timeZone) {
    if (request.kind === "all")
        return null;
    if (request.kind === "month") {
        if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(request.month))
            throw new RangeError("Invalid month");
        const [year, month] = request.month.split("-").map(Number);
        return periodForMonth(year, month, timeZone);
    }
    if (!isCalendarDate(request.from) || !isCalendarDate(request.to) || request.from > request.to)
        throw new RangeError("Invalid date range");
    return periodForDates(request.from, nextDate(request.to), timeZone);
}
// A date advance can change locally derived occurrences without a new snapshot publication.
const assembledSnapshots = new WeakMap();
function assembled(snapshot, horizon) {
    let horizons = assembledSnapshots.get(snapshot);
    if (horizons === undefined) {
        horizons = new Map();
        assembledSnapshots.set(snapshot, horizons);
    }
    const key = horizon ?? "";
    let value = horizons.get(key);
    if (value === undefined) {
        value = { ...assemble(snapshot, horizon), projectCosts: new Map(), sourcePaths: null, searchIndexes: new WeakMap(), earliestDates: new Map(), frequentCurrencyChoices: new Map() };
        horizons.set(key, value);
    }
    return value;
}
function cachedFrequentViewerCurrencies(cached, timeZone, tripCurrency) {
    let trips = cached.frequentCurrencyChoices.get(timeZone);
    if (trips === undefined) {
        trips = new Map();
        cached.frequentCurrencyChoices.set(timeZone, trips);
    }
    const existing = trips.get(tripCurrency);
    if (existing !== undefined)
        return existing;
    const currencies = frequentViewerCurrencies(cached.ledger.records, timeZone, tripCurrency);
    trips.set(tripCurrency, currencies);
    return currencies;
}
function searchSourcePaths(cached) {
    if (cached.sourcePaths === null) {
        const sourcePaths = {};
        for (const record of cached.ledger.records)
            sourcePaths[record.id] = eventPath(record.source);
        cached.sourcePaths = Object.freeze(sourcePaths);
    }
    return cached.sourcePaths;
}
function assemble(snapshot, horizon) {
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
            case "user-rules": userRules = object.value;
        }
    }
    const preferences = snapshot.objects.find(object => object.kind === "preferences");
    const ledger = assembleEffectiveLedger({ sources, details, userRules, aiRules, projects,
        ...(preferences?.kind === "preferences" ? { preferences: preferences.value } : {}), ...(horizon !== undefined ? { horizon } : {}) });
    const revisions = revisionsFrom(snapshot.objects);
    for (const record of ledger.records) {
        const anchorId = record.recurrence?.anchorId;
        if (anchorId === undefined)
            continue;
        if (revisions.detailRevisions[anchorId] !== undefined)
            revisions.detailRevisions[record.id] = revisions.detailRevisions[anchorId];
        if (revisions.detailObjectIds[anchorId] !== undefined)
            revisions.detailObjectIds[record.id] = revisions.detailObjectIds[anchorId];
    }
    const merchantRuleImpact = {};
    for (const record of ledger.records) {
        if (record.recurring === null && record.brand?.id && record.categorySource === "user" && !record.split && !record.voided) {
            merchantRuleImpact[record.brand.id] = (merchantRuleImpact[record.brand.id] ?? 0) + 1;
        }
    }
    return { ledger, revisions, merchantRuleImpact: Object.freeze(merchantRuleImpact) };
}
function revisionsFrom(objects) {
    let ruleRevision = null;
    const detailRevisions = {};
    const detailObjectIds = {};
    for (const object of objects) {
        if (object.kind === "user-rules")
            ruleRevision = object.objectId;
        if (object.kind === "detail") {
            detailRevisions[object.value.eventId] = object.value.operationId;
            detailObjectIds[object.value.eventId] = object.objectId;
        }
    }
    return { ruleRevision, detailRevisions, detailObjectIds };
}
function queryEarliestRecordDate(cached, timeZone) {
    if (!cached.earliestDates.has(timeZone)) {
        const formatter = new Intl.DateTimeFormat("en-CA-u-ca-gregory-nu-latn", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
        let earliest = null;
        for (const record of cached.ledger.records) {
            if (record.recurring !== null)
                continue;
            const date = localOccurrenceDate(record, formatter);
            if (earliest === null || date < earliest)
                earliest = date;
        }
        cached.earliestDates.set(timeZone, earliest);
    }
    return cached.earliestDates.get(timeZone) ?? null;
}
export function queryLocalViewerSnapshot(snapshot, request, localTimeZone = "UTC") {
    const preferences = snapshotPreferences(snapshot, localTimeZone);
    const timeZone = preferences.reportingTimeZone;
    const scope = checkedReportScope(request.scope);
    const period = requestedPeriod(request.period, timeZone);
    const cached = assembled(snapshot, request.asOf);
    const { ledger, revisions } = cached;
    const report = buildPeriodReport(ledger, {
        scope,
        ...(period ? { period } : {}),
        ...(request.filters ? { filters: request.filters } : {}),
        coverage: snapshot.coverage,
        asOf: request.asOf,
    });
    const projectCostKey = `${request.asOf}:${scope}`;
    let projectCosts = cached.projectCosts.get(projectCostKey);
    if (projectCosts === undefined) {
        projectCosts = Object.freeze(ledger.projects.map(project => projectCost(ledger, {
            projectId: project.id, asOf: request.asOf, scope, coverage: snapshot.coverage,
        })));
        cached.projectCosts.set(projectCostKey, projectCosts);
    }
    return Object.freeze({
        recurringRules: recurringRuleSummaries(ledger.records, timeZone),
        report, unrecorded: queryUnrecordedNotifications(snapshot), publicationRevision: snapshot.revision ?? null, ...(snapshot.localChanges ? { localChanges: snapshot.localChanges } : {}),
        earliestRecordDate: queryEarliestRecordDate(cached, timeZone),
        complete: report.complete, lastSynchronized: snapshot.cursor, integrityGaps: report.gaps,
        classificationGaps: Object.freeze({ unclassifiedCount: report.unclassifiedCount, organisableCount: report.organisableUnclassifiedCount }),
        conversionGaps: Object.freeze({ complete: report.total.twd.complete, unconvertedCount: report.total.twd.unconvertedCount, unconverted: report.total.twd.unconverted }),
        asOf: request.asOf, timeZone, categories: ledger.userRules.categories, userRules: ledger.userRules, projects: ledger.projects,
        projectCosts, installmentBalances: installmentBalances(ledger, {
            asOf: request.asOf, scope, ...(request.filters ? { filters: request.filters } : {}),
        }),
        billingCycleSpending: buildBillingCycleSpending(ledger, { preferences: preferences.value, asOf: request.asOf, timeZone, scope, coverage: snapshot.coverage }),
        pinnedCategoryTotals: buildPinnedCategoryTotals(ledger, { preferences: preferences.value, asOf: request.asOf, timeZone, scope, coverage: snapshot.coverage }),
        manualEntryDefaults: selectManualEntryDefaults(snapshot),
        frequentCurrencies: cachedFrequentViewerCurrencies(cached, timeZone, preferences.value.currentTrip?.currency ?? null),
        sourcePaths: Object.freeze(Object.fromEntries(report.records.map((record) => [record.id, eventPath(record.source)]))),
        captureEvidence: captureEvidence(snapshot, request.captureBankIds ?? []),
        merchantRuleImpact: cached.merchantRuleImpact,
        ruleRevision: revisions.ruleRevision, detailRevisions: Object.freeze(revisions.detailRevisions), detailObjectIds: Object.freeze(revisions.detailObjectIds),
    });
}
function recurringRuleSummaries(records, timeZone) {
    const formatter = new Intl.DateTimeFormat("en-CA-u-ca-gregory-nu-latn", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    return Object.freeze(records.flatMap(anchor => {
        if (anchor.voided || anchor.recurring === null)
            return [];
        const { rule, next, ended } = anchor.recurring;
        const terms = rule.revisions?.at(-1) ?? rule;
        const latest = anchor.recurring.occurrences.filter(item => !item.skipped).at(-1);
        return [Object.freeze({ anchorId: anchor.id, anchorOn: localOccurrenceDate(anchor, formatter), latestOccurrenceId: latest ? `${anchor.id}#${latest.id}` : null,
                rule, amountMinor: "amountMinor" in terms ? terms.amountMinor : anchor.amountMinor, currency: anchor.currency,
                categoryId: anchor.categoryId, mainCategoryId: anchor.mainCategoryId, ...(anchor.notes !== undefined ? { notes: anchor.notes } : {}),
                paymentMethod: anchor.paymentMethod, projectId: anchor.projectId, cadence: terms.cadence, ...(terms.end ? { end: terms.end } : {}),
                next: next === null ? null : Object.freeze({ on: next.on, amountMinor: next.amountMinor }), ended })];
    }).sort((left, right) => (left.next === null ? right.next === null ? 0 : 1 : right.next === null ? -1 : left.next.on.localeCompare(right.next.on)) ||
        left.anchorId.localeCompare(right.anchorId)));
}
/** Pure local read of kept captures, newest instant first, then stable identity for ties. */
export function queryUnrecordedNotifications(snapshot) {
    return Object.freeze(snapshot.objects.flatMap(object => object.kind === "unrecorded" ? [object.value] : [])
        .sort((left, right) => right.capturedAt.localeCompare(left.capturedAt) || left.id.localeCompare(right.id)));
}
function captureEvidence(snapshot, requestedBankIds) {
    const lastByBank = new Map();
    for (const bankId of requestedBankIds)
        if (typeof bankId === "string" && bankId.length > 0 && !lastByBank.has(bankId))
            lastByBank.set(bankId, null);
    let hasAnyRecord = false, hasNotificationEvidence = snapshot.objects.some(object => object.kind === "unrecorded");
    for (const object of snapshot.objects) {
        if (object.kind !== "source")
            continue;
        hasAnyRecord = true;
        const event = object.value;
        if (event.source === "manual") {
            if (event.timeProvenance === "capture" || event.timeProvenance === "notification")
                hasNotificationEvidence = true;
            continue;
        }
        if (event.bankId === undefined || event.occurredAt === undefined ||
            (event.timeProvenance !== "capture" && event.timeProvenance !== "notification"))
            continue;
        hasNotificationEvidence = true;
        const previous = lastByBank.get(event.bankId);
        if (previous === undefined || previous === null || event.occurredAt > previous)
            lastByBank.set(event.bankId, event.occurredAt);
    }
    return Object.freeze({ hasAnyRecord, hasNotificationEvidence, lastCapturedAtByBank: Object.freeze(Object.fromEntries([...lastByBank].sort(([left], [right]) => left.localeCompare(right)))) });
}
function emptyReportBucket(scope) {
    return Object.freeze({ scope, recordCount: 0, byCurrency: Object.freeze([]), twd: Object.freeze({
            expenseMinor: 0, refundMinor: 0, netMinor: 0, complete: true, estimated: false, unconvertedCount: 0, unconverted: Object.freeze([]),
        }) });
}
function reportFor(snapshot, period, asOf, timeZone, filters, scope) {
    return buildPeriodReport(assembled(snapshot, asOf).ledger, { period: requestedPeriod(period, timeZone), asOf, scope: checkedReportScope(scope), coverage: snapshot.coverage,
        ...(filters ? { filters } : {}) });
}
function mainCategoryAmounts(report, categories) {
    const byId = new Map(report.categories.filter(category => category.parentId === null).map(category => [category.categoryId, category]));
    return Object.freeze(categories.filter(category => category.parentId === undefined).map(category => {
        const rollup = byId.get(category.id);
        return Object.freeze({ categoryId: category.id, label: category.label, bucket: rollup?.total ?? emptyReportBucket(report.scope) });
    }));
}
function amountSortedRecords(report) {
    const amounts = new Map();
    for (const entry of report.entries) {
        const previous = amounts.get(entry.record.id) ?? { record: entry.record, amountMinor: 0, amountTwdMinor: 0, completeTwd: true };
        previous.amountMinor += entry.amountMinor;
        if (entry.reportingValue === null)
            previous.completeTwd = false;
        else
            previous.amountTwdMinor += entry.reportingValue.amountMinor;
        amounts.set(entry.record.id, previous);
    }
    return Object.freeze([...amounts.values()].map(item => Object.freeze({ record: item.record, amountMinor: item.amountMinor,
        currency: item.record.currency, amountTwdMinor: item.completeTwd ? item.amountTwdMinor : null }))
        .sort((left, right) => {
        if (left.amountTwdMinor !== null && right.amountTwdMinor !== null && left.amountTwdMinor !== right.amountTwdMinor) {
            return right.amountTwdMinor - left.amountTwdMinor;
        }
        if (left.amountTwdMinor === null && right.amountTwdMinor !== null)
            return 1;
        if (left.amountTwdMinor !== null && right.amountTwdMinor === null)
            return -1;
        if (left.currency !== right.currency)
            return left.currency.localeCompare(right.currency);
        if (left.amountMinor !== right.amountMinor)
            return right.amountMinor - left.amountMinor;
        return left.record.id.localeCompare(right.record.id);
    }));
}
/** Report-tab queries are projections of Core's period report; this layer adds no accounting. */
export function queryLocalViewerReportSnapshot(snapshot, request, localTimeZone = "UTC") {
    const timeZone = snapshotPreferences(snapshot, localTimeZone).reportingTimeZone;
    const { ledger } = assembled(snapshot, request.asOf);
    if (request.kind === "year") {
        if (!isCalendarDate(request.asOf))
            throw new RangeError("Invalid as-of date");
        const report = reportFor(snapshot, { kind: "range", from: `${request.asOf.slice(0, 4)}-01-01`, to: request.asOf }, request.asOf, timeZone, request.filters, request.scope);
        return Object.freeze({ kind: request.kind, report, mainCategories: mainCategoryAmounts(report, ledger.userRules.categories) });
    }
    if (request.kind === "year-comparison") {
        const comparison = buildYearComparison(ledger, { ...request, timeZone, coverage: snapshot.coverage });
        return Object.freeze({ kind: request.kind, ...comparison, records: request.filters?.categoryId !== undefined
                ? amountSortedRecords({ entries: comparison.years.flatMap(year => year.report.entries) }) : Object.freeze([]) });
    }
    if (request.kind === "range") {
        const report = reportFor(snapshot, { kind: "range", from: request.from, to: request.to }, request.asOf, timeZone, request.filters, request.scope);
        return Object.freeze({ kind: request.kind, report });
    }
    const report = reportFor(snapshot, request.period, request.asOf, timeZone, { ...request.filters, categoryId: request.categoryId }, request.scope);
    return Object.freeze({ kind: request.kind, report, records: amountSortedRecords(report) });
}
function normalizeSearchText(value) {
    return value.normalize("NFKC").toLowerCase();
}
const currencyScales = [...new Set(Object.values(CURRENCIES).map(currency => currency.scale))];
const reportingCurrencyScale = currencyScale("TWD");
function exactAmountAtScale(whole, fraction, scale) {
    if (/[1-9]/u.test(fraction.slice(scale)))
        return null;
    const minorDigits = fraction.slice(0, scale).padEnd(scale, "0");
    const amountMinor = whole * (10n ** BigInt(scale)) + BigInt(minorDigits || "0");
    return amountMinor > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(amountMinor);
}
function searchTerms(query) {
    const normalized = normalizeSearchText(query).trim();
    if (normalized.length === 0)
        return [];
    return normalized.split(/\s+/u).map(text => {
        const numeric = /^(\d+)(?:\.(\d+))?$/.exec(text.replaceAll(",", ""));
        const fraction = numeric?.[2] ?? "";
        const whole = numeric === null ? null : BigInt(numeric[1]);
        if (whole === null)
            return Object.freeze({ text, amountMinorByScale: null });
        const amountMinorByScale = {};
        for (const scale of currencyScales)
            amountMinorByScale[scale] = exactAmountAtScale(whole, fraction, scale);
        return Object.freeze({ text, amountMinorByScale: Object.freeze(amountMinorByScale) });
    });
}
function exactDecimalEqualsMinor(term, amountMinor, scale) {
    if (term.amountMinorByScale === null || !Number.isSafeInteger(amountMinor))
        return false;
    const expected = term.amountMinorByScale[scale];
    return expected !== null && expected !== undefined && amountMinor === expected;
}
function searchableText(record, categories, projects, bankDisplayName) {
    const values = [record.merchant, record.description, record.notes, record.subscription?.note,
        record.categoryId === null ? undefined : categories.get(record.categoryId),
        record.mainCategoryId === null ? undefined : categories.get(record.mainCategoryId),
        record.projectId === null ? undefined : projects.get(record.projectId),
        record.paymentMethod.label,
        record.paymentMethod.bankId === undefined ? undefined : bankDisplayName(record.paymentMethod.bankId),
        ...(record.split ?? []).flatMap(line => [line.note,
            line.categoryId === null ? undefined : categories.get(line.categoryId),
            line.mainCategoryId === null ? undefined : categories.get(line.mainCategoryId)])];
    return values.flatMap(value => value === undefined ? [] : [normalizeSearchText(value)]);
}
function recordMatchesSearch(indexed, terms, hasNumericTerms) {
    const { record } = indexed;
    for (let index = 0; index < terms.length; index++) {
        const term = terms[index];
        if (indexed.text.includes(term.text))
            continue;
        if (!hasNumericTerms || (!exactDecimalEqualsMinor(term, record.amountMinor, indexed.currencyScale) &&
            (record.reportingValue === null || !exactDecimalEqualsMinor(term, record.reportingValue.amountMinor, reportingCurrencyScale))))
            return false;
    }
    return true;
}
function localOccurrenceDate(record, formatter) {
    if (record.occurrence.precision === "date")
        return record.occurrence.on;
    const parts = formatter.formatToParts(new Date(record.occurrence.at));
    const part = (type) => parts.find(item => item.type === type)?.value ?? "";
    return `${part("year").padStart(4, "0")}-${part("month")}-${part("day")}`;
}
function compareSearchRecords(left, right) {
    if (left.localDate !== right.localDate)
        return left.localDate > right.localDate ? -1 : 1;
    if (left.record.occurrence.precision !== right.record.occurrence.precision) {
        // A time is more precise than a date-only occurrence; the date-only record is not assigned a time.
        return left.record.occurrence.precision === "instant" ? -1 : 1;
    }
    if (left.record.occurrence.precision === "instant" && right.record.occurrence.precision === "instant" &&
        left.record.occurrence.at !== right.record.occurrence.at) {
        return left.record.occurrence.at > right.record.occurrence.at ? -1 : 1;
    }
    return left.record.id < right.record.id ? -1 : left.record.id > right.record.id ? 1 : 0;
}
const orderedViewerRecords = new WeakMap();
/** Display ordering is shared with local search; amount recognition is untouched. */
export function newestViewerRecords(records, timeZone) {
    let zones = orderedViewerRecords.get(records);
    if (!zones) {
        zones = new Map();
        orderedViewerRecords.set(records, zones);
    }
    let ordered = zones.get(timeZone);
    if (!ordered) {
        const formatter = new Intl.DateTimeFormat("en-CA-u-ca-gregory-nu-latn", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
        ordered = Object.freeze(records.map(record => ({ record, localDate: localOccurrenceDate(record, formatter) })).sort(compareSearchRecords).map(item => item.record));
        zones.set(timeZone, ordered);
    }
    return ordered;
}
/** Same recency as the viewer list, across the loaded ledger rather than the report's filters. */
export function frequentViewerCurrencies(records, timeZone, tripCurrency) {
    const currencies = new Set(["TWD"]);
    if (tripCurrency)
        currencies.add(tripCurrency);
    const formatter = new Intl.DateTimeFormat("en-CA-u-ca-gregory-nu-latn", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    const newestByCurrency = new Map();
    for (const record of records) {
        if (record.voided || record.recurring !== null)
            continue;
        const indexed = { record, localDate: localOccurrenceDate(record, formatter) };
        const newest = newestByCurrency.get(record.currency);
        if (newest === undefined || compareSearchRecords(indexed, newest) < 0)
            newestByCurrency.set(record.currency, indexed);
    }
    let recent = 0;
    const newestCurrencies = [...newestByCurrency.values()].sort(compareSearchRecords);
    for (const { record } of newestCurrencies) {
        if (currencies.has(record.currency))
            continue;
        currencies.add(record.currency);
        if (++recent === 5)
            break;
    }
    return Object.freeze([...currencies]);
}
function searchIndex(cached, timeZone, bankDisplayName, formatter) {
    let zones = cached.searchIndexes.get(bankDisplayName);
    if (zones === undefined) {
        zones = new Map();
        cached.searchIndexes.set(bankDisplayName, zones);
    }
    const existing = zones.get(timeZone);
    if (existing !== undefined)
        return existing;
    const { ledger } = cached;
    const categoryLabels = new Map(ledger.userRules.categories.map(category => [category.id, category.label]));
    const projectLabels = new Map(ledger.projects.map(project => [project.id, project.label]));
    const ordered = ledger.records.filter(record => record.recurring === null).map(record => ({
        record,
        text: searchableText(record, categoryLabels, projectLabels, bankDisplayName).join("\n"),
        currencyScale: currencyScale(record.currency),
        localDate: localOccurrenceDate(record, formatter),
    })).sort(compareSearchRecords);
    const index = Object.freeze(ordered.map(({ record, text, currencyScale: scale }) => Object.freeze({ record, text, currencyScale: scale })));
    zones.set(timeZone, index);
    return index;
}
function viewerSearchResult(snapshot, timeZone, cached, records, active, includeSourcePaths, bankDisplayName) {
    const { ledger, revisions } = cached;
    const coverage = Object.freeze({ complete: snapshot.coverage.complete, missing: Object.freeze([...snapshot.coverage.missing]) });
    const displayRecords = records.map(record => record.paymentMethod.bankId
        ? { ...record, paymentMethod: { ...record.paymentMethod, label: bankDisplayName(record.paymentMethod.bankId) } } : record);
    return Object.freeze({
        active, earliestRecordDate: queryEarliestRecordDate(cached, timeZone), records: Object.freeze(displayRecords), count: records.length,
        coverage, rebuilding: coverage.missing.includes(SCOPE_REBUILD),
        publicationRevision: snapshot.revision ?? null, ...(snapshot.localChanges ? { localChanges: snapshot.localChanges } : {}), lastSynchronized: snapshot.cursor, timeZone,
        categories: ledger.userRules.categories, userRules: ledger.userRules, projects: ledger.projects,
        sourcePaths: includeSourcePaths ? searchSourcePaths(cached) : Object.freeze({}),
        ruleRevision: revisions.ruleRevision, detailRevisions: Object.freeze(revisions.detailRevisions), detailObjectIds: Object.freeze(revisions.detailObjectIds),
    });
}
/** Pure text/amount search over one immutable snapshot; no period or remote port is involved. */
export function queryLocalViewerSearchSnapshot(snapshot, request, bankDisplayName, localTimeZone = "UTC") {
    const timeZone = snapshotPreferences(snapshot, localTimeZone).reportingTimeZone;
    const formatter = new Intl.DateTimeFormat("en-CA-u-ca-gregory-nu-latn", {
        timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    });
    const terms = searchTerms(request.query);
    const cached = assembled(snapshot, request.asOf);
    const records = [];
    if (terms.length > 0) {
        const hasNumericTerms = terms.some(term => term.amountMinorByScale !== null);
        for (const indexed of searchIndex(cached, timeZone, bankDisplayName, formatter)) {
            if (!recordMatchesSearch(indexed, terms, hasNumericTerms))
                continue;
            records.push(indexed.record);
        }
    }
    return viewerSearchResult(snapshot, timeZone, cached, records, terms.length > 0, terms.length > 0, bankDisplayName);
}
/** All locally available effective records for the Records tab; independent of period and filters. */
export function queryLocalViewerRecordsSnapshot(snapshot, bankDisplayName, localTimeZone = "UTC", asOf) {
    const timeZone = snapshotPreferences(snapshot, localTimeZone).reportingTimeZone;
    const formatter = new Intl.DateTimeFormat("en-CA-u-ca-gregory-nu-latn", {
        timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    });
    const cached = assembled(snapshot, asOf);
    const records = searchIndex(cached, timeZone, bankDisplayName, formatter).map(indexed => indexed.record);
    return viewerSearchResult(snapshot, timeZone, cached, records, false, true, bankDisplayName);
}
/** Local-only application factory; bank names come from the viewer's injected registry. */
export function createLocalViewerSearch(store, bankDisplayName, localTimeZone = "UTC") {
    return {
        async search(request) { return queryLocalViewerSearchSnapshot(await store.read(), request, bankDisplayName, localTimeZone); },
        async list(asOf) { return queryLocalViewerRecordsSnapshot(await store.read(), bankDisplayName, localTimeZone, asOf); },
    };
}
export function createLocalViewerQuery(store, localTimeZone = "UTC") {
    let observedNotificationEvidence = false;
    return { async query(request) {
            const result = queryLocalViewerSnapshot(await store.read(), request, localTimeZone);
            observedNotificationEvidence ||= result.captureEvidence.hasNotificationEvidence;
            if (!observedNotificationEvidence || result.captureEvidence.hasNotificationEvidence)
                return result;
            // Dismissing an inbox item deletes it; retain evidence already read from the ledger for this session.
            return Object.freeze({ ...result, captureEvidence: Object.freeze({ ...result.captureEvidence, hasNotificationEvidence: true }) });
        } };
}
export function createLocalViewerReportQuery(store, localTimeZone = "UTC") {
    return { async query(request) { return queryLocalViewerReportSnapshot(await store.read(), request, localTimeZone); } };
}
