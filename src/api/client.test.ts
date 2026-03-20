import test from 'node:test';
import assert from 'node:assert/strict';
import {
  shouldSkipLegacyActionForIntegration,
  RepositoryIntegrationModeResponse,
} from './client';

function createIntegrationModeResponse(
  overrides: Partial<RepositoryIntegrationModeResponse> = {}
): RepositoryIntegrationModeResponse {
  return {
    repository_id: 'repo_123',
    found: true,
    integration_mode: 'legacy_action',
    ...overrides,
  };
}

test('skips the legacy action only for found github_app repositories', () => {
  assert.equal(
    shouldSkipLegacyActionForIntegration(
      createIntegrationModeResponse({ integration_mode: 'github_app' })
    ),
    true
  );

  assert.equal(
    shouldSkipLegacyActionForIntegration(
      createIntegrationModeResponse({ found: false, integration_mode: 'github_app' })
    ),
    false
  );

  assert.equal(
    shouldSkipLegacyActionForIntegration(createIntegrationModeResponse()),
    false
  );
});
