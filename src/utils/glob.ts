/**
 * Simple glob pattern matching for file paths
 */

/**
 * Convert a glob pattern to a RegExp
 */
function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape special regex chars except * and ?
    .replace(/\*\*/g, '{{GLOBSTAR}}') // Temp placeholder for **
    .replace(/\*/g, '[^/]*') // * matches anything except /
    .replace(/\?/g, '[^/]') // ? matches single char except /
    .replace(/\{\{GLOBSTAR\}\}/g, '.*'); // ** matches everything including /

  return new RegExp(`^${escaped}$`);
}

/**
 * Check if a file path matches a glob pattern
 */
export function matchesPattern(filePath: string, pattern: string): boolean {
  const regex = globToRegex(pattern);
  return regex.test(filePath);
}

/**
 * Check if a file path matches any of the given glob patterns
 */
export function matchesAnyPattern(
  filePath: string,
  patterns: string[]
): boolean {
  return patterns.some((pattern) => matchesPattern(filePath, pattern));
}

/**
 * Filter a unified diff to exclude files matching the given patterns
 */
export function filterDiff(diff: string, excludePatterns: string[]): string {
  if (excludePatterns.length === 0) {
    return diff;
  }

  const lines = diff.split('\n');
  const resultLines: string[] = [];
  let skipCurrentFile = false;

  for (const line of lines) {
    // Detect start of a new file diff
    // Format: "diff --git a/path/to/file b/path/to/file"
    if (line.startsWith('diff --git ')) {
      const match = line.match(/diff --git a\/(.+) b\/(.+)/);
      // Use the "b" path (new file path) for matching
      skipCurrentFile = match
        ? matchesAnyPattern(match[2], excludePatterns)
        : false;
    }

    if (!skipCurrentFile) {
      resultLines.push(line);
    }
  }

  return resultLines.join('\n');
}
