"use strict";

// Core logic for Ask Every Model.
// Runs in the browser as window.AskEveryModel and in node for tests.
// Model list snapshot from https://gen.pollinations.ai/v1/models on 2026-11-06.
// Defaults: one model per lab, none of them paid-only, so a free tier
// (tier Pollen) key can call every default.

var MODEL_CATALOG = [
  { id: "openai/gpt-5.4-nano", lab: "OpenAI", title: "GPT-5.4 Nano", paidOnly: false, isDefault: true },
  { id: "openai/gpt-5.5", lab: "OpenAI", title: "GPT-5.5", paidOnly: false, isDefault: false },
  { id: "deepseek/deepseek-v4.1-flash", lab: "DeepSeek", title: "DeepSeek V4.1 Flash", paidOnly: false, isDefault: true },
  { id: "z-ai/glm-5.3-flash", lab: "Z.ai", title: "GLM 5.3 Flash", paidOnly: false, isDefault: true },
  { id: "z-ai/glm-5.3", lab: "Z.ai", title: "GLM 5.3", paidOnly: false, isDefault: false },
  { id: "moonshotai/kimi-k2.6", lab: "Moonshot AI", title: "Kimi K2.6", paidOnly: false, isDefault: true },
  { id: "moonshotai/kimi-k3", lab: "Moonshot AI", title: "Kimi K3", paidOnly: false, isDefault: false },
  { id: "mistralai/mistral-large-3", lab: "Mistral", title: "Mistral Large 3", paidOnly: false, isDefault: true },
  { id: "meta/llama-3.3-70b-instruct", lab: "Meta", title: "Llama 3.3 70B", paidOnly: false, isDefault: true },
  { id: "x-ai/grok-4.3", lab: "xAI", title: "Grok 4.3", paidOnly: false, isDefault: true },
  { id: "x-ai/grok-4.6", lab: "xAI", title: "Grok 4.6", paidOnly: false, isDefault: false },
  { id: "qwen/qwen3.8-2.4t-a95b", lab: "Qwen", title: "Qwen3.8 2.4T A95B", paidOnly: false, isDefault: true },
  { id: "minimax/minimax-m3.1-flash", lab: "MiniMax", title: "MiniMax M3.1 Flash", paidOnly: false, isDefault: true },
  { id: "nvidia/nemotron-3.5-lightning", lab: "NVIDIA", title: "Nemotron 3.5 Lightning", paidOnly: false, isDefault: true },
  { id: "anthropic/claude-sonnet-4.6", lab: "Anthropic", title: "Claude Sonnet 4.6", paidOnly: true, isDefault: false },
  { id: "google/gemini-3.7-flash", lab: "Google", title: "Gemini 3.7 Flash", paidOnly: true, isDefault: false }
];

var API_BASE = "https://gen.pollinations.ai";
var STORAGE_KEY = "ask_every_model_pollinations_key";

function getModel(id) {
  for (var i = 0; i < MODEL_CATALOG.length; i++) {
    if (MODEL_CATALOG[i].id === id) return MODEL_CATALOG[i];
  }
  return null;
}

function getDefaultModels() {
  return MODEL_CATALOG.filter(function (m) { return m.isDefault; });
}

function getDefaultModelIds() {
  return getDefaultModels().map(function (m) { return m.id; });
}

// Keep only known ids, drop duplicates, keep catalog order.
// An empty or all-unknown selection falls back to the defaults.
function resolveSelection(ids) {
  var wanted = {};
  (ids || []).forEach(function (id) { wanted[id] = true; });
  var picked = MODEL_CATALOG.filter(function (m) { return wanted[m.id]; });
  if (picked.length === 0) return getDefaultModels();
  return picked;
}

function uniqueLabs(models) {
  var seen = {};
  (models || []).forEach(function (m) { seen[m.lab] = true; });
  return Object.keys(seen);
}

// Local format check only. The live check happens in the page against
// /account/balance. Keys are secret (sk_) or publishable (pk_).
function validateKey(key) {
  if (typeof key !== "string") return { ok: false, error: "Key must be text." };
  var trimmed = key.trim();
  if (trimmed.length === 0) return { ok: false, error: "No key entered." };
  if (/\s/.test(trimmed)) return { ok: false, error: "Key contains spaces." };
  if (!/^(sk_|pk_)/.test(trimmed)) return { ok: false, error: "Key should start with sk_ or pk_." };
  if (trimmed.length < 20) return { ok: false, error: "Key looks too short." };
  return { ok: true, key: trimmed };
}

// One identical request body for every model. Reasoning models need
// reasoning_effort low and a generous max_tokens or they burn the whole
// budget on hidden reasoning and return a token exhaustion error.
function buildChatRequest(modelId, question) {
  return {
    model: modelId,
    messages: [{ role: "user", content: String(question || "") }],
    reasoning_effort: "low",
    max_tokens: 4000
  };
}

// Normalise an OpenAI style chat completion response.
// Returns { ok:false, error } for error payloads and empty answers.
function parseChatResponse(data) {
  if (!data || typeof data !== "object") {
    return { ok: false, error: "Empty response from the API." };
  }
  if (data.error) {
    var msg = (data.error && data.error.message) || "API error.";
    return { ok: false, error: String(msg) };
  }
  var choice = (data.choices || [])[0];
  if (!choice || !choice.message) {
    return { ok: false, error: "Response had no answer." };
  }
  var content = choice.message.content;
  var text = "";
  if (typeof content === "string") {
    text = content;
  } else if (Array.isArray(content)) {
    text = content.map(function (part) {
      if (typeof part === "string") return part;
      return part && typeof part.text === "string" ? part.text : "";
    }).join("");
  }
  text = text.trim();
  if (!text) return { ok: false, error: "Model returned an empty answer." };
  var usage = data.usage || {};
  return {
    ok: true,
    text: text,
    usage: {
      promptTokens: usage.prompt_tokens != null ? usage.prompt_tokens : null,
      completionTokens: usage.completion_tokens != null ? usage.completion_tokens : null,
      totalTokens: usage.total_tokens != null ? usage.total_tokens : null
    },
    finishReason: choice.finish_reason || null
  };
}

function buildJudgePrompt(question, results) {
  var ok = (results || []).filter(function (r) { return r && r.ok; });
  var lines = ok.map(function (r) {
    return "Model: " + r.modelId + "\nAnswer: " + r.text;
  });
  return [
    "You are the judge. Several models were asked the same question.",
    "Compare their answers and reply with strict JSON only, no code fence, no extra text.",
    'Shape: {"agreement":"short text","differences":["short text"],"outliers":["model id or none"],"consensus_answer":"short text"}',
    "",
    "Question: " + String(question || ""),
    "",
    lines.join("\n\n")
  ].join("\n");
}

// Parse the judge reply. Handles a bare JSON object and a JSON object
// wrapped in a code fence or surrounded by prose. Falls back to keeping
// the raw text as the agreement field so nothing is lost on screen.
function parseJudgeResponse(text) {
  var raw = typeof text === "string" ? text.trim() : "";
  if (!raw) return { ok: false, error: "Judge returned an empty answer." };
  var candidate = raw;
  var fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) candidate = fence[1].trim();
  var start = candidate.indexOf("{");
  var end = candidate.lastIndexOf("}");
  if (start !== -1 && end > start) candidate = candidate.slice(start, end + 1);
  try {
    var parsed = JSON.parse(candidate);
    function asList(v) {
      if (Array.isArray(v)) return v.map(String);
      if (typeof v === "string" && v) return [v];
      return [];
    }
    return {
      ok: true,
      structured: true,
      agreement: typeof parsed.agreement === "string" ? parsed.agreement : "",
      differences: asList(parsed.differences),
      outliers: asList(parsed.outliers),
      consensusAnswer: typeof parsed.consensus_answer === "string"
        ? parsed.consensus_answer
        : (typeof parsed.consensusAnswer === "string" ? parsed.consensusAnswer : "")
    };
  } catch (e) {
    return {
      ok: true,
      structured: false,
      agreement: raw,
      differences: [],
      outliers: [],
      consensusAnswer: ""
    };
  }
}

function summariseResults(results) {
  var list = results || [];
  var done = list.filter(function (r) { return r && r.ok; });
  var failed = list.filter(function (r) { return r && !r.ok; });
  var totalTokens = done.reduce(function (sum, r) {
    return sum + (r.usage && r.usage.totalTokens ? r.usage.totalTokens : 0);
  }, 0);
  var latencies = done.map(function (r) { return r.latencyMs || 0; });
  return {
    total: list.length,
    succeeded: done.length,
    failed: failed.length,
    totalTokens: totalTokens,
    fastestMs: latencies.length ? Math.min.apply(null, latencies) : null,
    slowestMs: latencies.length ? Math.max.apply(null, latencies) : null
  };
}

// Demo answers. Used only when no key is entered. The page labels every
// demo card and the demo banner as sample data, never as a live answer.
var DEMO_ANSWERS = {
  "openai/gpt-5.4-nano": "Sample answer. The capital of France is Paris. It has been the political and cultural centre of France for centuries.",
  "deepseek/deepseek-v4.1-flash": "Sample answer. Paris is the capital of France, located on the River Seine in the north of the country.",
  "z-ai/glm-5.3-flash": "Sample answer. The capital city of France is Paris, home to about two million people in the city proper.",
  "moonshotai/kimi-k2.6": "Sample answer. Paris. It is also the largest city in France and its main economic hub.",
  "mistralai/mistral-large-3": "Sample answer. The capital of France is Paris, seat of the French government and the Elysee Palace.",
  "meta/llama-3.3-70b-instruct": "Sample answer. Paris is the capital and most populous city of France.",
  "x-ai/grok-4.3": "Sample answer. Paris, obviously. Capital of France, on the Seine, famous for the Eiffel Tower.",
  "qwen/qwen3.8-2.4t-a95b": "Sample answer. The capital of France is Paris, a major centre for art, fashion and finance.",
  "minimax/minimax-m3.1-flash": "Sample answer. Paris is the capital city of France, situated in the Ile-de-France region.",
  "nvidia/nemotron-3.5-lightning": "Sample answer. Capital of France: Paris."
};

function getDemoAnswer(modelId) {
  return DEMO_ANSWERS[modelId] ||
    "Sample answer. This is demo text for this model, shown because no key is entered.";
}

var api = {
  MODEL_CATALOG: MODEL_CATALOG,
  API_BASE: API_BASE,
  STORAGE_KEY: STORAGE_KEY,
  DEMO_ANSWERS: DEMO_ANSWERS,
  getModel: getModel,
  getDefaultModels: getDefaultModels,
  getDefaultModelIds: getDefaultModelIds,
  resolveSelection: resolveSelection,
  uniqueLabs: uniqueLabs,
  validateKey: validateKey,
  buildChatRequest: buildChatRequest,
  parseChatResponse: parseChatResponse,
  buildJudgePrompt: buildJudgePrompt,
  parseJudgeResponse: parseJudgeResponse,
  summariseResults: summariseResults,
  getDemoAnswer: getDemoAnswer
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = api;
}
if (typeof window !== "undefined") {
  window.AskEveryModel = api;
}
