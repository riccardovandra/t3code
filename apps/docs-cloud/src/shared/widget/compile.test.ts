import { describe, expect, it } from "vite-plus/test";

import { compileWidget, WIDGET_DRAWING, WIDGET_FRAGMENT, WIDGET_H } from "./compile.ts";
import { FLOW_EXAMPLE, PILLARS_EXAMPLE } from "./testing/examples.ts";

interface VNode {
  readonly tag: unknown;
  readonly props: Record<string, unknown>;
  readonly children: ReadonlyArray<unknown>;
}

/** Runs compiled code the way the sandbox does, with a plain h(). */
function draw(source: string): VNode {
  const compiled = compileWidget(source);
  if (!compiled.ok) throw new Error(compiled.message);
  // oxlint-disable-next-line no-new-func -- the test stands in for the sandbox's script tag
  const factory = new Function(
    WIDGET_H,
    WIDGET_FRAGMENT,
    `"use strict"; let ${WIDGET_DRAWING};\n${compiled.code}\n; return ${WIDGET_DRAWING};`,
  );
  const h = (tag: unknown, props: Record<string, unknown>, ...children: Array<unknown>) => ({
    tag,
    props,
    children: children.flat(),
  });
  const drawing = factory(h, "fragment") as () => VNode;
  return drawing();
}

const texts = (node: unknown): Array<string> => {
  if (typeof node === "string") return [node];
  if (!node || typeof node !== "object") return [];
  return (node as VNode).children.flatMap(texts);
};

describe("compileWidget", () => {
  it("turns the flow example into h() calls that draw its svg", () => {
    const tree = draw(FLOW_EXAMPLE);
    expect(tree.tag).toBe("svg");
    expect(tree.props.viewBox).toBe("0 0 760 280");
    expect(texts(tree)).toContain("Ship to production");
    // Helpers ran: five boxes from box(), plus the decision polygon.
    expect(JSON.stringify(tree).match(/"tag":"rect"/g)).toHaveLength(5);
  });

  it("keeps template paths and computed attributes", () => {
    const tree = draw(PILLARS_EXAMPLE);
    const json = JSON.stringify(tree);
    expect(json).toContain('"fill":"var(--cds-chart-categorical-1)"');
    expect(texts(tree)).toContain("Foundation: reliability, security, support");
  });

  it("supports fragments, spreads, components and JSX whitespace", () => {
    const tree = draw(
      `const Dot = ({r, children}) => <circle r={r}>{children}</circle>;
export default () => <svg viewBox='0 0 10 10'><>
  <Dot r={2} {...{ cx: 1 }}>a</Dot>
  <text data-claude-text-id='t'>
    Two   words
    here
  </text>
</></svg>;`,
    );
    const fragment = tree.children[0] as VNode;
    expect(fragment.tag).toBe("fragment");
    const [dot, text] = fragment.children as Array<VNode>;
    expect(dot!.props).toEqual({ r: 2, cx: 1 });
    expect(text!.children).toEqual(["Two   words here"]);
  });

  it("copies non-JSX code byte for byte", () => {
    const compiled = compileWidget(
      "const a = 1 /* keep */;\nexport default () => <svg viewBox='0 0 1 1'/>;",
    );
    expect(compiled).toEqual({
      ok: true,
      code: `const a = 1 /* keep */;\n${WIDGET_DRAWING} = (() => ${WIDGET_H}("svg", {"viewBox": "0 0 1 1"}));`,
    });
  });
});
