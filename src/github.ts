import * as core from "@actions/core";
import * as github from "@actions/github";
import { BOT_COMMENT_MARKER } from "./formatter.js";

export interface ChangedFileInfo {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
}

export interface GitHubReviewComment {
  path: string;
  line: number;
  side: "RIGHT";
  body: string;
}

type OctokitClient = ReturnType<typeof github.getOctokit>;

let octokitClient: OctokitClient | null = null;

function getOctokit(): OctokitClient {
  if (!octokitClient) {
    throw new Error("Octokit is not initialized. Call initOctokit() first.");
  }

  return octokitClient;
}

function isBotLogin(login: string | undefined): boolean {
  return typeof login === "string" && login.endsWith("[bot]");
}

export function initOctokit(token: string): void {
  octokitClient = github.getOctokit(token);
}

export async function getPRDiff(owner: string, repo: string, pullNumber: number): Promise<string> {
  const client = getOctokit();

  const response = await client.rest.pulls.get({
    owner,
    repo,
    pull_number: pullNumber,
    mediaType: {
      format: "diff",
    },
  });

  if (typeof response.data !== "string") {
    throw new Error("Failed to load pull request diff.");
  }

  return response.data;
}

export async function getChangedFiles(
  owner: string,
  repo: string,
  pullNumber: number
): Promise<ChangedFileInfo[]> {
  const client = getOctokit();
  const files = await client.paginate(client.rest.pulls.listFiles, {
    owner,
    repo,
    pull_number: pullNumber,
    per_page: 100,
  });

  return files.map((file) => {
    const changedFile: ChangedFileInfo = {
      filename: file.filename,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      changes: file.changes,
    };

    if (typeof file.patch === "string") {
      changedFile.patch = file.patch;
    }

    return changedFile;
  });
}

export async function createReviewWithComments(
  owner: string,
  repo: string,
  pullNumber: number,
  comments: GitHubReviewComment[],
  summary?: string
): Promise<void> {
  if (comments.length === 0 && !summary) {
    core.info("No inline comments or summary to post.");
    return;
  }

  const client = getOctokit();
  const pull = await client.rest.pulls.get({
    owner,
    repo,
    pull_number: pullNumber,
  });

  await client.rest.pulls.createReview({
    owner,
    repo,
    pull_number: pullNumber,
    commit_id: pull.data.head.sha,
    event: "COMMENT",
    body: summary ?? `${BOT_COMMENT_MARKER}\nAI Code Reviewer finished without summary output.`,
    comments: comments.map((comment) => ({
      path: comment.path,
      line: comment.line,
      side: comment.side,
      body: comment.body,
    })),
  });

  core.info(
    `Posted review with ${comments.length} inline comment(s)${summary ? " and summary" : ""}.`
  );
}

export async function deleteExistingBotComments(
  owner: string,
  repo: string,
  pullNumber: number
): Promise<number> {
  const client = getOctokit();

  let deleted = 0;

  const reviewComments = await client.paginate(client.rest.pulls.listReviewComments, {
    owner,
    repo,
    pull_number: pullNumber,
    per_page: 100,
  });

  for (const comment of reviewComments) {
    if (!isBotLogin(comment.user?.login)) {
      continue;
    }

    if (!comment.body?.includes(BOT_COMMENT_MARKER)) {
      continue;
    }

    await client.rest.pulls.deleteReviewComment({
      owner,
      repo,
      comment_id: comment.id,
    });
    deleted += 1;
  }

  const issueComments = await client.paginate(client.rest.issues.listComments, {
    owner,
    repo,
    issue_number: pullNumber,
    per_page: 100,
  });

  for (const comment of issueComments) {
    if (!isBotLogin(comment.user?.login)) {
      continue;
    }

    if (!comment.body?.includes(BOT_COMMENT_MARKER)) {
      continue;
    }

    await client.rest.issues.deleteComment({
      owner,
      repo,
      comment_id: comment.id,
    });
    deleted += 1;
  }

  return deleted;
}

export async function postIssueComment(
  owner: string,
  repo: string,
  pullNumber: number,
  body: string
): Promise<void> {
  const client = getOctokit();

  await client.rest.issues.createComment({
    owner,
    repo,
    issue_number: pullNumber,
    body,
  });
}
