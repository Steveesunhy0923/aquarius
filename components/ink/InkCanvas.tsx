"use client";

/**
 * InkCanvas — a Notability-style handwriting surface.
 *
 * The compact, single-page shape of InkSurface: one canvas that fills whatever
 * box the caller gives it. Everything the /ink lab and the editor's bottom
 * sheet ever asked of this component — the props, the imperative handle, the
 * painted result — is unchanged; InkSurface simply also knows how to be a
 * scrolling stack of A4 sheets (`pageMode="a4"`), and the two share one
 * renderer (inkpaint.ts) so the ink looks identical either way.
 *
 * See InkSurface.tsx for the pointer/palm-rejection/backing-store details.
 */

import { forwardRef, type Ref } from "react";
import { InkSurface, type InkCanvasHandle, type InkSurfaceHandle, type InkSurfaceProps } from "./InkSurface";

export type { InkCanvasHandle };

export const InkCanvas = forwardRef<InkCanvasHandle, Omit<InkSurfaceProps, "pageMode" | "zoom">>(
  function InkCanvas(props, ref) {
    // Widening the ref is sound in one direction only, which is the direction
    // we use: InkSurfaceHandle is a structural superset of InkCanvasHandle, and
    // the child only ever writes the handle through it.
    return <InkSurface {...props} pageMode="free" ref={ref as Ref<InkSurfaceHandle>} />;
  },
);
