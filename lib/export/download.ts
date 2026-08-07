/** Browser file-download helpers shared by the export paths. */

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Defer revoke so the download has actually started in all browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(filename: string, content: string, mime: string): void {
  downloadBlob(filename, new Blob([content], { type: mime }));
}

// Unicode-aware, no leading/trailing dots/underscores; falls back to "note".
export const safeName = (s: string): string =>
  (s ?? "")
    .trim()
    .replace(/[^\p{L}\p{N}._-]+/gu, "_")
    .replace(/^[._]+|[._]+$/g, "") || "note";
