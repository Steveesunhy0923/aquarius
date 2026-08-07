import { Suspense } from "react";
import EditorClient from "./EditorClient";

// The editor is entirely client-side; this thin server wrapper provides the
// Suspense boundary useSearchParams needs so /editor prerenders as one static
// page (the note id is resolved on the client from `?id=…`).
export default function EditorPage() {
  return (
    <Suspense fallback={null}>
      <EditorClient />
    </Suspense>
  );
}
