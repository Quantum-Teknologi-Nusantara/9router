import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
  trackPendingRequest: vi.fn()
}));

const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { formatUsage } = await import("../../open-sse/utils/usageTracking.js");
const { handleNonStreamingResponse } = await import("../../open-sse/handlers/chatCore/nonStreamingHandler.js");

// Client-facing usage must equal upstream usage exactly: no synthetic padding.
describe("usage is reported exactly as upstream (no BUFFER_TOKENS)", () => {
  it("estimated usage carries no padding", () => {
    expect(formatUsage(100, 10, FORMATS.OPENAI)).toEqual({ prompt_tokens: 100, completion_tokens: 10, total_tokens: 110, estimated: true });
    expect(formatUsage(100, 10, FORMATS.CLAUDE)).toEqual({ input_tokens: 100, output_tokens: 10, estimated: true });
  });

  it("non-stream chat.completion usage passes through unchanged", async () => {
    const upstream = {
      id: "chatcmpl-1", object: "chat.completion", created: 1700000000, model: "gpt-x",
      choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 4331, completion_tokens: 7, total_tokens: 4338, prompt_tokens_details: { cached_tokens: 4096 } }
    };
    const result = await handleNonStreamingResponse({
      providerResponse: new Response(JSON.stringify(upstream), { headers: { "content-type": "application/json" } }),
      provider: "openai", model: "gpt-x",
      sourceFormat: FORMATS.OPENAI, targetFormat: FORMATS.OPENAI,
      body: { model: "gpt-x", messages: [] }, stream: false,
      requestStartTime: Date.now(), connectionId: "c",
      clientRawRequest: { endpoint: "/v1/chat/completions" },
      reqLogger: { logProviderResponse: vi.fn(), logConvertedResponse: vi.fn() },
      trackDone: vi.fn(), appendLog: vi.fn()
    });
    const json = await result.response.json();
    expect(json.usage).toEqual(upstream.usage);
  });
});
