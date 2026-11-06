"use strict";

// Page wiring for Ask Every Model. All logic that can be tested lives in
// core.js. The visitor key stays in localStorage on this device and is
// only ever sent to gen.pollinations.ai.

(function () {
  var C = window.AskEveryModel;
  var els = {};
  var lastResults = [];
  var lastQuestion = "";
  var running = false;

  function $(id) { return document.getElementById(id); }

  function init() {
    ["key", "keyState", "question", "models", "askBtn", "demoNote", "status",
     "summary", "cards", "judgeBlock", "judgeModel", "judgeBtn", "judgeOut"]
      .forEach(function (id) { els[id] = $(id); });

    renderModelPicker();
    renderJudgePicker();

    var saved = "";
    try { saved = localStorage.getItem(C.STORAGE_KEY) || ""; } catch (e) { saved = ""; }
    if (saved) {
      els.key.value = saved;
      setKeyState("Key loaded from this browser. It is only stored here.", true);
    }

    $("saveKey").addEventListener("click", saveKey);
    $("clearKey").addEventListener("click", clearKey);
    $("checkKey").addEventListener("click", checkKey);
    els.askBtn.addEventListener("click", askAll);
    els.judgeBtn.addEventListener("click", runJudge);
    els.question.addEventListener("keydown", function (ev) {
      if ((ev.metaKey || ev.ctrlKey) && ev.key === "Enter") askAll();
    });
  }

  function renderModelPicker() {
    els.models.innerHTML = "";
    C.MODEL_CATALOG.forEach(function (m) {
      var label = document.createElement("label");
      label.className = "model-pick";
      var box = document.createElement("input");
      box.type = "checkbox";
      box.value = m.id;
      box.checked = m.isDefault;
      var span = document.createElement("span");
      span.textContent = m.lab + " / " + m.title + (m.paidOnly ? " (paid Pollen only)" : "");
      label.appendChild(box);
      label.appendChild(span);
      els.models.appendChild(label);
    });
  }

  function renderJudgePicker() {
    els.judgeModel.innerHTML = "";
    C.MODEL_CATALOG.forEach(function (m) {
      var opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.lab + " / " + m.title;
      els.judgeModel.appendChild(opt);
    });
    els.judgeModel.value = "openai/gpt-5.4-nano";
  }

  function selectedModels() {
    var ids = [];
    els.models.querySelectorAll("input:checked").forEach(function (box) {
      ids.push(box.value);
    });
    return C.resolveSelection(ids);
  }

  function currentKey() {
    var v = C.validateKey(els.key.value);
    return v.ok ? v.key : "";
  }

  function setKeyState(text, good) {
    els.keyState.textContent = text;
    els.keyState.className = good ? "key-state ok" : "key-state";
  }

  function saveKey() {
    var v = C.validateKey(els.key.value);
    if (!v.ok) { setKeyState(v.error, false); return; }
    try { localStorage.setItem(C.STORAGE_KEY, v.key); } catch (e) { /* private mode */ }
    setKeyState("Key saved in this browser only.", true);
  }

  function clearKey() {
    els.key.value = "";
    try { localStorage.removeItem(C.STORAGE_KEY); } catch (e) { /* ignore */ }
    setKeyState("Key cleared. Demo mode is on until a key is entered.", false);
  }

  function checkKey() {
    var key = currentKey();
    if (!key) {
      var v = C.validateKey(els.key.value);
      setKeyState(v.error || "Enter a key first.", false);
      return;
    }
    setKeyState("Checking key...", false);
    fetch(C.API_BASE + "/account/balance", {
      headers: { Authorization: "Bearer " + key }
    }).then(function (res) {
      if (res.status === 200) {
        setKeyState("Key works. It was sent only to gen.pollinations.ai.", true);
      } else if (res.status === 401 || res.status === 403) {
        setKeyState("Key rejected by Pollinations (HTTP " + res.status + ").", false);
      } else {
        setKeyState("Unexpected reply (HTTP " + res.status + ").", false);
      }
    }).catch(function () {
      setKeyState("Could not reach gen.pollinations.ai to check the key.", false);
    });
  }

  function setStatus(text) { els.status.textContent = text; }

  function makeCard(model, state) {
    var card = document.createElement("article");
    card.className = "card " + state;
    card.id = "card-" + model.id.replace(/[^a-z0-9]+/gi, "-");
    var head = document.createElement("div");
    head.className = "card-head";
    var name = document.createElement("strong");
    name.textContent = model.lab + " / " + model.title;
    var badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = state;
    head.appendChild(name);
    head.appendChild(badge);
    var meta = document.createElement("div");
    meta.className = "card-meta";
    meta.textContent = model.id;
    var body = document.createElement("div");
    body.className = "card-body";
    body.textContent = state === "waiting" ? "Waiting..." : "";
    card.appendChild(head);
    card.appendChild(meta);
    card.appendChild(body);
    return card;
  }

  function fillCard(result) {
    var card = $("card-" + result.modelId.replace(/[^a-z0-9]+/gi, "-"));
    if (!card) return;
    card.className = "card " + (result.ok ? "done" : "failed");
    var badge = card.querySelector(".badge");
    badge.textContent = result.demo ? "demo" : (result.ok ? "done" : "failed");
    var meta = card.querySelector(".card-meta");
    var bits = [result.modelId];
    if (result.latencyMs != null) bits.push(Math.round(result.latencyMs) + " ms");
    if (result.ok && result.usage) {
      if (result.usage.totalTokens != null) bits.push(result.usage.totalTokens + " tokens");
      if (result.usage.promptTokens != null && result.usage.completionTokens != null) {
        bits.push(result.usage.promptTokens + " in / " + result.usage.completionTokens + " out");
      }
    }
    meta.textContent = bits.join(" / ");
    var body = card.querySelector(".card-body");
    body.textContent = result.ok ? result.text : ("Failed: " + (result.error || "unknown error"));
  }

  function callModel(model, question, key) {
    var started = performance.now();
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 120000);
    return fetch(C.API_BASE + "/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + key
      },
      body: JSON.stringify(C.buildChatRequest(model.id, question)),
      signal: controller.signal
    }).then(function (res) {
      return res.text().then(function (raw) {
        var data = null;
        try { data = JSON.parse(raw); } catch (e) { data = null; }
        var parsed = data
          ? C.parseChatResponse(data)
          : { ok: false, error: "HTTP " + res.status + ", reply was not JSON." };
        if (!parsed.ok && res.status !== 200 && !parsed.error) {
          parsed.error = "HTTP " + res.status;
        }
        if (!parsed.ok && data && !data.error) {
          parsed.error = parsed.error || ("HTTP " + res.status);
        }
        return {
          modelId: model.id, ok: parsed.ok, text: parsed.text || "",
          error: parsed.error || "", usage: parsed.usage || null,
          latencyMs: performance.now() - started, demo: false
        };
      });
    }).catch(function (err) {
      return {
        modelId: model.id, ok: false, text: "",
        error: err && err.name === "AbortError" ? "Timed out after 120 seconds." : "Network error.",
        usage: null, latencyMs: performance.now() - started, demo: false
      };
    }).finally(function () { clearTimeout(timer); });
  }

  function demoResult(model) {
    return new Promise(function (resolve) {
      setTimeout(function () {
        resolve({
          modelId: model.id, ok: true, text: C.getDemoAnswer(model.id),
          error: "", usage: { promptTokens: null, completionTokens: null, totalTokens: null },
          latencyMs: 120 + Math.random() * 600, demo: true
        });
      }, 150 + Math.random() * 500);
    });
  }

  function askAll() {
    if (running) return;
    var question = els.question.value.trim();
    if (!question) { setStatus("Type a question first."); els.question.focus(); return; }
    var models = selectedModels();
    var key = currentKey();
    var demo = !key;
    running = true;
    lastQuestion = question;
    lastResults = [];
    els.judgeBlock.hidden = true;
    els.judgeOut.innerHTML = "";
    els.summary.textContent = "";
    els.demoNote.hidden = !demo;
    els.cards.innerHTML = "";
    models.forEach(function (m) { els.cards.appendChild(makeCard(m, "waiting")); });
    setStatus(demo
      ? "Demo mode: showing sample answers, no models were called."
      : "Asking " + models.length + " models the same question...");

    var jobs = models.map(function (m) {
      var job = demo ? demoResult(m) : callModel(m, question, key);
      return job.then(function (result) {
        lastResults.push(result);
        fillCard(result);
        return result;
      });
    });

    Promise.all(jobs).then(function (results) {
      running = false;
      var s = C.summariseResults(results);
      els.summary.textContent =
        s.succeeded + " of " + s.total + " answered, " + s.failed + " failed" +
        (s.totalTokens ? ", " + s.totalTokens + " tokens total" : "") +
        (demo ? ". Demo mode, sample answers only." : ".");
      setStatus("Done.");
      if (s.succeeded >= 2 && !demo) els.judgeBlock.hidden = false;
      if (s.succeeded >= 2 && demo) {
        els.judgeBlock.hidden = false;
        els.judgeBtn.disabled = true;
        els.judgeBtn.title = "Judge needs a key. Demo answers are not judged.";
      } else {
        els.judgeBtn.disabled = false;
        els.judgeBtn.title = "";
      }
    });
  }

  function runJudge() {
    var key = currentKey();
    if (!key) { setStatus("Judge pass needs a key."); return; }
    var model = C.getModel(els.judgeModel.value) || C.getDefaultModels()[0];
    var okResults = lastResults.filter(function (r) { return r.ok; });
    if (okResults.length < 2) { setStatus("Need at least two answers to judge."); return; }
    els.judgeBtn.disabled = true;
    els.judgeOut.textContent = "Judge is reading " + okResults.length + " answers...";
    callModel(model, C.buildJudgePrompt(lastQuestion, okResults), key).then(function (result) {
      els.judgeBtn.disabled = false;
      if (!result.ok) {
        els.judgeOut.textContent = "Judge failed: " + result.error;
        return;
      }
      renderJudge(C.parseJudgeResponse(result.text), model);
    });
  }

  function renderJudge(judged, model) {
    els.judgeOut.innerHTML = "";
    var title = document.createElement("p");
    title.innerHTML = "";
    var strong = document.createElement("strong");
    strong.textContent = "Judge: " + model.lab + " / " + model.title;
    title.appendChild(strong);
    els.judgeOut.appendChild(title);
    if (!judged.structured) {
      var raw = document.createElement("p");
      raw.textContent = judged.agreement;
      els.judgeOut.appendChild(raw);
      var note = document.createElement("p");
      note.className = "card-meta";
      note.textContent = "Judge reply was not structured JSON, shown as returned.";
      els.judgeOut.appendChild(note);
      return;
    }
    function block(label, text) {
      if (!text) return;
      var h = document.createElement("h3");
      h.textContent = label;
      var p = document.createElement("p");
      p.textContent = text;
      els.judgeOut.appendChild(h);
      els.judgeOut.appendChild(p);
    }
    function list(label, items) {
      if (!items || !items.length) return;
      var h = document.createElement("h3");
      h.textContent = label;
      var ul = document.createElement("ul");
      items.forEach(function (item) {
        var li = document.createElement("li");
        li.textContent = item;
        ul.appendChild(li);
      });
      els.judgeOut.appendChild(h);
      els.judgeOut.appendChild(ul);
    }
    block("Where they agree", judged.agreement);
    list("Where they differ", judged.differences);
    list("Outliers", judged.outliers);
    block("Consensus answer", judged.consensusAnswer);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
