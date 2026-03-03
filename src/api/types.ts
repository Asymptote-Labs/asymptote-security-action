/**
 * API types for Asymptote Edge service
 * Based on backend/services/asymptote-edge/asymptote_edge/main.py
 */

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type Decision = 'allow' | 'warn' | 'block';
export type EvaluationStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface RepositoryInfo {
  owner?: string;
  name?: string;
  default_branch?: string;
}

export interface FileInfo {
  path: string;
  language?: string;
  content_before?: string;
  content_after?: string;
}

export interface EvaluationContext {
  surface?: 'codegen' | 'ci' | 'ide' | 'agent';
  tool?: string;
  generation_id?: string;
  pr_number?: number;
  commit_sha?: string;
  pr_author?: string;
}

export interface EvaluateDiffRequest {
  diff: string;
  external_session_id?: string;
  repository?: RepositoryInfo;
  files?: FileInfo[];
  context?: EvaluationContext;
}

export interface EvaluateDiffResponse {
  evaluation_id: string;
  status: EvaluationStatus;
}

export interface ViolationLocation {
  file: string;
  line_start: number;
  line_end: number;
  side?: 'LEFT' | 'RIGHT';
}

export interface ViolationMetadata {
  cwe_id?: string;
  suggested_fix?: string;
  suggested_fix_line_start?: number;
  suggested_fix_line_end?: number;
  [key: string]: unknown;
}

export interface SuggestedFix {
  violation_id: string;
  suggested_fix: string;
  line_start: number;
  line_end: number;
}

export interface Violation {
  id: string;
  policy_id: string | null;
  policy_name: string;
  category: string;
  severity: Severity;
  enforcement: string;
  location: ViolationLocation;
  message: string;
  explanation: string;
  remediation: string;
  metadata: ViolationMetadata;
}

export interface EvaluationSummary {
  total_violations: number;
  by_severity: Record<string, number>;
  policies_evaluated?: number;
  evaluation_time_ms?: number;
}

export interface GetEvaluationResponse {
  evaluation_id: string;
  status: EvaluationStatus;
  decision?: Decision;
  violations?: Violation[];
  summary?: EvaluationSummary;
  error_message?: string;
}
