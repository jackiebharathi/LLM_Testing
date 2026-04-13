#!/usr/bin/env python3
"""
Standalone LLM Response Evaluator using DeepEval
Call this from TypeScript tests to evaluate LLM responses

Supports multiple FREE model providers:
- Groq (FREE, FAST) - Recommended
- OpenAI (PAID)

Usage:
    python evaluate_response.py --input "user prompt" --output "llm response" --metrics relevancy,completeness
    python evaluate_response.py --json-file response.json
"""

import sys
import json
import argparse
import os
from pathlib import Path
from typing import List, Dict, Any, Optional

# Load environment variables from .env file
try:
    from dotenv import load_dotenv
    # Find .env file at project root (same directory as this script)
    env_path = Path(__file__).parent / '.env'
    load_dotenv(env_path)
except ImportError:
    print("[WARN] python-dotenv not installed. Using system environment variables only.")
except Exception as e:
    print(f"[WARN] Could not load .env file: {e}")

from deepeval.test_case import LLMTestCase
from deepeval.metrics import (
    AnswerRelevancyMetric,
    HallucinationMetric,
    FaithfulnessMetric,
    ToxicityMetric,
    BiasMetric,
)
from deepeval.metrics import GEval
from deepeval.test_case import LLMTestCaseParams

# ============================================================================
# MODEL SELECTION - Groq (FREE) or OpenAI (PAID)
# ============================================================================

def select_model():
    """Select model based on available API keys"""

    # Check for Groq (FREE, FAST)
    groq_key = os.getenv('GROQ_API_KEY')
    if groq_key:
        model = "llama-3.3-70b-versatile"
        # DeepEval requires OPENAI_API_KEY even for custom models
        # Set Groq key as OPENAI_API_KEY for DeepEval compatibility
        os.environ['OPENAI_API_KEY'] = groq_key
        os.environ['OPENAI_API_BASE'] = 'https://api.groq.com/openai/v1'
        print(f"[OK] Using Groq (FREE): {model}")
        return model

    # Fallback to OpenAI (PAID)
    if os.getenv('OPENAI_API_KEY'):
        model = "gpt-4o-mini"
        print(f"[WARN] Using OpenAI (PAID): {model}")
        return model

    # No API key found
    raise ValueError(
        "[ERROR] No API key found!\n\n"
        "For FREE testing, get Groq API key:\n"
        "  1. Go to: https://console.groq.com/keys\n"
        "  2. Sign up (free)\n"
        "  3. Create API key\n"
        "  4. Add to .env: GROQ_API_KEY=gsk_...\n\n"
        "Or use OpenAI (paid):\n"
        "  Add to .env: OPENAI_API_KEY=sk_..."
    )

EVAL_MODEL = select_model()

# ============================================================================
# MODEL HELPER
# ============================================================================

def get_eval_model():
    """Get configured evaluation model"""
    if os.getenv('OPENAI_API_BASE'):
        from deepeval.models import GPTModel
        return GPTModel(
            model=EVAL_MODEL,
            api_key=os.getenv('OPENAI_API_KEY'),
            base_url=os.getenv('OPENAI_API_BASE')
        )
    return EVAL_MODEL

# ============================================================================
# METRIC DEFINITIONS
# ============================================================================

def get_relevancy_metric(threshold: float = 0.7) -> AnswerRelevancyMetric:
    """Answer relevancy metric"""
    return AnswerRelevancyMetric(threshold=threshold, model=get_eval_model())

def get_hallucination_metric(threshold: float = 0.5) -> HallucinationMetric:
    """Hallucination detection metric"""
    return HallucinationMetric(threshold=threshold, model=get_eval_model())

def get_toxicity_metric(threshold: float = 0.3) -> ToxicityMetric:
    """Toxicity detection metric"""
    return ToxicityMetric(threshold=threshold, model=get_eval_model())

def get_bias_metric(threshold: float = 0.3) -> BiasMetric:
    """Bias detection metric"""
    return BiasMetric(threshold=threshold, model=get_eval_model())

def get_completeness_metric(threshold: float = 0.7) -> GEval:
    """Completeness evaluation metric"""
    return GEval(
        name="Completeness",
        criteria="Response provides complete and comprehensive information addressing all aspects of the input",
        evaluation_params=[LLMTestCaseParams.INPUT, LLMTestCaseParams.ACTUAL_OUTPUT],
        threshold=threshold,
        model=get_eval_model(),
    )

def get_coherence_metric(threshold: float = 0.7) -> GEval:
    """Coherence evaluation metric"""
    return GEval(
        name="Coherence",
        criteria="Response is coherent, well-structured, logically organized, and easy to understand",
        evaluation_params=[LLMTestCaseParams.ACTUAL_OUTPUT],
        threshold=threshold,
        model=get_eval_model(),
    )

def get_faithfulness_metric(threshold: float = 0.7) -> FaithfulnessMetric:
    """Faithfulness metric - checks response is grounded in retrieval_context (requires retrieval_context)"""
    return FaithfulnessMetric(threshold=threshold, model=get_eval_model())

def get_technical_accuracy_metric(threshold: float = 0.75) -> GEval:
    """Technical accuracy for software engineering domain"""
    return GEval(
        name="TechnicalAccuracy",
        criteria="Response demonstrates accurate understanding of software engineering, programming, and computer science concepts",
        evaluation_params=[LLMTestCaseParams.INPUT, LLMTestCaseParams.ACTUAL_OUTPUT],
        threshold=threshold,
        model=get_eval_model(),
    )

# ============================================================================
# METRIC REGISTRY
# ============================================================================

AVAILABLE_METRICS = {
    "relevancy": get_relevancy_metric,
    "hallucination": get_hallucination_metric,
    "faithfulness": get_faithfulness_metric,
    "toxicity": get_toxicity_metric,
    "bias": get_bias_metric,
    "completeness": get_completeness_metric,
    "coherence": get_coherence_metric,
    "technical": get_technical_accuracy_metric,
}

# ============================================================================
# EVALUATION ENGINE
# ============================================================================

def evaluate_response(
    input_text: str,
    actual_output: str,
    metrics: List[str],
    expected_output: Optional[str] = None,
    context: Optional[List[str]] = None,
    retrieval_context: Optional[List[str]] = None,
    thresholds: Optional[Dict[str, float]] = None,
) -> Dict[str, Any]:
    """
    Evaluate LLM response with specified metrics

    Args:
        input_text: User input/prompt
        actual_output: LLM response
        metrics: List of metric names to evaluate
        expected_output: Expected response (optional)
        context: Conversation context (optional)
        retrieval_context: Raw data retrieved by tools - used for faithfulness/hallucination metrics
        thresholds: Custom thresholds for metrics (optional)

    Returns:
        Dictionary with evaluation results
    """
    thresholds = thresholds or {}

    # Create test case
    test_case = LLMTestCase(
        input=input_text,
        actual_output=actual_output,
        expected_output=expected_output,
        context=context,
        retrieval_context=retrieval_context,
    )

    results = {
        "success": True,
        "metrics": {},
        "overall_score": 0.0,
        "passed": True,
    }

    scores = []

    for metric_name in metrics:
        if metric_name not in AVAILABLE_METRICS:
            results["metrics"][metric_name] = {
                "error": f"Unknown metric: {metric_name}",
                "available": list(AVAILABLE_METRICS.keys())
            }
            continue

        try:
            # Get metric with custom threshold if provided
            threshold = thresholds.get(metric_name)
            if threshold is not None:
                metric = AVAILABLE_METRICS[metric_name](threshold=threshold)
            else:
                metric = AVAILABLE_METRICS[metric_name]()

            # Measure
            metric.measure(test_case)

            # Store results
            metric_result = {
                "score": metric.score,
                "threshold": metric.threshold,
                "success": metric.is_successful(),
                "reason": getattr(metric, "reason", None),
            }

            results["metrics"][metric_name] = metric_result
            scores.append(metric.score)

            if not metric.is_successful():
                results["passed"] = False

        except Exception as e:
            results["metrics"][metric_name] = {
                "error": str(e),
                "success": False,
            }
            results["passed"] = False
            results["success"] = False

    # Calculate overall score
    if scores:
        results["overall_score"] = sum(scores) / len(scores)

    return results

# ============================================================================
# CLI INTERFACE
# ============================================================================

def main():
    parser = argparse.ArgumentParser(
        description="Evaluate LLM responses using DeepEval metrics"
    )

    # Input methods
    parser.add_argument("--input", type=str, help="User input/prompt")
    parser.add_argument("--output", type=str, help="LLM response")
    parser.add_argument("--expected", type=str, help="Expected output (optional)")
    parser.add_argument("--context", type=str, nargs="+", help="Conversation context (optional)")
    parser.add_argument("--json-file", type=str, help="JSON file with input/output/metrics")

    # Metrics
    parser.add_argument(
        "--metrics",
        type=str,
        help=f"Comma-separated metrics to evaluate. Available: {', '.join(AVAILABLE_METRICS.keys())}"
    )

    # Thresholds
    parser.add_argument("--threshold", type=str, help="Custom thresholds in format 'metric:value,metric:value'")

    # Output
    parser.add_argument("--output-file", type=str, help="Save results to JSON file")
    parser.add_argument("--pretty", action="store_true", help="Pretty print JSON output")

    args = parser.parse_args()

    # Parse input
    if args.json_file:
        with open(args.json_file, 'r', encoding='utf-8') as f:
            data = json.load(f)

        input_text = data.get("input")
        actual_output = data.get("output")
        expected_output = data.get("expected")
        context = data.get("context")
        retrieval_context = data.get("retrieval_context")
        metrics = data.get("metrics", ["relevancy", "completeness"])
        thresholds = data.get("thresholds", {})
    else:
        if not args.input or not args.output:
            parser.error("--input and --output required (or use --json-file)")

        input_text = args.input
        actual_output = args.output
        expected_output = args.expected
        context = args.context
        retrieval_context = None
        metrics = args.metrics.split(",") if args.metrics else ["relevancy"]

        # Parse thresholds
        thresholds = {}
        if args.threshold:
            for pair in args.threshold.split(","):
                metric, value = pair.split(":")
                thresholds[metric.strip()] = float(value.strip())

    # Evaluate
    try:
        results = evaluate_response(
            input_text=input_text,
            actual_output=actual_output,
            metrics=metrics,
            expected_output=expected_output,
            context=context,
            retrieval_context=retrieval_context,
            thresholds=thresholds,
        )

        # Output results
        if args.output_file:
            with open(args.output_file, 'w', encoding='utf-8') as f:
                json.dump(results, f, indent=2 if args.pretty else None)
            print(f"Results saved to {args.output_file}")
        else:
            if args.pretty:
                print(json.dumps(results, indent=2))
            else:
                print(json.dumps(results))

        # Exit code based on success
        sys.exit(0 if results["passed"] else 1)

    except Exception as e:
        error_result = {
            "success": False,
            "error": str(e),
            "passed": False,
        }
        print(json.dumps(error_result, indent=2 if args.pretty else None), file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
