import { describe, it, expect } from "vitest";
import { applyHoverHighlight } from "./graphLoader";
import type { Node, Edge } from "@xyflow/react";

function makeNodes(ids: string[]): Node[] {
  return ids.map((id) => ({
    id,
    type: "dependencyModule",
    position: { x: 0, y: 0 },
    data: { label: id },
  }));
}

function makeEdges(pairs: [string, string][]): Edge[] {
  return pairs.map(([source, target]) => ({
    id: `${source}-${target}`,
    source,
    target,
    data: {},
  }));
}

describe("applyHoverHighlight", () => {
  const nodes = makeNodes(["a", "b", "c", "d"]);
  const edges = makeEdges([["a", "b"], ["b", "c"], ["c", "d"]]);

  it("returns nodes with explicit normal opacity when nothing is hovered", () => {
    const result = applyHoverHighlight(nodes, edges, null, null);
    // Every node should have explicit opacity ~0.85 and a transition
    for (const n of result.nodes) {
      const style = n.style as { opacity?: number; transition?: string };
      expect(style.opacity).toBeGreaterThan(0.5);
      expect(style.transition).toContain("opacity");
    }
  });

  it("highlights hovered node and its direct neighbors", () => {
    const result = applyHoverHighlight(nodes, edges, "b", null);

    const opacities = Object.fromEntries(
      result.nodes.map((n) => [n.id, (n.style as { opacity?: number })?.opacity]),
    );

    // b is hovered, a and c are connected → all highlighted
    expect(opacities["a"]).toBeGreaterThan(0.5);
    expect(opacities["b"]).toBeGreaterThan(0.5);
    expect(opacities["c"]).toBeGreaterThan(0.5);

    // d is not connected to b → dimmed
    expect(opacities["d"]).toBeLessThan(0.2);
  });

  it("highlights edges connected to hovered node", () => {
    const result = applyHoverHighlight(nodes, edges, "b", null);

    const edgeOpacities = Object.fromEntries(
      result.edges.map((e) => [e.id, (e.style as { opacity?: number })?.opacity]),
    );

    // a->b and b->c touch node b → highlighted
    expect(edgeOpacities["a-b"]).toBeGreaterThan(0.5);
    expect(edgeOpacities["b-c"]).toBeGreaterThan(0.5);

    // c->d doesn't touch b → dimmed
    expect(edgeOpacities["c-d"]).toBeLessThan(0.2);
  });

  it("highlights edge endpoints when an edge is hovered", () => {
    const result = applyHoverHighlight(nodes, edges, null, "b-c");

    const opacities = Object.fromEntries(
      result.nodes.map((n) => [n.id, (n.style as { opacity?: number })?.opacity]),
    );

    // b and c are endpoints of the hovered edge → highlighted
    expect(opacities["b"]).toBeGreaterThan(0.5);
    expect(opacities["c"]).toBeGreaterThan(0.5);

    // a and d are not endpoints → dimmed
    expect(opacities["a"]).toBeLessThan(0.2);
    expect(opacities["d"]).toBeLessThan(0.2);
  });

  it("does not mutate original nodes", () => {
    const result = applyHoverHighlight(nodes, edges, "b", null);
    expect(result.nodes).not.toBe(nodes);
    // Original nodes should have no opacity style
    for (const n of nodes) {
      expect(n.style).toBeUndefined();
    }
  });
});
