import { afterEach, describe, expect, it, vi } from "vitest";
import { createDashboardRenderScheduler } from "../../client/src/debugDashboardScheduler.js";

function flushAnimationFrame(
  queue: Array<(timestamp: number) => void>,
  timestamp: number,
): void {
  const callback = queue.shift();
  if (!callback) {
    throw new Error("expected a queued animation frame");
  }
  callback(timestamp);
}

describe("debug dashboard render scheduler", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("coalesces immediate renders onto a single animation frame", () => {
    vi.useFakeTimers();
    const nowValue = 1000;
    const render = vi.fn();
    const animationFrames: Array<(timestamp: number) => void> = [];
    const scheduler = createDashboardRenderScheduler({
      throttleMs: 200,
      render,
      now: () => nowValue,
      requestAnimationFrame: (callback) => {
        animationFrames.push(callback);
        return animationFrames.length;
      },
    });

    scheduler.schedule(true);
    scheduler.schedule(true);

    expect(render).not.toHaveBeenCalled();
    expect(animationFrames).toHaveLength(1);

    flushAnimationFrame(animationFrames, nowValue);

    expect(render).toHaveBeenCalledTimes(1);
  });

  it("throttles data-driven renders until the throttle window expires", () => {
    vi.useFakeTimers();
    let nowValue = 1000;
    const render = vi.fn();
    const animationFrames: Array<(timestamp: number) => void> = [];
    const scheduler = createDashboardRenderScheduler({
      throttleMs: 200,
      render,
      now: () => nowValue,
      requestAnimationFrame: (callback) => {
        animationFrames.push(callback);
        return animationFrames.length;
      },
      setTimeout,
      clearTimeout,
    });

    scheduler.schedule(false);
    expect(animationFrames).toHaveLength(1);
    flushAnimationFrame(animationFrames, nowValue);
    expect(render).toHaveBeenCalledTimes(1);

    nowValue = 1050;
    scheduler.schedule(false);
    scheduler.schedule(false);

    expect(animationFrames).toHaveLength(0);
    vi.advanceTimersByTime(149);
    expect(animationFrames).toHaveLength(0);

    vi.advanceTimersByTime(1);
    expect(animationFrames).toHaveLength(1);

    flushAnimationFrame(animationFrames, nowValue);
    expect(render).toHaveBeenCalledTimes(2);
  });
});
