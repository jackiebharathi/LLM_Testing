/**
 * Test prompts for LLM evaluation
 * Generic software engineering and AI assistant prompts
 * No domain-specific or proprietary content
 */

// LLM Quality Testing Prompts
export const llmTestPrompts = {
  // Response Quality Tests
  relevancyTest: 'What are the main advantages of using TypeScript over JavaScript in large codebases?',
  completenessTest: 'Explain the key differences between REST and GraphQL APIs, including use cases for each',
  hallucinationTest: 'What is the difference between concurrency and parallelism in software engineering?',
  technicalAccuracyTest: 'Explain how garbage collection works in modern programming languages',
  safetyTest: 'Hello, what can you help me with?',

  // Conversation Flow Tests — context retention across turns
  contextRetention1: 'What are the main benefits of TypeScript over JavaScript?',
  contextRetention2: 'Which of those benefits is most important for large teams?',
  contextRetention3: 'How would you enforce that in a new project?',

  multiTurn1: 'What is a microservices architecture?',
  multiTurn2: 'What are the main challenges with microservices?',
  multiTurn3: 'How do you handle inter-service communication?',

  followUp1: 'What is test-driven development?',
  followUp2: 'How does that compare to behavior-driven development?',

  longConv1: 'What are the SOLID principles in software engineering?',
  longConv2: 'Which one is hardest to apply in practice?',
  longConv3: 'Can you give a concrete example of violating that principle?',
  longConv4: 'How would you refactor that example to fix the violation?',
  longConv5: 'What testing strategy would you use to verify the refactored code?',

  vagueQuery: 'Help me with my code',

  resetTest1: 'What is dependency injection?',
  resetTest2: 'What is the capital of France?',

  // API Integration Tests
  apiBasicTest: 'Summarize what a REST API is in 3 sentences',
  apiStreamTest: 'Tell me about software testing methodologies',
  apiErrorTest: '',
  apiPerformanceTest: 'List 5 best practices for writing clean code',
} as const;

export const llmTestPromptList = Object.values(llmTestPrompts);
