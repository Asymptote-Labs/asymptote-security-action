import * as core from '@actions/core';
import * as github from '@actions/github';
import { Severity, Violation } from '../api/types';
import { filterByThreshold, getSeverityBadge } from '../utils/severity';

type Octokit = ReturnType<typeof github.getOctokit>;

interface ReviewComment {
  path: string;
  line: number;
  start_line?: number;
  side?: string;
  start_side?: string;
  body: string;
}

/**
 * Post violation comments as a PR review
 */
export async function postViolationComments(
  octokit: Octokit,
  violations: Violation[],
  commitSha: string,
  commentThreshold: Severity
): Promise<void> {
  const { owner, repo } = github.context.repo;
  const prNumber = github.context.payload.pull_request?.number;

  if (!prNumber) {
    core.warning('No PR number found, skipping comment posting');
    return;
  }

  // Filter violations by threshold
  const relevantViolations = filterByThreshold(violations, commentThreshold);

  if (relevantViolations.length === 0) {
    core.info('No violations meet comment threshold, skipping comments');
    return;
  }

  core.info(
    `Posting ${relevantViolations.length} violation comments on PR #${prNumber}`
  );

  // Build review comments with multi-line support
  // When a suggested fix is present, use its line range so the ```suggestion
  // block replaces exactly the right lines when "Apply suggestion" is clicked.
  const comments: ReviewComment[] = relevantViolations
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

      const comment: ReviewComment = {
        path: violation.location.file,
        line: lineEnd,
        body: formatViolationComment(violation),
      };

      // Add multi-line range if spanning multiple lines
      if (lineEnd > lineStart) {
        comment.start_line = lineStart;
        comment.side = 'RIGHT';
        comment.start_side = 'RIGHT';
      }

      return comment;
    });

  if (comments.length === 0) {
    core.info('No violations with valid locations to comment on');
    return;
  }

  try {
    await octokit.rest.pulls.createReview({
      owner,
      repo,
      pull_number: prNumber,
      commit_id: commitSha,
      event: 'COMMENT',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      comments: comments as any,
    });

    core.info(`Successfully posted ${comments.length} review comments`);
  } catch (error) {
    // Don't fail the action if we can't post comments
    core.warning(
      `Failed to post review comments: ${error instanceof Error ? error.message : String(error)}`
    );
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
  return `<p><a href="${url}" target="_blank" rel="noopener noreferrer"><picture><source media="(prefers-color-scheme: dark)" srcset="https://cursor.com/assets/images/fix-in-cursor-dark.png"><source media="(prefers-color-scheme: light)" srcset="https://cursor.com/assets/images/fix-in-cursor-light.png"><img alt="Fix in Cursor" width="115" height="28" src="https://cursor.com/assets/images/fix-in-cursor-dark.png"></picture></a></p>`;
}

/**
 * Format a violation as a markdown comment
 */
function formatViolationComment(violation: Violation): string {
  const lines: string[] = [];

  // Header with severity badge
  lines.push(`### ${getSeverityBadge(violation.severity)} Security Issue`);
  lines.push('');

  // Policy info
  lines.push(`**Policy:** ${violation.policy_name}`);
  if (violation.category) {
    lines.push(`**Category:** ${violation.category}`);
  }
  lines.push('');

  // Message
  lines.push(`**Issue:** ${violation.message}`);
  lines.push('');

  // Explanation
  if (violation.explanation) {
    lines.push('**Why this matters:**');
    lines.push(violation.explanation);
    lines.push('');
  }

  // Remediation
  if (violation.remediation) {
    lines.push('**How to fix:**');
    lines.push(violation.remediation);
    lines.push('');
  }

  // Suggested fix (GitHub suggestion block)
  if (violation.metadata.suggested_fix) {
    lines.push('**Suggested fix:**');
    lines.push(buildSuggestionBlock(violation.metadata.suggested_fix));
    lines.push('');
  }

  // CWE reference
  if (violation.metadata.cwe_id) {
    // Extract just the number (handle both "89" and "CWE-89" formats)
    const cweNumber = violation.metadata.cwe_id.replace(/^CWE-/i, '');
    lines.push(
      `**Reference:** [CWE-${cweNumber}](https://cwe.mitre.org/data/definitions/${cweNumber}.html)`
    );
    lines.push('');
  }

  // Cursor deeplink button
  lines.push(buildCursorDeeplinkHtml(violation));

  // Embed violation ID for webhook handler to link comment back to violation
  if (violation.id) {
    lines.push('');
    lines.push(
      `<!-- asymptote:violation_id=${violation.id} -->`
    );
  }

  return lines.join('\n');
}
