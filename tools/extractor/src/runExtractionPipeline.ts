/**
 * Top-level extraction pipeline.
 *
 * Audit note: this module is intentionally procedural. It shows the exact order
 * the extractor derives facts and diagrams before it writes `graph.json`.
 */
import { writeFileSync } from "node:fs";
import { getComponentDefs } from "./componentGrouper.js";
import { buildContainerDiagram } from "./buildContainerDiagram.js";
import { buildComponentDiagram } from "./buildComponentDiagram.js";
import { classifyBoundaries } from "./extractBoundaries.js";
import {
  buildComponents,
  extractComponentInternals,
} from "./extractComponentStructure.js";
import { extractDataModel } from "./extractDataModel.js";
import { extractDependencyDiagram } from "./extractDependencies.js";
import { extractEventsAndCommands } from "./extractEventSignals.js";
import { extractMessageFlows, extractMessageFlowGroups } from "./extractMessageFlows.js";
import {
  extractFileAccessFacts,
  extractHttpFacts,
  extractSqlOperations,
  extractTransportMessages,
} from "./extractRuntimeFacts.js";
import {
  createProjects,
  extractClasses,
  extractFilesAndImports,
  extractModuleFacts,
} from "./extractSourceInventory.js";
import { extractStateMachines } from "./extractStateMachines.js";
import type { ArchitectureGraph } from "./types.js";

export async function runExtractionPipeline(
  rootDir: string,
  outputPath: string,
): Promise<void> {
  console.log("Extracting architecture from", rootDir);
  console.time("extraction");

  const sourceFiles = createProjects(rootDir);
  console.log(`  Loaded ${sourceFiles.length} source files`);

  const { files, imports } = extractFilesAndImports(rootDir, sourceFiles);
  console.log(`  Extracted ${files.length} files, ${imports.length} import edges`);

  const classes = extractClasses(rootDir, sourceFiles);
  console.log(`  Extracted ${classes.length} classes/interfaces`);

  const moduleFacts = extractModuleFacts(rootDir, sourceFiles);
  console.log(`  Extracted ${moduleFacts.length} module fact records`);

  const { httpRoutes, httpRequests } = extractHttpFacts(rootDir, sourceFiles);
  console.log(
    `  Extracted ${httpRoutes.length} HTTP routes and ${httpRequests.length} HTTP requests`,
  );

  const transportMessages = extractTransportMessages(rootDir, sourceFiles);
  console.log(
    `  Extracted ${transportMessages.length} WebSocket transport message facts`,
  );

  const fileAccesses = extractFileAccessFacts(rootDir, sourceFiles);
  console.log(`  Extracted ${fileAccesses.length} file access facts`);

  const sqlOperations = extractSqlOperations(rootDir, sourceFiles);
  console.log(`  Extracted ${sqlOperations.length} SQL operation facts`);

  const { events, commands } = extractEventsAndCommands(rootDir, sourceFiles);
  console.log(`  Found ${events.length} event types, ${commands.length} command types`);

  const boundaries = classifyBoundaries(files, imports, events, commands);
  console.log(`  Classified ${boundaries.length} cross-component boundaries`);

  const components = buildComponents(files, getComponentDefs());
  console.log(`  Built ${components.length} components`);

  const internals = extractComponentInternals(classes, imports, components);
  console.log(
    `  Extracted internals for ${internals.filter((item) => item.primaryClass).length} components`,
  );

  const messageFlows = extractMessageFlows();
  console.log(`  Defined ${messageFlows.length} message flows`);

  const stateMachines = extractStateMachines();
  console.log(`  Defined ${stateMachines.length} state machines`);

  const messageFlowGroups = extractMessageFlowGroups();
  console.log(`  Defined ${messageFlowGroups.length} message flow groups`);

  const {
    dataStructures,
    dataStructureRelations,
    dataStructureAccesses,
    dataModelEvidence,
  } = extractDataModel({
    rootDir,
    sourceFiles,
  });
  console.log(`  Extracted ${dataStructures.length} data structures`);
  console.log(
    `  Extracted ${dataStructureRelations.length} data structure relations`,
  );
  console.log(
    `  Extracted ${dataStructureAccesses.length} data structure access patterns`,
  );

  const componentDiagram = buildComponentDiagram({
    classes,
    moduleFacts,
    imports,
    events,
    commands,
    messageFlows,
    httpRoutes,
    httpRequests,
    fileAccesses,
    sqlOperations,
  });
  console.log(
    `  Built detailed component diagram with ${componentDiagram.cards.length} cards`,
  );

  const containerDiagram = buildContainerDiagram({
    rootDir,
    files,
    components,
    componentDiagram,
    moduleFacts,
    httpRoutes,
    httpRequests,
    transportMessages,
    fileAccesses,
    sqlOperations,
  });
  console.log(
    `  Built container diagram with ${containerDiagram.containers.length} containers`,
  );

  const dependencyDiagram = await extractDependencyDiagram(rootDir, files);
  console.log(
    `  Built dependency diagram: ${dependencyDiagram.modules.length} modules, ${dependencyDiagram.fileDeps.length} file deps, ${dependencyDiagram.cycles.length} cycles`,
  );

  const graph: ArchitectureGraph = {
    meta: {
      extractedAt: new Date().toISOString(),
      rootDir,
      fileCount: files.length,
      classCount: classes.length,
      eventTypeCount: events.length,
      commandTypeCount: commands.length,
    },
    components,
    files,
    classes,
    moduleFacts,
    imports,
    events,
    commands,
    boundaries,
    internals,
    httpRoutes,
    httpRequests,
    transportMessages,
    fileAccesses,
    sqlOperations,
    messageFlows,
    messageFlowGroups,
    stateMachines,
    dataStructures,
    dataStructureRelations,
    dataStructureAccesses,
    dataModelEvidence,
    containerDiagram,
    componentDiagram,
    dependencyDiagram,
  };

  writeFileSync(outputPath, JSON.stringify(graph, null, 2));
  console.timeEnd("extraction");
  console.log(`Wrote ${outputPath}`);
}
