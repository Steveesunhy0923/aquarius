"use client";

import { Dialog } from "@/components/ui/Dialog";
import { useRef, useState } from "react";

const FIELD =
  "w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-accent";

/**
 * "Fill in the fields" prompt shown when an inserted module/template contains
 * `{{field}}` tokens. One input per field; blank inputs (and Skip) leave the
 * token in place as a visible placeholder to fill later. Closing the dialog
 * (Escape / scrim / ×) cancels the insertion entirely.
 */
export function ModuleFieldsDialog({ name, fields, onSubmit, onCancel }: {
  /** What is being inserted — shown in the intro line (e.g. the module name). */
  name: string;
  fields: string[];
  onSubmit: (values: Record<string, string>) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const formRef = useRef<HTMLFormElement>(null);

  const set = (field: string, v: string) => setValues((prev) => ({ ...prev, [field]: v }));

  return (
    <Dialog title="Fill in the fields" onClose={onCancel}>
      <form
        ref={formRef}
        className="px-5 py-4"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(values);
        }}
      >
        <p className="mb-3 text-xs text-muted">
          <span className="font-medium text-foreground">{name}</span> has fill-in fields. Blank
          ones stay as placeholders you can fill in the note.
        </p>
        <div className="flex max-h-80 flex-col gap-2.5 overflow-y-auto">
          {fields.map((f, i) => (
            <label key={f} className="block">
              <span className="mb-1 block text-[10.5px] font-semibold uppercase tracking-[0.09em] text-muted">{f}</span>
              <input
                autoFocus={i === 0}
                value={values[f] ?? ""}
                onChange={(e) => set(f, e.target.value)}
                onKeyDown={(e) => {
                  // Enter advances through the fields like a snippet; on the
                  // last field it submits (the form's default would anyway).
                  if (e.key !== "Enter" || i === fields.length - 1) return;
                  e.preventDefault();
                  const inputs = formRef.current?.querySelectorAll("input");
                  (inputs?.[i + 1] as HTMLInputElement | undefined)?.focus();
                }}
                placeholder={f}
                className={FIELD}
              />
            </label>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => onSubmit({})}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-muted hover:bg-foreground/[0.04]"
          >
            Skip
          </button>
          <button type="submit" className="rounded-md bg-accent px-3.5 py-1.5 text-xs font-medium text-white transition hover:opacity-90">
            Insert
          </button>
        </div>
      </form>
    </Dialog>
  );
}
