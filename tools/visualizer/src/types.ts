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
  messageFlows: MessageFlow[];
  messageFlowGroups: MessageFlowGroup[];
  stateMachines: StateMachine[];
  componentDiagram?: ComponentDiagram;
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

export interface ImportEdge {
  source: string;
  target: string;
  symbols: string[];
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

export type ZoomLevel = "component" | "file" | "class" | "flow";

// ---------------------------------------------------------------------------
// Detailed Component Diagram
// ---------------------------------------------------------------------------

export interface ComponentDiagram {
  boundaries: ComponentDiagramBoundary[];
  cards: ComponentDiagramCard[];
  edges: ComponentDiagramEdge[];
  evidence: ComponentDiagramEvidence[];
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
  label: string;
  technology: string;
  description: string;
  color: string;
  position: DiagramPoint;
  size: DiagramSize;
}

export interface ComponentDiagramCard {
  id: string;
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
  source: string;
  target: string;
  label: string;
  color: string;
  relationshipKind: ComponentDiagramRelationshipKind;
  evidenceIds: string[];
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
