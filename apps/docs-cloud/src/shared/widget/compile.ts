// Turns a widget module into a plain script by splicing source at AST
// positions: JSX becomes `__widget_h(...)` calls and `export default` an
// assignment. Everything else is copied byte for byte.

import {
  type AstNode,
  child,
  childList,
  childNodes,
  cleanJsxText,
  isNode,
  jsxName,
  parseModule,
} from "./ast.ts";

export const WIDGET_H = "__widget_h";
export const WIDGET_FRAGMENT = "__widget_fragment";
export const WIDGET_DRAWING = "__widget_drawing";

export type CompileResult =
  | { readonly ok: true; readonly code: string }
  | { readonly ok: false; readonly message: string };

const isJsx = (node: AstNode) => node.type === "JSXElement" || node.type === "JSXFragment";

/**
 * The module's body as a script that assigns the drawing to `__widget_drawing`.
 * Run it as `function (__widget_h, __widget_fragment) { let __widget_drawing; …; return __widget_drawing; }`.
 * Validate first: this only rewrites syntax.
 */
export function compileWidget(source: string): CompileResult {
  const parsed = parseModule(source);
  if (!parsed.ok)
    return { ok: false, message: `${parsed.line}:${parsed.column} ${parsed.message}` };

  const jsxInside = new Map<AstNode, boolean>();
  const containsJsx = (node: AstNode): boolean => {
    const known = jsxInside.get(node);
    if (known !== undefined) return known;
    const found = isJsx(node) || childNodes(node).some(containsJsx);
    jsxInside.set(node, found);
    return found;
  };

  /** The node's source with every JSX inside it compiled. */
  const emit = (node: AstNode): string => {
    if (isJsx(node)) return emitJsx(node);
    if (!containsJsx(node)) return source.slice(node.start, node.end);
    let out = "";
    let at = node.start;
    for (const next of childNodes(node)) {
      if (!containsJsx(next)) continue;
      out += source.slice(at, next.start) + emit(next);
      at = next.end;
    }
    return out + source.slice(at, node.end);
  };

  const emitTag = (name: AstNode | null): string => {
    const written = jsxName(name);
    if (name?.type === "JSXIdentifier" && /^[a-z]/.test(written)) return JSON.stringify(written);
    if (name?.type === "JSXNamespacedName") return JSON.stringify(written);
    return written;
  };

  const emitJsx = (node: AstNode): string => {
    const opening = child(node, "openingElement");
    const tag =
      node.type === "JSXFragment" ? WIDGET_FRAGMENT : emitTag(child(opening ?? node, "name"));
    const props: Array<string> = [];
    for (const attribute of opening ? childList(opening, "attributes") : []) {
      if (attribute.type === "JSXSpreadAttribute") {
        props.push(`...${emit(child(attribute, "argument")!)}`);
        continue;
      }
      const key = JSON.stringify(jsxName(child(attribute, "name")));
      const value = child(attribute, "value");
      if (!value) props.push(`${key}: true`);
      else if (value.type === "StringLiteral") props.push(`${key}: ${JSON.stringify(value.value)}`);
      else if (value.type === "JSXExpressionContainer")
        props.push(`${key}: ${emit(child(value, "expression")!)}`);
      else props.push(`${key}: ${emit(value)}`);
    }
    const children: Array<string> = [];
    for (const entry of childList(node, "children")) {
      if (entry.type === "JSXText") {
        const text = cleanJsxText(String(entry.value));
        if (text !== null) children.push(JSON.stringify(text));
      } else if (entry.type === "JSXExpressionContainer") {
        const expression = child(entry, "expression");
        if (expression && expression.type !== "JSXEmptyExpression") children.push(emit(expression));
      } else if (entry.type === "JSXSpreadChild") {
        children.push(`...${emit(child(entry, "expression")!)}`);
      } else if (isNode(entry)) {
        children.push(emit(entry));
      }
    }
    return `${WIDGET_H}(${[tag, `{${props.join(", ")}}`, ...children].join(", ")})`;
  };

  let out = "";
  let at = 0;
  for (const statement of childList(parsed.program, "body")) {
    if (statement.type === "ExportDefaultDeclaration") {
      const declaration = child(statement, "declaration");
      if (!declaration) continue;
      // `export default function () {}` has no name, so it becomes an expression.
      out += `${source.slice(at, statement.start)}${WIDGET_DRAWING} = (${emit(declaration)});`;
      at = statement.end;
    } else if (containsJsx(statement)) {
      out += source.slice(at, statement.start) + emit(statement);
      at = statement.end;
    }
  }
  return { ok: true, code: out + source.slice(at) };
}
