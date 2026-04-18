import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedFile } from "../src/parser.js";

const mockCreate = vi.fn();
const coreInfo = vi.fn();
const coreWarning = vi.fn();

vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class MockAnthropic {
      public messages = {
        create: mockCreate,
      };

      public constructor(_config: { apiKey: string }) {}
    },
  };
});

vi.mock("@actions/core", () => ({
  info: coreInfo,
  warning: coreWarning,
  debug: vi.fn(),
  setFailed: vi.fn(),
  setSecret: vi.fn(),
  getInput: vi.fn(),
}));

const {
  configureAI,
  consumeInvalidJsonFlag,
  estimateCost,
  getTokenUsage,
  resetUsageCounters,
  reviewFile,
} = await import("../src/ai.js");

const SMALL_FILE: ParsedFile = {
  filename: "src/example.ts",
  language: "typescript",
  additions: 2,
  deletions: 0,
  chunks: [
    {
      newStart: 1,
      lines: [
        { lineNumber: 1, content: "const value = 1;", type: "add" },
        { lineNumber: 2, content: "export { value };", type: "add" },
      ],
    },
  ],
};

const LARGE_FILE: ParsedFile = {
  filename: "src/large.ts",
  language: "typescript",
  additions: 40,
  deletions: 0,
  chunks: [
    {
      newStart: 1,
      lines: Array.from({ length: 40 }, (_, index) => ({
        lineNumber: index + 1,
        content: `const line${index} = "${"x".repeat(500)}";`,
        type: "add" as const,
      })),
    },
  ],
};

describe("ai advanced behavior", () => {
  beforeEach(() => {
    mockCreate.mockReset();
    coreInfo.mockReset();
    coreWarning.mockReset();
    configureAI({
      apiKey: "test-key",
      model: "claude-sonnet-4-20250514",
    });
    resetUsageCounters();
  });

  it("returns an empty list when a file has no added lines", async () => {
    const noAddedLines: ParsedFile = {
      filename: "src/context-only.ts",
      language: "typescript",
      additions: 0,
      deletions: 0,
      chunks: [
        {
          newStart: 10,
          lines: [{ lineNumber: 10, content: "const oldValue = 1;", type: "context" }],
        },
      ],
    };

    const result = await reviewFile(noAddedLines, "quick");

    expect(result).toEqual([]);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns an empty list when Claude emits no text blocks", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "tool_use" }],
      usage: { input_tokens: 5, output_tokens: 0 },
    });

    const result = await reviewFile(SMALL_FILE, "standard");

    expect(result).toEqual([]);
    expect(getTokenUsage()).toEqual({
      inputTokens: 5,
      outputTokens: 0,
      totalTokens: 5,
    });
  });

  it("filters malformed Claude comments and tracks token usage", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: JSON.stringify([
            {
              line: 1,
              severity: "warning",
              category: "security",
              title: "Valid comment",
              body: "This is valid.",
              suggestion: null,
            },
            {
              line: -1,
              severity: "warning",
              category: "security",
              title: "Bad line",
              body: "Should be dropped.",
              suggestion: null,
            },
            {
              line: 2,
              severity: "bad",
              body: "Should be dropped.",
            },
          ]),
        },
      ],
      usage: { input_tokens: 50, output_tokens: 25 },
    });

    const result = await reviewFile(SMALL_FILE, "standard");

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      line: 1,
      severity: "warning",
      category: "security",
    });
    expect(getTokenUsage()).toEqual({
      inputTokens: 50,
      outputTokens: 25,
      totalTokens: 75,
    });
    expect(estimateCost(getTokenUsage())).toBe("$0.0005");
  });

  it("chunks oversized diffs and deduplicates repeated findings", async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify([
            {
              line: 1,
              severity: "suggestion",
              category: "maintainability",
              title: "Extract helper",
              body: "This block can be moved into a helper.",
              suggestion: null,
            },
          ]),
        },
      ],
      usage: { input_tokens: 100, output_tokens: 20 },
    });

    const result = await reviewFile(LARGE_FILE, "deep");

    expect(result).toHaveLength(1);
    expect(mockCreate.mock.calls.length).toBeGreaterThan(1);
    expect(coreInfo).toHaveBeenCalledWith(expect.stringContaining("exceeds token budget"));
  });

  it("marks malformed JSON so the orchestrator can skip the file", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "not json" }],
      usage: { input_tokens: 10, output_tokens: 10 },
    });

    const result = await reviewFile(SMALL_FILE, "standard");

    expect(result).toEqual([]);
    expect(consumeInvalidJsonFlag(SMALL_FILE.filename)).toBe(true);
    expect(coreWarning).toHaveBeenCalledWith(
      expect.stringContaining("Claude returned invalid JSON")
    );
  });

  it("throws a normalized error on non-rate-limit failures", async () => {
    mockCreate.mockRejectedValueOnce("network exploded");

    await expect(reviewFile(SMALL_FILE, "standard")).rejects.toThrow("network exploded");
  });
});
