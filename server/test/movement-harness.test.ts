import { describe, expect, it } from "vitest";
import {
  listMovementHarnessScenarios,
  runMovementHarnessScenario,
} from "../src/debug/movementHarness.js";

describe("movement harness", () => {
  it("lists the built-in scenarios", () => {
    const scenarios = listMovementHarnessScenarios();
    expect(scenarios.map((scenario) => scenario.name)).toEqual([
      "path_handoff",
      "runtime_spawn_input",
      "simultaneous_input_release",
      "input_blocked_by_player",
      "path_blocked_by_player",
      "direction_handoff",
    ]);
  });

  it("captures the final position for path handoff without a jump", () => {
    const result = runMovementHarnessScenario("path_handoff");
    expect(result.verification.passed).toBe(true);
    const moveCommandSnapshot = result.snapshots.find(
      (snapshot) => snapshot.label === "issue_path_target",
    );
    const midPathSnapshot = result.snapshots.find(
      (snapshot) => snapshot.label === "after_path_tick",
    );
    const latePathSnapshot = result.snapshots.find(
      (snapshot) => snapshot.label === "after_path_tick_2",
    );
    const finalSnapshot = result.snapshots.find(
      (snapshot) => snapshot.label === "after_path_tick_3",
    );
    expect(moveCommandSnapshot).toBeDefined();
    expect(midPathSnapshot).toBeDefined();
    expect(latePathSnapshot).toBeDefined();
    expect(finalSnapshot).toBeDefined();

    const playerAfterCommand = moveCommandSnapshot!.players.find(
      (entry) => entry.id === "p1",
    );
    expect(playerAfterCommand?.x).toBe(2.25);
    expect(playerAfterCommand?.y).toBe(2);

    const playerMidPath = midPathSnapshot!.players.find(
      (entry) => entry.id === "p1",
    );
    expect(playerMidPath?.x).toBe(2.05);
    expect(playerMidPath?.y).toBe(1.2);

    const playerLatePath = latePathSnapshot!.players.find(
      (entry) => entry.id === "p1",
    );
    expect(playerLatePath?.x).toBe(2.75);
    expect(playerLatePath?.y).toBe(1);

    const player = finalSnapshot.players.find((entry) => entry.id === "p1");
    expect(player?.x).toBe(3);
    expect(player?.y).toBe(1);
  });

  it("captures the runtime spawn movement scenario that was missing before", () => {
    const result = runMovementHarnessScenario("runtime_spawn_input");
    expect(result.verification.passed).toBe(true);
    const finalSnapshot = result.snapshots[result.snapshots.length - 1];
    const player = finalSnapshot.players.find((entry) => entry.id === "p1");
    expect(player?.x).toBe(1.25);
    expect(player?.y).toBe(2);
  });

  it("captures simultaneous held input and release order correctly", () => {
    const result = runMovementHarnessScenario("simultaneous_input_release");
    expect(result.verification.passed).toBe(true);
    const diagonalSnapshot = result.snapshots.find(
      (snapshot) => snapshot.label === "after_diagonal_tick",
    );
    const stopLeftSnapshot = result.snapshots.find(
      (snapshot) => snapshot.label === "stop_left_input",
    );
    const releaseSnapshot = result.snapshots.find(
      (snapshot) => snapshot.label === "after_left_release_tick",
    );

    expect(diagonalSnapshot).toBeDefined();
    expect(stopLeftSnapshot).toBeDefined();
    expect(releaseSnapshot).toBeDefined();

    const diagonalPlayer = diagonalSnapshot!.players.find(
      (entry) => entry.id === "p1",
    );
    expect(diagonalPlayer?.x).toBeCloseTo(2 - 0.25 / Math.sqrt(2));
    expect(diagonalPlayer?.y).toBeCloseTo(2 - 0.25 / Math.sqrt(2));
    expect(diagonalSnapshot!.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "input_move",
          data: expect.objectContaining({
            vx: expect.closeTo(-5 / Math.sqrt(2), 5),
            vy: expect.closeTo(-5 / Math.sqrt(2), 5),
          }),
        }),
      ]),
    );

    const releaseInputEvent = stopLeftSnapshot!.events.find(
      (event) => event.type === "input_state",
    );
    expect(releaseInputEvent?.data).toMatchObject({
      direction: "left",
      active: false,
      inputX: 0,
      inputY: -1,
    });

    const releasePlayer = releaseSnapshot!.players.find(
      (entry) => entry.id === "p1",
    );
    expect(releasePlayer?.x).toBeCloseTo(2 - 0.25 / Math.sqrt(2));
    expect(releasePlayer?.y).toBeCloseTo(2 - 0.25 / Math.sqrt(2) - 0.25);
  });

  it("returns a replayable bundle with script and flattened trace", () => {
    const result = runMovementHarnessScenario("simultaneous_input_release");
    expect(result.script.map((step) => step.label)).toEqual([
      "spawn_player",
      "start_up_input",
      "start_left_input",
      "after_diagonal_tick",
      "stop_left_input",
      "after_left_release_tick",
    ]);
    expect(result.eventTrace.length).toBeGreaterThan(0);
    expect(result.map.width).toBe(5);
    expect(result.map.height).toBe(5);
  });

  it("captures the blocker for continuous input collisions", () => {
    const result = runMovementHarnessScenario("input_blocked_by_player");
    const finalSnapshot = result.snapshots[result.snapshots.length - 1];
    const alice = finalSnapshot.players.find((entry) => entry.id === "a");
    const bob = finalSnapshot.players.find((entry) => entry.id === "b");
    expect(alice).toBeDefined();
    expect(bob).toBeDefined();

    const distance = Math.hypot(alice!.x - bob!.x, alice!.y - bob!.y);
    expect(distance).toBeGreaterThanOrEqual(alice!.radius + bob!.radius - 0.001);

    const collision = finalSnapshot.events.find(
      (event) => event.type === "player_collision",
    );
    expect(collision?.data).toMatchObject({
      mode: "input",
      blockerId: "b",
    });
  });

  it("captures the blocker for path waypoint collisions", () => {
    const result = runMovementHarnessScenario("path_blocked_by_player");
    const finalSnapshot = result.snapshots[result.snapshots.length - 1];
    const collision = finalSnapshot.events.find(
      (event) => event.type === "player_collision",
    );
    expect(collision?.data).toMatchObject({
      mode: "path",
      blockerId: "bob",
    });
  });

  it("captures the snap for discrete direction movement", () => {
    const result = runMovementHarnessScenario("direction_handoff");
    const finalSnapshot = result.snapshots[result.snapshots.length - 1];
    const player = finalSnapshot.players.find((entry) => entry.id === "p1");
    expect(player?.x).toBe(1);
    expect(player?.y).toBe(2);
  });
});
