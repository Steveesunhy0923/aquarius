"use client";

/**
 * Review the collected training samples (the /collect corrections loop):
 * every saved (ink, label) pair listed newest-first with the rendered PNG the
 * model actually trains on, the corrected label, the model's original guess,
 * and a delete button — so bad labels can be culled before a training run.
 */

import { anchaUrl } from "@/lib/ink/endpoint";
import { Katex } from "@/components/Katex";
import { Dialog } from "@/components/ui/Dialog";
import { uiConfirm } from "@/components/ui/dialogs";
import { useCallback, useEffect, useState } from "react";

const SAMPLES_URL = () => anchaUrl("/collect/samples");
const COLLECT_URL = () => anchaUrl("/collect");
const imgUrl = (id: string) => anchaUrl(`/collect/img/${id}`);

interface Sample {
  id: string;
  ts: string | null;
  label: string;
  predicted: string | null;
  mode: "math" | "text";
  hasImage: boolean;
  strokes: number;
}

export function ReviewDialog({ onClose, onCount }: {
  onClose: () => void;
  /** Reports the collected count after load/delete so the opener's badge stays true. */
  onCount?: (n: number) => void;
}) {
  const [samples, setSamples] = useState<Sample[] | null>(null); // null = loading
  const [offline, setOffline] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(SAMPLES_URL());
      if (!res.ok) throw new Error();
      const body = (await res.json()) as { count?: number; samples?: Sample[] };
      setSamples(body.samples ?? []);
      setOffline(false);
      if (typeof body.count === "number") onCount?.(body.count);
    } catch {
      setSamples([]);
      setOffline(true);
    }
  }, [onCount]);
  useEffect(() => { void load(); }, [load]);

  const remove = async (s: Sample) => {
    const ok = await uiConfirm({
      title: "Delete this sample?",
      message: "It will no longer be used as Ancha's training data. This can't be undone.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await fetch(`${COLLECT_URL()}/${s.id}`, { method: "DELETE" });
      if (!res.ok) return;
      const body = (await res.json()) as { count?: number };
      setSamples((prev) => (prev ?? []).filter((x) => x.id !== s.id));
      if (typeof body.count === "number") onCount?.(body.count);
    } catch {
      /* server went away — the list simply stops updating */
    }
  };

  return (
    <Dialog title="Samples collected for Ancha" onClose={onClose} maxWidth="max-w-2xl">
      <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
        {samples === null ? (
          <p className="py-4 text-sm text-muted">Loading…</p>
        ) : offline ? (
          <p className="py-4 text-sm text-muted">Ancha is offline — the samples live on her server.</p>
        ) : samples.length === 0 ? (
          <p className="py-4 text-sm text-muted">
            Nothing collected yet. Fix a wrong recognition (here or in the note editor) and the
            corrected ink lands here as training data.
          </p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {samples.map((s) => (
              <div key={s.id} className="flex items-center gap-3 rounded-lg border border-border-soft bg-background p-2.5">
                <div className="grid h-14 w-40 shrink-0 place-items-center overflow-hidden rounded-md border border-border-soft bg-white">
                  {s.hasImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={imgUrl(s.id)} alt="drawn ink" className="max-h-full max-w-full object-contain" />
                  ) : (
                    <span className="text-[10px] text-faint">no image</span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="overflow-x-auto">
                    {s.mode === "text" ? (
                      <p className="whitespace-pre-wrap text-sm">{s.label}</p>
                    ) : (
                      <Katex latex={s.label} />
                    )}
                  </div>
                  <p className="mt-1 truncate font-mono text-[11px] text-muted" title={s.label}>{s.label}</p>
                  <p className="mt-0.5 text-[11px] text-faint">
                    {s.predicted != null && s.predicted !== s.label && (
                      <>Ancha guessed <span className="font-mono">{s.predicted || "(empty)"}</span> · </>
                    )}
                    {s.mode} · {s.strokes} stroke{s.strokes === 1 ? "" : "s"}
                    {s.ts ? ` · ${new Date(s.ts).toLocaleString()}` : ""}
                  </p>
                </div>
                <button
                  onClick={() => void remove(s)}
                  title="Delete this sample"
                  aria-label="Delete this sample"
                  className="shrink-0 rounded-md border border-border px-2 py-1 text-xs text-muted transition hover:border-danger hover:text-danger"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
}
