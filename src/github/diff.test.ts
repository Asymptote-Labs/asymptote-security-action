import test from 'node:test';
import assert from 'node:assert/strict';
import * as github from '@actions/github';
import { getPRDiff } from './diff';

test('fetches all changed files across paginated PR file results', async () => {
  const originalRepository = process.env.GITHUB_REPOSITORY;
  const originalPayload = github.context.payload;

  process.env.GITHUB_REPOSITORY =
    'Asymptote-Labs/asymptote-security-action';

  github.context.payload = {
    pull_request: {
      number: 42,
      head: { sha: 'head-sha' },
      base: { sha: 'base-sha' },
    },
  };

  const files = Array.from({ length: 205 }, (_, index) => ({
    filename: `src/file-${index}.ts`,
  }));

  let paginationCalled = false;
  const requestedPages: number[] = [];

  const listFiles = async ({ page = 1 }: { page?: number }) => {
    requestedPages.push(page);
    return {
      data: files.slice((page - 1) * 100, page * 100),
    };
  };

  const octokit = {
    rest: {
      pulls: {
        get: async () => ({
          data: 'diff --git a/src/file-0.ts b/src/file-0.ts',
        }),
        listFiles,
      },
    },
    paginate: async (
      endpoint: unknown,
      params: Record<string, unknown>
    ) => {
      paginationCalled = true;

      assert.equal(endpoint, listFiles);
      assert.deepEqual(params, {
        owner: 'Asymptote-Labs',
        repo: 'asymptote-security-action',
        pull_number: 42,
        per_page: 100,
      });

      const fetchPage = endpoint as typeof listFiles;
      const results = [];

      for (const page of [1, 2, 3]) {
        const response = await fetchPage({ ...params, page });
        results.push(...response.data);
      }

      return results;
    },
  };

  try {
    const result = await getPRDiff(octokit as never);

    assert.equal(paginationCalled, true);
    assert.deepEqual(requestedPages, [1, 2, 3]);
    assert.equal(result.files.length, 205);
    assert.equal(result.files[0].path, 'src/file-0.ts');
    assert.equal(result.files[204].path, 'src/file-204.ts');
    assert.equal(result.files[0].language, 'typescript');
    assert.equal(result.prNumber, 42);
    assert.equal(result.commitSha, 'head-sha');
    assert.equal(result.baseSha, 'base-sha');
  } finally {
    if (originalRepository === undefined) {
      delete process.env.GITHUB_REPOSITORY;
    } else {
      process.env.GITHUB_REPOSITORY = originalRepository;
    }
    github.context.payload = originalPayload;
  }
});
