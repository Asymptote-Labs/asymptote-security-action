import * as core from '@actions/core';
import * as github from '@actions/github';
import { getConfig } from './config';
import { AsymptoteClient, RateLimitError, TimeoutError } from './api/client';
import { getPRDiff, getIncrementalDiff } from './github/diff';
import { postViolationComments, resolveOutdatedThreads } from './github/comments';
import { createCheckRun } from './github/checks';
import { shouldFail, countBySeverity, filterByThreshold } from './utils/severity';

async function run(): Promise<void> {
  try {
    // 1. Parse and validate inputs
    const config = getConfig();
    core.setSecret(config.apiKey);

    core.info('Asymptote Security Scan starting...');
    core.debug(`API URL: ${config.apiUrl}`);
    core.debug(`Fail on: ${config.failOn}`);
    core.debug(`Comment on: ${config.commentOn}`);

    // 2. Verify PR context
    if (github.context.eventName !== 'pull_request') {
      core.setFailed(
        `This action only runs on pull_request events. Current event: ${github.context.eventName}`
      );
      return;
    }

    // 3. Get GitHub token and create client
    const githubToken = process.env.GITHUB_TOKEN;
    if (!githubToken) {
      core.setFailed(
        'GITHUB_TOKEN environment variable is required. Add `env: GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}` to your workflow.'
      );
      return;
    }
    const octokit = github.getOctokit(githubToken);

    // 4. Get PR diff (incremental on synchronize, full otherwise)
    const action = github.context.payload.action;
    const before = github.context.payload.before;

    core.info('Fetching PR diff...');
    if (config.excludePaths.length > 0) {
      core.info(`Excluding paths: ${config.excludePaths.join(', ')}`);
    }

    let diffResult;
    const commitSha = github.context.payload.pull_request?.head?.sha;

    if (action === 'synchronize' && before && commitSha) {
      core.info(`Incremental diff: ${before}...${commitSha}`);
      diffResult = await getIncrementalDiff(
        octokit,
        before,
        commitSha,
        config.excludePaths
      );
    } else {
      diffResult = await getPRDiff(octokit, config.excludePaths);
    }

    if (!diffResult.diff || diffResult.diff.trim().length === 0) {
      core.info('No changes detected in PR, skipping evaluation');
      core.setOutput('decision', 'allow');
      core.setOutput('total_violations', 0);
      core.setOutput('critical_count', 0);
      core.setOutput('high_count', 0);
      core.setOutput('medium_count', 0);
      return;
    }

    core.info(
      `PR #${diffResult.prNumber}: ${diffResult.files.length} files changed`
    );

    // 5. Call Asymptote API
    core.info('Submitting diff for evaluation...');
    const client = new AsymptoteClient({
      apiKey: config.apiKey,
      baseUrl: config.apiUrl,
    });

    let result;
    try {
      result = await client.evaluateWithPolling({
        diff: diffResult.diff,
        repository: {
          owner: github.context.repo.owner,
          name: github.context.repo.repo,
        },
        files: diffResult.files,
        context: {
          surface: 'ci',
          tool: 'github-action',
          pr_number: diffResult.prNumber,
          commit_sha: diffResult.commitSha,
        },
      });
    } catch (error) {
      if (error instanceof RateLimitError) {
        core.warning(
          'Rate limited by Asymptote API. Skipping evaluation but not failing the check.'
        );
        core.setOutput('decision', 'allow');
        core.setOutput('total_violations', 0);
        return;
      }
      if (error instanceof TimeoutError) {
        core.warning(
          'Evaluation timed out. Skipping evaluation but not failing the check.'
        );
        core.setOutput('decision', 'allow');
        core.setOutput('total_violations', 0);
        return;
      }
      throw error;
    }

    const violations = result.violations || [];
    const decision = result.decision || 'allow';
    const counts = countBySeverity(violations);

    core.info(
      `Evaluation complete: ${decision} (${violations.length} violations)`
    );

    // 5b. Generate suggested fixes for high/critical violations
    const commentableViolations = filterByThreshold(violations, config.commentOn);
    if (commentableViolations.length > 0) {
      core.info('Generating suggested fixes...');
      const fixes = await client.getSuggestedFixes(
        result.evaluation_id,
        diffResult.diff
      );

      if (fixes.length > 0) {
        core.info(`Got ${fixes.length} suggested fixes`);
        // Merge fixes into violations by violation_id
        const fixMap = new Map(fixes.map((f) => [f.violation_id, f]));
        for (const violation of violations) {
          const fix = fixMap.get(violation.id);
          if (fix) {
            violation.metadata = {
              ...violation.metadata,
              suggested_fix: fix.suggested_fix,
              suggested_fix_line_start: fix.line_start,
              suggested_fix_line_end: fix.line_end,
            };
          }
        }
      }
    }

    // 6. Auto-resolve outdated Asymptote threads on synchronize
    if (action === 'synchronize') {
      const { owner, repo } = github.context.repo;
      const prNumber = github.context.payload.pull_request?.number;
      if (prNumber) {
        await resolveOutdatedThreads(octokit, owner, repo, prNumber);
      }
    }

    // 7. Post review comments
    await postViolationComments(
      octokit,
      violations,
      diffResult.commitSha,
      config.commentOn
    );

    // 7. Create check run with annotations
    await createCheckRun(
      octokit,
      result,
      diffResult.commitSha,
      config.failOn
    );

    // 8. Set outputs
    core.setOutput('decision', decision);
    core.setOutput('total_violations', violations.length);
    core.setOutput('critical_count', counts.critical);
    core.setOutput('high_count', counts.high);
    core.setOutput('medium_count', counts.medium);

    // 9. Fail if threshold exceeded
    if (shouldFail(violations, config.failOn)) {
      const failingViolations = filterByThreshold(violations, config.failOn);
      core.setFailed(
        `Security check failed: ${failingViolations.length} violation(s) at or above ${config.failOn} severity`
      );
    } else {
      core.info('Security check passed');
    }
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed('An unexpected error occurred');
    }
  }
}

run();
