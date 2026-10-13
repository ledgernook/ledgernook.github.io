/** Material Symbols Rounded choices for user-created main categories. */
export const CURATED_CATEGORY_ICONS = Object.freeze([
    "child_care", "pets", "flight", "work", "school", "fitness_center", "local_cafe", "phone_iphone",
    "card_giftcard", "savings", "local_gas_station", "volunteer_activism", "checkroom", "sports_esports",
    "spa", "local_parking", "restaurant", "local_grocery_store", "train", "theaters", "menu_book",
    "celebration", "home_repair_service", "cleaning_services",
]);
export function isCuratedCategoryIcon(value) {
    return typeof value === "string" && CURATED_CATEGORY_ICONS.includes(value);
}
