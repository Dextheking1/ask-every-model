# Ask Every Model

Ask one question, get answers from models by many different labs at the
same time, side by side. Then, if you want, one model judges the set:
where they agree, where they differ, any outliers, and a consensus answer.

Live app: (added when the GitHub Pages site is published)

## How it works

1. Type one question.
2. Pick models. The defaults are one per lab, ten labs: OpenAI, DeepSeek,
   Z.ai, Moonshot AI, Mistral, Meta, xAI, Qwen, MiniMax and NVIDIA.
3. The exact same prompt is sent to every picked model in parallel, as a
   POST to `https://gen.pollinations.ai/v1/chat/completions`.
4. Each answer lands in its own card with the model id, latency, and token
   counts (prompt, completion, total). A model that errors or times out
   gets a failed card with the error, it does not block the others.
5. Optional judge pass: a model you pick reads all the answers and replies
   in a strict JSON shape, which the page renders as agreement,
   differences, outliers and a consensus answer.

Every request carries `reasoning_effort: "low"` and `max_tokens: 4000`.
Reasoning models need both, or they spend the whole budget on hidden
reasoning and return a token exhaustion error.

The model list is a snapshot of https://gen.pollinations.ai/v1/models
taken on 2026-11-06. Defaults were picked to be not paid-only, so a free
tier key can run the full default set. Paid-only models (Claude, Gemini)
are in the picker too, off by default, and need paid Pollen.

## BYOP: bring your own Pollen

There is no server and no shared key. Paste your own Pollinations key
(`sk_...` or `pk_...`) into the key field:

- The key is stored only in your browser, in localStorage.
- The key is sent only to gen.pollinations.ai, in the Authorization
  header, for your balance check and your model calls.
- Every call is billed to your own Pollen balance. The app author pays
  nothing and sees nothing.
- Clear removes the key from localStorage.

Get a free key at https://enter.pollinations.ai/keys

No key? The app runs in demo mode. Cards fill with sample answers that
are labelled as sample answers everywhere they appear, a demo banner
shows, and nothing is called or billed. The judge pass needs a real key.

## Run it locally

It is a plain static site, no build step:

```sh
python3 -m http.server 8000
# open http://127.0.0.1:8000
```

Or just open `index.html` in a browser.

## Tests

Core logic (model selection, key format check, request building,
response parsing, judge parsing, result summary) lives in `core.js` and
runs in node as well as the browser:

```sh
node --test tests/core.test.js
```

20 tests, all passing at the time of writing.

## Files

- `index.html` - the page, markup and styles
- `core.js` - model catalog and all testable logic
- `app.js` - page wiring, parallel calls, cards, judge rendering
- `tests/core.test.js` - node tests for `core.js`
- `SUBMISSION.md` - the Pollinations app submission text

## Quest

This app is a submission for Pollinations quest #19183 in
pollinations/pollinations: "An app or game about asking every model the
same question" (10 Pollen on acceptance).

## License

MIT
