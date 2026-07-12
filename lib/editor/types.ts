/** Imperative API a DocumentEditor exposes to the page (for the section outline). */
export interface DocHandle {
  scrollToBlock: (id: string) => void;
  /** Scroll the page surface to the top (whole-note link to this pane). */
  scrollToTop: () => void;
  toggleSection: (id: string) => void;
  reorderSections: (fromHeadingId: string, toHeadingId: string | null) => void;
  /** Save a heading's whole section as a reusable module (prompts for a name). */
  saveSectionAsModule: (headingId: string) => void;
}
