type TimeoutHandle = ReturnType<typeof setTimeout>;

export interface DashboardRenderSchedulerOptions {
  throttleMs: number;
  render: () => void;
  now?: () => number;
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  setTimeout?: (handler: () => void, timeoutMs: number) => TimeoutHandle;
  clearTimeout?: (handle: TimeoutHandle) => void;
}

export interface DashboardRenderScheduler {
  schedule: (immediate?: boolean) => void;
  cancel: () => void;
}

export function createDashboardRenderScheduler(
  options: DashboardRenderSchedulerOptions,
): DashboardRenderScheduler {
  const now = options.now ?? (() => performance.now());
  const requestFrame = options.requestAnimationFrame ?? requestAnimationFrame;
  const setTimeoutImpl = options.setTimeout ?? setTimeout;
  const clearTimeoutImpl = options.clearTimeout ?? clearTimeout;

  let renderScheduled = false;
  let lastRenderTime = 0;
  let pendingThrottleTimer: TimeoutHandle | null = null;

  function runOnNextFrame(): void {
    renderScheduled = true;
    requestFrame(() => {
      renderScheduled = false;
      lastRenderTime = now();
      options.render();
    });
  }

  function schedule(immediate = false): void {
    if (immediate) {
      if (pendingThrottleTimer !== null) {
        clearTimeoutImpl(pendingThrottleTimer);
        pendingThrottleTimer = null;
      }
      if (renderScheduled) return;
      runOnNextFrame();
      return;
    }

    if (renderScheduled || pendingThrottleTimer !== null) return;
    const elapsed = now() - lastRenderTime;
    if (elapsed >= options.throttleMs) {
      runOnNextFrame();
      return;
    }

    pendingThrottleTimer = setTimeoutImpl(() => {
      pendingThrottleTimer = null;
      runOnNextFrame();
    }, options.throttleMs - elapsed);
  }

  function cancel(): void {
    if (pendingThrottleTimer !== null) {
      clearTimeoutImpl(pendingThrottleTimer);
      pendingThrottleTimer = null;
    }
  }

  return { schedule, cancel };
}
