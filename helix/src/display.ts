/** Display-only helpers for the CLI. Nothing here touches the store or
 * the trace; a clipped title on screen is never a clipped title on disk. */

export const DISPLAY_TITLE_MAX = 96;

/** Shorten a title for one console line, marking the cut with an
 * ellipsis. The stored value is untouched (see sensory.ts TITLE_MAX for
 * what the store itself keeps). */
export function clip(text: string, max = DISPLAY_TITLE_MAX): string {
  const points = [...text]; // code points, so an emoji is never split
  if (points.length <= max) return text;
  return points.slice(0, Math.max(0, max - 1)).join("").trimEnd() + "…";
}
