import * as core from '@actions/core';
import {
  EvaluateDiffRequest,
  EvaluateDiffResponse,
  GetEvaluationResponse,
  SuggestedFix,
} from './types';

const INITIAL_DELAY_MS = 1000;
const BACKOFF_MULTIPLIER = 1.5;
const MAX_DELAY_MS = 10000;
const MAX_ATTEMPTS = 30;
const TIMEOUT_MS = 120000;

interface ClientOptions {
  apiKey: string;
  baseUrl: string;
}

export class AsymptoteClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(options: ClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      if (response.status === 401) {
        throw new Error(
          'Invalid API key. Ensure your ASYMPTOTE_API_KEY is valid and has evaluate_diff scope.'
        );
      }
      if (response.status === 429) {
        throw new RateLimitError('Rate limited by Asymptote API');
      }
      throw new Error(
        `Asymptote API error (${response.status}): ${errorText}`
      );
    }

    return response.json() as Promise<T>;
  }

  async submitEvaluation(
    request: EvaluateDiffRequest
  ): Promise<EvaluateDiffResponse> {
    core.debug(`Submitting evaluation to ${this.baseUrl}/api/evaluate-diff`);
    return this.request<EvaluateDiffResponse>(
      'POST',
      '/api/evaluate-diff',
      request
    );
  }

  async getEvaluation(evaluationId: string): Promise<GetEvaluationResponse> {
    return this.request<GetEvaluationResponse>(
      'GET',
      `/api/evaluation/${evaluationId}`
    );
  }

  async evaluateWithPolling(
    request: EvaluateDiffRequest
  ): Promise<GetEvaluationResponse> {
    const submitResponse = await this.submitEvaluation(request);
    const evaluationId = submitResponse.evaluation_id;

    core.info(`Evaluation submitted: ${evaluationId}`);
    core.debug(`Initial status: ${submitResponse.status}`);

    const startTime = Date.now();
    let attempt = 0;
    let delay = INITIAL_DELAY_MS;

    while (attempt < MAX_ATTEMPTS) {
      if (Date.now() - startTime > TIMEOUT_MS) {
        throw new TimeoutError(
          `Evaluation timed out after ${TIMEOUT_MS / 1000}s`
        );
      }

      await this.sleep(delay);
      attempt++;

      core.debug(`Polling attempt ${attempt}/${MAX_ATTEMPTS}`);

      const result = await this.getEvaluation(evaluationId);

      if (result.status === 'completed') {
        core.info(`Evaluation completed: ${result.decision}`);
        return result;
      }

      if (result.status === 'failed') {
        throw new Error(
          `Evaluation failed: ${result.error_message || 'Unknown error'}`
        );
      }

      // Exponential backoff
      delay = Math.min(delay * BACKOFF_MULTIPLIER, MAX_DELAY_MS);
    }

    throw new TimeoutError(
      `Evaluation did not complete after ${MAX_ATTEMPTS} polling attempts`
    );
  }

  async getSuggestedFixes(
    evaluationId: string,
    diff: string
  ): Promise<SuggestedFix[]> {
    try {
      core.debug(`Requesting suggested fixes for evaluation ${evaluationId}`);
      const response = await this.request<{ fixes: SuggestedFix[] }>(
        'POST',
        `/api/evaluation/${evaluationId}/suggested-fixes`,
        { diff }
      );
      return response.fixes || [];
    } catch (error) {
      core.warning(
        `Failed to generate suggested fixes: ${error instanceof Error ? error.message : String(error)}`
      );
      return [];
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RateLimitError';
  }
}

export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}
