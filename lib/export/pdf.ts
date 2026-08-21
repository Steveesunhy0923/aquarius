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
import { A4_W, pxToMm, pxToPt, resolveStyle, type ResolvedStyle } from "@/lib/blocks/docstyle";
import { imageItems } from "@/lib/blocks/images";
import type { DocumentStyle, DocumentTree } from "@/lib/blocks/types";
import { getStore } from "@/lib/storage";
import type { LibraryStore } from "@/lib/storage/types";
import { downloadBlob, safeName } from "./download";

/**
 * Wrap a serialized body in a compilable article document. The preamble covers
 * everything the serializer can emit: math (amsmath/amssymb), chem (mhchem —
 * flagged per-document but harmless when unused), lists (enumitem), images +
 * subfigures (graphicx/subcaption), graphs (tikz), and code (listings, with
 * no-op definitions for web language names it lacks).
 *
 * The typography comes from the document's own style, so the typeset PDF is the
 * page the user was looking at. Under the "latex" preset that is a plain
 * `article` and the \setlength lines mostly restate the class defaults; the
 * point is that a document set another way still exports as itself.
 */
export function fullLatexDocument(body: string, style?: DocumentStyle): string {
  const r = resolveStyle(style);
  const cls = texClass(pxToPt(r.fontSize));
  return `\\documentclass[${cls.option}pt]{article}
\\usepackage[a4paper,margin=${round(pxToMm(A4_W * r.marginRatio), 2)}mm]{geometry}
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
${typography(r, cls)}\\begin{document}
${body}
\\end{document}
`;
}

/**
 * `article`'s three size options and what each actually sets — the body size
 * and the baseline it sits on (size1{0,1,2}.clo). Note that `[11pt]` gives a
 * 10.95pt body on a 13.6pt baseline, i.e. its natural leading is 1.242, not the
 * 1.2 people assume; getting that wrong makes every exported document set at
 * LaTeX's own spacing come out fractionally too loose.
 */
const CLASSES = [
  { option: 10, normalPt: 10, baselinePt: 12 },
  { option: 11, normalPt: 10.95, baselinePt: 13.6 },
  { option: 12, normalPt: 12, baselinePt: 14.5 },
] as const;

type TexClass = (typeof CLASSES)[number];

/** Nearest class option to the document's body size. Sizes outside the three
 *  land on the closest one — the leading and indent below stay proportional. */
function texClass(bodyPt: number): TexClass {
  return CLASSES.reduce((a, b) =>
    Math.abs(b.normalPt - bodyPt) < Math.abs(a.normalPt - bodyPt) ? b : a,
  );
}

/**
 * \linespread, \parindent and \parskip from the resolved style. Both lengths
 * are measured against the CLASS's body size rather than the on-screen pixel
 * size, so a document exported one class size off still has the same indent and
 * paragraph gap *relative to its text* as the page it was written on.
 */
function typography(r: ResolvedStyle, cls: TexClass): string {
  const bodyPt = cls.normalPt;
  const lines: string[] = [];
  const spread = r.lineSpacing / (cls.baselinePt / cls.normalPt);
  if (Math.abs(spread - 1) > 0.01) lines.push(`\\linespread{${round(spread, 3)}}`);
  // The page is ragged right on screen; \raggedright makes the PDF agree. It
  // must come first: LaTeX's \raggedright zeroes \parindent as a side effect.
  if (r.align === "left") lines.push("\\raggedright");
  lines.push(`\\setlength{\\parindent}{${round(r.indent * bodyPt, 2)}pt}`);
  const parskip = r.paraSkip > 0 ? (r.paraSkip / r.fontSize) * bodyPt : 0;
  lines.push(`\\setlength{\\parskip}{${round(parskip, 2)}pt}`);
  return lines.map((l) => `${l}\n`).join("");
}

const round = (n: number, dp: number): number => Math.round(n * 10 ** dp) / 10 ** dp;

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
  const latex = fullLatexDocument(documentToLatex(pkg.tree), pkg.tree.style);
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
