"use client";

import { Icon } from "@/components/Icon";

export function SideHead({
  children,
  onAdd,
  addLabel,
}: {
  children: React.ReactNode;
  onAdd?: () => void;
  addLabel?: string;
}) {
  return (
    <div className="mb-1.5 mt-5 flex items-center px-2.5 first:mt-1">
      <span className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-muted">{children}</span>
      {onAdd && (
        <button onClick={onAdd} title={addLabel} className="ml-auto grid h-5 w-5 place-items-center rounded text-base leading-none text-muted hover:text-accent">
          +
        </button>
      )}
    </div>
  );
}

export function SideItem({
  active,
  onClick,
  onDelete,
  badge,
  title,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  onDelete?: () => void;
  /** Unread count shown as a pill on the right (hidden when 0). */
  badge?: number;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      title={title}
      className={`group flex items-center rounded-control ${active ? "bg-accent-soft" : "hover:bg-foreground/[0.04]"}`}
    >
      <button
        onClick={onClick}
        className={`flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-2 text-left text-[13px] ${active ? "text-accent" : "text-foreground"}`}
      >
        {children}
      </button>
      {!!badge && badge > 0 && (
        <span className="mr-2 shrink-0 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
      {onDelete && (
        <button
          onClick={onDelete}
          title="Delete"
          className="mr-1 grid h-6 w-6 shrink-0 place-items-center text-muted opacity-0 transition hover:text-danger group-hover:opacity-100"
        >
          <Icon name="close" size={13} />
        </button>
      )}
    </div>
  );
}

export function TagChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-2.5 py-0.5 text-xs transition ${
        active ? "bg-accent text-white" : "border border-border text-muted hover:border-accent"
      }`}
    >
      {children}
    </button>
  );
}
