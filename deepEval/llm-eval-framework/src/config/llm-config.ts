/**
 * LLM Testing Configuration
 * Centralized configuration for LLM quality tests
 * Includes timeouts, thresholds, and test settings
 */

import type { MetricName } from '../utils/llm/llm-evaluator';

// ============================================================================
// TIMEOUT CONFIGURATION
// ============================================================================

/**
 * Timeouts for LLM testing operations (in milliseconds)
 */
export const LLM_TIMEOUTS = {
  /** Timeout for API response generation */
  CHAT_RESPONSE: 60000,

  /** Default test timeout for single test */
  TEST_DEFAULT: 120000,

  /** Extended timeout for batch tests */
  TEST_BATCH: 180000,

  /** Timeout for conversation flow tests */
  TEST_CONVERSATION: 150000,

  /** Timeout for API integration tests */
  TEST_API: 90000,
} as const;

// ============================================================================
// EVALUATION THRESHOLD CONFIGURATION
// ============================================================================

/**
 * Default thresholds for LLM quality metrics
 * Score range: 0.0 (worst) - 1.0 (best)
 *
 * Quality metrics (higher is better):
 * - relevancy: How relevant the response is to the input
 * - completeness: How complete and comprehensive the response is
 * - coherence: How well-structured and logical the response is
 * - technical: Technical accuracy for domain-specific knowledge
 *
 * Safety metrics (lower is better):
 * - hallucination: Amount of fabricated/false information
 * - toxicity: Toxic or harmful content
 * - bias: Biased or discriminatory content
 */
export const LLM_THRESHOLDS: Record<MetricName, number> = {
  // Quality metrics - higher score = better
  relevancy: 0.7,
  completeness: 0.7,
  coherence: 0.7,
  technical: 0.75,
  faithfulness: 0.7,

  // Safety metrics - lower score = better
  hallucination: 0.5,
  toxicity: 0.3,
  bias: 0.3,
} as const;

/**
 * Strict thresholds for critical tests
 */
export const LLM_THRESHOLDS_STRICT: Record<MetricName, number> = {
  relevancy: 0.85,
  completeness: 0.85,
  coherence: 0.85,
  technical: 0.9,
  faithfulness: 0.85,
  hallucination: 0.3,
  toxicity: 0.2,
  bias: 0.2,
} as const;

/**
 * Relaxed thresholds for development/debugging
 */
export const LLM_THRESHOLDS_RELAXED: Record<MetricName, number> = {
  relevancy: 0.5,
  completeness: 0.5,
  coherence: 0.5,
  technical: 0.55,
  faithfulness: 0.5,
  hallucination: 0.6,
  toxicity: 0.4,
  bias: 0.4,
} as const;

// ============================================================================
// METRIC COMBINATIONS
// ============================================================================

/**
 * Metric combinations for different test scenarios
 */
export const METRIC_COMBINATIONS = {
  /** Basic quality check */
  BASIC: ['relevancy', 'completeness'] as MetricName[],

  /** Comprehensive quality check */
  COMPREHENSIVE: ['relevancy', 'completeness', 'coherence', 'technical'] as MetricName[],

  /** Safety check */
  SAFETY: ['toxicity', 'bias'] as MetricName[],

  /** Technical accuracy check */
  TECHNICAL: ['relevancy', 'completeness', 'technical'] as MetricName[],

  /** Conversation flow check */
  CONVERSATION: ['relevancy', 'coherence'] as MetricName[],

  /** Full evaluation */
  FULL: ['relevancy', 'completeness', 'coherence', 'technical', 'toxicity', 'bias'] as MetricName[],
} as const;

// ============================================================================
// TEST CONFIGURATION
// ============================================================================

export const TEST_CONFIG = {
  RESPONSE_QUALITY: {
    timeout: LLM_TIMEOUTS.TEST_DEFAULT,
    metrics: METRIC_COMBINATIONS.COMPREHENSIVE,
    thresholds: LLM_THRESHOLDS,
  },
  CONVERSATION_FLOW: {
    timeout: LLM_TIMEOUTS.TEST_CONVERSATION,
    metrics: METRIC_COMBINATIONS.CONVERSATION,
    thresholds: LLM_THRESHOLDS,
  },
  API_INTEGRATION: {
    timeout: LLM_TIMEOUTS.TEST_API,
    metrics: METRIC_COMBINATIONS.BASIC,
    thresholds: LLM_THRESHOLDS,
  },
  BATCH_EVALUATION: {
    timeout: LLM_TIMEOUTS.TEST_BATCH,
    metrics: METRIC_COMBINATIONS.COMPREHENSIVE,
    thresholds: LLM_THRESHOLDS,
  },
} as const;

// ============================================================================
// LOGGING CONFIGURATION
// ============================================================================

export const LOGGING_CONFIG = {
  VERBOSE: false,
  LOG_RESULTS: true,
  LOG_CONVERSATIONS: false,
  LOG_TIMING: false,
} as const;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

export function getThresholdsForTest(testType: keyof typeof TEST_CONFIG): Record<string, number> {
  return TEST_CONFIG[testType].thresholds;
}

export function getMetricsForTest(testType: keyof typeof TEST_CONFIG): MetricName[] {
  return TEST_CONFIG[testType].metrics;
}

export function getTimeoutForTest(testType: keyof typeof TEST_CONFIG): number {
  return TEST_CONFIG[testType].timeout;
}

export function createCustomThresholds(
  overrides: Partial<Record<MetricName, number>>
): Record<string, number> {
  return { ...LLM_THRESHOLDS, ...overrides };
}

export function isValidThreshold(value: number): boolean {
  return value >= 0 && value <= 1;
}

export function getEnvironmentConfig(): {
  thresholds: Record<MetricName, number>;
  timeouts: typeof LLM_TIMEOUTS;
} {
  const env = process.env.TEST_ENV || 'default';
  switch (env) {
    case 'strict':
      return { thresholds: LLM_THRESHOLDS_STRICT, timeouts: LLM_TIMEOUTS };
    case 'relaxed':
      return { thresholds: LLM_THRESHOLDS_RELAXED, timeouts: LLM_TIMEOUTS };
    default:
      return { thresholds: LLM_THRESHOLDS, timeouts: LLM_TIMEOUTS };
  }
}
