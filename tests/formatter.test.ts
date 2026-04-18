import { describe, expect, it } from "vitest";
import type { ReviewComment } from "../src/ai.js";
import { formatComment, formatSummary } from "../src/formatter.js";

describe("formatComment", () => {
  it("renders error badge correctly", () => {
    const comment: ReviewComment = {
      line: 10,
      severity: "error",
      category: "security",
      title: "Potential SQL injection",
      body: "User input reaches query text without parameterization.",
      suggestion: "const row = await db.query('SELECT * FROM users WHERE id = $1', [id]);",
    };

    const result = formatComment(comment);

    expect(result).toContain("[🔴 Error]");
    expect(result).toContain("Potential SQL injection");
  });

  it("includes suggestion block when suggestion is non-null", () => {
    const comment: ReviewComment = {
      line: 15,
      severity: "warning",
      category: "performance",
      title: "Avoid repeated parsing",
      body: "Move parsing outside this loop.",
      suggestion: "const parsed = JSON.parse(payload);",
    };

    const result = formatComment(comment);

    expect(result).toContain("```suggestion");
    expect(result).toContain("const parsed = JSON.parse(payload);");
  });
});

describe("formatSummary", () => {
  it('returns "Do not merge" verdict when errors > 0', () => {
    const result = formatSummary([
      {
        filename: "src/main.ts",
        comments: [],
        errors: 1,
        warnings: 0,
        suggestions: 0,
        skipped: false,
      },
      {
        filename: "src/utils.ts",
        comments: [],
        errors: 0,
        warnings: 2,
        suggestions: 1,
        skipped: false,
      },
    ]);

    expect(result).toContain("🚫 Do not merge");
    expect(result).toContain("| File | Errors | Warnings | Suggestions |");
  });
});
