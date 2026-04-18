# AI Code Reviewer

Production-ready GitHub Action that reviews pull requests with Anthropic Claude and posts inline review comments directly on changed lines.

It is built for real CI/CD use with strict TypeScript, retries, graceful failure behavior, re-run safety, and test coverage gates.

## What You Get

- Inline PR review comments on exact changed lines via GitHub Review API.
- Configurable review depth: `quick`, `standard`, or `deep`.
- Security-first review priorities in prompt strategy.
- Skip controls with glob patterns and max-file limits.
- Re-run safety by deleting previous bot review comments.
- Large PR guardrails with controlled file sampling.
- Summary reporting with merge verdict and issue counts.
- Cost visibility via estimated token usage logs.

## Quick Start

Create `.github/workflows/ai-review.yml`:

```yaml
name: AI Code Review
on:
  pull_request:
    types: [opened, synchronize]

jobs:
  review:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      - uses: sanka-dev425/ai-code-reviewer@v1
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          review_level: standard
          ignore_patterns: "*.md,*.lock,dist/**"
          max_files: "15"
          post_summary: "true"
```

## Required Secrets

- `GITHUB_TOKEN`: auto-provided by GitHub Actions.
- `ANTHROPIC_API_KEY`: create in Anthropic Console and add to repository secrets.

## Inputs

| Input               | Required | Default                      | Description                                                  |
| ------------------- | -------- | ---------------------------- | ------------------------------------------------------------ |
| `github_token`      | Yes      | -                            | Token used for fetching PR data and posting review comments. |
| `anthropic_api_key` | Yes      | -                            | API key for Claude review calls.                             |
| `model`             | No       | `claude-sonnet-4-20250514`   | Claude model ID.                                             |
| `review_level`      | No       | `standard`                   | `quick`, `standard`, or `deep`.                              |
| `ignore_patterns`   | No       | `*.md,*.lock,*.json,dist/**` | Comma-separated glob patterns to skip.                       |
| `max_files`         | No       | `20`                         | Maximum files reviewed per PR.                               |
| `post_summary`      | No       | `true`                       | Post one overall review summary comment.                     |

## Review Levels

- `quick`: only critical bugs and errors.
- `standard`: errors, warnings, perf and security concerns.
- `deep`: everything in standard plus architecture and maintainability suggestions.

## Production Behaviors

- Added lines only: removed/context lines are never reviewed.
- 500ms inter-file delay to reduce GitHub API pressure.
- Automatic retry with exponential backoff for Claude rate-limit responses.
- Invalid AI JSON is skipped safely for that file without failing the whole run.
- PR size guard:
  if PR has over `50` files, action posts a warning and reviews only the top files by additions (up to `max_files`).
- Skipped-files notice:
  one comment lists files skipped by ignore patterns or file limit.

## Output Format

- Inline comments include severity badges:
  `Error`, `Warning`, `Suggestion`.
- Optional summary table:
  per-file counts for errors, warnings, suggestions.
- Verdict:
  `Looks good`, `Needs attention`, or `Do not merge`.

## Local Development

```bash
npm install
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run test:coverage
npm run build
npm audit --audit-level=high
```

## Full Quality Gate

Run the same consolidated gate before release:

```bash
npm run check
```

For final manual production validation on real pull requests, use [UAT_CHECKLIST.md](./UAT_CHECKLIST.md).

## Release and Marketplace

```bash
git checkout main
git pull origin main
npm ci
npm run check
npm run build
git add .
git commit -m "release: v1.0.0"
git push origin main
git tag v1.0.0
git push origin v1.0.0
```

Then:

1. Open GitHub Releases and create a release from `v1.0.0`.
2. Publish the action to GitHub Marketplace from the repository.
3. Move the major tag for consumers:
   `git tag -f v1 v1.0.0 && git push -f origin v1`

## Permissions Required in Workflow

```yaml
permissions:
  contents: read
  pull-requests: write
```

## Troubleshooting

- No comments posted:
  verify workflow permissions include `pull-requests: write`.
- Claude authentication errors:
  confirm `ANTHROPIC_API_KEY` secret exists in the same repository.
- Action skipped many files:
  check `ignore_patterns`, `max_files`, and PR file count guard behavior.
- Unexpected runtime behavior:
  inspect Action logs for token usage and malformed-JSON warnings.

## License

MIT. See [LICENSE](./LICENSE).
