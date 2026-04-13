/**
 * Claude SSE Stream Parser
 *
 * Parses Claude's server-sent events (SSE) streaming format to extract
 * tool call results — the raw data the LLM receives before narrating it.
 * These tool results become the `retrieval_context` for faithfulness evaluation.
 *
 * Claude stream event format (SSE with JSON payloads):
 *   data: {"type":"<event_type>", ...fields}\n\n
 *
 * Relevant event types:
 *   content_block_start    — starts a content block (text or tool_use)
 *   content_block_delta    — text delta chunk
 *   content_block_stop     — ends a content block
 *   tool_result            — tool result payload (for custom wrappers)
 *
 * Also supports Vercel AI SDK streaming format:
 *   tool-input-available   — tool call  { toolCallId, toolName, input }
 *   tool-output-available  — tool result { toolCallId, output }
 *   text-delta             — text chunk  { textDelta }
 */

export interface ToolCallChunk {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

export interface ToolResultChunk {
  toolCallId: string;
  result: unknown;
}

export interface ParsedStream {
  /** Raw text content from all text chunks combined */
  text: string;
  /** Tool calls the LLM made */
  toolCalls: ToolCallChunk[];
  /** Raw results returned by each tool — use as retrieval_context */
  toolResults: ToolResultChunk[];
  /** Flat string array of tool result payloads, ready for DeepEval retrieval_context */
  retrievalContext: string[];
}

/**
 * Parse the full body text of a streaming response.
 * Supports both Claude native SSE format and Vercel AI SDK format.
 * Pass the raw response body string (all SSE lines concatenated).
 */
export function parseAIStream(rawBody: string): ParsedStream {
  const lines = rawBody.split('\n').filter(l => l.trim().length > 0);

  let text = '';
  const toolCalls: ToolCallChunk[] = [];
  const toolResults: ToolResultChunk[] = [];

  for (const line of lines) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice('data:'.length).trim();

    try {
      const event = JSON.parse(payload);
      const type = event.type as string;

      switch (type) {
        // Vercel AI SDK format
        case 'text-delta': {
          if (typeof event.textDelta === 'string') text += event.textDelta;
          break;
        }
        case 'tool-input-available': {
          toolCalls.push({
            toolCallId: event.toolCallId ?? '',
            toolName: event.toolName ?? '',
            args: event.input ?? {},
          });
          break;
        }
        case 'tool-output-available': {
          toolResults.push({
            toolCallId: event.toolCallId ?? '',
            result: event.output ?? event.result ?? event,
          });
          break;
        }

        // Claude native SSE format
        case 'content_block_delta': {
          const delta = event.delta;
          if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
            text += delta.text;
          }
          break;
        }
        case 'content_block_start': {
          const block = event.content_block;
          if (block?.type === 'tool_use') {
            toolCalls.push({
              toolCallId: block.id ?? '',
              toolName: block.name ?? '',
              args: {},
            });
          }
          break;
        }
        case 'tool_result': {
          toolResults.push({
            toolCallId: event.tool_use_id ?? '',
            result: event.content ?? event,
          });
          break;
        }

        default:
          break;
      }
    } catch {
      // Malformed line — skip
    }
  }

  const retrievalContext = toolResults.map(tr =>
    typeof tr.result === 'string'
      ? tr.result
      : JSON.stringify(tr.result, null, 2)
  );

  return { text, toolCalls, toolResults, retrievalContext };
}

/**
 * Capture and parse a streaming response body from a Playwright Response.
 * Returns null if the response body cannot be read or parsed.
 */
export async function captureStreamFromResponse(
  response: import('@playwright/test').Response
): Promise<ParsedStream | null> {
  try {
    const body = await response.text();
    return parseAIStream(body);
  } catch {
    return null;
  }
}
