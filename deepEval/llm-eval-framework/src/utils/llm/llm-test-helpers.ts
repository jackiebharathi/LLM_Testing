/**
 * LLM Test Helpers
 * Utility functions for LLM testing
 * Provides reusable helpers for common testing operations
 */

import { expect } from '@playwright/test';
import type { EvaluationResult } from './llm-evaluator';
import { LLM_THRESHOLDS } from '../../config/llm-config';

// ============================================================================
// EVALUATION RESULT HELPERS
// ============================================================================

/**
 * Log evaluation results in a formatted way
 */
export function logEvaluationResults(evaluation: EvaluationResult, testName?: string): void {
  const header = testName ? `\n📊 ${testName} - Evaluation Results:` : '\n📊 Evaluation Results:';
  console.log(header);
  console.log(`Overall Score: ${evaluation.overall_score.toFixed(2)}`);

  for (const [metricName, metric] of Object.entries(evaluation.metrics)) {
    if (metric.error) {
      console.log(`${metricName}: ERROR - ${metric.error}`);
    } else {
      const icon = metric.success ? '✓' : '✗';
      console.log(`${metricName}: ${metric.score.toFixed(2)} ${icon} (threshold: ${metric.threshold})`);
      if (metric.reason) {
        console.log(`  Reason: ${metric.reason}`);
      }
    }
  }
}

export function evaluationPassedAll(evaluation: EvaluationResult): boolean {
  return evaluation.passed && evaluation.success;
}

export function getFailedMetrics(evaluation: EvaluationResult): string[] {
  return Object.entries(evaluation.metrics)
    .filter(([_, metric]) => !metric.success)
    .map(([name]) => name);
}

export function getPassingMetrics(evaluation: EvaluationResult): string[] {
  return Object.entries(evaluation.metrics)
    .filter(([_, metric]) => metric.success)
    .map(([name]) => name);
}

export function getAverageScore(evaluation: EvaluationResult): number {
  return evaluation.overall_score;
}

export function getMetricScore(evaluation: EvaluationResult, metricName: string): number | undefined {
  return evaluation.metrics[metricName]?.score;
}

// ============================================================================
// ASSERTION HELPERS
// ============================================================================

export function assertEvaluationPassed(evaluation: EvaluationResult, testContext?: string): void {
  const context = testContext ? ` [${testContext}]` : '';

  if (!evaluation.success) {
    throw new Error(`Evaluation failed${context}: ${evaluation.error || 'Unknown error'}`);
  }

  if (!evaluation.passed) {
    const failed = getFailedMetrics(evaluation);
    const details = failed
      .map(name => {
        const metric = evaluation.metrics[name];
        return `${name}: ${metric.score.toFixed(2)} (threshold: ${metric.threshold})`;
      })
      .join(', ');
    throw new Error(`Quality check failed${context}: ${details}`);
  }
}

export function assertMetricPassed(
  evaluation: EvaluationResult,
  metricName: string,
  customMessage?: string
): void {
  const metric = evaluation.metrics[metricName];

  if (!metric) throw new Error(`Metric not found: ${metricName}`);
  if (metric.error) throw new Error(`Metric ${metricName} error: ${metric.error}`);

  if (!metric.success) {
    const message = customMessage ||
      `Metric ${metricName} failed: score ${metric.score.toFixed(2)} < threshold ${metric.threshold}`;
    throw new Error(message);
  }
}

export function assertMinimumScore(
  evaluation: EvaluationResult,
  minScore: number,
  testContext?: string
): void {
  const context = testContext ? ` [${testContext}]` : '';
  if (evaluation.overall_score < minScore) {
    throw new Error(
      `Overall score below minimum${context}: ${evaluation.overall_score.toFixed(2)} < ${minScore}`
    );
  }
}

// ============================================================================
// BATCH EVALUATION HELPERS
// ============================================================================

export function calculateBatchStatistics(results: EvaluationResult[]): {
  totalTests: number;
  passedTests: number;
  failedTests: number;
  averageScore: number;
  minScore: number;
  maxScore: number;
  passRate: number;
} {
  const totalTests = results.length;
  const passedTests = results.filter(r => r.passed).length;
  const failedTests = totalTests - passedTests;
  const scores = results.map(r => r.overall_score);
  const averageScore = scores.reduce((sum, score) => sum + score, 0) / totalTests;
  const minScore = Math.min(...scores);
  const maxScore = Math.max(...scores);
  const passRate = passedTests / totalTests;

  return { totalTests, passedTests, failedTests, averageScore, minScore, maxScore, passRate };
}

export function logBatchStatistics(results: EvaluationResult[], batchName?: string): void {
  const stats = calculateBatchStatistics(results);
  const header = batchName ? `\n📊 ${batchName} - Batch Statistics:` : '\n📊 Batch Statistics:';

  console.log(header);
  console.log(`Total Tests: ${stats.totalTests}`);
  console.log(`Passed: ${stats.passedTests} ✓`);
  console.log(`Failed: ${stats.failedTests} ✗`);
  console.log(`Pass Rate: ${(stats.passRate * 100).toFixed(1)}%`);
  console.log(`Average Score: ${stats.averageScore.toFixed(2)}`);
  console.log(`Score Range: ${stats.minScore.toFixed(2)} - ${stats.maxScore.toFixed(2)}`);
}

// ============================================================================
// COMPARISON HELPERS
// ============================================================================

export function compareEvaluations(
  eval1: EvaluationResult,
  eval2: EvaluationResult
): {
  better: 'first' | 'second' | 'equal';
  scoreDifference: number;
  improvedMetrics: string[];
  degradedMetrics: string[];
} {
  const scoreDiff = eval1.overall_score - eval2.overall_score;
  let better: 'first' | 'second' | 'equal' = 'equal';

  if (Math.abs(scoreDiff) > 0.01) {
    better = scoreDiff > 0 ? 'first' : 'second';
  }

  const improvedMetrics: string[] = [];
  const degradedMetrics: string[] = [];

  for (const metricName of Object.keys(eval1.metrics)) {
    const score1 = eval1.metrics[metricName]?.score ?? 0;
    const score2 = eval2.metrics[metricName]?.score ?? 0;
    const diff = score1 - score2;
    if (diff > 0.01) improvedMetrics.push(metricName);
    if (diff < -0.01) degradedMetrics.push(metricName);
  }

  return { better, scoreDifference: scoreDiff, improvedMetrics, degradedMetrics };
}

// ============================================================================
// THRESHOLD HELPERS
// ============================================================================

export function getDefaultThreshold(metricName: string): number {
  return LLM_THRESHOLDS[metricName as keyof typeof LLM_THRESHOLDS] ?? 0.7;
}

export function createThresholdsFromMetrics(metrics: string[]): Record<string, number> {
  const thresholds: Record<string, number> = {};
  for (const metric of metrics) {
    thresholds[metric] = getDefaultThreshold(metric);
  }
  return thresholds;
}

export function overrideThresholds(
  baseThresholds: Record<string, number>,
  overrides: Record<string, number>
): Record<string, number> {
  return { ...baseThresholds, ...overrides };
}

// ============================================================================
// TEXT PROCESSING HELPERS
// ============================================================================

export function truncateText(text: string, maxLength: number = 100): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

export function extractKeyInfo(text: string): {
  length: number;
  wordCount: number;
  hasCodeBlocks: boolean;
  hasLinks: boolean;
  hasBulletPoints: boolean;
} {
  return {
    length: text.length,
    wordCount: text.split(/\s+/).length,
    hasCodeBlocks: /```/.test(text),
    hasLinks: /https?:\/\//.test(text),
    hasBulletPoints: /^[\s]*[-*•]/m.test(text),
  };
}

// ============================================================================
// PLAYWRIGHT ASSERTION HELPERS
// ============================================================================

export function expectEvaluationPassed(evaluation: EvaluationResult): void {
  expect(evaluation.success, 'Evaluation completed successfully').toBe(true);
  expect(evaluation.passed, 'All metrics passed thresholds').toBe(true);
}

export function expectMetricPassed(evaluation: EvaluationResult, metricName: string): void {
  const metric = evaluation.metrics[metricName];
  expect(metric, `Metric ${metricName} exists`).toBeDefined();
  expect(metric.success, `Metric ${metricName} passed`).toBe(true);
}

export function expectMinimumScore(evaluation: EvaluationResult, minScore: number): void {
  expect(evaluation.overall_score).toBeGreaterThanOrEqual(minScore);
}
