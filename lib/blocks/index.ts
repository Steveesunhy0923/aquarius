/**
 * Public surface for the Aquarius block model.
 *
 * The block tree (./types) is the single source of truth; ./factory provides
 * pure constructors; ./serialize is the LaTeX/KaTeX output adapter.
 */

export * from "./types";
export * from "./factory";
export * from "./serialize";
