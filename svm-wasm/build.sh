#!/usr/bin/env bash
# Builds LiteSVM to wasm64 (memory64) and writes the artifact the extension bundles:
# src/sim/svm.wasm (stable path, committed).
#
#   svm-wasm/build.sh               # iterate: raw cargo output, no wasm-opt (same run-time speed)
#   OPTIMIZE=1 svm-wasm/build.sh    # release artifact: + wasm-opt -O3 (~1 min, ~1 % from -Oz)
#
# Everything runs at nice 19 with 4 cargo jobs and 2 binaryen threads, so the machine stays
# responsive. Needs: the toolchain pinned in rust-toolchain.toml (rustup installs it on first
# use, with rust-src + llvm-tools), a clang that knows the wasm64 target (Apple clang does) for
# blst's C code, and for OPTIMIZE=1 binaryen's wasm-opt (brew install binaryen).
set -euo pipefail
cd "$(dirname "$0")"

SYSROOT="$(rustc --print sysroot)"
HOST="$(rustc -vV | sed -n 's/^host: //p')"
# Apple's /usr/bin/ar writes an archive without a wasm symbol index, so blst's
# libblst.a links as empty. llvm-ar from llvm-tools does it right.
export AR_wasm64_unknown_unknown="$SYSROOT/lib/rustlib/$HOST/bin/llvm-ar"
export CC_wasm64_unknown_unknown="${CC_wasm64_unknown_unknown:-clang}"
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-4}"

start=$(date +%s)
nice -n 19 cargo build --locked --target wasm64-unknown-unknown --release
RAW=target/wasm64-unknown-unknown/release/svm_wasm.wasm
OUT=../src/sim/svm.wasm

if [ "${OPTIMIZE:-0}" = "1" ]; then
  command -v wasm-opt >/dev/null || { echo "wasm-opt not found (brew install binaryen)" >&2; exit 1; }
  nice -n 19 env BINARYEN_CORES=2 wasm-opt "${WASM_OPT_LEVEL:--O3}" --strip-debug --strip-producers \
    --enable-memory64 --enable-bulk-memory --enable-sign-ext --enable-mutable-globals \
    --enable-nontrapping-float-to-int --enable-multivalue --enable-reference-types \
    "$RAW" -o "$OUT"
else
  cp "$RAW" "$OUT"
fi
echo "raw $(wc -c < "$RAW") bytes -> $OUT $(wc -c < "$OUT") bytes (gzip $(gzip -9 -c "$OUT" | wc -c)), $(( $(date +%s) - start )) s"
