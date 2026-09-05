/**
 * The journal: a period-bounded ask rendered as days. One header per
 * calendar day in the interval's own fixed offset, one line per
 * remembered observation in ascending observation time — the reading
 * order a person wants for "what did I do yesterday". Presentation only:
 * it sorts a display copy of the hits, so the AskReport, hybrid's
 * declared order, and the trace are exactly what --ask produces.
 */
import { clip } from "./display.js";
import { parseUtcOffset, type ObservationInterval } from "./temporal-query.js";
import type { Hit } from "./tray.js";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export interface JournalLine {
  day: string;
  weekday: string;
  /** Wall-clock time in the interval's offset, HH:MM. */
  time: string;
  channel: string;
  kind: string;
  note: string;
  title: string;
  /** Query tokens this entry matched, when the ask had topic words. */
  matched: string[];
}

/** Group dated hits by local day in the interval's offset, ascending. */
export function journalLines(hits: Hit[], interval: ObservationInterval): JournalLine[] {
  const offsetMs = parseUtcOffset(interval.utcOffset);
  const dated = hits.filter((h): h is Hit & { observationTimeMs: number } =>
    h.observationTimeMs !== undefined
  );
  const sorted = [...dated].sort((a, b) =>
    a.observationTimeMs - b.observationTimeMs ||
    (a.note < b.note ? -1 : a.note > b.note ? 1 : 0)
  );
  return sorted.map((h) => {
    const local = new Date(h.observationTimeMs + offsetMs);
    return {
      day: local.toISOString().slice(0, 10),
      weekday: WEEKDAYS[local.getUTCDay()] as string,
      time: local.toISOString().slice(11, 16),
      channel: h.triples.find((t) => t.p === "channel")?.o ?? "file",
      kind: h.triples.find((t) => t.p === "kind")?.o ?? "unknown",
      note: h.note,
      title: h.title,
      matched: h.matched,
    };
  });
}

/** Render the journal as console lines. `limit` caps entries shown. */
export function renderJournal(
  hits: Hit[],
  interval: ObservationInterval,
  limit?: number,
): string[] {
  const lines = journalLines(hits, interval);
  const out: string[] = [];
  const shown = limit === undefined ? lines : lines.slice(0, limit);
  let day: string | null = null;
  for (const l of shown) {
    if (l.day !== day) {
      day = l.day;
      const count = lines.filter((x) => x.day === l.day).length;
      out.push(`${l.day} ${l.weekday} — ${count} observation(s), times at UTC${interval.utcOffset}`);
    }
    const via = l.matched.length > 0 ? `  [${l.matched.join(", ")}]` : "";
    out.push(`  ${l.time}  ${l.channel}/${l.kind}  ${l.note}  "${clip(l.title, 80)}"${via}`);
  }
  if (shown.length < lines.length) {
    out.push(`  … and ${lines.length - shown.length} more observation(s) in this period (--limit N shows more)`);
  }
  if (lines.length === 0) out.push("  nothing remembered in this period");
  return out;
}
