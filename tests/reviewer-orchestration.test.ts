import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewComment } from "../src/ai.js";
import type { ActionConfig } from "../src/config.js";
import type { ParsedFile } from "../src/parser.js";

const mockReviewFile =
  vi.fn<(file: ParsedFile, level: ActionConfig["reviewLevel"]) => Promise<ReviewComment[]>>();
const mockConsumeInvalidJsonFlag = vi.fn<(filename: string) => boolean>();

const mockCoreInfo = vi.fn();
const mockCoreWarning = vi.fn();

vi.mock("@actions/core", () => ({
  info: mockCoreInfo,
  warning: mockCoreWarning,
}));

vi.mock("../src/ai.js", () => ({
  reviewFile: mockReviewFile,
  consumeInvalidJsonFlag: mockConsumeInvalidJsonFlag,
}));

const { orchestrateReview, shouldIgnoreFile } = await import("../src/reviewer.js");

const BASE_CONFIG: ActionConfig = {
  githubToken: "gh-token",
  anthropicApiKey: "anthropic-token",
  model: "claude-sonnet-4-20250514",
  reviewLevel: "standard",
  ignorePatterns: ["*.md"],
  maxFiles: 1,
  postSummary: true,
};

const REVIEWABLE_FILE: ParsedFile = {
  filename: "src/api.ts",
  language: "typescript",
  additions: 3,
  deletions: 0,
  chunks: [
    {
      newStart: 10,
      lines: [
        { lineNumber: 10, content: "const id = req.query.id;", type: "add" },
        {
          lineNumber: 11,
          content: "const result = await db.query(`SELECT * FROM users WHERE id = ${id}`);",
          type: "add",
        },
        { lineNumber: 12, content: "return result;", type: "context" },
      ],
    },
  ],
};

const SECOND_FILE: ParsedFile = {
  filename: "src/worker.ts",
  language: "typescript",
  additions: 2,
  deletions: 0,
  chunks: [
    {
      newStart: 1,
      lines: [{ lineNumber: 1, content: "export const ok = true;", type: "add" }],
    },
  ],
};

const IGNORED_FILE: ParsedFile = {
  filename: "README.md",
  language: "markdown",
  additions: 1,
  deletions: 0,
  chunks: [
    {
      newStart: 1,
      lines: [{ lineNumber: 1, content: "# docs", type: "add" }],
    },
  ],
};

describe("reviewer orchestration", () => {
  beforeEach(() => {
    mockReviewFile.mockReset();
    mockConsumeInvalidJsonFlag.mockReset();
    mockConsumeInvalidJsonFlag.mockReturnValue(false);
    mockCoreInfo.mockReset();
    mockCoreWarning.mockReset();
  });

  it("skips ignored files and respects max_files", async () => {
    mockReviewFile.mockResolvedValueOnce([
      {
        line: 11,
        severity: "warning",
        category: "security",
        title: "SQL injection risk",
        body: "Query should be parameterized.",
        suggestion: null,
      },
    ]);

    const result = await orchestrateReview(
      [IGNORED_FILE, REVIEWABLE_FILE, SECOND_FILE],
      BASE_CONFIG
    );

    expect(result.reviewedCount).toBe(1);
    expect(result.comments).toHaveLength(1);
    expect(result.comments[0]).toMatchObject({
      path: "src/api.ts",
      line: 11,
      side: "RIGHT",
    });

    const skippedReasons = result.skippedFiles.map((entry) => entry.reason);
    expect(skippedReasons).toContain("Matched ignore_patterns");
    expect(skippedReasons).toContain("Exceeded max_files limit (1)");
    expect(mockCoreInfo).toHaveBeenCalled();
  });

  it("filters out comments that target non-added lines", async () => {
    mockReviewFile.mockResolvedValueOnce([
      {
        line: 999,
        severity: "warning",
        category: "bug",
        title: "Invalid line",
        body: "Wrong line",
        suggestion: null,
      },
      {
        line: 10,
        severity: "suggestion",
        category: "maintainability",
        title: "Small improvement",
        body: "Use a helper.",
        suggestion: null,
      },
    ]);

    const result = await orchestrateReview([REVIEWABLE_FILE], BASE_CONFIG);

    expect(result.reviewedCount).toBe(1);
    expect(result.comments).toHaveLength(1);
    expect(result.comments[0].line).toBe(10);
    expect(mockCoreWarning).toHaveBeenCalledWith(
      expect.stringContaining("line is not an added line")
    );
  });

  it("marks a file as skipped when Claude returns invalid JSON", async () => {
    mockReviewFile.mockResolvedValueOnce([]);
    mockConsumeInvalidJsonFlag.mockReturnValueOnce(true);

    const result = await orchestrateReview([REVIEWABLE_FILE], BASE_CONFIG);

    expect(result.reviewedCount).toBe(0);
    expect(result.comments).toHaveLength(0);
    expect(result.skippedFiles[0]).toEqual({
      filename: "src/api.ts",
      reason: "Claude returned invalid JSON",
    });
  });

  it("marks a file as skipped when AI request throws", async () => {
    mockReviewFile.mockRejectedValueOnce(new Error("rate limited"));

    const result = await orchestrateReview([REVIEWABLE_FILE], BASE_CONFIG);

    expect(result.reviewedCount).toBe(0);
    expect(result.comments).toHaveLength(0);
    expect(result.skippedFiles[0].reason).toContain("AI request failed: rate limited");
  });
});

describe("shouldIgnoreFile", () => {
  it("matches glob patterns with base-name behavior", () => {
    expect(shouldIgnoreFile("docs/README.md", ["*.md"])).toBe(true);
    expect(shouldIgnoreFile("src/index.ts", ["*.md"])).toBe(false);
  });
});
