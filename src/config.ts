import * as core from "@actions/core";

export type ReviewLevel = "quick" | "standard" | "deep";

export interface ActionConfig {
  githubToken: string;
  anthropicApiKey: string;
  model: string;
  reviewLevel: ReviewLevel;
  ignorePatterns: string[];
  maxFiles: number;
  postSummary: boolean;
}

const DEFAULT_MODEL = "claude-sonnet-4-20250514";
const DEFAULT_REVIEW_LEVEL: ReviewLevel = "standard";
const DEFAULT_IGNORE_PATTERNS = "*.md,*.lock,*.json,dist/**";
const DEFAULT_MAX_FILES = 20;

function isReviewLevel(value: string): value is ReviewLevel {
  return value === "quick" || value === "standard" || value === "deep";
}

function parseBooleanInput(value: string, inputName: string): boolean {
  const normalized = value.trim().toLowerCase();

  if (normalized === "true") {
    return true;
  }

  if (normalized === "false") {
    return false;
  }

  throw new Error(`Invalid ${inputName} value "${value}". Expected "true" or "false".`);
}

export function loadConfig(): ActionConfig {
  const githubToken = core.getInput("github_token", { required: true });
  const anthropicApiKey = core.getInput("anthropic_api_key", {
    required: true,
  });

  const model = core.getInput("model") || DEFAULT_MODEL;

  const reviewLevelInput = core.getInput("review_level") || DEFAULT_REVIEW_LEVEL;
  if (!isReviewLevel(reviewLevelInput)) {
    throw new Error(`Invalid review_level "${reviewLevelInput}". Use quick, standard, or deep.`);
  }

  const ignorePatternInput = core.getInput("ignore_patterns") || DEFAULT_IGNORE_PATTERNS;
  const ignorePatterns = ignorePatternInput
    .split(",")
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern.length > 0);

  const maxFilesInput = core.getInput("max_files") || `${DEFAULT_MAX_FILES}`;
  const maxFiles = Number.parseInt(maxFilesInput, 10);
  if (!Number.isInteger(maxFiles) || maxFiles <= 0) {
    throw new Error(`Invalid max_files "${maxFilesInput}". Use a positive integer.`);
  }

  const postSummaryInput = core.getInput("post_summary") || "true";
  const postSummary = parseBooleanInput(postSummaryInput, "post_summary");

  core.setSecret(githubToken);
  core.setSecret(anthropicApiKey);

  return {
    githubToken,
    anthropicApiKey,
    model,
    reviewLevel: reviewLevelInput,
    ignorePatterns,
    maxFiles,
    postSummary,
  };
}
