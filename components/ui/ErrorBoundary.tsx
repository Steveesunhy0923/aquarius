"use client";

import { Component, type ReactNode } from "react";

import { reportError } from "@/lib/monitoring";

/**
 * Contain a render failure to one piece of the page.
 *
 * The route boundary (app/error.tsx) replaces the WHOLE page, which is right
 * when the page itself is broken and wrong when the broken thing is incidental
 * to it. A note's cover thumbnail renders that note's document tree: without
 * this, one note with a tree the renderer cannot handle took down the library
 * that lists it — and with it the only way to reach every other note.
 *
 * Wrap content whose failure should cost only itself, and give it a `fallback`
 * that occupies the same space. `resetKey` clears the error when it changes
 * (e.g. a different note id in the same slot).
 */
export class ErrorBoundary extends Component<
  { area: string; fallback?: ReactNode; resetKey?: unknown; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    reportError(error, { area: this.props.area });
  }

  componentDidUpdate(prev: { resetKey?: unknown }): void {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  render(): ReactNode {
    return this.state.failed ? (this.props.fallback ?? null) : this.props.children;
  }
}
