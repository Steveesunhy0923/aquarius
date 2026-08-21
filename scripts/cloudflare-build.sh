#!/usr/bin/env sh
#
# Prepare the @atorku/* sibling checkout on a CI/build machine.
#
# THE PROBLEM. package.json depends on "file:../atorku/packages/*", which only
# resolves where both repos sit side by side. A build host clones ONE repo, so
# the dependency points at nothing.
#
# WHY THIS RUNS AS A BUILD COMMAND AND NOT AN INSTALL ONE. Cloudflare runs
# `npm clean-install` itself, before any command here. That install SUCCEEDS
# even with the sibling missing — npm writes the symlink without checking that
# the target exists (verified: GitHub Actions run 31136493392 installed 283
# packages fine, then failed later at typecheck with TS2307). So by the time
# this script runs, node_modules/@atorku/{auth,entitlements} already exist as
# DANGLING symlinks, and all we have to do is make their targets real. No
# reinstall is needed afterwards — a relative symlink starts resolving the
# instant its target appears.
#
# The paths are deliberately all relative. The symlink is
# node_modules/@atorku/auth -> ../../../atorku/packages/auth, i.e. a sibling of
# the repo root, and we clone to ../atorku from the repo root. Both are
# relative to the same place, so this works wherever the host checks the repo
# out (/opt/buildhome/repo on Cloudflare) without hardcoding it.
#
# Usage, as the Cloudflare "Build command":
#     sh scripts/cloudflare-build.sh && npm run build:static
#
# Requires ATORKU_REPO_TOKEN — a GitHub PAT with `repo` scope — as a build
# SECRET, because Steveesunhy0923/atorku is private. If the packages are ever
# published to npm, delete this script and the secret: the file: dependencies
# become ordinary version ranges and every host works with no special casing.

set -eu

REPO="${ATORKU_REPO:-Steveesunhy0923/atorku}"
REF="${ATORKU_REF:-main}"
DEST="../atorku"

if [ -d "$DEST" ]; then
  # Deliberately left ALONE rather than fetched/reset. On a build host this
  # branch never runs (nothing outside the repo survives between builds), so
  # the only machine that reaches it is a developer's — where ../atorku is the
  # real working checkout, and quietly moving its HEAD would be destructive.
  # This also makes the script safe to run locally to test the rest of it.
  echo "atorku: using existing checkout at $DEST (not modified)"
else
  if [ -z "${ATORKU_REPO_TOKEN:-}" ]; then
    echo "atorku: ATORKU_REPO_TOKEN is not set." >&2
    echo "  The atorku repo is private, so the clone below cannot authenticate." >&2
    echo "  Add it as a build secret in the Cloudflare project settings." >&2
    exit 1
  fi
  echo "atorku: cloning $REPO@$REF -> $DEST"
  git clone --depth 1 --branch "$REF" \
    "https://x-access-token:${ATORKU_REPO_TOKEN}@github.com/${REPO}.git" "$DEST"
fi

# Both packages ship compiled dist/ rather than source, and dist/ is gitignored
# — so cloning alone leaves the symlinks pointing at a directory with no build
# output, which fails identically to them being absent.
echo "atorku: building packages"
npm --prefix "$DEST" install --no-audit --no-fund
npm --prefix "$DEST" run build:packages

# Prove the link the app actually imports through is live, so a failure here
# names the real cause instead of surfacing as TS2307 several minutes later.
if [ ! -f "node_modules/@atorku/auth/dist/index.js" ]; then
  echo "atorku: node_modules/@atorku/auth/dist/index.js still missing after build." >&2
  exit 1
fi
echo "atorku: ready"
