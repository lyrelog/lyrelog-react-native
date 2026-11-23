import * as React from "react";
import type { LyrelogClient } from "./client";
import { Lyrelog } from "./instance";
import type { Attributes } from "./types";

/**
 * Says which screen the person is on when the component mounts (and when `name` changes). For a
 * screen inside React Navigation, prefer `trackNavigation` on the container: it also sees the
 * person going back.
 */
export function useLyrelogScreen(name: string, attrs?: Attributes): void {
  React.useEffect(() => {
    Lyrelog.screen(name, attrs);
    // attrs are read when the name changes, not on every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);
}

/** What `trackNavigation` reads: a React Navigation container ref (`createNavigationContainerRef()`, `useNavigationContainerRef()`). */
export interface NavigationRefLike {
  getCurrentRoute(): { name: string; params?: unknown } | undefined;
}

export interface TrackNavigationOptions {
  /** The screen's name from its route; return `undefined` to skip it. Default: the route's name. */
  name?: (route: { name: string; params?: unknown }) => string | undefined;
  /** Called after Lyrelog, so you can keep your own handlers. */
  onReady?: () => void;
  onStateChange?: (state: unknown) => void;
  /** @internal For the tests. */
  client?: LyrelogClient;
}

/**
 * `screen()` for every screen React Navigation shows: spread it on the container.
 *
 * ```tsx
 * const navigationRef = createNavigationContainerRef();
 * <NavigationContainer ref={navigationRef} {...trackNavigation(navigationRef)}>
 * ```
 */
export function trackNavigation(
  ref: NavigationRefLike | { current: NavigationRefLike | null },
  options: TrackNavigationOptions = {},
): { onReady: () => void; onStateChange: (state: unknown) => void } {
  const client = options.client ?? Lyrelog;
  const report = () => {
    try {
      const container = "getCurrentRoute" in ref ? ref : ref.current;
      const route = container?.getCurrentRoute();
      if (!route) return;
      const name = options.name ? options.name(route) : route.name;
      if (name) client.screen(name);
    } catch {
      // never throws
    }
  };
  return {
    onReady: () => {
      report();
      options.onReady?.();
    },
    onStateChange: (state: unknown) => {
      report();
      options.onStateChange?.(state);
    },
  };
}

export interface LyrelogErrorBoundaryProps {
  children?: React.ReactNode;
  /** Shown instead of the children after an error. A function gets the error and a way to try again. */
  fallback?: React.ReactNode | ((props: { error: unknown; reset: () => void }) => React.ReactNode);
  /** The area the `exception` event is filed under. */
  category?: string;
  /** Called after the error is recorded. */
  onError?: (error: unknown, componentStack: string | null | undefined) => void;
  /** @internal For the tests. */
  client?: LyrelogClient;
}

interface BoundaryState {
  error: unknown;
  failed: boolean;
}

/**
 * Catches render errors below it and records them as `exception` (with `mechanism:
 * error_boundary` and React's component stack), then shows `fallback`. Without a fallback it
 * renders nothing after an error.
 */
export class LyrelogErrorBoundary extends React.Component<LyrelogErrorBoundaryProps, BoundaryState> {
  state: BoundaryState = { error: undefined, failed: false };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { error, failed: true };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    const client = this.props.client ?? Lyrelog;
    client.captureError(error, {
      category: this.props.category,
      attrs: { mechanism: "error_boundary" },
      componentStack: info?.componentStack,
    });
    try {
      this.props.onError?.(error, info?.componentStack);
    } catch {
      // the app's own handler
    }
  }

  private reset = () => this.setState({ error: undefined, failed: false });

  render(): React.ReactNode {
    if (!this.state.failed) return this.props.children;
    const { fallback } = this.props;
    if (typeof fallback === "function") return fallback({ error: this.state.error, reset: this.reset });
    return fallback ?? null;
  }
}
