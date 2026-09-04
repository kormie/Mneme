/** Deterministic interpretation of the deliberately small temporal query
 * surface supported by the tray. Dates are explicit UTC inputs; this module
 * never consults the wall clock. */

export interface ObservationInterval {
  label: "last week";
  startMs: number;
  endMs: number;
  start: string;
  end: string;
}

export interface TemporalQuery {
  interval?: ObservationInterval;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseAsOfDate(value: string): number {
  const match = DATE.exec(value);
  if (match === null) {
    throw new Error(`invalid --as-of date ${JSON.stringify(value)}; expected YYYY-MM-DD`);
  }
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
    throw new Error(`invalid --as-of date ${JSON.stringify(value)}; expected a real UTC calendar date`);
  }
  return ms;
}

export function temporalQuery(question: string, asOf?: string): TemporalQuery {
  const asksLastWeek = /\blast\s+week\b/iu.test(question);
  if (!asksLastWeek) {
    if (asOf !== undefined) parseAsOfDate(asOf);
    return {};
  }
  if (asOf === undefined) {
    throw new Error('relative query "last week" requires --as-of YYYY-MM-DD');
  }
  const reference = new Date(parseAsOfDate(asOf));
  const daysSinceMonday = (reference.getUTCDay() + 6) % 7;
  const thisMonday = Date.UTC(
    reference.getUTCFullYear(),
    reference.getUTCMonth(),
    reference.getUTCDate() - daysSinceMonday,
  );
  const startMs = thisMonday - 7 * 24 * 60 * 60 * 1000;
  const endMs = thisMonday;
  return {
    interval: {
      label: "last week",
      startMs,
      endMs,
      start: new Date(startMs).toISOString(),
      end: new Date(endMs).toISOString(),
    },
  };
}
