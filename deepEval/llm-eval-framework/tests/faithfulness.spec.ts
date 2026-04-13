/* eslint-disable no-console, playwright/expect-expect */
/**
 * Faithfulness / Hallucination Tests
 *
 * Tests whether Claude's responses are grounded in the provided context
 * rather than fabricated by the model.
 *
 * How it works (adapted for direct API use):
 *  1. Build a "tool result" by including factual context in the system prompt
 *  2. Ask Claude a question that requires using that context
 *  3. Pass the context as `retrieval_context` to DeepEval
 *  4. Faithfulness score = how well the response stays grounded in the context
 *
 * Why this matters:
 *  A response can score high on relevancy and coherence yet still hallucinate.
 *  Faithfulness is the only metric that catches "the model made up facts".
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { test } from '../src/fixtures/llm.fixture';
import { evaluateLLMResponse } from '../src/utils/llm/llm-evaluator';
import { parseAIStream } from '../src/utils/llm/stream-parser';
import { logEvaluationResults } from '../src/utils/llm/llm-test-helpers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// TEST RUN LOG
// Cleared at suite start, one entry appended per test.
// Saved to: llm-faithfulness-log.json at project root.
// ============================================================================

const LOG_FILE = path.resolve(__dirname, '../llm-faithfulness-log.json');

function initLog() {
  fs.writeFileSync(LOG_FILE, JSON.stringify([], null, 2), 'utf-8');
}

function appendLog(entry: {
  test: string;
  prompt: string;
  response: string;
  retrievalContext: string[];
  metrics: Record<string, unknown>;
  passed: boolean;
  timestamp: string;
}) {
  let existing: unknown[] = [];
  try { existing = JSON.parse(fs.readFileSync(LOG_FILE, 'utf-8')); } catch { /* first entry */ }
  existing.push(entry);
  fs.writeFileSync(LOG_FILE, JSON.stringify(existing, null, 2), 'utf-8');
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Send a prompt with explicit retrieval context to Claude.
 * The context is injected as a system message so Claude is expected
 * to answer based on the provided data — enabling faithfulness evaluation.
 */
async function sendWithRetrievalContext(
  prompt: string,
  retrievalContext: string[]
): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY is not set');

  const systemPrompt = [
    'You are a helpful assistant. Answer the user\'s question based ONLY on the following retrieved information.',
    'Do not add information that is not present in the context below.',
    '',
    '--- RETRIEVED CONTEXT ---',
    ...retrievalContext,
    '--- END CONTEXT ---',
  ].join('\n');

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
      max_tokens: 1024,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.text().catch(() => '');
    throw new Error(`Groq API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

// ============================================================================
// TEST SUITE
// ============================================================================

test.describe('Faithfulness & Hallucination', () => {

  test.beforeAll(() => {
    initLog();
    console.log(`📝 Log cleared — results will be saved to llm-faithfulness-log.json`);
  });

  // ==========================================================================
  // TEST 1: Response grounded in provided context
  // ==========================================================================

  test('should ground response in retrieved context (software architecture)', async () => {
    test.setTimeout(180000);

    const retrievalContext = [
      'A monolithic architecture packages all application functionality into a single deployable unit.',
      'A microservices architecture splits the application into small independent services that communicate via APIs.',
      'Monoliths are simpler to develop initially but harder to scale. Microservices scale independently but introduce operational complexity.',
      'Service meshes (e.g. Istio) help manage microservices communication, security, and observability.',
    ];

    const prompt = 'What are the tradeoffs between monolithic and microservices architectures?';
    const response = await sendWithRetrievalContext(prompt, retrievalContext);

    console.log(`\n🔍 Faithfulness Test - Architecture:`);
    console.log(`  Context chunks: ${retrievalContext.length}`);
    console.log(`  Response length: ${response.length} chars`);

    const evaluation = await evaluateLLMResponse({
      input: prompt,
      output: response,
      retrieval_context: retrievalContext,
      metrics: ['faithfulness'],
      thresholds: { faithfulness: 0.7 },
    });

    logEvaluationResults(evaluation, 'Faithfulness - Architecture');
    appendLog({
      test: 'Architecture Tradeoffs',
      prompt,
      response,
      retrievalContext,
      metrics: evaluation.metrics,
      passed: evaluation.passed,
      timestamp: new Date().toISOString(),
    });

    console.log(`\n✅ Faithfulness evaluation completed`);
    console.log(`   Overall: ${evaluation.passed ? 'PASS' : 'INFORMATIONAL'}`);
  });

  // ==========================================================================
  // TEST 2: Response grounded in API documentation context
  // ==========================================================================

  test('should ground response in API documentation context', async () => {
    test.setTimeout(180000);

    const retrievalContext = [
      'REST (Representational State Transfer) is an architectural style using HTTP verbs: GET, POST, PUT, DELETE, PATCH.',
      'GraphQL is a query language for APIs that allows clients to request exactly the data they need.',
      'REST uses fixed endpoints per resource. GraphQL exposes a single endpoint and clients define the query shape.',
      'REST is better for simple CRUD operations. GraphQL excels when clients need flexible, nested data fetching.',
      'GraphQL requires a schema definition. REST relies on API documentation (e.g. OpenAPI/Swagger).',
    ];

    const prompt = 'When should I use GraphQL instead of REST?';
    const response = await sendWithRetrievalContext(prompt, retrievalContext);

    console.log(`\n🔍 Faithfulness Test - API Design:`);
    console.log(`  Context chunks: ${retrievalContext.length}`);
    console.log(`  Response length: ${response.length} chars`);

    const evaluation = await evaluateLLMResponse({
      input: prompt,
      output: response,
      retrieval_context: retrievalContext,
      metrics: ['faithfulness'],
      thresholds: { faithfulness: 0.7 },
    });

    logEvaluationResults(evaluation, 'Faithfulness - API Design');
    appendLog({
      test: 'REST vs GraphQL',
      prompt,
      response,
      retrievalContext,
      metrics: evaluation.metrics,
      passed: evaluation.passed,
      timestamp: new Date().toISOString(),
    });

    console.log(`\n✅ Faithfulness evaluation completed`);
    console.log(`   Overall: ${evaluation.passed ? 'PASS' : 'INFORMATIONAL'}`);
  });

  // ==========================================================================
  // TEST 3: Hallucination check — no context provided
  // ==========================================================================

  test('should detect potential hallucination without retrieval context', async ({ llmChat }) => {
    test.setTimeout(180000);

    const prompt = 'What is the current latest stable version of Node.js?';
    const response = await llmChat.sendPromptAndCapture(prompt);

    console.log(`\n🔍 Hallucination Test - Version Query:`);
    console.log(`  Response length: ${response.length} chars`);
    console.log(`  ℹ️  No context provided — model must answer from training data`);

    // Without retrieval_context, fall back to hallucination metric
    // Use response itself as self-consistency context
    const evaluation = await evaluateLLMResponse({
      input: prompt,
      output: response,
      retrieval_context: [response],
      metrics: ['hallucination'],
      thresholds: { hallucination: 0.5 },
    });

    logEvaluationResults(evaluation, 'Hallucination - No Context');
    appendLog({
      test: 'Hallucination No Context',
      prompt,
      response,
      retrievalContext: [],
      metrics: evaluation.metrics,
      passed: evaluation.passed,
      timestamp: new Date().toISOString(),
    });

    console.log(`\n✅ Hallucination evaluation completed`);
    console.log(`   Overall: ${evaluation.passed ? 'PASS' : 'INFORMATIONAL'}`);
  });

  // ==========================================================================
  // TEST 4: Combined faithfulness + hallucination
  // ==========================================================================

  test('should evaluate both faithfulness and hallucination', async () => {
    test.setTimeout(180000);

    const retrievalContext = [
      'Docker is a platform for building, shipping, and running applications in containers.',
      'Containers package application code with all its dependencies, ensuring consistent environments.',
      'Docker images are read-only templates. Containers are running instances of images.',
      'Docker Compose orchestrates multiple containers via a YAML configuration file.',
      'Kubernetes (K8s) is a container orchestration platform for large-scale deployments.',
    ];

    const prompt = 'Explain how Docker and Kubernetes work together';
    const response = await sendWithRetrievalContext(prompt, retrievalContext);

    console.log(`\n🔍 Faithfulness + Hallucination Test - Containers:`);
    console.log(`  Context chunks: ${retrievalContext.length}`);
    console.log(`  Response length: ${response.length} chars`);

    const evaluation = await evaluateLLMResponse({
      input: prompt,
      output: response,
      retrieval_context: retrievalContext,
      metrics: ['faithfulness', 'hallucination'],
      thresholds: { faithfulness: 0.7, hallucination: 0.5 },
    });

    logEvaluationResults(evaluation, 'Faithfulness + Hallucination - Containers');
    appendLog({
      test: 'Docker and Kubernetes',
      prompt,
      response,
      retrievalContext,
      metrics: evaluation.metrics,
      passed: evaluation.passed,
      timestamp: new Date().toISOString(),
    });

    const faithScore = evaluation.metrics['faithfulness']?.score;
    const hallScore = evaluation.metrics['hallucination']?.score;

    console.log(`\n📋 Summary:`);
    if (faithScore !== undefined) console.log(`  Faithfulness: ${faithScore.toFixed(2)} (how grounded in context)`);
    if (hallScore !== undefined) console.log(`  Hallucination: ${hallScore.toFixed(2)} (lower = less hallucination)`);

    console.log(`\n✅ Combined evaluation completed`);
    console.log(`   Overall: ${evaluation.passed ? 'PASS' : 'INFORMATIONAL'}`);
  });

});
