import { InkLab } from "@/components/ink/InkLab";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Ancha ink lab — Aquarius",
  description: "Ancha, the handwriting model: write words and formulas together, get them back as text and LaTeX.",
};

export default function InkPage() {
  return <InkLab />;
}
