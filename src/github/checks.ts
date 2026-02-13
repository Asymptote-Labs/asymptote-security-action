import * as core from '@actions/core';
import * as github from '@actions/github';
import { Severity, Violation, GetEvaluationResponse } from '../api/types';
import {
  countBySeverity,
  shouldFail,
  getSeverityBadge,
} from '../utils/severity';

type Octokit = ReturnType<typeof github.getOctokit>;

// GitHub limits annotations to 50 per request
const MAX_ANNOTATIONS_PER_REQUEST = 50;

type AnnotationLevel = 'failure' | 'warning' | 'notice';

interface Annotation {
  path: string;
  start_line: number;
  end_line: number;
  annotation_level: AnnotationLevel;
  message: string;
  title: string;
}

/**
 * Create a check run with annotations for the evaluation results
 */
export async function createCheckRun(
  octokit: Octokit,
  result: GetEvaluationResponse,
  commitSha: string,
  failOnThreshold: Severity
): Promise<void> {
  const { owner, repo } = github.context.repo;

  const violations = result.violations || [];
  const decision = result.decision || 'allow';

  const shouldFailCheck = shouldFail(violations, failOnThreshold);
  const conclusion = shouldFailCheck ? 'failure' : 'success';

  // Build annotations from violations
  const annotations = buildAnnotations(violations);

  // Build summary text
  const summaryText = buildSummaryText(violations, decision, failOnThreshold);

  core.info(
    `Creating check run with ${annotations.length} annotations (conclusion: ${conclusion})`
  );

  try {
    // Create the check run
    const checkRun = await octokit.rest.checks.create({
      owner,
      repo,
      name: 'Asymptote Security Scan',
      head_sha: commitSha,
      status: 'completed',
      conclusion,
      output: {
        title: getCheckTitle(violations),
        summary: summaryText,
        // Only include first batch of annotations in create
        annotations: annotations.slice(0, MAX_ANNOTATIONS_PER_REQUEST),
      },
    });

    // If we have more annotations, update the check run in batches
    if (annotations.length > MAX_ANNOTATIONS_PER_REQUEST) {
      await addRemainingAnnotations(
        octokit,
        checkRun.data.id,
        annotations.slice(MAX_ANNOTATIONS_PER_REQUEST)
      );
    }

    // Set details_url to the Actions run page so "View details" links to workflow execution.
    // This is non-critical, so wrap in try-catch to prevent blocking annotation batching.
    try {
      const runId = github.context.runId;
      const serverUrl = process.env.GITHUB_SERVER_URL || 'https://github.com';
      const detailsUrl = `${serverUrl}/${owner}/${repo}/actions/runs/${runId}`;
      
      await octokit.rest.checks.update({
        owner,
        repo,
        check_run_id: checkRun.data.id,
        details_url: detailsUrl,
      });
    } catch (error) {
      core.debug(
        `Failed to set details_url: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    core.info(`Check run created: ${checkRun.data.html_url}`);
  } catch (error) {
    core.warning(
      `Failed to create check run: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Add remaining annotations in batches
 */
async function addRemainingAnnotations(
  octokit: Octokit,
  checkRunId: number,
  annotations: Annotation[]
): Promise<void> {
  const { owner, repo } = github.context.repo;

  for (let i = 0; i < annotations.length; i += MAX_ANNOTATIONS_PER_REQUEST) {
    const batch = annotations.slice(i, i + MAX_ANNOTATIONS_PER_REQUEST);

    await octokit.rest.checks.update({
      owner,
      repo,
      check_run_id: checkRunId,
      output: {
        title: 'Asymptote Security Scan',
        summary: 'Additional annotations',
        annotations: batch,
      },
    });
  }
}

/**
 * Build annotations from violations
 */
function buildAnnotations(violations: Violation[]): Annotation[] {
  return violations
    .filter((v) => v.location.file && v.location.line_start > 0)
    .filter((v) => v.severity !== 'low' && v.severity !== 'info')
    .map((violation) => ({
      path: violation.location.file,
      start_line: violation.location.line_start,
      end_line: violation.location.line_end || violation.location.line_start,
      annotation_level: severityToAnnotationLevel(violation.severity),
      title: `${violation.policy_name} (${violation.severity})`,
      message: formatAnnotationMessage(violation),
    }));
}

/**
 * Map severity to GitHub annotation level
 */
function severityToAnnotationLevel(severity: Severity): AnnotationLevel {
  switch (severity) {
    case 'critical':
    case 'high':
      return 'failure';
    case 'medium':
    default:
      return 'warning';
  }
}

/**
 * Format annotation message
 */
function formatAnnotationMessage(violation: Violation): string {
  const parts = [violation.message];

  if (violation.explanation) {
    parts.push('');
    parts.push(violation.explanation);
  }

  if (violation.remediation) {
    parts.push('');
    parts.push(`Fix: ${violation.remediation}`);
  }

  if (violation.metadata.cwe_id) {
    const cweNumber = violation.metadata.cwe_id.replace(/^CWE-/i, '');
    parts.push('');
    parts.push(`CWE-${cweNumber}`);
  }

  return parts.join('\n');
}

/**
 * Get check run title based on results
 */
function getCheckTitle(violations: Violation[]): string {
  const total = violations.length;

  if (total === 0) {
    return 'No security issues found';
  }

  const counts = countBySeverity(violations);
  const parts: string[] = [];

  if (counts.critical > 0) parts.push(`${counts.critical} critical`);
  if (counts.high > 0) parts.push(`${counts.high} high`);
  if (counts.medium > 0) parts.push(`${counts.medium} medium`);
  if (counts.low > 0) parts.push(`${counts.low} low`);

  return `Found ${total} security issue${total === 1 ? '' : 's'}: ${parts.join(', ')}`;
}

/**
 * Build summary markdown text
 */
function buildSummaryText(
  violations: Violation[],
  decision: string,
  failOnThreshold: Severity
): string {
  const lines: string[] = [];

  // Decision badge
  const decisionBadges: Record<string, string> = {
    block: '🚫 **Block**',
    warn: '⚠️ **Warn**',
    allow: '✅ **Allow**',
  };
  const decisionBadge = decisionBadges[decision] || '✅ **Allow**';
  lines.push(`## Decision: ${decisionBadge}`);
  lines.push('');

  // Summary table
  const counts = countBySeverity(violations);
  lines.push('### Violation Summary');
  lines.push('');
  lines.push('| Severity | Count |');
  lines.push('|----------|-------|');
  lines.push(`| ${getSeverityBadge('critical')} | ${counts.critical} |`);
  lines.push(`| ${getSeverityBadge('high')} | ${counts.high} |`);
  lines.push(`| ${getSeverityBadge('medium')} | ${counts.medium} |`);
  lines.push(`| ${getSeverityBadge('low')} | ${counts.low} |`);
  lines.push(`| **Total** | **${violations.length}** |`);
  lines.push('');

  // Threshold info
  lines.push(
    `*Check fails on violations of severity \`${failOnThreshold}\` or higher*`
  );
  lines.push('');

  // Violations details (limited)
  if (violations.length > 0) {
    lines.push('### Details');
    lines.push('');

    const displayViolations = violations.slice(0, 10);
    for (const v of displayViolations) {
      lines.push(
        `- **${v.policy_name}** (${v.severity}) - \`${v.location.file}:${v.location.line_start}\``
      );
      lines.push(`  ${v.message}`);
    }

    if (violations.length > 10) {
      lines.push('');
      lines.push(
        `*...and ${violations.length - 10} more. See annotations for full details.*`
      );
    }
  }

  lines.push('');
  lines.push('---');
  lines.push(
    '*Powered by [Asymptote Security](https://asymptotelabs.ai)*'
  );

  return lines.join('\n');
}
