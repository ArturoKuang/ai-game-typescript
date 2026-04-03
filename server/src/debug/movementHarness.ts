import { GameLoop } from "../engine/gameLoop.js";
import type {
  GameEvent,
  MapData,
  Orientation,
  Player,
} from "../engine/types.js";
import { renderAsciiMap } from "./asciiMap.js";

const MINI_MAP: MapData = {
  width: 5,
  height: 5,
  tiles: [
    ["wall", "wall", "wall", "wall", "wall"],
    ["wall", "floor", "floor", "floor", "wall"],
    ["wall", "floor", "floor", "floor", "wall"],
    ["wall", "floor", "floor", "floor", "wall"],
    ["wall", "wall", "wall", "wall", "wall"],
  ],
  activities: [],
  spawnPoints: [],
};

const DEFAULT_EVENT_TYPES = new Set<string>([
  "spawn",
  "despawn",
  "input_state",
  "move_start",
  "move_end",
  "move_direction",
  "player_collision",
  "convo_accepted",
  "convo_active",
  "convo_declined",
  "convo_ended",
  "convo_started",
  "input_move",
]);

interface SpawnAction {
  type: "spawn";
  label: string;
  player: {
    id: string;
    name: string;
    x: number;
    y: number;
    isNpc?: boolean;
    speed?: number;
  };
}

interface InputAction {
  type: "input";
  label: string;
  playerId: string;
  direction: Orientation;
  active: boolean;
}

interface MoveToAction {
  type: "move_to";
  label: string;
  playerId: string;
  x: number;
  y: number;
}

interface MoveDirectionAction {
  type: "move_direction";
  label: string;
  playerId: string;
  direction: Orientation;
}

interface TickAction {
  type: "tick";
  label: string;
  count?: number;
}

interface SnapshotAction {
  type: "snapshot";
  label: string;
}

type HarnessAction =
  | SpawnAction
  | InputAction
  | MoveToAction
  | MoveDirectionAction
  | TickAction
  | SnapshotAction;

interface MovementHarnessScenario {
  description: string;
  map: MapData;
  actions: HarnessAction[];
  expectedTrace?: MovementHarnessExpectedEvent[];
}

export interface MovementHarnessPlayerState {
  id: string;
  x: number;
  y: number;
  state: Player["state"];
  orientation: Orientation;
  vx: number;
  vy: number;
  radius: number;
  targetX?: number;
  targetY?: number;
  pathLength?: number;
  pathIndex?: number;
}

export interface MovementHarnessSnapshot {
  label: string;
  tick: number;
  players: MovementHarnessPlayerState[];
  ascii: string;
  legend: Record<string, string>;
  events: GameEvent[];
}

export interface MovementHarnessScriptEntry {
  tick: number;
  label: string;
  action: HarnessAction["type"];
  data: Record<string, unknown>;
}

export interface MovementHarnessEventTraceEntry {
  snapshotLabel: string;
  event: GameEvent;
}

export interface MovementHarnessExpectedEvent {
  snapshotLabel?: string;
  tick?: number;
  type: GameEvent["type"];
  playerId?: string;
  data?: Record<string, unknown>;
}

export interface MovementHarnessVerification {
  passed: boolean;
  matched: number;
  expected: number;
  failures: string[];
}

export interface MovementHarnessResult {
  scenario: MovementHarnessScenarioName;
  description: string;
  map: MapData;
  script: MovementHarnessScriptEntry[];
  snapshots: MovementHarnessSnapshot[];
  eventTrace: MovementHarnessEventTraceEntry[];
  verification: MovementHarnessVerification;
}

const MOVEMENT_HARNESS_SCENARIOS = {
  path_handoff: {
    description:
      "Reproduces switching from continuous input to A* movement from a runtime fractional position.",
    map: MINI_MAP,
    actions: [
      {
        type: "spawn",
        label: "spawn_player",
        player: { id: "p1", name: "p1", x: 2, y: 2 },
      },
      {
        type: "input",
        label: "start_right_input",
        playerId: "p1",
        direction: "right",
        active: true,
      },
      {
        type: "tick",
        label: "after_input_tick",
      },
      {
        type: "input",
        label: "stop_right_input",
        playerId: "p1",
        direction: "right",
        active: false,
      },
      {
        type: "move_to",
        label: "issue_path_target",
        playerId: "p1",
        x: 3,
        y: 1,
      },
      {
        type: "snapshot",
        label: "after_move_command",
      },
      {
        type: "tick",
        label: "after_path_tick",
      },
      {
        type: "tick",
        label: "after_path_tick_2",
      },
      {
        type: "tick",
        label: "after_path_tick_3",
      },
    ],
    expectedTrace: [
      {
        snapshotLabel: "issue_path_target",
        type: "move_start",
        playerId: "p1",
        data: { targetX: 3, targetY: 1, pathLength: 3 },
      },
      {
        snapshotLabel: "after_path_tick_3",
        type: "move_end",
        playerId: "p1",
        data: { x: 3, y: 1 },
      },
    ],
  },
  runtime_spawn_input: {
    description:
      "Reproduces continuous movement from an integer-centered runtime spawn near a wall.",
    map: MINI_MAP,
    actions: [
      {
        type: "spawn",
        label: "spawn_runtime_player",
        player: { id: "p1", name: "p1", x: 1, y: 2 },
      },
      {
        type: "input",
        label: "start_right_input",
        playerId: "p1",
        direction: "right",
        active: true,
      },
      {
        type: "tick",
        label: "after_runtime_input_tick",
      },
    ],
    expectedTrace: [
      {
        snapshotLabel: "start_right_input",
        type: "input_state",
        playerId: "p1",
        data: { direction: "right", active: true, inputX: 1, inputY: 0 },
      },
      {
        snapshotLabel: "after_runtime_input_tick",
        type: "input_move",
        playerId: "p1",
        data: { x: 1.25, y: 2, vx: 5, vy: 0 },
      },
    ],
  },
  simultaneous_input_release: {
    description:
      "Reproduces holding two keys at once and then releasing one while the other stays held.",
    map: MINI_MAP,
    actions: [
      {
        type: "spawn",
        label: "spawn_player",
        player: { id: "p1", name: "p1", x: 2, y: 2 },
      },
      {
        type: "input",
        label: "start_up_input",
        playerId: "p1",
        direction: "up",
        active: true,
      },
      {
        type: "input",
        label: "start_left_input",
        playerId: "p1",
        direction: "left",
        active: true,
      },
      {
        type: "tick",
        label: "after_diagonal_tick",
      },
      {
        type: "input",
        label: "stop_left_input",
        playerId: "p1",
        direction: "left",
        active: false,
      },
      {
        type: "tick",
        label: "after_left_release_tick",
      },
    ],
    expectedTrace: [
      {
        snapshotLabel: "start_left_input",
        type: "input_state",
        playerId: "p1",
        data: { direction: "left", active: true, inputX: -1, inputY: -1 },
      },
      {
        snapshotLabel: "after_diagonal_tick",
        type: "input_move",
        playerId: "p1",
        data: {
          x: roundExpected(2 - 0.25 / Math.sqrt(2)),
          y: roundExpected(2 - 0.25 / Math.sqrt(2)),
          vx: roundExpected(-5 / Math.sqrt(2)),
          vy: roundExpected(-5 / Math.sqrt(2)),
        },
      },
      {
        snapshotLabel: "stop_left_input",
        type: "input_state",
        playerId: "p1",
        data: { direction: "left", active: false, inputX: 0, inputY: -1 },
      },
      {
        snapshotLabel: "after_left_release_tick",
        type: "input_move",
        playerId: "p1",
        data: {
          x: roundExpected(2 - 0.25 / Math.sqrt(2)),
          y: roundExpected(2 - 0.25 / Math.sqrt(2) - 0.25),
          vx: 0,
          vy: -5,
        },
      },
    ],
  },
  input_blocked_by_player: {
    description:
      "Verifies that continuous movement stops before overlapping another player and records the blocker.",
    map: MINI_MAP,
    actions: [
      {
        type: "spawn",
        label: "spawn_mover",
        player: { id: "a", name: "alice", x: 2, y: 2 },
      },
      {
        type: "spawn",
        label: "spawn_blocker",
        player: { id: "b", name: "bob", x: 2, y: 1 },
      },
      {
        type: "input",
        label: "start_up_input",
        playerId: "a",
        direction: "up",
        active: true,
      },
      {
        type: "tick",
        label: "after_collision_tick",
      },
    ],
    expectedTrace: [
      {
        snapshotLabel: "after_collision_tick",
        type: "player_collision",
        playerId: "a",
        data: { mode: "input", blockerId: "b" },
      },
    ],
  },
  path_blocked_by_player: {
    description:
      "Verifies that path-following movement does not enter an occupied waypoint.",
    map: MINI_MAP,
    actions: [
      {
        type: "spawn",
        label: "spawn_path_player",
        player: { id: "alice", name: "alice", x: 1, y: 1 },
      },
      {
        type: "spawn",
        label: "spawn_path_blocker",
        player: { id: "bob", name: "bob", x: 2, y: 1 },
      },
      {
        type: "move_to",
        label: "issue_blocked_path",
        playerId: "alice",
        x: 3,
        y: 1,
      },
      {
        type: "tick",
        label: "after_blocked_path_tick",
      },
    ],
  },
  direction_handoff: {
    description:
      "Reproduces one-tile directional movement starting from a fractional position.",
    map: MINI_MAP,
    actions: [
      {
        type: "spawn",
        label: "spawn_fractional_player",
        player: { id: "p1", name: "p1", x: 2.25, y: 2 },
      },
      {
        type: "move_direction",
        label: "move_left",
        playerId: "p1",
        direction: "left",
      },
      {
        type: "snapshot",
        label: "after_direction_move",
      },
    ],
  },
} satisfies Record<string, MovementHarnessScenario>;

export type MovementHarnessScenarioName =
  keyof typeof MOVEMENT_HARNESS_SCENARIOS;

export function listMovementHarnessScenarios(): Array<{
  name: MovementHarnessScenarioName;
  description: string;
}> {
  return Object.entries(MOVEMENT_HARNESS_SCENARIOS).map(([name, scenario]) => ({
    name: name as MovementHarnessScenarioName,
    description: scenario.description,
  }));
}

export function runMovementHarnessScenario(
  scenarioName: MovementHarnessScenarioName,
): MovementHarnessResult {
  const scenario: MovementHarnessScenario =
    MOVEMENT_HARNESS_SCENARIOS[scenarioName];
  const game = new GameLoop({
    seed: 42,
    mode: "stepped",
    tickRate: 20,
    validateInvariants: true,
  });
  game.loadWorld(scenario.map);

  const snapshots: MovementHarnessSnapshot[] = [];
  const script: MovementHarnessScriptEntry[] = [];
  let loggedCount = 0;

  for (const action of scenario.actions) {
    script.push(actionToScriptEntry(action, game.currentTick));
    switch (action.type) {
      case "spawn": {
        game.spawnPlayer({
          id: action.player.id,
          name: action.player.name,
          x: action.player.x,
          y: action.player.y,
          isNpc: action.player.isNpc,
          speed: action.player.speed,
        });
        snapshots.push(captureSnapshot(game, action.label, loggedCount));
        loggedCount = game.logger.size;
        break;
      }
      case "input": {
        game.setPlayerInput(action.playerId, action.direction, action.active);
        snapshots.push(captureSnapshot(game, action.label, loggedCount));
        loggedCount = game.logger.size;
        break;
      }
      case "move_to": {
        game.setPlayerTarget(action.playerId, action.x, action.y);
        snapshots.push(captureSnapshot(game, action.label, loggedCount));
        loggedCount = game.logger.size;
        break;
      }
      case "move_direction": {
        game.movePlayerDirection(action.playerId, action.direction);
        snapshots.push(captureSnapshot(game, action.label, loggedCount));
        loggedCount = game.logger.size;
        break;
      }
      case "tick": {
        const count = action.count ?? 1;
        for (let step = 0; step < count; step++) {
          game.tick();
          const label =
            count === 1 ? action.label : `${action.label}_${step + 1}`;
          snapshots.push(captureSnapshot(game, label, loggedCount));
          loggedCount = game.logger.size;
        }
        break;
      }
      case "snapshot": {
        snapshots.push(captureSnapshot(game, action.label, loggedCount));
        loggedCount = game.logger.size;
        break;
      }
    }
  }

  const eventTrace = snapshots.flatMap((snapshot) =>
    snapshot.events.map((event) => ({
      snapshotLabel: snapshot.label,
      event,
    })),
  );
  const verification = verifyExpectedTrace(
    eventTrace,
    scenario.expectedTrace ?? [],
  );

  return {
    scenario: scenarioName,
    description: scenario.description,
    map: scenario.map,
    script,
    snapshots,
    eventTrace,
    verification,
  };
}

export function formatMovementHarnessResult(
  result: MovementHarnessResult,
): string {
  const lines: string[] = [
    `Scenario: ${result.scenario}`,
    `Description: ${result.description}`,
    `Verification: ${
      result.verification.passed
        ? `passed (${result.verification.matched}/${result.verification.expected})`
        : `failed (${result.verification.matched}/${result.verification.expected})`
    }`,
    "",
  ];

  if (!result.verification.passed) {
    lines.push("Verification failures:");
    for (const failure of result.verification.failures) {
      lines.push(`- ${failure}`);
    }
    lines.push("");
  }

  lines.push("Script:");
  for (const step of result.script) {
    lines.push(
      `- [tick ${step.tick}] ${step.label} ${step.action} ${JSON.stringify(step.data)}`,
    );
  }
  lines.push("");

  for (const snapshot of result.snapshots) {
    lines.push(`Snapshot: ${snapshot.label} (tick=${snapshot.tick})`);
    if (snapshot.players.length === 0) {
      lines.push("Players: none");
    } else {
      lines.push("Players:");
      for (const player of snapshot.players) {
        const pathInfo =
          player.pathLength !== undefined
            ? ` path=${player.pathIndex ?? 0}/${player.pathLength}`
            : "";
        const targetInfo =
          player.targetX !== undefined
            ? ` target=(${player.targetX},${player.targetY})`
            : "";
        lines.push(
          `- ${player.id} @ (${player.x}, ${player.y}) ${player.state} facing ${player.orientation} v=(${player.vx}, ${player.vy})${targetInfo}${pathInfo}`,
        );
      }
    }

    if (snapshot.events.length === 0) {
      lines.push("Events: none");
    } else {
      lines.push("Events:");
      for (const event of snapshot.events) {
        const details = event.data ? ` ${JSON.stringify(event.data)}` : "";
        lines.push(`- [tick ${event.tick}] ${event.type}${details}`);
      }
    }

    lines.push("ASCII:");
    lines.push(snapshot.ascii);
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

function captureSnapshot(
  game: GameLoop,
  label: string,
  loggedCount: number,
): MovementHarnessSnapshot {
  const allEvents = game.logger.getEvents();
  const { ascii, legend } = renderAsciiMap(game);
  return {
    label,
    tick: game.currentTick,
    players: game.getPlayers().map(toPlayerState).sort(comparePlayers),
    ascii,
    legend,
    events: allEvents.slice(loggedCount).filter(shouldIncludeEvent),
  };
}

function toPlayerState(player: Player): MovementHarnessPlayerState {
  return {
    id: player.id,
    x: roundValue(player.x),
    y: roundValue(player.y),
    state: player.state,
    orientation: player.orientation,
    vx: roundValue(player.vx),
    vy: roundValue(player.vy),
    radius: player.radius,
    targetX: player.targetX,
    targetY: player.targetY,
    pathLength: player.path?.length,
    pathIndex: player.pathIndex,
  };
}

function roundValue(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function shouldIncludeEvent(event: GameEvent): boolean {
  return DEFAULT_EVENT_TYPES.has(event.type);
}

function comparePlayers(
  left: MovementHarnessPlayerState,
  right: MovementHarnessPlayerState,
): number {
  return left.id.localeCompare(right.id);
}

function actionToScriptEntry(
  action: HarnessAction,
  tick: number,
): MovementHarnessScriptEntry {
  switch (action.type) {
    case "spawn":
      return {
        tick,
        label: action.label,
        action: action.type,
        data: { ...action.player },
      };
    case "input":
      return {
        tick,
        label: action.label,
        action: action.type,
        data: {
          playerId: action.playerId,
          direction: action.direction,
          active: action.active,
        },
      };
    case "move_to":
      return {
        tick,
        label: action.label,
        action: action.type,
        data: { playerId: action.playerId, x: action.x, y: action.y },
      };
    case "move_direction":
      return {
        tick,
        label: action.label,
        action: action.type,
        data: { playerId: action.playerId, direction: action.direction },
      };
    case "tick":
      return {
        tick,
        label: action.label,
        action: action.type,
        data: { count: action.count ?? 1 },
      };
    case "snapshot":
      return {
        tick,
        label: action.label,
        action: action.type,
        data: {},
      };
  }
}

function verifyExpectedTrace(
  eventTrace: MovementHarnessEventTraceEntry[],
  expectedTrace: MovementHarnessExpectedEvent[],
): MovementHarnessVerification {
  if (expectedTrace.length === 0) {
    return { passed: true, matched: 0, expected: 0, failures: [] };
  }

  const failures: string[] = [];
  let cursor = 0;
  let matched = 0;

  for (const expected of expectedTrace) {
    let foundIndex = -1;
    for (let i = cursor; i < eventTrace.length; i++) {
      if (matchesExpectedTraceEvent(eventTrace[i], expected)) {
        foundIndex = i;
        break;
      }
    }

    if (foundIndex === -1) {
      failures.push(
        `missing ${expected.type} for ${expected.playerId ?? "any player"} in ${expected.snapshotLabel ?? "any snapshot"}`,
      );
      continue;
    }

    matched++;
    cursor = foundIndex + 1;
  }

  return {
    passed: failures.length === 0,
    matched,
    expected: expectedTrace.length,
    failures,
  };
}

function matchesExpectedTraceEvent(
  traceEntry: MovementHarnessEventTraceEntry,
  expected: MovementHarnessExpectedEvent,
): boolean {
  if (
    expected.snapshotLabel &&
    traceEntry.snapshotLabel !== expected.snapshotLabel
  ) {
    return false;
  }
  if (expected.tick !== undefined && traceEntry.event.tick !== expected.tick) {
    return false;
  }
  if (traceEntry.event.type !== expected.type) {
    return false;
  }
  if (expected.playerId && traceEntry.event.playerId !== expected.playerId) {
    return false;
  }
  if (expected.data && !matchesPartial(traceEntry.event.data, expected.data)) {
    return false;
  }
  return true;
}

function matchesPartial(actual: unknown, expected: unknown): boolean {
  if (expected === null || typeof expected !== "object") {
    return roundExpected(actual) === roundExpected(expected);
  }
  if (actual === null || typeof actual !== "object") {
    return false;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) {
      return false;
    }
    return expected.every((value, index) =>
      matchesPartial(actual[index], value),
    );
  }

  const expectedObject = expected as Record<string, unknown>;
  const actualObject = actual as Record<string, unknown>;
  return Object.entries(expectedObject).every(([key, value]) =>
    matchesPartial(actualObject[key], value),
  );
}

function roundExpected(value: unknown): unknown {
  if (typeof value !== "number") return value;
  return Math.round(value * 1000) / 1000;
}
