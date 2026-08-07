"use client";

/**
 * Where-is-Ancha control for the /ink lab.
 *
 * Exists for one scenario: testing with an Apple Pencil on a real iPad. There
 * Ancha's default address (127.0.0.1:8787) means the iPad itself, so every
 * recognition fails as "offline" — she is on the Mac, across the LAN. You
 * cannot edit .env.local from an iPad, and a NEXT_PUBLIC_* change needs a
 * dev-server restart anyway, so the override is typed here and kept in
 * localStorage on the device (lib/ink/endpoint.ts).
 *
 * The field probes /health on save, because "did I get the address right" is
 * the only question being asked and a green tick answers it immediately —
 * far better than going back to the canvas to find out.
 */

import { anchaOrigin, hasAnchaOverride, normalizeOrigin, setAnchaOrigin } from "@/lib/ink/endpoint";
import { useEffect, useRef, useState } from "react";

type Probe = { state: "idle" | "checking" | "ok" | "fail"; detail?: string };

export function EndpointField({ onChanged }: { onChanged?: () => void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [probe, setProbe] = useState<Probe>({ state: "idle" });
  const [custom, setCustom] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // localStorage is client-only; read after mount so SSR and first paint agree.
  useEffect(() => {
    setValue(anchaOrigin());
    setCustom(hasAnchaOverride());
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.select();
  }, [open]);

  /** Ask the address whether Ancha is there, and who she says she is. */
  const check = async (origin: string) => {
    setProbe({ state: "checking" });
    try {
      const res = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) return setProbe({ state: "fail", detail: `HTTP ${res.status}` });
      const body = (await res.json()) as { name?: string; checkpoint?: string };
      setProbe({ state: "ok", detail: `${body.name ?? "?"} · ${body.checkpoint ?? "?"}` });
    } catch {
      // Unreachable covers both "wrong address" and the much more likely
      // "she is still bound to loopback" — say so, it is the usual cause.
      setProbe({ state: "fail", detail: "unreachable — is she running with --host 0.0.0.0?" });
    }
  };

  const save = async () => {
    const applied = setAnchaOrigin(value);
    setValue(applied);
    setCustom(hasAnchaOverride());
    onChanged?.();
    await check(applied);
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title={`Ancha is at ${value}${custom ? " (set on this device)" : ""} — tap to change`}
        className={`h-9 rounded-md border px-2.5 text-xs transition ${
          custom ? "border-accent bg-accent-soft text-accent" : "border-border text-muted hover:border-accent hover:text-foreground"
        }`}
      >
        {value.replace(/^https?:\/\//, "") || "endpoint"}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setProbe({ state: "idle" });
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") void save();
          if (e.key === "Escape") setOpen(false);
        }}
        // A tablet keyboard should offer a URL layout and not autocapitalize.
        type="url"
        inputMode="url"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        placeholder="192.168.1.23:8787"
        aria-label="Ancha endpoint"
        className="h-9 w-56 rounded-md border border-border bg-background px-2.5 font-mono text-xs outline-none focus:border-accent"
      />
      <button
        onClick={() => void save()}
        disabled={!normalizeOrigin(value)}
        className="h-9 rounded-md bg-accent px-2.5 text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-40"
      >
        {probe.state === "checking" ? "Checking…" : "Save"}
      </button>
      <button
        onClick={() => {
          setAnchaOrigin("");
          setValue(anchaOrigin());
          setCustom(false);
          setProbe({ state: "idle" });
          onChanged?.();
        }}
        title="Back to the default (this machine)"
        className="h-9 rounded-md border border-border px-2.5 text-xs text-muted transition hover:border-accent hover:text-foreground"
      >
        Reset
      </button>
      {probe.state === "ok" && <span className="text-xs text-success">✓ {probe.detail}</span>}
      {probe.state === "fail" && <span className="max-w-[16rem] text-xs text-danger">{probe.detail}</span>}
      <button onClick={() => setOpen(false)} className="h-9 px-1.5 text-xs text-muted hover:text-foreground">
        Done
      </button>
    </div>
  );
}
