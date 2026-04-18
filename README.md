# AI Code Reviewer

Production-ready GitHub Action that reviews pull request changes with Anthropic Claude and posts inline review comments on changed lines.

## Usage

```yaml
# .github/workflows/ai-review.yml

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
      - uses: pentiumcity/ai-code-reviewer@v1
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          review_level: standard
          ignore_patterns: "*.md,*.lock,dist/**"
          max_files: "15"
          post_summary: "true"
```

## Inputs

| Input               | Required | Default                      | Description                      |
| ------------------- | -------- | ---------------------------- | -------------------------------- |
| `github_token`      | Yes      | -                            | GitHub token for review comments |
| `anthropic_api_key` | Yes      | -                            | Anthropic Claude API key         |
| `model`             | No       | `claude-sonnet-4-20250514`   | Claude model                     |
| `review_level`      | No       | `standard`                   | `quick`, `standard`, or `deep`   |
| `ignore_patterns`   | No       | `*.md,*.lock,*.json,dist/**` | Comma-separated glob patterns    |
| `max_files`         | No       | `20`                         | Max files to review              |
| `post_summary`      | No       | `true`                       | Post summary review body         |

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

## Quality Gate

Run the full production gate locally:

```bash
npm run check
```

For live customer-style validation on real pull requests, use [UAT_CHECKLIST.md](./UAT_CHECKLIST.md).

## Release

1. Commit and push to the default branch.
2. Tag a release, for example `v1.0.0`.
3. Push the tag.
4. Publish the action from the repository Releases tab to GitHub Marketplace.
