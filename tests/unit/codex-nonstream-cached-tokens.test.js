import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {})
}));

const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { convertResponsesStreamToJson } = await import("../../open-sse/transformer/streamToJsonConverter.js");
const { handleForcedSSEToJson } = await import("../../open-sse/handlers/chatCore/sseToJsonHandler.js");
const { openaiToOpenAIResponsesRequest } = await import("../../open-sse/translator/request/openai-responses.js");

// Codex Responses SSE: input_tokens already INCLUDES cached_tokens.
const USAGE = {
  input_tokens: 6331,
  input_tokens_details: { cached_tokens: 4096 },
  output_tokens: 57,
  output_tokens_details: { reasoning_tokens: 50 },
  total_tokens: 6388
};

const sseStream = () => {
  const encoder = new TextEncoder();
  const raw = [
    'event: response.created\ndata: {"type":"response.created","response":{"id":"resp_1","created_at":1700000000}}',
    'event: response.output_item.done\ndata: {"type":"response.output_item.done","output_index":0,"item":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"hi"}]}}',
    `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: { id: "resp_1", usage: USAGE } })}`,
    ""
  ].join("\n\n");
  return new ReadableStream({
    start(controller) { controller.enqueue(encoder.encode(raw)); controller.close(); }
  });
};

const ctx = (sourceFormat) => ({
  providerResponse: new Response(sseStream(), { headers: { "content-type": "text/event-stream" } }),
  sourceFormat,
  targetFormat: FORMATS.OPENAI_RESPONSES,
  provider: "codex",
  model: "gpt-5.6-sol",
  body: { model: "cx/gpt-5.6-sol", messages: [] },
  stream: false,
  requestStartTime: Date.now(),
  connectionId: "test-connection",
  clientRawRequest: { endpoint: "/v1/chat/completions" },
  trackDone: vi.fn(),
  appendLog: vi.fn()
});

describe("Codex non-stream usage keeps cached/reasoning breakdown", () => {
  it("converter passes input/output token details through", async () => {
    const json = await convertResponsesStreamToJson(sseStream());
    expect(json.usage).toEqual(USAGE);
  });

  it("chat.completions client gets prompt_tokens_details.cached_tokens without double counting", async () => {
    const appendLog = vi.fn();
    const c = ctx(FORMATS.OPENAI);
    c.appendLog = appendLog;
    const result = await handleForcedSSEToJson(c);
    expect(result.success).toBe(true);
    const json = await result.response.json();
    expect(json.usage).toEqual({
      prompt_tokens: 6331,
      completion_tokens: 57,
      total_tokens: 6388,
      prompt_tokens_details: { cached_tokens: 4096 },
      completion_tokens_details: { reasoning_tokens: 50 }
    });
    // stats/log path sees flat cached_tokens so cost accounting can price the cache hit
    expect(appendLog.mock.calls[0][0].tokens).toMatchObject({ input_tokens: 6331, cached_tokens: 4096, reasoning_tokens: 50 });
  });

  it("responses client gets usage.input_tokens_details as-is", async () => {
    const result = await handleForcedSSEToJson(ctx(FORMATS.OPENAI_RESPONSES));
    const json = await result.response.json();
    expect(json.usage.input_tokens_details).toEqual({ cached_tokens: 4096 });
    expect(json.usage.output_tokens_details).toEqual({ reasoning_tokens: 50 });
  });
});

describe("response_format json_schema → Responses text.format", () => {
  const schema = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false };

  it("maps json_schema with name/strict", () => {
    const out = openaiToOpenAIResponsesRequest("gpt-5.6-sol", {
      messages: [{ role: "user", content: "hi" }],
      response_format: { type: "json_schema", json_schema: { name: "verdict", schema, strict: true } }
    }, false, null);
    expect(out.text).toEqual({ format: { type: "json_schema", name: "verdict", schema, strict: true } });
  });

  it("defaults name and omits strict when absent", () => {
    const out = openaiToOpenAIResponsesRequest("gpt-5.6-sol", {
      messages: [{ role: "user", content: "hi" }],
      response_format: { type: "json_schema", json_schema: { schema } }
    }, false, null);
    expect(out.text).toEqual({ format: { type: "json_schema", name: "response", schema } });
  });

  it("leaves json_object and plain requests untouched", () => {
    const a = openaiToOpenAIResponsesRequest("m", { messages: [], response_format: { type: "json_object" } }, false, null);
    const b = openaiToOpenAIResponsesRequest("m", { messages: [] }, false, null);
    expect(a.text).toBeUndefined();
    expect(b.text).toBeUndefined();
  });
});
