import * as core from '@actions/core';
import * as github from '@actions/github';
import { FileInfo } from '../api/types';
import { matchesAnyPattern, filterDiff } from '../utils/glob';

type Octokit = ReturnType<typeof github.getOctokit>;

export interface PRDiffResult {
  diff: string;
  files: FileInfo[];
  prNumber: number;
  commitSha: string;
  baseSha: string;
}

export async function getPRDiff(
  octokit: Octokit,
  excludePaths: string[] = []
): Promise<PRDiffResult> {
  const { owner, repo } = github.context.repo;
  const prNumber = github.context.payload.pull_request?.number;

  if (!prNumber) {
    throw new Error('Could not determine PR number from context');
  }

  const commitSha = github.context.payload.pull_request?.head?.sha;
  const baseSha = github.context.payload.pull_request?.base?.sha;

  if (!commitSha || !baseSha) {
    throw new Error('Could not determine commit SHAs from PR context');
  }

  core.debug(`Fetching diff for PR #${prNumber} (${baseSha}...${commitSha})`);

  // Fetch the unified diff using the diff media type
  const diffResponse = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
    mediaType: {
      format: 'diff',
    },
  });

  // The response data is the raw diff string when using diff format
  let diff = diffResponse.data as unknown as string;

  // Fetch file list for metadata
  const filesResponse = await octokit.rest.pulls.listFiles({
    owner,
    repo,
    pull_number: prNumber,
    per_page: 100,
  });

  let files: FileInfo[] = filesResponse.data.map((file: { filename: string }) => ({
    path: file.filename,
    language: getLanguageFromFilename(file.filename),
  }));

  // Filter out excluded paths
  if (excludePaths.length > 0) {
    const originalFileCount = files.length;
    files = files.filter((f) => !matchesAnyPattern(f.path, excludePaths));
    diff = filterDiff(diff, excludePaths);

    const excludedCount = originalFileCount - files.length;
    if (excludedCount > 0) {
      core.info(`Excluded ${excludedCount} files matching exclude patterns`);
    }
  }

  core.info(`Fetched diff with ${files.length} files to scan`);

  return {
    diff,
    files,
    prNumber,
    commitSha,
    baseSha,
  };
}

export async function getIncrementalDiff(
  octokit: Octokit,
  beforeSha: string,
  afterSha: string,
  excludePaths: string[] = []
): Promise<PRDiffResult> {
  const { owner, repo } = github.context.repo;
  const prNumber = github.context.payload.pull_request?.number;

  if (!prNumber) {
    throw new Error('Could not determine PR number from context');
  }

  const baseSha = github.context.payload.pull_request?.base?.sha;
  if (!baseSha) {
    throw new Error('Could not determine base SHA from PR context');
  }

  core.debug(`Fetching incremental diff (${beforeSha}...${afterSha})`);

  // Fetch the diff between the two commits
  const compareResponse = await octokit.rest.repos.compareCommitsWithBasehead({
    owner,
    repo,
    basehead: `${beforeSha}...${afterSha}`,
    mediaType: {
      format: 'diff',
    },
  });

  let diff = compareResponse.data as unknown as string;

  // Fetch comparison again for file metadata (JSON format)
  const filesResponse = await octokit.rest.repos.compareCommitsWithBasehead({
    owner,
    repo,
    basehead: `${beforeSha}...${afterSha}`,
  });

  let files: FileInfo[] = (filesResponse.data.files || []).map(
    (file: { filename: string }) => ({
      path: file.filename,
      language: getLanguageFromFilename(file.filename),
    })
  );

  // Filter out excluded paths
  if (excludePaths.length > 0) {
    const originalFileCount = files.length;
    files = files.filter((f) => !matchesAnyPattern(f.path, excludePaths));
    diff = filterDiff(diff, excludePaths);

    const excludedCount = originalFileCount - files.length;
    if (excludedCount > 0) {
      core.info(`Excluded ${excludedCount} files matching exclude patterns`);
    }
  }

  core.info(
    `Fetched incremental diff with ${files.length} files to scan`
  );

  return {
    diff,
    files,
    prNumber,
    commitSha: afterSha,
    baseSha,
  };
}

function getLanguageFromFilename(filename: string): string | undefined {
  const ext = filename.split('.').pop()?.toLowerCase();
  const languageMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    py: 'python',
    rb: 'ruby',
    go: 'go',
    rs: 'rust',
    java: 'java',
    kt: 'kotlin',
    swift: 'swift',
    cs: 'csharp',
    cpp: 'cpp',
    c: 'c',
    h: 'c',
    hpp: 'cpp',
    php: 'php',
    sql: 'sql',
    sh: 'bash',
    bash: 'bash',
    yaml: 'yaml',
    yml: 'yaml',
    json: 'json',
    md: 'markdown',
    html: 'html',
    css: 'css',
    scss: 'scss',
  };
  return ext ? languageMap[ext] : undefined;
}
