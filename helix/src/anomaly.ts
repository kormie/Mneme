/**
 * Deterministic secret detection for the tray's anomaly node (pg-s2w).
 * These are tray-level rules for the `anomaly` prompt node's offline
 * stand-in — not a frozen surface, and not a certified check: a clean
 * scan is not proof a note is safe, only that no rule matched. Rules are
 * intentionally assignment- and format-shaped to keep false positives
 * rare in ordinary developer prose.
 */

export interface AnomalyMatch {
  note: string;
  rule: string;
}

/** Payload for pg-s2w's anomaly.flag out-port (AnomalyEvent?). */
export interface AnomalyFlag {
  anomaly: true;
  clause: string;
  notes: string[];
  matches: AnomalyMatch[];
}

/** Luhn checksum over a digit string (card-number shape check). */
export function luhnValid(digits: string): boolean {
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

function hasCardNumber(text: string): boolean {
  // Separators cover space, hyphen, dot, and line breaks — a card pasted
  // from a terminal often wraps.
  for (const m of text.matchAll(/\d[\d\s.-]{10,40}\d/g)) {
    const digits = m[0].replace(/[^\d]/g, "");
    // Longer runs are id-shaped (order ids, trace ids), not card-shaped;
    // checking windows inside them would false-positive ~10% of the time.
    if (digits.length < 13 || digits.length > 19) continue;
    // A repeated single digit can pass Luhn but is no card.
    if (/^(\d)\1+$/.test(digits)) continue;
    if (luhnValid(digits)) return true;
  }
  return false;
}

const RULES: { rule: string; hit: (text: string) => boolean }[] = [
  {
    // Tolerates surrounding identifier text (aws_access_key_id = …) and
    // common short forms (pwd); the [:=] keeps prose mentions clean.
    rule: "credential-assignment",
    hit: (t) =>
      /(password|passwd|pwd|secret|api[_-]?key|access[_-]?key|token|bearer)(?:[_-]?[a-z0-9]+)*\s*[:=]/i.test(t),
  },
  { rule: "aws-access-key-id", hit: (t) => /\bakia[0-9a-z]{16}\b/i.test(t) },
  { rule: "private-key-block", hit: (t) => /-----BEGIN [A-Z ]*PRIVATE KEY-----/i.test(t) },
  { rule: "card-number", hit: hasCardNumber },
  { rule: "koho-host", hit: (t) => /\bkoho\.(ca|com)\b/i.test(t) },
];

/**
 * Scan observations; a non-null flag routes on pg-s2w's declared e4
 * control edge (`flag != null`) so the gate can quarantine the notes.
 */
export function scanNotes(obs: { id: string; text: string }[]): AnomalyFlag | null {
  const matches: AnomalyMatch[] = [];
  for (const o of obs) {
    for (const r of RULES) {
      if (r.hit(o.text)) matches.push({ note: o.id, rule: r.rule });
    }
  }
  if (matches.length === 0) return null;
  const notes = [...new Set(matches.map((m) => m.note))];
  return {
    anomaly: true,
    clause: "tray-quarantine: possible secret or customer data; the inbox refuses it",
    notes,
    matches,
  };
}
