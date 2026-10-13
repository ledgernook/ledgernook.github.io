import { isCuratedCategoryIcon } from "./category-icons.js";
import { storeCategoryColorSlots, validateUserRulesDocument } from "./rules.js";
export class RuleConflictError extends Error {
    constructor() { super("此規則已在其他分頁變更，請重新檢查後再試。"); this.name = "RuleConflictError"; }
}
function copy(doc) {
    return { schemaVersion: 1, categories: doc.categories.map(item => ({ ...item })),
        brands: doc.brands.map(item => ({ ...item, aliases: [...item.aliases] })),
        merchants: { ...doc.merchants }, brandCategories: { ...doc.brandCategories }, exceptions: { ...doc.exceptions },
        ...(doc.mergedCategories ? { mergedCategories: { ...doc.mergedCategories } } : {}) };
}
function own(map, key) { return Object.hasOwn(map, key) ? map[key] : null; }
/** The operation's complete conflict target, shared by base checks and successor replay. */
export function ruleOperationTargetValue(doc, op) {
    switch (op.kind) {
        case "assignMerchant": return own(doc.merchants, op.merchant);
        case "brandCategory": return own(doc.brandCategories, op.brandId);
        case "brandCategoryDelete": return {
            brand: doc.brands.find(item => item.id === op.brandId) ?? null,
            categoryId: own(doc.brandCategories, op.brandId),
        };
        case "acceptSuggestion": return {
            merchantBrandId: own(doc.merchants, op.merchant),
            brand: doc.brands.find(item => item.id === op.brandId) ?? null,
            matchingBrands: doc.brands.filter(item => item.label === op.brandLabel || item.aliases.includes(op.brandLabel)),
            categoryId: own(doc.brandCategories, op.brandId),
            targetCategory: doc.categories.find(item => item.id === op.categoryId) ?? null,
        };
        case "exception": return own(doc.exceptions, op.eventId);
        case "brandAdd": return { brand: doc.brands.find(item => item.id === op.id) ?? null, categoryId: own(doc.brandCategories, op.id) };
        case "aliasAdd":
        case "aliasRemove": return doc.brands.find(item => item.id === op.brandId) ?? null;
        case "categoryAdd":
        case "categoryRename":
        case "categoryIcon":
        case "categoryMove":
        case "categoryDaily": return doc.categories.find(item => item.id === op.id) ?? null;
        case "categoryMerge": return { category: doc.categories.find(item => item.id === op.id) ?? null,
            target: doc.categories.find(item => item.id === op.targetId) ?? null,
            children: doc.categories.filter(item => item.parentId === op.id).sort((a, b) => a.id.localeCompare(b.id)),
            brands: Object.entries(doc.brandCategories).filter(([, value]) => value === op.id).sort(),
            exceptions: Object.entries(doc.exceptions).filter(([, value]) => value === op.id).sort(),
            merged: Object.entries(doc.mergedCategories ?? {}).filter(([, value]) => value === op.id).sort(),
            redirect: own(doc.mergedCategories ?? {}, op.id) };
    }
}
export function ruleOperationSatisfied(doc, op) {
    switch (op.kind) {
        case "assignMerchant": return own(doc.merchants, op.merchant) === op.brandId;
        case "brandCategory": return own(doc.brandCategories, op.brandId) === op.categoryId;
        case "brandCategoryDelete": return doc.brands.some(item => item.id === op.brandId) &&
            !Object.hasOwn(doc.brandCategories, op.brandId);
        case "acceptSuggestion": {
            const brand = doc.brands.find(item => item.id === op.brandId);
            return own(doc.merchants, op.merchant) === op.brandId && brand !== undefined &&
                (brand.label === op.brandLabel || brand.aliases.includes(op.brandLabel)) &&
                own(doc.brandCategories, op.brandId) === op.categoryId;
        }
        case "brandAdd": {
            const brand = doc.brands.find(item => item.id === op.id);
            return brand !== undefined && brand.label === op.label && own(doc.brandCategories, op.id) === op.categoryId;
        }
        case "aliasAdd":
        case "aliasRemove": {
            const brand = doc.brands.find(item => item.id === op.brandId);
            return brand !== undefined && (op.kind === "aliasAdd" ? brand.aliases.includes(op.alias) : !brand.aliases.includes(op.alias));
        }
        case "categoryAdd": {
            const category = doc.categories.find(item => item.id === op.id);
            return category !== undefined && category.label === op.label && category.parentId === op.parentId && category.icon === op.icon;
        }
        case "categoryRename": return doc.categories.find(item => item.id === op.id)?.label === op.label;
        case "categoryIcon": {
            const category = doc.categories.find(item => item.id === op.id);
            return category !== undefined && (category.icon ?? null) === op.icon;
        }
        case "categoryDaily": {
            const category = doc.categories.find(item => item.id === op.id);
            return category !== undefined && (category.includeInDaily ?? true) === op.includeInDaily;
        }
        case "categoryMove": {
            const category = doc.categories.find(item => item.id === op.id);
            return category !== undefined && (category.parentId ?? null) === op.parentId;
        }
        case "categoryMerge": return !doc.categories.some(item => item.id === op.id) && doc.mergedCategories?.[op.id] === op.targetId;
        case "exception": return own(doc.exceptions, op.eventId) === op.categoryId;
    }
}
export function applyRuleOperation(current, op, base) {
    if (ruleOperationSatisfied(current, op))
        return validateUserRulesDocument(current);
    if (base && JSON.stringify(ruleOperationTargetValue(base, op)) !== JSON.stringify(ruleOperationTargetValue(current, op)))
        throw new RuleConflictError();
    const next = copy(current);
    const categories = [...next.categories];
    const brands = [...next.brands];
    const merchants = { ...next.merchants };
    const brandCategories = { ...next.brandCategories };
    const exceptions = { ...next.exceptions };
    const mergedCategories = { ...next.mergedCategories };
    switch (op.kind) {
        case "assignMerchant":
            if (op.brandId === null)
                delete merchants[op.merchant];
            else
                merchants[op.merchant] = op.brandId;
            break;
        case "brandCategory":
            brandCategories[op.brandId] = op.categoryId;
            break;
        case "brandCategoryDelete":
            if (!brands.some(item => item.id === op.brandId) || !Object.hasOwn(brandCategories, op.brandId))
                throw new RuleConflictError();
            delete brandCategories[op.brandId];
            break;
        case "acceptSuggestion": {
            if (Object.hasOwn(merchants, op.merchant))
                throw new RuleConflictError();
            const existing = brands.find(item => item.id === op.brandId);
            if (existing) {
                if ((existing.label !== op.brandLabel && !existing.aliases.includes(op.brandLabel)) ||
                    brandCategories[op.brandId] !== op.categoryId)
                    throw new RuleConflictError();
            }
            else {
                if (brands.some(item => item.label === op.brandLabel || item.aliases.includes(op.brandLabel)))
                    throw new RuleConflictError();
                brands.push({ id: op.brandId, label: op.brandLabel, aliases: [] });
                brandCategories[op.brandId] = op.categoryId;
            }
            merchants[op.merchant] = op.brandId;
            break;
        }
        case "brandAdd":
            if (brands.some(item => item.id === op.id))
                throw new RuleConflictError();
            brands.push({ id: op.id, label: op.label, aliases: [] });
            brandCategories[op.id] = op.categoryId;
            break;
        case "aliasAdd":
        case "aliasRemove": {
            const index = brands.findIndex(item => item.id === op.brandId);
            if (index < 0)
                throw new RuleConflictError();
            const brand = brands[index];
            brands[index] = { ...brand, aliases: op.kind === "aliasAdd"
                    ? brand.aliases.includes(op.alias) ? [...brand.aliases] : [...brand.aliases, op.alias]
                    : brand.aliases.filter(value => value !== op.alias) };
            break;
        }
        case "categoryAdd":
            if (op.icon !== undefined && !isCuratedCategoryIcon(op.icon))
                throw new RuleConflictError();
            if (categories.some(item => item.id === op.id))
                throw new RuleConflictError();
            categories.push({ id: op.id, label: op.label, ...(op.parentId ? { parentId: op.parentId } : {}), ...(op.icon ? { icon: op.icon } : {}) });
            break;
        case "categoryRename": {
            const index = categories.findIndex(item => item.id === op.id);
            if (index < 0)
                throw new RuleConflictError();
            categories[index] = { ...categories[index], label: op.label };
            break;
        }
        case "categoryIcon": {
            const index = categories.findIndex(item => item.id === op.id);
            if (index < 0 || categories[index].parentId !== undefined || (op.icon !== null && !isCuratedCategoryIcon(op.icon)))
                throw new RuleConflictError();
            if (op.icon === null) {
                const { icon: _icon, ...category } = categories[index];
                categories[index] = category;
            }
            else
                categories[index] = { ...categories[index], icon: op.icon };
            break;
        }
        case "categoryDaily": {
            const index = categories.findIndex(item => item.id === op.id);
            if (index < 0)
                throw new RuleConflictError();
            categories[index] = { ...categories[index], includeInDaily: op.includeInDaily };
            break;
        }
        case "categoryMove": {
            const index = categories.findIndex(item => item.id === op.id);
            if (index < 0)
                throw new RuleConflictError();
            if (op.parentId === null) {
                const { parentId: _old, ...rest } = categories[index];
                categories[index] = rest;
            }
            else {
                const { parentId: _old, colorSlot: _oldSlot, icon: _oldIcon, ...rest } = categories[index];
                categories[index] = { ...rest, parentId: op.parentId };
            }
            break;
        }
        case "categoryMerge": {
            const source = categories.find(item => item.id === op.id);
            const target = categories.find(item => item.id === op.targetId);
            // A main category cannot merge into a subcategory: its children would exceed two levels.
            if (!source || !target || op.id === op.targetId ||
                source.parentId === undefined && target.parentId !== undefined)
                throw new RuleConflictError();
            const index = categories.findIndex(item => item.id === op.id);
            categories.splice(index, 1);
            for (let child = 0; child < categories.length; child++) {
                if (categories[child].parentId === op.id)
                    categories[child] = { ...categories[child], parentId: op.targetId };
            }
            for (const [key, value] of Object.entries(brandCategories))
                if (value === op.id)
                    brandCategories[key] = op.targetId;
            for (const [key, value] of Object.entries(exceptions))
                if (value === op.id)
                    exceptions[key] = op.targetId;
            for (const [key, value] of Object.entries(mergedCategories))
                if (value === op.id)
                    mergedCategories[key] = op.targetId;
            mergedCategories[op.id] = op.targetId;
            break;
        }
        case "exception":
            if (op.categoryId === null)
                delete exceptions[op.eventId];
            else
                exceptions[op.eventId] = op.categoryId;
    }
    return validateUserRulesDocument({ schemaVersion: 1, categories: storeCategoryColorSlots(categories), brands, merchants, brandCategories, exceptions,
        ...(Object.keys(mergedCategories).length ? { mergedCategories } : {}) });
}
export function newBrandId(label, existing) {
    const slug = label.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
    if (slug && !existing.brands.some(brand => brand.id === slug))
        return slug;
    for (;;) {
        const id = `b-${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
        if (!existing.brands.some(brand => brand.id === id))
            return id;
    }
}
export function newCategoryId(label, existing) {
    const slug = label.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
    // Retired (merged) ids stay reserved so a redirect never changes meaning.
    const taken = (id) => existing.categories.some(item => item.id === id) ||
        (existing.mergedCategories !== undefined && Object.hasOwn(existing.mergedCategories, id));
    if (slug && !taken(slug))
        return slug;
    for (;;) {
        const id = `c-${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
        if (!taken(id))
            return id;
    }
}
