import { describe, expect, it } from "bun:test";
import { formatAiDateTime } from "./markdown";

describe("formatAiDateTime", () => {
  const timeZone = "UTC";
  const base = Date.UTC(2024, 0, 1, 0, 0, 0);

  it("formats seconds, minutes, hours, and days with suffixes", () => {
    const cases: Array<{ offsetMs: number; expected: string }> = [
      { offsetMs: 30 * 1000, expected: "30 seconds ago" },
      { offsetMs: 2 * 60 * 1000, expected: "2 minutes ago" },
      { offsetMs: 3 * 60 * 60 * 1000, expected: "3 hours ago" },
      { offsetMs: 5 * 24 * 60 * 60 * 1000, expected: "5 days ago" },
    ];

    for (const { offsetMs, expected } of cases) {
      const nowMs = base + offsetMs;
      const formatted = formatAiDateTime(base, timeZone, nowMs);
      expect(formatted).toBe(`2024-01-01 00:00 [${expected}]`);
    }
  });
});
