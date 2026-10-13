import { isCuratedCategoryIcon } from "./category-icons.js";
import { isBoundedText as validText } from "./validation.js";
export class RuleValidationError extends Error {
    code;
    constructor(code) {
        super(`Invalid rule document: ${code}`);
        this.code = code;
        this.name = "RuleValidationError";
    }
}
export const DEFAULT_CATEGORIES = Object.freeze([
    { id: "dining", label: "餐飲", colorSlot: 1 }, { id: "transport", label: "交通", colorSlot: 2 },
    { id: "shopping", label: "購物", colorSlot: 3 }, { id: "daily", label: "日用品", colorSlot: 4 },
    { id: "entertainment", label: "娛樂", colorSlot: 5 }, { id: "home", label: "居家", colorSlot: 6 },
    { id: "medical", label: "醫療", colorSlot: 7 },
    { id: "other", label: "其他", colorSlot: 9 },
].map((category) => Object.freeze(category)));
const CATEGORY_COLOR_SLOT_COUNT = 16;
const DEFAULT_CATEGORY_COLOR_SLOTS = Object.freeze({
    dining: 1, transport: 2, shopping: 3, daily: 4, entertainment: 5, home: 6, medical: 7, other: 9,
});
function defaultCategoryColorSlot(id) {
    return Object.hasOwn(DEFAULT_CATEGORY_COLOR_SLOTS, id) ? DEFAULT_CATEGORY_COLOR_SLOTS[id] : undefined;
}
/** Resolves stored slots and deterministically fills missing slots in main-category list order without mutating categories. */
export function resolveCategoryColorSlots(categories) {
    const slots = new Map();
    const counts = Array(CATEGORY_COLOR_SLOT_COUNT + 1).fill(0);
    for (const category of categories) {
        if (category.parentId !== undefined)
            continue;
        const slot = category.colorSlot ?? defaultCategoryColorSlot(category.id);
        if (slot === undefined)
            continue;
        slots.set(category.id, slot);
        counts[slot] = counts[slot] + 1;
    }
    for (const category of categories) {
        if (category.parentId !== undefined || slots.has(category.id))
            continue;
        let leastUsed = 1;
        for (let slot = 2; slot <= CATEGORY_COLOR_SLOT_COUNT; slot++) {
            if (counts[slot] < counts[leastUsed])
                leastUsed = slot;
        }
        slots.set(category.id, leastUsed);
        counts[leastUsed] = counts[leastUsed] + 1;
    }
    return slots;
}
/** Returns rule categories with every main slot stored and no subcategory slot. */
export function storeCategoryColorSlots(categories) {
    const slots = resolveCategoryColorSlots(categories);
    return categories.map(category => {
        if (category.parentId !== undefined) {
            if (category.colorSlot === undefined)
                return category;
            const { colorSlot: _colorSlot, ...subcategory } = category;
            return subcategory;
        }
        const colorSlot = slots.get(category.id);
        return category.colorSlot === colorSlot ? category : { ...category, colorSlot };
    });
}
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;
const MODEL_PATTERN = /^[a-z0-9][a-z0-9.-]{0,39}$/;
const EVENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
export function defaultUserRulesDocument() {
    return {
        schemaVersion: 1,
        categories: DEFAULT_CATEGORIES,
        brands: [],
        merchants: {},
        brandCategories: {},
        exceptions: {},
    };
}
export function validateUserRulesDocument(value) {
    if (value === null || value === undefined)
        return defaultUserRulesDocument();
    const document = objectWithKeys(value, ["schemaVersion", "categories", "brands", "merchants", "brandCategories", "exceptions", "mergedCategories"]);
    if (document.schemaVersion !== 1)
        throw new RuleValidationError("schema-version");
    if (!Array.isArray(document.categories) || !Array.isArray(document.brands))
        throw new RuleValidationError("lists");
    const categoryIds = new Set();
    const categories = document.categories.map((raw) => {
        const item = objectWithKeys(raw, ["id", "label", "parentId", "colorSlot", "includeInDaily", "icon"]);
        if (!validId(item.id) || !validText(item.label, 40) || categoryIds.has(item.id))
            throw new RuleValidationError("category");
        categoryIds.add(item.id);
        if (Object.hasOwn(item, "parentId") && !validId(item.parentId))
            throw new RuleValidationError("category-parent");
        if (Object.hasOwn(item, "colorSlot") && (item.parentId !== undefined || !Number.isInteger(item.colorSlot) ||
            item.colorSlot < 1 || item.colorSlot > CATEGORY_COLOR_SLOT_COUNT)) {
            throw new RuleValidationError("category-color-slot");
        }
        const defaultSlot = defaultCategoryColorSlot(item.id);
        if (Object.hasOwn(item, "colorSlot") && defaultSlot !== undefined && item.colorSlot !== defaultSlot) {
            throw new RuleValidationError("category-color-slot");
        }
        if (Object.hasOwn(item, "includeInDaily") && typeof item.includeInDaily !== "boolean")
            throw new RuleValidationError("category-daily");
        if (Object.hasOwn(item, "icon") && item.parentId !== undefined)
            throw new RuleValidationError("category-icon");
        if (Object.hasOwn(item, "icon") && !isCuratedCategoryIcon(item.icon))
            throw new RuleValidationError("category-icon");
        const categoryIcon = isCuratedCategoryIcon(item.icon) ? item.icon : undefined;
        return { id: item.id, label: item.label, ...(Object.hasOwn(item, "parentId") ? { parentId: item.parentId } : {}),
            ...(Object.hasOwn(item, "colorSlot") ? { colorSlot: item.colorSlot } : {}),
            ...(Object.hasOwn(item, "includeInDaily") ? { includeInDaily: item.includeInDaily } : {}),
            ...(categoryIcon ? { icon: categoryIcon } : {}) };
    });
    const byCategoryId = new Map(categories.map(category => [category.id, category]));
    for (const category of categories) {
        if (category.parentId !== undefined &&
            (category.parentId === category.id || !byCategoryId.has(category.parentId) ||
                byCategoryId.get(category.parentId).parentId !== undefined))
            throw new RuleValidationError("category-parent");
    }
    const brandIds = new Set();
    const brandNames = new Set();
    const brands = document.brands.map((raw) => {
        const item = objectWithKeys(raw, ["id", "label", "aliases"]);
        if (!validId(item.id) || brandIds.has(item.id) || !validText(item.label, 40) ||
            !Array.isArray(item.aliases) || item.aliases.length > 20)
            throw new RuleValidationError("brand");
        brandIds.add(item.id);
        const aliases = [];
        for (const name of [item.label, ...item.aliases]) {
            if (!validText(name, 40) || brandNames.has(name))
                throw new RuleValidationError("brand-name");
            brandNames.add(name);
            if (name !== item.label)
                aliases.push(name);
        }
        return { id: item.id, label: item.label, aliases };
    });
    const merchants = validatedMap(document.merchants, (key, entry) => validText(key, 80) && typeof entry === "string" && brandIds.has(entry), "merchants");
    const brandCategories = validatedMap(document.brandCategories, (key, entry) => brandIds.has(key) && typeof entry === "string" && categoryIds.has(entry), "brand-categories");
    const exceptions = validatedMap(document.exceptions, (key, entry) => EVENT_ID_PATTERN.test(key) && typeof entry === "string" && categoryIds.has(entry), "exceptions");
    const merged = Object.hasOwn(document, "mergedCategories")
        ? validatedMap(document.mergedCategories, (key, entry) => validId(key) && !categoryIds.has(key) && typeof entry === "string" && categoryIds.has(entry), "merged-categories")
        : undefined;
    return { schemaVersion: 1, categories, brands, merchants, brandCategories, exceptions,
        ...(merged ? { mergedCategories: merged } : {}) };
}
export function validateAiRule(value) {
    const rule = objectWithKeys(value, ["schemaVersion", "merchant", "brand", "categoryId", "model", "createdAt"]);
    if (rule.schemaVersion !== 1)
        throw new RuleValidationError("schema-version");
    if (!validText(rule.merchant, 80))
        throw new RuleValidationError("merchant");
    if (!validText(rule.brand, 40))
        throw new RuleValidationError("brand");
    if (!validId(rule.categoryId))
        throw new RuleValidationError("category");
    if (typeof rule.model !== "string" || !MODEL_PATTERN.test(rule.model))
        throw new RuleValidationError("model");
    if (typeof rule.createdAt !== "string" || !UTC_PATTERN.test(rule.createdAt) ||
        !Number.isFinite(Date.parse(rule.createdAt)) || new Date(rule.createdAt).toISOString() !== rule.createdAt) {
        throw new RuleValidationError("created-at");
    }
    return { schemaVersion: 1, merchant: rule.merchant, brand: rule.brand,
        categoryId: rule.categoryId, model: rule.model, createdAt: rule.createdAt };
}
/** Current id of a category, following a merge redirect; null when the id is unknown. */
export function canonicalCategoryId(user, categoryId) {
    if (user.categories.some(({ id }) => id === categoryId))
        return categoryId;
    const merged = user.mergedCategories;
    return merged !== undefined && Object.hasOwn(merged, categoryId) ? merged[categoryId] : null;
}
/** The main category containing `categoryId` (itself when it is a main category). */
export function mainCategoryId(user, categoryId) {
    const category = user.categories.find(({ id }) => id === categoryId);
    return category === undefined ? null : category.parentId ?? category.id;
}
/**
 * Rule-based resolution: legacy exception, then user merchant/brand/category rules, then AI
 * suggestion, then unclassified. Explicit per-record detail assignments and refund-link
 * inheritance rank above rules and are applied by effective-record assembly.
 */
export function resolveEventCategory(event, user, aiByMerchant) {
    const categories = new Set(user.categories.map(({ id }) => id));
    const ai = event.merchant === undefined ? undefined : aiByMerchant.get(event.merchant);
    const mappedBrandId = event.merchant === undefined ? undefined : ownValue(user.merchants, event.merchant);
    let brand = mappedBrandId === undefined ? undefined : user.brands.find(({ id }) => id === mappedBrandId);
    if (brand === undefined && ai !== undefined) {
        brand = user.brands.find(({ label, aliases }) => label === ai.brand || aliases.includes(ai.brand));
    }
    const displayBrand = brand === undefined
        ? ai === undefined ? null : { id: null, label: ai.brand }
        : { id: brand.id, label: brand.label };
    const exception = ownValue(user.exceptions, event.id);
    if (exception !== undefined && categories.has(exception)) {
        return { categoryId: exception, brand: displayBrand, source: "exception" };
    }
    const userCategory = brand === undefined ? undefined : ownValue(user.brandCategories, brand.id);
    if (userCategory !== undefined && categories.has(userCategory)) {
        return { categoryId: userCategory, brand: displayBrand, source: "user" };
    }
    if (ai !== undefined) {
        const categoryId = canonicalCategoryId(user, ai.categoryId);
        if (categoryId !== null)
            return { categoryId, brand: displayBrand, source: "ai" };
    }
    return { categoryId: null, brand: displayBrand, source: "none" };
}
function objectWithKeys(value, allowed) {
    if (value === null || typeof value !== "object" || Array.isArray(value) ||
        (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
        throw new RuleValidationError("object");
    }
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string" || !allowed.includes(key)))
        throw new RuleValidationError("unexpected-field");
    return value;
}
function validatedMap(value, valid, code) {
    if (value === null || typeof value !== "object" || Array.isArray(value) ||
        (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null))
        throw new RuleValidationError(code);
    const keys = Reflect.ownKeys(value);
    if (keys.length > 5000 || keys.some((key) => typeof key !== "string" || !valid(key, value[key]))) {
        throw new RuleValidationError(code);
    }
    return Object.fromEntries(Object.entries(value));
}
function validId(value) { return typeof value === "string" && ID_PATTERN.test(value); }
function ownValue(map, key) {
    return Object.hasOwn(map, key) ? map[key] : undefined;
}
