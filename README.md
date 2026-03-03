# Asymptote Security Scan GitHub Action

Evaluate pull request code changes against Asymptote security policies. This action posts inline review comments on violations and creates a check run with annotations.

## Features

- Evaluates PR diffs against your organization's security policies
- Posts inline review comments on code with security issues
- **AI-generated code fix suggestions** rendered as GitHub suggestion blocks with one-click "Apply suggestion"
- **"Fix in Cursor" deeplink button** on each violation comment for one-click remediation in Cursor
- Creates check runs with detailed annotations
- Configurable severity thresholds for failing checks and posting comments
- Supports all severity levels: critical, high, medium, low

## Usage

### Basic Usage

```yaml
name: Security Scan

on:
  pull_request:
    branches: [main]

permissions:
  contents: write
  pull-requests: write
  checks: write

jobs:
  security-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Asymptote Security Scan
        uses: ./.github/actions/asymptote-security-scan
        with:
          asymptote_api_key: ${{ secrets.ASYMPTOTE_API_KEY }}
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### Advanced Usage

```yaml
- name: Asymptote Security Scan
  uses: ./.github/actions/asymptote-security-scan
  with:
    asymptote_api_key: ${{ secrets.ASYMPTOTE_API_KEY }}
    fail_on: high        # Fail the check on high or critical violations
    comment_on: high     # Post comments on high or critical violations
    exclude_paths: '**/dist/**,**/*.min.js,**/node_modules/**'  # Skip generated files
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### With Asymptote GitHub App (Branded Comments)

To show Asymptote branding on PR comments instead of "github-actions", use the Asymptote GitHub App:

```yaml
jobs:
  security-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Generate Asymptote App Token
        id: app-token
        uses: actions/create-github-app-token@v1
        with:
          app-id: ${{ secrets.ASYMPTOTE_GITHUB_APP_ID }}
          private-key: ${{ secrets.ASYMPTOTE_GITHUB_APP_PRIVATE_KEY }}

      - name: Asymptote Security Scan
        uses: ./.github/actions/asymptote-security-scan
        with:
          asymptote_api_key: ${{ secrets.ASYMPTOTE_API_KEY }}
        env:
          GITHUB_TOKEN: ${{ steps.app-token.outputs.token }}
```

### Using Outputs

```yaml
- name: Asymptote Security Scan
  id: security-scan
  uses: ./.github/actions/asymptote-security-scan
  with:
    asymptote_api_key: ${{ secrets.ASYMPTOTE_API_KEY }}
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

- name: Check Results
  if: always()
  run: |
    echo "Decision: ${{ steps.security-scan.outputs.decision }}"
    echo "Total violations: ${{ steps.security-scan.outputs.total_violations }}"
    echo "Critical: ${{ steps.security-scan.outputs.critical_count }}"
    echo "High: ${{ steps.security-scan.outputs.high_count }}"
    echo "Medium: ${{ steps.security-scan.outputs.medium_count }}"
```

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `asymptote_api_key` | Yes | - | Asymptote API key with `evaluate_diff` scope |
| `asymptote_api_url` | No | `https://asymptote-edge-...` | Asymptote Edge API URL |
| `fail_on` | No | `high` | Minimum severity to fail the check (`critical`, `high`, `medium`, `low`) |
| `comment_on` | No | `high` | Minimum severity to post PR comments (`critical`, `high`, `medium`, `low`) |
| `exclude_paths` | No | - | Comma-separated glob patterns to exclude from scanning (e.g., `**/dist/**,**/*.min.js`) |

## Outputs

| Output | Description |
|--------|-------------|
| `decision` | Overall evaluation decision: `allow`, `warn`, or `block` |
| `total_violations` | Total number of violations found |
| `critical_count` | Number of critical severity violations |
| `high_count` | Number of high severity violations |
| `medium_count` | Number of medium severity violations |

## Permissions

This action requires the following GitHub token permissions:

```yaml
permissions:
  contents: write        # Read repo contents + resolve outdated review threads (GraphQL)
  pull-requests: write   # Post review comments
  checks: write          # Create check runs with annotations
```

> **Note:** `contents: write` is required for the `resolveReviewThread` GraphQL mutation used to auto-resolve outdated violation threads. If you prefer `contents: read`, the action will still work but outdated threads won't be auto-resolved.

## API Key

To use this action, you need an Asymptote API key with the `evaluate_diff` scope:

1. Go to your [Asymptote Dashboard](https://asymptotelabs.ai/dashboard)
2. Navigate to **Settings** > **API Keys**
3. Create a new API key with `ci` type and `evaluate_diff` scope
4. Add the key to your repository secrets as `ASYMPTOTE_API_KEY`

## Severity Levels

| Level | Description |
|-------|-------------|
| `critical` | Severe security issues that must be fixed |
| `high` | Important security issues that should be addressed |
| `medium` | Moderate security concerns |
| `low` | Minor security suggestions |
| `info` | Informational notices (not security issues) |

## PR Comment Features

### Suggested Fixes

For violations that meet the `comment_on` threshold, the action generates AI-powered code fix suggestions using the Asymptote API. These are rendered as GitHub suggestion blocks with a native "Apply suggestion" button. Users can apply fixes individually or batch multiple suggestions into a single commit.

If fix generation fails, comments are still posted with remediation guidance (graceful degradation).

### Fix in Cursor

Each violation comment includes a "Fix in Cursor" button that deep-links into Cursor with a prompt to fix the specific issue. This uses an HTTPS redirect page (`/open/cursor`) that opens the `cursor://` protocol client-side, since GitHub strips non-HTTPS protocols from comment HTML.

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Invalid API key (401) | Fails with clear error message |
| Rate limited (429) | Warns but does not fail the check |
| Evaluation timeout | Warns but does not fail the check |
| Network errors | Retries with backoff, then fails |

## Development

### Building

```bash
cd .github/actions/asymptote-security-scan
npm install
npm run build
```

### Testing Locally

Use [act](https://github.com/nektos/act) to test the action locally:

```bash
act pull_request -s ASYMPTOTE_API_KEY=your_key -s GITHUB_TOKEN=your_token
```

## License

MIT
