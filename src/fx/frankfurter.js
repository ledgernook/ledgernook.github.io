import { isCalendarDate, isCanonicalUtcInstant, isCurrencyCode, isExchangeRate, REPORTING_CURRENCY } from "../core/index.js";
/** Provider id saved in valuations. */
export const FRANKFURTER_PROVIDER = "frankfurter-v2";
export const FRANKFURTER_ENDPOINT = "https://api.frankfurter.dev/v2/rates";
const CONCURRENCY = 4;
/**
 * Exact decimal text of a JSON rate number: ECMAScript's shortest round-trip representation, with
 * exponent notation expanded textually (no float arithmetic). It equals the provider's text whenever
 * that text has at most 15 significant digits. Null for non-positive/non-finite or out-of-range rates.
 */
export function rateNumberToDecimal(value) {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
        return null;
    let text = String(value);
    const exponent = /^(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(text);
    if (exponent) {
        const digits = `${exponent[1]}${exponent[2] ?? ""}`;
        const point = 1 + Number(exponent[3]);
        text = point <= 0 ? `0.${"0".repeat(-point)}${digits}`
            : point >= digits.length ? `${digits}${"0".repeat(point - digits.length)}` : `${digits.slice(0, point)}.${digits.slice(point)}`;
        if (text.includes("."))
            text = text.replace(/0+$/, "").replace(/\.$/, "");
    }
    return isExchangeRate(text) ? text : null;
}
function failureFor(status) {
    return status === 404 ? "rate-unavailable" : status === 422 ? "rejected" : status === 429 ? "rate-limited" : "provider-error";
}
/** Frankfurter v2 adapter: one GET per distinct currency/date with `base`, `quotes=TWD` and `date` only. */
export function createFrankfurterRates(options) {
    const endpoint = options.endpoint ?? FRANKFURTER_ENDPOINT;
    async function readOne(request, signal) {
        const failed = (code) => Object.freeze({ status: "failed", request, code });
        if (!isCurrencyCode(request.currency) || request.currency === REPORTING_CURRENCY || !isCalendarDate(request.date))
            return failed("unsupported-request");
        if (signal?.aborted)
            return failed("cancelled");
        const url = `${endpoint}?base=${encodeURIComponent(request.currency)}&quotes=${REPORTING_CURRENCY}&date=${encodeURIComponent(request.date)}`;
        let response;
        try {
            response = await options.fetch(url, {
                method: "GET", headers: { Accept: "application/json" }, credentials: "omit", referrerPolicy: "no-referrer",
                ...(signal ? { signal } : {}),
            });
        }
        catch (error) {
            return failed(signal?.aborted || (error instanceof Error && error.name === "AbortError") ? "cancelled" : "network");
        }
        if (!response.ok)
            return failed(failureFor(response.status));
        let body;
        try {
            body = await response.json();
        }
        catch (error) {
            return failed(signal?.aborted || (error instanceof Error && error.name === "AbortError") ? "cancelled" : "invalid-response");
        }
        if (!Array.isArray(body) || body.length !== 1 || typeof body[0] !== "object" || body[0] === null || Array.isArray(body[0])) {
            return failed("invalid-response");
        }
        const item = body[0];
        const rate = rateNumberToDecimal(item.rate);
        if (item.base !== request.currency || item.quote !== REPORTING_CURRENCY || !isCalendarDate(item.date) || item.date > request.date || rate === null) {
            return failed("invalid-response");
        }
        const retrievedAt = options.now();
        if (!isCanonicalUtcInstant(retrievedAt))
            throw new RangeError("Invalid retrieval instant");
        return Object.freeze({
            status: "found", request,
            quote: Object.freeze({ currency: request.currency, requestedOn: request.date, effectiveOn: item.date, rate, provider: FRANKFURTER_PROVIDER, retrievedAt }),
        });
    }
    return {
        async readRates(requests, signal) {
            const unique = new Map();
            for (const request of requests) {
                const key = `${request.currency}/${request.date}`;
                if (!unique.has(key))
                    unique.set(key, Object.freeze({ currency: request.currency, date: request.date }));
            }
            const pending = [...unique.values()];
            const results = new Array(pending.length);
            let next = 0;
            const worker = async () => {
                while (next < pending.length) {
                    const index = next++;
                    results[index] = await readOne(pending[index], signal);
                }
            };
            await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, worker));
            return Object.freeze(results);
        },
    };
}
