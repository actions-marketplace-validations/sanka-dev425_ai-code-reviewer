import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => {
  const state = {
    inputMap: {
      github_token: "ghs_test",
      anthropic_api_key: "ant_test",
      model: "claude-sonnet-4-20250514",
      review_level: "standard",
      ignore_patterns: "*.md,*.lock,*.json,dist/**",
      max_files: "1",
      post_summary: "true",
    } as Record<string, string>,
    context: {
      repo: {
        owner: "acme",
        repo: "service",
      },
      payload: {
        pull_request: {
          number: 42,
        },
      },
    } as {
      repo: { owner: string; repo: string };
      payload: { pull_request?: { number: number } };
    },
    changedFiles: [] as Array<{
      filename: string;
      status: string;
      additions: number;
      deletions: number;
      changes: number;
      patch?: string;
    }>,
    reviewComments: [] as Array<{
      id: number;
      body?: string;
      user?: { login?: string };
    }>,
    issueComments: [] as Array<{
      id: number;
      body?: string;
      user?: { login?: string };
    }>,
    rawDiff: "",
    claudeText: "[]",
    createdReviews: [] as unknown[],
    postedIssueComments: [] as unknown[],
  };

  const core = {
    info: vi.fn(),
    warning: vi.fn(),
    debug: vi.fn(),
    setFailed: vi.fn(),
    setSecret: vi.fn(),
    getInput: vi.fn((name: string, options?: { required?: boolean }) => {
      const value = state.inputMap[name] ?? "";
      if (options?.required && value.length === 0) {
        throw new Error(`Missing required input: ${name}`);
      }
      return value;
    }),
  };

  const pullsGet = vi.fn(async (params: { mediaType?: { format?: string } }) => {
    if (params.mediaType?.format === "diff") {
      return { data: state.rawDiff };
    }

    return {
      data: {
        head: {
          sha: "commit-sha-123",
        },
      },
    };
  });

  const pullsListFiles = vi.fn();
  const pullsListReviewComments = vi.fn();
  const pullsDeleteReviewComment = vi.fn(async () => ({ data: {} }));
  const pullsCreateReview = vi.fn(async (params: unknown) => {
    state.createdReviews.push(params);
    return { data: { id: 1 } };
  });

  const issuesListComments = vi.fn();
  const issuesDeleteComment = vi.fn(async () => ({ data: {} }));
  const issuesCreateComment = vi.fn(async (params: unknown) => {
    state.postedIssueComments.push(params);
    return { data: { id: 1 } };
  });

  const paginate = vi.fn(async (method: unknown) => {
    if (method === pullsListFiles) {
      return state.changedFiles;
    }

    if (method === pullsListReviewComments) {
      return state.reviewComments;
    }

    if (method === issuesListComments) {
      return state.issueComments;
    }

    return [];
  });

  const octokit = {
    rest: {
      pulls: {
        get: pullsGet,
        listFiles: pullsListFiles,
        listReviewComments: pullsListReviewComments,
        deleteReviewComment: pullsDeleteReviewComment,
        createReview: pullsCreateReview,
      },
      issues: {
        listComments: issuesListComments,
        deleteComment: issuesDeleteComment,
        createComment: issuesCreateComment,
      },
    },
    paginate,
  };

  const getOctokit = vi.fn(() => octokit);

  const anthropicCreate = vi.fn(async () => ({
    content: [{ type: "text", text: state.claudeText }],
    usage: { input_tokens: 100, output_tokens: 20 },
  }));

  return {
    state,
    core,
    pullsGet,
    pullsDeleteReviewComment,
    pullsCreateReview,
    issuesDeleteComment,
    issuesCreateComment,
    getOctokit,
    anthropicCreate,
  };
});

vi.mock("@actions/core", () => harness.core);

vi.mock("@actions/github", () => ({
  context: harness.state.context,
  getOctokit: harness.getOctokit,
}));

vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class MockAnthropic {
      public messages = {
        create: harness.anthropicCreate,
      };

      public constructor(_config: { apiKey: string }) {}
    },
  };
});

const { run } = await import("../src/index.js");

const SAMPLE_DIFF = `diff --git a/src/app.ts b/src/app.ts
index 1111111..2222222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,1 +1,2 @@
 const app = createServer();
+const sql = \`SELECT * FROM users WHERE id = ${"${req.query.id}"}\`;
`;

function makeSimpleTsDiff(filename: string, value: number): string {
  return `diff --git a/${filename} b/${filename}
index 1111111..2222222 100644
--- a/${filename}
+++ b/${filename}
@@ -1,1 +1,2 @@
 export const base = 1;
+export const updated = ${value};
`;
}

function resetHarnessState(): void {
  harness.core.info.mockReset();
  harness.core.warning.mockReset();
  harness.core.debug.mockReset();
  harness.core.setFailed.mockReset();
  harness.core.setSecret.mockReset();
  harness.core.getInput.mockClear();

  harness.getOctokit.mockClear();
  harness.pullsGet.mockClear();
  harness.pullsDeleteReviewComment.mockClear();
  harness.pullsCreateReview.mockClear();
  harness.issuesDeleteComment.mockClear();
  harness.issuesCreateComment.mockClear();
  harness.anthropicCreate.mockClear();

  harness.state.context.repo.owner = "acme";
  harness.state.context.repo.repo = "service";
  harness.state.context.payload = { pull_request: { number: 42 } };

  harness.state.changedFiles = [
    {
      filename: "src/app.ts",
      status: "modified",
      additions: 1,
      deletions: 0,
      changes: 1,
      patch: "@@ -1,1 +1,2 @@",
    },
  ];

  harness.state.reviewComments = [];
  harness.state.issueComments = [];
  harness.state.rawDiff = SAMPLE_DIFF;
  harness.state.claudeText = JSON.stringify([
    {
      line: 2,
      severity: "warning",
      category: "security",
      title: "SQL injection risk",
      body: "Request input reaches raw SQL without parameterization.",
      suggestion: null,
    },
  ]);

  harness.state.createdReviews = [];
  harness.state.postedIssueComments = [];

  harness.state.inputMap.max_files = "1";
  harness.state.inputMap.post_summary = "true";
}

describe("action smoke harness", () => {
  beforeEach(() => {
    resetHarnessState();
  });

  it("runs end-to-end with mocked GitHub and Claude contracts", async () => {
    harness.state.reviewComments = [
      {
        id: 101,
        body: "<!-- ai-code-reviewer --> previous review",
        user: { login: "github-actions[bot]" },
      },
    ];

    harness.state.issueComments = [
      {
        id: 202,
        body: "<!-- ai-code-reviewer --> previous issue note",
        user: { login: "github-actions[bot]" },
      },
    ];

    await run();

    expect(harness.core.setFailed).not.toHaveBeenCalled();
    expect(harness.pullsDeleteReviewComment).toHaveBeenCalledTimes(1);
    expect(harness.issuesDeleteComment).toHaveBeenCalledTimes(1);
    expect(harness.pullsCreateReview).toHaveBeenCalledTimes(1);

    const reviewPayload = harness.state.createdReviews[0] as {
      comments: Array<{ path: string; line: number; side: string }>;
      event: string;
      body: string;
    };

    expect(reviewPayload.event).toBe("COMMENT");
    expect(reviewPayload.comments).toHaveLength(1);
    expect(reviewPayload.comments[0]).toMatchObject({
      path: "src/app.ts",
      line: 2,
      side: "RIGHT",
    });
    expect(reviewPayload.body).toContain("AI Code Review Summary");
    expect(harness.issuesCreateComment).not.toHaveBeenCalled();
  });

  it("posts skipped-files notice when Claude returns malformed JSON", async () => {
    harness.state.claudeText = "not valid json";

    await run();

    expect(harness.core.setFailed).not.toHaveBeenCalled();
    expect(harness.pullsCreateReview).toHaveBeenCalledTimes(1);
    expect(harness.issuesCreateComment).toHaveBeenCalledTimes(1);

    const skippedNotice = harness.state.postedIssueComments[0] as { body: string };
    expect(skippedNotice.body).toContain("Skipped Files");
    expect(skippedNotice.body).toContain("Claude returned invalid JSON");
  });

  it("fails cleanly when event is not pull_request", async () => {
    harness.state.context.payload = {};

    await run();

    expect(harness.core.setFailed).toHaveBeenCalledWith(
      "This action can only run on pull_request events."
    );
    expect(harness.getOctokit).not.toHaveBeenCalled();
  });

  it("handles large PR guard and posts warning plus skipped-file notice", async () => {
    harness.state.inputMap.max_files = "2";
    harness.state.claudeText = "[]";

    harness.state.changedFiles = Array.from({ length: 51 }, (_, index) => ({
      filename: `src/file-${index}.ts`,
      status: "modified",
      additions: 100 - index,
      deletions: 0,
      changes: 1,
      patch: "@@ -1,1 +1,2 @@",
    }));

    harness.state.rawDiff = [
      makeSimpleTsDiff("src/file-0.ts", 0),
      makeSimpleTsDiff("src/file-1.ts", 1),
    ].join("\n");

    await run();

    expect(harness.core.setFailed).not.toHaveBeenCalled();
    expect(harness.pullsCreateReview).toHaveBeenCalledTimes(1);
    expect(harness.issuesCreateComment).toHaveBeenCalledTimes(2);
    expect(harness.state.postedIssueComments[0]).toMatchObject({
      body: expect.stringContaining("Large PR Warning"),
    });
    expect(harness.state.postedIssueComments[1]).toMatchObject({
      body: expect.stringContaining("Skipped Files"),
    });
  });

  it("exits cleanly when no files changed", async () => {
    harness.state.changedFiles = [];

    await run();

    expect(harness.core.setFailed).not.toHaveBeenCalled();
    expect(harness.pullsCreateReview).not.toHaveBeenCalled();
    expect(harness.issuesCreateComment).not.toHaveBeenCalled();
    expect(harness.core.info).toHaveBeenCalledWith("No changed files found in this pull request.");
  });
});
