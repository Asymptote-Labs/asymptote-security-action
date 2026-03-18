import * as core from '@actions/core';
import * as github from '@actions/github';
import { Violation } from '../api/types';
import { getSeverityBadge, getSeverityIcon } from '../utils/severity';

type Octokit = ReturnType<typeof github.getOctokit>;

interface ReviewComment {
  path: string;
  line: number;
  start_line?: number;
  side?: string;
  start_side?: string;
  body: string;
}

function buildReviewSummary(commentCount: number): string {
  const label = commentCount === 1 ? 'vulnerability' : 'vulnerabilities';
  return `Asymptote security scan has reviewed your changes and found ${commentCount} potential ${label}.`;
}

/**
 * Post violation comments as a PR review
 */
export async function postViolationComments(
  octokit: Octokit,
  violations: Violation[],
  commitSha: string
): Promise<void> {
  const { owner, repo } = github.context.repo;
  const prNumber = github.context.payload.pull_request?.number;

  if (!prNumber) {
    core.warning('No PR number found, skipping comment posting');
    return;
  }

  if (violations.length === 0) {
    core.info('No violations to comment on');
    return;
  }

  core.info(
    `Posting ${violations.length} violation comments on PR #${prNumber}`
  );

  // Build review comments with multi-line support
  // When a suggested fix is present, use its line range so the ```suggestion
  // block replaces exactly the right lines when "Apply suggestion" is clicked.
  const comments: ReviewComment[] = violations
    .filter((v) => v.location.file && v.location.line_start > 0)
    .map((violation) => {
      // Determine line range: prefer fix range (accurate for suggestions),
      // fall back to violation range
      const fixStart = violation.metadata.suggested_fix_line_start;
      const fixEnd = violation.metadata.suggested_fix_line_end;
      const hasFixRange =
        typeof fixStart === 'number' &&
        typeof fixEnd === 'number' &&
        fixStart >= 1;

      const lineStart = hasFixRange
        ? fixStart
        : violation.location.line_start;
      const lineEnd = hasFixRange
        ? fixEnd
        : violation.location.line_end || violation.location.line_start;

      const side = violation.location.side === 'LEFT' ? 'LEFT' : 'RIGHT';

      const comment: ReviewComment = {
        path: violation.location.file,
        line: lineEnd,
        body: formatViolationComment(violation),
        side,
      };

      // Add multi-line range if spanning multiple lines
      if (lineEnd > lineStart) {
        comment.start_line = lineStart;
        comment.start_side = side;
      }

      return comment;
    });

  if (comments.length === 0) {
    core.info('No violations with valid locations to comment on');
  } else {
    try {
      const reviewResponse = await octokit.rest.pulls.createReview({
        owner,
        repo,
        pull_number: prNumber,
        commit_id: commitSha,
        event: 'COMMENT',
        body: buildReviewSummary(comments.length),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        comments: comments as any,
      });

      core.info(`Successfully posted ${comments.length} review comments`);

      // Add thumbs up/down reactions to each review comment for user feedback
      try {
        const reviewId = reviewResponse.data.id;
        const reviewComments =
          await octokit.rest.pulls.listCommentsForReview({
            owner,
            repo,
            pull_number: prNumber,
            review_id: reviewId,
            per_page: 100,
          });

        for (const comment of reviewComments.data) {
          try {
            await octokit.rest.reactions.createForPullRequestReviewComment({
              owner,
              repo,
              comment_id: comment.id,
              content: '+1',
            });
          } catch (error) {
            core.warning(
              `Failed to add +1 reaction to review comment ${comment.id}: ${error instanceof Error ? error.message : String(error)}`
            );
          }

          try {
            await octokit.rest.reactions.createForPullRequestReviewComment({
              owner,
              repo,
              comment_id: comment.id,
              content: '-1',
            });
          } catch (error) {
            core.warning(
              `Failed to add -1 reaction to review comment ${comment.id}: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        }

        core.info(
          `Added reactions to ${reviewComments.data.length} review comments`
        );
      } catch (error) {
        core.warning(
          `Failed to add reactions to review comments: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    } catch (error) {
      // Don't fail the action if we can't post comments
      core.warning(
        `Failed to post review comments: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // Post fallback issue comment for violations without valid locations
  const locationlessViolations = violations.filter(
    (v) => !v.location.file || v.location.line_start <= 0
  );

  if (locationlessViolations.length > 0) {
    try {
      const body = formatFallbackComment(locationlessViolations);
      await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: prNumber,
        body,
      });
      core.info(
        `Posted fallback comment for ${locationlessViolations.length} locationless violations`
      );
    } catch (error) {
      core.warning(
        `Failed to post fallback comment: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

/**
 * Escape suggested fix code if it contains triple backticks
 */
function buildSuggestionBlock(suggestedFix: string): string {
  if (suggestedFix.includes('```')) {
    return `\`\`\`\`suggestion\n${suggestedFix}\n\`\`\`\``;
  }
  return `\`\`\`suggestion\n${suggestedFix}\n\`\`\``;
}

const CURSOR_URL_MAX = 7500;
const CURSOR_REDIRECT_PREFIX = 'https://asymptotelabs.ai/open/cursor?text=';
const DASHBOARD_BADGE_URL =
  'https://raw.githubusercontent.com/Asymptote-Labs/asymptote-security-action/main/assets/view-in-dashboard-badge.svg';

/**
 * Build Cursor redirect URL for fixing a violation.
 * GitHub strips non-HTTPS protocols from <a href>, so we use an HTTPS
 * redirect page that opens cursor:// client-side.
 * Progressively drops remediation then truncates message to stay under limit.
 */
function buildCursorRedirectUrl(violation: Violation): string {
  const file = violation.location.file;
  const line = violation.location.line_start;
  const base = `Fix security issue in ${file}:${line}`;

  // Try full prompt: base + message + remediation
  let prompt = `${base} — ${violation.message}`;
  if (violation.remediation) {
    prompt += `. ${violation.remediation}`;
  }
  let url = CURSOR_REDIRECT_PREFIX + encodeURIComponent(prompt);
  if (url.length <= CURSOR_URL_MAX) return url;

  // Drop remediation
  prompt = `${base} — ${violation.message}`;
  url = CURSOR_REDIRECT_PREFIX + encodeURIComponent(prompt);
  if (url.length <= CURSOR_URL_MAX) return url;

  // Truncate message to fit
  const overhead = (CURSOR_REDIRECT_PREFIX + encodeURIComponent(`${base} — `)).length;
  const budget = CURSOR_URL_MAX - overhead;
  // encodeURIComponent expands chars up to 3x; conservatively truncate raw text
  const maxChars = Math.floor(budget / 3);
  const truncatedMsg = violation.message.slice(0, maxChars);
  return CURSOR_REDIRECT_PREFIX + encodeURIComponent(`${base} — ${truncatedMsg}...`);
}

/**
 * Build HTML button for Cursor deeplink.
 * Matches BugBot's pattern: <a> wrapping <picture> with Cursor's hosted
 * button images for dark/light mode support. Uses an HTTPS redirect URL
 * since GitHub strips <a> tags with non-standard protocol hrefs.
 */
function escapeHtmlAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#39;');
}

function buildCursorDeeplinkHtml(violation: Violation): string {
  const url = escapeHtmlAttr(buildCursorRedirectUrl(violation));
  return `<a href="${url}" target="_blank" rel="noopener noreferrer"><picture><source media="(prefers-color-scheme: dark)" srcset="https://cursor.com/assets/images/fix-in-cursor-dark.png"><source media="(prefers-color-scheme: light)" srcset="https://cursor.com/assets/images/fix-in-cursor-light.png"><img alt="Fix in Cursor" width="115" height="28" src="https://cursor.com/assets/images/fix-in-cursor-dark.png"></picture></a>`;
}

function buildDashboardDeeplinkHtml(violation: Violation): string {
  const dashboardUrl = escapeHtmlAttr(`https://asymptotelabs.ai/dashboard/vulnerabilities/violation-${violation.id}`);
  const badgeUrl = escapeHtmlAttr(DASHBOARD_BADGE_URL);

  return `<a href="${dashboardUrl}" target="_blank" rel="noopener noreferrer"><img alt="View in Dashboard" width="157" height="28" src="${badgeUrl}"></a>`;
}

/**
 * Format a violation as a markdown comment
 */
export function formatViolationComment(violation: Violation): string {
  const lines: string[] = [];

  // Header with logo and title
  const title = capitalizeFirstCharacter(violation.title || violation.message);
  lines.push(`<h3><img src="https://asymptotelabs.ai/logo.png" alt="Asymptote" width="20" height="20" align="absmiddle"> Asymptote Security Scan — ${escapeHtml(title)}</h3>`);
  lines.push('');

  // Severity + policy metadata
  const severityLabel = `${capitalizeFirstCharacter(violation.severity)} Severity`;
  lines.push(`${getSeverityIcon(violation.severity)} ${severityLabel} / **Policy:** ${violation.policy_name}`);
  lines.push('');

  // Explanation only
  const body = formatExplanation(violation.explanation || '');
  if (body) {
    lines.push(body);
  }
  lines.push('');

  // Suggested fix (GitHub suggestion block)
  if (violation.metadata.suggested_fix) {
    lines.push(buildSuggestionBlock(violation.metadata.suggested_fix));
    lines.push('');
  }

  // Action buttons: Cursor + Dashboard
  const buttons: string[] = [];
  buttons.push(buildCursorDeeplinkHtml(violation));
  if (violation.id) {
    buttons.push(buildDashboardDeeplinkHtml(violation));
  }
  lines.push(`<p>${buttons.join('&nbsp;&nbsp;')}</p>`);
  lines.push('');

  // Embed violation ID for webhook handler to link comment back to violation
  if (violation.id) {
    lines.push('');
    lines.push(
      `<!-- asymptote:violation_id=${violation.id} -->`
    );
  }

  return lines.join('\n');
}

/**
 * Format a fallback comment for violations that lack valid file/line locations.
 * Posted as a regular issue comment in the PR conversation timeline.
 */
function formatFallbackComment(violations: Violation[]): string {
  const lines: string[] = [];

  lines.push('## Asymptote Security Findings');
  lines.push('');
  lines.push(
    `The following ${violations.length === 1 ? 'violation was' : `${violations.length} violations were`} detected but could not be pinned to a specific line in the diff:`
  );
  lines.push('');

  for (const violation of violations) {
    const badge = getSeverityBadge(violation.severity);
    lines.push(`<details>`);
    lines.push(
      `<summary>${badge} ${violation.policy_name}${violation.location.file ? ` — <code>${violation.location.file}</code>` : ''}</summary>`
    );
    lines.push('');
    lines.push(`**Issue:** ${violation.message}`);
    lines.push('');
    if (violation.remediation) {
      lines.push(`**How to fix:** ${violation.remediation}`);
      lines.push('');
    }
    if (violation.metadata.cwe_id) {
      const cweNumber = violation.metadata.cwe_id.replace(/^CWE-/i, '');
      lines.push(
        `**Reference:** [CWE-${cweNumber}](https://cwe.mitre.org/data/definitions/${cweNumber}.html)`
      );
      lines.push('');
    }
    lines.push(`</details>`);
    lines.push('');
  }

  return lines.join('\n');
}

function capitalizeFirstCharacter(value: string): string {
  if (!value) {
    return value;
  }

  return value.replace(/^(\s*)(\S)/, (_, leadingWhitespace: string, firstChar: string) =>
    `${leadingWhitespace}${firstChar.toUpperCase()}`
  );
}

function formatExplanation(explanation: string): string {
  if (!explanation) {
    return '';
  }

  return explanation.replace(/`([^`\n]+)`/g, (_match: string, code: string) => {
    return `<code>${escapeHtml(code)}</code>`;
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Resolve outdated Asymptote review threads on a PR.
 * GitHub marks threads as "outdated" when the referenced lines change.
 * Resolving them triggers the pull_request_review_thread webhook which
 * the backend uses to mark violations as remediated.
 */
export async function resolveOutdatedThreads(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number
): Promise<void> {
  const query = `
    query($owner: String!, $repo: String!, $prNumber: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $prNumber) {
          reviewThreads(first: 100) {
            nodes {
              id
              isResolved
              isOutdated
              comments(first: 1) {
                nodes {
                  body
                }
              }
            }
          }
        }
      }
    }
  `;

  interface ReviewThread {
    id: string;
    isResolved: boolean;
    isOutdated: boolean;
    comments: {
      nodes: Array<{
        body: string;
      }>;
    };
  }

  const result = await octokit.graphql<{
    repository: {
      pullRequest: {
        reviewThreads: {
          nodes: ReviewThread[];
        };
      };
    };
  }>(query, { owner, repo, prNumber });

  const threads =
    result.repository.pullRequest.reviewThreads.nodes;

  // Identify Asymptote threads by the violation_id marker embedded in comment
  // body, which works regardless of auth method (github-actions[bot] or
  // asymptote-security[bot])
  const ASYMPTOTE_MARKER = /<!-- asymptote:violation_id=/;

  const outdatedThreads = threads.filter(
    (t: ReviewThread) =>
      t.isOutdated &&
      !t.isResolved &&
      ASYMPTOTE_MARKER.test(t.comments.nodes[0]?.body ?? '')
  );

  if (outdatedThreads.length === 0) {
    core.info('No outdated Asymptote threads to resolve');
    return;
  }

  core.info(
    `Resolving ${outdatedThreads.length} outdated Asymptote thread(s)`
  );

  let resolved = 0;
  for (const thread of outdatedThreads) {
    try {
      await octokit.graphql(
        `mutation($threadId: ID!) {
          resolveReviewThread(input: { threadId: $threadId }) {
            thread { id }
          }
        }`,
        { threadId: thread.id }
      );
      resolved++;
    } catch (error) {
      core.warning(
        `Failed to resolve thread ${thread.id}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  core.info(
    `Resolved ${resolved}/${outdatedThreads.length} outdated thread(s)`
  );
}
