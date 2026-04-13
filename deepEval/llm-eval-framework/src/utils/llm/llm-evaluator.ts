/**
 * LLM Response Evaluator — TypeScript Integration with DeepEval
 *
 * Evaluates LLM responses from TypeScript tests using DeepEval
 * metrics running in Python.
 *
 * Usage:
 *   import { evaluateLLMResponse } from './utils/llm/llm-evaluator';
 *
 *   const result = await evaluateLLMResponse({
 *     input: userPrompt,
 *     output: claudeResponse,
 *     metrics: ['relevancy', 'completeness'],
 *   });
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import process from 'process';

const execAsync = promisify(exec);

// ============================================================================
// TYPES
// ============================================================================

export type MetricName =
  | 'relevancy'
  | 'hallucination'
  | 'faithfulness'
  | 'toxicity'
  | 'bias'
  | 'completeness'
  | 'coherence'
  | 'technical';

export interface EvaluationRequest {
  input: string;
  output: string;
  expected?: string;
  context?: string[];
  /** Raw data returned by tools before LLM narration — used for faithfulness/hallucination metrics */
  retrieval_context?: string[];
  metrics?: MetricName[];
  thresholds?: Record<string, number>;
}

export interface MetricResult {
  score: number;
  threshold: number;
  success: boolean;
  reason?: string;
  error?: string;
}

export interface EvaluationResult {
  success: boolean;
  passed: boolean;
  overall_score: number;
  metrics: Record<string, MetricResult>;
  error?: string;
}

// ============================================================================
// EVALUATOR
// ============================================================================

/**
 * Evaluate LLM response using DeepEval metrics
 */
export async function evaluateLLMResponse(
  request: EvaluationRequest
): Promise<EvaluationResult> {
  const {
    input,
    output,
    expected,
    context,
    retrieval_context,
    metrics = ['relevancy', 'completeness'],
    thresholds,
  } = request;

  const tempDir = os.tmpdir();
  const requestFile = path.join(tempDir, `llm-eval-${Date.now()}.json`);
  const resultFile = path.join(tempDir, `llm-result-${Date.now()}.json`);

  try {
    await fs.writeFile(
      requestFile,
      JSON.stringify({ input, output, expected, context, retrieval_context, metrics, thresholds }, null, 2)
    );

    const pythonScript = path.join(process.cwd(), 'evaluate_response.py');
    const command = `python "${pythonScript}" --json-file "${requestFile}" --output-file "${resultFile}" --pretty`;
    console.log(`🚀 Evaluating with DeepEval: ${metrics.join(', ')}`);

    try {
      await execAsync(command, {
        timeout: 60000,
        maxBuffer: 10 * 1024 * 1024,
      });
    } catch (error: any) {
      const resultExists = await fs.access(resultFile).then(() => true).catch(() => false);
      if (!resultExists) throw error;
    }

    const resultContent = await fs.readFile(resultFile, 'utf-8');
    const result: EvaluationResult = JSON.parse(resultContent);

    await fs.unlink(requestFile).catch(() => {});
    await fs.unlink(resultFile).catch(() => {});

    return result;

  } catch (error: any) {
    await fs.unlink(requestFile).catch(() => {});
    await fs.unlink(resultFile).catch(() => {});

    return {
      success: false,
      passed: false,
      overall_score: 0,
      metrics: {},
      error: error.message || String(error),
    };
  }
}

/**
 * Quick check if response passes basic quality thresholds
 */
export async function assertResponseQuality(
  input: string,
  output: string,
  options: {
    minRelevancy?: number;
    minCompleteness?: number;
    maxHallucination?: number;
  } = {}
): Promise<void> {
  const {
    minRelevancy = 0.7,
    minCompleteness = 0.7,
    maxHallucination = 0.5,
  } = options;

  const result = await evaluateLLMResponse({
    input,
    output,
    metrics: ['relevancy', 'completeness', 'hallucination'],
    thresholds: {
      relevancy: minRelevancy,
      completeness: minCompleteness,
      hallucination: maxHallucination,
    },
  });

  if (!result.success) {
    throw new Error(`Evaluation failed: ${result.error}`);
  }

  if (!result.passed) {
    const failures = Object.entries(result.metrics)
      .filter(([_, metric]) => !metric.success)
      .map(([name, metric]) => `${name}: ${metric.score.toFixed(2)} (threshold: ${metric.threshold})`)
      .join(', ');
    throw new Error(`Response quality check failed: ${failures}`);
  }
}

/**
 * Evaluate conversation context retention
 */
export async function evaluateConversationContext(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  options: { minCoherence?: number } = {}
): Promise<EvaluationResult> {
  const { minCoherence = 0.7 } = options;

  const userMessages = messages.filter(m => m.role === 'user');
  const assistantMessages = messages.filter(m => m.role === 'assistant');

  if (userMessages.length === 0 || assistantMessages.length === 0) {
    throw new Error('Conversation must have at least one user and assistant message');
  }

  const lastUserMessage = userMessages[userMessages.length - 1].content;
  const lastAssistantMessage = assistantMessages[assistantMessages.length - 1].content;
  const context = userMessages.slice(0, -1).map(m => m.content);

  return evaluateLLMResponse({
    input: lastUserMessage,
    output: lastAssistantMessage,
    context,
    metrics: ['relevancy', 'coherence'],
    thresholds: { coherence: minCoherence },
  });
}

// ============================================================================
// BATCH EVALUATION
// ============================================================================

export interface BatchEvaluationRequest {
  cases: Array<{
    input: string;
    output: string;
    expected?: string;
  }>;
  metrics?: MetricName[];
  thresholds?: Record<string, number>;
}

export interface BatchEvaluationResult {
  success: boolean;
  passed: boolean;
  total: number;
  passed_count: number;
  failed_count: number;
  average_score: number;
  results: EvaluationResult[];
}

/**
 * Evaluate multiple responses in batch
 */
export async function evaluateBatch(
  request: BatchEvaluationRequest
): Promise<BatchEvaluationResult> {
  const { cases, metrics, thresholds } = request;

  const results = await Promise.all(
    cases.map(testCase =>
      evaluateLLMResponse({
        input: testCase.input,
        output: testCase.output,
        expected: testCase.expected,
        metrics,
        thresholds,
      })
    )
  );

  const passedCount = results.filter(r => r.passed).length;
  const totalScore = results.reduce((sum, r) => sum + r.overall_score, 0);

  return {
    success: results.every(r => r.success),
    passed: results.every(r => r.passed),
    total: results.length,
    passed_count: passedCount,
    failed_count: results.length - passedCount,
    average_score: totalScore / results.length,
    results,
  };
}

// ============================================================================
// HELPER UTILITIES
// ============================================================================

export async function isDeepEvalAvailable(): Promise<boolean> {
  try {
    const pythonScript = path.join(process.cwd(), 'evaluate_response.py');
    await fs.access(pythonScript);
    await execAsync('python --version', { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export function getAvailableMetrics(): MetricName[] {
  return ['relevancy', 'hallucination', 'faithfulness', 'toxicity', 'bias', 'completeness', 'coherence', 'technical'];
}

export function getDefaultThresholds(): Record<MetricName, number> {
  return {
    relevancy: 0.7,
    hallucination: 0.5,
    faithfulness: 0.7,
    toxicity: 0.3,
    bias: 0.3,
    completeness: 0.7,
    coherence: 0.7,
    technical: 0.75,
  };
}
