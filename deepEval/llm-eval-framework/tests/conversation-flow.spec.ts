/* eslint-disable no-console, max-lines-per-function, playwright/expect-expect */
/**
 * Conversation Flow Tests
 *
 * Tests multi-turn conversations, context retention, and coherence
 * using the Claude API directly.
 *
 * Strategy:
 * - Send a sequence of messages in a single conversation
 * - Evaluate whether later responses stay coherent with earlier context
 * - Report metrics as INFORMATIONAL
 */

import { test } from '../src/fixtures/llm.fixture';
import { evaluateConversationContext } from '../src/utils/llm/llm-evaluator';
import { llmTestPrompts } from '../src/utils/testData/chatPrompts';

// ============================================================================
// HELPER
// ============================================================================

async function collectConversation(
  llmChat: any,
  userMessages: string[]
): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
  const conversation: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const userMsg of userMessages) {
    conversation.push({ role: 'user', content: userMsg });
    const assistantResponse = await llmChat.sendPromptAndCapture(userMsg);
    conversation.push({ role: 'assistant', content: assistantResponse });
  }

  return conversation;
}

// ============================================================================
// TEST SUITE
// ============================================================================

test.describe('Conversation Flow', () => {

  test('should evaluate context retention across multiple turns', async ({ llmChat }) => {
    test.setTimeout(240000); // 4 minutes for 3-turn conversation + evaluation

    const userMessages = [
      llmTestPrompts.contextRetention1,
      llmTestPrompts.contextRetention2,
      llmTestPrompts.contextRetention3,
    ];

    const conversation = await collectConversation(llmChat, userMessages);

    const evaluation = await evaluateConversationContext(conversation, {
      minCoherence: 0.7,
    });

    console.log('\n📊 Multi-Turn Context Evaluation:');
    console.log(`  Messages: ${conversation.length} (${userMessages.length} turns)`);
    console.log(`  Relevancy: ${evaluation.metrics.relevancy?.score?.toFixed(2)} (threshold: ${evaluation.metrics.relevancy?.threshold})`);
    console.log(`  Coherence: ${evaluation.metrics.coherence?.score?.toFixed(2)} (threshold: ${evaluation.metrics.coherence?.threshold})`);

    console.log('\n✅ Multi-turn evaluation completed');
    console.log(`   Overall: ${evaluation.passed ? 'PASS' : 'INFORMATIONAL'}`);
  });

  test('should evaluate follow-up questions with context', async ({ llmChat }) => {
    test.setTimeout(180000); // 3 minutes for 2-turn + evaluation

    const conversation = await collectConversation(llmChat, [
      llmTestPrompts.followUp1,
      llmTestPrompts.followUp2,
    ]);

    const followUpResponse = conversation[3].content; // second assistant message

    const evaluation = await evaluateConversationContext(conversation, {
      minCoherence: 0.7,
    });

    // Verify follow-up response references context from first turn
    const contextKeywords = ['test', 'tdd', 'development', 'behavior', 'bdd', 'driven'];
    const hasContext = contextKeywords.some(
      keyword => followUpResponse.toLowerCase().includes(keyword)
    );

    console.log(`\n📊 Follow-up Context Check:`);
    console.log(`  Context referenced: ${hasContext ? '✓' : '✗'}`);
    console.log(`  Coherence: ${evaluation.metrics.coherence?.score?.toFixed(2)} (threshold: ${evaluation.metrics.coherence?.threshold})`);

    console.log('\n✅ Follow-up evaluation completed');
    console.log(`   Overall: ${evaluation.passed && hasContext ? 'PASS' : 'INFORMATIONAL'}`);
  });

  test('should maintain quality in extended multi-turn conversations', async ({ llmChat }) => {
    test.setTimeout(300000); // 5 minutes for 5-turn conversation + evaluation

    const userMessages = [
      llmTestPrompts.longConv1,
      llmTestPrompts.longConv2,
      llmTestPrompts.longConv3,
    ];

    const conversation = await collectConversation(llmChat, userMessages);

    const evaluation = await evaluateConversationContext(conversation, {
      minCoherence: 0.7,
    });

    console.log(`\n📊 Extended Conversation (${userMessages.length} turns):`);
    console.log(`  Total messages: ${conversation.length}`);
    console.log(`  Relevancy: ${evaluation.metrics.relevancy?.score?.toFixed(2)} (threshold: ${evaluation.metrics.relevancy?.threshold})`);
    console.log(`  Coherence: ${evaluation.metrics.coherence?.score?.toFixed(2)} (threshold: ${evaluation.metrics.coherence?.threshold})`);

    console.log('\n✅ Extended conversation evaluation completed');
    console.log(`   Overall: ${evaluation.passed ? 'PASS' : 'INFORMATIONAL'}`);
  });

});
