/* eslint-disable max-lines-per-function, no-console, playwright/expect-expect */
/**
 * Groq API Integration Tests
 *
 * Tests the Groq API (OpenAI-compatible) directly for:
 * - Basic message sending and response receiving
 * - Error handling (empty prompt, missing auth)
 * - Response time performance
 * - Streaming response validation
 * - Authentication enforcement
 * - Response structure consistency
 *
 * Philosophy: tests are INFORMATIONAL — they measure and log, not hard-fail.
 * A failed metric is a signal to investigate, not a broken build.
 */

import { test } from '../src/fixtures/llm.fixture';
import { evaluateLLMResponse } from '../src/utils/llm/llm-evaluator';
import { llmTestPrompts } from '../src/utils/testData/chatPrompts';

const BASE_URL = process.env.BASE_URL || 'https://api.groq.com';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

// ============================================================================
// TEST SUITE
// ============================================================================

test.describe('LLM API Integration', () => {

  // ==========================================================================
  // TEST: BASIC INTEGRATION
  // ==========================================================================

  test('should send and receive messages via Claude API', async ({ llmChat }) => {
    test.setTimeout(120000); // 2 minutes

    const testMessage = llmTestPrompts.apiBasicTest;
    const startTime = Date.now();
    const response = await llmChat.sendPromptAndCapture(testMessage);
    const elapsed = Date.now() - startTime;

    console.log(`\n📡 Basic API Integration:`);
    console.log(`  Prompt: "${testMessage}"`);
    console.log(`  Response length: ${response.length} chars`);
    console.log(`  Response time: ${elapsed}ms`);
    console.log(`  Status: ${response.length > 0 ? 'PASS' : 'INFORMATIONAL'}`);

    // Evaluate response quality
    const evaluation = await evaluateLLMResponse({
      input: testMessage,
      output: response,
      metrics: ['relevancy'],
      thresholds: { relevancy: 0.7 },
    });

    console.log(`\n📊 Response Quality:`);
    console.log(`  Relevancy: ${evaluation.metrics.relevancy?.score?.toFixed(2)} (threshold: ${evaluation.metrics.relevancy?.threshold})`);
    console.log(`  Status: ${evaluation.metrics.relevancy?.success ? 'PASS' : 'INFORMATIONAL'}`);
  });

  // ==========================================================================
  // TEST: ERROR HANDLING — empty prompt
  // ==========================================================================

  test('should handle empty prompt gracefully', async ({ request }) => {
    test.setTimeout(30000);

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      console.log('⏭️  Skipping — GROQ_API_KEY not set');
      test.skip();
      return;
    }

    const response = await request.post(`${BASE_URL}/openai/v1/chat/completions`, {
      data: {
        model: GROQ_MODEL,
        max_tokens: 100,
        messages: [{ role: 'user', content: llmTestPrompts.apiErrorTest }],
      },
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      failOnStatusCode: false,
    });

    console.log(`\n📋 Error Handling Test (empty prompt):`);
    console.log(`  Status: ${response.status()}`);

    if (response.ok()) {
      console.log(`  Result: API handled empty content — INFORMATIONAL`);
    } else {
      const isExpectedError = [400, 422].includes(response.status());
      console.log(`  Result: API returned ${response.status()} — ${isExpectedError ? 'PASS (expected)' : 'INFORMATIONAL'}`);
    }
  });

  // ==========================================================================
  // TEST: RESPONSE TIME
  // ==========================================================================

  test('should respond within acceptable time limits', async ({ llmChat }) => {
    test.setTimeout(120000);

    const testMessage = llmTestPrompts.apiPerformanceTest;
    const startTime = Date.now();
    await llmChat.sendPromptAndCapture(testMessage);
    const totalTime = Date.now() - startTime;

    console.log(`\n⏱️  Performance Metrics:`);
    console.log(`  Prompt: "${testMessage}"`);
    console.log(`  Total Response Time: ${totalTime}ms (target: <60000ms)`);
    console.log(`  Status: ${totalTime < 60000 ? 'PASS' : 'INFORMATIONAL (slow response)'}`);
  });

  // ==========================================================================
  // TEST: STREAMING RESPONSE
  // ==========================================================================

  test('should handle streaming responses', async ({ request }) => {
    test.setTimeout(120000);

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      console.log('⏭️  Skipping — GROQ_API_KEY not set');
      test.skip();
      return;
    }

    const response = await request.post(`${BASE_URL}/openai/v1/chat/completions`, {
      data: {
        model: GROQ_MODEL,
        max_tokens: 512,
        stream: true,
        messages: [{ role: 'user', content: llmTestPrompts.apiStreamTest }],
      },
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    const body = await response.text();

    console.log(`\n📡 Streaming Test:`);
    console.log(`  Status: ${response.status()}`);
    console.log(`  Content-Type: ${response.headers()['content-type']}`);
    console.log(`  Body length: ${body.length} chars`);
    console.log(`  Has SSE events: ${body.includes('data:') ? '✓' : '✗'}`);
    console.log(`  Status: ${body.length > 0 ? 'PASS' : 'INFORMATIONAL'}`);
  });

  // ==========================================================================
  // TEST: AUTHENTICATION — missing API key returns 401
  // ==========================================================================

  test('should return 401 when API key is missing', async ({ request }) => {
    test.setTimeout(30000);

    const response = await request.post(`${BASE_URL}/openai/v1/chat/completions`, {
      data: {
        model: GROQ_MODEL,
        max_tokens: 100,
        messages: [{ role: 'user', content: 'test' }],
      },
      headers: {
        'Content-Type': 'application/json',
        // Deliberately omitting Authorization header
      },
      failOnStatusCode: false,
    });

    console.log(`\n🔐 Auth Test (no API key):`);
    console.log(`  Status: ${response.status()}`);
    const isUnauthorized = response.status() === 401;
    console.log(`  Result: ${isUnauthorized ? 'PASS — correctly returns 401' : 'INFORMATIONAL'}`);
  });

  // ==========================================================================
  // TEST: RESPONSE STRUCTURE
  // ==========================================================================

  test('should return consistent response structure', async ({ request }) => {
    test.setTimeout(120000);

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      console.log('⏭️  Skipping — GROQ_API_KEY not set');
      test.skip();
      return;
    }

    const response = await request.post(`${BASE_URL}/openai/v1/chat/completions`, {
      data: {
        model: GROQ_MODEL,
        max_tokens: 256,
        messages: [{ role: 'user', content: 'Say hello in one sentence.' }],
      },
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    const body = await response.json();

    console.log(`\n📋 Response Structure:`);
    console.log(`  Status: ${response.status()}`);
    console.log(`  Fields: ${Object.keys(body).join(', ')}`);

    // OpenAI-compatible response shape
    const expectedFields = ['id', 'object', 'created', 'model', 'choices', 'usage'];
    const presentFields = expectedFields.filter(f => f in body);
    const missingFields = expectedFields.filter(f => !(f in body));

    console.log(`  Expected fields present: ${presentFields.join(', ')}`);
    if (missingFields.length > 0) {
      console.log(`  Missing fields: ${missingFields.join(', ')}`);
    }
    console.log(`  Finish reason: ${body.choices?.[0]?.finish_reason}`);
    console.log(`  Status: ${missingFields.length === 0 ? 'PASS' : 'INFORMATIONAL'}`);
  });

  // ==========================================================================
  // TEST: RATE LIMITING — consecutive requests
  // ==========================================================================

  test('should handle consecutive API requests', async ({ llmChat }) => {
    test.setTimeout(300000); // 5 minutes for 3 sequential requests

    console.log(`\n📊 Consecutive Requests Test:`);

    const rapidRequests = 3;
    let successfulRequests = 0;

    for (let i = 0; i < rapidRequests; i++) {
      try {
        const testMessage = `Briefly answer: what is principle ${i + 1} of clean code?`;
        const response = await llmChat.sendPromptAndCapture(testMessage);
        successfulRequests++;
        console.log(`  Request ${i + 1}: Success (${response.length} chars)`);
      } catch (error) {
        console.log(`  Request ${i + 1}: Failed — ${error}`);
        break;
      }
    }

    console.log(`  Result: ${successfulRequests}/${rapidRequests} requests succeeded`);
    console.log(`  Status: ${successfulRequests > 0 ? 'PASS' : 'INFORMATIONAL'}`);
  });

});
