#!/usr/bin/env bash
# Builds dist/lfk-kamper.skill from src/ and skill/.
#
# The Apps Script lives in exactly one place — src/Code.js — and is copied into
# the package as assets/Kode.gs at build time. Committing a second copy inside
# skill/ would look tidier and would silently drift the first time someone
# edited one and not the other.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
stage="$(mktemp -d)"
out="$root/dist/lfk-kamper.skill"
trap 'rm -rf "$stage"' EXIT

mkdir -p "$stage/lfk-kamper/assets" "$stage/lfk-kamper/references" "$stage/lfk-kamper/scripts"
cp "$root/skill/SKILL.md"                "$stage/lfk-kamper/SKILL.md"
cp "$root/skill/references/setup.md"     "$stage/lfk-kamper/references/setup.md"
cp "$root/skill/scripts/lfk.py"          "$stage/lfk-kamper/scripts/lfk.py"
cp "$root/skill/scripts/test_code.js"    "$stage/lfk-kamper/scripts/test_code.js"
cp "$root/src/Code.js"                   "$stage/lfk-kamper/assets/Kode.gs"

# Inside the package the script sits next to the tests again, so point it there.
sed -i.bak "s#/../../src/Code.js#/../assets/Kode.gs#" "$stage/lfk-kamper/scripts/test_code.js"
rm -f "$stage/lfk-kamper/scripts/test_code.js.bak"

mkdir -p "$root/dist"
rm -f "$out"
( cd "$stage" && zip -qr "$out" lfk-kamper )
echo "Built $out"
