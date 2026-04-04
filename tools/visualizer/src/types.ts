/** Mirrors the extractor's graph.json schema (read-only on this side). */

export interface ArchitectureGraph {
  meta: {
    extractedAt: string;
    rootDir: string;
    fileCount: number;
    classCount: number;
    eventTypeCount: number;
    commandTypeCount: number;
  };
  components: Component[];
  files: FileNode[];
  classes: ClassInfo[];
  moduleFacts: ModuleFact[];
  imports: ImportEdge[];
  events: EventInfo[];
  commands: CommandInfo[];
  boundaries: BoundaryEdge[];
  internals: ComponentInternal[];
  httpRoutes: HttpRouteFact[];
  httpRequests: HttpRequestFact[];
  transportMessages: TransportMessageFact[];
  fileAccesses: FileAccessFact[];
  sqlOperations: SqlOperationFact[];
  messageFlows: MessageFlow[];
  messageFlowGroups: MessageFlowGroup[];
  stateMachines: StateMachine[];
  dataStructures: DataStructure[];
  dataStructureRelations: DataStructureRelation[];
  dataStructureAccesses: DataStructureAccess[];
  dataModelEvidence: DataModelEvidence[];
  containerDiagram?: ContainerDiagram;
  componentDiagram?: ComponentDiagram;
  dependencyDiagram?: DependencyDiagram;
}

export interface Component {
  id: string;
  label: string;
  dirPattern: string;
  fileIds: string[];
  color: string;
  totalLoc: number;
}

export interface FileNode {
  id: string;
  componentId: string;
  classes: string[];
  exports: string[];
  loc: number;
}

export interface ClassInfo {
  id: string;
  fileId: string;
  componentId: string;
  name: string;
  kind: "class" | "interface";
  fields: { name: string; type: string; visibility: string }[];
  methods: {
    name: string;
    returnType: string;
    parameters: { name: string; type: string }[];
    visibility: string;
    isAsync: boolean;
    loc: number;
  }[];
  implementsNames: string[];
  extendsName?: string;
}

export interface ModuleFact {
  fileId: string;
  topLevelVariables: string[];
  functionVariables: { functionName: string; variableNames: string[] }[];
  exportedFunctions: string[];
  domElementIds: string[];
  windowGlobals: string[];
  routerPaths: {
    get: string[];
    post: string[];
  };
  switchCases: {
    className?: string;
    methodName: string;
    labels: string[];
  }[];
  sqlTables: string[];
  sqlFlags: string[];
}

export interface HttpRouteFact {
  method: "GET" | "POST";
  path: string;
  fileId: string;
  line: number;
  ownerSymbol?: string;
}

export interface HttpRequestFact {
  method: "GET" | "POST";
  path: string;
  fileId: string;
  line: number;
  caller?: string;
}

export interface TransportMessageFact {
  channel: "websocket";
  direction: "client_to_server" | "server_to_client";
  messageType: string;
  fileId: string;
  line: number;
  symbol?: string;
}

export interface FileAccessFact {
  kind: "read" | "exists_check" | "static_serve" | "import";
  fileId: string;
  line: number;
  targetPath: string;
  detail: string;
}

export interface SqlOperationFact {
  operation: "select" | "insert" | "update" | "delete";
  tables: string[];
  fileId: string;
  line: number;
  symbol?: string;
  detail: string;
}

export interface ImportEdge {
  source: string;
  target: string;
  symbols: string[];
  typeOnlySymbols?: string[];
}

export interface EventInfo {
  eventType: string;
  emitters: { fileId: string; classId?: string; line: number }[];
  subscribers: { fileId: string; classId?: string; line: number }[];
}

export interface CommandInfo {
  commandType: string;
  producers: { fileId: string; classId?: string; line: number }[];
  consumer: string;
}

export interface BoundaryEdge {
  source: string;
  target: string;
  eventCount: number;
  callCount: number;
  mutationCount: number;
  couplingType: "event" | "call" | "mutation" | "mixed";
  details: {
    kind: "event" | "call" | "mutation";
    description: string;
    sourceFile: string;
    targetFile: string;
    line?: number;
  }[];
}

export interface ComponentInternal {
  componentId: string;
  primaryClass: string;
  primaryState: { name: string; type: string }[];
  ownedClasses: {
    name: string;
    fieldName: string;
    stateFields: { name: string; type: string }[];
  }[];
  usedUtilities: { name: string; source: string; purpose: string }[];
}

// ---------------------------------------------------------------------------
// Data Model
// ---------------------------------------------------------------------------

export type DataStructureCategory =
  | "domain"
  | "transport"
  | "database"
  | "disk_file"
  | "in_memory"
  | "debug_test"
  | "ui_view";

export type DataStructureKind =
  | "interface"
  | "type_alias"
  | "union"
  | "table"
  | "asset"
  | "store";

export type DataStructureSourceKind = "ts" | "sql" | "json";

export interface DataStructure {
  id: string;
  name: string;
  category: DataStructureCategory;
  conceptGroup?: string;
  kind: DataStructureKind;
  sourceKind: DataStructureSourceKind;
  fileId: string;
  exported: boolean;
  canonical: boolean;
  componentIds: string[];
  summary?: string;
  purpose?: string;
  fieldCount: number;
  fields: DataStructureField[];
  variants: DataStructureVariant[];
  mirrorIds: string[];
  badges: string[];
  evidenceIds: string[];
}

export interface DataStructureField {
  id: string;
  name: string;
  typeText: string;
  optional: boolean;
  readonly: boolean;
  description?: string;
  referencedStructureId?: string;
  evidenceIds: string[];
}

export interface DataStructureVariant {
  id: string;
  label: string;
  discriminatorField?: string;
  discriminatorValue?: string;
  summary?: string;
  fields: DataStructureField[];
  evidenceIds: string[];
}

export type DataStructureRelationKind =
  | "contains"
  | "mirrors"
  | "serialized_as"
  | "persisted_as"
  | "loaded_from"
  | "stored_in"
  | "indexed_by";

export interface DataStructureRelation {
  id: string;
  sourceId: string;
  targetId: string;
  kind: DataStructureRelationKind;
  label: string;
  reason?: string;
  confidence: ComponentDiagramConfidence;
  evidenceIds: string[];
}

export type DataAccessKind =
  | "create"
  | "read"
  | "lookup"
  | "index_lookup"
  | "iterate"
  | "write"
  | "append"
  | "remove"
  | "serialize"
  | "deserialize"
  | "persist_read"
  | "persist_write"
  | "clone"
  | "mirror";

export type DataAccessLifecycle =
  | "startup"
  | "tick_path"
  | "event_driven"
  | "request_path"
  | "debug_only"
  | "test_only"
  | "unknown";

export interface DataStructureAccess {
  id: string;
  structureId: string;
  accessKind: DataAccessKind;
  actorName?: string;
  actorKind?: "function" | "method" | "class" | "module" | "sql_query" | "runtime_store";
  actorFileId: string;
  componentId?: string;
  accessPath?: string;
  lifecycle: DataAccessLifecycle;
  reason?: string;
  line?: number;
  confidence: ComponentDiagramConfidence;
  evidenceIds: string[];
}

export interface DataModelEvidence {
  id: string;
  kind: string;
  confidence: ComponentDiagramConfidence;
  fileId: string;
  line?: number;
  symbol?: string;
  detail: string;
}

// ---------------------------------------------------------------------------
// Message Flows
// ---------------------------------------------------------------------------

export interface MessageFlow {
  clientMessageType: string;
  description: string;
  steps: MessageFlowStep[];
}

export interface MessageFlowStep {
  lane: "Client" | "Network" | "Engine" | "NPC" | "Persistence";
  action: string;
  method: string;
  fileId: string;
  line?: number;
  produces?: string;
  producesKind?: "command" | "event" | "serverMessage" | "directCall";
  errorPaths?: { condition: string; produces: string }[];
  stateTransition?: { machineId: string; from: string; to: string };
  dataShape?: string;
}

export interface MessageFlowGroup {
  id: string;
  label: string;
  description: string;
  flowTypes: string[];
}

// ---------------------------------------------------------------------------
// State Machines
// ---------------------------------------------------------------------------

export interface StateMachine {
  id: string;
  label: string;
  description: string;
  fileId: string;
  classId?: string;
  states: StateMachineState[];
  transitions: StateMachineTransition[];
}

export interface StateMachineState {
  id: string;
  label: string;
  isInitial?: boolean;
  isTerminal?: boolean;
  color?: string;
}

export interface StateMachineTransition {
  from: string;
  to: string;
  trigger: string;
  fileId?: string;
  line?: number;
  condition?: string;
  triggeringFlows?: string[];
}

export type ZoomLevel = "container" | "component" | "dataModel" | "dependency" | "file" | "class" | "flow";

// ---------------------------------------------------------------------------
// Container Diagram
// ---------------------------------------------------------------------------

export interface ContainerDiagram {
  system: ContainerDiagramSystem;
  people?: ContainerDiagramPerson[];
  externalSystems?: ContainerDiagramExternalSystem[];
  containers: ContainerDiagramContainer[];
  relationships: ContainerDiagramRelationship[];
  evidence: ContainerDiagramEvidence[];
}

export interface ContainerDiagramSystem {
  id: string;
  label: string;
  description: string;
  position: DiagramPoint;
  size: DiagramSize;
}

export interface ContainerDiagramPerson {
  id: string;
  name: string;
  description: string;
  position: DiagramPoint;
}

export interface ContainerDiagramExternalSystem {
  id: string;
  name: string;
  technology?: string;
  description: string;
  position: DiagramPoint;
}

export interface ContainerDiagramContainer {
  id: string;
  kind: "application" | "datastore";
  name: string;
  technology: string;
  description: string;
  responsibilities: string[];
  color: string;
  position: DiagramPoint;
  size: DiagramSize;
  codePaths: string[];
  componentTargets?: ContainerDiagramComponentTarget[];
  fileIds?: string[];
  badges?: string[];
  summary?: string;
  evidenceIds: string[];
  openNext?: ContainerDiagramOpenTarget[];
}

export interface ContainerDiagramComponentTarget {
  kind: "boundary" | "card";
  id: string;
  reason: string;
}

export interface ContainerDiagramRelationship {
  id: string;
  source: string;
  target: string;
  description: string;
  technology: string;
  confidence: "exact" | "derived" | "declared";
  optional?: boolean;
  synchronous?: boolean;
  evidenceIds: string[];
}

export interface ContainerDiagramEvidence {
  id: string;
  kind: string;
  confidence: "exact" | "derived" | "declared";
  fileId?: string;
  line?: number;
  symbol?: string;
  detail: string;
}

export interface ContainerDiagramOpenTarget {
  label: string;
  target:
    | { kind: "component_boundary"; boundaryId: string }
    | { kind: "component_card"; cardId: string }
    | { kind: "file"; fileId: string }
    | { kind: "flow"; flowId: string };
  reason: string;
}

// ---------------------------------------------------------------------------
// Detailed Component Diagram
// ---------------------------------------------------------------------------

export interface ComponentDiagram {
  defaultViewId: string;
  views: ComponentDiagramView[];
  systems: ComponentDiagramSystem[];
  boundaries: ComponentDiagramBoundary[];
  containers: ComponentDiagramContainer[];
  cards: ComponentDiagramCard[];
  edges: ComponentDiagramEdge[];
  evidence: ComponentDiagramEvidence[];
}

export interface ComponentDiagramView {
  id: string;
  containerId: string;
  name: string;
  description: string;
  systemId: string;
  boundaryId: string;
}

export interface ComponentDiagramSystem {
  id: string;
  viewId: string;
  label: string;
  description: string;
  color: string;
  position: DiagramPoint;
  size: DiagramSize;
}

export interface DiagramPoint {
  x: number;
  y: number;
}

export interface DiagramSize {
  width: number;
  height: number;
}

export interface ComponentDiagramBoundary {
  id: string;
  viewId: string;
  label: string;
  technology: string;
  description: string;
  color: string;
  position: DiagramPoint;
  size: DiagramSize;
}

export interface ComponentDiagramContainer {
  id: string;
  viewId: string;
  containerId: string;
  name: string;
  technology: string;
  description: string;
  color: string;
  kind: "application" | "datastore";
  position: DiagramPoint;
  size: DiagramSize;
}

export interface ComponentDiagramCard {
  id: string;
  viewId: string;
  boundaryId: string;
  title: string;
  subtitle?: string;
  fileId?: string;
  accentColor: string;
  position: DiagramPoint;
  size: DiagramSize;
  sections: ComponentDiagramSection[];
  childCards?: ComponentDiagramMiniCard[];
  badges?: string[];
  metrics?: ComponentDiagramMetric[];
  summary?: string;
  openNext?: ComponentDiagramOpenTarget[];
}

export interface ComponentDiagramSection {
  id: string;
  label: ComponentDiagramSectionLabel;
  lines: ComponentDiagramLine[];
  style?: "list" | "chips";
}

export type ComponentDiagramSectionLabel =
  | "Owns"
  | "Ingress"
  | "Egress"
  | "Depends On"
  | "Internals";

export interface ComponentDiagramLine {
  id: string;
  text: string;
  kind: ComponentDiagramLineKind;
  confidence: ComponentDiagramConfidence;
  evidenceIds: string[];
  targetFileId?: string;
  targetSymbol?: string;
}

export type ComponentDiagramLineKind =
  | "state"
  | "route"
  | "message"
  | "event"
  | "command"
  | "dependency"
  | "internal";

export type ComponentDiagramConfidence = "exact" | "derived" | "heuristic";

export interface ComponentDiagramMiniCard {
  title: string;
  subtitle?: string;
  fileId?: string;
  lines: string[];
  summary?: string;
}

export interface ComponentDiagramMetric {
  label: string;
  value: string;
}

export interface ComponentDiagramOpenTarget {
  label: string;
  fileId: string;
  reason: string;
}

export interface ComponentDiagramEdge {
  id: string;
  viewId: string;
  source: string;
  target: string;
  label: string;
  color: string;
  relationshipKind: ComponentDiagramRelationshipKind;
  evidenceIds: string[];
  technology?: string;
  counts?: Partial<Record<ComponentDiagramConfidence, number>>;
  dash?: string;
  bidirectional?: boolean;
  sourceHandle?: "top" | "right" | "bottom" | "left";
  targetHandle?: "top" | "right" | "bottom" | "left";
}

export type ComponentDiagramRelationshipKind =
  | "transport"
  | "queued_command"
  | "event_subscription"
  | "direct_call"
  | "persistence_io"
  | "mixed";

export interface ComponentDiagramEvidence {
  id: string;
  kind: string;
  confidence: ComponentDiagramConfidence;
  fileId: string;
  line?: number;
  symbol?: string;
  detail: string;
}

// ---------------------------------------------------------------------------
// Dependency Diagram
// ---------------------------------------------------------------------------

export interface DependencyDiagram {
  modules: DependencyModule[];
  fileDeps: DependencyFileDep[];
  moduleDeps: DependencyModuleDep[];
  cycles: DependencyCycle[];
  summary: DependencySummary;
}

export interface DependencyModule {
  id: string;
  label: string;
  componentId: string;
  fileCount: number;
  totalLoc: number;
  fanIn: number;
  fanOut: number;
  instability: number;
  internalEdgeCount: number;
  orphanFiles: string[];
}

export interface DependencyFileDep {
  source: string;
  target: string;
  symbols: string[];
  isCircular: boolean;
  isDynamic: boolean;
}

export interface DependencyModuleDep {
  id: string;
  source: string;
  target: string;
  fileEdgeCount: number;
  symbolCount: number;
  isCircular: boolean;
  strength: "weak" | "moderate" | "strong";
}

export interface DependencyCycle {
  id: string;
  modules: string[];
  fileEdges: { source: string; target: string }[];
  severity: "info" | "warning" | "error";
}

export interface DependencySummary {
  totalModules: number;
  totalFileDeps: number;
  totalModuleDeps: number;
  circularCycleCount: number;
  averageInstability: number;
  mostUnstableModule: string;
  mostStableModule: string;
}
