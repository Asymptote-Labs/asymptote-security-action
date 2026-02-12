import { Severity, Violation } from '../api/types';

/**
 * Severity levels in order from most to least severe
 */
export const SEVERITY_ORDER: Severity[] = [
  'critical',
  'high',
  'medium',
  'low',
  'info',
];

/**
 * Get the numeric priority of a severity level (lower = more severe)
 */
export function getSeverityPriority(severity: Severity): number {
  const index = SEVERITY_ORDER.indexOf(severity);
  return index === -1 ? SEVERITY_ORDER.length : index;
}

/**
 * Check if a violation meets the minimum severity threshold
 */
export function meetsThreshold(
  violationSeverity: Severity,
  threshold: Severity
): boolean {
  return getSeverityPriority(violationSeverity) <= getSeverityPriority(threshold);
}

/**
 * Filter violations that meet the minimum severity threshold
 */
export function filterByThreshold(
  violations: Violation[],
  threshold: Severity
): Violation[] {
  return violations.filter((v) => meetsThreshold(v.severity, threshold));
}

/**
 * Check if any violations meet the failure threshold
 */
export function shouldFail(
  violations: Violation[],
  failOnThreshold: Severity
): boolean {
  return violations.some((v) => meetsThreshold(v.severity, failOnThreshold));
}

/**
 * Count violations by severity
 */
export function countBySeverity(
  violations: Violation[]
): Record<Severity, number> {
  const counts: Record<Severity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };

  for (const violation of violations) {
    if (violation.severity in counts) {
      counts[violation.severity]++;
    }
  }

  return counts;
}

/**
 * Get severity badge for display
 */
export function getSeverityBadge(severity: Severity): string {
  const badges: Record<Severity, string> = {
    critical: '🔴 Critical',
    high: '🟠 High',
    medium: '🟡 Medium',
    low: '🔵 Low',
    info: 'ℹ️ Info',
  };
  return badges[severity] || severity;
}

/**
 * Validate severity string input
 */
export function parseSeverity(input: string): Severity {
  const normalized = input.toLowerCase().trim() as Severity;
  if (SEVERITY_ORDER.includes(normalized)) {
    return normalized;
  }
  throw new Error(
    `Invalid severity: ${input}. Must be one of: ${SEVERITY_ORDER.join(', ')}`
  );
}
