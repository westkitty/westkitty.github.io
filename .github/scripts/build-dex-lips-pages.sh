#!/usr/bin/env bash
set -euo pipefail

: "${RUNNER_TEMP:?RUNNER_TEMP must point to disposable GitHub Actions storage}"
: "${GITHUB_WORKSPACE:?GitHub Actions workspace is required}"
SITE="$RUNNER_TEMP/dex-lips-pages-site"
PKG="$RUNNER_TEMP/dex-lips-pinned-packages"
mkdir -p "$SITE" "$PKG"
# Keep existing westkitty.github.io pages intact: publish the full current tree.
rsync -a --exclude='/.git/' --exclude='/.github/' --exclude='/node_modules/' \
  --exclude='/.cache/' "$GITHUB_WORKSPACE/" "$SITE/"
ROOT="$SITE/dex-lips-tablet/vendor"
mkdir -p "$ROOT/lip-sync" "$ROOT/mediabunny"

npm pack 'lip-sync-engine@1.0.3' --pack-destination "$PKG" --ignore-scripts --silent --cache "$PKG/npm-cache" --fetch-retries 1
npm pack 'mediabunny@1.66.2' --pack-destination "$PKG" --ignore-scripts --silent --cache "$PKG/npm-cache" --fetch-retries 1
npm pack '@mediabunny/aac-encoder@1.66.2' --pack-destination "$PKG" --ignore-scripts --silent --cache "$PKG/npm-cache" --fetch-retries 1
mkdir -p "$PKG/lip-sync" "$PKG/mediabunny" "$PKG/aac"
tar -xzf "$PKG/lip-sync-engine-1.0.3.tgz" -C "$PKG/lip-sync" --strip-components=1
tar -xzf "$PKG/mediabunny-1.66.2.tgz" -C "$PKG/mediabunny" --strip-components=1
tar -xzf "$PKG/mediabunny-aac-encoder-1.66.2.tgz" -C "$PKG/aac" --strip-components=1

install -m 0644 "$PKG/lip-sync/dist/index.mjs" "$ROOT/lip-sync/index.mjs"
install -m 0644 "$PKG/lip-sync/dist/wasm/lip-sync-engine.js" "$ROOT/lip-sync/lip-sync-engine.js"
install -m 0644 "$PKG/lip-sync/dist/wasm/lip-sync-engine.wasm" "$ROOT/lip-sync/lip-sync-engine.wasm"
install -m 0644 "$PKG/lip-sync/dist/wasm/lip-sync-engine.data" "$ROOT/lip-sync/lip-sync-engine.data"
install -m 0644 "$PKG/mediabunny/dist/bundles/mediabunny.mjs" "$ROOT/mediabunny/mediabunny.mjs"
install -m 0644 "$PKG/aac/dist/bundles/mediabunny-aac-encoder.mjs" "$ROOT/mediabunny/mediabunny-aac-encoder.mjs"

# These are the exact distributed bytes inspected in the prior Mac+tablet proofs.
(
 cd "$ROOT"
 printf '%s  %s\n' \
 'bc9b36a83ea3707cdda4ecaf47d37ebff00a12b2764607c60a5cdb47f9cef198' 'lip-sync/index.mjs' \
 '078c9cb6b2daa1a01bd1894962c298387b341fbec6697ef611f201e384c60c3e' 'lip-sync/lip-sync-engine.js' \
 '1846795c8f25b5069416d00f5053c40514725ad0899a9c3e2da6065dce54fa5a' 'lip-sync/lip-sync-engine.wasm' \
 '70cdab484b820d34e63d33d5df5eef5265eebae926d6b962da243c4368a69a52' 'lip-sync/lip-sync-engine.data' \
 '6561396012f179bd4c538188c4b057676ba28a1b7967fff740479f3f8a2e8081' 'mediabunny/mediabunny.mjs' \
 'a04e2d292d5701d18a4c6ce163969d4bfcd581d45e555566b9aed9ea551cf765' 'mediabunny/mediabunny-aac-encoder.mjs' \
 | sha256sum -c -
)

# Package notices accompany bundled vendor files. Never republish source art or logs.
for desc in "lip-sync:lip-sync" "mediabunny:mediabunny" "aac:aac"; do
 key="${desc%%:*}"
 dir="${desc#*:}"
 for candidate in LICENSE LICENSE.txt LICENSE.md COPYING NOTICE NOTICE.md THIRD_PARTY_NOTICES.md; do
  if test -f "$PKG/$dir/$candidate"; then
   install -m 0644 "$PKG/$dir/$candidate" "$ROOT/${key}-${candidate}"
  fi
 done
done

# Jekyll is intentionally bypassed so .wasm/.data assets and existing site paths remain intact.
touch "$SITE/.nojekyll"
python3 "$GITHUB_WORKSPACE/.github/scripts/validate-dex-lips-pages.py" "$SITE"
printf 'PAGES_SITE_READY=%s\n' "$SITE"
