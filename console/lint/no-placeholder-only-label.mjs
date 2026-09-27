/* gz/no-placeholder-only-label (M19-S01) — an input, select or textarea must carry a programmatic
   name: a wrapping <label>, a <label htmlFor> naming its id, aria-label or aria-labelledby. A
   placeholder is not a name (it disappears as soon as someone types, and a runner reading the box
   would name it by its value). Reported: "named only by its placeholder" when a placeholder is the
   only thing naming it, "has no label" otherwise. A spread ({...props}) is trusted. */

const CONTROLS = new Set(["input", "select", "textarea"]);
const SKIP_TYPES = new Set(["hidden", "submit", "button", "reset", "image"]);

const attr = (node, name) => node.attributes.find(a => a.type === "JSXAttribute" && a.name && a.name.name === name);
const literal = a => {
  if (!a || !a.value) return null;
  if (a.value.type === "Literal") return String(a.value.value);
  if (a.value.type === "JSXExpressionContainer" && a.value.expression.type === "Literal") return String(a.value.expression.value);
  if (a.value.type === "JSXExpressionContainer" && a.value.expression.type === "TemplateLiteral"
    && a.value.expression.expressions.length === 0) return a.value.expression.quasis[0].value.cooked;
  return null;
};

export default {
  meta: {
    type: "problem",
    docs: { description: "inputs, selects and textareas need a label, not only a placeholder" },
    messages: {
      placeholder: "<{{el}}> is named only by its placeholder — wrap it in a <label>, point a <label htmlFor> at its id, or give it aria-label.",
      none: "<{{el}}> has no label — wrap it in a <label>, point a <label htmlFor> at its id, or give it aria-label.",
    },
    schema: [{ type: "object", properties: { labelComponents: { type: "array", items: { type: "string" } } }, additionalProperties: false }],
  },
  create(context) {
    /* components that render a <label> around their children (components/ui Field) */
    const wrappers = new Set(["label", ...((context.options[0] || {}).labelComponents || [])]);
    const pending = [];
    const htmlFor = new Set();
    let dynamicFor = false;
    return {
      JSXOpeningElement(node) {
        const el = node.name && node.name.type === "JSXIdentifier" ? node.name.name : null;
        if (el === "label") {
          const f = attr(node, "htmlFor");
          if (f) { const v = literal(f); if (v == null) dynamicFor = true; else htmlFor.add(v); }
          return;
        }
        if (!el || !CONTROLS.has(el)) return;
        if (node.attributes.some(a => a.type === "JSXSpreadAttribute")) return;
        const type = literal(attr(node, "type"));
        if (el === "input" && type && SKIP_TYPES.has(type)) return;
        if (attr(node, "aria-label") || attr(node, "aria-labelledby")) return;
        /* inside a <label> element */
        for (let p = node.parent && node.parent.parent; p; p = p.parent) {
          if (p.type === "JSXElement" && p.openingElement.name.type === "JSXIdentifier" && wrappers.has(p.openingElement.name.name)) return;
        }
        const id = attr(node, "id");
        pending.push({ node, el, id: id ? literal(id) : null, dynId: !!id && literal(id) == null, ph: !!attr(node, "placeholder") });
      },
      "Program:exit"() {
        for (const x of pending) {
          if (x.id != null && htmlFor.has(x.id)) continue;
          if ((x.dynId || x.id != null) && dynamicFor) continue;   /* a computed htmlFor may name it: trusted */
          context.report({ node: x.node, messageId: x.ph ? "placeholder" : "none", data: { el: x.el } });
        }
      },
    };
  },
};
