import * as core from '@actions/core';
import { Severity } from './api/types';
import { parseSeverity } from './utils/severity';

export interface Config {
  apiKey: string;
  apiUrl: string;
  failOn: Severity;
  commentOn: Severity;
  excludePaths: string[];
}

/**
 * Parse and validate action inputs
 */
export function getConfig(): Config {
  const apiKey = core.getInput('asymptote_api_key', { required: true });
  if (!apiKey) {
    throw new Error('asymptote_api_key is required');
  }

  const apiUrl =
    core.getInput('asymptote_api_url') ||
    'https://asymptote-edge-579124726252.us-west1.run.app';

  const failOnInput = core.getInput('fail_on') || 'high';
  const commentOnInput = core.getInput('comment_on') || 'high';
  const excludePathsInput = core.getInput('exclude_paths') || '';

  const excludePaths = excludePathsInput
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const failOn = parseSeverity(failOnInput);
  const commentOn = parseSeverity(commentOnInput);

  return {
    apiKey,
    apiUrl,
    failOn,
    commentOn,
    excludePaths,
  };
}
