"use client";

/**
 * MathKeyboardDismiss — a close affordance for MathLive's on-screen virtual
 * keyboard, which ships without a visible exit button. Mounted once at the app
 * root. While the keyboard is visible it renders a floating "Hide keyboard"
 * button just above it (calling `mathVirtualKeyboard.hide()`), and Escape closes
 * the keyboard FIRST — before the focused field's own Escape handler exits it.
 *
 * We talk to MathLive's global virtual-keyboard singleton via a minimal local
 * type so this file never imports (and eagerly bundles) `mathlive`.
 */

import { useEffect, useState } from "react";

interface VKbd extends EventTarget {
  visible: boolean;
  boundingRect: DOMRect;
  hide: () => void;
}
function vkbd(): VKbd | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { mathVirtualKeyboard?: VKbd }).mathVirtualKeyboard ?? null;
}

export function MathKeyboardDismiss() {
  const [visible, setVisible] = useState(false);
  const [bottom, setBottom] = useState(0);

  useEffect(() => {
    let vk: VKbd | null = null;
    const onGeo = () => {
      if (!vk) return;
      setVisible(vk.visible);
      setBottom(vk.visible ? vk.boundingRect?.height ?? 0 : 0);
    };
    // A math-field gaining focus means mathlive has loaded and the singleton
    // exists; attach the geometry listener exactly once.
    const tryAttach = () => {
      if (vk) return;
      const found = vkbd();
      if (!found) return;
      vk = found;
      vk.addEventListener("geometrychange", onGeo);
      onGeo();
    };
    const onKey = (e: KeyboardEvent) => {
      const k = vkbd();
      if (e.key === "Escape" && k?.visible) {
        e.preventDefault();
        e.stopImmediatePropagation(); // first Escape just closes the keyboard
        k.hide();
      }
    };
    document.addEventListener("focusin", tryAttach);
    window.addEventListener("keydown", onKey, true);
    tryAttach();
    return () => {
      document.removeEventListener("focusin", tryAttach);
      window.removeEventListener("keydown", onKey, true);
      vk?.removeEventListener("geometrychange", onGeo);
    };
  }, []);

  if (!visible) return null;
  return (
    <button
      type="button"
      aria-label="Hide math keyboard"
      onMouseDown={(e) => e.preventDefault()} // keep field focus; don't blur-exit
      onClick={() => vkbd()?.hide()}
      style={{ position: "fixed", right: 16, bottom: bottom + 8, zIndex: 2147483647 }}
      className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground shadow-lg hover:border-accent"
    >
      Hide keyboard ✕
    </button>
  );
}
