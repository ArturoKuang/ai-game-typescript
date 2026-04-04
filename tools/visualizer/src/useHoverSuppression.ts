/**
 * Hook that manages hover state with zoom/pan suppression.
 *
 * Problem: During zoom, React Flow fires rapid mouseLeave/mouseEnter
 * as nodes shift under the cursor. Without suppression, hover state
 * toggles on every frame → the highlight dims/undims → visible flash.
 *
 * Solution: While the viewport is moving (isMoving), mouseLeave events
 * are deferred. When movement ends, pending clears flush.
 */
import { useCallback, useRef } from "react";

const DEBOUNCE_MS = 80;

export interface HoverSuppression {
  /** Call when React Flow viewport starts moving (pan/zoom) */
  onMoveStart: () => void;
  /** Call when React Flow viewport stops moving */
  onMoveEnd: () => void;
  /** Call on mouseEnter — sets hover immediately, cancels pending clear */
  enter: (id: string) => void;
  /** Call on mouseLeave — defers clear if moving, debounces otherwise */
  leave: () => void;
}

export function useHoverSuppression(
  setHovered: (id: string | null) => void,
): HoverSuppression {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMoving = useRef(false);
  const pendingClear = useRef(false);

  const onMoveStart = useCallback(() => {
    isMoving.current = true;
  }, []);

  const onMoveEnd = useCallback(() => {
    isMoving.current = false;
    if (pendingClear.current) {
      pendingClear.current = false;
      setHovered(null);
    }
  }, [setHovered]);

  const enter = useCallback((id: string) => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    pendingClear.current = false;
    setHovered(id);
  }, [setHovered]);

  const leave = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    if (isMoving.current) {
      pendingClear.current = true;
      return;
    }
    timer.current = setTimeout(() => setHovered(null), DEBOUNCE_MS);
  }, [setHovered]);

  return { onMoveStart, onMoveEnd, enter, leave };
}

/**
 * Testable standalone version (no React hooks) for unit tests.
 * Mirrors the hook logic but takes explicit state callbacks.
 */
export function createHoverSuppression(
  setHovered: (id: string | null) => void,
  timers: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout },
): HoverSuppression & { _isMoving: () => boolean; _isPendingClear: () => boolean } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let moving = false;
  let pending = false;

  return {
    _isMoving: () => moving,
    _isPendingClear: () => pending,

    onMoveStart() {
      moving = true;
    },

    onMoveEnd() {
      moving = false;
      if (pending) {
        pending = false;
        setHovered(null);
      }
    },

    enter(id: string) {
      if (timer) { timers.clearTimeout(timer); timer = null; }
      pending = false;
      setHovered(id);
    },

    leave() {
      if (timer) timers.clearTimeout(timer);
      if (moving) {
        pending = true;
        return;
      }
      timer = timers.setTimeout(() => setHovered(null), DEBOUNCE_MS);
    },
  };
}
