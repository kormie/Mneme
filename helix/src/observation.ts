/**
 * The Observation packet: the one wire schema adapters push into the
 * sensory layer (brief §6: L0 stores = adapters, buffer, tools). It is
 * the concrete shape this slice gives the kernel's opaque `RawPacket`
 * type on pg-s2w's declared ingress `raw` — a helix-level projection of
 * an IR type, not an extension of the IR (the loader in kernel.ts still
 * mirrors kernel.json verbatim). Adapters push these packets and nothing
 * else; they never commit long-term memory and never branch on what the
 * text says.
 */

export const CHANNELS = ["file", "claude-code"] as const;
export type Channel = (typeof CHANNELS)[number];

export interface Observation {
  /** Unique per packet. Downstream memory is keyed, so a re-delivered id
   * replaces rather than duplicates (delivery is at-least-once). */
  id: string;
  /** Date-representable milliseconds since the Unix epoch, the adapter's own clock. */
  t: number;
  /** Which adapter saw it. */
  channel: Channel;
  /** What the channel saw, e.g. "note", "user-prompt", "session-stop". */
  kind: string;
  /** The observed text, verbatim. Never parsed to route or branch. */
  text: string;
}

/** Shape check for packets arriving off the wire or the spool. */
export function isObservation(v: unknown): v is Observation {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === "string" && o.id.length > 0 &&
    typeof o.t === "number" && Number.isFinite(o.t) &&
    Number.isFinite(new Date(o.t).getTime()) &&
    typeof o.channel === "string" &&
    (CHANNELS as readonly string[]).includes(o.channel) &&
    typeof o.kind === "string" && o.kind.length > 0 &&
    typeof o.text === "string"
  );
}

/** Parse one JSON document into a packet, or null if it is not one. */
export function parseObservation(json: string): Observation | null {
  let v: unknown;
  try {
    v = JSON.parse(json);
  } catch {
    return null;
  }
  return isObservation(v) ? v : null;
}
