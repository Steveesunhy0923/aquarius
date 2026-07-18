/**
 * Shared control styling — the single source of truth for buttons, text fields,
 * the section "eyebrow" heading and the close button. These class strings used to
 * be copy-pasted (and drift) in every dialog; keep them here so one edit fixes all.
 *
 * Radius, shadow and status colors come from tokens in app/globals.css
 * (`rounded-control`, `bg-danger`, …). See the UI-cleanup proposal in docs/MODULES.md.
 */

// ── Buttons ──────────────────────────────────────────────────────────────────
/** Secondary / bordered button (roomy — dialog footers). */
export const BTN = "rounded-control border border-border px-4 py-2 text-sm hover:bg-foreground/[0.04]";
/** Primary accent button (roomy). */
export const BTN_PRIMARY = "rounded-control bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50";
/** Destructive button (roomy). */
export const BTN_DANGER = "rounded-control bg-danger px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50";
/** Compact bordered button (dense menus / inline). */
export const BTN_SM = "rounded-control border border-border px-3 py-1.5 text-sm hover:border-accent";
/** Compact primary button (inline, sitting next to a field). */
export const BTN_PRIMARY_SM = "rounded-control bg-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50";

// ── Fields ───────────────────────────────────────────────────────────────────
/** Text field (roomy). */
export const FIELD = "w-full rounded-control border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent";
/** Text field (compact — dense builders / inline forms). */
export const FIELD_SM = "w-full rounded-control border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-accent";
/** Native <select> with the Graphite chevron affordance (pair with a chevron span). */
export const SELECT = "appearance-none rounded-control border border-border bg-surface py-1.5 pl-3 pr-8 text-sm outline-none hover:border-accent focus:border-accent";
/** Compact native <select> (keeps the OS arrow) for dense toolbar strips. */
export const SELECT_SM = "rounded-control border border-border bg-surface px-1.5 py-0.5 outline-none hover:border-accent focus:border-accent";

// ── Chrome ───────────────────────────────────────────────────────────────────
/** Section eyebrow heading (small, uppercase, tracked). */
export const EYEBROW = "text-[10.5px] font-semibold uppercase tracking-[0.09em] text-muted";
/** Dialog / panel close (icon) button. */
export const CLOSE_BTN = "grid h-8 w-8 place-items-center rounded-control text-muted hover:bg-foreground/[0.05] hover:text-foreground";
