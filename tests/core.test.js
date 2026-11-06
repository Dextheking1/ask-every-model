"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../core.js");

// Model selection

test("default selection has at least 8 models", () => {
  assert.ok(C.getDefaultModels().length >= 8, "need 8+ defaults");
});

test("default selection covers at least 8 different labs, one per lab", () => {
  const defaults = C.getDefaultModels();
  const labs = C.uniqueLabs(defaults);
  assert.equal(labs.length, defaults.length, "defaults must be one per lab");
  assert.ok(labs.length >= 8);
  for (const lab of ["OpenAI", "DeepSeek", "Z.ai", "Moonshot AI", "Mistral", "Meta", "xAI", "Qwen"]) {
    assert.ok(labs.includes(lab), "missing lab " + lab);
  }
});

test("no default model is paid-only, so a free tier key can run them all", () => {
  for (const m of C.getDefaultModels()) {
    assert.equal(m.paidOnly, false, m.id + " is paid-only but is a default");
  }
});

test("GLM 5.3 Flash is a default", () => {
  assert.ok(C.getDefaultModelIds().includes("z-ai/glm-5.3-flash"));
});

test("resolveSelection keeps known ids in catalog order and drops duplicates and junk", () => {
  const picked = C.resolveSelection([
    "z-ai/glm-5.3-flash", "openai/gpt-5.4-nano", "z-ai/glm-5.3-flash", "nope/not-a-model"
  ]);
  assert.deepEqual(picked.map((m) => m.id), ["openai/gpt-5.4-nano", "z-ai/glm-5.3-flash"]);
});

test("resolveSelection falls back to defaults on empty input", () => {
  assert.deepEqual(
    C.resolveSelection([]).map((m) => m.id),
    C.getDefaultModelIds()
  );
  assert.deepEqual(
    C.resolveSelection(["nope/not-a-model"]).map((m) => m.id),
    C.getDefaultModelIds()
  );
});

// Key validation

test("validateKey accepts sk_ and pk_ keys and trims them", () => {
  assert.deepEqual(C.validateKey("  sk_abcdefghijklmnopqrstuv  "), {
    ok: true, key: "sk_abcdefghijklmnopqrstuv"
  });
  assert.equal(C.validateKey("pk_abcdefghijklmnopqrstuv").ok, true);
});

test("validateKey rejects empty, spaced, short and wrong-prefix keys", () => {
  assert.equal(C.validateKey("").ok, false);
  assert.equal(C.validateKey(null).ok, false);
  assert.equal(C.validateKey("sk_short").ok, false);
  assert.equal(C.validateKey("xx_abcdefghijklmnopqrstuv").ok, false);
  assert.equal(C.validateKey("sk_abc defghijklmnopqrstuv").ok, false);
});

// Request building

test("buildChatRequest sends the identical prompt with reasoning guardrails", () => {
  const a = C.buildChatRequest("openai/gpt-5.4-nano", "Same question?");
  const b = C.buildChatRequest("z-ai/glm-5.3-flash", "Same question?");
  assert.equal(a.messages[0].content, "Same question?");
  assert.deepEqual(
    { messages: a.messages, reasoning_effort: a.reasoning_effort, max_tokens: a.max_tokens },
    { messages: b.messages, reasoning_effort: b.reasoning_effort, max_tokens: b.max_tokens }
  );
  assert.equal(a.reasoning_effort, "low");
  assert.equal(a.max_tokens, 4000);
  assert.equal(a.model, "openai/gpt-5.4-nano");
  assert.equal(b.model, "z-ai/glm-5.3-flash");
});

// Chat response parsing

test("parseChatResponse reads a normal completion and its usage", () => {
  const out = C.parseChatResponse({
    choices: [{ message: { content: " Paris. " }, finish_reason: "stop" }],
    usage: { prompt_tokens: 9, completion_tokens: 3, total_tokens: 12 }
  });
  assert.equal(out.ok, true);
  assert.equal(out.text, "Paris.");
  assert.deepEqual(out.usage, { promptTokens: 9, completionTokens: 3, totalTokens: 12 });
  assert.equal(out.finishReason, "stop");
});

test("parseChatResponse joins array content parts", () => {
  const out = C.parseChatResponse({
    choices: [{ message: { content: [{ type: "text", text: "Par" }, { type: "text", text: "is" }] } }],
    usage: {}
  });
  assert.equal(out.ok, true);
  assert.equal(out.text, "Paris");
  assert.equal(out.usage.totalTokens, null);
});

test("parseChatResponse turns error payloads and empty answers into failures", () => {
  const err = C.parseChatResponse({ error: { message: "Insufficient balance" } });
  assert.equal(err.ok, false);
  assert.match(err.error, /Insufficient balance/);
  assert.equal(C.parseChatResponse({ choices: [] }).ok, false);
  assert.equal(C.parseChatResponse({ choices: [{ message: { content: "   " } }] }).ok, false);
  assert.equal(C.parseChatResponse(null).ok, false);
});

// Judge prompt and parsing

test("buildJudgePrompt includes the question, only ok answers, and the JSON shape", () => {
  const prompt = C.buildJudgePrompt("Capital of France?", [
    { modelId: "a/1", ok: true, text: "Paris" },
    { modelId: "b/2", ok: false, text: "", error: "boom" },
    { modelId: "c/3", ok: true, text: "Paris, on the Seine" }
  ]);
  assert.match(prompt, /Capital of France\?/);
  assert.match(prompt, /a\/1/);
  assert.match(prompt, /c\/3/);
  assert.doesNotMatch(prompt, /b\/2/);
  assert.match(prompt, /consensus_answer/);
});

test("parseJudgeResponse parses bare JSON", () => {
  const out = C.parseJudgeResponse(JSON.stringify({
    agreement: "All say Paris",
    differences: ["B adds the river"],
    outliers: ["none"],
    consensus_answer: "Paris"
  }));
  assert.equal(out.ok, true);
  assert.equal(out.structured, true);
  assert.equal(out.agreement, "All say Paris");
  assert.deepEqual(out.differences, ["B adds the river"]);
  assert.equal(out.consensusAnswer, "Paris");
});

test("parseJudgeResponse parses fenced JSON surrounded by prose", () => {
  const out = C.parseJudgeResponse(
    "Here is the verdict:\n```json\n{\"agreement\":\"Same\",\"differences\":[],\"outliers\":[],\"consensus_answer\":\"Paris\"}\n```\nDone."
  );
  assert.equal(out.structured, true);
  assert.equal(out.consensusAnswer, "Paris");
});

test("parseJudgeResponse keeps non-JSON judge text as a raw fallback", () => {
  const out = C.parseJudgeResponse("They mostly agree, one rambled.");
  assert.equal(out.ok, true);
  assert.equal(out.structured, false);
  assert.equal(out.agreement, "They mostly agree, one rambled.");
  assert.equal(C.parseJudgeResponse("  ").ok, false);
});

test("parseJudgeResponse tolerates string lists and camelCase consensus key", () => {
  const out = C.parseJudgeResponse(JSON.stringify({
    agreement: "A", differences: "one diff", outliers: "none", consensusAnswer: "P"
  }));
  assert.deepEqual(out.differences, ["one diff"]);
  assert.equal(out.consensusAnswer, "P");
});

// Summary and demo data

test("summariseResults counts outcomes, tokens and latency range", () => {
  const s = C.summariseResults([
    { ok: true, usage: { totalTokens: 10 }, latencyMs: 300 },
    { ok: true, usage: { totalTokens: 5 }, latencyMs: 100 },
    { ok: false, error: "x", latencyMs: 999 }
  ]);
  assert.deepEqual(s, {
    total: 3, succeeded: 2, failed: 1, totalTokens: 15, fastestMs: 100, slowestMs: 300
  });
  assert.equal(C.summariseResults([]).fastestMs, null);
});

test("every default model has a labelled demo answer", () => {
  for (const m of C.getDefaultModels()) {
    assert.match(C.getDemoAnswer(m.id), /^Sample answer\./, m.id);
  }
  assert.match(C.getDemoAnswer("unknown/model"), /^Sample answer\./);
});

test("API base points at the unified Pollinations gateway", () => {
  assert.equal(C.API_BASE, "https://gen.pollinations.ai");
});
