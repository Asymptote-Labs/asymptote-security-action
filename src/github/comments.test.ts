import test from 'node:test';
import assert from 'node:assert/strict';
import { Violation } from '../api/types';
import { formatViolationComment } from './comments';

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
    /🟠 High \/ \*\*Policy:\*\* Hardcoded Secret/
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
    /<a href="https:\/\/asymptotelabs\.ai\/dashboard\/vulnerabilities\/violation-123"[^>]*><img src="https:\/\/asymptotelabs\.ai\/logo\.png" alt="Asymptote" width="16" height="16" align="absmiddle"> View in dashboard<\/a>/
  );
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
