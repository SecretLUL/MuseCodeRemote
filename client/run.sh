#!/usr/bin/env bash
set -euo pipefail

REPO_OWNER="SecretLUL"
REPO_NAME="MuseCodeRemote"
BRANCH="main"
RAW_BASE="https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BRANCH}"

if ! command -v python3 >/dev/null 2>&1; then
  echo "Error: Python 3 is required to run Muse Code Remote." >&2
  exit 1
fi

TMP_DIR="$(mktemp -d /tmp/mcr-run.XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT

curl -fsSL "${RAW_BASE}/client/mcr" -o "${TMP_DIR}/mcr"
chmod +x "${TMP_DIR}/mcr"

exec "${TMP_DIR}/mcr" "$@"
