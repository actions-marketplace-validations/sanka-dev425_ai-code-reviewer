import Anthropic from "@anthropic-ai/sdk";
import * as core from "@actions/core";
import type { ReviewLevel } from "./config.js";
import { getAddedLines, type DiffLine, type ParsedFile } from "./parser.js";

export type ReviewSeverity = "error" | "warning" | "suggestion";
export type ReviewCategory = "security" | "bug" | "performance" | "style" | "maintainability";

export interface ReviewComment {
  line: number;
  severity: ReviewSeverity;
  category: ReviewCategory;
  title: string;
  body: string;
  suggestion: string | null;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

interface AIClientConfig {
  apiKey: string;
  model: string;
}

interface ClaudeCallResult {
  comments: ReviewComment[];
  invalidJson: boolean;
  inputTokens: number;
  outputTokens: number;
}

interface ClaudeMessage {
  content: Array<{
    type: string;
    text?: string;
  }>;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

const SYSTEM_PROMPT = `You are an expert code reviewer specializing in JavaScript and TypeScript.
You will be given a unified diff of a file changed in a pull request.

REVIEW FOCUS (by level):
- quick:    Only flag errors and critical bugs
- standard: Errors, warnings, performance issues, security issues
- deep:     Everything above + style, naming, architecture suggestions

RULES:
1. Only comment on ADDED lines (lines starting with +)
2. Be specific — reference the exact line, explain WHY it is an issue
3. Suggest a fix when possible using a code block
4. Do NOT comment on removed lines or context lines
5. Do NOT be overly pedantic — skip trivial style nitpicks in quick/standard mode
6. Prioritize: security > correctness > performance > style
7. If the code looks good, return an empty array — do not invent issues

SECURITY CHECKS (always):
- SQL injection, XSS, command injection
- Hardcoded secrets or API keys
- Unsafe eval() or Function() calls
- Unvalidated user input reaching sensitive operations
- Exposed sensitive data in logs

RESPOND ONLY with a valid JSON array. No prose, no markdown wrapper.

Schema:
[
  {
    "line": <line number as integer>,
    "severity": "error" | "warning" | "suggestion",
    "category": "security" | "bug" | "performance" | "style" | "maintainability",
    "title": "<short title, max 8 words>",
    "body": "<detailed explanation>",
    "suggestion": "<corrected code snippet or null>"
  }
]`;

const MODEL_MAX_DIFF_TOKENS = 4000;
const MAX_RETRY_ATTEMPTS = 3;
const BASE_RETRY_DELAY_MS = 500;

let aiClient: Anthropic | null = null;
let aiModel = "claude-sonnet-4-20250514";
let totalInputTokens = 0;
let totalOutputTokens = 0;
const invalidJsonByFile = new Set<string>();

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRateLimitError(error: unknown): boolean {
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = (error as { status?: number }).status;
    if (status === 429) {
      return true;
    }
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return message.includes("429") || message.includes("rate limit");
  }

  return false;
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error));
}

function extractTextResponse(response: ClaudeMessage): string {
  const textParts: string[] = [];

  for (const block of response.content) {
    if (block.type === "text" && typeof block.text === "string") {
      textParts.push(block.text);
    }
  }

  return textParts.join("\n").trim();
}

function stripMarkdownFence(raw: string): string {
  const trimmed = raw.trim();
  const fencedMatch = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  if (fencedMatch) {
    const fencedContent = fencedMatch[1];
    if (typeof fencedContent === "string") {
      return fencedContent.trim();
    }
  }

  return trimmed;
}

function isValidSeverity(value: string): value is ReviewSeverity {
  return value === "error" || value === "warning" || value === "suggestion";
}

function isValidCategory(value: string): value is ReviewCategory {
  return (
    value === "security" ||
    value === "bug" ||
    value === "performance" ||
    value === "style" ||
    value === "maintainability"
  );
}

function parseClaudeComments(raw: string): ReviewComment[] {
  const normalized = stripMarkdownFence(raw);
  const parsed = JSON.parse(normalized) as unknown;

  if (!Array.isArray(parsed)) {
    throw new Error("Claude response was not a JSON array.");
  }

  const comments: ReviewComment[] = [];

  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }

    const candidate = entry as {
      line?: unknown;
      severity?: unknown;
      category?: unknown;
      title?: unknown;
      body?: unknown;
      suggestion?: unknown;
    };

    if (
      typeof candidate.line !== "number" ||
      !Number.isInteger(candidate.line) ||
      candidate.line <= 0
    ) {
      continue;
    }

    if (typeof candidate.severity !== "string" || !isValidSeverity(candidate.severity)) {
      continue;
    }

    if (typeof candidate.body !== "string" || candidate.body.trim().length === 0) {
      continue;
    }

    const category =
      typeof candidate.category === "string" && isValidCategory(candidate.category)
        ? candidate.category
        : "maintainability";

    const title =
      typeof candidate.title === "string" && candidate.title.trim().length > 0
        ? candidate.title.trim()
        : "Review feedback";

    const suggestion =
      typeof candidate.suggestion === "string" && candidate.suggestion.trim().length > 0
        ? candidate.suggestion
        : null;

    comments.push({
      line: candidate.line,
      severity: candidate.severity,
      category,
      title,
      body: candidate.body.trim(),
      suggestion,
    });
  }

  return comments;
}

function buildPromptFromLines(
  file: ParsedFile,
  addedLines: DiffLine[],
  chunkIndex?: number,
  chunkCount?: number
): string {
  const lines: string[] = [];
  lines.push(`File: ${file.filename}`);
  lines.push(`Language: ${file.language}`);
  lines.push(`Added lines: ${addedLines.length}`);

  if (typeof chunkIndex === "number" && typeof chunkCount === "number" && chunkCount > 1) {
    lines.push(`Chunk: ${chunkIndex + 1}/${chunkCount}`);
  }

  lines.push("Added code lines (line_number | code):");

  for (const line of addedLines) {
    lines.push(`${line.lineNumber} | ${line.content}`);
  }

  return lines.join("\n");
}

function chunkAddedLines(file: ParsedFile): DiffLine[][] {
  const addedLines = getAddedLines(file);
  const basePromptTokenCost = estimateTokens(buildPromptFromLines(file, []));

  const targetChunkTokens = Math.max(500, MODEL_MAX_DIFF_TOKENS - basePromptTokenCost);
  const chunks: DiffLine[][] = [];
  let currentChunk: DiffLine[] = [];
  let currentTokenCount = 0;

  for (const line of addedLines) {
    const lineTokenCost = estimateTokens(`${line.lineNumber} | ${line.content}`);

    if (currentChunk.length > 0 && currentTokenCount + lineTokenCost > targetChunkTokens) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentTokenCount = 0;
    }

    currentChunk.push(line);
    currentTokenCount += lineTokenCost;
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}

async function callClaudeWithRetry(level: ReviewLevel, prompt: string): Promise<ClaudeCallResult> {
  if (!aiClient) {
    throw new Error("AI client is not configured. Call configureAI() first.");
  }

  for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt += 1) {
    try {
      const response = (await aiClient.messages.create({
        model: aiModel,
        max_tokens: 2048,
        stream: false,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `Review level: ${level}\n\n${prompt}`,
          },
        ],
      })) as unknown as ClaudeMessage;

      const inputTokens = response.usage.input_tokens;
      const outputTokens = response.usage.output_tokens;
      const text = extractTextResponse(response);

      if (text.length === 0) {
        return {
          comments: [],
          invalidJson: false,
          inputTokens,
          outputTokens,
        };
      }

      try {
        const comments = parseClaudeComments(text);
        return {
          comments,
          invalidJson: false,
          inputTokens,
          outputTokens,
        };
      } catch (parseError) {
        const parseMessage = parseError instanceof Error ? parseError.message : String(parseError);
        core.warning(
          `Claude returned invalid JSON. The current file will be skipped. (${parseMessage})`
        );

        return {
          comments: [],
          invalidJson: true,
          inputTokens,
          outputTokens,
        };
      }
    } catch (error) {
      if (!isRateLimitError(error) || attempt === MAX_RETRY_ATTEMPTS) {
        throw normalizeError(error);
      }

      const delayMs = BASE_RETRY_DELAY_MS * 2 ** (attempt - 1);
      core.warning(
        `Claude rate limit hit (attempt ${attempt}/${MAX_RETRY_ATTEMPTS}). Retrying in ${delayMs}ms.`
      );
      await sleep(delayMs);
    }
  }

  throw new Error("Claude request failed after retries.");
}

function dedupeAndSortComments(comments: ReviewComment[]): ReviewComment[] {
  const deduped = new Map<string, ReviewComment>();

  for (const comment of comments) {
    const key = `${comment.line}|${comment.severity}|${comment.body}|${comment.suggestion ?? ""}`;
    if (!deduped.has(key)) {
      deduped.set(key, comment);
    }
  }

  return [...deduped.values()].sort((left, right) => left.line - right.line);
}

export function configureAI(config: AIClientConfig): void {
  aiClient = new Anthropic({ apiKey: config.apiKey });
  aiModel = config.model;
}

export function resetUsageCounters(): void {
  totalInputTokens = 0;
  totalOutputTokens = 0;
  invalidJsonByFile.clear();
}

export function getTokenUsage(): TokenUsage {
  return {
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    totalTokens: totalInputTokens + totalOutputTokens,
  };
}

export function estimateCost(usage: TokenUsage): string {
  const inputCost = (usage.inputTokens / 1_000_000) * 3;
  const outputCost = (usage.outputTokens / 1_000_000) * 15;
  const totalCost = inputCost + outputCost;
  return `$${totalCost.toFixed(4)}`;
}

export function consumeInvalidJsonFlag(filename: string): boolean {
  if (!invalidJsonByFile.has(filename)) {
    return false;
  }

  invalidJsonByFile.delete(filename);
  return true;
}

export async function reviewFile(file: ParsedFile, level: ReviewLevel): Promise<ReviewComment[]> {
  const addedLines = getAddedLines(file);
  if (addedLines.length === 0) {
    return [];
  }

  const singlePrompt = buildPromptFromLines(file, addedLines);
  const requiresChunking = estimateTokens(singlePrompt) > MODEL_MAX_DIFF_TOKENS;
  const lineChunks = requiresChunking ? chunkAddedLines(file) : [addedLines];

  if (requiresChunking) {
    core.info(
      `File ${file.filename} exceeds token budget, splitting into ${lineChunks.length} chunk(s).`
    );
  }

  const allComments: ReviewComment[] = [];

  for (let index = 0; index < lineChunks.length; index += 1) {
    const currentChunk = lineChunks[index];
    if (!currentChunk) {
      continue;
    }

    const prompt = buildPromptFromLines(file, currentChunk, index, lineChunks.length);

    const result = await callClaudeWithRetry(level, prompt);
    totalInputTokens += result.inputTokens;
    totalOutputTokens += result.outputTokens;

    if (result.invalidJson) {
      invalidJsonByFile.add(file.filename);
      return [];
    }

    allComments.push(...result.comments);
  }

  invalidJsonByFile.delete(file.filename);
  return dedupeAndSortComments(allComments);
}
