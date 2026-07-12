"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Dialog } from "@/components/ui/Dialog";

const BTN = "rounded-md border border-border px-4 py-2 text-sm hover:bg-foreground/[0.04]";
const PRIMARY = "rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50";
const DANGER = "rounded-md bg-red-500 px-4 py-2 text-sm font-medium text-white hover:opacity-90";
const INPUT = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent";

type PromptRequest = {
  kind: "prompt";
  id: number;
  title: string;
  message?: string;
  placeholder?: string;
  initial?: string;
  confirmLabel?: string;
  resolve: (value: string | null) => void;
};
type ConfirmRequest = {
  kind: "confirm";
  id: number;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
};
type AlertRequest = {
  kind: "alert";
  id: number;
  title: string;
  message: string;
  resolve: () => void;
};
type Request = PromptRequest | ConfirmRequest | AlertRequest;

// Imperative bridge to the single <SystemDialogs /> host mounted in Providers.
// Falls back to the native dialogs if the host isn't mounted, so callers never
// dead-end.
let enqueue: ((r: Request) => void) | null = null;
let seq = 0;

/** Styled replacement for window.prompt. Resolves to the text, or null on cancel. */
export function uiPrompt(opts: {
  title: string;
  message?: string;
  placeholder?: string;
  initial?: string;
  confirmLabel?: string;
}): Promise<string | null> {
  return new Promise((resolve) => {
    if (!enqueue) return resolve(window.prompt(opts.title, opts.initial ?? ""));
    enqueue({ ...opts, kind: "prompt", id: seq++, resolve });
  });
}

/** Styled replacement for window.confirm. `danger` paints the action red. */
export function uiConfirm(opts: {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => {
    if (!enqueue) return resolve(window.confirm(opts.message));
    enqueue({ ...opts, kind: "confirm", id: seq++, resolve });
  });
}

/** Styled replacement for window.alert. */
export function uiAlert(opts: { title: string; message: string }): Promise<void> {
  return new Promise((resolve) => {
    if (!enqueue) { window.alert(opts.message); return resolve(); }
    enqueue({ ...opts, kind: "alert", id: seq++, resolve });
  });
}

/** Host for uiPrompt/uiConfirm/uiAlert — mount exactly once (see Providers). */
export function SystemDialogs() {
  const [queue, setQueue] = useState<Request[]>([]);
  const current = queue[0] ?? null;

  useEffect(() => {
    enqueue = (r) => setQueue((q) => [...q, r]);
    return () => { enqueue = null; };
  }, []);

  const cancelRef = useRef(() => {});
  cancelRef.current = () => {
    if (!current) return;
    if (current.kind === "prompt") current.resolve(null);
    else if (current.kind === "confirm") current.resolve(false);
    else current.resolve();
    setQueue((q) => q.slice(1));
  };
  const accept = (value?: string) => {
    if (!current) return;
    if (current.kind === "prompt") current.resolve(value ?? "");
    else if (current.kind === "confirm") current.resolve(true);
    else current.resolve();
    setQueue((q) => q.slice(1));
  };

  // Escape cancels. Capture phase so underlying editors (e.g. the graph
  // editor's own Escape handling) don't also react while a dialog is up.
  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      cancelRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [current]);

  if (!current) return null;
  const cancel = () => cancelRef.current();

  return (
    <Dialog
      title={current.title}
      onClose={cancel}
      maxWidth={current.kind === "prompt" ? "max-w-md" : "max-w-sm"}
      zIndex="z-[100]"
    >
      {current.kind === "prompt" ? (
        <PromptBody key={current.id} req={current} onCancel={cancel} onSubmit={accept} />
      ) : (
        <div className="px-5 py-4">
          <p className="text-sm leading-relaxed text-muted">{current.message}</p>
          <div className="mt-5 flex justify-end gap-2">
            {current.kind === "confirm" && (
              <button onClick={cancel} className={BTN}>Cancel</button>
            )}
            <button
              autoFocus
              onClick={() => accept()}
              className={current.kind === "confirm" && current.danger ? DANGER : PRIMARY}
            >
              {(current.kind === "confirm" && current.confirmLabel) || "OK"}
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function PromptBody({
  req,
  onCancel,
  onSubmit,
}: {
  req: PromptRequest;
  onCancel: () => void;
  onSubmit: (value: string) => void;
}) {
  const [value, setValue] = useState(req.initial ?? "");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (value.trim()) onSubmit(value);
  };
  return (
    <form onSubmit={submit} className="px-5 py-4">
      {req.message && <p className="mb-3 text-sm leading-relaxed text-muted">{req.message}</p>}
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={req.placeholder}
        spellCheck={false}
        className={INPUT}
      />
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className={BTN}>Cancel</button>
        <button type="submit" disabled={!value.trim()} className={PRIMARY}>
          {req.confirmLabel ?? "OK"}
        </button>
      </div>
    </form>
  );
}
