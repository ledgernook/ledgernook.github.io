import { isCuratedCategoryIcon, resolveCategoryColorSlots } from "../core/index.js";
import { categoryColor } from "./skins/nook.js";
const CATEGORY_ICONS = {
    food: "ramen_dining", transit: "directions_subway", shop: "shopping_bag", fun: "headphones", med: "medication",
    dining: "ramen_dining", transport: "directions_subway", shopping: "shopping_bag", daily: "soap", entertainment: "headphones",
    home: "chair", medical: "medication", work: "work", other: "category",
};
/** A custom icon is editable only on main categories that do not own a fixed built-in symbol. */
export function isUserAddedMainCategory(categories, id) {
    const category = categories.find(item => item.id === id);
    return category !== undefined && category.parentId === undefined && !Object.hasOwn(CATEGORY_ICONS, category.id);
}
/** Main categories use stored or read-resolved slots; subcategories inherit the parent's color. */
export function categoryPresentation(categories, id) {
    const category = categories.find(item => item.id === id);
    const main = category?.parentId ? categories.find(item => item.id === category.parentId) : category;
    return { id, label: category ? main && main.id !== category.id ? `${main.label} › ${category.label}` : category.label : "未分類",
        icon: main ? Object.hasOwn(CATEGORY_ICONS, main.id) ? CATEGORY_ICONS[main.id]
            : isCuratedCategoryIcon(main.icon) ? main.icon : "bookmark" : "question_mark",
        color: categoryColor(main ? main.colorSlot ?? resolveCategoryColorSlots(categories).get(main.id) ?? null : null) };
}
