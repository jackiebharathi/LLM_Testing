/* eslint-disable no-console, playwright/expect-expect */
/**
 * Response Quality Tests
 *
 * Evaluates Claude's response quality using DeepEval metrics.
 * Tests run against the Anthropic API directly — no browser UI needed.
 *
 * Strategy:
 * - Send a prompt to Claude via API
 * - Evaluate the response with DeepEval metric combinations
 * - Report metrics as INFORMATIONAL (never hard-fail on LLM score)
 *
 * Metrics tested:
 * - relevancy, completeness, coherence, technical (comprehensive)
 * - technical, relevancy (technical accuracy)
 * - toxicity, bias (safety)
 */

import { test } from '../src/fixtures/llm.fixture';
import { llmTestPrompts } from '../src/utils/testData/chatPrompts';
import { METRIC_COMBINATIONS } from '../src/config/llm-config';
import { logEvaluationResults } from '../src/utils/llm/llm-test-helpers';

// ============================================================================
// TEST SUITE
// ============================================================================

test.describe('Response Quality', () => {

  test('should evaluate quality metrics (relevancy, completeness, coherence, technical)', async ({ llmChat, evaluate }) => {
    test.setTimeout(180000); // 3 minutes: API call + DeepEval evaluation

    const prompt = llmTestPrompts.completenessTest;
    const response = await llmChat.sendPromptAndCapture(prompt);

    console.log(`\n📝 Prompt: ${prompt}`);
    console.log(`📨 Response length: ${response.length} chars`);

    const evaluation = await evaluate(prompt, response, METRIC_COMBINATIONS.COMPREHENSIVE);
    logEvaluationResults(evaluation, 'Quality Metrics');

    console.log(`\n✅ Quality evaluation completed`);
    console.log(`   Overall: ${evaluation.passed ? 'PASS' : 'INFORMATIONAL'}`);
  });

  test('should evaluate technical accuracy', async ({ llmChat, evaluate }) => {
    test.setTimeout(180000);

    const prompt = llmTestPrompts.technicalAccuracyTest;
    const response = await llmChat.sendPromptAndCapture(prompt);

    console.log(`\n📝 Prompt: ${prompt}`);
    console.log(`📨 Response length: ${response.length} chars`);

    const evaluation = await evaluate(prompt, response, ['technical', 'relevancy']);
    logEvaluationResults(evaluation, 'Technical Accuracy');

    console.log(`\n✅ Technical accuracy evaluation completed`);
    console.log(`   Overall: ${evaluation.passed ? 'PASS' : 'INFORMATIONAL'}`);
  });

  test('should evaluate safety and bias in responses', async ({ llmChat, evaluate }) => {
    test.setTimeout(180000);

    const prompt = llmTestPrompts.safetyTest;
    const response = await llmChat.sendPromptAndCapture(prompt);

    console.log(`\n📝 Prompt: ${prompt}`);
    console.log(`📨 Response length: ${response.length} chars`);

    const evaluation = await evaluate(prompt, response, METRIC_COMBINATIONS.SAFETY);
    logEvaluationResults(evaluation, 'Safety & Ethics');

    console.log(`\n✅ Safety & ethics evaluation completed`);
    console.log(`   Overall: ${evaluation.passed ? 'PASS' : 'INFORMATIONAL'}`);
  });

});
