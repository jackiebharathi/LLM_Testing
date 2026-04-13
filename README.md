# LLM Evaluation Framework — Playwright + DeepEval

A framework for evaluating LLM response quality using **Playwright** as the test runner and **DeepEval** as the metrics engine, targeting the **Anthropic Claude API** directly.

---

## What It Does

Runs 4 test suites that measure different quality dimensions of LLM responses:

| Suite | File | What It Tests |
|---|---|---|
| **Response Quality** | `response-quality.spec.ts` | Relevancy, completeness, coherence, technical accuracy, safety |
| **Faithfulness** | `faithfulness.spec.ts` | Whether responses stay grounded in provided context (no hallucination) |
| **Conversation Flow** | `conversation-flow.spec.ts` | Context retention and coherence across multi-turn conversations |
| **API Integration** | `api-integration.spec.ts` | API health: response time, streaming, auth enforcement, response structure |

> Tests run against the Groq/Claude API directly — no browser UI is required. Playwright is used purely as the test runner.

---

## Why INFORMATIONAL, Not Hard-Fail

LLM responses are non-deterministic. The same prompt can yield different scores on different runs. Hard-failing a CI build because a relevancy score was `0.68` instead of `0.70` would make the pipeline fragile.

This framework follows an **INFORMATIONAL philosophy**:
- Tests always complete and report scores
- Scores below threshold are logged as `INFORMATIONAL`, not test failures
- Use the output to track trends over time, not to gate deployments

To hard-fail on specific critical paths, call `assertResponseQuality()` from `llm-evaluator.ts` directly in a dedicated test.

---

## Folder Structure

```
llm-eval-framework/
├── src/
│   ├── config/
│   │   └── llm-config.ts           # Thresholds, timeouts, metric combinations
│   ├── fixtures/
│   │   └── llm.fixture.ts          # Playwright fixtures + Claude API client
│   └── utils/
│       ├── llm/
│       │   ├── llm-evaluator.ts    # TypeScript → Python bridge for DeepEval
│       │   ├── llm-test-helpers.ts # Logging, assertion, and batch helpers
│       │   └── stream-parser.ts    # SSE stream parser (Claude + Vercel AI SDK)
│       └── testData/
│           └── chatPrompts.ts      # Reusable test prompts
├── tests/
│   ├── response-quality.spec.ts    # Quality + safety metric tests
│   ├── faithfulness.spec.ts        # Faithfulness + hallucination tests
│   ├── conversation-flow.spec.ts   # Multi-turn conversation tests
│   └── api-integration.spec.ts     # Groq API health + performance tests
├── evaluate_response.py            # DeepEval evaluation engine (Python)
├── playwright.config.ts
├── package.json
└── tsconfig.json
```

---

## Setup

### Prerequisites

- Node.js 18+
- Python 3.8+

### 1. Install Python dependencies

```bash
pip install deepeval python-dotenv
```

### 2. Install Node dependencies

```bash
cd llm-eval-framework
npm install
npx playwright install chromium
```

### 3. Configure environment variables

Create a `.env` file in the `llm-eval-framework/` directory:

```env
# Required: Claude API key (the model being tested)
ANTHROPIC_API_KEY=your_anthropic_api_key_here

# Required: Evaluation model key (choose one)
GROQ_API_KEY=gsk_your_groq_key_here      # Free — recommended
# OPENAI_API_KEY=sk_your_openai_key_here  # Paid fallback
```

**Where to get API keys:**
- **Anthropic (Claude):** [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys)
- **Groq (free evaluator):** [console.groq.com/keys](https://console.groq.com/keys)
- **OpenAI (paid evaluator):** [platform.openai.com/api-keys](https://platform.openai.com/api-keys)

---

## Running Tests

### Run all test suites

```bash
npm test
```

### Run individual suites

```bash
# Response quality (relevancy, completeness, coherence, technical, safety)
npm run test:quality

# Faithfulness and hallucination detection
npm run test:faithfulness

# Conversation flow and context retention
npm run test:conversation

# Groq API integration (health, performance, streaming, auth)
npm run test:api
```

### View HTML report

```bash
npm run test:report
```

### Run the Python evaluator directly (for debugging)

```bash
python evaluate_response.py \
  --input "What is a REST API?" \
  --output "A REST API is..." \
  --metrics relevancy,completeness \
  --pretty
```

---

## Metrics Reference

| Metric | Type | What It Measures | Default Threshold |
|---|---|---|---|
| `relevancy` | Quality | How relevant the response is to the input prompt | 0.70 |
| `completeness` | Quality | How comprehensively the response addresses the question | 0.70 |
| `coherence` | Quality | How well-structured and logically organised the response is | 0.70 |
| `technical` | Quality | Technical accuracy of software engineering concepts | 0.75 |
| `faithfulness` | Grounding | How well the response stays grounded in provided context | 0.70 |
| `hallucination` | Safety | Degree of fabricated or unsupported information (lower = better) | 0.50 |
| `toxicity` | Safety | Presence of harmful or offensive content (lower = better) | 0.30 |
| `bias` | Safety | Presence of biased or discriminatory content (lower = better) | 0.30 |

### Threshold Presets

```bash
TEST_ENV=strict npm test    # Stricter thresholds (e.g. relevancy: 0.85)
TEST_ENV=relaxed npm test   # Relaxed thresholds for debugging (e.g. relevancy: 0.50)
```

Custom thresholds can also be set per test or globally in [src/config/llm-config.ts](src/config/llm-config.ts).

---

## Metric Combinations

Pre-defined metric sets used in tests:

| Combination | Metrics Used |
|---|---|
| `BASIC` | relevancy, completeness |
| `COMPREHENSIVE` | relevancy, completeness, coherence, technical |
| `SAFETY` | toxicity, bias |
| `TECHNICAL` | relevancy, completeness, technical |
| `CONVERSATION` | relevancy, coherence |
| `FULL` | relevancy, completeness, coherence, technical, toxicity, bias |

---

## Sample Output

```
📊 Quality Metrics - Evaluation Results:
Overall Score: 0.64
relevancy: 0.47 ✗ (threshold: 0.7)
completeness: 0.40 ✗ (threshold: 0.7)
coherence: 0.90 ✓ (threshold: 0.7)
technical: 0.80 ✓ (threshold: 0.75)
Overall: INFORMATIONAL
```

```
📊 Multi-Turn Context Evaluation:
  Messages: 6 (3 turns)
  Relevancy: 0.82 (threshold: 0.7)
  Coherence: 0.78 (threshold: 0.7)

✅ Multi-turn evaluation completed
   Overall: PASS
```

The faithfulness suite writes results to `llm-faithfulness-log.json` after each run:

```json
[
  {
    "test": "Architecture Tradeoffs",
    "prompt": "What are the tradeoffs between monolithic and microservices architectures?",
    "response": "...",
    "retrievalContext": ["A monolithic architecture..."],
    "metrics": { "faithfulness": { "score": 0.82, "threshold": 0.7, "success": true } },
    "passed": true,
    "timestamp": "2026-04-13T10:00:00.000Z"
  }
]
```

---

## How the TypeScript–Python Bridge Works

```
Playwright test
  → sends prompt to Claude API (fetch)
  → captures response text
  → calls evaluateLLMResponse({ input, output, metrics })
      → writes request to temp JSON file
      → spawns: python evaluate_response.py --json-file /tmp/llm-eval-xxx.json
      → Python runs DeepEval metrics
      → writes results to temp JSON file
      → TypeScript reads and returns results
  → logs scores to console
```

No shared state, no persistent processes — each evaluation is a clean subprocess call.

---

## Evaluator Model Selection

The Python evaluator (`evaluate_response.py`) automatically selects the model based on available API keys:

1. **Groq** (`GROQ_API_KEY`) — Free, fast, uses `llama-3.3-70b-versatile`. Recommended.
2. **OpenAI** (`OPENAI_API_KEY`) — Paid fallback, uses `gpt-4o-mini`.

If neither key is set, the script exits with a clear error message.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Test runner | [Playwright](https://playwright.dev/) |
| Evaluation engine | [DeepEval](https://github.com/confident-ai/deepeval) |
| LLM under test | [Anthropic Claude](https://docs.anthropic.com/) |
| Evaluator model | [Groq](https://console.groq.com/) (free) / OpenAI (paid) |
| Language | TypeScript (tests) + Python (metrics) |
