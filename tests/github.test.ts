import { beforeEach, describe, expect, it, vi } from "vitest";

const coreInfo = vi.fn();

const state = vi.hoisted(() => ({
  pullsGetResponse: { data: "raw diff" } as unknown,
  listFilesResponse: [
    {
      filename: "src/app.ts",
      status: "modified",
      additions: 3,
      deletions: 1,
      changes: 4,
      patch: "@@ -1,1 +1,2 @@",
    },
    {
      filename: "README.md",
      status: "modified",
      additions: 1,
      deletions: 0,
      changes: 1,
    },
  ] as Array<Record<string, unknown>>,
  reviewCommentsResponse: [] as Array<Record<string, unknown>>,
  issueCommentsResponse: [] as Array<Record<string, unknown>>,
}));

const pullsGet = vi.fn(async () => state.pullsGetResponse);
const pullsCreateReview = vi.fn(async () => ({ data: { id: 1 } }));
const pullsDeleteReviewComment = vi.fn(async () => ({ data: {} }));
const pullsListFiles = vi.fn();
const pullsListReviewComments = vi.fn();
const issuesCreateComment = vi.fn(async () => ({ data: { id: 2 } }));
const issuesDeleteComment = vi.fn(async () => ({ data: {} }));
const issuesListComments = vi.fn();

const paginate = vi.fn(async (method: unknown) => {
  if (method === pullsListFiles) {
    return state.listFilesResponse;
  }

  if (method === pullsListReviewComments) {
    return state.reviewCommentsResponse;
  }

  if (method === issuesListComments) {
    return state.issueCommentsResponse;
  }

  return [];
});

const octokit = {
  rest: {
    pulls: {
      get: pullsGet,
      createReview: pullsCreateReview,
      deleteReviewComment: pullsDeleteReviewComment,
      listFiles: pullsListFiles,
      listReviewComments: pullsListReviewComments,
    },
    issues: {
      createComment: issuesCreateComment,
      deleteComment: issuesDeleteComment,
      listComments: issuesListComments,
    },
  },
  paginate,
};

vi.mock("@actions/core", () => ({
  info: coreInfo,
}));

vi.mock("@actions/github", () => ({
  getOctokit: vi.fn(() => octokit),
}));

const {
  createReviewWithComments,
  deleteExistingBotComments,
  getChangedFiles,
  getPRDiff,
  initOctokit,
  postIssueComment,
} = await import("../src/github.js");

describe("github helpers", () => {
  beforeEach(() => {
    coreInfo.mockReset();
    pullsGet.mockClear();
    pullsCreateReview.mockClear();
    pullsDeleteReviewComment.mockClear();
    issuesCreateComment.mockClear();
    issuesDeleteComment.mockClear();
    paginate.mockClear();

    state.pullsGetResponse = { data: "raw diff" };
    state.listFilesResponse = [
      {
        filename: "src/app.ts",
        status: "modified",
        additions: 3,
        deletions: 1,
        changes: 4,
        patch: "@@ -1,1 +1,2 @@",
      },
      {
        filename: "README.md",
        status: "modified",
        additions: 1,
        deletions: 0,
        changes: 1,
      },
    ];
    state.reviewCommentsResponse = [];
    state.issueCommentsResponse = [];

    initOctokit("gh-token");
  });

  it("returns the raw PR diff when GitHub responds with a string", async () => {
    await expect(getPRDiff("acme", "repo", 1)).resolves.toBe("raw diff");
  });

  it("throws when PR diff response is not a string", async () => {
    state.pullsGetResponse = { data: { unexpected: true } };

    await expect(getPRDiff("acme", "repo", 1)).rejects.toThrow("Failed to load pull request diff.");
  });

  it("maps changed files and preserves optional patches", async () => {
    const files = await getChangedFiles("acme", "repo", 1);

    expect(files).toEqual([
      {
        filename: "src/app.ts",
        status: "modified",
        additions: 3,
        deletions: 1,
        changes: 4,
        patch: "@@ -1,1 +1,2 @@",
      },
      {
        filename: "README.md",
        status: "modified",
        additions: 1,
        deletions: 0,
        changes: 1,
      },
    ]);
  });

  it("skips review creation when there is nothing to post", async () => {
    await createReviewWithComments("acme", "repo", 1, []);

    expect(pullsCreateReview).not.toHaveBeenCalled();
    expect(coreInfo).toHaveBeenCalledWith("No inline comments or summary to post.");
  });

  it("creates a review with inline comments and summary", async () => {
    state.pullsGetResponse = { data: { head: { sha: "commit-sha" } } };

    await createReviewWithComments(
      "acme",
      "repo",
      1,
      [{ path: "src/app.ts", line: 5, side: "RIGHT", body: "comment body" }],
      "summary body"
    );

    expect(pullsCreateReview).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "acme",
        repo: "repo",
        pull_number: 1,
        commit_id: "commit-sha",
        event: "COMMENT",
        body: "summary body",
      })
    );
  });

  it("deletes only bot comments marked by this action", async () => {
    state.reviewCommentsResponse = [
      {
        id: 10,
        body: "<!-- ai-code-reviewer --> stale review",
        user: { login: "github-actions[bot]" },
      },
      {
        id: 11,
        body: "human comment",
        user: { login: "dev-user" },
      },
      {
        id: 12,
        body: "bot comment without marker",
        user: { login: "github-actions[bot]" },
      },
    ];
    state.issueCommentsResponse = [
      {
        id: 20,
        body: "<!-- ai-code-reviewer --> stale issue",
        user: { login: "github-actions[bot]" },
      },
      {
        id: 21,
        body: "<!-- ai-code-reviewer --> human issue",
        user: { login: "dev-user" },
      },
    ];

    const deletedCount = await deleteExistingBotComments("acme", "repo", 1);

    expect(deletedCount).toBe(2);
    expect(pullsDeleteReviewComment).toHaveBeenCalledTimes(1);
    expect(issuesDeleteComment).toHaveBeenCalledTimes(1);
  });

  it("posts a standalone issue comment", async () => {
    await postIssueComment("acme", "repo", 1, "hello");

    expect(issuesCreateComment).toHaveBeenCalledWith({
      owner: "acme",
      repo: "repo",
      issue_number: 1,
      body: "hello",
    });
  });
});
