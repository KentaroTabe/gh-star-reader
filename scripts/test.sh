#!/usr/bin/env bash
# Compiles src/lib to CommonJS and runs node:test over it.
# Node 20 cannot execute TypeScript directly, and the alternative — adding a
# test runner — would be a bigger dependency than the tests are.
set -euo pipefail

cd "$(dirname "$0")/.."

rm -rf .test-build
npx --no-install tsc -p tsconfig.test.json
node --test .test-build/lib/*.test.js
