"use client";

import { useState } from "react";

import { BlockView } from "@/components/BlockView";
import { Icon } from "@/components/Icon";
import { Dialog, DialogSection } from "@/components/ui/Dialog";
import { BTN, BTN_PRIMARY, FIELD_SM as FIELD } from "@/components/ui/primitives";
import type { Block } from "@/lib/blocks/types";
import type { Module } from "@/lib/templates/modules";

/**
 * Where a section goes when it is saved as a module: into a NEW module, or into
 * one that already exists — added at the end, or replacing what is there.
 *
 * The old flow only ever made a new module, so the second copy of a section you
 * had already modularized became "Key terms 2". Adding and replacing are the two
 * things people actually mean: a module grew, or it was rewritten. Replace asks
 * again, because it discards content the module already had.
 */
export function SectionToModuleDialog({
  section,
  suggestedName,
  modules,
  onCreate,
  onAppend,
  onReplace,
  onClose,
}: {
  /** The captured section — shown so it is obvious what is being saved. */
  section: Block[];
  suggestedName: string;
  modules: Module[];
  onCreate: (name: string) => void;
  onAppend: (moduleId: string) => void;
  onReplace: (moduleId: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(suggestedName);
  const [confirmReplace, setConfirmReplace] = useState<string | null>(null);

  return (
    <Dialog title="Save section as module" onClose={onClose} maxWidth="max-w-2xl">
      <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
        <div className="pointer-events-none mb-4 max-h-28 overflow-hidden rounded-md border border-border bg-background p-3">
          <div className="origin-top-left scale-[0.8] space-y-1 [width:125%]">
            {section.slice(0, 6).map((b) => (
              <div key={b.id}><BlockView block={b} /></div>
            ))}
          </div>
        </div>

        <DialogSection className="mb-2">New module</DialogSection>
        <div className="flex items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) onCreate(name.trim()); }}
            placeholder="Module name"
            autoFocus
            className={FIELD}
          />
          <button onClick={() => onCreate(name.trim())} disabled={!name.trim()} className={`${BTN_PRIMARY} shrink-0 disabled:opacity-40`}>
            Create
          </button>
        </div>

        {modules.length > 0 && (
          <>
            <DialogSection className="mb-2 mt-6">Or save into one you have</DialogSection>
            <div className="overflow-hidden rounded-lg border border-border">
              {modules.map((m) => (
                <div key={m.id} className="flex items-center gap-2.5 border-t border-border-soft px-3 py-2 first:border-t-0">
                  <Icon name={m.icon} size={16} className="shrink-0 text-muted" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{m.name}</span>
                  {confirmReplace === m.id ? (
                    <>
                      <span className="shrink-0 text-xs text-muted">Replace its content?</span>
                      <button onClick={() => onReplace(m.id)} className="shrink-0 rounded-md border border-danger px-2 py-1 text-xs text-danger hover:bg-danger/10">
                        Replace
                      </button>
                      <button onClick={() => setConfirmReplace(null)} className="shrink-0 rounded-md border border-border px-2 py-1 text-xs hover:border-accent">
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => onAppend(m.id)} title={`Add this section to the end of “${m.name}”`} className="shrink-0 rounded-md border border-border px-2 py-1 text-xs hover:border-accent">
                        Add to end
                      </button>
                      <button onClick={() => setConfirmReplace(m.id)} title={`Replace everything in “${m.name}” with this section`} className="shrink-0 rounded-md border border-border px-2 py-1 text-xs text-muted hover:border-danger hover:text-danger">
                        Replace
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-border-soft px-5 py-3">
        <button onClick={onClose} className={BTN}>Cancel</button>
      </div>
    </Dialog>
  );
}
