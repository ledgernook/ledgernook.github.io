/** Inert DOM builders shared by the viewer screens; text is always assigned via `textContent`. */
export const el = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined)
        node.textContent = text;
    if (className)
        node.className = className;
    return node;
};
