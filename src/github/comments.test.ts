import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as github from '@actions/github';
import { Violation } from '../api/types';
import { formatViolationComment, postViolationComments } from './comments';

function createViolation(overrides: Partial<Violation> = {}): Violation {
  return {
    id: '123',
    policy_id: 'policy-123',
    policy_name: 'Hardcoded Secret',
    title: 'hardcoded AWS key',
    category: 'secrets',
    severity: 'high',
    enforcement: 'block',
    location: {
      file: 'src/app.ts',
      line_start: 10,
      line_end: 10,
      side: 'RIGHT',
    },
    message: 'This message should not appear in the body.',
    explanation: 'Rotate the `AWS_SECRET_ACCESS_KEY` and remove it from source control.',
    remediation: 'Use environment variables instead.',
    metadata: {},
    ...overrides,
  };
}

test('formats severity line, explanation, and dashboard button as requested', () => {
  const comment = formatViolationComment(createViolation());

  assert.match(
    comment,
    /🟠 High Severity \/ \*\*Policy:\*\* Hardcoded Secret/
  );
  assert.doesNotMatch(
    comment,
    /\n\*\*Policy:\*\* Hardcoded Secret/
  );
  assert.match(
    comment,
    /Rotate the <code>AWS_SECRET_ACCESS_KEY<\/code> and remove it from source control\./
  );
  assert.doesNotMatch(
    comment,
    /This message should not appear in the body\.\s*Rotate/
  );
  assert.match(
    comment,
    /<picture style="vertical-align: middle"><source media="\(prefers-color-scheme: dark\)" srcset="https:\/\/cursor\.com\/assets\/images\/fix-in-cursor-dark\.png"><source media="\(prefers-color-scheme: light\)" srcset="https:\/\/cursor\.com\/assets\/images\/fix-in-cursor-light\.png"><img alt="Fix in Cursor" width="115" height="28" src="https:\/\/cursor\.com\/assets\/images\/fix-in-cursor-dark\.png" style="vertical-align: middle"><\/picture>/
  );
  assert.match(
    comment,
    /<a href="https:\/\/asymptotelabs\.ai\/dashboard\/vulnerabilities\/violation-123"[^>]*><img alt="View in Dashboard" width="149" height="28" src="https:\/\/raw\.githubusercontent\.com\/Asymptote-Labs\/asymptote-security-action\/main\/assets\/view-in-dashboard-badge\.svg" style="vertical-align: middle"><\/a>/
  );
});

test('dashboard badge inlines a resized 16x16 logo', () => {
  const badgeSvg = readFileSync('assets/view-in-dashboard-badge.svg', 'utf8');

  assert.match(badgeSvg, /width="149" height="28" viewBox="0 0 149 28"/);
  assert.match(badgeSvg, /<image href="data:image\/png;base64,/);
  assert.match(badgeSvg, /x="10" y="6" width="16" height="16"/);
  assert.match(badgeSvg, /font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"/);
  assert.doesNotMatch(badgeSvg, /https:\/\/asymptotelabs\.ai\/logo\.png/);
});

test('capitalizes the first character of the displayed title and uses HTML header markup', () => {
  const comment = formatViolationComment(
    createViolation({ title: 'mixedCase heading' })
  );

  assert.match(
    comment,
    /<h3><img src="https:\/\/asymptotelabs\.ai\/logo\.png" alt="Asymptote" width="20" height="20" align="absmiddle"> Asymptote Security Scan — MixedCase heading<\/h3>/
  );
});

test('falls back to the message in the header while still keeping the body explanation-only', () => {
  const comment = formatViolationComment(
    createViolation({
      title: undefined,
      message: 'lowercase fallback title',
      explanation: 'Only the explanation body should render.',
    })
  );

  assert.match(comment, /Asymptote Security Scan — Lowercase fallback title/);
  assert.match(comment, /\nOnly the explanation body should render\.\n/);
  assert.doesNotMatch(comment, /\nlowercase fallback title\n/);
});

test('submits a single review summary and preserves multiline review comments', async () => {
  const originalRepository = process.env.GITHUB_REPOSITORY;
  const originalPayload = github.context.payload;
  process.env.GITHUB_REPOSITORY = 'Asymptote-Labs/asymptote-security-action';
  github.context.payload = {
    pull_request: {
      number: 8,
    },
  };

  const createReviewCalls: Array<Record<string, unknown>> = [];
  const reactionCalls: Array<Record<string, unknown>> = [];

  const octokit = {
    rest: {
      pulls: {
        createReview: async (params: Record<string, unknown>) => {
          createReviewCalls.push(params);
          return { data: { id: 99 } };
        },
        listCommentsForReview: async () => {
          return {
            data: [{ id: 1001 }, { id: 1002 }],
          };
        },
      },
      reactions: {
        createForPullRequestReviewComment: async (
          params: Record<string, unknown>
        ) => {
          reactionCalls.push(params);
          if (params.comment_id === 1001 && params.content === '+1') {
            throw new Error('boom');
          }
          return {};
        },
      },
      issues: {
        createComment: async () => ({}),
      },
    },
  };

  try {
    await postViolationComments(
      octokit as never,
      [
        createViolation({
          location: {
            file: 'src/app.ts',
            line_start: 10,
            line_end: 12,
            side: 'RIGHT',
          },
          metadata: {
            suggested_fix: 'const secret = process.env.AWS_SECRET_ACCESS_KEY;',
            suggested_fix_line_start: 10,
            suggested_fix_line_end: 12,
          },
        }),
      ],
      'deadbeef'
    );
  } finally {
    process.env.GITHUB_REPOSITORY = originalRepository;
    github.context.payload = originalPayload;
  }

  assert.equal(createReviewCalls.length, 1);
  assert.equal(
    createReviewCalls[0].body,
    'Asymptote security scan has reviewed your changes and found 1 potential vulnerability.'
  );
  const reviewComments = createReviewCalls[0]
    .comments as Array<Record<string, unknown>>;
  assert.equal(reviewComments.length, 1);
  assert.equal(reviewComments[0].path, 'src/app.ts');
  assert.equal(reviewComments[0].line, 12);
  assert.equal(reviewComments[0].start_line, 10);
  assert.equal(reviewComments[0].start_side, 'RIGHT');
  assert.equal(reviewComments[0].side, 'RIGHT');

  assert.deepEqual(
    reactionCalls.map((call) => [call.comment_id, call.content]),
    [
      [1001, '+1'],
      [1001, '-1'],
      [1002, '+1'],
      [1002, '-1'],
    ]
  );
});
