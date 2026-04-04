import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHoverSuppression } from "./useHoverSuppression";

describe("createHoverSuppression", () => {
  let setHovered: ReturnType<typeof vi.fn>;
  let suppression: ReturnType<typeof createHoverSuppression>;

  beforeEach(() => {
    vi.useFakeTimers();
    setHovered = vi.fn();
    suppression = createHoverSuppression(setHovered, {
      setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown as ReturnType<typeof setTimeout>,
      clearTimeout: (id) => clearTimeout(id),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("enter sets hovered immediately", () => {
    suppression.enter("node-1");
    expect(setHovered).toHaveBeenCalledWith("node-1");
  });

  it("leave clears hovered after debounce", () => {
    suppression.enter("node-1");
    setHovered.mockClear();

    suppression.leave();
    // Not cleared yet — debounce pending
    expect(setHovered).not.toHaveBeenCalled();

    vi.advanceTimersByTime(80);
    expect(setHovered).toHaveBeenCalledWith(null);
  });

  it("rapid enter after leave cancels the clear", () => {
    suppression.enter("node-1");
    setHovered.mockClear();

    suppression.leave();
    vi.advanceTimersByTime(50); // less than 80ms debounce
    suppression.enter("node-2");

    // Should set node-2, never set null
    expect(setHovered).toHaveBeenCalledWith("node-2");
    expect(setHovered).not.toHaveBeenCalledWith(null);

    // Even after debounce expires, no null call
    vi.advanceTimersByTime(100);
    expect(setHovered).not.toHaveBeenCalledWith(null);
  });

  // --- The critical zoom tests ---

  it("leave during movement does NOT clear hover", () => {
    suppression.enter("node-1");
    setHovered.mockClear();

    suppression.onMoveStart();
    suppression.leave();

    // No debounce scheduled — leave is deferred
    vi.advanceTimersByTime(200);
    expect(setHovered).not.toHaveBeenCalled();
    expect(suppression._isPendingClear()).toBe(true);
  });

  it("onMoveEnd flushes pending clear", () => {
    suppression.enter("node-1");
    setHovered.mockClear();

    suppression.onMoveStart();
    suppression.leave(); // deferred
    expect(setHovered).not.toHaveBeenCalled();

    suppression.onMoveEnd();
    expect(setHovered).toHaveBeenCalledWith(null);
    expect(suppression._isPendingClear()).toBe(false);
  });

  it("enter during movement cancels pending clear", () => {
    suppression.enter("node-1");
    setHovered.mockClear();

    suppression.onMoveStart();
    suppression.leave(); // sets pending
    expect(suppression._isPendingClear()).toBe(true);

    suppression.enter("node-2"); // cancels pending, sets new hover
    expect(suppression._isPendingClear()).toBe(false);
    expect(setHovered).toHaveBeenCalledWith("node-2");
    expect(setHovered).not.toHaveBeenCalledWith(null);

    // onMoveEnd should NOT flush since pending was cancelled
    setHovered.mockClear();
    suppression.onMoveEnd();
    expect(setHovered).not.toHaveBeenCalled();
  });

  it("simulates full zoom cycle: hover → zoom start → leave → zoom end → clears", () => {
    // 1. User hovers a node
    suppression.enter("node-1");
    expect(setHovered).toHaveBeenCalledWith("node-1");
    setHovered.mockClear();

    // 2. User starts zooming
    suppression.onMoveStart();
    expect(suppression._isMoving()).toBe(true);

    // 3. Node shifts under cursor → mouseLeave fires
    suppression.leave();
    expect(setHovered).not.toHaveBeenCalled(); // suppressed!
    expect(suppression._isPendingClear()).toBe(true);

    // 4. Zoom continues — more leave events, all suppressed
    suppression.leave();
    suppression.leave();
    expect(setHovered).not.toHaveBeenCalled();

    // 5. Zoom ends
    suppression.onMoveEnd();
    expect(setHovered).toHaveBeenCalledWith(null);
    expect(setHovered).toHaveBeenCalledTimes(1); // exactly once
  });

  it("simulates zoom cycle where cursor lands on new node: hover → zoom → leave → enter new → zoom end → stays", () => {
    // 1. Hover node-1
    suppression.enter("node-1");
    setHovered.mockClear();

    // 2. Zoom starts
    suppression.onMoveStart();

    // 3. Leave fires (node shifted away)
    suppression.leave();
    expect(suppression._isPendingClear()).toBe(true);

    // 4. Cursor lands on a different node during zoom
    suppression.enter("node-2");
    expect(setHovered).toHaveBeenCalledWith("node-2");
    expect(suppression._isPendingClear()).toBe(false);

    // 5. Zoom ends — hover stays on node-2, no null flash
    setHovered.mockClear();
    suppression.onMoveEnd();
    expect(setHovered).not.toHaveBeenCalled(); // no clear!
  });

  it("onMoveEnd with no pending clear is a no-op", () => {
    suppression.onMoveStart();
    suppression.onMoveEnd();
    expect(setHovered).not.toHaveBeenCalled();
  });

  it("multiple move cycles work correctly", () => {
    suppression.enter("node-1");
    setHovered.mockClear();

    // First zoom cycle — leave during zoom
    suppression.onMoveStart();
    suppression.leave();
    suppression.onMoveEnd();
    expect(setHovered).toHaveBeenCalledWith(null);
    setHovered.mockClear();

    // Re-hover
    suppression.enter("node-3");
    setHovered.mockClear();

    // Second zoom cycle — cursor stays on a node
    suppression.onMoveStart();
    suppression.onMoveEnd();
    expect(setHovered).not.toHaveBeenCalled(); // no pending, no clear
  });
});
