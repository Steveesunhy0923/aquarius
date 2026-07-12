"use client";

import { useState } from "react";

/**
 * Asked before applying a template to a note that already has content.
 * Yes = add the template to the note; No = discard the current content and
 * start from the template. "Don't show this again" remembers the choice
 * (Settings → Applying a template).
 */
export function TemplateApplyDialog({
  onAdd,
  onReplace,
  onCancel,
}: {
  onAdd: (dontAskAgain: boolean) => void;
  onReplace: (dontAskAgain: boolean) => void;
  onCancel: () => void;
}) {
  const [dontAsk, setDontAsk] = useState(false);
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-foreground/25 p-4" onClick={onCancel}>
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold">Add the template to your document?</h2>
        <p className="mt-2 text-sm text-muted">
          This note already has content. Choose <b>Yes</b> to add the template to it, or <b>No</b> to discard everything and start fresh from the template.
        </p>
        <label className="mt-3 flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={dontAsk} onChange={(e) => setDontAsk(e.target.checked)} className="h-4 w-4 accent-accent" />
          Don’t show this again
        </label>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button onClick={() => onReplace(dontAsk)} className="rounded-md border border-border px-3 py-1.5 text-sm hover:border-red-500 hover:text-red-500">
            No, replace
          </button>
          <button onClick={() => onAdd(dontAsk)} className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">
            Yes, add
          </button>
        </div>
      </div>
    </div>
  );
}
