/**
 * Deterministic interpretation of the deliberately small temporal query
 * surface supported by the tray. Every date is an explicit input — the
 * anchor day (`--as-of`), the day-boundary offset (`--utc-offset`), or
 * a date literal in the question itself — and this module never consults
 * the wall clock: the same question with the same inputs yields the same
 * interval on any machine on any day.
 *
 * Periods are calendar units, never rolling windows, and every interval
 * is half-open [start, end). Day boundaries fall at local midnight in the
 * given fixed offset (default +00:00); a fixed offset ignores daylight
 * saving by design, so the operator picks the offset in force for the
 * days they are asking about.
 */

export interface ObservationInterval {
  /** The recognised period, e.g. "last week", "yesterday", "on 2026-09-01",
   * or "2026-09-01 to 2026-09-03". */
  label: string;
  startMs: number;
  endMs: number;
  /** ISO-8601 UTC instants of startMs / endMs. */
  start: string;
  end: string;
  /** The fixed offset day boundaries were computed in, as given ("+00:00"). */
  utcOffset: string;
}

export interface TemporalQuery {
  interval?: ObservationInterval;
  /** The question with the recognised period phrase excised, so the
   * phrase's own words ("today", a date literal) never become lexical
   * requirements. Equal to the question when nothing was recognised. */
  residual: string;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const OFFSET = /^([+-])(\d{2}):(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export function parseAsOfDate(value: string): number {
  const match = DATE.exec(value);
  if (match === null) {
    throw new Error(`invalid --as-of date ${JSON.stringify(value)}; expected YYYY-MM-DD`);
  }
  return calendarDayMs(value, `--as-of date ${JSON.stringify(value)}`);
}

/** Midnight (UTC-shaped) of a YYYY-MM-DD literal that names a real day. */
function calendarDayMs(literal: string, what: string): number {
  const match = DATE.exec(literal);
  if (match === null) throw new Error(`invalid ${what}; expected YYYY-MM-DD`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const ms = Date.UTC(year, month - 1, day);
  const date = new Date(ms);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`invalid ${what}; expected a real UTC calendar date`);
  }
  return ms;
}

/** A fixed offset like "-04:00" → milliseconds east of UTC. */
export function parseUtcOffset(value: string): number {
  const match = OFFSET.exec(value);
  if (match === null) {
    throw new Error(`invalid --utc-offset ${JSON.stringify(value)}; expected ±HH:MM (for example -04:00)`);
  }
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  if (hours > 14 || minutes > 59) {
    throw new Error(`invalid --utc-offset ${JSON.stringify(value)}; hours must be 00–14 and minutes 00–59`);
  }
  return (match[1] === "-" ? -1 : 1) * (hours * 60 + minutes) * 60 * 1000;
}

/** Relative periods, anchored on the --as-of day. Word-bounded, so a note
 * title containing "todays" or "weekly" is not a period. */
const RELATIVE: { label: string; re: RegExp }[] = [
  { label: "today", re: /\btoday\b/iu },
  { label: "yesterday", re: /\byesterday\b/iu },
  { label: "this week", re: /\bthis\s+week\b/iu },
  { label: "last week", re: /\blast\s+week\b/iu },
  { label: "this month", re: /\bthis\s+month\b/iu },
  { label: "last month", re: /\blast\s+month\b/iu },
];

/** Absolute periods: a range "between A and B" / "from A to B" (both days
 * inclusive), or a single day, written with or without "on". */
const RANGE = /\b(?:between|from)\s+(\d{4}-\d{2}-\d{2})\s+(?:and|to)\s+(\d{4}-\d{2}-\d{2})\b/iu;
const SINGLE_DAY = /\b(?:on\s+)?(\d{4}-\d{2}-\d{2})\b/iu;

interface Shifted {
  label: string;
  startMs: number;
  endMs: number;
}

/** Interval in "shifted" time: local wall-clock instants treated as UTC. */
function relativeInterval(label: string, anchorMs: number): Shifted {
  const anchor = new Date(anchorMs);
  const year = anchor.getUTCFullYear();
  const month = anchor.getUTCMonth();
  const daysSinceMonday = (anchor.getUTCDay() + 6) % 7;
  const monday = Date.UTC(year, month, anchor.getUTCDate() - daysSinceMonday);
  switch (label) {
    case "today":
      return { label, startMs: anchorMs, endMs: anchorMs + DAY_MS };
    case "yesterday":
      return { label, startMs: anchorMs - DAY_MS, endMs: anchorMs };
    case "this week":
      return { label, startMs: monday, endMs: monday + 7 * DAY_MS };
    case "last week":
      return { label, startMs: monday - 7 * DAY_MS, endMs: monday };
    case "this month":
      return { label, startMs: Date.UTC(year, month, 1), endMs: Date.UTC(year, month + 1, 1) };
    case "last month":
      return { label, startMs: Date.UTC(year, month - 1, 1), endMs: Date.UTC(year, month, 1) };
    default:
      throw new Error(`unsupported relative period: ${label}`);
  }
}

/**
 * Recognise at most one period in the question. Relative periods need
 * `asOf`; absolute ones do not (an `asOf` given alongside is simply not
 * needed). `asOf` or `utcOffset` given with no recognised period is an
 * error, never a silently unbounded result.
 */
export function temporalQuery(
  question: string,
  asOf?: string,
  utcOffset?: string,
): TemporalQuery {
  const offsetGiven = utcOffset !== undefined;
  const offset = utcOffset ?? "+00:00";
  const offsetMs = parseUtcOffset(offset);
  if (asOf !== undefined) parseAsOfDate(asOf); // validate even when unused

  const found: { label: string; span: [number, number]; shifted?: Shifted; relative: boolean }[] = [];
  for (const { label, re } of RELATIVE) {
    const m = re.exec(question);
    if (m !== null) found.push({ label, span: [m.index, m.index + m[0].length], relative: true });
  }
  const range = RANGE.exec(question);
  if (range !== null) {
    const a = calendarDayMs(range[1] as string, `date ${JSON.stringify(range[1])}`);
    const b = calendarDayMs(range[2] as string, `date ${JSON.stringify(range[2])}`);
    if (b < a) throw new Error(`date range ${range[1]} to ${range[2]} ends before it starts`);
    found.push({
      label: `${range[1]} to ${range[2]}`,
      span: [range.index, range.index + range[0].length],
      shifted: { label: `${range[1]} to ${range[2]}`, startMs: a, endMs: b + DAY_MS },
      relative: false,
    });
  } else {
    const single = SINGLE_DAY.exec(question);
    if (single !== null) {
      const d = calendarDayMs(single[1] as string, `date ${JSON.stringify(single[1])}`);
      found.push({
        label: `on ${single[1]}`,
        span: [single.index, single.index + single[0].length],
        shifted: { label: `on ${single[1]}`, startMs: d, endMs: d + DAY_MS },
        relative: false,
      });
      // A second date literal elsewhere is ambiguous, not a range.
      const rest = question.slice(0, single.index) + question.slice(single.index + single[0].length);
      if (SINGLE_DAY.test(rest)) {
        throw new Error(
          'two dates in one question; write a range as "between YYYY-MM-DD and YYYY-MM-DD"',
        );
      }
    }
  }

  if (found.length > 1) {
    throw new Error(
      `one period per question; found ${found.map((f) => JSON.stringify(f.label)).join(" and ")}`,
    );
  }
  const hit = found[0];
  if (hit === undefined) {
    if (asOf !== undefined) {
      throw new Error(
        "--as-of was given but the question names no supported period; " +
          'recognised: today, yesterday, this week, last week, this month, last month, ' +
          'on YYYY-MM-DD, between YYYY-MM-DD and YYYY-MM-DD',
      );
    }
    if (offsetGiven) {
      throw new Error("--utc-offset was given but the question names no supported period");
    }
    return { residual: question };
  }

  let shifted: Shifted;
  if (hit.relative) {
    if (asOf === undefined) {
      throw new Error(`relative query ${JSON.stringify(hit.label)} requires --as-of YYYY-MM-DD`);
    }
    shifted = relativeInterval(hit.label, parseAsOfDate(asOf));
  } else {
    shifted = hit.shifted as Shifted;
  }
  // Local midnight in the given offset is that offset earlier or later
  // than the same wall-clock instant in UTC.
  const startMs = shifted.startMs - offsetMs;
  const endMs = shifted.endMs - offsetMs;
  const residual = (question.slice(0, hit.span[0]) + " " + question.slice(hit.span[1]))
    .replace(/\s+/gu, " ")
    .trim();
  return {
    interval: {
      label: shifted.label,
      startMs,
      endMs,
      start: new Date(startMs).toISOString(),
      end: new Date(endMs).toISOString(),
      utcOffset: offset,
    },
    residual,
  };
}

/** A one-line human gloss of a recognised period, for the CLI. */
export function describeInterval(interval: ObservationInterval, asOf?: string): string {
  const anchor = asOf === undefined ? "" : ` as of ${asOf}`;
  const boundaries = `day boundaries at UTC${interval.utcOffset}`;
  switch (interval.label) {
    case "today":
    case "yesterday":
      return `${interval.label}${anchor}; ${boundaries}`;
    case "this week":
    case "last week":
      return `${interval.label}${anchor}: a calendar week, Monday to Monday; ${boundaries}`;
    case "this month":
    case "last month":
      return `${interval.label}${anchor}: a calendar month; ${boundaries}`;
    default:
      return `${interval.label} (absolute; --as-of not needed); ${boundaries}`;
  }
}
