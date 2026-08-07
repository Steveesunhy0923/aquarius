/**
 * JavaScript kernel — worker source, instantiated from a Blob URL.
 *
 * A Blob worker needs no bundler support, so it behaves identically in dev,
 * `next build` and the CAP_STATIC static export (and inside the Capacitor
 * WKWebView, where bundled-worker URLs have historically been flaky).
 *
 * Execution model (Jupyter-ish):
 *  - Code runs through INDIRECT eval, so it executes in the worker's global
 *    scope: `var`/`function` declarations persist across runs.
 *  - Top-level `const`/`let` at column 0 are rewritten to `var` so they also
 *    persist across cells (indented ones — i.e. inside blocks/functions — are
 *    left alone to preserve block scoping). The rewrite skips matches inside
 *    strings, template literals and comments, so code held in a template
 *    literal is never silently altered.
 *  - Top-level `await` (a SyntaxError under eval) retries wrapped in an async
 *    IIFE; declarations in that fallback don't persist, and the cell's value
 *    is only reported when the trailing statement is a plain expression.
 *  - console.* is captured and streamed; the completion value is reported as
 *    a `result` output unless it is `undefined`.
 *  - Output is bounded per message AND per run so a hot print-loop can't flood
 *    postMessage or the main thread; `result`/`error` always get through.
 *  - setTimeout/setInterval callbacks stay tagged with the run that created
 *    them, so output from a stale timer is dropped by the manager instead of
 *    being attributed to whichever block is running now.
 *
 * The worker has no DOM and no cross-run reentrancy; long loops are stopped
 * from outside via worker.terminate() (→ kernel restart).
 */

export const JS_WORKER_SOURCE = String.raw`
"use strict";
var __runId = 0;        // the run a callback belongs to (see timer wrappers)
var __chunks = 0;
var CHUNK_LIMIT = 2000;
var MAX_CHUNK_CHARS = 64 * 1024;

function post(kind, text) {
  var terminal = kind === "error" || kind === "result";
  if (!terminal) {
    if (__chunks >= CHUNK_LIMIT) return;
    __chunks++;
    if (__chunks === CHUNK_LIMIT) {
      self.postMessage({ type: "out", id: __runId, kind: "stderr", text: "\n[output limit reached - further output suppressed]\n" });
      return;
    }
  }
  if (typeof text === "string" && text.length > MAX_CHUNK_CHARS) {
    text = text.slice(0, MAX_CHUNK_CHARS) + "\n[… line truncated]\n";
  }
  self.postMessage({ type: "out", id: __runId, kind: kind, text: text });
}

// Keep a callback's output attributed to the run that scheduled it.
["setTimeout", "setInterval"].forEach(function (name) {
  var orig = self[name];
  self[name] = function (fn) {
    if (typeof fn !== "function") return orig.apply(self, arguments);
    var owner = __runId;
    var rest = Array.prototype.slice.call(arguments, 1);
    return orig.apply(self, [function () {
      var prev = __runId;
      __runId = owner;
      try { return fn.apply(this, arguments); } finally { __runId = prev; }
    }].concat(rest));
  };
});

// REPL-style value formatting: strings quoted, objects JSON-ish, cycles safe.
function fmt(v) {
  if (v === undefined) return "undefined";
  if (v === null) return "null";
  var t = typeof v;
  if (t === "string") return JSON.stringify(v);
  if (t === "number" || t === "boolean") return String(v);
  if (t === "bigint") return String(v) + "n";
  if (t === "symbol") return v.toString();
  if (t === "function") return "[Function: " + (v.name || "anonymous") + "]";
  try {
    if (v instanceof Error) return v.stack || String(v);
    if (v instanceof Map) return "Map(" + v.size + ") " + fmt(Array.from(v.entries()));
    if (v instanceof Set) return "Set(" + v.size + ") " + fmt(Array.from(v.values()));
    if (ArrayBuffer.isView(v)) return v.constructor.name + " [" + Array.prototype.join.call(v.subarray ? v.subarray(0, 100) : v, ", ") + (v.length > 100 ? ", ..." : "") + "]";
  } catch (e) {
    return "[unprintable value]";
  }
  try {
    var seen = new WeakSet();
    return JSON.stringify(v, function (k, val) {
      if (typeof val === "bigint") return String(val) + "n";
      if (typeof val === "function") return "[Function: " + (val.name || "anonymous") + "]";
      if (typeof val === "object" && val !== null) {
        if (seen.has(val)) return "[Circular]";
        seen.add(val);
      }
      return val;
    }, 2);
  } catch (e) {
    try { return String(v); } catch (e2) { return "[unprintable value]"; }
  }
}

function safeFmt(v) {
  try { return fmt(v); } catch (e) { return "[unprintable value]"; }
}

function consoleText(args) {
  var parts = [];
  for (var i = 0; i < args.length; i++) {
    var a = args[i];
    parts.push(typeof a === "string" ? a : safeFmt(a));
  }
  return parts.join(" ") + "\n";
}

["log", "info", "debug", "trace"].forEach(function (m) {
  console[m] = function () { post("stdout", consoleText(arguments)); };
});
["warn", "error"].forEach(function (m) {
  console[m] = function () { post("stderr", consoleText(arguments)); };
});

/**
 * Rewrite column-0 const/let to var so they persist across cells, skipping
 * anything inside a string, template literal or comment (a single pass over
 * the source tracking quoting state — no parser needed).
 */
function persistDecls(code) {
  var out = "";
  var i = 0;
  var atLineStart = true;
  var n = code.length;
  var BACKTICK = String.fromCharCode(96); // kept out of this source's own template
  while (i < n) {
    var c = code[i];
    // comments
    if (c === "/" && code[i + 1] === "/") {
      var nl = code.indexOf("\n", i);
      if (nl === -1) nl = n;
      out += code.slice(i, nl);
      i = nl;
      continue;
    }
    if (c === "/" && code[i + 1] === "*") {
      var end = code.indexOf("*/", i + 2);
      end = end === -1 ? n : end + 2;
      out += code.slice(i, end);
      i = end;
      atLineStart = false;
      continue;
    }
    // strings / template literals (skipped verbatim, escapes honored)
    if (c === '"' || c === "'" || c === BACKTICK) {
      var quote = c;
      var j = i + 1;
      while (j < n) {
        if (code[j] === "\\") { j += 2; continue; }
        if (code[j] === quote) { j++; break; }
        j++;
      }
      out += code.slice(i, j);
      i = j;
      atLineStart = false;
      continue;
    }
    if (atLineStart) {
      var m = /^(const|let)(\s)/.exec(code.slice(i, i + 7));
      if (m) {
        out += "var" + m[2];
        i += m[0].length;
        atLineStart = false;
        continue;
      }
    }
    out += c;
    atLineStart = c === "\n";
    i++;
  }
  return out;
}

/** Top-level await: wrap in an async IIFE, returning a trailing expression so
 *  the cell still reports a value (best-effort — a trailing statement that is
 *  not an expression falls back to the plain wrapper). */
function asyncWrap(code) {
  var lines = code.split("\n");
  var last = lines.length - 1;
  while (last >= 0 && lines[last].trim() === "") last--;
  var tail = last >= 0 ? lines[last].trim() : "";
  var isExpr =
    tail.length > 0 &&
    !/;\s*$/.test(tail) &&
    !/[{}]\s*$/.test(tail) &&
    !/^(return|const|let|var|function|class|if|for|while|switch|try|throw|import|export)\b/.test(tail);
  if (isExpr) {
    var body = lines.slice(0, last).join("\n");
    return "(async () => {\n" + body + "\nreturn (" + lines[last] + "\n);\n})()";
  }
  return "(async () => {\n" + code + "\n})()";
}

self.onmessage = function (e) {
  var msg = e.data;
  if (!msg || msg.type !== "run") return;
  __runId = msg.id;
  __chunks = 0;
  var indirect = eval;
  var finish = function () { self.postMessage({ type: "done", id: msg.id }); };
  var report = function (err) {
    var text;
    try {
      text = err instanceof Error ? (err.stack || String(err)) : String(err);
    } catch (e2) {
      text = "[unprintable error]";
    }
    post("error", text);
  };
  var emit = function (value) {
    if (value !== undefined) post("result", safeFmt(value));
  };
  try {
    var value;
    try {
      value = indirect(persistDecls(msg.code));
    } catch (err) {
      // Top-level await is illegal in eval; retry inside an async wrapper.
      if (err instanceof SyntaxError && /await/.test(String(err && err.message))) {
        value = indirect(asyncWrap(msg.code));
      } else {
        throw err;
      }
    }
    if (value && typeof value.then === "function") {
      // A trailing .then always runs, so 'done' is posted even if emit/report throw.
      Promise.resolve(value)
        .then(function (v) { emit(v); }, function (err) { report(err); })
        .catch(function (err) { report(err); })
        .then(finish, finish);
      return;
    }
    emit(value);
    finish();
  } catch (err) {
    report(err);
    finish();
  }
};

self.postMessage({ type: "ready" });
`;
