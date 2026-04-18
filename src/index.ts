import * as core from "@actions/core";
import * as github from "@actions/github";
import { configureAI, estimateCost, getTokenUsage, resetUsageCounters } from "./ai.js";
import { loadConfig } from "./config.js";
import {
  formatPRSizeWarning,
  formatSkippedNotice,
  formatSummary,
  type FileReviewResult,
} from "./formatter.js";
import {
  createReviewWithComments,
  deleteExistingBotComments,
  getChangedFiles,
  getPRDiff,
  initOctokit,
  postIssueComment,
} from "./github.js";
import { parseDiff, type ParsedFile } from "./parser.js";
import { orchestrateReview, type SkippedFile } from "./reviewer.js";

const LARGE_PR_THRESHOLD = 50;

function createSkippedResult(file: SkippedFile): FileReviewResult {
  return {
    filename: file.filename,
    comments: [],
    errors: 0,
    warnings: 0,
    suggestions: 0,
    skipped: true,
    skipReason: file.reason,
  };
}

export async function run(): Promise<void> {
  try {
    const config = loadConfig();

    if (!github.context.payload.pull_request) {
      core.setFailed("This action can only run on pull_request events.");
      return;
    }

    const owner = github.context.repo.owner;
    const repo = github.context.repo.repo;
    const pullNumber = github.context.payload.pull_request.number;

    initOctokit(config.githubToken);
    configureAI({
      apiKey: config.anthropicApiKey,
      model: config.model,
    });
    resetUsageCounters();

    const deletedComments = await deleteExistingBotComments(owner, repo, pullNumber);
    core.info(`Deleted ${deletedComments} existing bot comment(s).`);

    const changedFiles = await getChangedFiles(owner, repo, pullNumber);
    if (changedFiles.length === 0) {
      core.info("No changed files found in this pull request.");
      return;
    }

    const filesByAdditions = [...changedFiles].sort(
      (left, right) => right.additions - left.additions
    );

    if (filesByAdditions.length > LARGE_PR_THRESHOLD) {
      await postIssueComment(
        owner,
        repo,
        pullNumber,
        formatPRSizeWarning(filesByAdditions.length, config.maxFiles)
      );
    }

    const rawDiff = await getPRDiff(owner, repo, pullNumber);
    const parsedFiles = parseDiff(rawDiff);
    const parsedByFilename = new Map<string, ParsedFile>(
      parsedFiles.map((file) => [file.filename, file])
    );

    let selectedFiles = filesByAdditions;
    const preSkippedFiles: SkippedFile[] = [];

    if (filesByAdditions.length > LARGE_PR_THRESHOLD) {
      const overflowFiles = filesByAdditions.slice(config.maxFiles);
      for (const overflowFile of overflowFiles) {
        preSkippedFiles.push({
          filename: overflowFile.filename,
          reason: `Exceeded max_files limit (${config.maxFiles}) due PR size guard`,
        });
      }

      selectedFiles = filesByAdditions.slice(0, config.maxFiles);
    }

    const orderedParsedFiles: ParsedFile[] = [];
    for (const changedFile of selectedFiles) {
      const parsed = parsedByFilename.get(changedFile.filename);
      if (!parsed) {
        continue;
      }
      orderedParsedFiles.push(parsed);
    }

    const review = await orchestrateReview(orderedParsedFiles, config);

    const allSkippedFiles = [...preSkippedFiles, ...review.skippedFiles];
    const summaryResults: FileReviewResult[] = [
      ...review.results,
      ...preSkippedFiles.map(createSkippedResult),
    ];

    const reviewSummary = config.postSummary ? formatSummary(summaryResults) : undefined;

    await createReviewWithComments(owner, repo, pullNumber, review.comments, reviewSummary);

    const skippedForNotice = allSkippedFiles.filter(
      (file) =>
        file.reason.includes("ignore_patterns") ||
        file.reason.includes("max_files") ||
        file.reason.includes("invalid JSON")
    );

    if (skippedForNotice.length > 0) {
      await postIssueComment(
        owner,
        repo,
        pullNumber,
        formatSkippedNotice(skippedForNotice, filesByAdditions.length)
      );
    }

    const tokenUsage = getTokenUsage();
    core.info(
      `Estimated Claude token usage: input=${tokenUsage.inputTokens}, output=${tokenUsage.outputTokens}, total=${tokenUsage.totalTokens}, estimated_cost=${estimateCost(tokenUsage)}`
    );

    core.info(
      `Review complete. Files reviewed: ${review.reviewedCount}. Files skipped: ${allSkippedFiles.length}. Inline comments: ${review.comments.length}.`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    core.setFailed(`AI Code Reviewer failed: ${message}`);
  }
}

if (process.env.NODE_ENV !== "test") {
  void run();
}
