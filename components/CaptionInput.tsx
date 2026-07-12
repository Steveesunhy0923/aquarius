"use client";

/**
 * CaptionInput — inline figure caption under an image/table: quiet muted text
 * with no chrome at rest, accent border while focused. Pointer events stop here
 * so clicking into the caption never starts a figure drag.
 */
export function CaptionInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (text: string) => void;
}) {
  return (
    <input
      value={value}
      placeholder="caption…"
      onChange={(e) => onChange(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      className="mt-1 w-full rounded-md border border-transparent bg-transparent px-2 py-0.5 text-center text-xs italic text-muted outline-none placeholder:text-muted focus:border-accent"
    />
  );
}
