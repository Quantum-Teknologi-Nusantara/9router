// claude → claude streaming through the real transform stream: cloaked tool
// names must come back decloaked, and the rest of the SSE must survive intact.
import { describe, it, expect } from "vitest";
import "../translator/registerAll.js";
import { createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { CLAUDE_TOOL_SUFFIX } from "../../open-sse/config/appConstants.js";

const CLOAKED = "run_code" + CLAUDE_TOOL_SUFFIX;

const events = [
  { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "claude-x", content: [], usage: { input_tokens: 10, output_tokens: 1 } } },
  { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } },
  { type: "content_block_stop", index: 0 },
  { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_1", name: CLOAKED, input: {} } },
  { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: "{\"a\":1}" } },
  { type: "content_block_stop", index: 1 },
  { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 7 } },
  { type: "message_stop" },
];

async function run(toolNameMap) {
  const sse = events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
  const ts = createSSETransformStreamWithLogger(FORMATS.CLAUDE, FORMATS.CLAUDE, "claude", null, toolNameMap, "claude-x");
  const writer = ts.writable.getWriter();
  writer.write(new TextEncoder().encode(sse));
  writer.close();
  const out = await new Response(ts.readable).text();
  return out.split("\n").filter(l => l.startsWith("data:") && !l.includes("[DONE]")).map(l => JSON.parse(l.slice(5)));
}

describe("claude → claude transform stream decloaks tool names", () => {
  it("restores the tool name and keeps every event", async () => {
    const out = await run(new Map([[CLOAKED, "run_code"]]));
    expect(JSON.stringify(out)).not.toContain(CLOAKED);
    const toolStart = out.find(e => e.content_block?.type === "tool_use");
    expect(toolStart.content_block.name).toBe("run_code");
    expect(out.map(e => e.type)).toEqual(events.map(e => e.type));
    expect(out.find(e => e.delta?.partial_json).delta.partial_json).toBe("{\"a\":1}");
    expect(out.find(e => e.type === "message_delta").delta.stop_reason).toBe("tool_use");
  });
});
