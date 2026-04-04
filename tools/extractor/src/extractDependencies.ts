/**
 * Dependency diagram extractor — runs dependency-cruiser against the codebase
 * and produces a DependencyDiagram for the architecture graph.
 *
 * Uses dependency-cruiser's Node API to:
 * - Resolve all internal file-to-file imports
 * - Detect circular dependencies
 * - Compute fan-in/fan-out/instability metrics per component module
 * - Aggregate file-level deps into module-level deps
 */

import { cruise } from "dependency-cruiser";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { getComponentId, getComponentDefs } from "./componentGrouper.js";
import type {
  DependencyDiagram,
  DependencyModule,
  DependencyFileDep,
  DependencyModuleDep,
  DependencyCycle,
  DependencySummary,
  FileNode,
} from "./types.js";

interface CruiseModule {
  source: string;
  valid: boolean;
  dependencies: CruiseDependency[];
  dependents: string[];
  orphan?: boolean;
}

interface CruiseDependency {
  resolved: string;
  module: string;
  circular: boolean;
  dynamic: boolean;
  dependencyTypes: string[];
  cycle?: { name: string }[];
}

export async function extractDependencyDiagram(
  rootDir: string,
  files: FileNode[],
): Promise<DependencyDiagram> {
  const serverTsConfig = loadTsConfig(resolve(rootDir, "server/tsconfig.json"));
  const clientTsConfig = loadTsConfig(resolve(rootDir, "client/tsconfig.json"));

  // Run dependency-cruiser from the project root
  const prevCwd = process.cwd();
  process.chdir(rootDir);

  let allModules: CruiseModule[] = [];
  try {
    // Cruise server
    const serverResult = await cruise(["server/src"], {
      outputType: "json",
      tsPreCompilationDeps: true,
      includeOnly: "^(server/src|client/src)",
      exclude: "(node_modules|dist|test|\\.test\\.ts$)",
      doNotFollow: { path: "node_modules" },
    }, {}, { tsConfig: serverTsConfig });

    const serverOutput = typeof serverResult.output === "string"
      ? JSON.parse(serverResult.output)
      : serverResult.output;
    allModules.push(...(serverOutput.modules as CruiseModule[]));

    // Cruise client
    const clientResult = await cruise(["client/src"], {
      outputType: "json",
      tsPreCompilationDeps: true,
      includeOnly: "^(server/src|client/src)",
      exclude: "(node_modules|dist|test|\\.test\\.ts$)",
      doNotFollow: { path: "node_modules" },
    }, {}, { tsConfig: clientTsConfig });

    const clientOutput = typeof clientResult.output === "string"
      ? JSON.parse(clientResult.output)
      : clientResult.output;

    // Merge, deduplicating by source path
    const seen = new Set(allModules.map((m) => m.source));
    for (const mod of clientOutput.modules as CruiseModule[]) {
      if (!seen.has(mod.source)) {
        allModules.push(mod);
        seen.add(mod.source);
      }
    }
  } finally {
    process.chdir(prevCwd);
  }

  // Filter to only first-party source files
  allModules = allModules.filter(
    (m) => (m.source.startsWith("server/src/") || m.source.startsWith("client/src/"))
      && !m.source.includes("node_modules"),
  );

  // Build file LOC lookup from existing extracted files
  const fileLoc = new Map<string, number>();
  for (const f of files) {
    fileLoc.set(f.id, f.loc);
  }

  // Build file-level deps
  const fileDeps: DependencyFileDep[] = [];
  for (const mod of allModules) {
    for (const dep of mod.dependencies) {
      const target = dep.resolved;
      if (
        !target.startsWith("server/src/") && !target.startsWith("client/src/")
      ) continue;
      if (target.includes("node_modules")) continue;

      fileDeps.push({
        source: mod.source,
        target,
        symbols: [], // dependency-cruiser doesn't track imported symbols
        isCircular: dep.circular,
        isDynamic: dep.dynamic,
      });
    }
  }

  // Aggregate into modules (components)
  const componentDefs = getComponentDefs();
  const modules = buildModules(allModules, fileDeps, fileLoc, componentDefs);
  const moduleDeps = buildModuleDeps(fileDeps);
  const cycles = detectModuleCycles(fileDeps, moduleDeps);

  // Compute fan-in/fan-out from module deps
  for (const mod of modules) {
    mod.fanOut = moduleDeps.filter((d) => d.source === mod.id).length;
    mod.fanIn = moduleDeps.filter((d) => d.target === mod.id).length;
    const total = mod.fanIn + mod.fanOut;
    mod.instability = total === 0 ? 0 : mod.fanOut / total;
  }

  const summary = buildSummary(modules, fileDeps, moduleDeps, cycles);

  return {
    modules,
    fileDeps,
    moduleDeps,
    cycles,
    summary,
  };
}

function loadTsConfig(path: string): object {
  try {
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function buildModules(
  cruiseModules: CruiseModule[],
  fileDeps: DependencyFileDep[],
  fileLoc: Map<string, number>,
  _componentDefs: { id: string; label: string }[],
): DependencyModule[] {
  // Group files by component
  const componentFiles = new Map<string, string[]>();
  for (const mod of cruiseModules) {
    const compId = getComponentId(mod.source);
    if (!componentFiles.has(compId)) componentFiles.set(compId, []);
    componentFiles.get(compId)!.push(mod.source);
  }

  // Find orphan files (no imports and no dependents within the codebase)
  const hasIncoming = new Set(fileDeps.map((d) => d.target));
  const hasOutgoing = new Set(fileDeps.map((d) => d.source));
  const orphanFiles = new Set<string>();
  for (const mod of cruiseModules) {
    if (!hasIncoming.has(mod.source) && !hasOutgoing.has(mod.source)) {
      orphanFiles.add(mod.source);
    }
  }

  const modules: DependencyModule[] = [];
  for (const [compId, fileList] of componentFiles) {
    const def = _componentDefs.find((d) => d.id === compId);
    const label = def?.label ?? compId;
    const totalLoc = fileList.reduce((sum, f) => sum + (fileLoc.get(f) ?? 0), 0);

    // Internal edges: both source and target in this component
    const compFileSet = new Set(fileList);
    const internalEdgeCount = fileDeps.filter(
      (d) => compFileSet.has(d.source) && compFileSet.has(d.target),
    ).length;

    modules.push({
      id: compId,
      label,
      componentId: compId,
      fileCount: fileList.length,
      totalLoc,
      fanIn: 0, // computed after
      fanOut: 0,
      instability: 0,
      internalEdgeCount,
      orphanFiles: fileList.filter((f) => orphanFiles.has(f)),
    });
  }

  return modules;
}

function buildModuleDeps(fileDeps: DependencyFileDep[]): DependencyModuleDep[] {
  // Aggregate file deps to module (component) deps
  const edgeMap = new Map<string, { fileEdgeCount: number; symbolCount: number; isCircular: boolean }>();

  for (const dep of fileDeps) {
    const srcComp = getComponentId(dep.source);
    const tgtComp = getComponentId(dep.target);
    if (srcComp === tgtComp) continue; // internal edge

    const key = `${srcComp}->${tgtComp}`;
    const existing = edgeMap.get(key);
    if (existing) {
      existing.fileEdgeCount++;
      existing.symbolCount += dep.symbols.length;
      if (dep.isCircular) existing.isCircular = true;
    } else {
      edgeMap.set(key, {
        fileEdgeCount: 1,
        symbolCount: dep.symbols.length,
        isCircular: dep.isCircular,
      });
    }
  }

  const moduleDeps: DependencyModuleDep[] = [];
  for (const [key, data] of edgeMap) {
    const [source, target] = key.split("->");
    const strength: "weak" | "moderate" | "strong" =
      data.fileEdgeCount <= 2 ? "weak" : data.fileEdgeCount <= 6 ? "moderate" : "strong";

    moduleDeps.push({
      id: `dep-${source}-${target}`,
      source,
      target,
      fileEdgeCount: data.fileEdgeCount,
      symbolCount: data.symbolCount,
      isCircular: data.isCircular,
      strength,
    });
  }

  return moduleDeps;
}

function detectModuleCycles(
  fileDeps: DependencyFileDep[],
  moduleDeps: DependencyModuleDep[],
): DependencyCycle[] {
  // Build adjacency list at module level
  const adj = new Map<string, Set<string>>();
  for (const dep of moduleDeps) {
    if (!adj.has(dep.source)) adj.set(dep.source, new Set());
    adj.get(dep.source)!.add(dep.target);
  }

  // Find cycles using DFS
  const cycles: DependencyCycle[] = [];
  const visited = new Set<string>();
  const stack = new Set<string>();
  const path: string[] = [];

  function dfs(node: string) {
    if (stack.has(node)) {
      // Found a cycle — extract it
      const cycleStart = path.indexOf(node);
      if (cycleStart >= 0) {
        const cycleModules = path.slice(cycleStart);
        const cycleId = `cycle-${cycleModules.join("-")}`;

        // Don't add duplicate cycles
        if (!cycles.some((c) => c.id === cycleId)) {
          // Find file edges involved in this cycle
          const cycleModuleSet = new Set(cycleModules);
          const fileEdges = fileDeps
            .filter((d) => {
              const srcComp = getComponentId(d.source);
              const tgtComp = getComponentId(d.target);
              return cycleModuleSet.has(srcComp) && cycleModuleSet.has(tgtComp) && srcComp !== tgtComp;
            })
            .map((d) => ({ source: d.source, target: d.target }));

          cycles.push({
            id: cycleId,
            modules: cycleModules,
            fileEdges,
            severity: cycleModules.length <= 2 ? "warning" : "error",
          });
        }
      }
      return;
    }
    if (visited.has(node)) return;

    visited.add(node);
    stack.add(node);
    path.push(node);

    for (const neighbor of adj.get(node) ?? []) {
      dfs(neighbor);
    }

    stack.delete(node);
    path.pop();
  }

  for (const node of adj.keys()) {
    visited.clear();
    stack.clear();
    path.length = 0;
    dfs(node);
  }

  return cycles;
}

function buildSummary(
  modules: DependencyModule[],
  fileDeps: DependencyFileDep[],
  moduleDeps: DependencyModuleDep[],
  cycles: DependencyCycle[],
): DependencySummary {
  const instabilities = modules.map((m) => m.instability);
  const avgInstability =
    instabilities.length > 0
      ? instabilities.reduce((a, b) => a + b, 0) / instabilities.length
      : 0;

  const sorted = [...modules].sort((a, b) => b.instability - a.instability);
  const mostUnstable = sorted[0]?.id ?? "";
  const mostStable = sorted[sorted.length - 1]?.id ?? "";

  return {
    totalModules: modules.length,
    totalFileDeps: fileDeps.length,
    totalModuleDeps: moduleDeps.length,
    circularCycleCount: cycles.length,
    averageInstability: Math.round(avgInstability * 100) / 100,
    mostUnstableModule: mostUnstable,
    mostStableModule: mostStable,
  };
}
