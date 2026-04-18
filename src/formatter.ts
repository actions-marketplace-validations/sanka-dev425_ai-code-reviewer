import type { ReviewComment } from "./ai.js";

export interface FileReviewResult {
  filename: string;
  comments: ReviewComment[];
  errors: number;
  warnings: number;
  suggestions: number;
  skipped: boolean;
  skipReason?: string;
}

export const BOT_COMMENT_MARKER = "<!-- ai-code-reviewer -->";

const SEVERITY_BADGES: Record<ReviewComment["severity"], string> = {
  error: "🔴 Error",
  warning: "🟡 Warning",
  suggestion: "🔵 Suggestion",
};

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, "\\|");
}

export function formatComment(comment: ReviewComment): string {
  const lines: string[] = [];

  lines.push(BOT_COMMENT_MARKER);
  lines.push(`[${SEVERITY_BADGES[comment.severity]}]`);
  lines.push("");

  const headerParts: string[] = [];
  if (comment.title.trim().length > 0) {
    headerParts.push(`**${comment.title.trim()}**`);
  }
  if (comment.category) {
    headerParts.push(`\`${comment.category}\``);
  }

  if (headerParts.length > 0) {
    lines.push(headerParts.join(" "));
    lines.push("");
  }

  lines.push(comment.body.trim());

  if (comment.suggestion && comment.suggestion.trim().length > 0) {
    lines.push("");
    lines.push("```suggestion");
    lines.push(comment.suggestion);
    lines.push("```");
  }

  return lines.join("\n").trimEnd();
}

function calculateVerdict(
  results: FileReviewResult[]
): "✅ Looks good" | "⚠️ Needs attention" | "🚫 Do not merge" {
  const reviewedFiles = results.filter((result) => !result.skipped);
  const totalErrors = reviewedFiles.reduce((count, result) => count + result.errors, 0);
  const totalWarnings = reviewedFiles.reduce((count, result) => count + result.warnings, 0);
  const totalSuggestions = reviewedFiles.reduce((count, result) => count + result.suggestions, 0);

  if (totalErrors > 0) {
    return "🚫 Do not merge";
  }

  if (totalWarnings > 0 || totalSuggestions > 0) {
    return "⚠️ Needs attention";
  }

  return "✅ Looks good";
}

export function formatSummary(results: FileReviewResult[]): string {
  const reviewedFiles = results.filter((result) => !result.skipped);

  const lines: string[] = [];
  lines.push(BOT_COMMENT_MARKER);
  lines.push("## AI Code Review Summary");
  lines.push("");
  lines.push("| File | Errors | Warnings | Suggestions |");
  lines.push("| --- | ---: | ---: | ---: |");

  let totalErrors = 0;
  let totalWarnings = 0;
  let totalSuggestions = 0;

  if (reviewedFiles.length === 0) {
    lines.push("| _No reviewed files_ | 0 | 0 | 0 |");
  } else {
    for (const result of reviewedFiles) {
      totalErrors += result.errors;
      totalWarnings += result.warnings;
      totalSuggestions += result.suggestions;

      lines.push(
        `| ${escapeTableCell(result.filename)} | ${result.errors} | ${result.warnings} | ${result.suggestions} |`
      );
    }
  }

  lines.push(`| **Total** | **${totalErrors}** | **${totalWarnings}** | **${totalSuggestions}** |`);
  lines.push("");
  lines.push(`**Overall verdict:** ${calculateVerdict(results)}`);

  return lines.join("\n");
}

export function formatSkippedNotice(
  skippedFiles: Array<{ filename: string; reason: string }>,
  totalFiles: number
): string {
  const lines: string[] = [];

  lines.push(BOT_COMMENT_MARKER);
  lines.push("## Skipped Files");
  lines.push("");
  lines.push(`The action inspected ${totalFiles} changed file(s). These files were skipped:`);
  lines.push("");

  for (const skipped of skippedFiles) {
    lines.push(`- \`${skipped.filename}\`: ${skipped.reason}`);
  }

  return lines.join("\n");
}

export function formatPRSizeWarning(totalFiles: number, maxFiles: number): string {
  return [
    BOT_COMMENT_MARKER,
    "## Large PR Warning",
    "",
    `This pull request has **${totalFiles}** files changed.`,
    `Only the first **${maxFiles}** files (sorted by additions) will be reviewed.`,
  ].join("\n");
}
