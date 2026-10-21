import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAgyStream, toStandardJsonSchema } from "./antigravityCritic.ts";

const line = (o: unknown) => JSON.stringify(o);

test("parseAgyStream returns structured output and ignores benign steps", () => {
  const out = [
    line({ event: "init", init: { model: "gemini-3.8-flash-high" } }),
    line({ event: "step_update", step_update: { step_type: "agent_response", state: "DONE" } }),
    line({ event: "step_update", step_update: { step_type: "finish", state: "DONE" } }),
    line({ event: "result", result: { status: "SUCCESS", conversation_id: "c1", response: "", structured_output: { ok: true }, usage: { total_tokens: 10 } } }),
  ].join("\n");
  const r = parseAgyStream(out);
  assert.deepEqual(r.data, { ok: true });
  assert.deepEqual(r.tool_steps, []);
});

test("parseAgyStream records real tool steps, falls back to response text, and reports errors", () => {
  const withTool = [
    line({ event: "step_update", step_update: { step_type: "browser_open_url", state: "DONE" } }),
    line({ event: "result", result: { status: "SUCCESS", response: 'Here you go: {"ok": true}' } }),
  ].join("\n");
  const r = parseAgyStream(withTool);
  assert.deepEqual(r.tool_steps, ["browser_open_url"]);
  assert.deepEqual(r.data, { ok: true });

  const denied = line({ event: "result", result: { status: "SUCCESS", response: "", denied_actions: [{ action: "command", display_name: "RunCommand" }] } });
  assert.throws(() => parseAgyStream(denied), /blocked tools: RunCommand/);
  assert.throws(() => parseAgyStream(line({ event: "result", result: { status: "ERROR", error: "quota" } })), /quota/);
  assert.throws(() => parseAgyStream("not json"), /no result event/);
});

test("toStandardJsonSchema lowercases Gemini schema types recursively", () => {
  const s = toStandardJsonSchema({ type: "OBJECT", properties: { a: { type: "ARRAY", items: { type: "STRING" } } }, required: ["a"] }) as Record<string, any>;
  assert.equal(s.type, "object");
  assert.equal(s.properties.a.type, "array");
  assert.equal(s.properties.a.items.type, "string");
  assert.deepEqual(s.required, ["a"]);
});
