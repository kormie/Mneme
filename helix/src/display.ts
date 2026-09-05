/** Display-only helpers for the CLI. Nothing here touches the store or
 * the trace; a clipped title on screen is never a clipped title on disk. */

export const DISPLAY_TITLE_MAX = 96;

/** Shorten a title for one console line, marking the cut with an
 * ellipsis. The stored value is untouched (see sensory.ts TITLE_MAX for
 * what the store itself keeps). */
export function clip(text: string, max = DISPLAY_TITLE_MAX): string {
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
}
