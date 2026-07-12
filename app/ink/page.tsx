import { InkLab } from "@/components/ink/InkLab";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Ink lab — Aquarius",
  description: "Handwriting testbed: draw strokes, get LaTeX back from the local recognition server.",
};

export default function InkPage() {
  return <InkLab />;
}
