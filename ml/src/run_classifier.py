r"""The prose-vs-formula run classifier: a calibrated logistic model.

Replaces `unified.route_word`'s seven-rule cascade and most of what the
smoothing pass was compensating for. Deliberately the smallest model that can
do the job:

  - **28 weights.** The evidence is already engineered into the feature vector
    (`run_features.py`); what was missing was never capacity, it was a way to
    WEIGH conflicting evidence instead of taking the first rule that fired.
  - **logistic, so the output is a probability.** The cascade could only answer
    math/text/ambiguous, which is why the two error directions could not be
    traded against each other. A probability plus one threshold makes that
    trade explicit and tunable: the caller decides whether swallowing a word is
    worse than losing a formula, and the threshold moves.
  - **fitted by IRLS**, Newton's method for logistic regression. At this size it
    converges in a handful of exact steps with no learning rate to tune and no
    seed to fix, so a rebuild is reproducible to the last bit.
  - **no new dependency.** numpy is already required; scikit-learn is not
    installed and a 28-parameter model is not a reason to add it.

The feature NAMES are stored with the weights and checked on load: appending a
feature to `run_features.FEATURES` must invalidate an old model rather than
silently pair weights with the wrong columns.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from .run_features import FEATURES

ML_DIR = Path(__file__).resolve().parents[1]
DEFAULT_PATH = ML_DIR / "checkpoints" / "run_clf.json"

#: P(math) at or above this is math. 0.5 is the neutral point; the shipped
#: value is chosen on the eval set, see `train_run_clf.py --sweep`.
DEFAULT_THRESHOLD = 0.5


class RunClassifier:
    def __init__(self, weights: np.ndarray, features: tuple[str, ...] = FEATURES,
                 threshold: float = DEFAULT_THRESHOLD, meta: dict | None = None):
        if len(weights) != len(features):
            raise ValueError(f"{len(weights)} weights for {len(features)} features")
        self.w = np.asarray(weights, dtype=np.float64)
        self.features = tuple(features)
        self.threshold = float(threshold)
        self.meta = meta or {}

    # ---- inference --------------------------------------------------------

    def proba(self, X: np.ndarray) -> np.ndarray:
        """P(math) per row."""
        if X.size == 0:
            return np.zeros(0, dtype=np.float64)
        z = np.clip(np.asarray(X, dtype=np.float64) @ self.w, -30.0, 30.0)
        return 1.0 / (1.0 + np.exp(-z))

    def predict(self, X: np.ndarray) -> np.ndarray:
        """True where the run is math."""
        return self.proba(X) >= self.threshold

    # ---- fitting ----------------------------------------------------------

    @classmethod
    def fit(cls, X: np.ndarray, y: np.ndarray, *, l2: float = 1.0, iters: int = 60,
            tol: float = 1e-9) -> "RunClassifier":
        """IRLS with an L2 penalty. `y` is 1 for math, 0 for text.

        The penalty is not optional: several features are near-collinear by
        construction (`is_alpha` and `all_lower` agree on most prose), and an
        unpenalised fit sends their weights to +-inf in opposite directions,
        which is both unstable and unreadable.
        """
        X = np.asarray(X, dtype=np.float64)
        y = np.asarray(y, dtype=np.float64)
        n, d = X.shape
        w = np.zeros(d, dtype=np.float64)
        # The bias column is an intercept; penalising it would drag the decision
        # boundary toward whatever the class balance happens to be.
        penalty = np.full(d, float(l2))
        if "bias" in FEATURES:
            penalty[FEATURES.index("bias")] = 0.0
        ridge = np.diag(penalty)

        for _ in range(iters):
            z = np.clip(X @ w, -30.0, 30.0)
            p = 1.0 / (1.0 + np.exp(-z))
            grad = X.T @ (y - p) - penalty * w
            s = np.clip(p * (1.0 - p), 1e-9, None)
            hess = (X.T * s) @ X + ridge
            try:
                step = np.linalg.solve(hess, grad)
            except np.linalg.LinAlgError:
                step = np.linalg.lstsq(hess, grad, rcond=None)[0]
            w = w + step
            if float(np.max(np.abs(step))) < tol:
                break
        return cls(w)

    # ---- persistence ------------------------------------------------------

    def save(self, path: Path | None = None) -> Path:
        p = path or DEFAULT_PATH
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(
            json.dumps(
                {
                    "version": 1,
                    "features": list(self.features),
                    "weights": [float(v) for v in self.w],
                    "threshold": self.threshold,
                    "meta": self.meta,
                },
                indent=1,
            ),
            encoding="utf-8",
        )
        return p

    @classmethod
    def load(cls, path: Path | None = None) -> "RunClassifier":
        p = path or DEFAULT_PATH
        blob = json.loads(p.read_text(encoding="utf-8"))
        features = tuple(blob["features"])
        if features != FEATURES:
            raise ValueError(
                f"{p} was trained on a different feature set "
                f"({len(features)} features vs {len(FEATURES)}) — retrain it"
            )
        return cls(
            np.asarray(blob["weights"], dtype=np.float64),
            features,
            float(blob.get("threshold", DEFAULT_THRESHOLD)),
            blob.get("meta", {}),
        )

    def describe(self, top: int = 12) -> str:
        order = np.argsort(-np.abs(self.w))[:top]
        return "\n".join(
            f"  {self.features[i]:<22} {self.w[i]:+8.3f}" for i in order
        )


_CACHE: "RunClassifier | None | bool" = False


def load_default() -> RunClassifier | None:
    """The shipped model, or None when there is not one yet.

    None is a supported state, not an error: `unified.classify_runs` falls back
    to the original cascade, so a checkout with no trained model still
    recognizes exactly as it did before.
    """
    global _CACHE
    if _CACHE is not False:
        return _CACHE  # type: ignore[return-value]
    try:
        _CACHE = RunClassifier.load()
    except (FileNotFoundError, ValueError, KeyError, json.JSONDecodeError):
        _CACHE = None
    return _CACHE  # type: ignore[return-value]


if __name__ == "__main__":
    failures = []

    def check(name: str, ok: bool) -> None:
        print(("✓ " if ok else "✗ ") + name)
        if not ok:
            failures.append(name)

    rng = np.random.default_rng(0)
    d = len(FEATURES)
    true_w = np.zeros(d)
    true_w[0] = 4.0
    true_w[1] = -4.0
    X = rng.random((800, d))
    X[:, FEATURES.index("bias")] = 1.0
    y = (1.0 / (1.0 + np.exp(-(X @ true_w))) > 0.5).astype(float)

    clf = RunClassifier.fit(X, y)
    acc = float((clf.predict(X) == (y > 0.5)).mean())
    check(f"C1  IRLS separates a separable problem (acc {acc:.3f})", acc > 0.95)
    check("C2  weights recover the signs of the generating model",
          clf.w[0] > 0 and clf.w[1] < 0)
    check("C3  proba is a probability", bool(np.all((clf.proba(X) >= 0) & (clf.proba(X) <= 1))))
    check("C4  empty input is allowed", clf.proba(np.zeros((0, d))).shape == (0,))

    import tempfile

    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "m.json"
        clf.save(p)
        back = RunClassifier.load(p)
        check("C5  round-trips through JSON", bool(np.allclose(back.w, clf.w)))
        bad = json.loads(p.read_text())
        bad["features"] = bad["features"][:-1]
        p.write_text(json.dumps(bad))
        try:
            RunClassifier.load(p)
            check("C6  a stale feature set is refused", False)
        except ValueError:
            check("C6  a stale feature set is refused", True)

    check("C7  threshold moves the decision",
          int(clf.predict(X).sum()) != int((clf.proba(X) >= 0.99).sum()))

    print(f"cases passed: {7 - len(failures)} / failed: {len(failures)}")
    raise SystemExit(1 if failures else 0)
