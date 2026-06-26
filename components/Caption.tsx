/** A centered figure/table caption shown below the block. */
export function Caption({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div className="mt-1 text-center text-sm italic text-muted">{text}</div>
  );
}
