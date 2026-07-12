/** The human-readable message of any thrown value (Error or not). */
export const errorMessage = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);
