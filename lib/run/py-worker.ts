/**
 * Python kernel — Pyodide in a Blob-URL MODULE worker.
 *
 * Pyodide ≥ 314 is ESM-only (its loader throws "Classic web workers are not
 * supported"), so unlike the JS kernel this worker is created with
 * `{ type: "module" }` and pulls `pyodide.mjs` via dynamic import().
 *
 * The runtime is vendored into /pyodide/ (scripts/prepare-pyodide.mjs) so the
 * core interpreter works fully offline — web and Capacitor iPad alike. If the
 * vendored copy is missing (e.g. a deploy that skipped the prepare script),
 * the worker falls back to the version-pinned jsDelivr CDN; if neither loads
 * it reports `boot-error` so the manager can retry with a fresh worker later.
 * Third-party packages (numpy, pandas, …) are auto-loaded from imports via
 * loadPackagesFromImports; those wheels are NOT vendored and need network.
 *
 * Execution mirrors Jupyter, and the cell's value is repr'd INSIDE Python (a
 * small `_aq_run` helper) rather than on the JS side: Pyodide converts Python
 * primitives to JS on return, which would print `2.0` as `2` and leak a
 * PyProxy per run. stdout/stderr stream line-by-line while the run is
 * in flight, bounded per message so one huge print can't flood the page.
 *
 * There is no COOP/COEP anywhere in this app (and `output: export` cannot set
 * headers), so SharedArrayBuffer interrupts are unavailable — Stop terminates
 * the worker and the next run boots a fresh kernel.
 */

import { version as PYODIDE_VERSION } from "pyodide/package.json";

export { PYODIDE_VERSION };

export const PYODIDE_LOCAL_PATH = "/pyodide/";
export const PYODIDE_CDN_BASE = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

/** Defined in the kernel's `__main__` globals, so user variables set by a cell
 *  persist into the next one exactly like Jupyter. */
const RUNNER_PY = `
import pyodide.code as _aq_code

async def _aq_run(_aq_src):
    _aq_value = await _aq_code.eval_code_async(_aq_src, globals())
    if _aq_value is None:
        return None
    try:
        return repr(_aq_value)
    except BaseException as _aq_err:
        return "<repr failed: " + type(_aq_err).__name__ + ">"
`;

/** Build the worker source with the loader URLs baked in (a Blob worker can't
 *  resolve relative URLs, so the page passes absolute ones). */
export function pyWorkerSource(localBase: string, cdnBase: string): string {
  const cfg = JSON.stringify({ localBase, cdnBase, runner: RUNNER_PY });
  return (
    "var CFG = " +
    cfg +
    ";\n" +
    String.raw`
var pyodide = null;
var runner = null;
var runId = 0;
var chunks = 0;
var CHUNK_LIMIT = 2000;
var MAX_CHUNK_CHARS = 64 * 1024;

function post(kind, text) {
  var terminal = kind === "error" || kind === "result";
  if (!terminal) {
    if (chunks >= CHUNK_LIMIT) return;
    chunks++;
    if (chunks === CHUNK_LIMIT) {
      self.postMessage({ type: "out", id: runId, kind: "stderr", text: "\n[output limit reached - further output suppressed]\n" });
      return;
    }
  }
  if (typeof text === "string" && text.length > MAX_CHUNK_CHARS) {
    text = text.slice(0, MAX_CHUNK_CHARS) + "\n[… line truncated]\n";
  }
  self.postMessage({ type: "out", id: runId, kind: kind, text: text });
}

var booted = (async function boot() {
  var mod = null;
  var base = CFG.localBase;
  var firstErr = null;
  try {
    mod = await import(CFG.localBase + "pyodide.mjs");
  } catch (e) {
    firstErr = e;
    base = CFG.cdnBase;
    mod = await import(CFG.cdnBase + "pyodide.mjs");
  }
  pyodide = await mod.loadPyodide({ indexURL: base });
  pyodide.setStdout({ batched: function (line) { post("stdout", line + "\n"); } });
  pyodide.setStderr({ batched: function (line) { post("stderr", line + "\n"); } });
  pyodide.runPython(CFG.runner);
  runner = pyodide.globals.get("_aq_run");
  self.postMessage({ type: "ready" });
})();

booted.catch(function (err) {
  // Nothing can ever run in this worker; the manager drops it so the next Run
  // starts a fresh one (connectivity may have returned by then).
  self.postMessage({
    type: "boot-error",
    text: "Python runtime could not be loaded (offline, or /pyodide/ was not deployed).\n" + String(err && err.message ? err.message : err),
  });
});

/** Drop whole traceback frames that belong to pyodide/our runner, keeping the
 *  user's frames. Frames are "  File ..." headers followed by any number of
 *  continuation lines (source spans, "...<N lines>..." elisions, ^^^ carets). */
function errorText(err) {
  var msg = err && err.message ? err.message : String(err);
  var lines = msg.split("\n");
  var out = [];
  var i = 0;
  while (i < lines.length) {
    var line = lines[i];
    if (/^\s*File "/.test(line)) {
      var internal =
        /_pyodide|pyodide\/_?code|python\d+\.zip/.test(line) ||
        /in _aq_run\s*$/.test(line);
      i++;
      var frame = [line];
      while (i < lines.length && !/^\s*File "/.test(lines[i]) && /^\s/.test(lines[i])) {
        frame.push(lines[i]);
        i++;
      }
      if (!internal) out.push.apply(out, frame);
      continue;
    }
    out.push(line);
    i++;
  }
  return out.join("\n");
}

self.onmessage = function (e) {
  var msg = e.data;
  if (!msg || msg.type !== "run") return;
  runId = msg.id;
  chunks = 0;
  booted
    .then(function () {
      // Auto-load packages named in imports (numpy, ...). Needs network for
      // non-vendored wheels; failures surface as a note, the run still starts
      // (and raises ImportError itself if the module truly isn't there).
      return pyodide
        .loadPackagesFromImports(msg.code, { messageCallback: function () {} })
        .catch(function (err) {
          post("stderr", "[package load failed: " + (err && err.message ? err.message : err) + "]\n");
        });
    })
    .then(function () {
      return runner(msg.code); // resolves to repr(value) or null
    })
    .then(function (text) {
      if (text !== null && text !== undefined) post("result", String(text));
    })
    .catch(function (err) {
      post("error", errorText(err));
    })
    .then(function () {
      self.postMessage({ type: "done", id: msg.id });
    });
};
`
  );
}
