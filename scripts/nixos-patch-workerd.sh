#!/usr/bin/env sh
# NixOS can't run the prebuilt (generic-linux) workerd binary that wrangler/miniflare download.
# This patches its ELF interpreter + rpath to a glibc from nixpkgs. No-op on other systems.
set -e
[ -e /etc/NIXOS ] || exit 0
command -v nix >/dev/null 2>&1 || { echo "nix not found, skipping workerd patch"; exit 0; }
cd "$(dirname "$0")/.."
GLIBC="$(nix eval --raw nixpkgs#glibc.outPath 2>/dev/null)"
nix build --no-link nixpkgs#glibc >/dev/null 2>&1 || true
for B in $(find node_modules -path "*workerd-linux-64/bin/workerd" -type f 2>/dev/null); do
  [ -f "$B" ] || continue
  if "$B" --version >/dev/null 2>&1; then continue; fi
  echo "patching $B -> $GLIBC"
  nix shell nixpkgs#patchelf -c patchelf --set-interpreter "$GLIBC/lib/ld-linux-x86-64.so.2" --set-rpath "$GLIBC/lib" "$B"
done
