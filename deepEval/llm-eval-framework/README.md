# LLM Evaluation Framework — Playwright + DeepEval

A framework for evaluating LLM response quality using Playwright as the test runner and DeepEval as the metrics engine — targeting the Anthropic Claude API directly.

---

## What It Does

This framework runs 4 test suites that measure different quality dimensions of Claude's responses:

| Suite | File | What It Tests |
|---|---|---|
| **Response Quality** | `response-quality.spec.ts` | Relevancy, completeness, coherence, technical accuracy, safety |
| **Faithfulness** | `faithfulness.spec.ts` | Whether responses stay grounded in provided context (no hallucination) |
| **Conversation Flow** | `conversation-flow.spec.ts` | Context retention and coherence across multi-turn conversations |
| **API Integration** | `api-integration.spec.ts` | API health: response time, streaming, auth enforcement, structure |

---

## Why INFORMATIONAL, Not Hard-Fail

LLM responses are non-deterministic. The same prompt can yield different scores on different runs. Hard-failing a CI build because a relevancy score was 0.68 instead of 0.70 would make the pipeline fragile and misleading.

Instead, this framework follows an **INFORMATIONAL philosophy**:
- Tests always complete and report scores
- Scores below threshold are logged as `INFORMATIONAL`, not test failures
- You use the output to track trends over time, not to gate deployments

If you want hard failures for specific critical paths, use `assertResponseQuality()` from `llm-evaluator.ts` directly in a dedicated test.

---

## Folder Structure

```
llm-eval-framework/
├── src/
│   ├── config/
│   │   └── llm-config.ts          # Thresholds, timeouts, metric combinations
│   ├── fixtures/
│   │   └── llm.fixture.ts         # Playwright fixtures + Claude API client
│   └── utils/
│       ├── llm/
│       │   ├── llm-evaluator.ts   # TypeScript → Python bridge for DeepEval
│       │   ├── llm-test-helpers.ts # Logging, assertion, and batch helpers
│       │   └── stream-parser.ts   # SSE stream parser (Claude + Vercel AI SDK)
│       └── testData/
│           └── chatPrompts.ts     # Reusable test prompts
├── tests/
│   ├── response-quality.spec.ts
│   ├── faithfulness.spec.ts
│   ├── conversation-flow.spec.ts
│   └── api-integration.spec.ts
├── evaluate_response.py           # DeepEval evaluation engine (Python)
├── playwright.config.ts
├── .env.example
└── package.json
```

---

## Setup

### 1. Install Python dependencies

```bash
pip install deepeval python-dotenv
```

> DeepEval requires Python 3.8+. Verify with `python --version`.

### 2. Install Node dependencies

```bash
npm install
npx playwright install chromium
```

### 3. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` and fill in:

```env
# Required: Claude API key (the model being tested)
ANTHROPIC_API_KEY=your_anthropic_api_key_here

# Required: Evaluation model API key (choose one)
GROQ_API_KEY=gsk_your_groq_key_here      # Free, recommended
# OPENAI_API_KEY=sk_your_openai_key_here  # Paid fallback
```

**Getting API keys:**
- **Anthropic (Claude):** https://console.anthropic.com/settings/keys
- **Groq (free evaluator):** https://console.groq.com/keys
- **OpenAI (paid evaluator):** https://platform.openai.com/api-keys

---

## How to Run

### Run all test suites

```bash
npm test
```

### Run individual suites

```bash
# Response quality (relevancy, completeness, coherence, technical, safety)
npm run test:quality

# Faithfulness / hallucination
npm run test:faithfulness

# Conversation flow and context retention
npm run test:conversation

# API integration (health, performance, auth, streaming)
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

## Metrics Explained

| Metric | Type | Description | Default Threshold |
|---|---|---|---|
| `relevancy` | Quality | How relevant the response is to the input prompt | 0.70 |
| `completeness` | Quality | How comprehensively the response addresses the question | 0.70 |
| `coherence` | Quality | How well-structured and logically organised the response is | 0.70 |
| `technical` | Quality | Technical accuracy of software engineering concepts | 0.75 |
| `faithfulness` | Grounding | How well the response stays grounded in provided context | 0.70 |
| `hallucination` | Safety | Degree of fabricated or unsupported information (lower = better) | 0.50 |
| `toxicity` | Safety | Presence of harmful or offensive content (lower = better) | 0.30 |
| `bias` | Safety | Presence of biased or discriminatory content (lower = better) | 0.30 |

Thresholds can be overridden per test or set globally via `TEST_ENV=strict` / `TEST_ENV=relaxed`.

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

The faithfulness log is written to `llm-faithfulness-log.json` after each faithfulness suite run:

```json
[
  {
    "test": "Architecture Tradeoffs",
    "prompt": "What are the tradeoffs between monolithic and microservices architectures?",
    "response": "...",
    "retrievalContext": ["A monolithic architecture..."],
    "metrics": { "faithfulness": { "score": 0.82, "threshold": 0.7, "success": true } },
    "passed": true,
    "timestamp": "2026-04-12T10:00:00.000Z"
  }
]
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Test runner | [Playwright](https://playwright.dev/) |
| Evaluation engine | [DeepEval](https://github.com/confident-ai/deepeval) |
| LLM under test | [Anthropic Claude](https://docs.anthropic.com/) |
| Evaluator model | [Groq](https://console.groq.com/) (free) / OpenAI (paid) |
| Language | TypeScript (tests) + Python (metrics) |

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

## Customising Thresholds

Edit `src/config/llm-config.ts`:

```typescript
export const LLM_THRESHOLDS: Record<MetricName, number> = {
  relevancy: 0.7,
  completeness: 0.7,
  coherence: 0.7,
  technical: 0.75,
  faithfulness: 0.7,
  hallucination: 0.5,
  toxicity: 0.3,
  bias: 0.3,
};
```

Or use environment-based presets:

```bash
TEST_ENV=strict npm test   # stricter thresholds
TEST_ENV=relaxed npm test  # relaxed thresholds (for debugging)
```
