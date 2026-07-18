/**
 * Fillable-field tokens: `{{Field name}}` written in prose (module/template
 * text, list items, table cells). A token is literal text in the stored
 * string — like the bold/link markers in format.ts — so it survives every
 * copy/serialize/round-trip untouched. Renderers show tokens as placeholder
 * chips; inserting a module that contains tokens prompts once for values.
 */

/** One `{{Field name}}` token. Names may not contain braces or newlines. */
const FIELD_RE = /\{\{([^{}\n]+)\}\}/g;

/** Split prose into literal strings and `{ field }` tokens, in order. */
export function splitFieldTokens(text: string): Array<string | { field: string }> {
  const out: Array<string | { field: string }> = [];
  let last = 0;
  let m: RegExpExecArray | null;
  FIELD_RE.lastIndex = 0;
  while ((m = FIELD_RE.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push({ field: m[1].trim() });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Collect field names from `s` into `out` (deduped, first-appearance order). */
export function scanFieldNames(s: string | undefined, out: string[]): void {
  if (!s || !s.includes("{{")) return;
  for (const part of splitFieldTokens(s)) {
    if (typeof part === "string") continue;
    if (part.field && !out.includes(part.field)) out.push(part.field);
  }
}

/**
 * Substitute filled values into `s`. Only non-blank values replace their
 * token — a field the user left empty stays a visible `{{…}}` placeholder
 * to fill in later.
 */
export function fillFieldText(s: string, values: Record<string, string>): string {
  if (!s.includes("{{")) return s;
  FIELD_RE.lastIndex = 0;
  return s.replace(FIELD_RE, (token, name: string) => {
    const v = values[name.trim()];
    return v && v.trim() ? v.trim() : token;
  });
}
