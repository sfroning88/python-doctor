# Python Doctor

Static analysis for Python, Markdown, and SQL — lint, types, security, dead code, complexity, and more. Get a **0–100 health score** with actionable diagnostics posted to your PRs.

Inspired by [React Doctor](https://github.com/millionco/react-doctor), but minimal: no CLI bundling, only a GitHub Action.

## How it works

Python Doctor runs six lightweight tools **only on changed files** in your PR:

1. **Ruff** — Fast linter + style (replaces flake8, isort, pyupgrade)
2. **mypy** — Static type checking
3. **Bandit** — Security scanning (SQL injection, hardcoded secrets)
4. **Vulture** — Dead code detection
5. **Radon** — Cyclomatic complexity & maintainability index
6. **SQLFluff** — SQL linting (PostgreSQL, MySQL, ANSI, etc.)
7. **markdownlint** — Markdown style and consistency

Findings are weighted by severity to produce a 0–100 score. Results are posted as a collapsible PR comment with per-tool sections.

## GitHub Actions

Add to your workflow (e.g. `.github/workflows/python-doctor.yml`):

```yaml
name: Python Doctor

on:
  pull_request:
    branches: [main]

jobs:
  python-doctor:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      issues: write
    steps:
      - uses: OWNER/python-doctor@v1
        with:
          app-path: apps/worker
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

Replace `OWNER` with your GitHub username or org (e.g. `seanfroning/python-doctor@v1`).

### Minimal integration

```yaml
- uses: OWNER/python-doctor@v1
  with:
    app-path: apps/worker
    github-token: ${{ secrets.GITHUB_TOKEN }}
```

### With path filtering (monorepo)

See [examples/monorepo-workflow.yml](examples/monorepo-workflow.yml) for a full example using `dorny/paths-filter` to run only when relevant paths change.

## Inputs

| Input | Default | Description |
| ----- | ------- | ----------- |
| `app-path` | *(required)* | Path to the Python app relative to repo root (e.g. `apps/backend`) |
| `github-token` | *(required)* | GitHub token for posting PR comments |
| `python-version` | `3.11` | Python version to use |
| `base-ref` | `github.base_ref` or `main` | Base branch to diff against |
| `head-sha` | `github.event.pull_request.head.sha` or `github.sha` | Head commit SHA |
| `ruff-enabled` | `true` | Run Ruff (lint + style) |
| `mypy-enabled` | `true` | Run mypy (type checking) |
| `bandit-enabled` | `true` | Run Bandit (security) |
| `vulture-enabled` | `true` | Run Vulture (dead code) |
| `vulture-min-confidence` | `80` | Vulture confidence threshold (60–100) |
| `radon-enabled` | `true` | Run Radon (complexity) |
| `markdownlint-enabled` | `true` | Run markdownlint (Markdown) |
| `sqlfluff-enabled` | `true` | Run SQLFluff (SQL) |
| `sqlfluff-dialect` | `postgres` | SQL dialect (postgres, mysql, ansi, etc.) |
| `install-dependencies` | `true` | Install project `requirements.txt` before analysis |
| `post-comment` | `true` | Post results as a PR comment |

## Outputs

| Output | Description |
| ------ | ----------- |
| `score` | Health score from 0–100 |
| `has-findings` | Whether any tool reported issues (`true`/`false`) |

Use outputs to gate downstream steps, e.g. fail the job if score drops below a threshold:

```yaml
- uses: OWNER/python-doctor@v1
  id: doctor
  with:
    app-path: apps/worker
    github-token: ${{ secrets.GITHUB_TOKEN }}

- name: Fail if score too low
  if: steps.doctor.outputs.score < '70'
  run: exit 1
```

## Publishing to the Marketplace

1. Create a **public** repository with `action.yml` at the root
2. Ensure the repo has **no workflow files** (required for marketplace)
3. Create a release (e.g. tag `v1`) and select **Publish this Action to the GitHub Marketplace**
4. Accept the [GitHub Marketplace Developer Agreement](https://docs.github.com/en/actions/sharing-automations/creating-actions/publishing-actions-in-github-marketplace) if prompted

See [GitHub's publishing docs](https://docs.github.com/en/actions/sharing-automations/creating-actions/publishing-actions-in-github-marketplace) for details.

## Credit

Inspired by [React Doctor](https://github.com/millionco/react-doctor) by Million.

## License

MIT License — see [LICENSE](LICENSE).
