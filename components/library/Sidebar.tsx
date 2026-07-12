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
  children,
}: {
  active?: boolean;
  onClick: () => void;
  onDelete?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className={`group flex items-center rounded-[7px] ${active ? "bg-accent-soft" : "hover:bg-foreground/[0.04]"}`}>
      <button
        onClick={onClick}
        className={`flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-2 text-left text-[13px] ${active ? "text-accent" : "text-foreground"}`}
      >
        {children}
      </button>
      {onDelete && (
        <button
          onClick={onDelete}
          title="Delete"
          className="mr-1 grid h-6 w-6 shrink-0 place-items-center text-muted opacity-0 transition hover:text-red-500 group-hover:opacity-100"
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
