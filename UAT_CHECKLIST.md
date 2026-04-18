# AI Code Reviewer UAT Checklist

This checklist validates real customer behavior on a live GitHub repository with actual pull requests.

## Prerequisites

- Repository has this action published and referenced in workflow.
- Workflow permissions include `pull-requests: write`.
- Secrets are configured:
  - `GITHUB_TOKEN` (auto-provided in actions runtime)
  - `ANTHROPIC_API_KEY`

## Test Matrix

1. **Happy path**
   - Create a PR with 1-3 TypeScript file changes.
   - Expect inline review comments on added lines only.
   - Expect summary comment with verdict and per-file table.
2. **No findings**
   - PR with safe, clean code changes.
   - Expect zero inline comments and summary verdict `Looks good`.
3. **Ignore patterns**
   - Change only files matching `ignore_patterns` (for example `README.md`).
   - Expect skipped-files notice listing ignored files.
4. **max_files limit**
   - PR with > `max_files` code files.
   - Expect only top `max_files` files reviewed by additions.
   - Expect skipped-files notice for overflow files.
5. **Large PR guard**
   - PR with > 50 files.
   - Expect large PR warning comment.
   - Expect review scope limited and deterministic.
6. **Rerun safety**
   - Re-run workflow on the same PR.
   - Expect previous bot comments removed before new review appears.
7. **Malformed AI response resilience**
   - Temporarily use a bad model value or force malformed response in a test branch.
   - Expect workflow not to crash.
   - Expect file skipped with warning path, run completes.
8. **Permission failure**
   - Temporarily remove `pull-requests: write`.
   - Expect explicit failure via `core.setFailed` with actionable message.

## Acceptance Criteria

- Action never comments on removed lines.
- Inline comments always target valid added lines.
- Run completes with deterministic summary logs.
- No duplicate bot comments after reruns.
- Failures are explicit and non-ambiguous.

## Evidence to Capture

- Workflow run URL per scenario.
- Screenshot of PR conversation/comments.
- Summary of findings and final pass/fail per scenario.
