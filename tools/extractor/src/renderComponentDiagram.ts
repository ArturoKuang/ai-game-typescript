import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  ArchitectureGraph,
  ComponentDiagram,
  ComponentDiagramBoundary,
  ComponentDiagramCard,
} from "./types.js";

const GRAPH_PATH = resolve(import.meta.dirname, "..", "graph.json");
const MERMAID_PATH = resolve(import.meta.dirname, "..", "component-diagram.mmd");
const MARKDOWN_PATH = resolve(import.meta.dirname, "..", "component-diagram.md");

function main(): void {
  const graph = JSON.parse(readFileSync(GRAPH_PATH, "utf-8")) as ArchitectureGraph;
  if (!graph.componentDiagram) {
    throw new Error("graph.json does not contain componentDiagram");
  }

  const mermaid = renderMermaid(graph.componentDiagram);
  writeFileSync(MERMAID_PATH, `${mermaid}\n`);
  writeFileSync(
    MARKDOWN_PATH,
    [
      "# Component Diagram",
      "",
      "_Generated from `tools/extractor/graph.json`._",
      "",
      "```mermaid",
      mermaid,
      "```",
      "",
    ].join("\n"),
  );

  console.log(`Wrote ${MERMAID_PATH}`);
  console.log(`Wrote ${MARKDOWN_PATH}`);
}

function renderMermaid(diagram: ComponentDiagram): string {
  const lines: string[] = [
    "flowchart TB",
    "  classDef boundary fill:#0f172a,stroke:#475569,stroke-width:2px,color:#e5e7eb;",
    "  classDef client fill:#2d1400,stroke:#FE6100,stroke-width:1.5px,color:#f8fafc;",
    "  classDef server fill:#111827,stroke:#648FFF,stroke-width:1.5px,color:#f8fafc;",
    "  classDef network fill:#0a2230,stroke:#22D3EE,stroke-width:1.5px,color:#f8fafc;",
    "  classDef engine fill:#0f1a3d,stroke:#648FFF,stroke-width:1.5px,color:#f8fafc;",
    "  classDef npc fill:#2d0a1a,stroke:#DC267F,stroke-width:1.5px,color:#f8fafc;",
    "  classDef persistence fill:#2d1d00,stroke:#FFB000,stroke-width:1.5px,color:#f8fafc;",
    "  classDef debug fill:#1f2937,stroke:#d1d5db,stroke-width:1.5px,color:#f8fafc;",
    "",
  ];

  for (const boundary of diagram.boundaries) {
    lines.push(`  subgraph ${toMermaidId(boundary.id)}["${escapeLabel(boundary.label)}"]`);
    lines.push(`    direction TB`);
    for (const card of diagram.cards.filter((item) => item.boundaryId === boundary.id)) {
      lines.push(`    ${toMermaidId(card.id)}["${renderCardLabel(card)}"]`);
    }
    lines.push("  end");
    lines.push(`  class ${toMermaidId(boundary.id)} boundary;`);
    lines.push("");
  }

  for (const card of diagram.cards) {
    lines.push(`  class ${toMermaidId(card.id)} ${cardClass(card, diagram.boundaries)};`);
  }
  lines.push("");

  for (const edge of diagram.edges) {
    const arrow = edge.bidirectional ? "<-->" : "-->";
    const source = toMermaidId(edge.source);
    const target = toMermaidId(edge.target);
    const label = escapeLabel(edge.label).replaceAll("\n", "<br/>");
    lines.push(`  ${source} ${arrow}|"${label}"| ${target}`);
  }

  return lines.join("\n");
}

function renderCardLabel(card: ComponentDiagramCard): string {
  const parts: string[] = [escapeLabel(card.title)];
  if (card.subtitle) {
    parts.push(escapeLabel(card.subtitle));
  }

  for (const section of card.sections) {
    if (section.lines.length === 0) continue;
    parts.push(`${escapeLabel(section.label)}: ${escapeLabel(section.lines.map((line) => line.text).join(" • "))}`);
  }

  if (card.childCards && card.childCards.length > 0) {
    for (const child of card.childCards) {
      const childText = `${child.title} (${child.subtitle})`;
      const childLines = child.lines.length > 0 ? `: ${child.lines.join(" • ")}` : "";
      parts.push(escapeLabel(childText + childLines));
    }
  }

  if (card.badges && card.badges.length > 0) {
    parts.push(escapeLabel(card.badges.join(" • ")));
  }

  return parts.join("<br/>");
}

function cardClass(
  card: ComponentDiagramCard,
  boundaries: ComponentDiagramBoundary[],
): string {
  const boundary = boundaries.find((item) => item.id === card.boundaryId);
  if (boundary?.id === "diagram-boundary-client") return "client";
  switch (card.id) {
    case "diagram-server-network":
      return "network";
    case "diagram-server-engine":
      return "engine";
    case "diagram-server-npc":
      return "npc";
    case "diagram-server-persistence":
      return "persistence";
    case "diagram-server-debug":
      return "debug";
    default:
      return "server";
  }
}

function toMermaidId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, "_");
}

function escapeLabel(value: string): string {
  return value.replaceAll('"', "&quot;");
}

main();
