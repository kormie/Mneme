#!/usr/bin/env bash
# Install the pinned Bend release if it isn't already installed. Shared by CI
# (bend job) and local setup, so there is one definition of "how to get bend".
#
# The pin lives in bend/.bend-version. Each pinned version needs its release
# archive sha256s below; copy them from https://bend-lang.com/install.sh when
# you bump the pin (that script vouches for the archives at github.com). Unlike
# `curl bend-lang.com/install.sh | sh`, which installs whatever is latest, this
# installs exactly the pinned release, so a proof that checks today checks the
# same way tomorrow. It mirrors what that script does: no sudo, no shell file
# edited, files under $BEND_HOME (default ~/.bend).
set -euo pipefail
cd "$(dirname "$0")/.."

ver=$(tr -d '[:space:]' <bend/.bend-version)
home=${BEND_HOME:-$HOME/.bend}

# Bend's daily "is there a newer version" ping is noise in CI and in this script.
export BEND_NO_TELEMETRY=1

if [ -x "$home/bin/bend" ] && "$home/bin/bend" version 2>/dev/null | grep -qF "$ver"; then
  echo "OK: bend $ver already installed ($home/bin/bend)"
  if [ -n "${GITHUB_PATH:-}" ]; then echo "$home/bin" >>"$GITHUB_PATH"; fi
  exit 0
fi

case "$ver" in
  2.0.40)
    sha_darwin_arm64=b2be003b041eb6cfc65326be18f79eb2e0bae2189be79a18c507e661b4b6900b
    sha_darwin_x64=9229c8bdd0a93f63fa45cc5af5e9e56389ebb620d655920915daf966c6ca561c
    sha_linux_arm64=2f42a6fa34ecdaa71ae105e5fa734f9a07e129d333e45448ab6d2ff03a837570
    sha_linux_x64=c9ff8d67bd903fb6ad9a26b43d8a62c01021de82a44d55ce4a3dcd4732113d6b
    ;;
  *)
    echo "FAIL: no sha256s recorded for bend $ver in scripts/install-bend.sh." >&2
    echo "      Copy them from https://bend-lang.com/install.sh and add a case." >&2
    exit 1
    ;;
esac

case "$(uname -s)" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) echo "FAIL: bend needs Linux or macOS ($(uname -s))." >&2; exit 1 ;;
esac
case "$(uname -m)" in
  arm64 | aarch64) arch=arm64 ;;
  x86_64 | amd64) arch=x64 ;;
  *) echo "FAIL: bend needs arm64 or x64 ($(uname -m))." >&2; exit 1 ;;
esac
sum_var="sha_${os}_${arch}"
sum=${!sum_var}

name="bend-$ver-$os-$arch.tar.gz"
url="https://github.com/bendlang/bend/releases/download/v$ver/$name"

mkdir -p "$home/bin"
tmp=$(mktemp -d "$home/tmp.XXXXXX")
trap 'rm -rf "$tmp"' EXIT

echo "downloading $url"
curl --proto '=https' --tlsv1.2 -fsSL -o "$tmp/$name" "$url"

if command -v sha256sum >/dev/null 2>&1; then
  echo "$sum  $tmp/$name" | sha256sum -c - >/dev/null 2>&1 \
    || { echo "FAIL: $name does not match its pinned sha256; not installed." >&2; exit 1; }
else
  echo "$sum  $tmp/$name" | shasum -a 256 -c - >/dev/null 2>&1 \
    || { echo "FAIL: $name does not match its pinned sha256; not installed." >&2; exit 1; }
fi

tar -xzf "$tmp/$name" -C "$tmp"
rm -rf "$home/bend2" "$home/guide"
mv "$tmp/bend/bend2" "$tmp/bend/guide" "$home/"
mv -f "$tmp/bend/bin/bend" "$home/bin/bend"

# Make bend visible to the rest of this shell/job.
if [ -n "${GITHUB_PATH:-}" ]; then
  echo "$home/bin" >>"$GITHUB_PATH"
else
  export PATH="$home/bin:$PATH"
fi

echo "OK: bend $ver installed ($home/bin/bend)"
