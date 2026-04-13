/**
 * LLM Testing Fixtures
 * Provides direct Groq API access and evaluation utilities
 * No browser UI required — calls Groq (OpenAI-compatible) API directly
 */

import { test as base } from '@playwright/test';
import {
  evaluateLLMResponse,
  assertResponseQuality,
  evaluateBatch,
  type EvaluationResult,
  type EvaluationRequest,
  type BatchEvaluationResult,
  type BatchEvaluationRequest,
} from '../utils/llm/llm-evaluator';

// ============================================================================
// GROQ API CLIENT (OpenAI-compatible)
// ============================================================================

/**
 * LLM client for testing — uses Groq's OpenAI-compatible API
 * Model under test: llama-3.3-70b-versatile (free, fast)
 */
class GroqClient {
  private conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  /**
   * Send a single prompt to Groq and return the response text
   */
  async sendPromptAndCapture(prompt: string): Promise<string> {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error('GROQ_API_KEY environment variable is not set');
    }

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
          ...this.conversationHistory,
          { role: 'user', content: prompt },
        ],
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(`Groq API error ${response.status}: ${errorBody}`);
    }

    const data = await response.json();
    const text: string = data.choices[0].message.content;

    // Maintain conversation history for multi-turn tests
    this.conversationHistory.push({ role: 'user', content: prompt });
    this.conversationHistory.push({ role: 'assistant', content: text });

    return text;
  }

  /**
   * Send multiple prompts in sequence, maintaining conversation context
   */
  async sendMultiplePromptsAndCapture(
    prompts: string[]
  ): Promise<Array<{ input: string; output: string }>> {
    const results: Array<{ input: string; output: string }> = [];
    for (const prompt of prompts) {
      const output = await this.sendPromptAndCapture(prompt);
      results.push({ input: prompt, output });
    }
    return results;
  }

  /**
   * Reset conversation history for independent tests
   */
  resetConversation(): void {
    this.conversationHistory = [];
  }

  /**
   * Get current conversation history
   */
  getConversationHistory(): Array<{ role: 'user' | 'assistant'; content: string }> {
    return [...this.conversationHistory];
  }
}

// ============================================================================
// FIXTURE TYPE DEFINITIONS
// ============================================================================

type LLMFixtures = {
  /**
   * Groq API client with multi-turn conversation support
   */
  llmChat: GroqClient;

  /**
   * Quick evaluation function — evaluates a single response
   *
   * @example
   * const result = await evaluate(prompt, response, ['relevancy', 'completeness']);
   * console.log(result.overall_score);
   */
  evaluate: (
    input: string,
    output: string,
    metrics?: string[],
    thresholds?: Record<string, number>
  ) => Promise<EvaluationResult>;

  /**
   * Assert response quality — throws if quality checks fail
   *
   * @example
   * await assertQuality(prompt, response, { minRelevancy: 0.8 });
   */
  assertQuality: (
    input: string,
    output: string,
    options?: {
      minRelevancy?: number;
      minCompleteness?: number;
      maxHallucination?: number;
    }
  ) => Promise<void>;

  /**
   * Batch evaluation — evaluate multiple responses at once
   *
   * @example
   * const results = await evaluateBatchResponses([
   *   { input: 'prompt1', output: 'response1' },
   *   { input: 'prompt2', output: 'response2' }
   * ]);
   */
  evaluateBatchResponses: (
    cases: Array<{ input: string; output: string; expected?: string }>,
    metrics?: string[],
    thresholds?: Record<string, number>
  ) => Promise<BatchEvaluationResult>;
};

// ============================================================================
// FIXTURE IMPLEMENTATION
// ============================================================================

export const test = base.extend<LLMFixtures>({
  /**
   * GroqClient fixture — fresh client per test
   */
  llmChat: async ({}, use) => {
    const llmChat = new GroqClient();
    await use(llmChat);
  },

  /**
   * Quick evaluate fixture
   */
  evaluate: async ({}, use) => {
    const evaluateFunc = async (
      input: string,
      output: string,
      metrics: string[] = ['relevancy', 'completeness'],
      thresholds?: Record<string, number>
    ): Promise<EvaluationResult> => {
      const request: EvaluationRequest = {
        input,
        output,
        metrics: metrics as any[],
        thresholds: thresholds || { relevancy: 0.7, completeness: 0.7 },
      };
      return await evaluateLLMResponse(request);
    };
    await use(evaluateFunc);
  },

  /**
   * Assert quality fixture
   */
  assertQuality: async ({}, use) => {
    const assertFunc = async (
      input: string,
      output: string,
      options?: {
        minRelevancy?: number;
        minCompleteness?: number;
        maxHallucination?: number;
      }
    ): Promise<void> => {
      await assertResponseQuality(input, output, options);
    };
    await use(assertFunc);
  },

  /**
   * Batch evaluation fixture
   */
  evaluateBatchResponses: async ({}, use) => {
    const batchFunc = async (
      cases: Array<{ input: string; output: string; expected?: string }>,
      metrics: string[] = ['relevancy', 'completeness'],
      thresholds?: Record<string, number>
    ): Promise<BatchEvaluationResult> => {
      const request: BatchEvaluationRequest = {
        cases,
        metrics: metrics as any[],
        thresholds,
      };
      return await evaluateBatch(request);
    };
    await use(batchFunc);
  },
});

// Re-export expect for convenience
export { expect } from '@playwright/test';
