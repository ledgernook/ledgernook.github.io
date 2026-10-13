export function svgNode(tag, attributes = {}, ...children) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [key, value] of Object.entries(attributes))
        node.setAttribute(key, String(value));
    node.append(...children);
    return node;
}
