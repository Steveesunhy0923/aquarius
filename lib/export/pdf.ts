/**
 * Typeset PDF export — the real thing, not browser print.
 *
 * The client wraps the note's LaTeX body (documentToLatex) in a complete
 * document, gathers the image assets it references, and POSTs everything to
 * /api/pdf, where Tectonic typesets it (see app/api/pdf/route.ts). The static
 * shell builds reach the hosted route via NEXT_PUBLIC_API_ORIGIN (lib/api.ts);
 * when the route is unreachable or the server has no TeX installed, callers
 * fall back to the existing print-to-PDF path.
 */

import { apiUrl } from "@/lib/api";
import { documentToLatex } from "@/lib/blocks";
import { imageItems } from "@/lib/blocks/images";
import type { DocumentTree } from "@/lib/blocks/types";
import { getStore } from "@/lib/storage";
import type { LibraryStore } from "@/lib/storage/types";
import { downloadBlob, safeName } from "./download";

/** Wrap a serialized body in a compilable article document. The preamble
 *  covers everything the serializer can emit: math (amsmath/amssymb), chem
 *  (mhchem — flagged per-document but harmless when unused), lists (enumitem),
 *  images + subfigures (graphicx/subcaption), graphs (tikz), and code
 *  (listings, with no-op definitions for web language names it lacks). */
export function fullLatexDocument(body: string): string {
  return `\\documentclass[11pt]{article}
\\usepackage[a4paper,margin=2.2cm]{geometry}
\\usepackage{amsmath,amssymb}
\\usepackage{graphicx}
\\usepackage{enumitem}
\\usepackage{subcaption}
\\usepackage{tikz}
\\usepackage[version=4]{mhchem}
\\usepackage{xcolor}
\\usepackage{listings}
\\lstset{basicstyle=\\ttfamily\\small,breaklines=true,columns=fullflexible,keepspaces=true}
\\lstdefinelanguage{javascript}{}
\\lstdefinelanguage{typescript}{}
\\lstdefinelanguage{json}{}
\\lstdefinelanguage{julia}{}
\\lstdefinelanguage{css}{}
\\setlength{\\parindent}{0pt}
\\setlength{\\parskip}{0.5\\baselineskip}
\\begin{document}
${body}
\\end{document}
`;
}

export type PdfResult =
  | { ok: true }
  | { ok: false; reason: "unavailable" | "compile"; log?: string };

interface PdfAsset {
  name: string;
  base64: string;
}

/** `\includegraphics{<assetId>}` resolves by trying known extensions, so each
 *  asset ships as `<assetId>.<ext>`. Formats TeX can't place (webp/gif/svg…)
 *  are transcoded to PNG via canvas; failures are skipped (the compile error
 *  then names the missing file, which beats silently wrong output). */
async function collectImageAssets(tree: DocumentTree, store: LibraryStore): Promise<PdfAsset[]> {
  const ids = new Set<string>();
  for (const b of tree.blocks) {
    if (b?.type === "image") for (const it of imageItems(b)) if (it.assetId) ids.add(it.assetId);
  }
  const out: PdfAsset[] = [];
  for (const id of ids) {
    const asset = await store.getAsset(id);
    if (!asset) continue;
    const friendly = await toPdfFriendly(asset.data, asset.mime);
    if (!friendly) continue;
    out.push({ name: `${id}.${friendly.ext}`, base64: await blobToBase64(friendly.blob) });
  }
  return out;
}

async function toPdfFriendly(blob: Blob, mime: string): Promise<{ blob: Blob; ext: string } | null> {
  if (mime === "image/png") return { blob, ext: "png" };
  if (mime === "image/jpeg") return { blob, ext: "jpg" };
  if (mime === "application/pdf") return { blob, ext: "pdf" };
  try {
    const bmp = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    canvas.getContext("2d")?.drawImage(bmp, 0, 0);
    const png = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
    return png ? { blob: png, ext: "png" } : null;
  } catch {
    return null;
  }
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  const CHUNK = 0x8000; // String.fromCharCode arg-count limit
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/** Typeset the note and download the PDF. Never throws for the expected
 *  failure modes — the caller decides how to fall back. */
export async function exportTypesetPdf(noteId: string, title: string): Promise<PdfResult> {
  const store = getStore();
  const pkg = await store.openNote(noteId);
  const latex = fullLatexDocument(documentToLatex(pkg.tree));
  const assets = await collectImageAssets(pkg.tree, store);

  let res: Response;
  try {
    res = await fetch(apiUrl("/api/pdf"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ latex, assets }),
    });
  } catch {
    return { ok: false, reason: "unavailable" }; // offline / static shell with no origin
  }
  if (res.status === 422) {
    const j = (await res.json().catch(() => null)) as { log?: string } | null;
    return { ok: false, reason: "compile", log: j?.log };
  }
  if (!res.ok) return { ok: false, reason: "unavailable" }; // 501 tectonic missing, 5xx, …
  downloadBlob(`${safeName(title)}.pdf`, await res.blob());
  return { ok: true };
}
