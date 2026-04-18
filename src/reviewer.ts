import * as core from "@actions/core";
import { minimatch } from "minimatch";
import { consumeInvalidJsonFlag, reviewFile, type ReviewComment } from "./ai.js";
import type { ActionConfig } from "./config.js";
import { formatComment, type FileReviewResult } from "./formatter.js";
import type { GitHubReviewComment } from "./github.js";
import { getAddedLines, type ParsedFile } from "./parser.js";

export interface SkippedFile {
  filename: string;
  reason: string;
}

export interface ReviewOrchestrationResult {
  results: FileReviewResult[];
  comments: GitHubReviewComment[];
  skippedFiles: SkippedFile[];
  reviewedCount: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function shouldIgnoreFile(filename: string, ignorePatterns: string[]): boolean {
  return ignorePatterns.some((pattern) =>
    minimatch(filename, pattern, {
      dot: true,
      matchBase: true,
    })
  );
}

function summarizeComments(comments: ReviewComment[]): {
  errors: number;
  warnings: number;
  suggestions: number;
} {
  let errors = 0;
  let warnings = 0;
  let suggestions = 0;

  for (const comment of comments) {
    if (comment.severity === "error") {
      errors += 1;
      continue;
    }

    if (comment.severity === "warning") {
      warnings += 1;
      continue;
    }

    suggestions += 1;
  }

  return { errors, warnings, suggestions };
}

export async function orchestrateReview(
  files: ParsedFile[],
  config: ActionConfig
): Promise<ReviewOrchestrationResult> {
  const sortedFiles = [...files].sort((left, right) => right.additions - left.additions);

  const results: FileReviewResult[] = [];
  const comments: GitHubReviewComment[] = [];
  const skippedFiles: SkippedFile[] = [];

  let reviewedCount = 0;
  let reviewSlotsUsed = 0;

  for (const file of sortedFiles) {
    if (shouldIgnoreFile(file.filename, config.ignorePatterns)) {
      const reason = "Matched ignore_patterns";
      skippedFiles.push({ filename: file.filename, reason });
      results.push({
        filename: file.filename,
        comments: [],
        errors: 0,
        warnings: 0,
        suggestions: 0,
        skipped: true,
        skipReason: reason,
      });
      continue;
    }

    if (reviewSlotsUsed >= config.maxFiles) {
      const reason = `Exceeded max_files limit (${config.maxFiles})`;
      skippedFiles.push({ filename: file.filename, reason });
      results.push({
        filename: file.filename,
        comments: [],
        errors: 0,
        warnings: 0,
        suggestions: 0,
        skipped: true,
        skipReason: reason,
      });
      continue;
    }

    const addedLineNumbers = new Set(getAddedLines(file).map((line) => line.lineNumber));
    if (addedLineNumbers.size === 0) {
      const reason = "No added lines to review";
      skippedFiles.push({ filename: file.filename, reason });
      results.push({
        filename: file.filename,
        comments: [],
        errors: 0,
        warnings: 0,
        suggestions: 0,
        skipped: true,
        skipReason: reason,
      });
      continue;
    }

    reviewSlotsUsed += 1;
    core.info(`Reviewing ${file.filename} (${reviewSlotsUsed}/${config.maxFiles})`);

    let aiComments: ReviewComment[] = [];

    try {
      aiComments = await reviewFile(file, config.reviewLevel);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const reason = `AI request failed: ${message}`;
      core.warning(`Skipping ${file.filename}. ${reason}`);

      skippedFiles.push({ filename: file.filename, reason });
      results.push({
        filename: file.filename,
        comments: [],
        errors: 0,
        warnings: 0,
        suggestions: 0,
        skipped: true,
        skipReason: reason,
      });

      if (reviewSlotsUsed < config.maxFiles) {
        await sleep(500);
      }
      continue;
    }

    if (consumeInvalidJsonFlag(file.filename)) {
      const reason = "Claude returned invalid JSON";
      skippedFiles.push({ filename: file.filename, reason });
      results.push({
        filename: file.filename,
        comments: [],
        errors: 0,
        warnings: 0,
        suggestions: 0,
        skipped: true,
        skipReason: reason,
      });

      if (reviewSlotsUsed < config.maxFiles) {
        await sleep(500);
      }
      continue;
    }

    const validComments: ReviewComment[] = [];
    for (const comment of aiComments) {
      if (!addedLineNumbers.has(comment.line)) {
        core.warning(
          `Ignoring AI comment for ${file.filename}:${comment.line}; line is not an added line.`
        );
        continue;
      }
      validComments.push(comment);
    }

    const counts = summarizeComments(validComments);

    for (const comment of validComments) {
      comments.push({
        path: file.filename,
        line: comment.line,
        side: "RIGHT",
        body: formatComment(comment),
      });
    }

    results.push({
      filename: file.filename,
      comments: validComments,
      errors: counts.errors,
      warnings: counts.warnings,
      suggestions: counts.suggestions,
      skipped: false,
    });

    reviewedCount += 1;

    if (reviewSlotsUsed < config.maxFiles) {
      await sleep(500);
    }
  }

  return {
    results,
    comments,
    skippedFiles,
    reviewedCount,
  };
}
