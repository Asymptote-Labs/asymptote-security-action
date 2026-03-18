import { Severity, Violation } from '../api/types';

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
 * Get severity icon for display when the label is rendered separately.
 */
export function getSeverityIcon(severity: Severity): string {
  const icons: Record<Severity, string> = {
    critical: '🔴',
    high: '🟠',
    medium: '🟡',
    low: '🔵',
    info: 'ℹ️',
  };
  return icons[severity] || severity;
}
