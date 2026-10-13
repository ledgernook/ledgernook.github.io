import { NOTIFICATION_BANKS } from "../core/index.js";
/** Resolve record method text from the viewer's existing enabled-method names. */
export function recordPaymentMethodName(method, result) {
    if (method.bankId) {
        const group = result.billingCycleSpending?.groups.find(item => item.bankId === method.bankId);
        if (group?.label && group.label !== method.bankId)
            return group.label;
        if (method.label && method.label !== method.bankId)
            return method.label;
        return NOTIFICATION_BANKS.find(bank => bank.id === method.bankId)?.label ?? "未指定";
    }
    return method.label ?? (method.key === "method:cash" ? "現金" : "未指定");
}
