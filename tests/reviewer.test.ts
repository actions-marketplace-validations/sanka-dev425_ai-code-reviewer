import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedFile } from "../src/parser.js";

const mockCreate = vi.fn();

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
  info: vi.fn(),
  warning: vi.fn(),
  debug: vi.fn(),
  setFailed: vi.fn(),
  setSecret: vi.fn(),
  getInput: vi.fn(),
}));

const aiModule = await import("../src/ai.js");
const { configureAI, consumeInvalidJsonFlag, resetUsageCounters, reviewFile } = aiModule;

const SAMPLE_FILE: ParsedFile = {
  filename: "src/review-target.ts",
  language: "typescript",
  additions: 3,
  deletions: 0,
  chunks: [
    {
      newStart: 10,
      lines: [
        { lineNumber: 10, content: "const query = req.query.id;", type: "add" },
        {
          lineNumber: 11,
          content: "const row = await db.query(`SELECT * FROM t WHERE id = ${query}`);",
          type: "add",
        },
        { lineNumber: 12, content: "return row;", type: "add" },
      ],
    },
  ],
};

describe("reviewFile", () => {
  beforeEach(() => {
    mockCreate.mockReset();
    configureAI({
      apiKey: "test-key",
      model: "claude-sonnet-4-20250514",
    });
    resetUsageCounters();
  });

  it("returns empty array when Claude returns []", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "[]" }],
      usage: { input_tokens: 120, output_tokens: 15 },
    });

    const result = await reviewFile(SAMPLE_FILE, "standard");

    expect(result).toEqual([]);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(consumeInvalidJsonFlag(SAMPLE_FILE.filename)).toBe(false);
  });

  it("retries on 429 rate limit error", async () => {
    const rateLimitError = Object.assign(new Error("Too Many Requests"), {
      status: 429,
    });

    mockCreate.mockRejectedValueOnce(rateLimitError);
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "[]" }],
      usage: { input_tokens: 120, output_tokens: 15 },
    });

    const result = await reviewFile(SAMPLE_FILE, "standard");

    expect(result).toEqual([]);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  }, 10000);

  it("handles malformed JSON response gracefully", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "not valid json" }],
      usage: { input_tokens: 150, output_tokens: 25 },
    });

    const result = await reviewFile(SAMPLE_FILE, "deep");

    expect(result).toEqual([]);
    expect(consumeInvalidJsonFlag(SAMPLE_FILE.filename)).toBe(true);
  });
});
