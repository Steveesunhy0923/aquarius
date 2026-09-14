/**
 * Modules — named, insertable Block[] fragments (a section: its heading, plus
 * whatever empty structure that section is made of). They are the unit the
 * modular-notes system composes:
 *
 *   Module = a reusable section fragment
 *   Preset = an ordered stack of modules → produces a DocumentTree
 *
 * Built-in modules form the catalog; user-saved modules ("save section as
 * module") live in localStorage next to saved templates. Every insertion goes
 * through `freshBlocks` so ids never collide with the receiving document.
 *
 * A built-in carries NO prose. Its blocks are the section's skeleton — the
 * heading, a table's header row, a `{{field}}` line, an empty list or formula
 * slot — never a sentence explaining what to write there, which the writer has
 * to select and delete before their own words can go in.
 */

import { withCalloutColor } from "@/lib/blocks/callouts";
import { fillFieldText, scanFieldNames } from "@/lib/blocks/fields";
import { makeHeading, withHeading, type HeadingLevel } from "@/lib/blocks/headings";
import { makeList } from "@/lib/blocks/lists";
import { displayFromSource, paragraphFromSource } from "@/lib/blocks/source";
import { makeTableBlock, type TableStyle } from "@/lib/blocks/tables";
import { emptyDocument } from "@/lib/blocks/types";
import type { Block, DocumentTree, InlineRun, Slots } from "@/lib/blocks/types";
import type { IconName } from "@/components/Icon";

const uid = (): string => crypto.randomUUID();

// ─── Block builders (thin wrappers over the same constructors the editor uses) ─
export const heading = (level: HeadingLevel, text: string): Block => makeHeading(level, text);
export const para = (src: string): Block => paragraphFromSource(src);
export const eq = (latex: string): Block => displayFromSource(latex);
export const table = (style: TableStyle, rows: string[][]): Block => makeTableBlock(style, rows);
export function bullets(items: string[]): Block {
  const b = makeList(false);
  b.attrs = { ...b.attrs, items };
  return b;
}
export function numbered(items: string[]): Block {
  const b = makeList(true);
  b.attrs = { ...b.attrs, items };
  return b;
}
export const centerHeading = (level: HeadingLevel, text: string): Block =>
  withHeading(makeHeading(level, text), { align: "center" });
export const banner = (text: string, color: string): Block => withCalloutColor(para(text), color);

// ─── Fresh ids (so inserting a module never collides with existing blocks) ────
export function freshBlock(b: Block): Block {
  const nb: Block = { ...b, id: uid() };
  if (b.slots) {
    const slots: Slots = {};
    for (const [k, kids] of Object.entries(b.slots)) slots[k] = kids.map(freshBlock);
    nb.slots = slots;
  }
  const runs = b.attrs?.runs as InlineRun[] | undefined;
  if (Array.isArray(runs)) {
    nb.attrs = {
      ...b.attrs,
      runs: runs.map((r) => (r.kind === "math" ? { kind: "math" as const, block: freshBlock(r.block) } : r)),
    };
  }
  return nb;
}
/** Deep-clone a fragment with brand-new block ids throughout. */
export const freshBlocks = (blocks: Block[]): Block[] => blocks.map(freshBlock);

// ─── Fillable fields ({{Name}} tokens in module prose) ────────────────────────
// Tokens live as literal text in run strings / heading values / list items /
// table cells (see lib/blocks/fields.ts), so they survive save/round-trips.

/** All `{{field}}` names in a fragment, deduped in first-appearance order. */
export function moduleFields(blocks: Block[]): string[] {
  const names: string[] = [];
  const scanTable = (t: unknown): void => {
    const d = t as { rows?: string[][]; caption?: string };
    scanFieldNames(d.caption, names);
    for (const row of d.rows ?? []) for (const cell of row) scanFieldNames(cell, names);
  };
  const visit = (b: Block): void => {
    scanFieldNames(b.value, names);
    const runs = b.attrs?.runs as InlineRun[] | undefined;
    if (Array.isArray(runs)) for (const r of runs) if (r.kind === "text") scanFieldNames(r.text, names);
    const items = b.attrs?.items as string[] | undefined;
    if (Array.isArray(items)) for (const it of items) scanFieldNames(it, names);
    const tables = b.attrs?.tables as unknown[] | undefined;
    if (Array.isArray(tables)) tables.forEach(scanTable);
    if (b.slots) for (const kids of Object.values(b.slots)) kids.forEach(visit);
  };
  blocks.forEach(visit);
  return names;
}

/** Substitute filled field values throughout a fragment. Pure — freshBlock
 *  shares run/item objects with the memoized catalog, so this never mutates;
 *  blank values keep their `{{…}}` placeholder. */
export function fillFields(blocks: Block[], values: Record<string, string>): Block[] {
  if (!Object.values(values).some((v) => v && v.trim())) return blocks;
  const fill = (s: string): string => fillFieldText(s, values);
  const fillTable = (t: unknown): unknown => {
    const d = t as { rows?: string[][]; caption?: string };
    return {
      ...d,
      ...(typeof d.caption === "string" ? { caption: fill(d.caption) } : null),
      ...(Array.isArray(d.rows) ? { rows: d.rows.map((row) => row.map(fill)) } : null),
    };
  };
  const visit = (b: Block): Block => {
    const nb: Block = { ...b };
    if (typeof b.value === "string") nb.value = fill(b.value);
    if (b.attrs) {
      const attrs = { ...b.attrs };
      const runs = attrs.runs as InlineRun[] | undefined;
      if (Array.isArray(runs)) {
        attrs.runs = runs.map((r) => (r.kind === "text" ? { kind: "text" as const, text: fill(r.text) } : r));
      }
      const items = attrs.items as string[] | undefined;
      if (Array.isArray(items)) attrs.items = items.map(fill);
      const tables = attrs.tables as unknown[] | undefined;
      if (Array.isArray(tables)) attrs.tables = tables.map(fillTable);
      nb.attrs = attrs;
    }
    if (b.slots) {
      const slots: Slots = {};
      for (const [k, kids] of Object.entries(b.slots)) slots[k] = kids.map(visit);
      nb.slots = slots;
    }
    return nb;
  };
  return blocks.map(visit);
}

// ─── The Module type ──────────────────────────────────────────────────────────

export type ModuleCategory =
  | "structural"
  | "study"
  | "science"
  | "writing"
  | "career"
  | "planning"
  | "custom";

export const MODULE_CATEGORY_NAMES: Record<ModuleCategory, string> = {
  structural: "Structure",
  study: "Study",
  science: "Math & science",
  writing: "Writing",
  career: "Career",
  planning: "Planning",
  custom: "My modules",
};

export interface Module {
  id: string;
  name: string;
  icon: IconName;
  category: ModuleCategory;
  /** One line describing the module. Catalog documentation and the palette's
   *  preset rows; the inserter lists modules by name alone. */
  description: string;
  /** Extra search terms for the slash-menu filter. */
  keywords?: string[];
  // Fillable `{{field}}` tokens are not declared here — they are scanned from
  // `blocks` (moduleFields), so save-section and hand-built modules get them free.
  blocks: Block[];
}

const mod = (
  id: string,
  name: string,
  icon: IconName,
  category: ModuleCategory,
  description: string,
  blocks: Block[],
  keywords?: string[],
): Module => ({ id, name, icon, category, description, keywords, blocks });

// ─── Built-in catalog ─────────────────────────────────────────────────────────
// Built lazily (block ids are minted by the builders) and memoized; insertion
// always re-freshens ids, so sharing one catalog instance is safe.

let catalog: Module[] | null = null;

export function builtinModules(): Module[] {
  if (catalog) return catalog;
  catalog = [
    // Universal / structural
    mod("title-block", "Title block", "heading", "structural", "Document title with a course / date / topic line.", [
      heading(1, "Title"),
      para("**Course:** {{Course}}    **Date:** {{Date}}    **Topic:** {{Topic}}"),
    ], ["header", "top"]),
    mod("section", "Section", "paragraph", "structural", "A subtitle to write under.", [
      heading(2, "New section"),
    ], ["heading", "body"]),
    mod("summary", "Summary", "list", "structural", "A short wrap-up of the main ideas.", [
      heading(2, "Summary"),
    ], ["tldr", "conclusion", "recap"]),
    mod("takeaway", "Takeaway box", "tag", "structural", "A colored box for the one thing to remember.", [
      banner("", "#fef3c7"),
    ], ["callout", "highlight", "box", "important"]),
    // Study & learning
    mod("key-concepts", "Key concepts", "list", "study", "Bulleted definitions of the core ideas.", [
      heading(2, "Key Concepts"),
      bullets([""]),
    ], ["definitions", "ideas", "vocabulary"]),
    mod("worked-example", "Worked example", "displayeq", "study", "A heading over a formula slot.", [
      heading(2, "Worked Example"),
      eq(""),
    ], ["example", "solution"]),
    mod("practice-problems", "Practice problems", "listnumber", "study", "Numbered problems with room to work.", [
      heading(2, "Practice Problems"),
      numbered([""]),
    ], ["exercises", "homework"]),
    mod("cornell-cues", "Cues & questions", "tag", "study", "The Cornell cue column: prompts and key terms.", [
      heading(2, "Cues & Questions"),
      bullets([""]),
    ], ["cornell", "prompts"]),
    mod("notes-column", "Notes", "paragraph", "study", "The main notes body.", [
      heading(2, "Notes"),
    ], ["cornell", "body"]),
    mod("vocab-table", "Vocabulary table", "table", "study", "A term → definition table.", [
      heading(2, "Vocabulary"),
      table("lines", [
        ["Term", "Definition"],
        ["", ""],
        ["", ""],
      ]),
    ], ["glossary", "terms", "definitions"]),
    mod("open-questions", "Questions", "search", "study", "Things to look up or ask about later.", [
      heading(2, "Questions"),
      bullets([""]),
    ], ["ask", "unclear", "follow-up", "doubts"]),
    mod("quiz-pairs", "Quiz yourself", "table", "study", "Question → answer rows for self-testing.", [
      heading(2, "Quiz Yourself"),
      table("lines", [
        ["Question", "Answer"],
        ["", ""],
        ["", ""],
        ["", ""],
      ]),
    ], ["flashcards", "recall", "self-test", "revision"]),
    mod("review-checklist", "Revision checklist", "check", "study", "Topics to tick off before an exam.", [
      heading(2, "Topics to Review"),
      bullets([""]),
    ], ["exam", "revise", "study plan", "prep"]),
    // Math & science
    mod("objective", "Objective", "eye", "science", "What the experiment sets out to determine.", [
      heading(2, "Objective"),
    ], ["aim", "goal", "lab"]),
    mod("hypothesis", "Hypothesis", "flask", "science", "The prediction under test, and the reasoning behind it.", [
      heading(2, "Hypothesis"),
    ], ["prediction", "expect", "lab"]),
    mod("materials", "Materials", "list", "science", "The apparatus list.", [
      heading(2, "Materials"),
      bullets([""]),
    ], ["equipment", "apparatus", "lab"]),
    mod("procedure", "Procedure", "listnumber", "science", "Numbered experimental steps.", [
      heading(2, "Procedure"),
      numbered([""]),
    ], ["method", "steps", "lab"]),
    mod("data-table", "Data table", "table", "science", "A measurement table with an uncertainty column.", [
      heading(2, "Data"),
      table("lines", [
        ["Trial", "Measurement", "Uncertainty"],
        ["1", "", ""],
        ["2", "", ""],
        ["3", "", ""],
      ]),
    ], ["measurements", "results", "lab"]),
    mod("analysis", "Analysis", "plot", "science", "Relate the data to the governing relationship.", [
      heading(2, "Analysis"),
      eq(""),
    ], ["discussion", "fit", "lab"]),
    mod("conclusion", "Conclusion", "paragraph", "science", "Did the results match the prediction?", [
      heading(2, "Conclusion"),
    ], ["errors", "lab"]),
    mod("derivation", "Derivation", "integral", "science", "A step-by-step derivation from first principles.", [
      heading(2, "Derivation"),
      eq(""),
    ], ["proof", "steps"]),
    mod("formula-group", "Formula group", "functions", "science", "A topic heading with its key formulas.", [
      heading(2, "Formulas"),
      eq(""),
    ], ["equations", "reference", "cheat sheet"]),
    mod("theorem-proof", "Theorem & proof", "mathblock", "science", "A statement followed by its proof.", [
      heading(2, "Theorem"),
      heading(3, "Proof"),
    ], ["lemma", "proposition", "qed", "proof"]),
    // Humanities & writing
    mod("abstract", "Abstract", "paragraph", "writing", "A one-paragraph summary of the whole piece.", [
      heading(2, "Abstract"),
    ], ["summary", "paper", "precis"]),
    mod("thesis", "Thesis", "tag", "writing", "The claim the piece argues, in a highlighted box.", [
      heading(2, "Thesis"),
      banner("", "#dbeafe"),
    ], ["argument", "claim", "essay"]),
    mod("essay-outline", "Essay outline", "listnumber", "writing", "Intro, body beats, and conclusion as an ordered plan.", [
      heading(2, "Outline"),
      numbered([""]),
    ], ["plan", "structure", "essay"]),
    mod("body-paragraph", "Body paragraph", "paragraph", "writing", "Claim → evidence → analysis for one point.", [
      heading(2, "Point — {{Claim}}"),
    ], ["peel", "argument", "evidence", "essay"]),
    mod("counterargument", "Counterargument", "warning", "writing", "The strongest objection — and your reply to it.", [
      heading(2, "Counterargument"),
    ], ["objection", "rebuttal", "essay"]),
    mod("key-quotes", "Key quotes", "list", "writing", "Quotations with page references.", [
      heading(2, "Key Quotes"),
      bullets([""]),
    ], ["reading", "passage", "citation"]),
    mod("references", "References", "list", "writing", "The bibliography / works-cited list.", [
      heading(2, "References"),
      bullets([""]),
    ], ["bibliography", "works cited", "sources"]),
    // Career
    mod("contact-header", "Name & contact", "heading", "career", "A centered name over a contact line.", [
      heading(1, "{{Full Name}}"),
      centerHeading(4, "{{City}} · {{Email}} · {{Phone}} · {{Portfolio}}"),
    ], ["resume", "cv", "header", "details"]),
    mod("experience", "Experience entry", "history", "career", "A dated role with bullet points of impact.", [
      heading(2, "Experience"),
      para("**{{Role}}** — {{Organization}}    *{{Start}} – {{End}}*"),
      bullets([""]),
    ], ["resume", "cv", "work", "job", "role"]),
    mod("education", "Education", "notebooks", "career", "Degree, institution, and dates.", [
      heading(2, "Education"),
      para("**{{Degree}}**, {{Institution}}    *{{Years}}*"),
      bullets([""]),
    ], ["resume", "cv", "school", "degree", "university"]),
    mod("skills-list", "Skills", "list", "career", "Skills grouped by kind.", [
      heading(2, "Skills"),
      bullets([""]),
    ], ["resume", "cv", "abilities", "stack"]),
    mod("projects", "Projects", "subjects", "career", "Selected projects and what you actually built.", [
      heading(2, "Projects"),
      para("**{{Project}}**"),
      bullets([""]),
    ], ["resume", "cv", "portfolio", "side project"]),
    // Planning & productivity
    mod("checklist", "Checklist", "list", "planning", "A task list to tick off.", [
      heading(2, "Checklist"),
      bullets([""]),
    ], ["tasks", "todo"]),
    mod("priorities", "Top priorities", "pin", "planning", "The two or three things that actually matter.", [
      heading(2, "Top Priorities"),
      numbered([""]),
    ], ["focus", "goals", "week"]),
    mod("agenda", "Agenda", "listnumber", "planning", "Numbered items to get through, with time boxes.", [
      heading(2, "Agenda"),
      numbered([""]),
    ], ["meeting", "topics", "plan"]),
    mod("action-items", "Action items", "table", "planning", "An owner / action / due-date table.", [
      heading(2, "Action Items"),
      table("lines", [
        ["Owner", "Action", "Due"],
        ["", "", ""],
        ["", "", ""],
        ["", "", ""],
      ]),
    ], ["todo", "follow-up", "meeting", "tasks"]),
    mod("milestones", "Milestones", "table", "planning", "Milestone / owner / target / status.", [
      heading(2, "Milestones"),
      table("headershade", [
        ["Milestone", "Owner", "Target", "Status"],
        ["", "", "", "Not started"],
        ["", "", "", "Not started"],
        ["", "", "", "Not started"],
      ]),
    ], ["timeline", "project", "schedule", "roadmap"]),
    mod("week-grid", "Week grid", "table", "planning", "A day-by-day plan for the week.", [
      heading(2, "This Week"),
      table("grid", [
        ["Day", "Plan", "Done"],
        ["Mon", "", ""],
        ["Tue", "", ""],
        ["Wed", "", ""],
        ["Thu", "", ""],
        ["Fri", "", ""],
        ["Sat / Sun", "", ""],
      ]),
    ], ["planner", "schedule", "days", "timetable"]),
    mod("journal-entry", "Journal entry", "penline", "planning", "Highlights, what you learned, what's next.", [
      heading(2, "{{Date}}"),
    ], ["diary", "log", "daily", "reflection"]),
  ];
  return catalog;
}

// ─── Presets: ordered module stacks ───────────────────────────────────────────
// A preset's stack mixes catalog modules (by reference) with preset-private
// modules (title blocks, topic-specific sections) that aren't in the catalog.

export interface Preset {
  id: string;
  name: string;
  scenario: string;
  /** The ordered module stack this preset is built from. */
  stack: Module[];
}

/** A preset-private title module: H1 + optional fill-in meta line. */
const titleModule = (id: string, title: string, meta?: string): Module =>
  mod(`${id}-title`, `${title} title`, "heading", "structural", `Title block for ${title}.`,
    meta ? [heading(1, title), para(meta)] : [heading(1, title)]);

/** One numbered problem: its heading, then a solution section with an empty slot. */
const problemModule = (n: number): Module =>
  mod(`problem-${n}`, `Problem ${n}`, "displayeq", "study", "A problem with room to work.", [
    heading(2, `Problem ${n}`),
    heading(3, "Solution"),
    eq(""),
  ]);

let presets: Preset[] | null = null;

export function builtinPresets(): Preset[] {
  if (presets) return presets;
  const by = new Map(builtinModules().map((m) => [m.id, m]));
  const use = (id: string): Module => {
    const m = by.get(id);
    if (!m) throw new Error(`unknown module: ${id}`);
    return m;
  };
  presets = [
    // ── Study ────────────────────────────────────────────────────────────────
    {
      id: "notes",
      name: "Notes",
      scenario: "Everyday class notes: concepts, a worked example, questions, summary.",
      stack: [
        titleModule("notes", "Notes", "**Course:** {{Course}}    **Date:** {{Date}}    **Topic:** {{Topic}}"),
        use("key-concepts"),
        use("notes-column"),
        use("worked-example"),
        use("open-questions"),
        use("summary"),
      ],
    },
    {
      id: "problem-set",
      name: "Problem Set",
      scenario: "Homework: a header, then numbered problems each with room to work.",
      stack: [
        titleModule("problem-set", "Problem Set", "**Name:** {{Name}}    **Course:** {{Course}}    **Set:** {{Number}}    **Due:** {{Due}}"),
        problemModule(1),
        problemModule(2),
        problemModule(3),
        problemModule(4),
      ],
    },
    {
      id: "study-guide",
      name: "Study Guide",
      scenario: "Exam prep: what to review, the definitions, the formulas, then self-test.",
      stack: [
        titleModule("study-guide", "Study Guide", "**Subject:** {{Subject}}    **Exam:** {{Exam date}}"),
        use("review-checklist"),
        use("key-concepts"),
        use("vocab-table"),
        use("formula-group"),
        use("quiz-pairs"),
        mod("trouble-spots", "Trouble spots", "warning", "study", "The things you keep getting wrong.", [
          heading(2, "Trouble Spots"),
          bullets([""]),
        ]),
      ],
    },
    {
      id: "cheat-sheet",
      name: "Cheat Sheet",
      scenario: "One dense page: definitions, formulas, constants, and the usual traps.",
      stack: [
        titleModule("cheat-sheet", "Cheat Sheet", "**Course:** {{Course}}    **Covers:** {{Topics}}"),
        mod("cheat-definitions", "Definitions", "list", "study", "The terms, stated in one line each.", [
          heading(2, "Definitions"),
          bullets([""]),
        ]),
        mod("cheat-formulas", "Formulas", "functions", "science", "The formulas you'll actually reach for.", [
          heading(2, "Formulas"),
          eq(""),
        ]),
        mod("cheat-constants", "Constants & units", "table", "science", "Values and units worth not re-deriving.", [
          heading(2, "Constants & Units"),
          table("lines", [
            ["Symbol", "Value", "Units"],
            ["", "", ""],
            ["", "", ""],
          ]),
        ]),
        mod("cheat-traps", "Common traps", "warning", "study", "Where marks are usually lost.", [
          heading(2, "Watch Out"),
          banner("", "#fee2e2"),
        ]),
      ],
    },
    {
      id: "theorem-sheet",
      name: "Theorems & Proofs",
      scenario: "Definitions, a theorem with its proof, scratch work, then exercises.",
      stack: [
        titleModule("theorem-sheet", "Theorems & Proofs", "**Course:** {{Course}}    **Topic:** {{Topic}}"),
        mod("proof-definitions", "Definitions", "list", "science", "The definitions the proof relies on.", [
          heading(2, "Definitions"),
          bullets([""]),
        ]),
        use("theorem-proof"),
        mod("proof-scratch", "Scratch work", "penline", "science", "The messy attempt before the clean proof.", [
          heading(2, "Scratch Work"),
        ]),
        use("practice-problems"),
      ],
    },
    // ── Science ──────────────────────────────────────────────────────────────
    {
      id: "lab-report",
      name: "Lab Report",
      scenario: "Objective → hypothesis → method → data → analysis → conclusion.",
      stack: [
        titleModule("lab-report", "Lab Report", "**Experiment:** {{Experiment}}    **Date:** {{Date}}    **Partners:** {{Partners}}"),
        use("objective"),
        use("hypothesis"),
        use("materials"),
        use("procedure"),
        use("data-table"),
        use("analysis"),
        use("conclusion"),
      ],
    },
    {
      id: "research-paper",
      name: "Research Paper",
      scenario: "IMRaD: abstract, introduction, methods, results, discussion, references.",
      stack: [
        titleModule("research-paper", "Paper Title", "**{{Author}}** · {{Affiliation}} · {{Date}}"),
        use("abstract"),
        mod("paper-intro", "Introduction", "paragraph", "writing", "Background, the gap, and your contribution.", [
          heading(2, "Introduction"),
        ]),
        mod("paper-related", "Related work", "list", "writing", "What others have done, and where you differ.", [
          heading(2, "Related Work"),
          bullets([""]),
        ]),
        mod("paper-methods", "Methods", "listnumber", "writing", "What you did, precisely enough to repeat.", [
          heading(2, "Methods"),
          numbered([""]),
        ]),
        mod("paper-results", "Results", "table", "writing", "What you found, without interpreting it yet.", [
          heading(2, "Results"),
          table("booktabs", [
            ["Condition", "n", "Mean", "SD"],
            ["", "", "", ""],
            ["", "", "", ""],
          ]),
        ]),
        mod("paper-discussion", "Discussion", "paragraph", "writing", "What the results mean, and their limits.", [
          heading(2, "Discussion"),
        ]),
        use("references"),
      ],
    },
    // ── Writing ──────────────────────────────────────────────────────────────
    {
      id: "essay",
      name: "Essay",
      scenario: "Thesis, an outline, body paragraphs with evidence, and a works-cited list.",
      stack: [
        titleModule("essay", "Essay Title", "**Name:** {{Name}}    **Course:** {{Course}}    **Date:** {{Date}}"),
        use("thesis"),
        use("essay-outline"),
        mod("essay-intro", "Introduction", "paragraph", "writing", "Hook, context, and the thesis.", [
          heading(2, "Introduction"),
        ]),
        use("body-paragraph"),
        mod("essay-point-2", "Second point", "paragraph", "writing", "Claim → evidence → analysis for the second point.", [
          heading(2, "Point — {{Second claim}}"),
        ]),
        use("counterargument"),
        mod("essay-conclusion", "Conclusion", "paragraph", "writing", "What follows from the argument.", [
          heading(2, "Conclusion"),
        ]),
        use("references"),
      ],
    },
    {
      id: "reading-notes",
      name: "Reading Notes",
      scenario: "One source: citation, summary, key quotes, your response, open questions.",
      stack: [
        titleModule("reading-notes", "Reading Notes", "**Source:** {{Title}}    **Author:** {{Author}}    **Pages:** {{Pages}}"),
        mod("reading-citation", "Citation", "tag", "writing", "The full reference, ready to paste into a bibliography.", [
          heading(2, "Citation"),
        ]),
        use("summary"),
        use("key-quotes"),
        mod("reading-response", "Response", "paragraph", "writing", "What you make of it — agreement, doubts, uses.", [
          heading(2, "Response"),
        ]),
        use("open-questions"),
      ],
    },
    // ── Career ───────────────────────────────────────────────────────────────
    {
      id: "resume",
      name: "Resume",
      scenario: "One page: contact header, summary, experience, education, skills, projects.",
      stack: [
        use("contact-header"),
        mod("resume-summary", "Professional summary", "paragraph", "career", "Two lines on what you do and what you want.", [
          heading(2, "Summary"),
        ]),
        use("experience"),
        mod("resume-role-2", "Second role", "history", "career", "Another dated role under Experience.", [
          para("**{{Earlier role}}** — {{Earlier organization}}    *{{Earlier start}} – {{Earlier end}}*"),
          bullets([""]),
        ]),
        use("education"),
        use("skills-list"),
        use("projects"),
      ],
    },
    {
      id: "cover-letter",
      name: "Cover Letter",
      scenario: "Header, opening, why you, why them, and a close.",
      stack: [
        mod("letter-header", "Letter header", "heading", "career", "Sender, date, and recipient.", [
          para("**{{Full Name}}**"),
          para("{{Email}} · {{Phone}} · {{City}}"),
          para("{{Date}}"),
          para("{{Recipient}}, {{Company}}"),
        ]),
        mod("letter-opening", "Opening", "paragraph", "career", "The role, and the one line worth reading on.", [
          para("Dear {{Recipient}},"),
          para(""),
        ]),
        mod("letter-why-you", "Why me", "paragraph", "career", "Your evidence, matched to the posting.", [
          para(""),
        ]),
        mod("letter-why-them", "Why them", "paragraph", "career", "Why this employer in particular.", [
          para(""),
        ]),
        mod("letter-close", "Close", "paragraph", "career", "Thanks, sign-off, and your name.", [
          para("Sincerely,"),
          para("{{Full Name}}"),
        ]),
      ],
    },
    // ── Planning ─────────────────────────────────────────────────────────────
    {
      id: "meeting-notes",
      name: "Meeting Notes",
      scenario: "Attendees, agenda, what was discussed, decisions, and who does what.",
      stack: [
        titleModule("meeting-notes", "Meeting Notes", "**Date:** {{Date}}    **Attendees:** {{Attendees}}"),
        use("agenda"),
        mod("meeting-discussion", "Discussion", "list", "planning", "The points actually raised.", [
          heading(2, "Discussion"),
          bullets([""]),
        ]),
        mod("meeting-decisions", "Decisions", "check", "planning", "What was settled, so it isn't relitigated.", [
          heading(2, "Decisions"),
          bullets([""]),
        ]),
        use("action-items"),
      ],
    },
    {
      id: "weekly-planner",
      name: "Weekly Planner",
      scenario: "Priorities, a day-by-day grid, a task list, and a Friday review.",
      stack: [
        titleModule("weekly-planner", "Weekly Planner", "**Week of:** {{Date}}    **Focus:** {{Focus}}"),
        use("priorities"),
        use("week-grid"),
        use("checklist"),
        mod("week-review", "Friday review", "history", "planning", "What worked, what slipped, what moves.", [
          heading(2, "Friday Review"),
        ]),
      ],
    },
    {
      id: "project-plan",
      name: "Project Plan",
      scenario: "Goal, scope, milestones, risks, and the immediate next actions.",
      stack: [
        titleModule("project-plan", "Project Plan", "**Project:** {{Project}}    **Owner:** {{Owner}}    **Target:** {{Target date}}"),
        mod("project-goal", "Goal", "tag", "planning", "The outcome, in one sentence.", [
          heading(2, "Goal"),
          banner("", "#d1fae5"),
        ]),
        mod("project-scope", "Scope", "list", "planning", "What's in, and — just as important — what's out.", [
          heading(2, "Scope"),
          bullets([""]),
        ]),
        use("milestones"),
        mod("project-risks", "Risks & unknowns", "warning", "planning", "What could sink it, and the mitigation.", [
          heading(2, "Risks & Unknowns"),
          bullets([""]),
        ]),
        use("action-items"),
      ],
    },
    {
      id: "journal",
      name: "Daily Journal",
      scenario: "A dated entry, what you're grateful for, and tomorrow's three.",
      stack: [
        titleModule("journal", "Journal"),
        use("journal-entry"),
        mod("journal-gratitude", "Grateful for", "list", "planning", "Three small things.", [
          heading(2, "Grateful For"),
          bullets([""]),
        ]),
        mod("journal-tomorrow", "Tomorrow", "listnumber", "planning", "The three things that would make tomorrow good.", [
          heading(2, "Tomorrow"),
          numbered([""]),
        ]),
      ],
    },
  ];
  return presets;
}

/** Materialize an ordered module stack: concatenate with fresh block ids. */
export function stackTree(stack: Module[]): DocumentTree {
  const t = emptyDocument("flow");
  t.blocks = stack.flatMap((m) => freshBlocks(m.blocks));
  return t;
}

/** Materialize a preset from its stack. */
export const presetTree = (p: Preset): DocumentTree => stackTree(p.stack);

// ─── User-saved modules (localStorage, like saved templates) ──────────────────

export interface SavedModule {
  id: string;
  name: string;
  blocks: Block[];
  createdAt: string;
}

const LS_MODULES = "aquarius.modules.v1";

function readSavedModules(): SavedModule[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LS_MODULES);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (m): m is SavedModule =>
        !!m &&
        typeof (m as SavedModule).id === "string" &&
        typeof (m as SavedModule).name === "string" &&
        Array.isArray((m as SavedModule).blocks),
    );
  } catch {
    return [];
  }
}

function writeSavedModules(list: SavedModule[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LS_MODULES, JSON.stringify(list));
}

// Collapse is view state, not content — a module captured from a hidden
// section must not insert as "section hidden".
function stripCollapsed(b: Block): Block {
  if (b.type !== "heading" || !b.attrs?.collapsed) return b;
  const attrs = { ...b.attrs };
  delete attrs.collapsed;
  return { ...b, attrs };
}

/** Save a section as a reusable module (ids freshened so it detaches from the note). */
export function saveModule(name: string, blocks: Block[], createdAt: string): SavedModule {
  const record: SavedModule = { id: uid(), name, blocks: freshBlocks(blocks.map(stripCollapsed)), createdAt };
  writeSavedModules([record, ...readSavedModules()]);
  return record;
}

/** Replace a saved module's name and blocks (ids freshened like saveModule).
 *  Upserts: if the record vanished meanwhile (deleted in another tab/menu),
 *  the edit is still preserved by re-creating the module under the same id. */
export function updateModule(id: string, name: string, blocks: Block[]): void {
  const list = readSavedModules();
  const cleaned = freshBlocks(blocks.map(stripCollapsed));
  if (list.some((m) => m.id === id)) {
    writeSavedModules(list.map((m) => (m.id === id ? { ...m, name, blocks: cleaned } : m)));
  } else {
    writeSavedModules([{ id, name, blocks: cleaned, createdAt: new Date().toISOString() }, ...list]);
  }
}

export function deleteSavedModule(id: string): void {
  writeSavedModules(readSavedModules().filter((m) => m.id !== id));
}

/** Saved modules, viewed through the Module interface (category "custom"). */
export function listSavedModules(): Module[] {
  return readSavedModules().map((m) => ({
    id: m.id,
    name: m.name,
    icon: "module" as IconName,
    category: "custom" as ModuleCategory,
    description: "Saved from a note.",
    blocks: m.blocks,
  }));
}

// ─── Usage ranking (recent / frequent, localStorage) ──────────────────────────

const LS_USAGE = "aquarius.modules.usage.v1";
const DAY = 24 * 60 * 60 * 1000;

type UsageMap = Record<string, { count: number; lastUsed: string }>;

function readUsage(): UsageMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(LS_USAGE);
    const obj = raw ? (JSON.parse(raw) as unknown) : {};
    return obj && typeof obj === "object" ? (obj as UsageMap) : {};
  } catch {
    return {};
  }
}

/** Record that a module was inserted (drives the inserter's default order). */
export function recordModuleUse(id: string): void {
  if (typeof window === "undefined") return;
  const usage = readUsage();
  const prev = usage[id];
  usage[id] = { count: (prev?.count ?? 0) + 1, lastUsed: new Date().toISOString() };
  window.localStorage.setItem(LS_USAGE, JSON.stringify(usage));
}

/** Frequency with a recency boost: recently-used modules float to the top. */
function usageScore(usage: UsageMap, id: string): number {
  const u = usage[id];
  if (!u) return 0;
  const age = Date.now() - new Date(u.lastUsed).getTime();
  return u.count + (age < 3 * DAY ? 3 : age < 14 * DAY ? 1 : 0);
}

// ─── The inserter's list: saved + built-in, filtered & ranked ─────────────────

/** Match `q` against a candidate string; higher is better, 0 = no match. */
function matchScore(q: string, s: string): number {
  const t = s.toLowerCase();
  if (t.startsWith(q)) return 100;
  const at = t.indexOf(q);
  if (at > 0) return t[at - 1] === " " ? 80 : 60;
  // Subsequence match (e.g. "wex" → "Worked example").
  let i = 0;
  for (const ch of t) if (ch === q[i]) i++;
  return i === q.length ? 30 : 0;
}

function moduleScore(q: string, m: Module): number {
  let best = matchScore(q, m.name);
  for (const k of m.keywords ?? []) best = Math.max(best, matchScore(q, k) * 0.8);
  best = Math.max(best, matchScore(q, MODULE_CATEGORY_NAMES[m.category]) * 0.5);
  return best;
}

/**
 * The slash-menu list: user-saved modules first, then the catalog. An empty
 * query returns everything ranked by recent/frequent use; a query fuzzy-filters
 * (name, keywords, category) and ranks by match quality, usage breaking ties.
 */
export function searchModules(query: string): Module[] {
  const all = [...listSavedModules(), ...builtinModules()];
  const usage = readUsage();
  const q = query.trim().toLowerCase();
  if (!q) {
    return all
      .map((m, i) => ({ m, i, u: usageScore(usage, m.id) }))
      .sort((a, b) => b.u - a.u || a.i - b.i)
      .map((x) => x.m);
  }
  return all
    .map((m, i) => ({ m, i, s: moduleScore(q, m), u: usageScore(usage, m.id) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || b.u - a.u || a.i - b.i)
    .map((x) => x.m);
}
