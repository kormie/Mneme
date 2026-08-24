import { describe, expect, it } from "bun:test";
import { luhnValid, scanNotes } from "../src/anomaly.js";

// Secret-shaped strings are assembled at test time so no credential-like
// bytes ever live in the repository.
const AWS_EXAMPLE = "AKIA" + "IOSFODNN7EXAMPLE";
const TEST_PAN = ["4111", "1111", "1111", "1111"].join(" "); // canonical test card
const CRED_LINE = ["pass", "word"].join("") + ": hunter2-example";
const KEY_HEADER = ["-----BEGIN RSA PRIVATE ", "KEY-----"].join("");

describe("anomaly rules", () => {
  it("validates Luhn on card-shaped digit runs", () => {
    expect(luhnValid("4111111111111111")).toBe(true);
    expect(luhnValid("4111111111111112")).toBe(false);
    expect(luhnValid("1234")).toBe(false);
  });

  it("flags credential assignments, AWS key ids, key blocks, PANs, KOHO hosts", () => {
    const cases: [string, string][] = [
      [CRED_LINE, "credential-assignment"],
      [`key id ${AWS_EXAMPLE} seen in a log line`, "aws-access-key-id"],
      [KEY_HEADER, "private-key-block"],
      [`customer card ${TEST_PAN} in a support note`, "card-number"],
      ["saw it on app.koho.ca yesterday", "koho-host"],
    ];
    for (const [text, rule] of cases) {
      const flag = scanNotes([{ id: "n.md", text }]);
      expect(flag, text).not.toBeNull();
      expect(flag!.matches.map((m) => m.rule), text).toContain(rule);
    }
  });

  it("catches card numbers with doubled, mixed, dot, or newline separators", () => {
    const doubled = ["4111", "1111", "1111", "1111"].join("  ");
    const mixed = "4111-1111  1111 1111";
    const dotted = "4111.1111.1111.1111";
    const wrapped = "4111 1111\n      1111 1111";
    for (const text of [doubled, mixed, dotted, wrapped]) {
      const flag = scanNotes([{ id: "n.md", text: `card ${text} on file` }]);
      expect(flag, text).not.toBeNull();
      expect(flag!.matches.map((m) => m.rule)).toContain("card-number");
    }
  });

  it("catches obfuscated credential shapes the red team slipped past v1", () => {
    const cases: [string, string][] = [
      ["key id " + "akia" + "iosfodnn7example" + " in a log", "aws-access-key-id"],
      ["aws_access_key_id = redacted-example", "credential-assignment"],
      ["pwd: hunter2-example", "credential-assignment"],
    ];
    for (const [text, rule] of cases) {
      const flag = scanNotes([{ id: "n.md", text }]);
      expect(flag, text).not.toBeNull();
      expect(flag!.matches.map((m) => m.rule), text).toContain(rule);
    }
  });

  it("stays quiet on ordinary developer prose", () => {
    const clean = [
      "# Standup\n- fixed the cache key for CI\n- reviewed the scheduler PR",
      "call with Jordan at 1400, room 12; ticket HX-4111 still open",
      "the word password appears here without an assignment",
      "aws account 123456789012 in the terraform plan", // 12 digits, not a card
      "batch id 0000000000000 from the nightly job", // repeated digit passes Luhn but is no card
      "trace id 12345678901234567890123 from the log", // id-shaped long run
    ];
    for (const text of clean) {
      expect(scanNotes([{ id: "n.md", text }]), text).toBeNull();
    }
  });
});
